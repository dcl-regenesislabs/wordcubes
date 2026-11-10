// Lobby NPCs made from Decentraland avatars (AvatarShape). Click one to talk; the conversation shows in the UI kit's dialog panel.
// Position: an empty entity named "RankNpc" / "VendorNpc" / "VendorNpc_2" (arena) in the composite wins (so the Creator Hub can move them);
// otherwise they stand beside the path between the lobby centre and the start pad.
import { engine, Transform, AvatarShape, MeshCollider, ColliderLayer, GltfContainer, TextShape, TextAlignMode, Billboard, BillboardMode, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { envOrigin } from '../shared/env'
import { cs } from './state'
import { talkSfx } from './audio'
import { lobbyAnchors, worldPosition } from './lobby'
import { RANK_NAMES } from './ui/rank'
import { t, uiLang } from './i18n'

const BASE = 'urn:decentraland:off-chain:base-avatars:'
const LOOK = ['eyebrows_00', 'mouth_00', 'eyes_00', 'blue_tshirt', 'brown_pants', 'classic_shoes', 'short_hair'].map((w) => BASE + w)
const TALK_DISTANCE = 6

interface NpcDef {
  id: string
  talk: 'lexi' | 'cubby' // its name, prompt and lines in the UI language: npc.<talk>.* in shared/i18n
  name: string // English name (for reading the code; the UI shows npc.<talk>.name)
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

// Lexi's lines are npc.lexi.1..4 in shared/i18n (pagesOf). The rank system describes the plan (docs/round-system-design.md).
const NPCS: NpcDef[] = [
  {
    id: 'wc-npc-ranker',
    talk: 'lexi',
    name: 'Lexi, Keeper of Ranks',
    entityName: 'RankNpc',
    where: 'lobby',
    side: 1,
    female: true,
    hair: Color3.create(0.55, 0.25, 0.7),
    skin: Color3.create(0.94, 0.8, 0.65),
    pages: []
  },
  {
    id: 'wc-npc-vendor-lobby',
    talk: 'cubby',
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
  // the vendor of the first arena (game 0); the other arenas get theirs when they are built (spawnArenaVendor)
  {
    id: 'wc-npc-vendor-arena',
    talk: 'cubby',
    name: 'Cubby, the Vendor',
    entityName: 'VendorNpc_2', // the name the Creator Hub gave the second copy
    where: 'arena',
    game: 0,
    side: 0,
    shop: true,
    female: false,
    hair: Color3.create(0.9, 0.55, 0.1),
    skin: Color3.create(0.8, 0.6, 0.45),
    pages: []
  }
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

/** What Lexi says, in the UI language at the moment you talk to her. */
function pagesOf(def: NpcDef): string[] {
  if (def.talk !== 'lexi') return def.pages
  const ranks = RANK_NAMES.map((_, i) => t(`rank.${i}`))
  return [t('npc.lexi.1'), t('npc.lexi.2', { first: ranks[0], all: ranks.join(', ') }), t('npc.lexi.3'), t('npc.lexi.4')]
}

// Texts that sit on world entities (name tag, prompt, SHOP sign), redone when the UI language changes.
const labelled: { def: NpcDef; npc: Entity; hit: Entity; sign?: Entity }[] = []
let labelledLang = ''

function setTalkPrompt(def: NpcDef, hit: Entity) {
  pointerEventsSystem.removeOnPointerDown(hit)
  pointerEventsSystem.onPointerDown(
    { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: t('hover.talk', { name: `@npc.${def.talk}.short` }), maxDistance: TALK_DISTANCE } },
    () => {
      talkSfx()
      if (def.shop) cs.shop = true
      else cs.dialog = { name: t(`npc.${def.talk}.name`), pages: pagesOf(def), page: 0 }
    }
  )
}

function relabel() {
  if (labelledLang === uiLang()) return
  labelledLang = uiLang()
  for (const l of labelled) {
    const avatar = AvatarShape.getMutableOrNull(l.npc)
    if (avatar) avatar.name = t(`npc.${l.def.talk}.name`)
    setTalkPrompt(l.def, l.hit)
    if (l.sign) TextShape.getMutable(l.sign).text = t('npc.shopSign')
  }
}

function spawn(def: NpcDef, pos: Vector3): () => void {
  const npc = engine.addEntity()
  Transform.create(npc, { position: pos })
  AvatarShape.create(npc, {
    id: def.id,
    name: t(`npc.${def.talk}.name`),
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
  setTalkPrompt(def, hit)
  const extras = def.shop ? addShopSign(pos) : []
  const entry = { def, npc, hit, sign: extras[1] }
  labelled.push(entry)
  spawned.set(def.id, npc)
  return () => {
    const at = labelled.indexOf(entry)
    if (at >= 0) labelled.splice(at, 1)
    pointerEventsSystem.removeOnPointerDown(hit)
    for (const e of [hit, npc, ...extras]) engine.removeEntity(e)
    for (const e of extras) {
      const at = emblems.indexOf(e)
      if (at >= 0) emblems.splice(at, 1)
    }
    spawned.delete(def.id)
  }
}

// A vendor is easy to spot: a wildcard box spinning above their head with SHOP over it.
const emblems: Entity[] = []
function addShopSign(pos: Vector3): Entity[] {
  const box = engine.addEntity()
  Transform.create(box, { position: Vector3.create(pos.x, pos.y + 2.9, pos.z), scale: Vector3.scale(Vector3.One(), 1.1) })
  GltfContainer.create(box, { src: 'assets/models/CubeWildCard.glb' })
  emblems.push(box)
  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(pos.x, pos.y + 3.8, pos.z) })
  TextShape.create(sign, {
    text: t('npc.shopSign'),
    fontSize: 4,
    textColor: Color4.create(1, 0.85, 0.25, 1),
    outlineColor: Color4.create(0.2, 0.1, 0.35, 1),
    outlineWidth: 0.25,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(sign, { billboardMode: BillboardMode.BM_Y })
  return [box, sign]
}

/** The vendor of a dynamically built arena (game 1 and up), where the template arena's vendor stands, shifted to this arena. */
export function spawnArenaVendor(game: number): () => void {
  const def = NPCS.find((d) => d.where === 'arena')!
  const named = engine.getEntityOrNullByName(def.entityName)
  const base = envOrigin(0)
  const o = envOrigin(game)
  const at =
    named && Transform.getOrNull(named)
      ? Vector3.add(worldPosition(named), Vector3.subtract(o, base))
      : Vector3.create(o.x - (C.ARENA_RADIUS - 1.8), o.y + C.FLOOR_Y, o.z)
  return spawn({ ...def, id: `${def.id}-${game}`, game }, at)
}

export function setupNpcs() {
  engine.addSystem((dt: number) => {
    relabel()
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
