#!/usr/bin/env node
// Server stress test: runs the REAL server code (server.ts, game.ts, cubesync.ts, sim/physics.ts, profiles.ts) in Node
// with a virtual clock, fills the rooms with bots that play, and gives every bot a mirror of its game's cubes built
// exactly like client/cubenet.ts does (cubeState / cubeMoves, sequence gaps -> cubeSync). It measures:
//   - server CPU per tick (physics + game logic + sync), against the 33 ms budget of a 30 Hz tick
//   - outgoing messages per tick (headless cap: 512), message sizes (13 KB transport limit), bandwidth per client
//   - Storage host calls in flight (isolate cap: 40), and the profile reads that fail because of it
//   - cube sync quality: how often a bot's mirror differs from the server, and for how long
//
// Usage:
//   node tests/stress/server-stress.cjs                       all scenarios, 240 s each
//   node tests/stress/server-stress.cjs --scenario todas-llenas --seconds 120 --latency 150 --jitter 60 --loss 2
//   node tests/stress/server-stress.cjs --rooms 5,5,3,0,0,0,2 --lobby 4 --ramp 0
//   node tests/stress/server-stress.cjs --scenario sobrecarga --storageFail 30   (Storage errors: profiles must still load)
//   node tests/stress/server-stress.cjs --json /path/out.json
//
// What it cannot tell you: the real headless isolate is slower than Node on a dev machine (treat CPU numbers as a
// lower bound), and the comms transport, CRDT broadcast and client rendering are modelled, not run.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { performance } = require('node:perf_hooks')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')

// ---------- options ----------
const SCENARIOS = {
  'una-llena': { desc: 'Una sala llena (5), el resto vacías', rooms: [5, 0, 0, 0, 0, 0, 0], lobby: 0 },
  intermedio: { desc: 'Ocupación mixta + gente en el lobby', rooms: [5, 3, 2, 4, 1, 0, 0], lobby: 5 },
  'todas-llenas': { desc: 'Las 7 salas llenas (35 jugadores)', rooms: [5, 5, 5, 5, 5, 5, 5], lobby: 0 },
  sobrecarga: { desc: 'Todas llenas + 15 extra intentando entrar, todos conectan a la vez', rooms: [5, 5, 5, 5, 5, 5, 5], lobby: 0, overflow: 15, ramp: 0 }
}
function parseArgs(argv) {
  const o = { scenario: 'all', seconds: 240, latency: 120, jitter: 40, loss: 0, storageMs: 250, storageFail: 0, seed: 1, ramp: 8, chaos: 0.03, json: '' }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '')
    const v = argv[i + 1]
    if (k === 'help' || k === 'h') o.help = true
    else if (k === 'rooms') { o.rooms = v.split(',').map(Number); i++ }
    else if (k in o || ['lobby', 'overflow', 'ramp'].includes(k)) { o[k] = k === 'scenario' || k === 'json' ? v : Number(v); i++ }
    else throw new Error(`unknown option --${k}`)
  }
  return o
}

// ---------- deterministic randomness and a virtual clock ----------
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function runScenario(name, sc, opt) {
  const rng = mulberry32(opt.seed)
  const R = (a, b) => a + rng() * (b - a)
  const SeededMath = Object.create(Math)
  SeededMath.random = rng
  let now = 1_750_000_000_000 // virtual ms
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [now])) }
    static now() { return now }
  }
  const logs = { roundsWon: 0, roundsTimeout: 0, profileReadFailed: 0, seatsGranted: 0, seatsFull: 0, errors: [] }
  const quiet = {
    log: (...a) => {
      const s = a.map(String).join(' ')
      if (s.startsWith('[ROUND] won')) logs.roundsWon++
      else if (s.startsWith('[ROUND] timeout')) logs.roundsTimeout++
      else if (s.includes('profile read failed')) logs.profileReadFailed++
      else if (s.includes('seat granted')) logs.seatsGranted++
      else if (s.includes('[ENTER]') && s.endsWith('full')) logs.seatsFull++
    },
    error: (...a) => logs.errors.push(a.map(String).join(' ')),
    warn: () => {}
  }
  function load(file, mocks = {}, extra = '') {
    file = path.resolve(ROOT, file)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const module = { exports: {} }
    const req = createRequire(file)
    vm.runInNewContext(code + '\n' + extra, { module, exports: module.exports, require: (id) => (Object.hasOwn(mocks, id) ? mocks[id] : req(id)), console: quiet, Date: FakeDate, Promise, Math: SeededMath }, { filename: file })
    return module.exports
  }

  // ---------- virtual timers (Storage latency, network delivery) ----------
  const timers = [] // { at, fn }, kept sorted by insertion of increasing at per stream is not guaranteed: sort on run
  const later = (ms, fn) => timers.push({ at: now + ms, fn })
  function runTimers() {
    if (timers.length === 0) return
    timers.sort((a, b) => a.at - b.at)
    let i = 0
    while (i < timers.length && timers[i].at <= now) timers[i++].fn()
    timers.splice(0, i)
  }

  // ---------- ECS doubles ----------
  const crdt = { writes: 0 }
  function component(countWrites) {
    const values = new Map()
    return {
      values, componentId: 1,
      create: (e, v) => values.set(e, v),
      getMutable: (e) => { if (countWrites) crdt.writes++; return values.get(e) },
      get: (e) => values.get(e), getOrNull: (e) => values.get(e) ?? null
    }
  }
  const Transform = component(), PlayerIdentityData = component(), AvatarBase = component(), CubeData = component()
  const GameState = component(true), PlayerRanks = component(true), GltfContainer = component()
  const comps = [Transform, PlayerIdentityData, AvatarBase, CubeData, GameState, PlayerRanks, GltfContainer]
  const systems = new Map()
  let nextEntity = 512
  const engine = {
    getEntityOrNullByName: () => null, addEntity: () => nextEntity++, removeEntity: (e) => comps.forEach((c) => c.values.delete(e)),
    getEntitiesWith: (c) => c.values.entries(), addSystem: (fn, _p, n) => systems.set(n, fn), RootEntity: 0
  }
  const Vector3 = {
    create: (x = 0, y = 0, z = 0) => ({ x, y, z }), One: () => ({ x: 1, y: 1, z: 1 }),
    scale: (v, n) => ({ x: v.x * n, y: v.y * n, z: v.z * n }),
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
    Forward: () => ({ x: 0, y: 0, z: 1 }), Right: () => ({ x: 1, y: 0, z: 0 }),
    rotate: (v, q) => { // yaw-only rotation is all the server uses (hand position, toss direction)
      const yaw = 2 * Math.atan2(q.y || 0, q.w ?? 1)
      const c = Math.cos(yaw), s = Math.sin(yaw)
      return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c }
    }
  }
  const Quaternion = { fromEulerDegrees: (_x, y) => ({ x: 0, y: Math.sin((y * Math.PI) / 360), z: 0, w: Math.cos((y * Math.PI) / 360) }) }

  // ---------- Storage double with the isolate's 40 in-flight host-call cap ----------
  const HOST_CAP = 40
  const st = { injected: 0, inflight: 0, maxInflight: 0, rejected: 0, calls: 0, data: new Map() }
  function hostCall(fn, onCap) {
    st.calls++
    if (st.inflight >= HOST_CAP) { st.rejected++; return onCap() }
    if (rng() * 100 < opt.storageFail) { st.injected++; return onCap() } // --storageFail: a Storage outage or error
    st.inflight++
    st.maxInflight = Math.max(st.maxInflight, st.inflight)
    return new Promise((res) => later(opt.storageMs * R(0.6, 1.6), () => { st.inflight--; res(fn()) }))
  }
  const capErr = () => Promise.reject(new Error('too many concurrent host calls'))
  const Storage = {
    get: (k) => hostCall(() => st.data.get(k), capErr),
    set: (k, v) => hostCall(() => (st.data.set(k, v), true), () => Promise.resolve(false)),
    player: {
      get: (a, k) => hostCall(() => st.data.get(a + '/' + k), capErr), // the SDK throws on a failed read
      set: (a, k, v) => hostCall(() => (st.data.set(a + '/' + k, v), true), () => Promise.resolve(false))
    }
  }

  // ---------- network double ----------
  const MSG_LIMIT = 13 * 1024
  const SEND_CAP = 512
  const net = {
    tickSends: 0, maxTickSends: 0, droppedCap: 0, droppedSize: 0, lost: 0, maxMsg: 0, maxMsgName: '',
    deliveries: 0, bytes: 0, byName: new Map(), perBot: new Map(), inbound: new Map(), maxInbound: 0
  }
  const outbox = [] // room.send calls made during a measured tick; delivered after it
  const handlers = new Map()
  const room = { onMessage: (n, fn) => handlers.set(n, fn), send: (n, data, opts) => outbox.push([n, data, opts && opts.to]) }
  function sizeOf(v) {
    if (typeof v === 'number') return 4
    if (typeof v === 'string') return v.length + 4
    if (typeof v === 'bigint' || typeof v === 'boolean') return 8
    if (Array.isArray(v)) return 4 + v.length * 2 // the only arrays on the wire are Short arrays
    if (v && typeof v === 'object') return Object.values(v).reduce((s, x) => s + sizeOf(x), 0)
    return 0
  }
  const bots = []
  const botBy = new Map()
  const lastDeliver = new Map() // per recipient: keep order (reliable, ordered channel)
  function flushOutbox() {
    for (const [name, data, to] of outbox) {
      net.tickSends++
      const bytes = sizeOf(data) + name.length + 24
      if (bytes > net.maxMsg) { net.maxMsg = bytes; net.maxMsgName = name }
      if (bytes > MSG_LIMIT) { net.droppedSize++; continue }
      if (net.tickSends > SEND_CAP) { net.droppedCap++; continue }
      const list = to ?? bots.filter((b) => b.connected).map((b) => b.addr)
      const s = net.byName.get(name) ?? { n: 0, b: 0, calls: 0 }
      s.calls++
      for (const addr of list) {
        s.n++; s.b += bytes
        net.deliveries++; net.bytes += bytes
        net.perBot.set(addr, (net.perBot.get(addr) ?? 0) + bytes)
        if (rng() * 100 < opt.loss) { net.lost++; continue }
        const bot = botBy.get(addr)
        if (!bot) continue
        const at = Math.max(lastDeliver.get(addr) ?? 0, now + opt.latency + R(-opt.jitter, opt.jitter))
        lastDeliver.set(addr, at)
        const copy = data // read-only for the bots
        timers.push({ at, fn: () => bot.receive(name, copy) })
      }
      net.byName.set(name, s)
    }
    outbox.length = 0
    net.maxTickSends = Math.max(net.maxTickSends, net.tickSends)
    net.tickSends = 0
  }
  let handlerMs = 0
  function toServer(addr, name, data) {
    const w = net.inbound.get(addr) ?? []
    w.push(now)
    while (w.length && w[0] < now - 1000) w.shift()
    net.inbound.set(addr, w)
    net.maxInbound = Math.max(net.maxInbound, w.length)
    later(opt.latency + R(-opt.jitter, opt.jitter), () => {
      const h = handlers.get(name)
      if (!h) return
      const t0 = performance.now()
      h(data, { from: addr })
      handlerMs += performance.now() - t0
    })
  }

  // ---------- the real server ----------
  const C = load('src/config.ts')
  const noop = () => {}
  const profiles = load('src/server/profiles.ts', { '@dcl/sdk/server': { Storage } })
  const env = load('src/shared/env.ts', { '@dcl/sdk/ecs': { engine, Transform }, '@dcl/sdk/math': { Vector3 }, '../config': C })
  const world = load('src/shared/world.ts', { '../config': C, './env': env })
  const ecs = { engine, Transform, PlayerIdentityData, AvatarBase, GltfContainer, ColliderLayer: { CL_NONE: 0 } }
  const math = { Vector3, Quaternion }
  const schemas = { CubeData, GameState, PlayerRanks, protectServerEntity: noop, modelFor: (l) => l }
  const messages = { room }
  const common = load('src/server/common.ts', { '@dcl/sdk/ecs': ecs, '@dcl/sdk/math': math, '../config': C, '../shared/messages': messages, './profiles': profiles })
  const lang = load('src/shared/lang.ts')
  const i18n = load('src/shared/i18n/index.ts', { './en': load('src/shared/i18n/en.ts'), './es': load('src/shared/i18n/es.ts'), './pt': load('src/shared/i18n/pt.ts') })
  const say = load('src/server/say.ts', { '../shared/i18n': i18n })
  const cubenet = load('src/shared/cubenet.ts')
  const physics = load('src/sim/physics.ts')
  const heaps = load('src/server/heaps.ts', { '../config': C, '../shared/world': world, '../sim/physics': physics })
  const cubesync = load('src/server/cubesync.ts', { '../config': C, '../shared/messages': messages, '../shared/cubenet': cubenet })
  const words = load('src/server/words.ts', { './words_es': load('src/server/words_es.ts'), './words_pt': load('src/server/words_pt.ts') })
  const oracle = new Map() // question -> answer: the bots "know" the word (players read the clue and think)
  const pickWord = (level, exclude, l) => { const w = words.pickWord(level, exclude, l); oracle.set(w.question, w.answer); return w }
  const game = load('src/server/game.ts', {
    '@dcl/sdk/ecs': ecs, '@dcl/sdk/math': math, '../config': C, './words': { pickWord }, './profiles': profiles,
    '../shared/messages': messages, '../shared/env': env, '../shared/schemas': schemas,
    '../shared/player-label': load('src/shared/player-label.ts'), '../shared/world': world, './common': common,
    '../shared/pushers': load('src/shared/pushers.ts', { '../config': C }), '../sim/physics': physics,
    '../shared/cubenet': cubenet, './cubesync': cubesync, './heaps': heaps, '../shared/lang': lang, './say': say, '../shared/i18n': i18n
  })
  const server = load('src/server/server.ts', {
    '@dcl/sdk/ecs': ecs, '@dcl/sdk/network': { syncEntity: noop }, '@dcl/sdk/server': { Storage }, '../config': C,
    './profiles': profiles, '../shared/messages': messages, '../shared/env': env, '../shared/schemas': schemas,
    './common': common, './game': game, './heaps': heaps, '../shared/tutorial': load('src/shared/tutorial.ts'), '../shared/lang': lang,
    './say': say, '../shared/i18n': i18n,
    './netstats': { setupNetStats: noop, recordTick: noop, netAccessTick: noop, forgetNetAccess: noop, isPreview: () => false }
  }, 'exports.games = games')
  server.initServer()
  const games = server.games
  const serverTick = systems.get('word-cubes-server')
  // attribute each tick's cost: games that started a pile this tick (round start / reroll) vs. games playing normally
  const cost = { pile: 0, play: 0, spikes: { pile: 0, play: 0, other: 0 }, maxPiles: 0 }
  let tickPile = 0, tickPlay = 0, pilesNow = 0
  for (const gm of games) {
    const inner = gm.tick
    gm.tick = (dt) => {
      const round = gm.stats().round
      const t0 = performance.now()
      inner(dt)
      const ms = performance.now() - t0
      if (gm.stats().round !== round) { tickPile += ms; pilesNow++ } else tickPlay += ms
    }
  }
  const { STATE_FIELDS, MOVE_FIELDS, unpackPos, unpackMode, unpackLetter } = cubenet

  // ---------- bots ----------
  const LOBBY = { x: -200, y: env.envOrigin(0).y, z: -200 }
  const plan = []
  sc.rooms.forEach((n, g) => { for (let i = 0; i < n; i++) plan.push(g) })
  for (let i = 0; i < (sc.lobby ?? 0); i++) plan.push(-1)
  for (let i = 0; i < (sc.overflow ?? 0); i++) plan.push(i % C.GAME_COUNT) // will find their room full
  const ramp = (opt.ramp ?? sc.ramp ?? 8) * 1000
  const sync = { checks: 0, mismatched: 0, missing: 0, extra: 0, mode: 0, pos: 0, open: new Map(), durations: [], lag: new Array(101).fill(0), lagN: 0, lagSum: 0, gaps: 0, syncAsks: 0, fulls: 0, firstFull: [] }
  const SPEED = 4.5

  class Bot {
    constructor(i, target) {
      this.addr = '0x' + (0xb07000 + i).toString(16).padStart(40, '0')
      this.target = target
      this.joinAt = now + rng() * ramp
      this.connected = false
      this.state = 'offline'
      this.pos = { ...LOBBY, x: LOBBY.x + R(-5, 5) }
      this.yaw = 0
      this.think = 0
      this.posAcc = 0
      this.retry = 0
      this.mirror = new Map()
      this.resetMirror()
    }
    resetMirror() { this.mirror.clear(); this.lastSeq = -1; this.wantSync = false; this.fullSet = null; this.sinceAsk = Infinity; this.enteredAt = 0; this.goal = null; this.grabWait = 0 }
    send(name, data) { toServer(this.addr, name, data) }
    connect() {
      this.connected = true
      this.entity = engine.addEntity()
      PlayerIdentityData.create(this.entity, { address: this.addr })
      AvatarBase.create(this.entity, { name: 'Bot' + this.addr.slice(-3) })
      Transform.create(this.entity, { position: { ...this.pos }, rotation: { x: 0, y: 0, z: 0, w: 1 } })
      this.send('join', { n: 0 })
      this.connectAt = now
      this.state = this.target >= 0 ? 'pad' : 'lobby'
    }
    receive(name, m) {
      if (name === 'entered') {
        if (m.ok === 1 && m.game === this.target) {
          this.state = 'loading'
          this.loadLeft = R(1, 3) // the client builds the arena before teleporting
        } else if (this.state === 'asking') { this.state = 'pad'; this.retry = 10 }
        return
      }
      if (name === 'eject') { this.goLobby(); return }
      if (this.state !== 'playing') return
      if (name === 'cubeState' && m.g === this.target) {
        if (m.full === 1) {
          if (!this.fullSet) this.fullSet = new Set()
          this.apply(m)
          if (m.end === 1) {
            for (const id of Array.from(this.mirror.keys())) if (!this.fullSet.has(id)) this.mirror.delete(id)
            this.fullSet = null
            if (this.lastSeq < 0) sync.firstFull.push(now - this.enteredAt)
            this.lastSeq = m.s
            this.wantSync = false
            sync.fulls++
          }
          return
        }
        for (const id of m.gone) this.mirror.delete(id)
        this.apply(m)
        if (this.lastSeq >= 0 && m.s !== this.lastSeq + 1) { this.wantSync = true; sync.gaps++ }
        if (this.lastSeq >= 0) this.lastSeq = m.s
      } else if (name === 'cubeMoves' && m.g === this.target) {
        if (this.lastSeq >= 0 && m.s !== this.lastSeq && !this.wantSync) { this.wantSync = true; sync.gaps++ }
        const d = m.d
        for (let i = 0; i + MOVE_FIELDS <= d.length; i += MOVE_FIELDS) {
          const c = this.mirror.get(d[i])
          if (c) c.pos = { x: m.o.x + unpackPos(d[i + 1]), y: m.o.y + unpackPos(d[i + 2]), z: m.o.z + unpackPos(d[i + 3]) }
        }
      }
    }
    apply(m) {
      const holders = m.holders ? m.holders.split(',') : []
      const d = m.d
      for (let i = 0; i + STATE_FIELDS <= d.length; i += STATE_FIELDS) {
        const id = d[i]
        this.fullSet?.add(id)
        this.mirror.set(id, {
          letter: unpackLetter(d[i + 1]), mode: unpackMode(d[i + 2]).mode, slot: d[i + 3], holder: d[i + 4] >= 0 ? holders[d[i + 4]] ?? '' : '',
          pos: { x: m.o.x + unpackPos(d[i + 5]), y: m.o.y + unpackPos(d[i + 6]), z: m.o.z + unpackPos(d[i + 7]) }
        })
      }
    }
    goLobby() {
      if (this.state === 'playing') this.send('leave', { n: 0 })
      this.pos = { ...LOBBY, x: LOBBY.x + R(-5, 5) }
      this.state = this.target >= 0 ? 'pad' : 'lobby'
      this.retry = 10
      this.resetMirror()
    }
    held() {
      for (const [id, c] of this.mirror) if (c.mode === 'held' && c.holder === this.addr) return [id, c]
      return null
    }
    step(dt) {
      if (!this.connected) { if (now >= this.joinAt) this.connect(); else return }
      const g = this.target >= 0 ? GameState.get(games[this.target].stateEntity) : null
      if (this.state === 'pad') {
        this.retry -= dt
        if (this.retry > 0) return
        const startAt = Number(g.startAt)
        const running = g.active !== 0 && g.players > 0
        if (running) { this.state = 'asking'; this.askIn = C.JOIN_COUNTDOWN_SECONDS; return }
        if (startAt === 0) { this.send('start', { game: this.target, lang: ['en', 'es', 'pt'][this.target % 3] }); this.retry = 1; return }
        if (now >= startAt) { this.state = 'asking'; this.askIn = 0; return }
        return
      }
      if (this.state === 'asking') {
        if (this.askIn !== null) {
          this.askIn -= dt
          if (this.askIn <= 0) { this.send('enter', { game: this.target }); this.askIn = null; this.askTimeout = 5 }
          return
        }
        this.askTimeout -= dt
        if (this.askTimeout <= 0) { this.state = 'pad'; this.retry = 3 }
        return
      }
      if (this.state === 'loading') {
        this.loadLeft -= dt
        if (this.loadLeft > 0) return
        const o = env.envOrigin(this.target), a = rng() * Math.PI * 2
        this.pos = { x: o.x + Math.cos(a) * C.GAME_SPAWN_RADIUS, y: o.y + C.FLOOR_Y, z: o.z + Math.sin(a) * C.GAME_SPAWN_RADIUS }
        this.state = 'playing'
        this.resetMirror()
        this.enteredAt = now
        this.wantSync = true
        return
      }
      if (this.state !== 'playing') return
      // cubeNetSystem: ask for the full state when needed, at most once per CUBE_SYNC_COOLDOWN
      this.sinceAsk += dt
      if ((this.wantSync || this.lastSeq < 0) && this.sinceAsk >= C.CUBE_SYNC_COOLDOWN) { this.sinceAsk = 0; sync.syncAsks++; this.send('cubeSync', { game: this.target }) }
      this.walk(dt)
      this.think -= dt
      if (this.think > 0) return
      this.think = R(0.3, 0.9)
      this.decide(g)
    }
    walk(dt) {
      const o = env.envOrigin(this.target)
      if (!this.goal) return
      const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z
      const d = Math.hypot(dx, dz)
      if (d > 0.05) {
        const s = Math.min(d, SPEED * dt)
        this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s
        this.yaw = Math.atan2(dx, dz)
      }
      // keep off the answer platform and inside the walls
      const rx = this.pos.x - o.x, rz = this.pos.z - o.z, r = Math.hypot(rx, rz)
      const min = C.STAGE_RADIUS + 0.8, max = C.ARENA_RADIUS - 0.8
      if (r < min || r > max) { const k = (r < min ? min : max) / (r || 1); this.pos.x = o.x + rx * k; this.pos.z = o.z + rz * k }
    }
    decide(g) {
      if (g.phase === 'vote') { if (!this.voted) { this.voted = true; this.send('vote', { choice: Math.floor(R(-1, 2)) }) } return }
      this.voted = false
      if (g.phase !== 'playing' || this.lastSeq < 0) return
      const answer = oracle.get(g.question) ?? ''
      const open = []
      for (let i = 0; i < g.masked.length; i++) if (g.masked[i] === '_') open.push(i)
      const busy = new Set()
      for (const c of this.mirror.values()) if (c.mode === 'flying' || c.mode === 'placed') busy.add(c.slot)
      const held = this.held()
      if (held) {
        const [, c] = held
        this.grabWait = 0
        if (rng() < opt.chaos && open.length) return this.send('place', { slot: open[Math.floor(rng() * open.length)] }) // a mistake
        const slot = open.find((i) => !busy.has(i) && (answer[i] === c.letter || c.letter === '*'))
        if (slot !== undefined) return this.send('place', { slot })
        if (!answer.includes(c.letter)) return this.send('breakCube', { n: 0 })
        return this.send('toss', { n: 0 })
      }
      if (this.grabWait > 0) { this.grabWait--; return } // waiting for the server to confirm a grab
      const needed = new Set(open.filter((i) => !busy.has(i)).map((i) => answer[i]))
      const o = env.envOrigin(this.target)
      let best = null, bestD = Infinity
      for (const [id, c] of this.mirror) {
        if (c.mode !== 'free' || c.pos.y > o.y + 1.4) continue
        const d = Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z) + (needed.has(c.letter) ? 0 : 6) + rng() * 3
        if (d < bestD) { bestD = d; best = [id, c] }
      }
      if (!best) { this.goal = { x: o.x + R(-12, 12), z: o.z + R(-12, 12) }; return }
      const [id, c] = best
      const dist = Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z)
      if (dist < 1.4) { this.goal = null; this.grabWait = 3; return this.send('grab', { cubeId: id }) }
      this.goal = { x: c.pos.x, z: c.pos.z }
    }
    publishPos(dt) { // the server sees avatar positions ~10 times a second
      if (!this.connected) return
      this.posAcc += dt
      if (this.posAcc < 0.1) return
      this.posAcc = 0
      const t = Transform.get(this.entity)
      t.position = { x: this.pos.x, y: this.pos.y, z: this.pos.z }
      t.rotation = Quaternion.fromEulerDegrees(0, (this.yaw * 180) / Math.PI, 0)
    }
  }
  plan.forEach((target, i) => { const b = new Bot(i, target); bots.push(b); botBy.set(b.addr, b) })

  // A bot's mirror against the server's truth. A difference that lasts is a desync. A cube that is moving on the
  // server is always a little behind on the clients (latency + send interval): that is measured as lag, not desync.
  function checkSync() {
    const seen = new Set()
    const mark = (key, kind) => { sync.mismatched++; sync[kind]++; seen.add(key); const o = sync.open.get(key); if (o) o.last = now; else sync.open.set(key, { since: now, last: now, kind }) }
    for (const b of bots) {
      if (b.state !== 'playing' || b.lastSeq < 0 || now - b.enteredAt < 2000) continue // a client waiting for a resync still shows its stale cubes: count them
      const gm = games[b.target]
      for (const [id, cube] of gm.cubes) {
        sync.checks++
        const m = b.mirror.get(id)
        const key = b.addr + ':' + id
        if (!m) { mark(key, 'missing'); continue }
        if (m.mode !== cube.mode) { mark(key, 'mode'); continue }
        if (cube.mode !== 'free') continue
        const p = Transform.get(cube.entity).position
        const err = Math.hypot(m.pos.x - p.x, m.pos.y - p.y, m.pos.z - p.z)
        if (!cube.body.asleep) { sync.lag[Math.min(100, Math.floor(err * 20))]++; sync.lagN++; sync.lagSum += err; continue }
        if (err > 0.5) mark(key, 'pos')
      }
      for (const id of b.mirror.keys()) if (!gm.cubes.has(id)) { sync.checks++; mark(b.addr + ':' + id, 'extra') }
    }
    for (const [key, o] of sync.open) if (!seen.has(key)) { sync.durations.push({ ms: o.last - o.since, kind: o.kind }); sync.open.delete(key) }
  }

  // ---------- main loop ----------
  const DT = 1 / 30
  const ticks = Math.round(opt.seconds / DT)
  const tickMs = [], secSends = [], secBytes = []
  let secAcc = 0, secDeliveries = 0, secBytesAcc = 0, lastCrdt = 0, maxCrdtPerSec = 0, maxCubes = 0, maxAwake = 0
  const perBotSec = []
  return (async () => {
    for (let t = 0; t < ticks; t++) {
      now += DT * 1000
      for (const b of bots) b.step(DT)
      for (const b of bots) b.publishPos(DT)
      handlerMs = 0
      runTimers() // network deliveries and Storage replies due by now (client -> server handlers run here)
      const t0 = performance.now()
      serverTick(DT)
      const total = performance.now() - t0 + handlerMs
      tickMs.push(total)
      cost.pile += tickPile; cost.play += tickPlay
      cost.maxPiles = Math.max(cost.maxPiles, pilesNow)
      if (total > 33) cost.spikes[tickPile > total / 2 ? 'pile' : tickPlay > total / 2 ? 'play' : 'other']++
      tickPile = 0; tickPlay = 0; pilesNow = 0
      const d0 = net.deliveries, b0 = net.bytes
      flushOutbox()
      secDeliveries += net.deliveries - d0
      secBytesAcc += net.bytes - b0
      await new Promise((r) => setImmediate(r)) // let Storage promises settle
      if (t % 6 === 0) checkSync() // every 0.2 s
      let cubes = 0, awake = 0
      for (const gm of games) { cubes += gm.cubes.size; for (const c of gm.cubes.values()) if (c.mode === 'free' && !c.body.asleep) awake++ }
      maxCubes = Math.max(maxCubes, cubes); maxAwake = Math.max(maxAwake, awake)
      secAcc += DT
      if (secAcc >= 1) {
        secAcc = 0
        secSends.push(secDeliveries); secBytes.push(secBytesAcc)
        secDeliveries = 0; secBytesAcc = 0
        maxCrdtPerSec = Math.max(maxCrdtPerSec, crdt.writes - lastCrdt); lastCrdt = crdt.writes
        const vals = bots.filter((b) => b.state === 'playing').map((b) => net.perBot.get(b.addr) ?? 0)
        for (const b of bots) if (b.connected && b.profileAt === undefined && profiles.profileOf(b.addr)) b.profileAt = now
        if (vals.length) perBotSec.push(vals.reduce((m, x) => (x > m ? x : m), 0))
        net.perBot.clear()
      }
    }
    const sorted = tickMs.slice().sort((a, b) => a - b)
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
    const mx = (a) => a.reduce((m, x) => (x > m ? x : m), 0)
    const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
    const durK = sync.durations.concat(Array.from(sync.open.values()).map((o) => ({ ms: o.last - o.since, kind: o.kind })))
    const dur = durK.map((d) => d.ms)
    let lagP95 = 0
    for (let i = 0, acc = 0; i <= 100; i++) { acc += sync.lag[i]; if (acc >= sync.lagN * 0.95) { lagP95 = (i + 1) / 20; break } }
    const longBy = {}
    for (const d of durK) if (d.ms > 1000) longBy[d.kind] = (longBy[d.kind] ?? 0) + 1
    const waits = bots.filter((b) => b.profileAt !== undefined).map((b) => b.profileAt - b.connectAt)
    const noProfile = bots.filter((b) => b.connected && !profiles.profileOf(b.addr)).length
    const seated = games.reduce((s, gm) => s + gm.seats.size, 0)
    return {
      name, desc: sc.desc, bots: bots.length, seated, seatsPerGame: games.map((gm) => gm.seats.size),
      cpu: { avg: avg(tickMs), p50: pct(50), p95: pct(95), p99: pct(99), max: sorted[sorted.length - 1], over33: tickMs.filter((x) => x > 33).length, ticks: tickMs.length, cost },
      maxCubes, maxAwake,
      net: {
        maxTickSends: net.maxTickSends, droppedCap: net.droppedCap, droppedSize: net.droppedSize, lost: net.lost, maxMsg: net.maxMsg, maxMsgName: net.maxMsgName,
        deliveriesPerSec: avg(secSends), kbPerSec: avg(secBytes) / 1024, peakKbPerSec: mx(secBytes) / 1024,
        clientKbPerSecMax: mx(perBotSec) / 1024, clientKbPerSecAvg: avg(perBotSec) / 1024, maxInboundPerPeer: net.maxInbound,
        byName: Array.from(net.byName.entries()).map(([n, s]) => ({ name: n, perSec: s.n / opt.seconds, kbPerSec: s.b / opt.seconds / 1024 })).sort((a, b) => b.kbPerSec - a.kbPerSec)
      },
      crdtWritesPerSecMax: maxCrdtPerSec,
      storage: { maxInflight: st.maxInflight, rejected: st.rejected, calls: st.calls, profileReadFailed: logs.profileReadFailed, noProfile, waitAvg: avg(waits), waitMax: mx(waits) },
      rounds: { won: logs.roundsWon, timeout: logs.roundsTimeout }, seats: { granted: logs.seatsGranted, full: logs.seatsFull },
      sync: {
        checks: sync.checks, mismatchPct: sync.checks ? (100 * sync.mismatched) / sync.checks : 0, missing: sync.missing, extra: sync.extra, mode: sync.mode, pos: sync.pos,
        over1s: dur.filter((d) => d > 1000).length, longBy, lagAvg: sync.lagN ? sync.lagSum / sync.lagN : 0, lagP95, over3s: dur.filter((d) => d > 3000).length, over6s: dur.filter((d) => d > 6000).length, maxMs: mx(dur),
        gaps: sync.gaps, syncAsks: sync.syncAsks, fulls: sync.fulls, firstFullAvgMs: avg(sync.firstFull), firstFullMaxMs: mx(sync.firstFull)
      },
      errors: logs.errors.slice(0, 5)
    }
  })()
}

// ---------- report ----------
const f1 = (x) => (Math.round(x * 10) / 10).toString()
const flag = (bad, warn) => (bad ? '❌' : warn ? '⚠️ ' : '✅')
function report(r, opt) {
  const L = []
  L.push(`\n━━ ${r.name} — ${r.desc}`)
  L.push(`   bots ${r.bots} · sentados ${r.seated} [${r.seatsPerGame.join(' ')}] · asientos otorgados ${r.seats.granted}, rechazados (sala llena) ${r.seats.full}`)
  L.push(`   rondas ganadas ${r.rounds.won} · por tiempo ${r.rounds.timeout} · cubos vivos máx ${r.maxCubes} · despiertos máx ${r.maxAwake}`)
  L.push(`${flag(r.cpu.p99 > 33, r.cpu.p99 > 15)} CPU por tick (presupuesto 33 ms @30 Hz): prom ${f1(r.cpu.avg)} · p50 ${f1(r.cpu.p50)} · p95 ${f1(r.cpu.p95)} · p99 ${f1(r.cpu.p99)} · máx ${f1(r.cpu.max)} ms · ticks >33 ms: ${r.cpu.over33}/${r.cpu.ticks}`)
  const c = r.cpu.cost
  L.push(`   picos >33 ms por causa: ronda nueva ${c.spikes.pile} · física/juego normal ${c.spikes.play} · otro ${c.spikes.other} · salas arrancando ronda en el mismo tick (máx) ${c.maxPiles}`)
  L.push(`${flag(r.net.droppedCap > 0, r.net.maxTickSends > 256)} Envíos por tick: máx ${r.net.maxTickSends} (cap 512) · descartados por cap ${r.net.droppedCap}`)
  L.push(`${flag(r.net.droppedSize > 0, r.net.maxMsg > 10 * 1024)} Mensaje más grande: ${f1(r.net.maxMsg / 1024)} KB (${r.net.maxMsgName}) · descartados >13 KB: ${r.net.droppedSize}`)
  L.push(`   Salida total: ${f1(r.net.kbPerSec)} KB/s prom · pico ${f1(r.net.peakKbPerSec)} KB/s · ${Math.round(r.net.deliveriesPerSec)} entregas/s`)
  L.push(`${flag(r.net.clientKbPerSecMax > 200, r.net.clientKbPerSecMax > 60)} Bajada por cliente en partida: prom ${f1(r.net.clientKbPerSecAvg)} KB/s · peor segundo ${f1(r.net.clientKbPerSecMax)} KB/s`)
  L.push(`${flag(r.net.maxInboundPerPeer > 300, r.net.maxInboundPerPeer > 100)} Subida máx por jugador: ${r.net.maxInboundPerPeer} msg/s (cap 300)`)
  L.push(`   Escrituras CRDT (GameState/Ranks, a TODA la escena): máx ${r.crdtWritesPerSecMax}/s`)
  const st = r.storage
  L.push(`${flag(st.noProfile > 0 || st.rejected > 0, st.maxInflight > 30 || st.waitMax > 5000)} Storage: en vuelo máx ${st.maxInflight} (cap 40) · rechazadas ${st.rejected} · lecturas de perfil fallidas (se reintentan) ${st.profileReadFailed}`)
  L.push(`   perfil cargado tras conectar: prom ${f1(st.waitAvg / 1000)} s · máx ${f1(st.waitMax / 1000)} s · jugadores sin perfil al final: ${st.noProfile}`)
  const s = r.sync
  L.push(`${flag(s.over6s > 0, s.over3s > 0)} Sync de cubos: ${f1(s.mismatchPct)}% de chequeos con diferencia (faltan ${s.missing}, sobran ${s.extra}, modo ${s.mode}, en reposo desplazado >0.5 m ${s.pos})`)
  L.push(`   lag de cubos en movimiento: prom ${f1(s.lagAvg)} m · p95 ${f1(s.lagP95)} m (latencia + envío cada 1/15 s; no es desync)`)
  L.push(`   diferencias que duraron >1 s: ${s.over1s} · >3 s: ${s.over3s} · >6 s: ${s.over6s} · la más larga ${f1(s.maxMs / 1000)} s` + (s.over1s ? ` · por tipo >1 s: ${JSON.stringify(s.longBy)}` : ''))
  L.push(`   huecos de secuencia ${s.gaps} · pedidos cubeSync ${s.syncAsks} · estados completos ${s.fulls} · primer estado tras entrar: prom ${Math.round(s.firstFullAvgMs)} ms, máx ${Math.round(s.firstFullMaxMs)} ms`)
  L.push(`   Top mensajes: ` + r.net.byName.slice(0, 5).map((m) => `${m.name} ${f1(m.kbPerSec)} KB/s`).join(' · '))
  if (r.errors.length) L.push(`   console.error: ${r.errors.join(' | ')}`)
  return L.join('\n')
}

async function main() {
  const opt = parseArgs(process.argv)
  if (opt.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 18).join('\n')); return }
  let list
  if (opt.rooms) list = [['custom', { desc: 'Personalizado', rooms: opt.rooms, lobby: opt.lobby ?? 0, overflow: opt.overflow ?? 0 }]]
  else if (opt.scenario === 'all') list = Object.entries(SCENARIOS)
  else if (SCENARIOS[opt.scenario]) list = [[opt.scenario, SCENARIOS[opt.scenario]]]
  else throw new Error(`unknown scenario ${opt.scenario}; one of: ${Object.keys(SCENARIOS).join(', ')}`)
  console.log(`Stress test del server · ${opt.seconds} s simulados por escenario · latencia ${opt.latency}±${opt.jitter} ms · pérdida ${opt.loss}% · Storage ~${opt.storageMs} ms · semilla ${opt.seed}`)
  const results = []
  for (const [name, sc] of list) {
    const t0 = Date.now()
    const r = await runScenario(name, sc, { ...opt, ramp: sc.ramp ?? (opt.ramp ?? 8) })
    results.push(r)
    console.log(report(r, opt) + `\n   (simulado en ${f1((Date.now() - t0) / 1000)} s reales)`)
  }
  if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(results, null, 2))
}
main().catch((e) => { console.error(e); process.exit(1) })
