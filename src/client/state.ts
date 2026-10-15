// Client-only UI state. Game state itself comes from the server's synced components.
export const cs = {
  myAddress: '',
  coins: 0,
  rating: 0, // placeholder until ratings are stored per player (see docs/round-system-design.md)
  message: '',
  messageTime: 0,
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

/** Seconds left of your placing lockout, 0 when free. */
export const lockoutLeft = () => Math.max(0, Math.ceil((cs.lockoutUntil - Date.now()) / 1000))
