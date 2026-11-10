// UI text in English, Spanish and Portuguese, shared by the client (t() in client/i18n.ts) and the server (say() in
// server/say.ts, whose messages carry a key so each player reads them in their own language).
//
// Values are filled into {name}. A value that starts with '@' is itself a key, translated too: the server sends
// { item: '@item.freeze.name' } and every client shows the item's name in its language.
import type { Lang } from '../lang'
import { EN } from './en'
import { ES } from './es'
import { PT } from './pt'

export type Args = Record<string, string | number>

export const STRINGS: Record<Lang, Record<string, string>> = { en: EN, es: ES, pt: PT }

/** A key's text in a language. mobile: prefer the key's ".mobile" variant (phones tap, desktops click). */
export function format(lang: Lang, key: string, args: Args = {}, mobile = false): string {
  const dict = STRINGS[lang] ?? EN
  const template = (mobile ? dict[`${key}.mobile`] ?? EN[`${key}.mobile`] : undefined) ?? dict[key] ?? EN[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = args[name]
    if (v === undefined) return `{${name}}`
    return typeof v === 'string' && v.startsWith('@') ? format(lang, v.slice(1), args, mobile) : String(v)
  })
}

/** How a cube's letter is named in a message: the wildcard box ('*') has a name of its own. */
export const letterArg = (letter: string): string => (letter === '*' ? '@cube.wildcard' : letter)
