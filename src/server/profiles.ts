// Per-player saved data, keyed by wallet address. Kept in memory while the player is around and written to the
// server Storage at checkpoints (never per change: storage writes are capped). Server only.
import { Storage } from '@dcl/sdk/server'

export interface Profile {
  coins: number
  rating: number
  rounds: number // rounds played that counted (built a word, or took part in one that timed out)
  wins: number
  rewarded: boolean // the wearable reward (stub) was announced
  items: Record<string, number>
}

const KEY = 'wc:profile'
const fresh = (): Profile => ({ coins: 0, rating: 0, rounds: 0, wins: 0, rewarded: false, items: {} })

const cache = new Map<string, Profile>()
const unsafe = new Set<string>() // the read failed: keep playing with an empty profile, but never overwrite the stored one
const loading = new Map<string, Promise<Profile>>()
const dirty = new Set<string>()

export const profileOf = (address: string): Profile | undefined => cache.get(address)

export function loadProfile(address: string): Promise<Profile> {
  const have = cache.get(address)
  if (have) return Promise.resolve(have)
  const pending = loading.get(address)
  if (pending) return pending
  const p = Storage.player
    .get<Profile>(address, KEY)
    .then((stored) => ({ ...fresh(), ...(stored ?? {}), items: { ...(stored?.items ?? {}) } }))
    .catch((e) => {
      console.log('[SERVER] profile read failed', address, e)
      unsafe.add(address)
      return fresh()
    })
    .then((profile) => {
      cache.set(address, profile)
      loading.delete(address)
      return profile
    })
  loading.set(address, p)
  return p
}

export function touch(address: string) {
  if (cache.has(address) && !unsafe.has(address)) dirty.add(address)
}

// Writes a few changed profiles. A failed write stays dirty and is tried again at the next checkpoint.
export function saveSome(max = 8) {
  let n = 0
  for (const address of Array.from(dirty)) {
    if (n++ >= max) break
    const profile = cache.get(address)
    dirty.delete(address)
    if (!profile) continue
    Storage.player
      .set(address, KEY, profile)
      .then((ok) => {
        if (!ok) dirty.add(address)
      })
      .catch(() => dirty.add(address))
  }
}

// A player left: save once more, then forget them so the cache does not grow forever.
export function release(address: string) {
  const profile = cache.get(address)
  if (!profile) return
  if (dirty.has(address)) {
    dirty.delete(address)
    Storage.player
      .set(address, KEY, profile)
      .then(() => cache.delete(address))
      .catch(() => cache.delete(address))
  } else cache.delete(address)
}

export function allCached(): [string, Profile][] {
  return Array.from(cache.entries())
}

// ---- rating ----
export function levelRating(level: number, perRank: number): number {
  return (level - 1) * perRank + perRank / 2
}

/** Elo: chance this player beats the level, then points won or lost. Provisional players gain more and lose very little. */
export function ratingDelta(rating: number, rounds: number, level: number, won: boolean, k: number, perRank: number, provisionalRounds: number): number {
  const expected = 1 / (1 + Math.pow(10, (levelRating(level, perRank) - rating) / 400))
  const provisional = rounds < provisionalRounds
  if (won) return Math.max(1, Math.round(k * (provisional ? 1.5 : 1) * (1 - expected)))
  const loss = Math.round(k * (provisional ? 0.25 : 1) * expected)
  return -Math.min(loss, Math.max(0, Math.round(rating))) // a rating never goes below 0
}
