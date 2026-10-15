import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import { GameState } from '../../shared/schemas'
import { cs } from '../state'
import { heldLetter as realHeldLetter } from '../cubes'
import * as C from '../../config'
import { room } from '../../shared/messages'
import { returnToLobby } from '../lobby'
import { canvas, mobile, EDGE, fs, sz } from './platform'
import { PAL, Frame, OutlineLabel, PillButton, LetterTile, TileState, clamp, c } from './theme'

type Game = { phase: string; round: number; difficulty: number; timeLeft: number; completed: number; question: string; length: number; masked: string; hint: string }

function game(): Game | null {
  if (C.UI_PREVIEW) return mockGame()
  for (const [, g] of engine.getEntitiesWith(GameState)) return g as unknown as Game
  return null
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
  return { phase: t >= 12 ? 'won' : 'playing', round: mockRound(), difficulty: 1, timeLeft: Math.max(0, 240 - Math.floor(t)), completed: mockRound() - 1, question: 'What is the capital of France?', length: MOCK_WORD.length, masked, hint }
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

// Called once per frame from the HUD: compares the new masked word with the last one and starts the matching effect.
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
}

const swell = (since: number, ms: number, amount: number) => {
  const k = (Date.now() - since) / ms
  return !since || k >= 1 ? 1 : 1 + amount * Math.sin(k * Math.PI)
}

function WordPanel(props: { g: Game }) {
  const { g } = props
  const n = Math.max(g.length, 1)
  const maxW = canvas().virtualWidth * 0.92 - 2 * EDGE()
  const tile = clamp(Math.floor(maxW / n) - TILE_GAP, 36, sz(84, 58))
  const rowW = n * (tile + TILE_GAP)
  const qFont = fs(sz(32, 22))
  const qLines = Math.ceil((g.question.length * qFont * 0.55) / (canvas().virtualWidth * 0.6)) || 1
  const qW = clamp(Math.round(g.question.length * qFont * 0.56) + 90, sz(380, 300), canvas().virtualWidth * 0.7)
  const qH = Math.round(qFont * 1.5 * Math.min(qLines, 2)) + 28

  const failT = (Date.now() - failAt) / FAIL_MS
  const failing = failAt > 0 && failT < 1
  const shake = failing ? Math.sin(failT * 38) * (1 - failT) * 10 : 0
  const winning = winAt > 0 && Date.now() - winAt < WIN_MS && g.phase === 'won'

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
        margin={TILE_GAP / 2}
      />
    )
  }

  // Only the question sits in a panel (a cream block face). The letter tiles float on their own under it.
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: sz(24, 16) }, width: '100%', alignItems: 'center', flexDirection: 'column', pointerFilter: 'none' }}
    >
      <Frame width={qW} height={qH} edge={PAL.violet} fill={PAL.cream} radius={22} border={5} align="center" justify="center">
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
      <UiEntity uiTransform={{ width: rowW, height: tile, margin: { top: sz(16, 10) }, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>{tiles}</UiEntity>
    </UiEntity>
  )
}

const clock = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`

// Coins, level, time and the two buttons, stacked at the top right.
function SidePanel(props: { g: Game | null }) {
  const { g } = props
  const w = sz(250, 210)
  const edge = EDGE()
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: sz(24, 16), right: edge }, width: w, flexDirection: 'column', alignItems: 'flex-end', pointerFilter: 'none' }}
    >
      <Frame width={w} height={sz(150, 118)} edge={PAL.violetLight} fill={PAL.violetDark} radius={20} border={4} pad={sz(10, 6)} align="center" justify="center">
        <OutlineLabel value={`${coins()} coins`} fontSize={fs(sz(34, 26))} color={PAL.yellow} width="100%" height={sz(44, 34)} />
        <OutlineLabel value={g ? `Level ${g.difficulty}   Words ${g.completed}` : ''} fontSize={fs(sz(22, 18))} color={PAL.dim} width="100%" height={sz(30, 24)} />
        <OutlineLabel value={g ? clock(g.timeLeft) : ''} fontSize={fs(sz(36, 28))} color={g && g.timeLeft <= 30 && g.phase === 'playing' ? PAL.pink : PAL.text} width="100%" height={sz(46, 36)} />
      </Frame>
      <PillButton id="hint" label="Hint" width={w} height={sz(66, 54)} font={fs(sz(28, 22))} tint={PAL.pink} margin={{ top: 10 }} onClick={() => room.send('hint', { n: 0 })} />
      <PillButton id="lobby" label="Back to lobby" width={w} height={sz(54, 46)} font={fs(sz(22, 18))} tint={PAL.cyan} margin={{ top: 8 }} onClick={returnToLobby} />
    </UiEntity>
  )
}

const message = (): string => (C.UI_PREVIEW ? mockMessage() : cs.message)
const coins = (): number => (C.UI_PREVIEW ? 125 : cs.coins)
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
  const msgFont = fs(sz(30, 22))
  const helpFont = fs(sz(22, 18))
  const msgW = clamp(estW(message(), msgFont) + 60, 200, canvas().virtualWidth * 0.8)
  const helpW = clamp(estW(help, helpFont) + 50, 200, canvas().virtualWidth * 0.8)
  const heldSize = sz(76, 56)
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { bottom: sz(36, 24) }, width: '100%', alignItems: 'center', flexDirection: 'column', pointerFilter: 'none' }}
    >
      {held !== '' && (
        <UiEntity uiTransform={{ width: heldSize + 190, height: heldSize, margin: { bottom: 10 }, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
          <OutlineLabel value="Holding" fontSize={fs(sz(26, 20))} color={PAL.text} width={130} height={heldSize} />
          <LetterTile size={heldSize} index={held.charCodeAt(0)} letter={held} state="locked" />
        </UiEntity>
      )}
      {message() !== '' && (
        <Frame width={msgW} height={sz(56, 44)} edge={PAL.violetLight} fill={PAL.violetDark} radius={28} border={4} align="center" justify="center" margin={{ bottom: 8 }}>
          <Label value={message()} fontSize={msgFont} font="sans-serif" color={PAL.text} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
        </Frame>
      )}
      <Frame width={helpW} height={sz(40, 34)} edge={c(0, 0, 0, 0)} fill={c(0.2, 0.1, 0.4, 0.6)} radius={20} border={0} align="center" justify="center">
        <Label value={help} fontSize={helpFont} font="sans-serif" color={PAL.dim} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
      </Frame>
    </UiEntity>
  )
}

export function GameHud() {
  const g = game()
  if (g) track(g)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', pointerFilter: 'none' }}>
      {g && <WordPanel g={g} />}
      <SidePanel g={g} />
      <BottomArea />
    </UiEntity>
  )
}

// Shown while standing on the start pad in the lobby.
export function LobbyCountdown() {
  const n = cs.lobbyCountdown
  const urgent = n <= 3
  // No panel: big outlined text in the middle of the screen so the world stays visible behind it.
  const h = sz(56, 44) + sz(190, 140) + sz(34, 28)
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', pointerFilter: 'none' }}
    >
      <UiEntity uiTransform={{ width: '100%', height: h, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        <OutlineLabel value="Game starts in" fontSize={fs(sz(44, 32))} color={PAL.text} width="100%" height={sz(56, 44)} />
        <OutlineLabel value={`${n}`} fontSize={sz(urgent ? 170 : 130, urgent ? 120 : 96)} color={urgent ? PAL.pink : PAL.yellow} width="100%" height={sz(190, 140)} />
        <OutlineLabel value="Step off the pad to cancel" fontSize={fs(sz(24, 18))} color={PAL.text} width="100%" height={sz(34, 28)} />
      </UiEntity>
    </UiEntity>
  )
}
