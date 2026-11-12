// A rank badge floating over every player's head (yours too, which you see in third person), seen by everyone.
// Ratings come from the server's synced PlayerRanks entity. The badge is attached to the avatar's name tag (so it follows
// every animation exactly) and the picture is a child that always turns to face the camera: the attached entity's own
// rotation belongs to the avatar. Pointing at it shows the rank's name; clicking it does nothing.
import {
  engine,
  Transform,
  Billboard,
  BillboardMode,
  PlayerIdentityData,
  AvatarAttach,
  AvatarAnchorPointType,
  MeshRenderer,
  MeshCollider,
  Material,
  MaterialTransparencyMode,
  ColliderLayer,
  pointerEventsSystem,
  InputAction
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color3, Vector3 } from '@dcl/sdk/math'
import { CubeData, PlayerRanks } from '../shared/schemas'
import { rankIndex } from './ui/rank'
import { t } from './i18n'
import { cs, setting } from './state'
import { mobile } from './ui/platform'
import * as C from '../config'

const SHOW_DISTANCE = 28

interface Tag {
  root: Entity
  badge: Entity
  rank: number // the rank index drawn, -1 before the first
}
const tags = new Map<string, Tag>()

function makeBadge(parent: Entity): Entity {
  const badge = engine.addEntity()
  Transform.create(badge, {
    parent,
    position: Vector3.create(0, C.RANK_BADGE_HEIGHT, 0),
    scale: Vector3.create(C.RANK_BADGE_SIZE, C.RANK_BADGE_SIZE, 1)
  })
  MeshRenderer.setPlane(badge)
  MeshCollider.setPlane(badge, ColliderLayer.CL_POINTER) // only for the hover text
  Billboard.create(badge, { billboardMode: BillboardMode.BM_Y })
  return badge
}

// The badge's picture and hover text for a rank.
function drawRank(badge: Entity, rank: number) {
  const texture = Material.Texture.Common({ src: C.rankBadgeImage(rank) })
  Material.setPbrMaterial(badge, {
    texture,
    emissiveTexture: texture,
    emissiveColor: Color3.White(),
    emissiveIntensity: C.RANK_BADGE_GLOW,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    metallic: 0,
    roughness: 1,
    castShadows: false
  })
  pointerEventsSystem.removeOnPointerDown(badge)
  pointerEventsSystem.onPointerDown(
    { entity: badge, opts: { button: InputAction.IA_POINTER, hoverText: t('hover.rank', { n: rank + 1, rank: `@rank.${rank}` }), maxDistance: SHOW_DISTANCE } },
    () => {} // nothing to do: the badge is there for its hover text
  )
}

let lastData = ''
let ratings = new Map<string, number>()

/** Everyone's rating, from the server (empty until it arrives). */
export const ratingOf = (address: string): number => ratings.get(address.toLowerCase()) ?? 0

/** Top players as sent by the server: [address, rating], best first. */
export function parseBoard(text: string): [string, number][] {
  return text
    .split(',')
    .filter((x) => x.length > 0)
    .map((x) => [x.slice(0, x.lastIndexOf(':')), Number(x.slice(x.lastIndexOf(':') + 1))] as [string, number])
}

function readRatings() {
  const pages: string[] = []
  for (const [, r] of engine.getEntitiesWith(PlayerRanks)) {
    if (r.data) pages.push(r.data)
  }
  const data = pages.sort().join(',')
  if (data === lastData) return
  lastData = data
  ratings = new Map(parseBoard(data))
}

export function rankTagSystem() {
  readRatings()
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  const enabled = setting('showRanks') && !cs.tutorialActive // no floating badges from other private trainees
  const holding = new Set<string>()
  for (const [, cube] of engine.getEntitiesWith(CubeData)) {
    if (cube.mode === 'held') holding.add(cube.holder.toLowerCase())
  }
  const seen = new Set<string>()
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const address = identity.address.toLowerCase()
    const t = Transform.getOrNull(entity)
    if (!t) continue
    seen.add(address)
    let tag = tags.get(address)
    if (tag === undefined) {
      const root = engine.addEntity()
      Transform.create(root, {})
      AvatarAttach.create(root, {
        avatarId: entity === engine.PlayerEntity ? undefined : address, // undefined = the local player
        anchorPointId: AvatarAnchorPointType.AAPT_NAME_TAG
      })
      tag = { root, badge: makeBadge(root), rank: -1 }
      tags.set(address, tag)
    }
    const rating = entity === engine.PlayerEntity ? cs.rating : ratingOf(address) // your own is known right away from your profile
    const rank = rankIndex(rating)
    if (rank !== tag.rank) {
      tag.rank = rank
      drawRank(tag.badge, rank)
    }
    const far = me !== undefined && Vector3.distance(me, t.position) > SHOW_DISTANCE
    const size = far || !enabled || holding.has(address) ? 0 : C.RANK_BADGE_SIZE
    const bt = Transform.get(tag.badge)
    if (bt.scale.x !== size) Transform.getMutable(tag.badge).scale = Vector3.create(size, size, 1)
    // the platform is known a moment after start: move the badge once it is
    const lift = mobile() ? C.RANK_BADGE_HEIGHT : C.RANK_BADGE_HEIGHT_DESKTOP
    if (bt.position.y !== lift) Transform.getMutable(tag.badge).position = Vector3.create(0, lift, 0)
  }
  for (const [address, tag] of Array.from(tags.entries())) {
    if (seen.has(address)) continue
    pointerEventsSystem.removeOnPointerDown(tag.badge)
    engine.removeEntity(tag.badge)
    engine.removeEntity(tag.root)
    tags.delete(address)
  }
}
