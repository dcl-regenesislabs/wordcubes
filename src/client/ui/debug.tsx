// DEV ONLY (config UI_PREVIEW): a picker on the left of the screen to jump between every UI the game has, with fake
// data and no server needed. Save a file and the preview reloads with the same picker. Starts on the game HUD.
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { cs } from '../state'
import { UI_PREVIEW } from '../../config'
import { S } from './platform'
import { PAL, PillButton } from './theme'

export type Screen =
  | 'game'
  | 'holding'
  | 'items'
  | 'lowtime'
  | 'frozen'
  | 'won'
  | 'timeout'
  | 'vote'
  | 'lobby'
  | 'padStart'
  | 'padJoin'
  | 'padFull'
  | 'countdown'
  | 'leave'
  | 'howto'
  | 'settings'
  | 'shop'
  | 'npc'

const SCREENS: { id: Screen; label: string; game: boolean }[] = [
  { id: 'game', label: 'Game (loop)', game: true },
  { id: 'holding', label: 'Holding cube', game: true },
  { id: 'items', label: 'Items (phone)', game: true },
  { id: 'lowtime', label: 'Low time', game: true },
  { id: 'frozen', label: 'Time Freeze', game: true },
  { id: 'won', label: 'Word complete', game: true },
  { id: 'timeout', label: "Time's up", game: true },
  { id: 'vote', label: 'Vote', game: true },
  { id: 'lobby', label: 'Lobby', game: false },
  { id: 'padStart', label: 'Pad: Start', game: false },
  { id: 'padJoin', label: 'Pad: Join', game: false },
  { id: 'padFull', label: 'Pad: Full', game: false },
  { id: 'countdown', label: 'Countdown', game: false },
  { id: 'leave', label: 'Leave? (phone)', game: true },
  { id: 'howto', label: 'How to play', game: true },
  { id: 'settings', label: 'Settings', game: true },
  { id: 'shop', label: 'Shop', game: false },
  { id: 'npc', label: 'NPC dialog', game: false }
]

// Real words from the bank, one per length, to check how the word row fits (3 to 14 letters)
const WORDS = [
  { answer: 'DOG', question: 'Barks and wags its tail' },
  { answer: 'BREAD', question: 'Baked food, a sandwich needs two slices' },
  { answer: 'WINTER', question: 'Coldest season' },
  { answer: 'ELEPHANT', question: 'Largest land animal, has a trunk' },
  { answer: 'CHOCOLATE', question: 'Sweet made from cocoa beans' },
  { answer: 'MARSHMALLOW', question: 'Soft white sweet toasted over a campfire' },
  { answer: 'KALEIDOSCOPE', question: 'Tube of mirrors with shifting colourful patterns' },
  { answer: 'PHOTOSYNTHESIS', question: 'How plants turn sunlight into food' }
]

export const dbg = { screen: 'game' as Screen, open: false, word: 1 }

/** The fake round's word: the length picked in the debug bar. */
export const debugWord = () => WORDS[dbg.word]

/** The game HUD shows (instead of the lobby's) for the picked screen, or when you really are in a game. */
export function showGame(): boolean {
  if (!UI_PREVIEW) return cs.inGame
  return SCREENS.find((s) => s.id === dbg.screen)?.game ?? false
}

function pick(screen: Screen) {
  dbg.screen = screen
  dbg.open = false
  cs.showHowTo = screen === 'howto'
  cs.showSettings = screen === 'settings'
  cs.shop = screen === 'shop'
  cs.itemsOpen = screen === 'items'
  cs.confirmLeave = screen === 'leave'
  cs.dialog =
    screen === 'npc'
      ? { name: 'Cubby, the Vendor', pages: ['Hi! I sell power-ups for your coins.', 'Wildcards fit any frame. Bombs clear the pile.'], page: 0 }
      : null
}

let ready = false
/** Called by the UI render: keeps the picked screen's lobby state over what the lobby system wrote this frame. */
export function applyDebug() {
  if (!UI_PREVIEW) return
  if (!ready) {
    ready = true
    cs.items = { wildcard: 2, reroll: 1, freeze: 1, bomb: 3 } // so the item bar shows
    pick(dbg.screen)
  }
  const s = dbg.screen
  cs.padGame = 0
  cs.padAction = s === 'padStart' ? 'start' : s === 'padJoin' ? 'join' : s === 'padFull' ? 'full' : ''
  cs.lobbyCountdown = s === 'countdown' ? 10 - (Math.floor(Date.now() / 1000) % 10) : 0
  cs.countdownTitle = 'Game starts in'
}

export function DebugBar() {
  const current = SCREENS.find((s) => s.id === dbg.screen)!
  const w = S(190)
  const h = S(40)
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { left: S(12), top: '30%' }, flexDirection: 'column', alignItems: 'flex-start', pointerFilter: 'none' }}
    >
      <PillButton id="dbg-toggle" label={`UI: ${current.label}`} width={S(230)} height={h} font={S(18)} tint={PAL.yellow} onClick={() => (dbg.open = !dbg.open)} />
      {/* word length: always visible, one tap per size */}
      <UiEntity uiTransform={{ width: 4 * (S(56) + S(6)), flexDirection: 'row', flexWrap: 'wrap', margin: { top: S(6) }, pointerFilter: 'none' }}>
        {WORDS.map((w, i) => (
          <PillButton
            key={`len-${i}`}
            id={`dbg-len-${i}`}
            label={`${w.answer.length}`}
            width={S(56)}
            height={S(36)}
            font={S(18)}
            active={i === dbg.word}
            tint={PAL.pink}
            margin={{ right: S(6), bottom: S(6) }}
            onClick={() => (dbg.word = i)}
          />
        ))}
      </UiEntity>
      {dbg.open && (
        <UiEntity uiTransform={{ width: 2 * (w + S(6)), flexDirection: 'row', flexWrap: 'wrap', margin: { top: S(6) }, pointerFilter: 'none' }}>
          {SCREENS.map((s) => (
            <PillButton
              key={s.id}
              id={`dbg-${s.id}`}
              label={s.label}
              width={w}
              height={h}
              font={S(16)}
              active={s.id === dbg.screen}
              tint={s.game ? PAL.cyan : PAL.violetLight}
              margin={{ right: S(6), bottom: S(6) }}
              onClick={() => pick(s.id)}
            />
          ))}
        </UiEntity>
      )}
    </UiEntity>
  )
}
