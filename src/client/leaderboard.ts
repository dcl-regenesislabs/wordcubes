// The top players, written on the lobby's Leaderboard sign itself (Leaderboard.glb): one row per player on its wooden
// planks, from the board text the server keeps in every GameState. Client only.
import { AvatarBase, engine, PlayerIdentityData, Transform, TextShape, TextAlignMode, executeTask } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { EntityNames } from '../../assets/scene/entity-names'
import { boardText } from './gamestate'
import { parseBoard } from './ranktags'
import { rankIndex } from './ui/rank'
import { t, uiLang } from './i18n'
import { playerLabelParts } from '../shared/player-label'
import * as C from '../config'

const CREAM = Color4.create(1, 0.96, 0.86, 1)
const GOLD = Color4.create(1, 0.84, 0.3, 1)
const PINK = Color4.create(1, 0.62, 0.78, 1)
const OUTLINE = Color4.create(0.22, 0.12, 0.06, 1)

interface Row {
  place: Entity
  name: Entity
  suffix: Entity
  rank: Entity
}

let root: Entity | undefined
const rows: Row[] = []
let shown = ''

const names = new Map<string, string>()
const nextLookup = new Map<string, number>()

function labelOf(address: string, liveNames: ReadonlyMap<string, string>) {
  address = address.toLowerCase()
  const liveName = liveNames.get(address)
  if (liveName) names.set(address, liveName)
  // The board also includes players who are outside this scene.
  if (!names.has(address) && Date.now() >= (nextLookup.get(address) ?? 0)) {
    nextLookup.set(address, Infinity) // one request per address in flight
    executeTask(async () => {
      try {
        const response = await fetch(`https://peer.decentraland.org/lambdas/profile/${encodeURIComponent(address)}`)
        if (response.ok) {
          const profile = await response.json()
          const name = profile?.avatars?.[0]?.name
          if (typeof name === 'string' && name.trim() && !names.has(address)) names.set(address, name)
        }
      } catch {
        // Keep the fallback and retry later if the profile service is unavailable.
      } finally {
        nextLookup.set(address, Date.now() + 60_000)
      }
    })
  }
  return playerLabelParts(names.get(address) ?? '', address, C.LEADERBOARD_NAME_CHARS, t('board.player'))
}

function makeText(parent: Entity, x: number, y: number, fontSize: number, color: Color4, align: TextAlignMode): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: Vector3.create(x, y, 0) })
  TextShape.create(e, { text: '', fontSize, textColor: color, outlineColor: OUTLINE, outlineWidth: 0.25, textAlign: align })
  return e
}

// Text entities under the sign, in metres: a root that undoes the sign's scale, sits just in front of the planks and
// turns the text to face the way the sign faces.
function build(sign: Entity) {
  const s = Transform.get(sign).scale
  root = engine.addEntity()
  Transform.create(root, {
    parent: sign,
    position: Vector3.create(0, C.LEADERBOARD_TOP_Y, C.LEADERBOARD_FRONT_Z),
    rotation: Quaternion.fromEulerDegrees(0, C.LEADERBOARD_TEXT_YAW, 0),
    scale: Vector3.create(1 / s.x, 1 / s.y, 1 / s.z)
  })
  const half = C.LEADERBOARD_WIDTH / 2
  for (let i = 0; i < C.LEADERBOARD_ROWS; i++) {
    const y = -(i + 0.5) * C.LEADERBOARD_ROW_HEIGHT
    const nameX = -half + C.LEADERBOARD_NAME_X
    const color = i === 0 ? GOLD : CREAM
    // Keep the name on its own line so even the longest rank cannot overlap it.
    const nameY = y + C.LEADERBOARD_LINE_OFFSET
    const detailY = y - C.LEADERBOARD_LINE_OFFSET
    rows.push({
      place: makeText(root, -half, nameY, C.LEADERBOARD_FONT, color, TextAlignMode.TAM_MIDDLE_LEFT),
      name: makeText(root, nameX, nameY, C.LEADERBOARD_FONT * 0.85, color, TextAlignMode.TAM_MIDDLE_LEFT),
      suffix: makeText(root, nameX, detailY, C.LEADERBOARD_FONT * 0.65, color, TextAlignMode.TAM_MIDDLE_LEFT),
      rank: makeText(root, half, detailY, C.LEADERBOARD_FONT * 0.8, PINK, TextAlignMode.TAM_MIDDLE_RIGHT)
    })
  }
}

function setText(e: Entity, text: string) {
  if (TextShape.get(e).text !== text) TextShape.getMutable(e).text = text
}

let refresh = 0

/** Call once a frame: rewrites the rows when the board (or a player's name) changes. */
export function leaderboardSystem(dt: number) {
  refresh -= dt
  if (refresh > 0) return
  refresh = 1 // names arrive as players load in, so look again every second
  if (!root) {
    const sign = engine.getEntityOrNullByName(EntityNames.Leaderboard_glb)
    if (!sign || !Transform.getOrNull(sign)) return
    build(sign)
  }
  const top = parseBoard(boardText()).slice(0, C.LEADERBOARD_ROWS)
  const liveNames = new Map<string, string>()
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const name = AvatarBase.getOrNull(entity)?.name
    if (name?.trim()) liveNames.set(identity.address.toLowerCase(), name)
  }
  const lines = top.map(([address, rating]) => ({ ...labelOf(address, liveNames), rank: t(`rank.${rankIndex(rating)}`) }))
  const key = JSON.stringify([uiLang(), lines]) // a language switch redraws the board too
  if (key === shown) return
  shown = key
  for (let i = 0; i < rows.length; i++) {
    const line = lines[i]
    setText(rows[i].place, line ? `${i + 1}.` : '')
    setText(rows[i].name, line?.name ?? (i === 0 ? t('board.nobody') : ''))
    setText(rows[i].suffix, line?.suffix ?? '')
    setText(rows[i].rank, line?.rank ?? '')
  }
}
