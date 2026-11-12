import { netMon, toggleNetMonitor } from '../netstats'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import { myState, stateOf as stateOfGame } from '../gamestate'
import { cs, lockoutLeft, showMessage, setting, volumeLevel } from '../state'
import { SFX, playSfx, onItems, onProfileLoaded, talkSfx } from '../audio'
import { heldLetter as realHeldLetter } from '../cubes'
import * as C from '../../config'
import { room } from '../../shared/messages'
import { returnToLobby, pressStart, pressJoin, gameLang } from '../lobby'
import { LANGS, LANG_NAMES, type Lang } from '../../shared/lang'
import { t, uiLang, pickUiLang } from '../i18n'
import { Flag, flagAspect } from './flags'
import { clickSlot } from '../arena'
import { MAX_DIFFICULTY, ITEMS, SETTINGS } from '../../config'
import { mobile, EDGE, RIGHT_RESERVE, TOP_RESERVE, BOTTOM_RESERVE, LEFT_RESERVE, dialogScale, S, view } from './platform'
import { PAL, Frame, OutlineLabel, PillButton, LetterTile, CoinIcon, TileState, clamp, c, darken, lighten, OUTLINE, Edges, hovered, hover } from './theme'
import { rankIndex } from './rank'
import { dbg, debugWord } from './debug'
import { startTutorial } from '../tutorial'
import { CubbyStrip, NameTab, CartoonButton, BUTTON_ASPECT } from '../../ui/TutorialOverlay'

type Game = { frozen: number; players: number; builders: number; hintCost: number; phase: string; round: number; difficulty: number; timeLeft: number; voteLeft: number; voteDown: number; voteSame: number; voteUp: number; completed: number; question: string; length: number; masked: string; hint: string }

function game(): Game | null {
  if (C.UI_PREVIEW) return mockGame()
  return (myState() as unknown as Game | undefined) ?? null
}

// ---- UI preview (config UI_PREVIEW): a fake 16 second round that loops, so the HUD can be checked without a server ----
const MOCK_LOOP = 16
const mockT = () => (Date.now() / 1000) % MOCK_LOOP
const mockRound = () => Math.floor(Date.now() / 1000 / MOCK_LOOP) + 1

function mockGame(): Game {
  const { answer: MOCK_WORD, question } = debugWord() // the word length picked in the debug bar
  const firstTwo = (ch: string, i: number) => (i < 2 ? ch : '_')
  // a still frame of one moment, picked in the debug bar (debug.tsx); 'game' plays the looping round below
  const still: Game = { frozen: 0, players: 3, builders: 2, hintCost: 10, phase: 'playing', voteLeft: 10, voteDown: 1, voteSame: 1, voteUp: 2, round: 1, difficulty: 2, timeLeft: 185, completed: 0, question, length: MOCK_WORD.length, masked: MOCK_WORD.split('').map(firstTwo).join(''), hint: '' }
  switch (dbg.screen) {
    case 'game':
      break
    case 'lowtime':
      return { ...still, timeLeft: 22 }
    case 'frozen':
      return { ...still, frozen: 8 }
    case 'won':
      return { ...still, phase: 'won', masked: MOCK_WORD }
    case 'timeout':
      return { ...still, phase: 'timeout', hint: MOCK_WORD }
    case 'vote':
      return { ...still, phase: 'vote', masked: MOCK_WORD }
    default:
      return still
  }
  const t = mockT()
  // locks: P at 1, A at 2, R at 3, then a wrong cube collapses everything at 4.5; hint at 6; then all five lock 8..12; win from 12
  let placed = 0
  if (t >= 1 && t < 4.5) placed = Math.min(3, Math.floor(t - 0))
  if (t >= 8) placed = Math.min(MOCK_WORD.length, Math.floor(((t - 8) / 4) * MOCK_WORD.length) + 1) // all of it by 12
  const masked = MOCK_WORD.split('').map((ch, i) => (i < placed ? ch : '_')).join('')
  const hint = t >= 6 && t < 12 ? MOCK_WORD.split('').map(firstTwo).join('') : ''
  return { frozen: 0, players: 3, builders: 2, hintCost: 10, phase: t >= 13 ? 'vote' : t >= 12 ? 'won' : 'playing', voteLeft: Math.max(0, Math.ceil(MOCK_LOOP - t)), voteDown: 0, voteSame: 1, voteUp: t >= 14 ? 2 : 0, round: mockRound(), difficulty: 1, timeLeft: Math.max(0, 240 - Math.floor(t)), completed: mockRound() - 1, question, length: MOCK_WORD.length, masked, hint }
}

/** Your rank's name in the UI language. */
const rankName = (rating: number) => t(`rank.${rankIndex(rating)}`)

const heldLetter = (): string => {
  if (!C.UI_PREVIEW) return realHeldLetter()
  if (dbg.screen === 'holding') return debugWord().answer[2]
  if (dbg.screen !== 'game') return ''
  const t = mockT()
  return t >= 0.2 && t < 1 ? debugWord().answer[0] : t >= 4 && t < 4.5 ? 'O' : ''
}
const mockMessage = (): string => {
  if (dbg.screen !== 'game') return ''
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
const ITEM_TILE = () => S(84) // the power-up tiles: two columns of square cartoon tiles
const ITEM_GAP = () => S(16)
const ITEMS_H = () => S(10) + 2 * ITEM_TILE() + ITEM_GAP() + S(8)
function ownedItems() {
  return ITEMS.filter((i) => (cs.items[i.id] ?? 0) > 0)
}
// Phones: one slim bar at the top right: time and level | the letter tiles | coins. The question sits under it as
// bare text. Everything you look at while playing is in one place, and the rest of the screen stays free.
const BAR_TIME_W = () => S(150)
const BAR_COINS_W = () => S(110)
const BAR_PAD = () => S(8)
const BAR_DIVIDER = () => S(3)
function mobileLayout(g: Game | null) {
  const v = view()
  const right = 0 // the renderer already applies the device safe area
  const n = Math.max(g?.length ?? 1, 1)
  const gap = S(TILE_GAP)
  // Right aligned, clear of the app's top-left buttons; long words can expand towards the centre.
  const minLeft = Math.round(v.w * C.MOBILE_APP_BUTTONS_RIGHT) + S(12)
  const room = v.w - right - minLeft
  const fixed = BAR_TIME_W() + BAR_COINS_W() + 2 * BAR_DIVIDER() + 4 * BAR_PAD()
  const maxW = Math.min(room, Math.max(Math.round(v.w * 0.43), fixed + n * (S(16) + gap)))
  const tile = Math.min(S(40), Math.max(S(16), Math.floor((maxW - fixed) / n) - gap))
  const rowW = n * (tile + gap)
  const panelW = fixed + rowW
  const left = v.w - right - panelW
  const barH = Math.round(v.h * C.MOBILE_TOP_BAR_HEIGHT)
  const top = Math.round(v.h * C.MOBILE_TOP_BAR_TOP)
  return { top, right, left, reserve: Math.max(0, v.w - left - panelW), panelW, tile, gap, rowW, barH, sideW: 0, columnH: 0, itemsH: 0, itemsBeside: false }
}

export function hudLayout(g: Game | null) {
  if (mobile()) return mobileLayout(g)
  const v = view()
  const top = S(24) + TOP_RESERVE()
  const right = EDGE() + RIGHT_RESERVE()
  const columnH = S(150) + S(10) + S(66) + 3 * (S(8) + S(54)) // stats frame + hint + three buttons
  // the power-up tiles are always there while playing (greyed out when you have none of one)
  const items = g && g.phase === 'playing' ? ITEMS.length : 0
  const itemsH = items > 0 ? ITEMS_H() : 0
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
  return { top, right, left, reserve, panelW, tile, gap, rowW: n * (tile + gap), barH: 0, sideW, columnH, itemsH, itemsBeside }
}
// A panel width that never runs off a narrow screen.
const fit = (w: number, share = 0.92) => Math.min(w, Math.round(view().w * share))
const fitH = (h: number, share = 0.92) => Math.min(h, Math.round(view().h * share))

function WordPanel(props: { g: Game }) {
  const { g } = props
  const n = Math.max(g.length, 1)
  const { top, left, reserve, panelW, tile, gap, rowW, barH } = hudLayout(g)
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

  // Phones: the slim top bar (time and level | tiles | coins) and the question under it as bare outlined text.
  if (mobile()) {
    const font = S(22)
    const lines = Math.round(g.question.length * font * 0.55) > panelW ? 2 : 1
    const divider = <UiEntity uiTransform={{ width: BAR_DIVIDER(), height: '60%', margin: { left: BAR_PAD(), right: BAR_PAD() } }} uiBackground={{ color: PAL.violetLight }} />
    const text = `${coins()}`
    return (
      <Layer justify="flex-start" align="flex-start" pad={{ top, left, right: reserve }}>
        <Frame width={panelW} height={barH} edge={PAL.violetLight} fill={PAL.violetGlass} radius={barH / 2} border={S(3)} dir="row" align="center" justify="center">
          <UiEntity uiTransform={{ width: BAR_TIME_W(), height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
            <OutlineLabel value={timeText(g)} fontSize={S(28)} color={timeColor(g)} width={S(g.frozen > 0 ? 110 : 80)} height={S(40)} />
            <OutlineLabel value={t('hud.levelShort', { n: g.difficulty })} fontSize={S(18)} color={PAL.dim} width={S(50)} height={S(30)} />
          </UiEntity>
          {divider}
          <UiEntity uiTransform={{ width: rowW, height: tile, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>{tiles}</UiEntity>
          {divider}
          <UiEntity uiTransform={{ width: BAR_COINS_W(), height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
            <CoinIcon size={S(26)} margin={{ right: S(6) }} />
            <OutlineLabel value={text} fontSize={S(24)} color={PAL.yellow} width={Math.max(S(30), Math.round(text.length * S(24) * 0.62))} height={S(32)} align="middle-left" />
          </UiEntity>
        </Frame>
        <OutlineLabel value={g.question || t('word.connecting')} fontSize={font} color={PAL.text} width={panelW} height={Math.round(font * 1.4 * lines) + S(8)} align="middle-right" wrap soft />
      </Layer>
    )
  }

  // Only the question sits in a panel (a cream block face). The letter tiles float on their own under it.
  return (
    <Layer justify="flex-start" pad={{ top, left, right: reserve }}>
      <Frame width={qW} height={qH} edge={PAL.violet} fill={PAL.cream} radius={S(22)} border={S(5)} align="center" justify="center">
        <Label
          value={g.question || t('word.connecting')}
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

const timeText = (g: Game | null) => (g ? (g.frozen > 0 ? t('hud.frozen', { s: g.frozen }) : clock(g.timeLeft)) : '')
const timeColor = (g: Game | null) => (g && g.frozen > 0 ? PAL.cyan : g && g.timeLeft <= 30 && g.phase === 'playing' ? PAL.pink : PAL.text)

// Coins, level, time and the two buttons, stacked at the top right.
function SidePanel(props: { g: Game | null }) {
  const { g } = props
  if (mobile()) return null // phones: the stats are in the top bar, the buttons are native (setup.ts)
  const w = SIDE_W()
  const L = hudLayout(g)
  const column = (
    <UiEntity uiTransform={{ width: w, flexDirection: 'column', alignItems: 'flex-end', pointerFilter: 'none' }}>
      <Frame width={w} height={S(150)} edge={PAL.violetLight} fill={PAL.violetDark} radius={S(20)} pad={S(10)} align="center" justify="center">
        <CoinsRow size={S(34)} />
        <OutlineLabel value={g ? t('hud.levelRank', { n: g.difficulty, rank: rankName(cs.rating) }) : ''} fontSize={S(22)} color={PAL.dim} width="100%" height={S(30)} />
        <OutlineLabel value={timeText(g)} fontSize={S(36)} color={timeColor(g)} width="100%" height={S(46)} />
      </Frame>
      <PillButton id="hint" label={g && g.hintCost > 0 ? t('hud.hint') : t('hud.noHints')} cost={g && g.hintCost > 0 ? g.hintCost : undefined} width={w} height={S(66)} font={S(28)} tint={PAL.pink} margin={{ top: S(10) }} onClick={() => room.send('hint', { n: 0 })} />
      <PillButton id="howto-game" label={t('hud.howTo')} width={w} height={S(54)} font={S(22)} margin={{ top: S(8) }} onClick={() => (cs.showHowTo = true)} />
      <PillButton id="settings-game" label={t('hud.settings')} width={w} height={S(54)} font={S(22)} margin={{ top: S(8) }} onClick={() => (cs.showSettings = true)} />
      <PillButton id="lobby" label={t('hud.backToLobby')} width={w} height={S(54)} font={S(22)} tint={PAL.cyan} margin={{ top: S(8) }} onClick={returnToLobby} />
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

// The latest message as a toast at the top left, under the app's buttons and left of the top bar's question,
// instead of a wide pill at the bottom. Narrow, so long messages wrap onto a few short lines.
// The server's texts name the desktop keys ("E to break", "throw it back with F"): on a phone those keys are the native
// buttons, so they show as the same icons inline, and "Click" reads "Tap".
const KEY_ICONS: Record<string, string> = { E: 'assets/images/ui/cartoon-break.png', F: 'assets/images/ui/cartoon-toss.png' }
type ToastPiece = { text: string } | { icon: string; after: string }
export function toastPieces(text: string): ToastPiece[] {
  const words = text.split(' ').filter((w) => w !== '')
  return words.map((word, i) => {
    const key = /^([EF])([.,!?]?)$/.exec(word)
    // "Holding E." is the letter in your hand, not a key
    if (key && words[i - 1] !== t('toast.holdingWord')) return { icon: KEY_ICONS[key[1]], after: key[2] }
    return { text: word === 'Click' ? 'Tap' : word === 'click' ? 'tap' : word }
  })
}

// The toast on screen, kept by the HUD system (updateHud) so it can slide out after the message is gone.
const TOAST_IN_MS = 220
const TOAST_OUT_MS = 380
let toast = { text: '', kind: '', at: 0, leaving: 0 }
function trackToast() {
  const text = message()
  const now = Date.now()
  if (text !== '' && text !== toast.text) toast = { text, kind: cs.messageKind, at: now, leaving: 0 }
  else if (text !== '' && toast.leaving) toast = { text, kind: cs.messageKind, at: now, leaving: 0 }
  else if (text === '' && toast.text !== '' && !toast.leaving) toast.leaving = now
  else if (toast.leaving && now - toast.leaving > TOAST_OUT_MS) toast = { text: '', kind: '', at: 0, leaving: 0 }
}
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
/** The toast now, and how far it has slid (px): from the right as it comes in, off to the left as it goes. */
export function HudToast() {
  if (toast.text === '') return null
  const now = Date.now()
  const enter = 1 - ease((now - toast.at) / TOAST_IN_MS)
  const leave = toast.leaving ? ease((now - toast.leaving) / TOAST_OUT_MS) : 0
  return <Toast text={toast.text} plain={toast.kind === 'powerup'} shift={Math.round(enter * S(60) - leave * view().w * 0.5)} />
}

export function Toast(props: { text: string; plain?: boolean; shift?: number }) {
  if (props.text === '') return null
  const font = S(20)
  const icon = Math.round(font * 1.5)
  const left = mobile() ? 0 : EDGE() + S(40) // mobile renderer already applies the device safe area
  const w = mobile() ? Math.min(S(360), Math.max(S(200), mobileLayout(null).left - S(16) - left)) : S(360) // ends before the top bar (and its question) starts
  const inner = w - S(28)
  const pieces: ToastPiece[] = mobile() && !props.plain ? toastPieces(props.text) : [{ text: props.text }]
  const withIcons = pieces.some((p) => 'icon' in p)
  // Word by word (only needed for the icons): each word gets a generous width of its own, since glyphs run wider than
  // the usual estimate, and a full space after it. Without icons the text is one Label with real spaces.
  const space = Math.round(font * 0.45)
  const wordW = (t: string) => Math.round(t.length * font * 0.62)
  const widthOf = (p: ToastPiece) => ('icon' in p ? icon + wordW(p.after) : wordW(p.text)) + space
  // lay the words out like text wrapping does, to know how many lines the toast needs
  let lines = withIcons ? 1 : Math.ceil((estW(props.text, font) * 1.1) / inner) || 1
  let x = 0
  if (withIcons) for (const p of pieces) {
    const pw = widthOf(p)
    if (x > 0 && x + pw > inner) {
      lines++
      x = 0
    }
    x += pw
  }
  const lineH = Math.max(icon, Math.round(font * 1.35))
  const h = Math.min(4, lines) * lineH + S(22)
  const top = mobile()
    ? mobileLayout(null).top + mobileLayout(null).barH + S(24)
    : S(170)
  return (
    <Layer justify="flex-start" align="flex-start" pad={{ top, left: left + (props.shift ?? 0) }}>
      <Frame width={w} height={h} edge={PAL.violetLight} fill={PAL.violetGlass} radius={S(18)} border={S(3)} align="center" justify="center">
        {!withIcons && (
          <Label value={pieces.map((p) => ('text' in p ? p.text : '')).join(' ')} fontSize={font} font="sans-serif" color={PAL.text} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: inner, height: '100%' }} />
        )}
        {withIcons && <UiEntity uiTransform={{ width: inner, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', pointerFilter: 'none' }}>
          {pieces.map((p, i) =>
            'icon' in p ? (
              <UiEntity key={`p${i}`} uiTransform={{ width: widthOf(p), height: lineH, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
                <UiEntity
                  uiTransform={{ width: icon, height: icon, pointerFilter: 'none' }}
                  uiBackground={{ texture: { src: p.icon, filterMode: 'tri-linear', wrapMode: 'clamp' }, textureMode: 'stretch' }}
                />
                {p.after !== '' && <Label value={p.after} fontSize={font} font="sans-serif" color={PAL.text} textWrap="nowrap" textAlign="middle-left" uiTransform={{ width: wordW(p.after) + space, height: lineH }} />}
              </UiEntity>
            ) : (
              <Label key={`p${i}`} value={p.text} fontSize={font} font="sans-serif" color={PAL.text} textWrap="nowrap" textAlign="middle-left" uiTransform={{ width: widthOf(p), height: lineH }} />
            )
          )}
        </UiEntity>}
      </Frame>
    </Layer>
  )
}

// You threw a wrong letter and the word fell apart: one line with the reason and the seconds left, and a bar that runs
// down. It stays the whole lockout (a toast would be gone long before the 25 s are).
function LockoutBanner() {
  const w = fit(S(460))
  const total = Math.max(1, cs.lockoutTotal || C.COLLAPSE_LOCKOUT_SECONDS)
  const left = Math.max(0, (cs.lockoutUntil - Date.now()) / 1000)
  const barW = w - S(48)
  const fill = Math.round(barW * Math.min(1, left / total))
  const hop = swell(cs.lockoutPing, 280, 0.08) // you tried something while locked out
  return (
    <Frame width={Math.round(w * hop)} height={Math.round(S(84) * hop)} edge={PAL.pink} fill={PAL.violetDark} radius={S(22)} border={S(4)} pad={S(8)} align="center" justify="center" margin={{ bottom: S(10) }}>
      <Label value={t('lock.line', { s: Math.ceil(left) })} fontSize={S(24)} font="sans-serif" color={PAL.pink} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: S(34) }} />
      <UiEntity uiTransform={{ width: barW, height: S(10), margin: { top: S(4) }, borderRadius: S(5), pointerFilter: 'none' }} uiBackground={{ color: c(1, 1, 1, 0.15) }}>
        <UiEntity uiTransform={{ width: fill, height: '100%', borderRadius: S(5), pointerFilter: 'none' }} uiBackground={{ color: PAL.pink }} />
      </UiEntity>
    </Frame>
  )
}

// What you are holding and one line of help, centred at the bottom.
function BottomArea() {
  const held = heldLetter()
  const help = held ? t('hud.help.held') : t('hud.help.empty')
  const helpFont = S(22)
  const helpW = clamp(estW(help, helpFont) + S(50), S(200), fit(view().w, 0.8))
  const heldSize = S(76)
  return (
    <Layer justify="flex-end" pad={{ bottom: S(36) + BOTTOM_RESERVE() }}>
      {lockoutLeft() > 0 && <LockoutBanner />}
      {held !== '' && (
        <UiEntity uiTransform={{ width: heldSize + S(190), height: heldSize, margin: { bottom: S(10) }, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
          <OutlineLabel value={held === '*' ? t('hud.wildcard') : t('hud.holding')} fontSize={S(26)} color={held === '*' ? PAL.yellow : PAL.text} width={S(130)} height={heldSize} />
          <LetterTile size={heldSize} index={held.charCodeAt(0)} letter={held === '*' ? '?' : held} state="locked" />
        </UiEntity>
      )}
      {/* locked out: the banner says it all; "tap a cube to grab it" would be wrong for its whole length */}
      {lockoutLeft() <= 0 && (
        <Frame width={helpW} height={S(40)} edge={c(0, 0, 0, 0)} fill={c(0.2, 0.1, 0.4, 0.6)} radius={S(20)} border={0} align="center" justify="center">
          <Label value={help} fontSize={helpFont} font="sans-serif" color={PAL.dim} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
        </Frame>
      )}
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
        <Label value={t('vote.title')} fontSize={S(40)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: S(56) }} />
        <Label
          value={t('vote.sub', { n: g.difficulty, s: g.voteLeft })}
          fontSize={S(22)}
          font="sans-serif"
          color={c(0.45, 0.35, 0.6, 1)}
          uiTransform={{ width: '100%', height: S(34) }}
        />
        <UiEntity uiTransform={{ width: '100%', height: bh + S(26), margin: { top: S(8) }, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>
          {option('vote-down', t('vote.easier'), -1, g.voteDown, PAL.cyan, can.down)}
          {option('vote-same', t('vote.same'), 0, g.voteSame, PAL.violetLight, true)}
          {option('vote-up', t('vote.harder'), 1, g.voteUp, PAL.pink, can.up)}
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
        <Label value={won ? t('result.won') : t('result.timeout')} fontSize={S(42)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: S(56) }} />
        <Label
          value={won ? (g.builders === 1 ? t('result.builtBy.one') : t('result.builtBy', { n: g.builders })) : t('result.nobody')}
          fontSize={S(24)}
          font="sans-serif"
          color={c(0.45, 0.35, 0.6, 1)}
          uiTransform={{ width: '100%', height: S(34) }}
        />
        {mine && cs.earnedRound === g.round && cs.delta !== 0 && (
          <Label
            value={t('result.rating', { delta: `${cs.delta > 0 ? '+' : ''}${cs.delta}` })}
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
        <OutlineLabel value={t('level.banner', { from: levelFrom, to: levelTo, dir: up ? '@level.harder' : '@level.easier' })} fontSize={S(34)} color={PAL.text} width="100%" height={S(48)} />
      </Frame>
    </Layer>
  )
}

// ---- Cubby's "replay the tutorial?" prompt: the tutorial's own strip, name tab and cartoon buttons ----
// Same proportions as client/tutorial.ts (layoutDialog): a phone draws it on a 720-tall canvas, a desktop a bit smaller.
function CubbyReplayPrompt(props: { text: string; name: string }) {
  const phone = mobile()
  const screen = view()
  const px = (n: number) => Math.round(n * dialogScale(screen))
  // right of the desktop chat column, inside the screen margins
  const areaL = Math.max(EDGE(), LEFT_RESERVE())
  const areaW = screen.w - EDGE() - areaL
  const gap = px(16)
  const btnH0 = px(phone ? 84 : 94)
  const stripMax = phone ? Math.min(px(760), Math.round(screen.w * 0.44)) : px(1034)
  const k = Math.min(1, areaW / (stripMax + 2 * (gap + Math.round(btnH0 * BUTTON_ASPECT))))
  const stripW = Math.round(stripMax * k)
  const stripH = Math.round(stripW * 150 / 1024)
  const btnH = Math.round(btnH0 * k)
  const btnW = Math.round(btnH * BUTTON_ASPECT)
  const left = areaL + Math.round((areaW - (stripW + 2 * (gap + btnW))) / 2)
  const bottom = Math.max(px(24), BOTTOM_RESERVE() / 3)
  const pad = Math.round(stripW * 0.05)
  const textW = stripW - 2 * pad
  const font = Math.max(px(21), Math.min(px(28), Math.floor(2 * textW / Math.max(1, props.text.length) / 0.56)))
  const yes = t('npc.cubby.replayYes')
  const no = t('npc.cubby.replayNo')
  const btnFont = (label: string) => Math.min(Math.round(btnH * 0.32), Math.floor((btnW * 0.78) / Math.max(4, label.length) / 0.6))
  const btnBottom = bottom + Math.round((stripH - btnH) / 2)
  const tabH = px(44)
  const tabFont = px(24)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}>
      <CubbyStrip left={left} bottom={bottom} w={stripW} h={stripH} />
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left, bottom }, width: stripW, height: stripH, padding: { left: pad, right: pad }, alignItems: 'center', pointerFilter: 'block' }}>
        <Label value={props.text} font="sans-serif" fontSize={font} color={PAL.ink} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: textW, height: Math.ceil(2 * font * 1.25) }} />
      </UiEntity>
      <NameTab name={props.name} left={left + Math.round(stripW * 0.07)} bottom={bottom + stripH - Math.round(tabH * 0.3)} w={Math.round(props.name.length * tabFont * 0.62) + px(40)} h={tabH} font={tabFont} />
      <CartoonButton id="npc-close" variant="secondary" label={no} left={left + stripW + gap} bottom={btnBottom} w={btnW} h={btnH} font={btnFont(no)} onClick={() => (cs.dialog = null)} />
      <CartoonButton id="npc-next" label={yes} left={left + stripW + 2 * gap + btnW} bottom={btnBottom} w={btnW} h={btnH} font={btnFont(yes)} onClick={() => { cs.dialog = null; startTutorial() }} />
    </UiEntity>
  )
}

// ---- NPC conversation: a panel at the bottom of the screen, Next / Close ----
export function NpcDialog() {
  const d = cs.dialog
  if (!d) return null
  if (d.replayTutorial) return <CubbyReplayPrompt text={d.pages[d.page] ?? ''} name={d.name} />
  const last = d.page >= d.pages.length - 1
  // phones: at the bottom like on desktop, shrunk to the gap between the joystick and the native buttons (panelScale)
  const k = panelScale(1100, 250)
  const z = (n: number) => Math.round(S(n) * k)
  const w = mobile() ? z(1100) : fit(z(1100))
  const h = z(250)
  return (
    <Layer justify="flex-end" pad={{ bottom: (mobile() ? S(12) : z(60)) + BOTTOM_RESERVE() }}>
      <Frame width={w} height={h} edge={PAL.violet} fill={PAL.cream} radius={z(28)} border={z(6)} pad={z(22)} align="flex-start" justify="center" block>
        <Label value={d.name} fontSize={z(30)} font="sans-serif" color={PAL.violet} textAlign="middle-left" uiTransform={{ width: '100%', height: z(40) }} />
        <Label value={d.pages[d.page]} fontSize={z(28)} font="sans-serif" color={PAL.ink} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: '100%', height: z(110) }} />
        <UiEntity uiTransform={{ width: '100%', height: z(60), flexDirection: 'row', justifyContent: 'flex-end', pointerFilter: 'none' }}>
          <PillButton id="npc-close" label={t(d.replayTutorial ? 'npc.cubby.replayNo' : 'common.close')} width={z(d.replayTutorial ? 220 : 150)} height={z(52)} font={z(24)} margin={{ right: z(12) }} onClick={() => (cs.dialog = null)} />
          <PillButton
            id="npc-next"
            label={d.replayTutorial ? t('npc.cubby.replayYes') : last ? t('common.done') : t('common.next')}
            width={z(170)}
            height={z(52)}
            font={z(24)}
            tint={PAL.green}
            onClick={() => {
              if (d.replayTutorial) {
                cs.dialog = null
                startTutorial()
                return
              }
              if (!last) talkSfx()
              cs.dialog = last || !cs.dialog ? null : { ...cs.dialog, page: cs.dialog.page + 1 }
            }}
          />
        </UiEntity>
      </Frame>
    </Layer>
  )
}

// ---- inventory: every power-up as a cartoon tile on the right while you play; greyed out while you have none ----
export const ITEM_ICONS: Record<string, string> = {
  wildcard: 'assets/images/ui/cartoon-wildcard.png',
  freeze: 'assets/images/ui/cartoon-freeze.png',
  reroll: 'assets/images/ui/cartoon-reroll.png',
  bomb: 'assets/images/ui/cartoon-bomb.png'
}
const TILE_FACE = c(0.29, 0.17, 0.58, 1)
const TILE_FACE_HOVER = c(0.38, 0.24, 0.7, 1)
const TILE_EMPTY = c(0.42, 0.4, 0.48, 1)
const BADGE = c(0.96, 0.73, 0.16, 1)
/** One power-up: its cartoon icon on a violet tile with the count in a gold badge; grey and inert at 0. */
export function ItemTile(props: { key?: string; id: string; size: number; margin?: Edges; tooltip?: boolean; onUse: () => void }) {
  const count = cs.items[props.id] ?? 0
  const has = count > 0
  const key = `item-${props.id}`
  const pointed = !!hovered[key]
  const hov = has && pointed
  const s = props.size
  const o = Math.max(2, Math.round(s * 0.05))
  const radius = Math.round(s * 0.26)
  const face = !has ? TILE_EMPTY : hov ? TILE_FACE_HOVER : TILE_FACE
  const badge = Math.round(s * 0.42)
  return (
    <UiEntity
      key={key}
      uiTransform={{ width: s, height: s, margin: props.margin, padding: o, borderRadius: radius, pointerFilter: 'block' }}
      uiBackground={{ color: OUTLINE }}
      onMouseDown={() => {
        if (!has) return
        playSfx(SFX.click, 0.5)
        props.onUse()
      }}
      {...hover(key)}
    >
      <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: Math.max(2, radius - o), justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }} uiBackground={{ color: face }}>
        <UiEntity key="tile-shine" uiTransform={{ positionType: 'absolute', position: { top: Math.round(s * 0.05), left: radius, right: radius }, height: Math.max(2, Math.round(s * 0.06)), borderRadius: s, pointerFilter: 'none' }} uiBackground={{ color: lighten(face, 0.16) }} />
        <UiEntity key="tile-lip" uiTransform={{ positionType: 'absolute', position: { bottom: 0, left: Math.round(radius / 2), right: Math.round(radius / 2) }, height: Math.max(2, Math.round(s * 0.08)), borderRadius: s, pointerFilter: 'none' }} uiBackground={{ color: darken(face, 0.3) }} />
        <UiEntity
          key="tile-icon"
          uiTransform={{ width: Math.round(s * 0.72), height: Math.round(s * 0.72), opacity: has ? 1 : 0.45, pointerFilter: 'none' }}
          uiBackground={{ texture: { src: ITEM_ICONS[props.id], filterMode: 'tri-linear', wrapMode: 'clamp' }, textureMode: 'stretch' }}
        />
      </UiEntity>
      {props.tooltip && pointed && <ItemTooltip id={props.id} tile={s} />}
      <UiEntity key="tile-badge" uiTransform={{ positionType: 'absolute', position: { right: -Math.round(s * 0.1), bottom: -Math.round(s * 0.1) }, width: badge, height: badge, padding: o, borderRadius: Math.round(badge * 0.32), pointerFilter: 'none' }} uiBackground={{ color: OUTLINE }}>
        <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: Math.round(badge * 0.26), justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }} uiBackground={{ color: has ? BADGE : TILE_EMPTY }}>
          <Label value={`${count}`} fontSize={Math.round(badge * 0.55)} font="sans-serif" color={OUTLINE} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// Desktop hover: the power-up's name in a dark pill to the left of its tile (towards the world, clear of the grid).
function ItemTooltip(props: { id: string; tile: number }) {
  const name = t(`item.${props.id}.name`)
  const font = S(20)
  const h = S(40)
  const w = Math.round(name.length * font * 0.58) + S(32)
  const o = Math.max(2, Math.round(h * 0.07))
  return (
    <UiEntity key="tile-tooltip" uiTransform={{ positionType: 'absolute', position: { right: props.tile + S(10), top: Math.round((props.tile - h) / 2) }, width: w, height: h, padding: o, borderRadius: h / 2, pointerFilter: 'none' }} uiBackground={{ color: OUTLINE }}>
      <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: h / 2 - o, justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }} uiBackground={{ color: TILE_FACE }}>
        <Label value={name} fontSize={font} font="sans-serif" color={PAL.text} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
      </UiEntity>
    </UiEntity>
  )
}

function ItemBar(props: { g: Game | null; beside?: boolean }) {
  if (mobile() || !props.g || props.g.phase !== 'playing') return null
  // Under the side column's buttons, or in its own column beside them when the screen is too short (see hudLayout).
  const w = SIDE_W()
  const s = ITEM_TILE()
  const gap = ITEM_GAP()
  const row = (ids: string[]) => (
    <UiEntity uiTransform={{ width: w, height: s, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>
      {ids.map((id, i) => <ItemTile key={`item-${id}`} id={id} size={s} margin={{ left: i ? gap : 0 }} tooltip onUse={() => { void room.send('useItem', { item: id }) }} />)}
    </UiEntity>
  )
  return (
    <UiEntity uiTransform={{ width: w, height: ITEMS_H() - S(10), margin: props.beside ? { right: S(10) } : { top: S(10) }, flexDirection: 'column', justifyContent: 'space-between', pointerFilter: 'none' }}>
      {row(ITEMS.slice(0, 2).map((i) => i.id))}
      {row(ITEMS.slice(2, 4).map((i) => i.id))}
    </UiEntity>
  )
}

// ---- phones: every power-up as a tile (greyed out at 0), in a row opened by the native items button ----
export function ItemsRow() {
  const g = game()
  if (!mobile() || !cs.itemsOpen || !g || g.phase !== 'playing') return null
  const size = S(84)
  const cell = S(150)
  // Centred on the screen, a little low: the native buttons fan out over the bottom right when you open their "+"
  // menu, and the joystick has the bottom left. The row is short-lived: picking an item closes it.
  return (
    <Layer pad={{ top: S(120) }}>
      <Frame width={ITEMS.length * cell + S(24)} height={size + S(76)} edge={PAL.violet} fill={PAL.cream} radius={S(24)} border={S(4)} dir="row" align="center" justify="center" block>
        <PillButton id="items-close" label="X" width={S(52)} height={S(52)} font={S(24)} tint={PAL.pink} at={{ top: -S(20), right: -S(20) }} onClick={() => (cs.itemsOpen = false)} />
        {ITEMS.map((i) => (
          <UiEntity key={`row-${i.id}`} uiTransform={{ width: cell, height: size + S(64), flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
            <ItemTile
              id={i.id}
              size={size}
              onUse={() => {
                cs.itemsOpen = false
                if (!C.UI_PREVIEW) room.send('useItem', { item: i.id })
              }}
            />
            <Label value={t(`item.${i.id}.name`)} fontSize={S(16)} font="sans-serif" color={PAL.ink} textWrap="nowrap" uiTransform={{ width: cell, height: S(30), margin: { top: S(10) } }} />
          </UiEntity>
        ))}
      </Frame>
    </Layer>
  )
}

// ---- phones: "leave this game?" before the native back-to-lobby button gives your seat away ----
export function ConfirmLeave() {
  if (!cs.confirmLeave) return null
  const k = panelScale(640, 300)
  const z = (n: number) => Math.round(S(n) * k)
  return (
    <Layer>
      <Frame width={z(640)} height={z(300)} edge={PAL.violet} fill={PAL.cream} radius={z(30)} border={z(6)} pad={z(24)} align="center" justify="center" block>
        <Label value={cs.game >= 0 ? t('leave.titleN', { n: cs.game + 1 }) : t('leave.title')} fontSize={z(40)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: z(56) }} />
        <Label value={t('leave.body')} fontSize={z(24)} font="sans-serif" color={c(0.45, 0.35, 0.6, 1)} textWrap="wrap" uiTransform={{ width: '100%', height: z(70) }} />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: z(14) }, pointerFilter: 'none' }}>
          <PillButton id="leave-stay" label={t('common.stay')} width={z(220)} height={z(64)} font={z(28)} tint={PAL.green} margin={{ right: z(20) }} onClick={() => (cs.confirmLeave = false)} />
          <PillButton
            id="leave-go"
            label={t('common.leave')}
            width={z(220)}
            height={z(64)}
            font={z(28)}
            tint={PAL.pink}
            onClick={() => {
              cs.confirmLeave = false
              returnToLobby()
            }}
          />
        </UiEntity>
      </Frame>
    </Layer>
  )
}

// ---- settings: on/off switches, saved with your profile ----
export function SettingsPanel() {
  const phone = mobile()
  const devAvailable = C.NET_STATS && netMon.allowed
  const rows = SETTINGS.length + C.VOLUMES.length + 1 + (devAvailable ? 1 : 0)
  const scale = devAvailable ? panelScale(820, (phone ? 52 : 64) + 46 + rows * (phone ? 84 : 96) + 90) : 1
  const z = (n: number) => Math.floor(S(n) * scale)
  const w = fit(z(820))
  const rowH = phone ? z(84) : z(96) // phones: a little tighter, so the card fits under the top bar
  const border = z(6)
  const pad = z(22)
  // Two columns on every row: the name and a short line on the left, the control centred in a fixed column on the right,
  // so the switches, flags and volume buttons all line up.
  const ctrlW = z(280)
  const textW = w - 2 * (border + pad) - ctrlW - z(12)
  const descFont = mobile() ? z(18) : z(20)
  const titleH = phone ? z(52) : z(64)
  const h = titleH + z(46) + rows * rowH + z(90)
  // phones: start below the top bar (the app's buttons and your coins), centred in the space under it
  const top = phone ? Math.round(view().h * MOBILE_TOP_BAR_BOTTOM) : 0
  const save = (id: string, value: boolean | number) => {
    cs.settings = { ...cs.settings, [id]: value }
    if (!C.UI_PREVIEW) room.send('setSetting', { key: id, value: typeof value === 'number' ? value : value ? 1 : 0 })
  }
  const row = (key: string, label: string, desc: string, control: any) => (
    <UiEntity key={key} uiTransform={{ width: '100%', height: rowH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: textW, height: rowH, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
        <Label value={label} fontSize={z(30)} font="sans-serif" color={PAL.ink} textAlign="middle-left" uiTransform={{ width: '100%', height: z(40) }} />
        <Label value={desc} fontSize={descFont} font="sans-serif" color={c(0.45, 0.35, 0.6, 1)} textWrap="wrap" textAlign="top-left" uiTransform={{ width: '100%', height: z(48) }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: ctrlW, height: rowH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>{control}</UiEntity>
    </UiEntity>
  )
  return (
    <Layer pad={{ top }}>
      <Frame width={w} height={h} edge={PAL.violet} fill={PAL.cream} radius={z(30)} border={border} pad={pad} align="center" justify="flex-start" block>
        <Label value={t('settings.title')} fontSize={phone ? z(38) : z(44)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: titleH }} />
        {SETTINGS.map((s) => {
          const on = setting(s.id)
          return row(
            `set-${s.id}`,
            t(`setting.${s.id}.label`),
            t(`setting.${s.id}.desc`),
            <PillButton id={`set-btn-${s.id}`} label={on ? t('common.on') : t('common.off')} width={z(150)} height={z(56)} font={z(26)} tint={on ? PAL.green : c(0.6, 0.55, 0.7, 0.8)} onClick={() => save(s.id, !on)} />
          )
        })}
        {row(
          'set-lang',
          t('settings.language'),
          // phones follow the Decentraland app's language (client/i18n.ts): say which one and where it is changed
          mobile() ? t('settings.languageMobile') : t('settings.languageDesc'),
          mobile() ? (
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
              <Flag lang={uiLang()} height={z(40)} margin={{ right: z(10) }} />
              <Label value={LANG_NAMES[uiLang()]} fontSize={z(26)} font="sans-serif" color={PAL.ink} textWrap="nowrap" textAlign="middle-left" uiTransform={{ width: z(140), height: z(44) }} />
            </UiEntity>
          ) : (
            LANGS.map((l) => <FlagChip key={`ui-lang-${l}`} id={`ui-lang-${l}`} lang={l} height={z(48)} active={uiLang() === l} onClick={() => !C.UI_PREVIEW && pickUiLang(l)} />)
          )
        )}
        {C.VOLUMES.map((v) => {
          const level = volumeLevel(v.id)
          const step = (d: number) => save(v.id, Math.max(0, Math.min(C.VOLUME_MAX, level + d)))
          return row(
            `vol-${v.id}`,
            t(`volume.${v.id}.label`),
            t(`volume.${v.id}.desc`),
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
              <PillButton id={`vol-down-${v.id}`} label="-" width={z(70)} height={z(56)} font={z(30)} onClick={() => step(-1)} />
              <Label value={level === 0 ? t('common.off') : `${level * 10}%`} fontSize={z(26)} font="sans-serif" color={PAL.ink} uiTransform={{ width: z(110), height: z(56) }} />
              <PillButton id={`vol-up-${v.id}`} label="+" width={z(70)} height={z(56)} font={z(30)} tint={PAL.green} onClick={() => step(1)} />
            </UiEntity>
          )
        })}
        {devAvailable && row(
          'set-dev-panel',
          t('settings.devPanel.label'),
          t('settings.devPanel.desc'),
          <PillButton id="set-dev-toggle" label={netMon.open ? t('common.on') : t('common.off')} width={z(150)} height={z(56)} font={z(26)} tint={netMon.open ? PAL.green : c(0.6, 0.55, 0.7, 0.8)} onClick={() => { toggleNetMonitor(); if (netMon.open) cs.showSettings = false }} />
        )}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: z(10) }, pointerFilter: 'none' }}>
          {mobile() && (
            <PillButton
              id="settings-howto"
              label={t('hud.howTo')}
              width={z(240)}
              height={z(60)}
              font={z(26)}
              tint={PAL.cyan}
              margin={{ right: z(16) }}
              onClick={() => {
                cs.showSettings = false
                cs.showHowTo = true
              }}
            />
          )}
          <PillButton id="settings-close" label={t('common.close')} width={z(220)} height={z(60)} font={z(28)} onClick={() => (cs.showSettings = false)} />
        </UiEntity>
      </Frame>
    </Layer>
  )
}

// ---- the vendor's shop ----
export function ShopPanel() {
  // phones: the same centred, shrunk card as How to play (panelScale)
  const k = panelScale(1020, 150 + ITEMS.length * 112 + 86 + 28)
  const z = (n: number) => Math.round(S(n) * k)
  const w = mobile() ? z(1020) : fit(z(1020))
  const rowH = z(112)
  const gap = mobile() ? z(28) : 0 // phones: a little air between the title row and the items
  const h = z(150) + ITEMS.length * rowH + z(86) + gap
  return (
    <Layer>
      <Frame width={w} height={h} edge={PAL.violet} fill={PAL.cream} radius={z(30)} border={z(6)} pad={z(22)} align="center" justify="flex-start" block>
        <UiEntity uiTransform={{ width: '100%', height: z(64), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', pointerFilter: 'none' }}>
          <Label value={t('shop.title')} fontSize={z(44)} font="sans-serif" color={PAL.ink} textAlign="middle-left" uiTransform={{ width: '60%', height: '100%' }} />
          {/* phones: your coins are already in the top bar, right above the card */}
          {!mobile() && (
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
              <CoinIcon size={z(36)} margin={{ right: z(8) }} />
              <Label value={`${coins()}`} fontSize={z(34)} font="sans-serif" color={c(0.75, 0.5, 0.05, 1)} textWrap="nowrap" uiTransform={{ width: z(110), height: z(44) }} />
            </UiEntity>
          )}
        </UiEntity>
        {gap > 0 && <UiEntity uiTransform={{ width: '100%', height: gap, pointerFilter: 'none' }} />}
        {ITEMS.map((i) => {
          const afford = coins() >= i.price
          return (
            <UiEntity key={`shop-${i.id}`} uiTransform={{ width: '100%', height: rowH, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
              <ItemTile id={i.id} size={z(64)} margin={{ left: z(6), right: z(16) }} onUse={() => {}} />
              <UiEntity uiTransform={{ width: w - z(470), height: rowH, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
                <Label value={t(`item.${i.id}.name`)} fontSize={z(30)} font="sans-serif" color={PAL.ink} textAlign="middle-left" uiTransform={{ width: '100%', height: z(40) }} />
                <Label value={t(`item.${i.id}.desc`)} fontSize={z(20)} font="sans-serif" color={c(0.45, 0.35, 0.6, 1)} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: '100%', height: z(54) }} />
              </UiEntity>
              <UiEntity uiTransform={{ width: z(190), height: rowH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
                <CoinIcon size={z(30)} margin={{ right: z(6) }} />
                <Label value={`${i.price}`} fontSize={z(30)} font="sans-serif" color={c(0.75, 0.5, 0.05, 1)} textWrap="nowrap" uiTransform={{ width: z(90), height: z(40) }} />
              </UiEntity>
              <PillButton id={`buy-${i.id}`} label={t('common.buy')} width={z(150)} height={z(56)} font={z(26)} tint={afford ? PAL.green : c(0.6, 0.55, 0.7, 0.8)} onClick={() => room.send('buy', { item: i.id })} />
            </UiEntity>
          )
        })}
        <PillButton id="shop-close" label={t('common.close')} width={z(220)} height={z(60)} font={z(28)} margin={{ top: z(8) }} onClick={() => (cs.shop = false)} />
      </Frame>
    </Layer>
  )
}

// ---- how to play: opens by itself the first time you enter the game, and from the "How to play" buttons ----
// Phones: the card shrinks to the free middle of the screen, clear of the top bar and of the native buttons on the right
// (kept symmetric so it stays centred).
const MOBILE_NATIVE_BUTTONS_W = 0.24 // share of the screen width the native button cluster takes on the right
const MOBILE_TOP_BAR_BOTTOM = 0.18 // share of the screen height the top bar (and its question) reaches down to
/** Phones: how much a centred card of this design size (S units) shrinks to fit the free middle of the screen. */
function panelScale(w: number, h: number): number {
  if (!mobile()) return 1
  const v = view()
  return Math.min(1, (v.w * (1 - 2 * MOBILE_NATIVE_BUTTONS_W)) / S(w), (v.h * (1 - 2 * MOBILE_TOP_BAR_BOTTOM)) / S(h))
}
const howToScale = () => panelScale(900, 650)

export function HowToPlay() {
  const phone = mobile()
  const k = howToScale()
  const z = (n: number) => Math.round(S(n) * k)
  const w = phone ? z(900) : fit(S(900))
  const rowH = z(96)
  const h = phone ? z(650) : fitH(S(650))
  const font = z(26)
  const rows: { color: typeof PAL.red; text: string }[] = [
    { color: PAL.orange, text: t('howto.1') },
    { color: PAL.green, text: t('howto.2') },
    { color: PAL.red, text: t('howto.3') },
    { color: PAL.cyan, text: t('howto.4') }
  ]
  return (
    <Layer>
      <Frame width={w} height={h} edge={PAL.violet} fill={PAL.cream} radius={z(30)} border={z(6)} pad={z(24)} align="center" justify="center" block>
        <Label value={t('howto.title')} fontSize={z(46)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: z(64) }} />
        {rows.map((r, i) => (
          <UiEntity key={`how${i}`} uiTransform={{ width: '100%', height: rowH, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
            <Frame width={z(56)} height={z(56)} edge={r.color} fill={PAL.cream} radius={z(28)} border={z(5)} align="center" justify="center" margin={{ left: z(10), right: z(16) }}>
              <Label value={`${i + 1}`} fontSize={z(30)} font="sans-serif" color={PAL.ink} uiTransform={{ width: '100%', height: '100%' }} />
            </Frame>
            <Label value={r.text} fontSize={font} font="sans-serif" color={PAL.ink} textWrap="wrap" textAlign="middle-left" uiTransform={{ width: w - z(150), height: rowH }} />
          </UiEntity>
        ))}
        <Label value={t('howto.vote')} fontSize={z(22)} font="sans-serif" color={c(0.45, 0.35, 0.6, 1)} textWrap={phone ? 'wrap' : 'nowrap'} uiTransform={{ width: '100%', height: z(40) }} />
        <UiEntity uiTransform={{ width: '100%', height: z(70), flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
          {!cs.inGame && <PillButton id="howto-tutorial" label={t('tutorial.replay')} width={z(300)} height={z(64)} font={z(26)} tint={PAL.green} margin={{ right: z(16) }} onClick={() => { cs.showHowTo = false; startTutorial() }} />}
          <PillButton id="howto-close" label={t('common.gotIt')} width={z(260)} height={z(64)} font={z(30)} onClick={() => (cs.showHowTo = false)} />
        </UiEntity>
      </Frame>
    </Layer>
  )
}

export function updateHud() {
  trackToast()
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
      <HudToast />
    </UiEntity>
  )
}

// The latest message ("Starting game #2", "You left game 2", "Game 3 is full") while you are in the lobby.
export function LobbyMessage() {
  return <HudToast />
}

// The whole HUD until the server has answered (connection.ts): a small line at the bottom, and clicks stop here.
export function ConnectingGate(props: { slow: boolean }) {
  const text = props.slow ? t('connect.slow') : t('connect.connecting')
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'flex-end', pointerFilter: 'block' }}>
      <Label value={text} fontSize={S(18)} font="sans-serif" color={PAL.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(30), margin: { bottom: S(60) + BOTTOM_RESERVE() } }} />
    </UiEntity>
  )
}


// A flag you can pick: a gold rim when it is the chosen one, the others a little faded. No onClick: just shows a language.
function FlagChip(props: { key?: string; id: string; lang: Lang; height: number; active: boolean; onClick?: () => void }) {
  // A cartoon tile around the flag: dark outline, a gold rim when picked (violet on hover), a darker lip at the bottom.
  const hov = !!props.onClick && !!hovered[props.id]
  const outline = Math.max(2, Math.round(props.height * 0.05))
  const rim = Math.max(2, Math.round(props.height * 0.08))
  const flagH = props.height - 2 * (outline + rim)
  const face = props.active ? PAL.yellow : hov ? PAL.violetLight : PAL.violetDark
  const radius = Math.round(props.height * 0.24)
  return (
    <UiEntity
      uiTransform={{
        width: Math.round(flagH * flagAspect(props.lang)) + 2 * (outline + rim),
        height: props.height,
        padding: outline,
        margin: { left: S(7), right: S(7) },
        borderRadius: radius,
        pointerFilter: props.onClick ? 'block' : 'none'
      }}
      uiBackground={{ color: OUTLINE }}
      onMouseDown={() => {
        if (!props.onClick) return
        playSfx(SFX.click, 0.5)
        props.onClick()
      }}
      {...(props.onClick ? hover(props.id) : {})}
    >
      <UiEntity uiTransform={{ width: '100%', height: '100%', padding: rim, borderRadius: Math.max(2, radius - outline), pointerFilter: 'none' }} uiBackground={{ color: face }}>
        <UiEntity key="chip-lip" uiTransform={{ positionType: 'absolute', position: { bottom: 0, left: radius, right: radius }, height: Math.max(1, Math.round(rim * 0.6)), pointerFilter: 'none' }} uiBackground={{ color: darken(face, 0.3) }} />
        <Flag lang={props.lang} height={flagH} dim={!props.active && !hov} />
      </UiEntity>
    </UiEntity>
  )
}

// ---- the start pad card: pick the language and start, join a running game, or count down to going in ----
// One card at the bottom of the screen, under the avatars on the pad (the camera has them in the middle), in the HUD's
// see-through violet so the pad shows behind it. The countdown runs inside the same card, with the game's language.
const PAD_CARD_W = 600
const PAD_CARD_H = 268
/** Phones: the card shrinks to the gap between the joystick and the native buttons. */
const padCardScale = () => (mobile() ? Math.min(1, (view().w * (1 - 2 * MOBILE_NATIVE_BUTTONS_W)) / S(PAD_CARD_W), (view().h * 0.42) / S(PAD_CARD_H)) : 1)

export function PadCard() {
  const counting = cs.lobbyCountdown > 0
  const action = cs.padAction
  if (!counting && action === '') return null
  const k = padCardScale()
  const z = (n: number) => Math.round(S(n) * k)
  const n = cs.padGame + 1
  const g = cs.padGame >= 0 ? stateOfGame(cs.padGame) : undefined
  const lang = cs.padGame >= 0 ? gameLang(cs.padGame) : null
  const title = counting
    ? cs.countdownTitle
    : action === 'start'
      ? t('pad.pickLang')
      : action === 'join'
        ? t('pad.running', { n })
        : t('pad.full', { n })
  // the game's language, level and seats (running or full games), or the language picked so far (counting)
  const info = lang
    ? [LANG_NAMES[lang], ...(g && g.active ? [t('sign.level', { n: g.difficulty }), `${g.players}/${C.MAX_PLAYERS_PER_GAME}`] : [])].join('  ·  ')
    : ''
  const urgent = counting && cs.lobbyCountdown <= 3
  return (
    <Layer justify="flex-end" pad={{ bottom: (mobile() ? S(10) : S(30)) + BOTTOM_RESERVE() }}>
      <Frame width={z(PAD_CARD_W)} height={z(PAD_CARD_H)} edge={PAL.violetLight} fill={PAL.violetGlass} radius={z(28)} border={z(4)} pad={z(16)} align="center" justify="center">
        <OutlineLabel value={title} fontSize={z(30)} color={PAL.text} width="100%" height={z(40)} soft />

        {action === 'start' && !counting && (
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
            <UiEntity uiTransform={{ height: z(62), margin: { top: z(10) }, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
              {LANGS.map((l) => (
                <FlagChip key={`pad-lang-${l}`} id={`pad-lang-${l}`} lang={l} height={z(58)} active={cs.padLang === l} onClick={() => (cs.padLang = l)} />
              ))}
            </UiEntity>
            <Label value={LANG_NAMES[cs.padLang]} fontSize={z(22)} font="sans-serif" color={PAL.yellow} textAlign="middle-center" uiTransform={{ width: '100%', height: z(30) }} />
          </UiEntity>
        )}

        {(action === 'join' || action === 'full' || counting) && lang && (
          <UiEntity uiTransform={{ height: z(54), margin: { top: z(8) }, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
            <Flag lang={lang} height={z(36)} margin={{ right: z(12) }} />
            <Label value={info} fontSize={z(24)} font="sans-serif" color={PAL.text} textWrap="nowrap" textAlign="middle-left" uiTransform={{ width: Math.round(info.length * z(24) * 0.56) + z(10), height: z(40) }} />
          </UiEntity>
        )}

        {counting ? (
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
            <OutlineLabel value={`${cs.lobbyCountdown}`} fontSize={z(urgent ? 76 : 64)} color={urgent ? PAL.pink : PAL.yellow} width="100%" height={z(84)} soft />
            <Label value={t('pad.cancel')} fontSize={z(19)} font="sans-serif" color={PAL.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: z(26) }} />
          </UiEntity>
        ) : action === 'full' ? (
          <Label value={t('pad.hint.full')} fontSize={z(22)} font="sans-serif" color={PAL.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: z(40), margin: { top: z(16) } }} />
        ) : (
          <PillButton
            id="pad-action"
            label={action === 'start' ? t('pad.start') : t('pad.join')}
            width={z(300)}
            height={z(72)}
            font={z(32)}
            tint={action === 'start' ? PAL.green : PAL.cyan}
            margin={{ top: z(action === 'start' ? 6 : 18) }}
            onClick={action === 'start' ? pressStart : pressJoin}
          />
        )}
      </Frame>
    </Layer>
  )
}

// Server messages that only the HUD cares about.
export function setupHudMessages() {
  room.onMessage('profile', (d) => {
    if (rankIndex(d.rating) > rankIndex(cs.rating) && cs.rating > 0) {
      showMessage(t('rank.up', { rank: rankName(d.rating) }), 4)
      playSfx(SFX.rankUp)
    }
    onProfileLoaded()
    cs.rating = d.rating
    onItems(cs.items, { wildcard: d.wildcard, reroll: d.reroll, freeze: d.freeze, bomb: d.bomb })
    cs.items = { wildcard: d.wildcard, reroll: d.reroll, freeze: d.freeze, bomb: d.bomb }
    try {
      const saved = JSON.parse(d.settings || '{}')
      if (saved.tutorialComplete === true) cs.tutorialSavePending = false
      cs.settings = cs.tutorialSavePending ? { ...saved, tutorialComplete: true } : saved
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
    cs.lockoutTotal = d.seconds
  })
}

// Lobby: your coins and rank, top right. (Rank is a placeholder until ratings are stored per player.)
export function LobbyHud() {
  if (mobile()) return <LobbyBar />
  const w = SIDE_W()
  return (
    <Layer align="flex-end" justify="flex-start" pad={{ top: S(24) + TOP_RESERVE(), right: EDGE() + RIGHT_RESERVE() }}>
      <Frame width={w} height={S(150)} edge={PAL.violetLight} fill={PAL.violetDark} radius={S(20)} pad={S(10)} align="center" justify="center">
        <CoinsRow size={S(34)} />
        <OutlineLabel value={t('lobby.rank')} fontSize={S(18)} color={PAL.dim} width="100%" height={S(24)} />
        <OutlineLabel value={rankName(cs.rating)} fontSize={S(30)} color={PAL.pink} width="100%" height={S(38)} />
      </Frame>
      <PillButton id="howto-lobby" label={t('hud.howTo')} width={w} height={S(54)} font={S(22)} tint={PAL.cyan} margin={{ top: S(10) }} onClick={() => (cs.showHowTo = true)} />
      <PillButton id="settings-lobby" label={t('hud.settings')} width={w} height={S(54)} font={S(22)} margin={{ top: S(8) }} onClick={() => (cs.showSettings = true)} />
    </Layer>
  )
}

// Phones: the lobby's coins and rank share the game's top-right alignment.
const LOBBY_RANK_W = () => S(200)
function LobbyBar() {
  const L = mobileLayout(null)
  const w = BAR_COINS_W() + BAR_DIVIDER() + LOBBY_RANK_W() + 2 * BAR_PAD()
  const h = L.barH
  const text = `${coins()}`
  return (
    <Layer justify="flex-start" align="flex-start" pad={{ top: L.top, left: view().w - L.right - w, right: L.right }}>
      <Frame width={w} height={h} edge={PAL.violetLight} fill={PAL.violetGlass} radius={h / 2} border={S(3)} dir="row" align="center" justify="center">
        <UiEntity uiTransform={{ width: BAR_COINS_W(), height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
          <CoinIcon size={S(26)} margin={{ right: S(6) }} />
          <OutlineLabel value={text} fontSize={S(24)} color={PAL.yellow} width={Math.max(S(30), Math.round(text.length * S(24) * 0.62))} height={S(32)} align="middle-left" />
        </UiEntity>
        <UiEntity uiTransform={{ width: BAR_DIVIDER(), height: '60%', margin: { left: BAR_PAD(), right: BAR_PAD() } }} uiBackground={{ color: PAL.violetLight }} />
        <UiEntity uiTransform={{ width: LOBBY_RANK_W(), height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
          <OutlineLabel value={t('lobby.rank')} fontSize={S(18)} color={PAL.dim} width={S(60)} height={S(30)} />
          <OutlineLabel value={rankName(cs.rating)} fontSize={S(24)} color={PAL.pink} width={LOBBY_RANK_W() - S(60)} height={S(32)} align="middle-left" />
        </UiEntity>
      </Frame>
    </Layer>
  )
}

