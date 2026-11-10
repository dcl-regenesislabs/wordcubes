// The language of this player's UI (menus, HUD, messages), like marsh-colony: phones follow the Decentraland app's
// language (Settings shows it and says where to change it); desktop, where the scene cannot read it, uses the language
// picked in Settings, saved with the profile, and the Explorer's language until one is picked.
// This is the UI only: the words to build follow the game's (room's) language, picked on the pad (shared/lang.ts).
import { getPlayerLanguage, onPlayerLanguageChanged } from '@dcl/sdk/platform'
import { format, type Args } from '../shared/i18n'
import { LANGS, type Lang } from '../shared/lang'
import { room } from '../shared/messages'
import { mobile } from './ui/platform'
import { cs } from './state'

let platformLang: Lang = 'en'
let listening = false

/** An Explorer BCP-47 tag ('es-AR', 'pt-BR'...) as one of our languages. */
export function langFromTag(tag: string | null | undefined): Lang {
  const v = (tag ?? '').toLowerCase()
  if (v === 'es' || v.startsWith('es-')) return 'es'
  if (v === 'pt' || v.startsWith('pt-')) return 'pt'
  return 'en'
}

/** The UI language right now. */
export function uiLang(): Lang {
  if (mobile()) return platformLang
  const saved = cs.settings.lang
  if (typeof saved === 'number' && LANGS[saved]) return LANGS[saved]
  return platformLang
}

/** Text for a key in the UI language (shared/i18n/*.ts). */
export const t = (key: string, args: Args = {}): string => format(uiLang(), key, args, mobile())

/** A server message ('toast'): shown in this player's language when it came with a key. */
export function serverText(d: { text: string; key?: string; args?: string }): string {
  if (!d.key) return d.text
  let args: Args = {}
  try {
    args = d.args ? JSON.parse(d.args) : {}
  } catch (e) {
    return d.text
  }
  return format(uiLang(), d.key, args, mobile())
}

/** Settings picker (desktop): switch now and save it with the profile. */
export function pickUiLang(lang: Lang) {
  const value = LANGS.indexOf(lang)
  cs.settings = { ...cs.settings, lang: value }
  room.send('setSetting', { key: 'lang', value })
}

export function setupLocalization() {
  try {
    platformLang = langFromTag(getPlayerLanguage())
  } catch (e) {
    platformLang = 'en'
  }
  if (listening) return
  listening = true
  try {
    onPlayerLanguageChanged.add(({ language }) => {
      platformLang = langFromTag(language)
    })
  } catch (e) {
    // no language events on this Explorer: keep what we read
  }
}
