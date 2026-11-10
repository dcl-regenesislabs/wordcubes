// The top players, written on the lobby's Leaderboard sign itself (Leaderboard.glb): one row per player on its wooden
// planks, from the board text the server keeps in every GameState. Client only.
import { engine, Transform, TextShape, TextAlignMode } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { EntityNames } from '../../assets/scene/entity-names'
import { boardText } from './gamestate'
import { parseBoard } from './ranktags'
import { rankIndex } from './ui/rank'
import { t, uiLang } from './i18n'
import * as C from '../config'

const CREAM = Color4.create(1, 0.96, 0.86, 1)
const GOLD = Color4.create(1, 0.84, 0.3, 1)
const PINK = Color4.create(1, 0.62, 0.78, 1)
const OUTLINE = Color4.create(0.22, 0.12, 0.06, 1)

interface Row {
  place: Entity
  name: Entity
  rank: Entity
}

let root: Entity | undefined
const rows: Row[] = []
let shown = ''

const shortAddress = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`
function nameOf(address: string): string {
  const p = getPlayer({ userId: address })
  const name = p && p.name ? p.name : shortAddress(address)
  return name.length > C.LEADERBOARD_NAME_CHARS ? `${name.slice(0, C.LEADERBOARD_NAME_CHARS - 1)}…` : name
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
    rows.push({
      place: makeText(root, -half, y, C.LEADERBOARD_FONT, i === 0 ? GOLD : CREAM, TextAlignMode.TAM_MIDDLE_LEFT),
      name: makeText(root, -half + C.LEADERBOARD_NAME_X, y, C.LEADERBOARD_FONT, i === 0 ? GOLD : CREAM, TextAlignMode.TAM_MIDDLE_LEFT),
      rank: makeText(root, half, y, C.LEADERBOARD_FONT * 0.8, PINK, TextAlignMode.TAM_MIDDLE_RIGHT)
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
  const lines = top.map(([address, rating]) => [nameOf(address), t(`rank.${rankIndex(rating)}`)])
  const key = JSON.stringify([uiLang(), lines]) // a language switch redraws the board too
  if (key === shown) return
  shown = key
  for (let i = 0; i < rows.length; i++) {
    const line = lines[i]
    setText(rows[i].place, line ? `${i + 1}.` : '')
    setText(rows[i].name, line ? line[0] : i === 0 && lines.length === 0 ? t('board.nobody') : '')
    setText(rows[i].rank, line ? line[1] : '')
  }
}
