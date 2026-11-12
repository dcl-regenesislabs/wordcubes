// Entirely local single-player tutorial. No messages, server, seats, prediction or validation round trips.
import { engine, Transform, type Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { GameState, CubeData } from '../shared/schemas'
import { PRACTICE_GAME, PRACTICE_WORDS, type PracticeStage } from '../shared/tutorial'
import type { Lang } from '../shared/lang'
import { envOrigin } from '../shared/env'
import { beginLocalCubes, addLocalCube, clearLocalCubes } from './cubenet'
import { cs } from './state'

let entity: Entity | undefined
let stage: PracticeStage = 'intro'
let answer = ''
let nextId = 40000
const cubes = new Map<number, Entity>()
let slots: (number | null)[] = []
let flights: { id: number; left: number }[] = []
let effect: (kind: string, slot: number) => void = () => {}

export const localPracticeStage = () => stage
export function setPracticeEffect(fn: (kind: string, slot: number) => void) { effect = fn }

function spawn(letter: string, x: number, z: number): number {
  const o = envOrigin(PRACTICE_GAME)
  const id = ++nextId
  cubes.set(id, addLocalCube(id, letter, Vector3.create(o.x + x, o.y + C.FLOOR_Y + C.CUBE_HALF, o.z + z)))
  return id
}

function update() {
  if (entity === undefined) return
  const state = GameState.getMutable(entity)
  state.phase = stage === 'won' || stage === 'complete' ? 'won' : 'playing'
  state.masked = slots.map((id, i) => id !== null && CubeData.get(cubes.get(id)!).mode === 'placed' ? answer[i] : '_').join('')
}

export function stopLocalPractice() {
  clearLocalCubes()
  cubes.clear()
  flights = []
  slots = []
  if (entity !== undefined) engine.removeEntity(entity)
  entity = undefined
  stage = 'intro'
}

export function startLocalPractice(lang: Lang) {
  stopLocalPractice()
  cs.game = PRACTICE_GAME
  beginLocalCubes()
  answer = PRACTICE_WORDS[lang].answer
  slots = new Array(answer.length).fill(null)
  entity = engine.addEntity()
  GameState.create(entity, {
    game: PRACTICE_GAME, active: 1, lang, phase: 'playing', round: 1, difficulty: 1,
    timeLeft: 0, board: '', frozen: 0, players: 1, builders: 1, voteLeft: 0,
    voteDown: 0, voteSame: 0, voteUp: 0, completed: 0, question: PRACTICE_WORDS[lang].question,
    length: answer.length, masked: '_'.repeat(answer.length), hint: '', hintCost: 0, heartbeat: 0, startAt: 0
  })
  // Always reachable from the player's spawn, away from the pedestal and other letters.
  spawn(answer[0], -5, -7)
  spawn(answer[1], -7, -7)
  spawn(answer[2], -3, -7)
  spawn('X', -7, -10)
  spawn('X', -3, -10)
}

export function localLetterCube(letter: string): number {
  for (const [id, e] of cubes) {
    const d = CubeData.get(e)
    if (d.mode === 'free' && d.letter === letter) return id
  }
  return -1
}

export function grabLocalCube(id: number) {
  const e = cubes.get(id)
  if (e === undefined) return
  const d = CubeData.getMutable(e)
  d.mode = 'held'
  d.holder = cs.myAddress
  d.slot = -1
  Transform.getMutable(e).position.y = C.GUESS_PARK_Y
}

function launch(id: number, slot: number, holder: string) {
  const e = cubes.get(id)
  if (e === undefined || slots[slot] !== null) return
  const d = CubeData.getMutable(e)
  d.mode = 'flying'
  d.slot = slot
  d.holder = holder
  slots[slot] = id
  Transform.getMutable(e).position.y = C.GUESS_PARK_Y
  flights.push({ id, left: C.THROW_RELEASE_DELAY + C.THROW_FLIGHT_TIME })
}

export function placeLocalCube(slot: number) {
  for (const [id, e] of cubes) {
    const d = CubeData.get(e)
    if (d.mode === 'held' && d.holder === cs.myAddress) { launch(id, slot, cs.myAddress); return }
  }
}

function release(id: number, x: number, z: number) {
  const e = cubes.get(id)!
  const d = CubeData.getMutable(e)
  d.mode = 'free'
  d.holder = ''
  d.slot = -1
  const o = envOrigin(PRACTICE_GAME)
  Transform.getMutable(e).position = Vector3.create(o.x + x, o.y + C.FLOOR_Y + C.CUBE_HALF, o.z + z)
}

export function localPracticeAction(action: string) {
  if (entity === undefined) return
  if (action === 'begin' && stage === 'intro') stage = 'first'
  else if (action === 'assist' && stage === 'assist') {
    stage = 'last'
    launch(localLetterCube(answer[1]), 1, 'cubby-coach')
  } else if (action === 'mistake' && stage === 'won') {
    stage = 'mistake'
    release(slots[2]!, -3, -7)
    slots[2] = null
    launch(spawn('X', -4, -4), 2, 'cubby-coach')
  } else if (action === 'rebuild' && stage === 'collapsed') {
    stage = 'retry'
    launch(spawn(answer[0], -4, -4), 0, 'cubby-coach')
    launch(spawn(answer[1], -4, -4), 1, 'cubby-coach')
  }
  update()
}

export function localPracticeSystem(dt: number) {
  if (entity === undefined) return
  for (let i = flights.length - 1; i >= 0; i--) {
    const flight = flights[i]
    flight.left -= dt
    if (flight.left > 0) continue
    flights.splice(i, 1)
    const d = CubeData.getMutable(cubes.get(flight.id)!)
    if (d.letter !== answer[d.slot]) {
      flights = []
      // The final letter is already on the floor at (-3, -7) when Cubby throws X.
      // Leave that spot clear while the incorrect cube and the other letters fall.
      slots.forEach((id, slot) => { if (id !== null) release(id, slot === 2 ? -1 : -7 + slot * 2, -7) })
      slots.fill(null)
      stage = 'collapsed'
      effect('fail', -1)
      break
    }
    d.mode = 'placed'
    d.holder = ''
    effect('lock', d.slot)
    if (stage === 'first') stage = 'assist'
    if (slots.every(id => id !== null && CubeData.get(cubes.get(id)!).mode === 'placed')) {
      stage = stage === 'retry' ? 'complete' : 'won'
      effect('win', -1)
      if (stage === 'complete') {
        cs.settings.tutorialComplete = true
        cs.tutorialSavePending = true
      }
    }
  }
  update()
}
