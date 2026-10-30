// Arenas for games 1 and up are not in the composite. A client builds one on the fly, as a copy of the template arena's
// models ("GameEnv" and its children) shifted to that game's position, only while it plays there (or is about to), and
// takes it down again afterwards. Game 0 is the template itself and always exists.
import { engine, Transform, GltfContainer, GltfContainerLoadingState, LoadingState } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import * as C from '../config'
import { envOrigin } from '../shared/env'
import { addPassportBlocker } from './arena'
import { cs } from './state'

interface BuiltArena {
  root: Entity
  parts: Entity[]
  required: Entity[] // the parts with colliders: players must not be teleported in before these have loaded
  dropVendor: () => void
  unwanted: number // seconds nobody needed it
}

const built = new Map<number, BuiltArena>()
const requested = new Map<number, number>() // game -> seconds the request stays alive

let vendorFactory: (game: number) => () => void = () => () => {}
/** npcs.ts supplies the arena vendor (kept out of here to avoid an import cycle with the lobby). */
export function setArenaVendorFactory(fn: (game: number) => () => void) {
  vendorFactory = fn
}

/** Ask for an arena to be built (a seat was granted). It stays until you leave the game. */
export function requestArena(game: number) {
  if (game > 0) requested.set(game, C.ARENA_LOAD_TIMEOUT + 20)
}

function build(game: number): BuiltArena | undefined {
  const template = engine.getEntityOrNullByName(C.ARENA_TEMPLATE)
  if (!template || !Transform.getOrNull(template)) return undefined
  const root = engine.addEntity()
  Transform.create(root, { position: envOrigin(game) })
  addPassportBlocker(root)
  const parts: Entity[] = []
  const required: Entity[] = []
  // Copy the template's whole subtree: models hang off GameEnv directly or off plain containers (the "Grass" entity
  // holds its tufts), so every entity with a Transform is copied and the models are put back on the copies.
  const children = new Map<Entity, Entity[]>()
  for (const [entity, t] of engine.getEntitiesWith(Transform)) {
    if (t.parent === undefined) continue
    const list = children.get(t.parent)
    if (list) list.push(entity)
    else children.set(t.parent, [entity])
  }
  const copy = (source: Entity, parent: Entity) => {
    for (const child of children.get(source) ?? []) {
      const t = Transform.get(child)
      const part = engine.addEntity()
      Transform.create(part, { parent, position: t.position, rotation: t.rotation, scale: t.scale })
      parts.push(part)
      const gl = GltfContainer.getOrNull(child)
      if (gl) {
        GltfContainer.create(part, {
          src: gl.src,
          visibleMeshesCollisionMask: gl.visibleMeshesCollisionMask,
          invisibleMeshesCollisionMask: gl.invisibleMeshesCollisionMask
        })
        if ((gl.visibleMeshesCollisionMask ?? 0) !== 0 || (gl.invisibleMeshesCollisionMask ?? 0) !== 0) required.push(part)
      }
      copy(child, part)
    }
  }
  copy(template, root)
  return { root, parts, required, dropVendor: vendorFactory(game), unwanted: 0 }
}

function teardown(a: BuiltArena) {
  a.dropVendor()
  for (const e of [...a.parts, a.root]) engine.removeEntity(e)
}

/** True once the arena exists and its floor and walls have loaded (game 0 always). */
export function arenaReady(game: number): boolean {
  if (game <= 0) return true
  const a = built.get(game)
  if (!a) return false
  return a.required.every((e) => {
    const s = GltfContainerLoadingState.getOrNull(e)?.currentState
    return s === LoadingState.FINISHED || s === LoadingState.FINISHED_WITH_ERROR || s === LoadingState.NOT_FOUND
  })
}

export function arenaSystem(dt: number) {
  const wanted = new Set<number>()
  if (cs.game > 0) wanted.add(cs.game)
  for (const [game, left] of Array.from(requested.entries())) {
    if (left - dt <= 0) requested.delete(game)
    else {
      requested.set(game, left - dt)
      wanted.add(game)
    }
  }
  for (const game of wanted) {
    if (built.has(game)) built.get(game)!.unwanted = 0
    else {
      const a = build(game)
      if (a) built.set(game, a)
    }
  }
  for (const [game, a] of Array.from(built.entries())) {
    if (wanted.has(game)) continue
    a.unwanted += dt
    if (a.unwanted >= C.ARENA_KEEP_SECONDS) {
      teardown(a)
      built.delete(game)
    }
  }
}

