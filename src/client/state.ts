// Client-only UI state. Game state itself comes from the server's synced components.
export const cs = {
  myAddress: '',
  coins: 0,
  message: '',
  messageTime: 0,
  inGame: false, // false in the lobby, true once teleported into (or standing in) the game
  lobbyCountdown: 0 // seconds left on the lobby start pad, 0 when not counting
}

export function showMessage(text: string, seconds = 3) {
  cs.message = text
  cs.messageTime = seconds
}
