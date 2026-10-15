// Lobby NPCs made from Decentraland avatars (AvatarShape). Click one to talk; the conversation shows in the UI kit's dialog panel.
// Position: an empty entity named "RankNpc" / "VendorNpc" in the composite wins (so the Creator Hub can move them);
// otherwise they stand beside the path between the lobby centre and the start pad.
import { engine, Transform, AvatarShape, MeshCollider, ColliderLayer, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color3, Quaternion, Vector3 } from '@dcl/sdk/math'
import { cs } from './state'
import { lobbyAnchors } from './lobby'
import { RANK_NAMES } from './ui/rank'

const BASE = 'urn:decentraland:off-chain:base-avatars:'
const LOOK = ['eyebrows_00', 'mouth_00', 'eyes_00', 'blue_tshirt', 'brown_pants', 'classic_shoes', 'short_hair'].map((w) => BASE + w)
const TALK_DISTANCE = 6

interface NpcDef {
  id: string
  name: string
  entityName: string // composite entity that overrides the position
  side: number // +1 / -1: which side of the path from the lobby centre to the pad
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
  }
]

const spawned = new Map<string, Entity>()

function standPosition(def: NpcDef): Vector3 | undefined {
  const named = engine.getEntityOrNullByName(def.entityName)
  const t = named ? Transform.getOrNull(named) : null
  if (t) return Vector3.create(t.position.x, t.position.y, t.position.z)
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
    () => (cs.dialog = { name: def.name, pages: def.pages, page: 0 })
  )
  spawned.set(def.id, npc)
}

export function setupNpcs() {
  engine.addSystem(() => {
    for (const def of NPCS) {
      if (spawned.has(def.id)) continue
      const pos = standPosition(def)
      if (pos) spawn(def, pos)
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
    // a conversation ends when you walk away
    if (cs.dialog) {
      let near = false
      for (const npc of spawned.values()) {
        const p = Transform.get(npc).position
        if ((me.x - p.x) ** 2 + (me.z - p.z) ** 2 < (TALK_DISTANCE + 3) ** 2) near = true
      }
      if (!near) cs.dialog = null
    }
  }, 1, 'word-cubes-npcs')
}
