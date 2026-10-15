import { engine, Transform, GltfContainer, ColliderLayer, PlayerIdentityData } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import * as C from '../config'
import { pickWord } from './words'
import { retain, profileOf, touch, saveSome, release as releaseProfile, allCached, ratingDelta } from './profiles'
import { room } from '../shared/messages'
import { envOrigin } from '../shared/env'
import { CubeData, GameState, PlayerRanks, protectServerEntity, modelFor } from '../shared/schemas'
import { Storage } from '@dcl/sdk/server'
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
  placer: string // who threw it at a frame; stays set while it is locked in, cleared when it drops back into the pile
  sentAsleep: boolean
  breakReward: boolean // rerolls and replacement supply cannot mint more break coins
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
const BOARD_KEY = 'wc:board'
let board: { a: string; r: number }[] = []
let boardDirty = false
let ranksEntity: Entity
const rankPages: Entity[] = [] // small synced batches; include every present player without a profile-count cutoff
let lastRanks = ''
let wildcardUsed = false // one wildcard per round, in the whole room
let freezeLeft = 0 // seconds of Time Freeze left
const itemReady = new Map<string, number>() // address -> clock time their next power-up is ready
const absent = new Map<string, number>() // address -> housekeeping checks without finding the player
let saveAcc = 0
const lastPos = new Map<string, Vector3>()
const pendingToss: { cube: SCube; t: number; addr: string }[] = []
// settle reports: each player's recent path, and when each cube last took a report
let clock = 0
const trails = new Map<string, { x: number; y: number; z: number; t: number }[]>()
const lastSettle = new Map<number, number>()
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

// Players standing in the arena (not in the lobby). The round timer and the vote only run while someone is playing.
function arenaPlayers(): PlayerInfo[] {
  const o = envOrigin()
  return players().filter((p) => {
    const dx = p.pos.x - o.x
    const dz = p.pos.z - o.z
    return dx * dx + dz * dz < (C.ARENA_RADIUS + 4) ** 2 && p.pos.y > o.y - 2
  })
}

function playerOf(address: string): PlayerInfo | null {
  return players().find((p) => p.address === address) ?? null
}

function toast(text: string, to?: string) {
  if (to) room.send('toast', { text }, { to: [to] })
  else room.send('toast', { text })
}

const coinsOf = (address: string): number => profileOf(address)?.coins ?? 0

function sendProfile(address: string) {
  const p = profileOf(address)
  if (!p) return
  room.send('coins', { value: p.coins }, { to: [address] })
  room.send(
    'profile',
    { rating: Math.round(p.rating), wildcard: p.items.wildcard ?? 0, reroll: p.items.reroll ?? 0, freeze: p.items.freeze ?? 0, bomb: p.items.bomb ?? 0, settings: JSON.stringify(p.settings) },
    { to: [address] }
  )
}

// Top 5 by rating. Updated when someone's rating changes, saved with the profiles, shown on the lobby sign.
function updateBoard(address: string, rating: number) {
  const r = Math.round(rating)
  const at = board.findIndex((b) => b.a === address)
  if (at >= 0) board[at].r = r
  else board.push({ a: address, r })
  board.sort((x, y) => y.r - x.r)
  board = board.slice(0, 5)
  boardDirty = true
  GameState.getMutable(stateEntity).board = board.map((b) => `${b.a}:${b.r}`).join(',')
}

function publishRanks() {
  const entries = players()
    .map(({ address }) => `${address}:${Math.round(profileOf(address)?.rating ?? 0)}`)
    .sort()
  const data = entries.join(',')
  if (data === lastRanks) return
  lastRanks = data
  const pages = Math.max(1, Math.ceil(entries.length / 60))
  for (let page = 0; page < pages; page++) {
    const text = entries.slice(page * 60, (page + 1) * 60).join(',')
    if (page >= rankPages.length) {
      const entity = engine.addEntity()
      PlayerRanks.create(entity, { data: text })
      syncEntity(entity, [PlayerRanks.componentId])
      rankPages.push(entity)
    } else if (PlayerRanks.get(rankPages[page]).data !== text) {
      PlayerRanks.getMutable(rankPages[page]).data = text
    }
  }
  while (rankPages.length > pages) engine.removeEntity(rankPages.pop()!)
}

// Server-side gate shared by actions that could disrupt the ongoing word. Tossing one's held cube stays available.
function canPlay(address: string): boolean {
  if (phase !== 'playing' || !arenaPlayers().some((p) => p.address === address)) return false
  const wait = (lockedUntil.get(address) ?? 0) - clock
  if (wait <= 0) return true
  toast(`Locked out: ${Math.ceil(wait)}s left. You can still throw your held cube away.`, address)
  return false
}

function giveCoins(address: string, amount: number) {
  const p = profileOf(address)
  if (!p) return
  p.coins = Math.max(0, p.coins + amount)
  touch(address)
  room.send('coins', { value: p.coins }, { to: [address] })
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
  CubeData.create(entity, { id, letter, mode: 'free', slot: -1, holder: '' })
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
  const o = envOrigin()
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
  room.send('fx', { kind: 'fail', slot: -1 })
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
  room.send('fx', { kind: 'fail', slot: -1 })
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
    updateBoard(addr, p.rating)
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
  room.send('fx', { kind: 'lock', slot })
  if (slots.every((s) => s !== null && s.mode === 'placed')) {
    phase = 'won'
    completed++
    nextRoundIn = C.NEXT_ROUND_DELAY
    const builders = finishWord()
    GameState.getMutable(stateEntity).builders = builders.length
    const deltas = settleRound(true, builders)
    room.send('fx', { kind: 'win', slot: -1 })
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
  room.send('burst', { x: p.pos.x, y: p.pos.y + 1, z: p.pos.z, gold: 2 })
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

// ---------- messages ----------

function init() {
  room.onMessage('join', (_data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    void retain(addr).then(() => sendProfile(addr))
  })

  room.onMessage('grab', (data, ctx) => {
    if (!ctx || phase !== 'playing') return
    const addr = ctx.from.toLowerCase()
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
  })

  room.onMessage('place', (data, ctx) => {
    if (!ctx || phase !== 'playing') return
    const addr = ctx.from.toLowerCase()
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
    room.send('burst', { x: spot.x, y: spot.y, z: spot.z, gold: reward > 0 ? 1 : 0 })
    removeCube(cube)
    if (reward > 0) {
      giveCoins(addr, reward)
      toast(`Broke ${letter}! +${reward} coins`, addr)
    } else toast(`Broke ${letter}. Rerolled cubes give no coins.`, addr)
    ensureSupply()
  })

  // A client's local prediction says where a cube it pushed came to rest. Adopt it when it is plausible, so cubes
  // stay where the player pushed them even if the server's sim (fed late, sparse player positions) disagrees.
  room.onMessage('settle', (data, ctx) => {
    if (!ctx || !C.SETTLE_REPORTS) return
    const cube = cubes.get(data.cubeId)
    if (!cube || cube.mode !== 'free') return
    const addr = ctx.from.toLowerCase()
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
  })

  room.onMessage('vote', (data, ctx) => {
    if (!ctx || phase !== 'vote') return
    const addr = ctx.from.toLowerCase()
    if (!arenaPlayers().some((p) => p.address === addr)) return
    votes.set(addr, Math.max(-1, Math.min(1, Math.round(data.choice))))
    updateVoteState()
  })

  room.onMessage('cheat', (_data, ctx) => {
    if (!ctx || !C.CHEATS_ENABLED) return
    const addr = ctx.from.toLowerCase()
    giveCoins(addr, C.CHEAT_COINS)
    toast(`+${C.CHEAT_COINS} coins (test cheat)`, addr)
  })

  room.onMessage('setSetting', (data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    const p = profileOf(addr)
    if (!p || !C.SETTINGS.some((s) => s.id === data.key)) return // only switches listed in config
    p.settings[data.key] = data.value === 1
    touch(addr)
  })

  room.onMessage('buy', (data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    const item = itemOf(data.item)
    const p = profileOf(addr)
    if (!item || !p) return
    if ((p.items[item.id] ?? 0) >= 9) return toast(`You already carry 9 ${item.name}s.`, addr)
    if (p.coins < item.price) return toast(`${item.name} costs ${item.price} coins. You have ${p.coins}.`, addr)
    giveCoins(addr, -item.price)
    p.items[item.id] = (p.items[item.id] ?? 0) + 1
    touch(addr)
    sendProfile(addr)
    toast(`Bought ${item.name}!`, addr)
  })

  room.onMessage('useItem', (data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
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
  })

  room.onMessage('hint', (_data, ctx) => {
    if (!ctx || phase !== 'playing') return
    const addr = ctx.from.toLowerCase()
    if (!canPlay(addr)) return
    if (hintsUsed >= answer.length - 1) return toast('No more hints for this word!', addr)
    const cost = hintCost()
    const have = coinsOf(addr)
    if (have < cost) return toast(`A hint costs ${cost} coins. You have ${have}.`, addr)
    giveCoins(addr, -cost)
    hintsUsed++
    updateGameState()
    toast(`Hint revealed! (-${cost} coins)`)
  })
}

// ---------- main loop ----------

let simAcc = 0
let sendAcc = 0
let housekeepAcc = 0
let heartbeatAcc = 0
const pusherTracker = new PusherTracker()

function gameSystem(dt: number) {
  clock += dt
  spawnSome()

  // players shove cubes (PusherTracker: same speed smoothing + lookahead as the clients' prediction)
  const pushers: Pusher[] = []
  const present = new Set<string>()
  for (const p of players()) {
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
    if (phase === 'playing' && slots[f.cube.slot] === f.cube) land(f.cube)
  }

  if (phase === 'playing' && arenaPlayers().length > 0) {
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
    const present = arenaPlayers()
    if (present.length > 0) voteLeft -= dt // an empty room holds the vote open
    const everyoneVoted = present.length > 0 && present.every((p) => votes.has(p.address))
    if (voteLeft <= 0 || everyoneVoted) endVote()
    else if (Math.ceil(voteLeft) !== lastVoteShown) {
      lastVoteShown = Math.ceil(voteLeft)
      updateVoteState()
    }
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
    ensureSupply()
    // Presence also recovers profiles if the client's one-shot join message was missed.
    for (const addr of present) {
      const loaded = profileOf(addr) !== undefined
      void retain(addr).then(() => {
        if (!loaded) sendProfile(addr)
      })
    }
    for (const [addr] of allCached()) {
      if (present.has(addr)) absent.delete(addr)
      else if ((absent.get(addr) ?? 0) >= 2) {
        absent.delete(addr)
        releaseProfile(addr)
      } else absent.set(addr, (absent.get(addr) ?? 0) + 1)
    }
    publishRanks()
    saveAcc += 1
    if (saveAcc >= C.PROFILE_SAVE_SECONDS) {
      saveAcc = 0
      saveSome()
      if (boardDirty) {
        boardDirty = false
        void Storage.set(BOARD_KEY, board).then((ok) => {
          if (!ok) boardDirty = true
        })
      }
    }
    const inArena = arenaPlayers().length
    if (GameState.get(stateEntity).players !== inArena) GameState.getMutable(stateEntity).players = inArena
    for (const addr of Array.from(trails.keys())) if (!present.has(addr)) trails.delete(addr)
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
  for (const [entity] of engine.getEntitiesWith(PlayerRanks)) {
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
    difficulty: C.START_DIFFICULTY,
    timeLeft: 0,
    board: '',
    frozen: 0,
    players: 0,
    builders: 0,
    voteLeft: 0,
    voteDown: 0,
    voteSame: 0,
    voteUp: 0,
    completed: 0,
    question: '',
    length: 0,
    masked: '',
    hint: '',
    hintCost: C.HINT_BASE_COST,
    heartbeat: Date.now()
  })
  syncEntity(stateEntity, [GameState.componentId], 1)
  ranksEntity = engine.addEntity()
  PlayerRanks.create(ranksEntity, { data: '' })
  rankPages.push(ranksEntity)
  syncEntity(ranksEntity, [PlayerRanks.componentId], 2)
  void Storage.get<{ a: string; r: number }[]>(BOARD_KEY)
    .then((stored) => {
      if (stored && Array.isArray(stored)) {
        board = stored.slice(0, 5)
        GameState.getMutable(stateEntity).board = board.map((b) => `${b.a}:${b.r}`).join(',')
      }
    })
    .catch((e) => console.log('[SERVER] board read failed', e))
  init()
  engine.addSystem(gameSystem, 1, 'word-cubes-server')
  startRound()
  console.log('[SERVER] Word Cubes server started')
}
