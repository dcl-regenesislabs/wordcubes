// A small rank label floating over every player's head (yours too, which you see in third person).
// Ratings come from the server's synced PlayerRanks entity; the label is a billboarded TextShape that follows the player.
import { engine, Transform, TextShape, TextAlignMode, Billboard, BillboardMode, PlayerIdentityData } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { PlayerRanks } from '../shared/schemas'
import { rankName, rankIndex } from './ui/rank'
import { cs } from './state'

const HEIGHT = 2.65 // metres above the player's feet (above the name tag)
const SHOW_DISTANCE = 28
const COLORS = [
  Color4.create(0.85, 0.8, 0.95, 1),
  Color4.create(0.4, 0.8, 0.95, 1),
  Color4.create(0.5, 0.85, 0.4, 1),
  Color4.create(1, 0.85, 0.3, 1),
  Color4.create(1, 0.6, 0.2, 1),
  Color4.create(1, 0.45, 0.6, 1),
  Color4.create(0.8, 0.5, 1, 1)
]

const tags = new Map<string, Entity>()
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
  for (const [, r] of engine.getEntitiesWith(PlayerRanks)) {
    if (r.data === lastData) return
    lastData = r.data
    ratings = new Map(parseBoard(r.data))
    return
  }
}

export function rankTagSystem() {
  readRatings()
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  const seen = new Set<string>()
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const address = identity.address.toLowerCase()
    const t = Transform.getOrNull(entity)
    if (!t) continue
    seen.add(address)
    let tag = tags.get(address)
    if (tag === undefined) {
      tag = engine.addEntity()
      Transform.create(tag, { position: t.position })
      TextShape.create(tag, {
        text: '',
        fontSize: 2,
        outlineColor: Color4.create(0.12, 0.05, 0.22, 1),
        outlineWidth: 0.25,
        textAlign: TextAlignMode.TAM_MIDDLE_CENTER
      })
      Billboard.create(tag, { billboardMode: BillboardMode.BM_Y })
      tags.set(address, tag)
    }
    const rating = entity === engine.PlayerEntity ? cs.rating : ratingOf(address) // your own is known right away from your profile
    const text = rankName(rating)
    const ts = TextShape.getMutable(tag)
    if (ts.text !== text) {
      ts.text = text
      ts.textColor = COLORS[rankIndex(rating)]
    }
    const tt = Transform.getMutable(tag)
    tt.position = Vector3.create(t.position.x, t.position.y + HEIGHT, t.position.z)
    const far = me !== undefined && Vector3.distance(me, t.position) > SHOW_DISTANCE
    tt.scale = far ? Vector3.Zero() : Vector3.One()
  }
  for (const [address, tag] of Array.from(tags.entries())) {
    if (seen.has(address)) continue
    engine.removeEntity(tag)
    tags.delete(address)
  }
}
