// One game: its own arena (GameEnv_N), cube pile, physics world, round, vote and the players seated in it.
// Up to GAME_COUNT run side by side; server.ts creates them and routes each player's messages to their game.
import { engine, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import * as C from '../config'
import { pickWord } from './words'
import { profileOf, touch, ratingDelta } from './profiles'
import { room } from '../shared/messages'
import { envOrigin, arenaAt } from '../shared/env'
import { CubeData, GameState, protectServerEntity, modelFor } from '../shared/schemas'
import { worldParams, syncEnvParams } from '../shared/world'
import { PusherTracker } from '../shared/pushers'
import { createWorld, addBody, removeBody, clearBodies, step, applyImpulse, wake, wakeNear, setPushers } from '../sim/physics'
import type { Body, Pusher } from '../sim/physics'
import { players, playerOf, coinsOf, sendProfile, giveCoins, rand, handPos, inLobby } from './common'
import type { PlayerInfo } from './common'

type Mode = 'free' | 'held' | 'flying' | 'placed'

interface SCube {
  id: number
  letter: string
  entity: Entity
  body: Body
  mode: Mode
  slot: number
  holder: string
  placer: string // who threw it at a frame; stays set while it is locked in, cleared when it drops back into the pile
  sentAsleep: boolean
  breakReward: boolean // rerolls and replacement supply cannot mint more break coins
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SIM_DT = 1 / 30
const FLIGHT_TOTAL = C.THROW_RELEASE_DELAY + C.THROW_FLIGHT_TIME
const SPAWN_PER_TICK = 40
const PARK_Y = -30
const IDLE_SHUTDOWN_SECONDS = 5 // an empty game stays set up this long, then clears its pile and goes idle

// Cube ids are global so they stay unique across games (clients send them back in 'grab' and 'settle').
let nextCubeId = 1

export interface GameHost {
  onRating(address: string, rating: number): void // a player's rating changed (leaderboard)
}

export function createGame(index: number, stateEntity: Entity, host: GameHost) {
  const fallbackDrop = (): Vector3 => {
    const o = envOrigin(index)
    return Vector3.create(o.x + 8, o.y + 2, o.z)
  }

  const world = createWorld(worldParams()) // local params; syncEnvParams() moves them onto this game's GameEnv

  const cubes = new Map<number, SCube>()
  let active = false // false: nobody is playing, no cubes exist, the state shows an idle game
  let emptyFor = 0
  // Seats: who may play here. Granted at the pad ('enter'), kept while the player is in the arena.
  const seats = new Map<string, { until: number; arrived: boolean; outside: number }>()
  let answer = ''
  let slots: (SCube | null)[] = []
  let hintsUsed = 0
  const hintCost = () => C.HINT_BASE_COST + C.HINT_COST_STEP * hintsUsed
  let phase: 'playing' | 'won' | 'timeout' | 'vote' = 'playing'
  let voteLeft = 0
  let lastVoteShown = -1
  const votes = new Map<string, number>() // address -> -1 easier, 0 same, 1 harder
  let difficulty = C.START_DIFFICULTY
  let timeLeft = 0
  let lastTimeShown = -1
  let round = 0
  let completed = 0
  let lastWord = ''
  let nextRoundIn = 0
  let spawnQueue: { letter: string; breakReward: boolean }[] = []
  const holders = new Map<string, SCube>()
  const lockedUntil = new Map<string, number>() // address -> clock time when placing is allowed again
  // Who took part in this round: locked in at least one correct cube (even one a later collapse knocked out).
  const participants = new Set<string>()
  let wildcardUsed = false // one wildcard per round, in the whole game
  let freezeLeft = 0 // seconds of Time Freeze left
  const itemReady = new Map<string, number>() // address -> clock time their next power-up is ready
  const lastPos = new Map<string, Vector3>()
  const pendingToss: { cube: SCube; t: number; addr: string }[] = []
  // settle reports: each player's recent path, and when each cube last took a report
  let clock = 0
  const trails = new Map<string, { x: number; y: number; z: number; t: number }[]>()
  const lastSettle = new Map<number, number>()
  const flights: { cube: SCube; t: number }[] = []
  let simAcc = 0
  let sendAcc = 0
  const pusherTracker = new PusherTracker()

  // ---------- helpers ----------

  const inThisArena = (p: PlayerInfo) => arenaAt(p.pos.x, p.pos.y, p.pos.z) === index

  // Seated players standing in the arena. The round timer and the vote only run while someone is playing.
  function arenaPlayers(): PlayerInfo[] {
    return players().filter((p) => seats.has(p.address) && inThisArena(p))
  }

  const members = () => Array.from(seats.keys())

  // Messages for the game only reach its seated players.
  function bcast(name: 'fx' | 'burst' | 'toast', data: any, to: string[] = members()) {
    if (to.length === 0) return
    ;(room as any).send(name, data, { to })
  }

  function toast(text: string, to?: string) {
    bcast('toast', { text }, to ? [to] : members())
  }

  // Server-side gate shared by actions that could disrupt the ongoing word. Tossing one's held cube stays available.
  function canPlay(address: string): boolean {
    if (phase !== 'playing' || !arenaPlayers().some((p) => p.address === address)) return false
    const wait = (lockedUntil.get(address) ?? 0) - clock
    if (wait <= 0) return true
    toast(`Locked out: ${Math.ceil(wait)}s left. You can still throw your held cube away.`, address)
    return false
  }

  // Re-read this game's GameEnv every tick so moving it in the editor moves the whole sim (floor, platform, centre).
  function syncEnv() {
    syncEnvParams(world.params, index)
  }

  function slotPos(i: number): Vector3 {
    const offset = (i - (slots.length - 1) / 2) * C.SLOT_SPACING
    const o = envOrigin(index)
    return Vector3.create(o.x + offset, o.y + C.SLOT_Y, o.z)
  }

  function recordTrail(address: string, pos: Vector3) {
    let trail = trails.get(address)
    if (!trail) {
      trail = []
      trails.set(address, trail)
    }
    const last = trail[trail.length - 1]
    if (!last || last.x !== pos.x || last.y !== pos.y || last.z !== pos.z) trail.push({ x: pos.x, y: pos.y, z: pos.z, t: clock })
    while (trail.length > 1 && clock - trail[0].t > C.SETTLE_TOUCH_WINDOW) trail.shift()
  }

  // Did this player's recent path (segments between the positions the server saw, up to where they are now) pass
  // within touching distance of the cube's current server position?
  function touchedRecently(address: string, b: Body, now: Vector3): boolean {
    const reach = C.PLAYER_RADIUS + C.CUBE_RADIUS + C.SETTLE_TOUCH_SLACK
    const points = [...(trails.get(address) ?? []), now]
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)]
      const c = points[i]
      const minY = Math.min(a.y, c.y)
      const maxY = Math.max(a.y, c.y)
      if (b.y + C.CUBE_HALF < minY - C.SETTLE_TOUCH_SLACK || b.y - C.CUBE_HALF > maxY + C.PLAYER_HEIGHT + C.SETTLE_TOUCH_SLACK) continue
      const sx = c.x - a.x
      const sz = c.z - a.z
      const len2 = sx * sx + sz * sz
      const u = len2 > 0 ? Math.max(0, Math.min(1, ((b.x - a.x) * sx + (b.z - a.z) * sz) / len2)) : 0
      const dx = b.x - (a.x + sx * u)
      const dz = b.z - (a.z + sz * u)
      if (dx * dx + dz * dz <= reach * reach) return true
    }
    return false
  }

  function sync(cube: SCube) {
    const d = CubeData.getMutable(cube.entity)
    d.mode = cube.mode
    d.slot = cube.slot
    d.holder = cube.holder
  }

  function park(cube: SCube) {
    Transform.getMutable(cube.entity).position = Vector3.create(cube.body.x, PARK_Y, cube.body.z)
  }

  function writeTransform(cube: SCube) {
    const t = Transform.getMutable(cube.entity)
    t.position = Vector3.create(cube.body.x, cube.body.y, cube.body.z)
    t.rotation = Quaternion.fromEulerDegrees(0, (cube.body.yaw * 180) / Math.PI, 0)
  }

  function updateGameState() {
    const g = GameState.getMutable(stateEntity)
    g.active = active ? 1 : 0
    g.phase = phase
    g.round = round
    g.difficulty = difficulty
    g.completed = completed
    g.length = answer.length
    g.masked = answer
      .split('')
      .map((_, i) => (slots[i] && slots[i]!.mode === 'placed' ? answer[i] : '_'))
      .join('')
    // a timed-out round shows the answer in the empty frames; otherwise only the letters the hints gave away
    g.hintCost = hintsUsed < answer.length - 1 ? hintCost() : 0
    g.hint = phase === 'timeout' ? answer : hintsUsed > 0 ? answer.split('').map((c, i) => (i < hintsUsed ? c : '_')).join('') : ''
  }

  // ---------- cubes, rounds, items, vote ----------
  // ---------- cubes ----------

  function spawnCube(letter: string, x: number, y: number, z: number, breakReward = false): SCube {
    const entity = engine.addEntity()
    const body = addBody(world, x, y, z)
    const id = nextCubeId++
    Transform.create(entity, {
      position: Vector3.create(x, y, z),
      rotation: Quaternion.fromEulerDegrees(0, (body.yaw * 180) / Math.PI, 0),
      scale: Vector3.scale(Vector3.One(), C.CUBE_SCALE)
    })
    // No collider on the synced cube: each client adds its own click target (cubes.ts), which it can move onto its
    // locally predicted copy. A server-side pointer collider would stay at the server position and steal clicks.
    GltfContainer.create(entity, { src: modelFor(letter), invisibleMeshesCollisionMask: ColliderLayer.CL_NONE, visibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    CubeData.create(entity, { game: index, id, letter, mode: 'free', slot: -1, holder: '' })
    protectServerEntity(entity, [Transform, GltfContainer])
    syncEntity(entity, [Transform.componentId, GltfContainer.componentId, CubeData.componentId])
    const cube: SCube = { id, letter, entity, body, mode: 'free', slot: -1, holder: '', placer: '', sentAsleep: false, breakReward }
    cubes.set(id, cube)
    return cube
  }

  function removeCube(cube: SCube) {
    removeBody(world, cube.body)
    cubes.delete(cube.id)
    lastSettle.delete(cube.id)
    engine.removeEntity(cube.entity)
  }

  // Put a cube back into the physics pile at a position with an impulse.
  function release(cube: SCube, pos: Vector3, vx: number, vy: number, vz: number) {
    cube.body.x = pos.x
    cube.body.y = pos.y
    cube.body.z = pos.z
    cube.body.vx = cube.body.vy = cube.body.vz = 0
    cube.body.active = true
    wake(cube.body)
    cube.mode = 'free'
    cube.slot = -1
    cube.holder = ''
    cube.placer = ''
    cube.sentAsleep = false
    applyImpulse(cube.body, vx, vy, vz)
    writeTransform(cube)
    sync(cube)
  }

  // ---------- rounds ----------

  function startRound(message = 'New round! Find the letters.') {
    for (const cube of Array.from(cubes.values())) removeCube(cube)
    clearBodies(world)
    holders.clear()
    pendingToss.length = 0
    flights.length = 0

    const level = C.LEVELS[difficulty - 1]
    const entry = pickWord(difficulty, lastWord)
    lastWord = entry.answer
    timeLeft = level.seconds
    lastTimeShown = -1
    answer = entry.answer
    slots = new Array(answer.length).fill(null)
    hintsUsed = 0
    participants.clear()
    wildcardUsed = false
    freezeLeft = 0
    GameState.getMutable(stateEntity).builders = 0
    GameState.getMutable(stateEntity).frozen = 0
    phase = 'playing'
    round++

    const g = GameState.getMutable(stateEntity)
    g.question = entry.question
    g.timeLeft = timeLeft
    updateGameState()

    const letters = answer.split('')
    while (letters.length < C.CUBES_PER_ROUND) letters.push(LETTERS[Math.floor(Math.random() * LETTERS.length)])
    // shuffled so the word's letters don't all land first
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[letters[i], letters[j]] = [letters[j], letters[i]]
    }
    spawnQueue = letters.map((letter) => ({ letter, breakReward: true }))
    toast(message)
  }

  function spawnInHeap(letter: string, breakReward = false) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(rand(C.SPAWN_MIN_RADIUS ** 2, C.SPAWN_MAX_RADIUS ** 2))
    const o = envOrigin(index)
    spawnCube(letter, o.x + Math.cos(a) * r, o.y + rand(C.SPAWN_MIN_Y, C.SPAWN_MAX_Y), o.z + Math.sin(a) * r, breakReward)
  }

  function spawnSome() {
    for (let n = 0; n < SPAWN_PER_TICK && spawnQueue.length > 0; n++) {
      const cube = spawnQueue.pop()!
      spawnInHeap(cube.letter, cube.breakReward)
    }
  }

  // The pile can never become unsolvable: for every letter the word still needs there must be at least that many cubes
  // that are not locked in yet (in the pile, in a hand, in flight, or still queued to spawn). A broken needed cube is replaced.
  function ensureSupply() {
    if (phase !== 'playing') return
    const have = new Map<string, number>()
    const need = new Map<string, number>()
    for (const cube of cubes.values()) if (cube.mode !== 'placed') have.set(cube.letter, (have.get(cube.letter) ?? 0) + 1)
    for (const { letter } of spawnQueue) have.set(letter, (have.get(letter) ?? 0) + 1)
    for (let i = 0; i < answer.length; i++) {
      if (slots[i] && slots[i]!.mode === 'placed') continue
      need.set(answer[i], (need.get(answer[i]) ?? 0) + 1)
    }
    for (const [letter, count] of need) {
      for (let k = have.get(letter) ?? 0; k < count; k++) spawnInHeap(letter)
    }
  }

  // keepWildcards: a collapse leaves wildcard boxes in their frames; the end of a round lets everything go.
  function clearPlaced(keepWildcards: boolean) {
    for (let i = 0; i < slots.length; i++) {
      const cube = slots[i]
      if (!cube) continue
      if (keepWildcards && cube.letter === '*') continue
      const idx = flights.findIndex((f) => f.cube === cube)
      if (idx >= 0) flights.splice(idx, 1)
      release(cube, slotPos(i), rand(-3, 3), rand(0, 3), rand(-3, 3))
      slots[i] = null
    }
  }

  function collapse(causedBy: string) {
    clearPlaced(true)
    updateGameState()
    bcast('fx', { kind: 'fail', slot: -1 })
    toast('Wrong cube! The whole word collapsed.')
    if (causedBy) {
      lockedUntil.set(causedBy, clock + C.COLLAPSE_LOCKOUT_SECONDS)
      room.send('lockout', { seconds: C.COLLAPSE_LOCKOUT_SECONDS }, { to: [causedBy] })
      const held = holders.get(causedBy)
      if (held) {
        holders.delete(causedBy)
        release(held, playerOf(causedBy)?.pos ?? fallbackDrop(), 0, 0, 0)
      }
      toast(`You collapsed the word. Cube actions and power-ups are locked for ${C.COLLAPSE_LOCKOUT_SECONDS}s.`, causedBy)
    }
  }

  // The timer ran out: the word falls, the answer is shown and the next round follows after the usual pause.
  function timeUp() {
    phase = 'timeout'
    nextRoundIn = C.NEXT_ROUND_DELAY
    flights.length = 0
    clearPlaced(false)
    updateGameState()
    bcast('fx', { kind: 'fail', slot: -1 })
    const deltas = settleRound(false, Array.from(participants))
    for (const [addr, delta] of deltas) room.send('result', { coins: 0, delta }, { to: [addr] })
    toast(`Time's up! The word was ${answer}`)
    console.log('[ROUND]', 'timeout', answer, 'level', difficulty, 'participants', Array.from(participants).join(','))
  }

  // Who gets the points for a finished word: the players whose cubes are in the final standing word, each once.
  // Earlier cubes that a collapse knocked out do not count. participants (everyone who locked in a correct cube) is
  // kept for the rating step.
  function finishWord(): string[] {
    const builders = new Set<string>()
    for (const cube of slots) if (cube && cube.placer) builders.add(cube.placer)
    return Array.from(builders)
  }

  // Rating: builders gain after a win, players who took part lose after a timeout. Only players still in the arena count.
  function settleRound(won: boolean, who: string[]): Map<string, number> {
    const out = new Map<string, number>()
    const present = new Set(arenaPlayers().map((p) => p.address))
    for (const addr of who) {
      const p = profileOf(addr)
      if (!p || !present.has(addr)) continue
      const delta = ratingDelta(p.rating, p.rounds, difficulty, won, C.RATING_K, C.RATING_PER_RANK, C.PROVISIONAL_ROUNDS)
      p.rating = Math.max(0, p.rating + delta)
      p.rounds++
      if (won) p.wins++
      touch(addr)
      sendProfile(addr)
      host.onRating(addr, p.rating)
      out.set(addr, delta)
    }
    return out
  }

  function land(cube: SCube) {
    const slot = cube.slot
    if (cube.letter !== '*' && cube.letter !== answer[slot]) {
      collapse(cube.placer)
      return
    }
    cube.mode = 'placed'
    cube.holder = ''
    cube.body.active = false
    if (cube.placer) participants.add(cube.placer)
    park(cube)
    sync(cube)
    bcast('fx', { kind: 'lock', slot })
    if (slots.every((s) => s !== null && s.mode === 'placed')) {
      phase = 'won'
      completed++
      nextRoundIn = C.NEXT_ROUND_DELAY
      const builders = finishWord()
      GameState.getMutable(stateEntity).builders = builders.length
      const deltas = settleRound(true, builders)
      bcast('fx', { kind: 'win', slot: -1 })
      toast(`${answer}! Built by ${builders.length} player${builders.length === 1 ? '' : 's'}`)
      // sent after the group message so each builder's own message is the one they see
      for (const addr of builders) {
        giveCoins(addr, C.COINS_PER_WORD)
        room.send('result', { coins: C.COINS_PER_WORD, delta: deltas.get(addr) ?? 0 }, { to: [addr] })
        toast(`You built ${answer}! +${C.COINS_PER_WORD} coins`, addr)
        const p = profileOf(addr)
        if (p && p.wins >= C.ROUNDS_FOR_REWARD && !p.rewarded) {
          p.rewarded = true
          touch(addr)
          toast('Wearable reward unlocked! (stub: not delivered yet)', addr)
        }
      }
      console.log('[ROUND]', 'won', answer, 'level', difficulty, 'builders', builders.join(','), 'participants', Array.from(participants).join(','))
    }
    updateGameState()
  }

  // ---------- items ----------

  const itemOf = (id: string) => C.ITEMS.find((i) => i.id === id)

  // Fresh pile: the letters the word still needs plus random ones; cubes in hands and frames stay where they are.
  function rerollPile() {
    for (const cube of Array.from(cubes.values())) if (cube.mode === 'free') removeCube(cube)
    const letters: string[] = []
    for (let i = 0; i < answer.length; i++) if (!(slots[i] && slots[i]!.mode === 'placed')) letters.push(answer[i])
    while (letters.length < C.CUBES_PER_ROUND) letters.push(LETTERS[Math.floor(Math.random() * LETTERS.length)])
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[letters[i], letters[j]] = [letters[j], letters[i]]
    }
    spawnQueue = letters.map((letter) => ({ letter, breakReward: false }))
  }

  // Removes the loose letters around the player that the word does not use, and shoves the useful ones away.
  function bombAt(addr: string): boolean {
    const p = playerOf(addr)
    if (!p) return false
    const r2 = C.BOMB_RADIUS * C.BOMB_RADIUS
    const gone: SCube[] = []
    for (const cube of cubes.values()) {
      if (cube.mode !== 'free') continue
      const dx = cube.body.x - p.pos.x
      const dz = cube.body.z - p.pos.z
      const d2 = dx * dx + dz * dz
      if (d2 > r2) continue
      if (answer.includes(cube.letter)) {
        const d = Math.sqrt(d2) || 1
        wake(cube.body)
        applyImpulse(cube.body, (dx / d) * 6, 4, (dz / d) * 6)
      } else gone.push(cube)
    }
    for (const cube of gone) removeCube(cube)
    bcast('burst', { x: p.pos.x, y: p.pos.y + 1, z: p.pos.z, gold: 2 })
    return true
  }

  function giveWildcard(addr: string): boolean {
    const p = playerOf(addr)
    if (!p) return false
    const at = handPos(p)
    const cube = spawnCube('*', at.x, at.y, at.z)
    cube.mode = 'held'
    cube.holder = addr
    cube.body.active = false
    holders.set(addr, cube)
    park(cube)
    sync(cube)
    return true
  }

  // ---------- vote ----------

  function updateVoteState() {
    const present = new Set(arenaPlayers().map((p) => p.address))
    let down = 0
    let same = 0
    let up = 0
    for (const [addr, choice] of votes) {
      if (!present.has(addr)) continue
      if (choice < 0) down++
      else if (choice > 0) up++
      else same++
    }
    const g = GameState.getMutable(stateEntity)
    g.voteDown = down
    g.voteSame = same
    g.voteUp = up
    g.voteLeft = Math.max(0, Math.ceil(voteLeft))
  }

  function startVote() {
    phase = 'vote'
    votes.clear()
    voteLeft = C.VOTE_SECONDS
    lastVoteShown = -1
    updateGameState()
    updateVoteState()
  }

  // Players who did not vote count as "same". The option with the most votes wins, a tie keeps the level.
  function endVote() {
    const present = arenaPlayers()
    let down = 0
    let up = 0
    for (const p of present) {
      const choice = votes.get(p.address) ?? 0
      if (choice < 0) down++
      else if (choice > 0) up++
    }
    const same = present.length - down - up
    let step = 0
    if (up > down && up > same) step = 1
    else if (down > up && down > same) step = -1
    for (const p of present) {
      if (!votes.has(p.address) || !participants.has(p.address)) continue
      giveCoins(p.address, C.VOTE_BONUS_COINS)
    }
    const next = Math.min(C.MAX_DIFFICULTY, Math.max(1, difficulty + step))
    const changed = next !== difficulty
    difficulty = next
    startRound(changed ? `Level ${difficulty} (${step > 0 ? 'harder' : 'easier'})! Find the letters.` : `Level ${difficulty}. Find the letters.`)
  }

  // ---------- messages (called by the server for seated players only) ----------


  function on_grab(data: any, addr: string) {
    if (phase !== 'playing') return
    if (!canPlay(addr)) return
    const cube = cubes.get(data.cubeId)
    if (!cube || cube.mode !== 'free') return
    if (holders.has(addr)) return toast('Hands full. Click a frame to throw it, E to break it or F to throw it away.', addr)
    const p = playerOf(addr)
    if (!p || Vector3.distance(p.pos, Vector3.create(cube.body.x, cube.body.y, cube.body.z)) > C.INTERACT_DISTANCE + 4) return
    wakeNear(world, cube.body.x, cube.body.y, cube.body.z, C.CUBE_RADIUS * 3)
    cube.mode = 'held'
    cube.holder = addr
    cube.body.active = false
    holders.set(addr, cube)
    park(cube)
    sync(cube)
    toast(`Holding ${cube.letter}. Click a frame to throw it, E to break, F to throw away.`, addr)
  }

  function on_place(data: any, addr: string) {
    if (phase !== 'playing') return
    if (!canPlay(addr)) return
    const cube = holders.get(addr)
    if (!cube) return toast('Grab a cube first (click it), then click a frame.', addr)
    if (data.slot < 0 || data.slot >= slots.length || slots[data.slot]) return
    holders.delete(addr)
    slots[data.slot] = cube
    cube.placer = addr
    cube.slot = data.slot
    cube.mode = 'flying'
    sync(cube)
    flights.push({ cube, t: 0 })
  }

  function on_toss(data: any, addr: string) {
    const cube = holders.get(addr)
    if (!cube) return
    holders.delete(addr)
    pendingToss.push({ cube, t: 0, addr })
  }

  function on_breakCube(data: any, addr: string) {
    if (!canPlay(addr)) return
    const cube = holders.get(addr)
    if (!cube) return toast('Nothing to break. Click a cube to grab it first.', addr)
    if (cube.letter === '*') return toast('A wildcard cannot be broken. Place it in a frame or throw it away.', addr)
    if (answer.includes(cube.letter)) return toast('That letter is needed. Place it or throw it back with F.', addr)
    holders.delete(addr)
    const reward = cube.breakReward ? C.COINS_PER_BREAK : 0
    const letter = cube.letter
    const at = playerOf(addr)
    const spot = at ? handPos(at) : Vector3.create(cube.body.x, cube.body.y, cube.body.z)
    bcast('burst', { x: spot.x, y: spot.y, z: spot.z, gold: reward > 0 ? 1 : 0 })
    removeCube(cube)
    if (reward > 0) {
      giveCoins(addr, reward)
      toast(`Broke ${letter}! +${reward} coins`, addr)
    } else toast(`Broke ${letter}. Rerolled cubes give no coins.`, addr)
    ensureSupply()
  }

  // A client's local prediction says where a cube it pushed came to rest. Adopt it when it is plausible, so cubes
  // stay where the player pushed them even if the server's sim (fed late, sparse player positions) disagrees.
  function on_settle(data: any, addr: string) {
    if (!C.SETTLE_REPORTS) return
    const cube = cubes.get(data.cubeId)
    if (!cube || cube.mode !== 'free') return
    const p = playerOf(addr)
    if (!p) return
    const b = cube.body
    // only the player who was actually next to the cube, and at most one report per cube per cooldown, so a client
    // cannot chain reports to walk cubes it never touched
    if (clock - (lastSettle.get(cube.id) ?? -Infinity) < C.SETTLE_COOLDOWN) return
    if (!touchedRecently(addr, b, p.pos)) return
    const pr = world.params
    const moved = Vector3.distance(Vector3.create(b.x, b.y, b.z), Vector3.create(data.x, data.y, data.z))
    const fromPlayer = Math.hypot(data.x - p.pos.x, data.z - p.pos.z)
    const fromCenter = Math.hypot(data.x - pr.centerX, data.z - pr.centerZ)
    if (moved > C.PREDICT_SNAP || fromPlayer > C.SETTLE_REACH) return
    if (fromCenter > pr.arenaRadius - pr.cubeRadius || data.y < pr.floorY + pr.cubeHalf - 0.1) return
    if (fromCenter < pr.stageRadius + pr.cubeRadius && data.y < pr.stageTop + pr.cubeHalf - 0.1) return // inside the platform
    b.x = data.x
    b.y = data.y
    b.z = data.z
    b.yaw = data.yaw
    b.vx = b.vy = b.vz = 0
    b.yawRate = 0
    b.asleep = true
    b.sleepTime = 0
    cube.sentAsleep = false // goes out on the next tick
    lastSettle.set(cube.id, clock)
  }

  function on_vote(data: any, addr: string) {
    if (phase !== 'vote') return
    if (!arenaPlayers().some((p) => p.address === addr)) return
    votes.set(addr, Math.max(-1, Math.min(1, Math.round(data.choice))))
    updateVoteState()
  }

  function on_useItem(data: any, addr: string) {
    if (!canPlay(addr)) return
    const item = itemOf(data.item)
    const p = profileOf(addr)
    if (!item || !p) return
    if (phase !== 'playing') return toast('Power-ups only work while a round is running.', addr)
    if (!arenaPlayers().some((a) => a.address === addr)) return
    if ((p.items[item.id] ?? 0) <= 0) return toast(`You have no ${item.name}. The vendor sells them.`, addr)
    if (item.id === 'wildcard') {
      if (wildcardUsed) return toast('A wildcard was already used this round.', addr)
      if (holders.has(addr)) return toast('Free your hands first: throw or place the cube you hold.', addr)
    } else {
      const wait = (itemReady.get(addr) ?? 0) - clock
      if (wait > 0) return toast(`Power-ups recharge in ${Math.ceil(wait)}s.`, addr)
      if (item.id === 'freeze' && freezeLeft > 0) return toast('Time is already frozen.', addr)
    }
    let ok = true
    if (item.id === 'wildcard') {
      ok = giveWildcard(addr)
      if (ok) wildcardUsed = true
    } else if (item.id === 'freeze') {
      freezeLeft = C.FREEZE_SECONDS
      toast(`${C.FREEZE_SECONDS}s of Time Freeze!`)
    } else if (item.id === 'reroll') {
      rerollPile()
      toast('A fresh pile of cubes!')
    } else if (item.id === 'bomb') ok = bombAt(addr)
    if (!ok) return
    p.items[item.id]--
    if (item.id !== 'wildcard') itemReady.set(addr, clock + C.ITEM_COOLDOWN)
    touch(addr)
    sendProfile(addr)
  }

  function on_hint(data: any, addr: string) {
    if (phase !== 'playing') return
    if (!canPlay(addr)) return
    if (hintsUsed >= answer.length - 1) return toast('No more hints for this word!', addr)
    const cost = hintCost()
    const have = coinsOf(addr)
    if (have < cost) return toast(`A hint costs ${cost} coins. You have ${have}.`, addr)
    giveCoins(addr, -cost)
    hintsUsed++
    updateGameState()
    toast(`Hint revealed! (-${cost} coins)`)
  }

  // ---------- seats ----------

  function activate() {
    if (active) return
    active = true
    difficulty = C.START_DIFFICULTY
    completed = 0
    lastWord = ''
    startRound('A new game! Find the letters.')
  }

  // The pad asks for a seat; false when the game is full. The first seat wakes an idle game up.
  function requestSeat(addr: string): boolean {
    const existing = seats.get(addr)
    if (existing) {
      existing.until = clock + C.SEAT_HOLD_SECONDS
      return true
    }
    if (seats.size >= C.MAX_PLAYERS_PER_GAME) return false
    seats.set(addr, { until: clock + C.SEAT_HOLD_SECONDS, arrived: false, outside: 0 })
    emptyFor = 0
    activate()
    return true
  }

  function dropHeld(addr: string) {
    const held = holders.get(addr)
    if (!held) return
    holders.delete(addr)
    release(held, lastPos.get(addr) ?? fallbackDrop(), 0, 0, 0)
  }

  function leaveSeat(addr: string) {
    if (!seats.delete(addr)) return
    dropHeld(addr)
    votes.delete(addr)
    GameState.getMutable(stateEntity).players = seats.size
    if (active) updateVoteState()
  }

  // Everything back to an idle, empty arena: no cubes, no round, level 1 again.
  function deactivate() {
    for (const cube of Array.from(cubes.values())) removeCube(cube)
    clearBodies(world)
    holders.clear()
    pendingToss.length = 0
    flights.length = 0
    spawnQueue = []
    votes.clear()
    participants.clear()
    lockedUntil.clear()
    itemReady.clear()
    trails.clear()
    answer = ''
    slots = []
    hintsUsed = 0
    freezeLeft = 0
    wildcardUsed = false
    phase = 'playing'
    round = 0
    timeLeft = 0
    active = false
    const g = GameState.getMutable(stateEntity)
    g.question = ''
    g.timeLeft = 0
    g.builders = 0
    g.frozen = 0
    g.voteLeft = 0
    g.voteDown = g.voteSame = g.voteUp = 0
    updateGameState()
  }

  /** Players standing in this arena without a seat (the server sends them back to the lobby). */
  function intruders(): string[] {
    return players()
      .filter((p) => !seats.has(p.address) && inThisArena(p))
      .map((p) => p.address)
  }

  // ---------- main loop ----------

  function tick(dt: number) {
    clock += dt

    // seats: an unclaimed seat expires; a player who stays out of the arena loses theirs
    const here = new Set(arenaPlayers().map((p) => p.address))
    const lobby = new Set(players().filter((p) => inLobby(p.pos)).map((p) => p.address))
    for (const [addr, seat] of Array.from(seats.entries())) {
      if (here.has(addr)) {
        seat.arrived = true
        seat.outside = 0
      } else if (!seat.arrived) {
        if (clock > seat.until) leaveSeat(addr)
      } else {
        seat.outside += dt
        // back on the lobby island: gone almost at once; elsewhere (a fall, a slow reconnect) there is a longer grace
        if (seat.outside > (lobby.has(addr) ? C.LOBBY_LEAVE_SECONDS : C.SEAT_LEAVE_SECONDS)) leaveSeat(addr)
      }
    }
    if (GameState.get(stateEntity).players !== seats.size) GameState.getMutable(stateEntity).players = seats.size

    if (!active) return
    if (seats.size === 0) {
      emptyFor += dt
      if (emptyFor >= IDLE_SHUTDOWN_SECONDS) deactivate()
      return
    }
    emptyFor = 0

    spawnSome()

    // players shove cubes (PusherTracker: same speed smoothing + lookahead as the clients' prediction)
    const pushers: Pusher[] = []
    const present = new Set<string>()
    for (const p of arenaPlayers()) {
      present.add(p.address)
      lastPos.set(p.address, Vector3.create(p.pos.x, p.pos.y, p.pos.z))
      recordTrail(p.address, p.pos)
      pushers.push(pusherTracker.update(p.address, p.pos.x, p.pos.y, p.pos.z, dt))
    }
    setPushers(world, pushers)

    simAcc += dt
    let steps = 0
    while (simAcc >= SIM_DT && steps < 3) {
      syncEnv()
      step(world, SIM_DT)
      simAcc -= SIM_DT
      steps++
    }
    if (steps === 3) simAcc = 0

    // moving cubes near a player are written every tick, the rest at a lower rate
    sendAcc += dt
    const sendFar = sendAcc >= C.FAR_SEND_INTERVAL
    if (sendFar) sendAcc = 0
    const near2 = C.NEAR_RADIUS * C.NEAR_RADIUS
    for (const cube of cubes.values()) {
      if (cube.mode !== 'free') continue
      if (cube.body.asleep && cube.sentAsleep) continue
      let near = false
      for (const p of pushers) {
        const dx = cube.body.x - p.x
        const dz = cube.body.z - p.z
        if (dx * dx + dz * dz < near2) {
          near = true
          break
        }
      }
      if (near || sendFar || cube.body.asleep) {
        writeTransform(cube)
        cube.sentAsleep = cube.body.asleep
      }
    }

    // throws away (F): leave the hand at the emote's release point
    for (let i = pendingToss.length - 1; i >= 0; i--) {
      const x = pendingToss[i]
      x.t += dt
      if (x.t < C.THROW_RELEASE_DELAY) continue
      pendingToss.splice(i, 1)
      const p = playerOf(x.addr)
      if (!p) {
        release(x.cube, lastPos.get(x.addr) ?? fallbackDrop(), 0, 0, 0)
        continue
      }
      const fwd = Vector3.rotate(Vector3.Forward(), p.rot)
      release(x.cube, handPos(p), fwd.x * C.TOSS_SPEED, C.TOSS_UP, fwd.z * C.TOSS_SPEED)
    }

    // cubes thrown at frames: the result is decided on landing
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]
      f.t += dt
      if (f.t < FLIGHT_TOTAL) continue
      flights.splice(i, 1)
      if (phase === 'playing' && slots[f.cube.slot] === f.cube) land(f.cube)
    }

    if (phase === 'playing' && here.size > 0) {
      if (freezeLeft > 0) {
        freezeLeft = Math.max(0, freezeLeft - dt)
        const shown = Math.ceil(freezeLeft)
        if (GameState.get(stateEntity).frozen !== shown) GameState.getMutable(stateEntity).frozen = shown
      } else timeLeft -= dt
      if (timeLeft <= 0) timeUp()
      else if (Math.ceil(timeLeft) !== lastTimeShown) {
        lastTimeShown = Math.ceil(timeLeft)
        GameState.getMutable(stateEntity).timeLeft = lastTimeShown
      }
    }

    if (phase === 'won' || phase === 'timeout') {
      nextRoundIn -= dt
      if (nextRoundIn <= 0) startVote()
    } else if (phase === 'vote') {
      const there = arenaPlayers()
      if (there.length > 0) voteLeft -= dt // an empty arena holds the vote open
      const everyoneVoted = there.length > 0 && there.every((p) => votes.has(p.address))
      if (voteLeft <= 0 || everyoneVoted) endVote()
      else if (Math.ceil(voteLeft) !== lastVoteShown) {
        lastVoteShown = Math.ceil(voteLeft)
        updateVoteState()
      }
    }
  }

  // Once a second: fix up the pile.
  function housekeep() {
    if (!active) return
    ensureSupply()
    for (const addr of Array.from(trails.keys())) if (!seats.has(addr)) trails.delete(addr)
    pusherTracker.prune(new Set(seats.keys()))
  }

  return {
    index,
    stateEntity,
    cubes,
    seats,
    tick,
    housekeep,
    requestSeat,
    leaveSeat,
    intruders,
    isActive: () => active,
    hasSeat: (addr: string) => seats.has(addr),
    handle(name: string, addr: string, data: any) {
      if (!active || !seats.has(addr)) return
      switch (name) {
        case 'grab': return on_grab(data, addr)
        case 'place': return on_place(data, addr)
        case 'toss': return on_toss(data, addr)
        case 'breakCube': return on_breakCube(data, addr)
        case 'settle': return on_settle(data, addr)
        case 'vote': return on_vote(data, addr)
        case 'useItem': return on_useItem(data, addr)
        case 'hint': return on_hint(data, addr)
      }
    },
    broadcastToast: (text: string) => toast(text),
    // for tests
    testing: { spawnSome, startRound, startVote, endVote, collapse, land, timeUp, advance: (seconds: number) => { clock += seconds }, get clock() { return clock } }
  }
}

export type Game = ReturnType<typeof createGame>
