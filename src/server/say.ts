// A message for players as a key plus values (shared/i18n): each client shows it in its own language. The English text
// rides along for anything that does not translate (and for logs).
import { format, type Args } from '../shared/i18n'

export function say(key: string, args: Args = {}): { text: string; key: string; args: string } {
  return { text: format('en', key, args), key, args: JSON.stringify(args) }
}
