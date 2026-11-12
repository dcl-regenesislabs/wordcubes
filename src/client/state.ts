import { SETTINGS, VOLUMES } from '../config'
import type { Lang } from '../shared/lang'

// Client-only UI state. Game state itself comes from the server's synced components.
export const cs = {
  myAddress: '',
  tutorialActive: false,
  tutorialSavePending: false,
  tutorialCinematic: false,
  cubbyHand: { x: 0, y: 0, z: 0 },
  practiceLetter: '',
  practiceCubeId: -1,
  practiceSlot: -1,
  practiceTouchReady: true,
  practiceUiOnly: false,
  coins: 0,
  rating: 0, // your saved rating (the server sends it)
  items: { wildcard: 0, reroll: 0, freeze: 0, bomb: 0 } as Record<string, number>, // your inventory
  delta: 0, // rating change after the last round you took part in
  shop: false, // the vendor's shop is open
  showSettings: false, // the Settings panel is open
  settings: {} as Record<string, boolean | number>, // your saved switches and volume levels (SETTINGS, VOLUMES in config); missing = the default
  message: '',
  messageKind: '',
  messageTime: 0,
  game: -1, // the game (pad) you hold a seat in, -1 in the lobby
  inGame: false, // false in the lobby, true once teleported into (or standing in) the game
  earned: 0, // coins you got for the last finished word
  earnedRound: -1, // the round that was
  showHowTo: false, // the how-to-play card is open (only from the buttons)
  dialog: null as null | { name: string; pages: string[]; page: number; replayTutorial?: boolean }, // open NPC conversation
  lockoutUntil: 0, // Date.now() time when you may place again (after you collapsed the word)
  lockoutTotal: 0, // seconds that lockout lasts in all (the banner's bar runs down over it)
  lockoutPing: 0, // Date.now() of the last thing you tried while locked out: the banner gives a little hop
  lobbyCountdown: 0, // seconds left on the lobby start pad, 0 when not counting
  countdownTitle: '', // what the countdown leads to: "Game starts in" (shared start) or "Joining in" (your join)
  padAction: '' as '' | 'start' | 'join' | 'full', // the button the pad you stand on offers ('' off the pad or counting)
  padGame: -1, // the game of that pad
  padLang: 'en' as Lang, // the language picked on an idle pad before Start game (the game is played in it)
  itemsOpen: false, // phones: the row of power-ups opened from the native items button
  confirmLeave: false, // phones: the "leave this game?" card opened by the native back-to-lobby button
  messageSticky: false // the message stays until you let go of the cube you grabbed (the first HOLD_TIPS_STICKY grabs)
}

export function showMessage(text: string, seconds = 3, kind = '') {
  cs.messageKind = kind
  cs.message = text
  cs.messageTime = seconds
}

/** Seconds left of the collapse penalty on cube actions, hints and power-ups, 0 when free. */
export const lockoutLeft = () => Math.max(0, Math.ceil((cs.lockoutUntil - Date.now()) / 1000))

/** You tried something while locked out: the banner hops instead of a toast repeating what it already says. */
export function pingLockout() {
  cs.lockoutPing = Date.now()
}

/** The server keeps a lockout per game: leaving the game (or switching) leaves it behind. */
export function clearLockout() {
  cs.lockoutUntil = 0
  cs.lockoutTotal = 0
  cs.lockoutPing = 0
}

/** Current value of a Settings switch (its default until the server has sent yours). */
export function setting(id: string): boolean {
  const v = cs.settings[id]
  if (typeof v === 'boolean') return v
  return SETTINGS.find((x) => x.id === id)?.default ?? false
}

/** Volume level 0..VOLUME_MAX of a Settings slider (its default until the server has sent yours). */
export function volumeLevel(id: string): number {
  const v = cs.settings[id]
  if (typeof v === 'number') return v
  return VOLUMES.find((x) => x.id === id)?.default ?? 0
}

// Informational broadcasts must not replace the first mobile holding tutorials.
export function showPowerupToast(text: string) {
  if (cs.messageSticky) return
  showMessage(text, 3, 'powerup')
}
