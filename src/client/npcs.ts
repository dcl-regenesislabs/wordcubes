// Lobby NPCs made from Decentraland avatars (AvatarShape). Click one to talk; the conversation shows in the UI kit's dialog panel.
// Position: an empty entity named "RankNpc" / "VendorNpc" / "VendorNpc_2" (arena) in the composite wins (so the Creator Hub can move them);
// otherwise they stand beside the path between the lobby centre and the start pad.
import { engine, Transform, AvatarShape, MeshCollider, ColliderLayer, GltfContainer, TextShape, TextAlignMode, Billboard, BillboardMode, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { envOrigin } from '../shared/env'
import { cs } from './state'
import { lobbyAnchors, worldPosition } from './lobby'
import { RANK_NAMES } from './ui/rank'

const BASE = 'urn:decentraland:off-chain:base-avatars:'
const LOOK = ['eyebrows_00', 'mouth_00', 'eyes_00', 'blue_tshirt', 'brown_pants', 'classic_shoes', 'short_hair'].map((w) => BASE + w)
const TALK_DISTANCE = 6

interface NpcDef {
  id: string
  name: string
  entityName: string // composite entity that overrides the position
  where: 'lobby' | 'arena'
  game?: number // arena vendors: which game's arena
  side: number // lobby: +1 / -1, which side of the path from the lobby centre to the pad
  shop?: boolean // opens the shop instead of a conversation
  female: boolean
  hair: Color3
  skin: Color3
  pages: string[]
}

// Draft text. The rank system is not live yet: these pages describe the plan (docs/round-system-design.md).
const NPCS: NpcDef[] = [
  {
    id: 'wc-npc-ranker',
    name: 'Lexi, Keeper of Ranks',
    entityName: 'RankNpc',
    where: 'lobby',
    side: 1,
    female: true,
    hair: Color3.create(0.55, 0.25, 0.7),
    skin: Color3.create(0.94, 0.8, 0.65),
    pages: [
      'Welcome to Word Cubes! Everyone here has a rank, and it shows next to your coins in the lobby.',
      `You start as a ${RANK_NAMES[0]}. Win words in harder rooms and you climb: ${RANK_NAMES.join(', ')}.`,
      'After every round the players in the room vote: easier, the same, or harder. Harder rooms are worth more.',
      'Only the players who put the final letters in place earn the reward, so dig for your cubes and help build the word!'
    ]
  },
  {
    id: 'wc-npc-vendor-lobby',
    name: 'Cubby, the Vendor',
    entityName: 'VendorNpc',
    where: 'lobby',
    side: -1,
    shop: true,
    female: false,
    hair: Color3.create(0.9, 0.55, 0.1),
    skin: Color3.create(0.8, 0.6, 0.45),
    pages: []
  },
  // one vendor in every arena; the first is the composite's VendorNpc_2, the copies are VendorNpc_2_g2, _g3, ...
  ...C.GAME_ENV_NAMES.map(
    (_, game): NpcDef => ({
      id: `wc-npc-vendor-arena-${game}`,
      name: 'Cubby, the Vendor',
      entityName: game === 0 ? 'VendorNpc_2' : `VendorNpc_2_g${game + 1}`,
      where: 'arena',
      game,
      side: 0,
      shop: true,
      female: false,
      hair: Color3.create(0.9, 0.55, 0.1),
      skin: Color3.create(0.8, 0.6, 0.45),
      pages: []
    })
  )
]

const spawned = new Map<string, Entity>()

function standPosition(def: NpcDef): Vector3 | undefined {
  const named = engine.getEntityOrNullByName(def.entityName)
  // entities placed in the Creator Hub are usually children of Lobby or GameEnv, so use their world position
  if (named && Transform.getOrNull(named)) return worldPosition(named)
  if (def.where === 'arena') {
    // fallback: inside the arena wall, on the side opposite the player spawn ring's first point
    const o = envOrigin(def.game ?? 0)
    return Vector3.create(o.x - (C.ARENA_RADIUS - 1.8), o.y + C.FLOOR_Y, o.z)
  }
  const a = lobbyAnchors()
  if (!a) return undefined
  const mid = Vector3.create((a.origin.x + a.pad.x) / 2, a.pad.y, (a.origin.z + a.pad.z) / 2)
  const dx = a.pad.x - a.origin.x
  const dz = a.pad.z - a.origin.z
  const len = Math.hypot(dx, dz) || 1
  return Vector3.create(mid.x + (-dz / len) * 3.5 * def.side, mid.y, mid.z + (dx / len) * 3.5 * def.side)
}

function spawn(def: NpcDef, pos: Vector3) {
  const npc = engine.addEntity()
  Transform.create(npc, { position: pos })
  AvatarShape.create(npc, {
    id: def.id,
    name: def.name,
    bodyShape: BASE + (def.female ? 'BaseFemale' : 'BaseMale'),
    wearables: LOOK,
    emotes: [],
    hairColor: def.hair,
    skinColor: def.skin
  })
  // Avatars have no collider, so a child box catches the clicks.
  const hit = engine.addEntity()
  Transform.create(hit, { parent: npc, position: Vector3.create(0, 0.95, 0), scale: Vector3.create(0.9, 1.9, 0.9) })
  MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: `Talk to ${def.name.split(',')[0]}`, maxDistance: TALK_DISTANCE } },
    () => {
      if (def.shop) cs.shop = true
      else cs.dialog = { name: def.name, pages: def.pages, page: 0 }
    }
  )
  if (def.shop) addShopSign(pos)
  spawned.set(def.id, npc)
}

// A vendor is easy to spot: a wildcard box spinning above their head with SHOP over it.
const emblems: Entity[] = []
function addShopSign(pos: Vector3) {
  const box = engine.addEntity()
  Transform.create(box, { position: Vector3.create(pos.x, pos.y + 2.9, pos.z), scale: Vector3.scale(Vector3.One(), 1.1) })
  GltfContainer.create(box, { src: 'assets/models/CubeWildCard.glb' })
  emblems.push(box)
  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(pos.x, pos.y + 3.8, pos.z) })
  TextShape.create(sign, {
    text: 'SHOP',
    fontSize: 4,
    textColor: Color4.create(1, 0.85, 0.25, 1),
    outlineColor: Color4.create(0.2, 0.1, 0.35, 1),
    outlineWidth: 0.25,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(sign, { billboardMode: BillboardMode.BM_Y })
}

export function setupNpcs() {
  engine.addSystem((dt: number) => {
    for (const def of NPCS) {
      if (spawned.has(def.id)) continue
      const pos = standPosition(def)
      if (pos) spawn(def, pos)
    }
    for (const box of emblems) {
      const bt = Transform.getMutable(box)
      bt.rotation = Quaternion.multiply(bt.rotation, Quaternion.fromEulerDegrees(0, 70 * dt, 0))
    }
    // face the player while they are close
    const me = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!me) return
    for (const npc of spawned.values()) {
      const t = Transform.getMutable(npc)
      const dx = me.x - t.position.x
      const dz = me.z - t.position.z
      if (dx * dx + dz * dz < 12 * 12) t.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0)
    }
    // a conversation or the shop closes when you walk away
    if (cs.dialog || cs.shop) {
      let near = false
      for (const npc of spawned.values()) {
        const p = Transform.get(npc).position
        if ((me.x - p.x) ** 2 + (me.z - p.z) ** 2 < (TALK_DISTANCE + 3) ** 2) near = true
      }
      if (!near) {
        cs.dialog = null
        cs.shop = false
      }
    }
  }, 1, 'word-cubes-npcs')
}
