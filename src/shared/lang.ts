// The languages a game (room) can be played in. The first player to press Start game on an idle pad picks it; the
// game keeps it until it goes idle again. Words, clues and the letters in the pile all follow it.

export const LANGS = ['en', 'es', 'pt'] as const
export type Lang = (typeof LANGS)[number]

export const DEFAULT_LANG: Lang = 'en'

/** The language's own name, as shown on the pads and the start prompt. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español', pt: 'Português' }

/** Short tag for tight spots (pad sign, HUD). */
export const LANG_TAGS: Record<Lang, string> = { en: 'EN', es: 'ES', pt: 'PT' }

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v)

/** A stored or sent value as a language, falling back to English. */
export const toLang = (v: unknown): Lang => (isLang(v) ? v : DEFAULT_LANG)

/** Letters that fill the pile around the answer. Game words are plain A-Z in every language (no Ñ, no accents). */
export const ALPHABETS: Record<Lang, string> = {
  en: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  es: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  pt: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
}
