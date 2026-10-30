import { SETTINGS } from '../config'

// Client-only UI state. Game state itself comes from the server's synced components.
export const cs = {
  myAddress: '',
  coins: 0,
  rating: 0, // your saved rating (the server sends it)
  items: { wildcard: 0, reroll: 0, freeze: 0, bomb: 0 } as Record<string, number>, // your inventory
  delta: 0, // rating change after the last round you took part in
  shop: false, // the vendor's shop is open
  showSettings: false, // the Settings panel is open
  settings: {} as Record<string, boolean>, // your saved switches (see SETTINGS in config); missing = the default
  message: '',
  messageTime: 0,
  game: -1, // the game (pad) you hold a seat in, -1 in the lobby
  inGame: false, // false in the lobby, true once teleported into (or standing in) the game
  earned: 0, // coins you got for the last finished word
  earnedRound: -1, // the round that was
  showHowTo: false, // the how-to-play card is open (only from the buttons)
  dialog: null as null | { name: string; pages: string[]; page: number }, // open NPC conversation
  lockoutUntil: 0, // Date.now() time when you may place again (after you collapsed the word)
  lobbyCountdown: 0 // seconds left on the lobby start pad, 0 when not counting
}

export function showMessage(text: string, seconds = 3) {
  cs.message = text
  cs.messageTime = seconds
}

/** Seconds left of the collapse penalty on cube actions, hints and power-ups, 0 when free. */
export const lockoutLeft = () => Math.max(0, Math.ceil((cs.lockoutUntil - Date.now()) / 1000))

/** Current value of a Settings switch (its default until the server has sent yours). */
export function setting(id: string): boolean {
  const v = cs.settings[id]
  if (v !== undefined) return v
  return SETTINGS.find((x) => x.id === id)?.default ?? false
}
