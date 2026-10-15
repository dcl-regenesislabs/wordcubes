// Ranks are word-themed names shown instead of the rating number. Placeholder names: the team picks the final ones.
// One rank per difficulty level; the rating is split evenly between them (see docs/round-system-design.md).
export const RANK_NAMES = ['Letter', 'Syllable', 'Word', 'Phrase', 'Sentence', 'Paragraph', 'Author']
export const RATING_PER_RANK = 200

export function rankIndex(rating: number): number {
  return Math.max(0, Math.min(RANK_NAMES.length - 1, Math.floor(rating / RATING_PER_RANK)))
}
export const rankName = (rating: number): string => RANK_NAMES[rankIndex(rating)]
