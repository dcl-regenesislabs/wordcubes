// Client-only UI state. Game state itself comes from the server's synced components.
export const cs = {
  myAddress: '',
  coins: 0,
  message: '',
  messageTime: 0
}

export function showMessage(text: string, seconds = 3) {
  cs.message = text
  cs.messageTime = seconds
}
