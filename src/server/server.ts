import { engine, Transform, GltfContainer, ColliderLayer, PlayerIdentityData } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import * as C from '../config'
import { WORDS } from './words'
import { room } from '../shared/messages'
import { envOrigin } from '../shared/env'
import { CubeData, GameState, protectServerEntity, modelFor } from '../shared/schemas'
import { worldParams, syncEnvParams } from '../shared/world'
import { PusherTracker } from '../shared/pushers'
import { createWorld, addBody, removeBody, clearBodies, step, applyImpulse, wake, wakeNear, setPushers } from '../sim/physics'
import type { Body, Pusher } from '../sim/physics'

type Mode = 'free' | 'held' | 'flying' | 'placed'

interface SCube {
  id: number
  letter: string
  entity: Entity
  body: Body
  mode: Mode
  slot: number
  holder: string
  sentAsleep: boolean
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SIM_DT = 1 / 30
const FLIGHT_TOTAL = C.THROW_RELEASE_DELAY + C.THROW_FLIGHT_TIME
const SPAWN_PER_TICK = 40
const PARK_Y = -30

function fallbackDrop(): Vector3 {
  const o = envOrigin()
  return Vector3.create(o.x + 8, o.y + 2, o.z)
}

const world = createWorld(worldParams()) // local params; syncEnvParams() moves them onto GameEnv

const cubes = new Map<number, SCube>()
let nextCubeId = 1
let stateEntity: Entity
let answer = ''
let slots: (SCube | null)[] = []
let hintsUsed = 0
let phase: 'playing' | 'won' = 'playing'
let round = 0
let completed = 0
let lastWord = ''
let nextRoundIn = 0
let spawnQueue: string[] = []
const holders = new Map<string, SCube>()
const coins = new Map<string, number>()
const lastPos = new Map<string, Vector3>()
const pendingToss: { cube: SCube; t: number; addr: string }[] = []
const flights: { cube: SCube; t: number }[] = []

// ---------- helpers ----------

interface PlayerInfo {
  address: string
  pos: Vector3
  rot: Quaternion
}

function players(): PlayerInfo[] {
  const out: PlayerInfo[] = []
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const t = Transform.getOrNull(entity)
    if (!t) continue
    out.push({ address: identity.address.toLowerCase(), pos: t.position, rot: t.rotation })
  }
  return out
}

function playerOf(address: string): PlayerInfo | null {
  return players().find((p) => p.address === address) ?? null
}

function toast(text: string, to?: string) {
  if (to) room.send('toast', { text }, { to: [to] })
  else room.send('toast', { text })
}

function giveCoins(address: string, amount: number) {
  const value = (coins.get(address) ?? 0) + amount
  coins.set(address, value)
  room.send('coins', { value }, { to: [address] })
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

// Re-read GameEnv every tick so moving it in the editor moves the whole sim (floor, platform, centre).
function syncEnv() {
  syncEnvParams(world.params)
}

function slotPos(index: number): Vector3 {
  const offset = (index - (slots.length - 1) / 2) * C.SLOT_SPACING
  const o = envOrigin()
  return Vector3.create(o.x + offset, o.y + C.SLOT_Y, o.z)
}

function handPos(p: PlayerInfo): Vector3 {
  const fwd = Vector3.rotate(Vector3.Forward(), p.rot)
  const right = Vector3.rotate(Vector3.Right(), p.rot)
  return Vector3.create(
    p.pos.x + fwd.x * C.HAND_FORWARD + right.x * C.HAND_RIGHT,
    p.pos.y + C.HAND_HEIGHT,
    p.pos.z + fwd.z * C.HAND_FORWARD + right.z * C.HAND_RIGHT
  )
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
  g.phase = phase
  g.round = round
  g.completed = completed
  g.length = answer.length
  g.masked = answer
    .split('')
    .map((_, i) => (slots[i] && slots[i]!.mode === 'placed' ? answer[i] : '_'))
    .join('')
  g.hint = hintsUsed > 0 ? answer.split('').map((c, i) => (i < hintsUsed ? c : '_')).join('') : ''
}

// ---------- cubes ----------

function spawnCube(letter: string, x: number, y: number, z: number) {
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
  CubeData.create(entity, { id, letter, mode: 'free', slot: -1, holder: '' })
  protectServerEntity(entity, [Transform, GltfContainer])
  syncEntity(entity, [Transform.componentId, GltfContainer.componentId, CubeData.componentId])
  cubes.set(id, { id, letter, entity, body, mode: 'free', slot: -1, holder: '', sentAsleep: false })
}

function removeCube(cube: SCube) {
  removeBody(world, cube.body)
  cubes.delete(cube.id)
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
  cube.sentAsleep = false
  applyImpulse(cube.body, vx, vy, vz)
  writeTransform(cube)
  sync(cube)
}

// ---------- rounds ----------

function startRound() {
  for (const cube of Array.from(cubes.values())) removeCube(cube)
  clearBodies(world)
  holders.clear()
  pendingToss.length = 0
  flights.length = 0

  let entry = WORDS[Math.floor(Math.random() * WORDS.length)]
  while (WORDS.length > 1 && entry.answer === lastWord) entry = WORDS[Math.floor(Math.random() * WORDS.length)]
  lastWord = entry.answer
  answer = entry.answer
  slots = new Array(answer.length).fill(null)
  hintsUsed = 0
  phase = 'playing'
  round++

  const g = GameState.getMutable(stateEntity)
  g.question = entry.question
  updateGameState()

  const letters = answer.split('')
  while (letters.length < C.CUBES_PER_ROUND) letters.push(LETTERS[Math.floor(Math.random() * LETTERS.length)])
  // shuffled so the word's letters don't all land first
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[letters[i], letters[j]] = [letters[j], letters[i]]
  }
  spawnQueue = letters
  toast('New round! Find the letters.')
}

function spawnSome() {
  for (let n = 0; n < SPAWN_PER_TICK && spawnQueue.length > 0; n++) {
    const letter = spawnQueue.pop()!
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(rand(C.SPAWN_MIN_RADIUS ** 2, C.SPAWN_MAX_RADIUS ** 2))
    const o = envOrigin()
    spawnCube(letter, o.x + Math.cos(a) * r, o.y + rand(C.SPAWN_MIN_Y, C.SPAWN_MAX_Y), o.z + Math.sin(a) * r)
  }
}

function collapse() {
  for (let i = 0; i < slots.length; i++) {
    const cube = slots[i]
    if (!cube) continue
    const idx = flights.findIndex((f) => f.cube === cube)
    if (idx >= 0) flights.splice(idx, 1)
    release(cube, slotPos(i), rand(-3, 3), rand(0, 3), rand(-3, 3))
    slots[i] = null
  }
  updateGameState()
  room.send('fx', { kind: 'fail', slot: -1 })
  toast('Wrong cube! The whole word collapsed.')
}

function land(cube: SCube) {
  const slot = cube.slot
  if (cube.letter !== answer[slot]) {
    collapse()
    return
  }
  const holder = cube.holder
  cube.mode = 'placed'
  cube.holder = ''
  cube.body.active = false
  park(cube)
  sync(cube)
  room.send('fx', { kind: 'lock', slot })
  if (slots.every((s) => s !== null && s.mode === 'placed')) {
    phase = 'won'
    completed++
    nextRoundIn = C.NEXT_ROUND_DELAY
    for (const p of players()) giveCoins(p.address, C.COINS_PER_WORD)
    room.send('fx', { kind: 'win', slot: -1 })
    let msg = `${answer}! +${C.COINS_PER_WORD} coins for everyone`
    if (completed >= C.ROUNDS_FOR_REWARD) msg += ' - Wearable reward (stub)'
    toast(msg)
  }
  updateGameState()
  void holder
}

// ---------- messages ----------

function init() {
  room.onMessage('join', (_data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    room.send('coins', { value: coins.get(addr) ?? 0 }, { to: [addr] })
  })

  room.onMessage('grab', (data, ctx) => {
    if (!ctx || phase !== 'playing') return
    const addr = ctx.from.toLowerCase()
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
  })

  room.onMessage('place', (data, ctx) => {
    if (!ctx || phase !== 'playing') return
    const addr = ctx.from.toLowerCase()
    const cube = holders.get(addr)
    if (!cube) return toast('Grab a cube first (click it), then click a frame.', addr)
    if (data.slot < 0 || data.slot >= slots.length || slots[data.slot]) return
    holders.delete(addr)
    slots[data.slot] = cube
    cube.slot = data.slot
    cube.mode = 'flying'
    sync(cube)
    flights.push({ cube, t: 0 })
  })

  room.onMessage('toss', (_data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    const cube = holders.get(addr)
    if (!cube) return
    holders.delete(addr)
    pendingToss.push({ cube, t: 0, addr })
  })

  room.onMessage('breakCube', (_data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    const cube = holders.get(addr)
    if (!cube) return toast('Nothing to break. Click a cube to grab it first.', addr)
    holders.delete(addr)
    const needed = answer.includes(cube.letter)
    const letter = cube.letter
    removeCube(cube)
    if (needed) toast(`Broke ${letter}, which is in the word. No coins.`, addr)
    else {
      giveCoins(addr, C.COINS_PER_BREAK)
      toast(`Broke ${letter}! +${C.COINS_PER_BREAK} coins`, addr)
    }
  })

  room.onMessage('hint', (_data, ctx) => {
    if (!ctx || phase !== 'playing') return
    if (hintsUsed >= answer.length - 1) return toast('No more hints for this word!', ctx.from.toLowerCase())
    hintsUsed++
    updateGameState()
    toast('Hint revealed!')
  })
}

// ---------- main loop ----------

let simAcc = 0
let sendAcc = 0
let housekeepAcc = 0
let heartbeatAcc = 0
const pusherTracker = new PusherTracker()

function gameSystem(dt: number) {
  spawnSome()

  // players shove cubes (PusherTracker: same speed smoothing + lookahead as the clients' prediction)
  const pushers: Pusher[] = []
  const present = new Set<string>()
  for (const p of players()) {
    present.add(p.address)
    lastPos.set(p.address, Vector3.create(p.pos.x, p.pos.y, p.pos.z))
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
  const pl = pushers
  for (const cube of cubes.values()) {
    if (cube.mode !== 'free') continue
    if (cube.body.asleep && cube.sentAsleep) continue
    let near = false
    for (const p of pl) {
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
    if (slots[f.cube.slot] === f.cube) land(f.cube)
  }

  if (phase === 'won') {
    nextRoundIn -= dt
    if (nextRoundIn <= 0) startRound()
  }

  housekeepAcc += dt
  if (housekeepAcc >= 1) {
    housekeepAcc = 0
    // a player who leaves while holding a cube drops it back into the pile
    for (const [addr, cube] of Array.from(holders.entries())) {
      if (present.has(addr)) continue
      holders.delete(addr)
      release(cube, lastPos.get(addr) ?? fallbackDrop(), 0, 0, 0)
    }
    pusherTracker.prune(present)
  }

  heartbeatAcc += dt
  if (heartbeatAcc >= 2) {
    heartbeatAcc = 0
    GameState.getMutable(stateEntity).heartbeat = Date.now()
  }
}

// A restarted server can inherit entities from the previous run's snapshot: clear the old ones.
function clearStaleEntities() {
  for (const [entity] of engine.getEntitiesWith(CubeData)) {
    if (((entity as number) & 0xffff) < 512) continue
    engine.removeEntity(entity)
  }
  for (const [entity] of engine.getEntitiesWith(GameState)) {
    if (((entity as number) & 0xffff) < 512) continue
    engine.removeEntity(entity)
  }
}

export function initServer() {
  clearStaleEntities()
  stateEntity = engine.addEntity()
  GameState.create(stateEntity, {
    phase: 'playing',
    round: 0,
    completed: 0,
    question: '',
    length: 0,
    masked: '',
    hint: '',
    heartbeat: Date.now()
  })
  syncEntity(stateEntity, [GameState.componentId], 1)
  init()
  engine.addSystem(gameSystem, 1, 'word-cubes-server')
  startRound()
  console.log('[SERVER] Word Cubes server started')
}
