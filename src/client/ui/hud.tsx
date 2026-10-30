import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import { myState, boardText } from '../gamestate'
import { cs, lockoutLeft, showMessage, setting } from '../state'
import { heldLetter as realHeldLetter } from '../cubes'
import * as C from '../../config'
import { room } from '../../shared/messages'
import { returnToLobby } from '../lobby'
import { clickSlot } from '../arena'
import { MAX_DIFFICULTY, ITEMS, SETTINGS } from '../../config'
import { mobile, EDGE, RIGHT_RESERVE, TOP_RESERVE, BOTTOM_RESERVE, S, view } from './platform'
import { PAL, Frame, OutlineLabel, PillButton, LetterTile, CoinIcon, TileState, clamp, c, Edges } from './theme'
import { rankName, rankIndex } from './rank'
import { parseBoard } from '../ranktags'
import { worldPosition } from '../lobby'
import { getPlayer } from '@dcl/sdk/players'
import { Transform } from '@dcl/sdk/ecs'
import { EntityNames } from '../../../assets/scene/entity-names'

type Game = { frozen: number; players: number; builders: number; hintCost: number; phase: string; round: number; difficulty: number; timeLeft: number; voteLeft: number; voteDown: number; voteSame: number; voteUp: number; completed: number; question: string; length: number; masked: string; hint: string }

function game(): Game | null {
  if (C.UI_PREVIEW) return mockGame()
  return (myState() as unknown as Game | undefined) ?? null
}

// ---- UI preview (config UI_PREVIEW): a fake 16 second round that loops, so the HUD can be checked without a server ----
const MOCK_WORD = 'PARIS'
const MOCK_LOOP = 16
const mockT = () => (Date.now() / 1000) % MOCK_LOOP
const mockRound = () => Math.floor(Date.now() / 1000 / MOCK_LOOP) + 1

function mockGame(): Game {
  const t = mockT()
  // locks: P at 1, A at 2, R at 3, then a wrong cube collapses everything at 4.5; hint at 6; then all five lock 8..12; win from 12
  let placed = 0
  if (t >= 1 && t < 4.5) placed = Math.min(3, Math.floor(t - 0))
  if (t >= 8) placed = Math.min(5, Math.floor(t - 7))
  const masked = MOCK_WORD.split('').map((ch, i) => (i < placed ? ch : '_')).join('')
  const hint = t >= 6 && t < 12 ? 'PA___' : ''
  return { frozen: 0, players: 3, builders: 2, hintCost: 10, phase: t >= 13 ? 'vote' : t >= 12 ? 'won' : 'playing', voteLeft: Math.max(0, Math.ceil(MOCK_LOOP - t)), voteDown: 0, voteSame: 1, voteUp: t >= 14 ? 2 : 0, round: mockRound(), difficulty: 1, timeLeft: Math.max(0, 240 - Math.floor(t)), completed: mockRound() - 1, question: 'What is the capital of France?', length: MOCK_WORD.length, masked, hint }
}

const heldLetter = (): string => {
  if (!C.UI_PREVIEW) return realHeldLetter()
  const t = mockT()
  return t >= 0.2 && t < 1 ? 'P' : t >= 4 && t < 4.5 ? 'O' : ''
}
const mockMessage = (): string => {
  const t = mockT()
  return t >= 4.5 && t < 7 ? 'Wrong cube! The whole word collapsed.' : t >= 12 ? 'PARIS! +25 coins' : ''
}

// ---- tile animations, driven by what the server's state does ----
const FAIL_MS = 650
const WIN_MS = 1400
const TILE_GAP = 8
let seenRound = -1
let prev = ''
let prevPhase = ''
let failAt = 0
let winAt = 0
const lockAt: number[] = []
let lastDifficulty = 0
let levelFrom = 0
let levelTo = 0
let levelAt = 0

// Called by the HUD system. Rendering only reads animation timestamps.
function track(g: Game) {
  if (g.round !== seenRound || prev.length !== g.masked.length) {
    seenRound = g.round
    prev = '_'.repeat(g.masked.length)
    lockAt.length = 0
  }
  let was = 0
  let now = 0
  for (let i = 0; i < g.masked.length; i++) {
    if (prev[i] !== '_') was++
    if (g.masked[i] !== '_') now++
    if (prev[i] === '_' && g.masked[i] !== '_') lockAt[i] = Date.now()
  }
  if ((was > 0 && now === 0 && g.phase === 'playing') || (g.phase === 'timeout' && prevPhase !== 'timeout')) failAt = Date.now()
  if (g.phase === 'won' && prevPhase !== 'won') winAt = Date.now()
  prev = g.masked
  prevPhase = g.phase
  if (g.difficulty !== lastDifficulty) {
    if (lastDifficulty > 0) {
      levelFrom = lastDifficulty
      levelTo = g.difficulty
      levelAt = Date.now()
    }
    lastDifficulty = g.difficulty
  }
}

const swell = (since: number, ms: number, amount: number) => {
  const k = (Date.now() - since) / ms
  return !since || k >= 1 ? 1 : 1 + amount * Math.sin(k * Math.PI)
}

// A full-screen, click-through layer that places its children with flex. Every HUD piece sits in one, so pieces are
// centred / anchored on the real screen instead of on an assumed 1920 px wide canvas.
type Flex = 'flex-start' | 'center' | 'flex-end'
function Layer(props: { align?: Flex; justify?: Flex; pad?: Edges; dir?: 'row' | 'column'; children?: any }) {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0, right: 0, bottom: 0 },
        width: '100%',
        height: '100%',
        flexDirection: props.dir ?? 'column',
        alignItems: props.align ?? 'center',
        justifyContent: props.justify ?? 'center',
        padding: props.pad,
        pointerFilter: 'none'
      }}
    >
      {props.children}
    </UiEntity>
  )
}

// Top-right column (coins, timer, buttons, items) and the word row next to it, computed in one place so the pieces
// cannot overlap and the tests can check the numbers.
const SIDE_W = () => S(250)
const ITEM_H = () => S(52)
const ITEM_GAP = () => S(6)
function ownedItems() {
  return ITEMS.filter((i) => (cs.items[i.id] ?? 0) > 0)
}
export function hudLayout(g: Game | null) {
  const v = view()
  const top = S(24) + TOP_RESERVE()
  const right = EDGE() + RIGHT_RESERVE()
  const columnH = S(150) + S(10) + S(66) + 3 * (S(8) + S(54)) // stats frame + hint + three buttons
  const items = g && g.phase === 'playing' ? ownedItems().length : 0
  const itemsH = items > 0 ? S(10) + items * (ITEM_GAP() + ITEM_H()) : 0
  // a tall stack would run off a short screen: then the items get their own column left of the buttons
  const itemsBeside = items > 0 && top + columnH + itemsH > v.h - EDGE()
  const sideW = SIDE_W() + (itemsBeside ? S(10) + SIDE_W() : 0)
  const reserve = right + sideW + S(16)
  // centred on the screen when it fits between equal margins, otherwise centred in the space left of the column
  const left = v.w - 2 * reserve >= S(700) ? reserve : EDGE()
  const panelW = Math.max(S(120), v.w - left - reserve)
  const n = Math.max(g?.length ?? 1, 1)
  const gap = S(TILE_GAP)
  const tile = Math.min(S(84), Math.max(S(16), Math.floor(panelW / n) - gap))
  return { top, right, left, reserve, panelW, tile, gap, rowW: n * (tile + gap), sideW, columnH, itemsH, itemsBeside }
}
// A panel width that never runs off a narrow screen.
const fit = (w: number, share = 0.92) => Math.min(w, Math.round(view().w * share))
const fitH = (h: number, share = 0.92) => Math.min(h, Math.round(view().h * share))

function WordPanel(props: { g: Game }) {
  const { g } = props
  const n = Math.max(g.length, 1)
  const { top, left, reserve, panelW, tile, gap, rowW } = hudLayout(g)
  const qFont = S(32)
  const qLines = Math.ceil((g.question.length * qFont * 0.55) / (panelW * 0.6)) || 1
  const qW = clamp(Math.round(g.question.length * qFont * 0.56) + S(90), Math.min(S(380), panelW), panelW)
  const qH = Math.round(qFont * 1.5 * Math.min(qLines, 2)) + S(28)

  const failT = (Date.now() - failAt) / FAIL_MS
  const failing = failAt > 0 && failT < 1
  const shake = failing ? Math.sin(failT * 38) * (1 - failT) * S(10) : 0
  const winning = winAt > 0 && Date.now() - winAt < WIN_MS && g.phase === 'won'

  // while you hold a cube the empty tiles are buttons: tap one to throw the cube into that frame (easier than aiming at the 3D frame)
  const placeable = heldLetter() !== '' && g.phase === 'playing' && lockoutLeft() <= 0
  const tiles = []
  for (let i = 0; i < g.length; i++) {
    const letter = g.masked[i] ?? '_'
    const locked = letter !== '_'
    const hint = !locked && g.hint !== '' && (g.hint[i] ?? '_') !== '_'
    const state: TileState = locked ? 'locked' : hint ? 'hint' : 'empty'
    tiles.push(
      <LetterTile
        key={`t${i}`}
        size={tile}
        index={i}
        letter={locked ? letter : hint ? g.hint[i] : ''}
        state={state}
        pop={locked ? swell(lockAt[i] ?? 0, 300, 0.3) : winning ? swell(winAt + i * 90, 400, 0.25) : 1}
        shake={shake}
        flash={failing && failT < 0.7 ? PAL.red : winning ? PAL.yellow : null}
        glow={placeable && !locked}
        onClick={placeable && !locked ? () => clickSlot(i) : undefined}
        margin={gap / 2}
      />
    )
  }

  // Only the question sits in a panel (a cream block face). The letter tiles float on their own under it.
  return (
    <Layer justify="flex-start" pad={{ top, left, right: reserve }}>
      <Frame width={qW} height={qH} edge={PAL.violet} fill={PAL.cream} radius={S(22)} border={S(5)} align="center" justify="center">
        <Label
          value={g.question || 'Connecting...'}
          fontSize={qFont}
          font="sans-serif"
          color={PAL.ink}
          textWrap="wrap"
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: '100%' }}
        />
      </Frame>
      <UiEntity uiTransform={{ width: rowW, height: tile, margin: { top: S(16) }, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>{tiles}</UiEntity>
    </Layer>
  )
}

const clock = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`

// Coins, level, time and the two buttons, stacked at the top right.
function SidePanel(props: { g: Game | null }) {
  const { g } = props
  const w = SIDE_W()
  const L = hudLayout(g)
  const column = (
    <UiEntity uiTransform={{ width: w, flexDirection: 'column', alignItems: 'flex-end', pointerFilter: 'none' }}>
      <Frame width={w} height={S(150)} edge={PAL.violetLight} fill={PAL.violetDark} radius={S(20)} pad={S(10)} align="center" justify="center">
        <CoinsRow size={S(34)} />
        <OutlineLabel value={g ? `Level ${g.difficulty}   ${rankName(cs.rating)}` : ''} fontSize={S(22)} color={PAL.dim} width="100%" height={S(30)} />
        <OutlineLabel value={g ? (g.frozen > 0 ? `Frozen ${g.frozen}s` : clock(g.timeLeft)) : ''} fontSize={S(36)} color={g && g.frozen > 0 ? PAL.cyan : g && g.timeLeft <= 30 && g.phase === 'playing' ? PAL.pink : PAL.text} width="100%" height={S(46)} />
      </Frame>
      <PillButton id="hint" label={g && g.hintCost > 0 ? 'Hint' : 'No hints'} cost={g && g.hintCost > 0 ? g.hintCost : undefined} width={w} height={S(66)} font={S(28)} tint={PAL.pink} margin={{ top: S(10) }} onClick={() => room.send('hint', { n: 0 })} />
      <PillButton id="howto-game" label="How to play" width={w} height={S(54)} font={S(22)} margin={{ top: S(8) }} onClick={() => (cs.showHowTo = true)} />
      <PillButton id="settings-game" label="Settings" width={w} height={S(54)} font={S(22)} margin={{ top: S(8) }} onClick={() => (cs.showSettings = true)} />
      <PillButton id="lobby" label="Back to lobby" width={w} height={S(54)} font={S(22)} tint={PAL.cyan} margin={{ top: S(8) }} onClick={returnToLobby} />
      {!L.itemsBeside && <ItemBar g={g} />}
    </UiEntity>
  )
  return (
    <Layer align="flex-end" justify="flex-start" pad={{ top: L.top, right: L.right }}>
      <UiEntity uiTransform={{ width: L.sideW, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', pointerFilter: 'none' }}>
        {L.itemsBeside && <ItemBar g={g} beside />}
        {column}
      </UiEntity>
    </Layer>
  )
}

const message = (): string => (C.UI_PREVIEW ? mockMessage() : cs.message)
const coins = (): number => (C.UI_PREVIEW ? 125 : cs.coins)
// Coin icon and your coin count.
function CoinsRow(props: { size: number }) {
  const text = `${coins()}`
  const font = props.size
  return (
    <UiEntity uiTransform={{ width: '100%', height: props.size + S(10), flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
      <CoinIcon size={props.size} margin={{ right: S(10) }} />
      <OutlineLabel value={text} fontSize={font} color={PAL.yellow} width={Math.max(S(40), Math.round(text.length * font * 0.62))} height={props.size + S(6)} align="middle-left" />
    </UiEntity>
  )
}

const estW = (text: string, font: number) => Math.round(text.length * font * 0.55)

// What you are holding, the latest message and one line of help, centred at the bottom.
function BottomArea() {
  const held = heldLetter()
  const phone = mobile()
  const help = held
    ? phone
      ? 'Tap a frame to place it'
      : 'Click a frame to place it   -   E: break for coins   -   F: throw away'
    : phone
      ? 'Tap a cube to grab it'
      : 'Click a cube to grab it'
  const msgFont = S(30)
  const helpFont = S(22)
  const msgW = clamp(estW(message(), msgFont) + S(60), S(200), fit(view().w, 0.8))
  const helpW = clamp(estW(help, helpFont) + S(50), S(200), fit(view().w, 0.8))
  const heldSize = S(76)
  return (
    <Layer justify="flex-end" pad={{ bottom: S(36) + BOTTOM_RESERVE() }}>
      {lockoutLeft() > 0 && (
        <Frame width={S(420)} height={S(52)} edge={PAL.pink} fill={PAL.violetDark} radius={S(26)} align="center" justify="center" margin={{ bottom: S(8) }}>
          <Label value={`Locked out  ${lockoutLeft()}s`} fontSize={S(28)} font="sans-serif" color={PAL.pink} uiTransform={{ width: '100%', height: '100%' }} />
        </Frame>
      )}
      {held !== '' && (
        <UiEntity uiTransform={{ width: heldSize + S(190), height: heldSize, margin: { bottom: S(10) }, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
          <OutlineLabel value={held === '*' ? 'Wildcard' : 'Holding'} fontSize={S(26)} color={held === '*' ? PAL.yellow : PAL.text} width={S(130)} height={heldSize} />
          <LetterTile size={heldSize} index={held.charCodeAt(0)} letter={held === '*' ? '?' : held} state="locked" />
        </UiEntity>
      )}
      {message() !== '' && (
        <Frame width={msgW} height={S(56)} edge={PAL.violetLight} fill={PAL.violetDark} radius={S(28)} align="center" justify="center" margin={{ bottom: S(8) }}>
          <Label value={message()} fontSize={msgFont} font="sans-serif" color={PAL.text} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
        </Frame>
      )}
      <Frame width={helpW} height={S(40)} edge={c(0, 0, 0, 0)} fill={c(0.2, 0.1, 0.4, 0.6)} radius={S(20)} border={0} align="center" justify="center">
        <Label value={help} fontSize={helpFont} font="sans-serif" color={PAL.dim} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
      </Frame>
    </Layer>
  )
}

// ---- vote screen: shown between rounds ----
let myVote: number | null = null // -1 easier, 0 same, 1 harder; reset whenever a vote is not open
let votedRound = -1

function VoteScreen(props: { g: Game }) {
  const { g } = props
  const pick = (choice: number) => {
    myVote = choice
    if (!C.UI_PREVIEW) room.send('vote', { choice })
  }
  const bw = S(250)
  const bh = S(120)
  const panelW = 3 * bw + 2 * S(18) + S(70)
  const can = { down: g.difficulty > 1, up: g.difficulty < MAX_DIFFICULTY }
  const option = (id: string, label: string, choice: number, count: number, tint: typeof PAL.cyan, enabled: boolean) => (
    <UiEntity uiTransform={{ width: bw, height: bh + S(26), margin: { left: S(9), right: S(9) }, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      {enabled ? (
        <PillButton id={id} label={label} width={bw} height={bh} font={S(34)} tint={tint} active={myVote === choice} onClick={() => pick(choice)} />
      ) : (
        <Frame width={bw} height={bh} edge={c(0.6, 0.55, 0.7, 0.6)} fill={c(0.2, 0.1, 0.4, 0.5)} radius={bh / 2} align="center" justify="center">
          <Label value={label} fontSize={S(34)} font="sans-serif" color={c(1, 1, 1, 0.4)} uiTransform={{ width: '100%', height: '100%' }} />
        </Frame>
      )}
      <OutlineLabel value={`${count}`} fontSize={S(26)} color={PAL.text} width="100%" height={S(26)} />
    </UiEntity>
  )
  return (
    <Layer>
      <Frame width={panelW} height={S(330)} edge={PAL.violet} fill={PAL.cream} radius={S(30)} border={S(6)} pad={S(18)} align="center" justify="center" block>
        <Label value="Next round: how hard?" fontSize={S(40)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: S(56) }} />
        <Label
          value={`Level ${g.difficulty} now  -  ${g.voteLeft}s  -  no vote counts as Same`}
          fontSize={S(22)}
          font="sans-serif"
          color={c(0.45, 0.35, 0.6, 1)}
          uiTransform={{ width: '100%', height: S(34) }}
        />
        <UiEntity uiTransform={{ width: '100%', height: bh + S(26), margin: { top: S(8) }, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>
          {option('vote-down', 'Easier', -1, g.voteDown, PAL.cyan, can.down)}
          {option('vote-same', 'Same', 0, g.voteSame, PAL.violetLight, true)}
          {option('vote-up', 'Harder', 1, g.voteUp, PAL.pink, can.up)}
        </UiEntity>
      </Frame>
    </Layer>
  )
}

// ---- result of the round: shown for a few seconds before the vote opens ----
function ResultBanner(props: { g: Game }) {
  const { g } = props
  if (g.phase !== 'won' && g.phase !== 'timeout') return null
  const won = g.phase === 'won'
  const w = fit(S(560))
  const h = S(230)
  const mine = C.UI_PREVIEW ? true : cs.earnedRound === g.round
  const earned = C.UI_PREVIEW ? 25 : cs.earned
  return (
    <Layer justify="flex-start" pad={{ top: S(300) }}>
      <Frame width={w} height={h} edge={won ? PAL.green : PAL.pink} fill={PAL.cream} radius={S(26)} border={S(6)} align="center" justify="center">
        <Label value={won ? 'Word complete!' : "Time's up!"} fontSize={S(42)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: S(56) }} />
        <Label
          value={won ? `Built by ${g.builders} player${g.builders === 1 ? '' : 's'}` : 'Nobody finished in time'}
          fontSize={S(24)}
          font="sans-serif"
          color={c(0.45, 0.35, 0.6, 1)}
          uiTransform={{ width: '100%', height: S(34) }}
        />
        {mine && cs.earnedRound === g.round && cs.delta !== 0 && (
          <Label
            value={`Rating ${cs.delta > 0 ? '+' : ''}${cs.delta}`}
            fontSize={S(26)}
            font="sans-serif"
            color={cs.delta > 0 ? PAL.green : PAL.red}
            uiTransform={{ width: '100%', height: S(36) }}
          />
        )}
        {won && mine && (
          <UiEntity uiTransform={{ width: '100%', height: S(44), flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
            <CoinIcon size={S(34)} margin={{ right: S(8) }} />
            <Label value={`+${earned}`} fontSize={S(32)} font="sans-serif" color={c(0.75, 0.5, 0.05, 1)} textWrap="nowrap" uiTransform={{ width: S(90), height: S(40) }} />
          </UiEntity>
        )}
      </Frame>
    </Layer>
  )
}

// ---- "Level 2 -> 3" for a moment when the vote changed the difficulty ----
const LEVEL_BANNER_MS = 2800
function LevelBanner() {
  const age = Date.now() - levelAt
  if (!levelAt || age > LEVEL_BANNER_MS) return null
  const up = levelTo > levelFrom
  const pop = 1 + 0.12 * Math.sin(Math.min(1, age / 350) * Math.PI)
  const w = Math.round(S(520) * pop)
  const h = Math.round(S(96) * pop)
  return (
    <Layer justify="flex-start" pad={{ top: S(300) }}>
      <Frame width={w} height={h} edge={up ? PAL.pink : PAL.cyan} fill={PAL.violetDark} radius={h / 2} border={S(5)} align="center" justify="center">
        <OutlineLabel value={`Level ${levelFrom} to ${levelTo}  -  ${up ? 'Harder!' : 'Easier'}`} fontSize={S(34)} color={PAL.text} width="100%" height={S(48)} />
      </Frame>
    </Layer>
  )
}

// ---- NPC conversation: a panel at the bottom of the screen, Next / Close ----
export function NpcDialog() {
  const d = cs.dialog
  if (!d) return null
  const last = d.page >= d.pages.length - 1
  const w = fit(S(1100))
  const h = S(250)
  return (
    <Layer justify="flex-end" pad={{ bottom: S(60) + BOTTOM_RESERVE() }}>
      <Frame width={w} height={h} edge={PAL.violet} fill={PAL.cream} radius={S(28)} border={S(6)} pad={S(22)} align="flex-start" justify="center" block>
        <Label value={d.name} fontSize={S(30)} font="sans-serif" color={PAL.violet} textAlign="middle-left" uiTransform={{ width: '100%', height: S(40) }} />
        <Label value={d.pages[d.page]} fontSize={S(28)} font="sans-serif" color={PAL.ink} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: '100%', height: S(110) }} />
        <UiEntity uiTransform={{ width: '100%', height: S(60), flexDirection: 'row', justifyContent: 'flex-end', pointerFilter: 'none' }}>
          <PillButton id="npc-close" label="Close" width={S(150)} height={S(52)} font={S(24)} margin={{ right: S(12) }} onClick={() => (cs.dialog = null)} />
          <PillButton
            id="npc-next"
            label={last ? 'Done' : 'Next'}
            width={S(170)}
            height={S(52)}
            font={S(24)}
            tint={PAL.green}
            onClick={() => (cs.dialog = last || !cs.dialog ? null : { ...cs.dialog, page: cs.dialog.page + 1 })}
          />
        </UiEntity>
      </Frame>
    </Layer>
  )
}

// ---- inventory: the power-ups you own, as buttons on the right while you play ----
const ITEM_TINT: Record<string, typeof PAL.cyan> = { wildcard: PAL.yellow, freeze: PAL.cyan, reroll: PAL.purple, bomb: PAL.red }
function ItemBar(props: { g: Game | null; beside?: boolean }) {
  const owned = ownedItems()
  if (owned.length === 0 || !props.g || props.g.phase !== 'playing') return null
  // Under the side column's buttons, or in its own column beside them when the screen is too short (see hudLayout).
  const w = SIDE_W()
  return (
    <UiEntity uiTransform={{ width: w, margin: props.beside ? { right: S(10) } : { top: S(10) }, flexDirection: 'column', alignItems: 'flex-end', pointerFilter: 'none' }}>
      {owned.map((i) => (
        <PillButton
          key={`item-${i.id}`}
          id={`item-${i.id}`}
          label={`${i.name}  x${cs.items[i.id]}`}
          width={w}
          height={ITEM_H()}
          font={S(22)}
          tint={ITEM_TINT[i.id]}
          margin={{ top: ITEM_GAP() }}
          onClick={() => room.send('useItem', { item: i.id })}
        />
      ))}
    </UiEntity>
  )
}

// ---- settings: on/off switches, saved with your profile ----
export function SettingsPanel() {
  const w = fit(S(820))
  const rowH = S(96)
  const h = S(110) + SETTINGS.length * rowH + S(90)
  const toggle = (id: string, on: boolean) => {
    cs.settings = { ...cs.settings, [id]: on }
    if (!C.UI_PREVIEW) room.send('setSetting', { key: id, value: on ? 1 : 0 })
  }
  return (
    <Layer>
      <Frame width={w} height={h} edge={PAL.violet} fill={PAL.cream} radius={S(30)} border={S(6)} pad={S(22)} align="center" justify="flex-start" block>
        <Label value="Settings" fontSize={S(44)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: S(64) }} />
        {SETTINGS.map((s) => {
          const on = setting(s.id)
          return (
            <UiEntity key={`set-${s.id}`} uiTransform={{ width: '100%', height: rowH, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
              <UiEntity uiTransform={{ width: w - S(260), height: rowH, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
                <Label value={s.label} fontSize={S(30)} font="sans-serif" color={PAL.ink} textAlign="middle-left" uiTransform={{ width: '100%', height: S(42) }} />
                <Label value={s.desc} fontSize={S(20)} font="sans-serif" color={c(0.45, 0.35, 0.6, 1)} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: '100%', height: S(44) }} />
              </UiEntity>
              <PillButton id={`set-btn-${s.id}`} label={on ? 'On' : 'Off'} width={S(150)} height={S(56)} font={S(26)} tint={on ? PAL.green : c(0.6, 0.55, 0.7, 0.8)} onClick={() => toggle(s.id, !on)} />
            </UiEntity>
          )
        })}
        <PillButton id="settings-close" label="Close" width={S(220)} height={S(60)} font={S(28)} margin={{ top: S(10) }} onClick={() => (cs.showSettings = false)} />
      </Frame>
    </Layer>
  )
}

// ---- the vendor's shop ----
export function ShopPanel() {
  const w = fit(S(1020))
  const rowH = S(112)
  const h = S(150) + ITEMS.length * rowH + S(86)
  return (
    <Layer>
      <Frame width={w} height={h} edge={PAL.violet} fill={PAL.cream} radius={S(30)} border={S(6)} pad={S(22)} align="center" justify="flex-start" block>
        <UiEntity uiTransform={{ width: '100%', height: S(64), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', pointerFilter: 'none' }}>
          <Label value="Cubby's Shop" fontSize={S(44)} font="sans-serif" color={PAL.ink} textAlign="middle-left" uiTransform={{ width: '60%', height: '100%' }} />
          <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
            <CoinIcon size={S(36)} margin={{ right: S(8) }} />
            <Label value={`${coins()}`} fontSize={S(34)} font="sans-serif" color={c(0.75, 0.5, 0.05, 1)} textWrap="nowrap" uiTransform={{ width: S(110), height: S(44) }} />
          </UiEntity>
        </UiEntity>
        {ITEMS.map((i) => {
          const afford = coins() >= i.price
          return (
            <UiEntity key={`shop-${i.id}`} uiTransform={{ width: '100%', height: rowH, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
              <Frame width={S(64)} height={S(64)} edge={ITEM_TINT[i.id]} fill={PAL.cream} radius={S(16)} border={S(5)} align="center" justify="center" margin={{ left: S(6), right: S(16) }}>
                <Label value={`${cs.items[i.id] ?? 0}`} fontSize={S(30)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: '100%' }} />
              </Frame>
              <UiEntity uiTransform={{ width: w - S(470), height: rowH, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
                <Label value={i.name} fontSize={S(30)} font="sans-serif" color={PAL.ink} textAlign="middle-left" uiTransform={{ width: '100%', height: S(40) }} />
                <Label value={i.desc} fontSize={S(20)} font="sans-serif" color={c(0.45, 0.35, 0.6, 1)} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: '100%', height: S(54) }} />
              </UiEntity>
              <UiEntity uiTransform={{ width: S(190), height: rowH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
                <CoinIcon size={S(30)} margin={{ right: S(6) }} />
                <Label value={`${i.price}`} fontSize={S(30)} font="sans-serif" color={c(0.75, 0.5, 0.05, 1)} textWrap="nowrap" uiTransform={{ width: S(90), height: S(40) }} />
              </UiEntity>
              <PillButton id={`buy-${i.id}`} label="Buy" width={S(150)} height={S(56)} font={S(26)} tint={afford ? PAL.green : c(0.6, 0.55, 0.7, 0.8)} onClick={() => room.send('buy', { item: i.id })} />
            </UiEntity>
          )
        })}
        <PillButton id="shop-close" label="Close" width={S(220)} height={S(60)} font={S(28)} margin={{ top: S(8) }} onClick={() => (cs.shop = false)} />
      </Frame>
    </Layer>
  )
}

// ---- how to play: opens by itself the first time you enter the game, and from the "How to play" buttons ----
export function HowToPlay() {
  const phone = mobile()
  const w = fit(S(900))
  const rowH = S(96)
  const h = fitH(S(650))
  const font = S(26)
  const rows: { color: typeof PAL.red; text: string }[] = [
    { color: PAL.orange, text: phone ? 'Tap a cube in the pile to grab it. Dig around: the letters you need are in there.' : 'Click a cube in the pile to grab it. Dig around: the letters you need are in there.' },
    { color: PAL.green, text: phone ? 'Tap a frame to throw the cube in. The right letter in the right spot stays.' : 'Click a frame to throw the cube in. The right letter in the right spot stays.' },
    { color: PAL.red, text: 'A wrong letter collapses the word and briefly locks your cube actions. Needed letters cannot be broken.' },
    { color: PAL.cyan, text: phone ? 'Not sure? Break extra cubes for coins. Coins buy hints.' : 'Not sure? Break extra cubes for coins (E) or throw them away (F). Coins buy hints.' }
  ]
  return (
    <Layer>
      <Frame width={w} height={h} edge={PAL.violet} fill={PAL.cream} radius={S(30)} border={S(6)} pad={S(24)} align="center" justify="center" block>
        <Label value="How to play" fontSize={S(46)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: S(64) }} />
        {rows.map((r, i) => (
          <UiEntity key={`how${i}`} uiTransform={{ width: '100%', height: rowH, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
            <Frame width={S(56)} height={S(56)} edge={r.color} fill={PAL.cream} radius={S(28)} border={S(5)} align="center" justify="center" margin={{ left: S(10), right: S(16) }}>
              <Label value={`${i + 1}`} fontSize={S(30)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: '100%' }} />
            </Frame>
            <Label value={r.text} fontSize={font} font="sans-serif" color={PAL.ink} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: w - S(150), height: rowH }} />
          </UiEntity>
        ))}
        <Label value="When a round ends, everyone votes: easier, the same, or harder." fontSize={S(22)} font="sans-serif" color={c(0.45, 0.35, 0.6, 1)} uiTransform={{ width: '100%', height: S(40) }} />
        <PillButton id="howto-close" label="Got it!" width={S(260)} height={S(64)} font={S(30)} tint={PAL.green} margin={{ top: S(6) }} onClick={() => (cs.showHowTo = false)} />
      </Frame>
    </Layer>
  )
}

export function updateHud() {
  const g = game()
  if (g) track(g)
  if (!g || g.phase !== 'vote' || votedRound !== g.round) {
    votedRound = g?.round ?? -1
    myVote = null
  }
}

export function GameHud() {
  const g = game()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}>
      {g && <WordPanel g={g} />}
      {g && g.phase === 'vote' && <VoteScreen g={g} />}
      {g && <ResultBanner g={g} />}
      {g && g.phase === 'playing' && <LevelBanner />}
      <SidePanel g={g} />
      <BottomArea />
    </UiEntity>
  )
}

// The latest message ("Joining game 2...", "You left game 2", "Game 3 is full") while you are in the lobby.
export function LobbyMessage() {
  const text = cs.message
  if (text === '') return null
  const msgFont = S(30)
  const msgW = clamp(estW(text, msgFont) + S(60), S(200), fit(view().w, 0.8))
  return (
    <Layer justify="flex-end" pad={{ bottom: S(36) + BOTTOM_RESERVE() }}>
      <Frame width={msgW} height={S(56)} edge={PAL.violetLight} fill={PAL.violetDark} radius={S(28)} align="center" justify="center">
        <Label value={text} fontSize={msgFont} font="sans-serif" color={PAL.text} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
      </Frame>
    </Layer>
  )
}

// Shown while standing on the start pad in the lobby.
export function LobbyCountdown() {
  const n = cs.lobbyCountdown
  const urgent = n <= 3
  // No panel: big outlined text in the middle of the screen so the world stays visible behind it.
  const h = S(56) + S(190) + S(34)
  return (
    <Layer>
      <UiEntity uiTransform={{ width: '100%', height: h, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        <OutlineLabel value="Game starts in" fontSize={S(44)} color={PAL.text} width="100%" height={S(56)} />
        <OutlineLabel value={`${n}`} fontSize={S(urgent ? 170 : 130)} color={urgent ? PAL.pink : PAL.yellow} width="100%" height={S(190)} />
        <OutlineLabel value="Step off the pad to cancel" fontSize={S(24)} color={PAL.text} width="100%" height={S(34)} />
      </UiEntity>
    </Layer>
  )
}

// Server messages that only the HUD cares about.
export function setupHudMessages() {
  room.onMessage('profile', (d) => {
    if (rankIndex(d.rating) > rankIndex(cs.rating) && cs.rating > 0) showMessage(`Rank up! You are now a ${rankName(d.rating)}`, 4)
    cs.rating = d.rating
    cs.items = { wildcard: d.wildcard, reroll: d.reroll, freeze: d.freeze, bomb: d.bomb }
    try {
      cs.settings = JSON.parse(d.settings || '{}')
    } catch (e) {
      cs.settings = {}
    }
  })
  room.onMessage('result', (d) => {
    cs.delta = d.delta
    cs.earned = d.coins
    const g = myState()
    if (g) cs.earnedRound = g.round
  })
  room.onMessage('lockout', (d) => {
    cs.lockoutUntil = Date.now() + d.seconds * 1000
  })
}

// Lobby: your coins and rank, top right. (Rank is a placeholder until ratings are stored per player.)
export function LobbyHud() {
  const w = SIDE_W()
  return (
    <Layer align="flex-end" justify="flex-start" pad={{ top: S(24) + TOP_RESERVE(), right: EDGE() + RIGHT_RESERVE() }}>
      <Frame width={w} height={S(150)} edge={PAL.violetLight} fill={PAL.violetDark} radius={S(20)} pad={S(10)} align="center" justify="center">
        <CoinsRow size={S(34)} />
        <OutlineLabel value="Rank" fontSize={S(18)} color={PAL.dim} width="100%" height={S(24)} />
        <OutlineLabel value={rankName(cs.rating)} fontSize={S(30)} color={PAL.pink} width="100%" height={S(38)} />
      </Frame>
      <PillButton id="howto-lobby" label="How to play" width={w} height={S(54)} font={S(22)} tint={PAL.cyan} margin={{ top: S(10) }} onClick={() => (cs.showHowTo = true)} />
      <PillButton id="settings-lobby" label="Settings" width={w} height={S(54)} font={S(22)} margin={{ top: S(8) }} onClick={() => (cs.showSettings = true)} />
    </Layer>
  )
}

// ---- Top players: appears in the lobby while you stand near the Leaderboard sign ----
let signEntity: ReturnType<typeof engine.getEntityOrNullByName> = null
const shortAddress = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`
const nameOf = (address: string): string => {
  const p = getPlayer({ userId: address })
  return p && p.name ? p.name : shortAddress(address)
}

export function LeaderboardPanel() {
  if (cs.inGame) return null
  if (!signEntity) signEntity = engine.getEntityOrNullByName(EntityNames.Leaderboard_glb)
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!signEntity || !me || !Transform.getOrNull(signEntity)) return null
  const sign = worldPosition(signEntity)
  if (Math.hypot(me.x - sign.x, me.z - sign.z) > 14) return null
  const top: [string, number][] = parseBoard(boardText())
  const w = S(430)
  const rowH = S(46)
  const h = S(120) + Math.max(1, top.length) * rowH
  return (
    <Layer align="flex-start" pad={{ left: EDGE() }}>
      <Frame width={w} height={h} edge={PAL.violetLight} fill={PAL.violetDark} radius={S(22)} border={S(5)} pad={S(14)} align="center" justify="flex-start">
        <OutlineLabel value="Top players" fontSize={S(32)} color={PAL.yellow} width="100%" height={S(52)} />
        {top.length === 0 && <OutlineLabel value="Nobody ranked yet" fontSize={S(22)} color={PAL.dim} width="100%" height={rowH} />}
        {top.map(([address, rating], i) => (
          <UiEntity key={`lb${i}`} uiTransform={{ width: '100%', height: rowH, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
            <OutlineLabel value={`${i + 1}`} fontSize={S(24)} color={PAL.yellow} width={S(40)} height={rowH} />
            <OutlineLabel value={nameOf(address)} fontSize={S(22)} color={PAL.text} width={S(190)} height={rowH} align="middle-left" />
            <OutlineLabel value={rankName(rating)} fontSize={S(20)} color={PAL.pink} width={S(150)} height={rowH} align="middle-right" />
          </UiEntity>
        ))}
      </Frame>
    </Layer>
  )
}
