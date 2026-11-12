import type { Lang } from './lang'

// The single-player laboratory is built locally at the unused eighth location.
// Its cubes and state never enter the network.
export const PRACTICE_GAME = 7
export const PRACTICE_WORDS: Record<Lang, { answer: string; question: string }> = {
  en: { answer: 'SUN', question: 'What shines in the sky during the day?' },
  es: { answer: 'SOL', question: '¿Qué brilla en el cielo durante el día?' },
  pt: { answer: 'SOL', question: 'O que brilha no céu durante o dia?' }
}
export type PracticeStage = 'intro' | 'first' | 'assist' | 'last' | 'won' | 'mistake' | 'collapsed' | 'retry' | 'complete'

// Stable scene-only avatar identifiers, not player accounts. Keep the suffix (arena number).
// Address-shaped IDs are preserved by mobile renderers for modifier exclusions.
export function npcAvatarId(key: string): string {
  return '0x' + Array.from(key, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').slice(-40).padStart(40, '0')
}
