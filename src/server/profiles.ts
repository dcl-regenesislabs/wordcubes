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
  settings: Record<string, boolean>
}

const KEY = 'wc:profile'
const fresh = (): Profile => ({ coins: 0, rating: 0, rounds: 0, wins: 0, rewarded: false, items: {}, settings: {} })

const cache = new Map<string, Profile>()
const unsafe = new Set<string>() // the read failed: keep playing with an empty profile, but never overwrite the stored one
const loading = new Map<string, Promise<Profile>>()
const dirty = new Set<string>()
const active = new Set<string>()
const saving = new Set<string>()

export const profileOf = (address: string): Profile | undefined => cache.get(address)

/** Pin a present player's profile before starting or joining an asynchronous load. */
export function retain(address: string): Promise<Profile> {
  active.add(address)
  return loadProfile(address)
}

export function loadProfile(address: string): Promise<Profile> {
  const have = cache.get(address)
  if (have) return Promise.resolve(have)
  const pending = loading.get(address)
  if (pending) return pending
  const p = Storage.player
    .get<Profile>(address, KEY)
    .then((stored) => ({ ...fresh(), ...(stored ?? {}), items: { ...(stored?.items ?? {}) }, settings: { ...(stored?.settings ?? {}) } }))
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

function evictIfIdle(address: string) {
  if (active.has(address) || saving.has(address) || dirty.has(address) || loading.has(address)) return
  cache.delete(address)
  unsafe.delete(address)
}

function save(address: string) {
  const profile = cache.get(address)
  if (!profile || saving.has(address) || unsafe.has(address)) return
  // Snapshot nested data too: changes during this write must stay queued for the next checkpoint.
  const snapshot = { ...profile, items: { ...profile.items }, settings: { ...profile.settings } }
  saving.add(address)
  dirty.delete(address)
  void Storage.player.set(address, KEY, snapshot)
    .then((ok) => {
      if (!ok) dirty.add(address)
    })
    .catch(() => dirty.add(address))
    .finally(() => {
      saving.delete(address)
      evictIfIdle(address)
    })
}

// Serialize writes per wallet. Failed writes and changes made during a write remain queued for retry.
export function saveSome(max = 8) {
  let n = 0
  for (const address of Array.from(dirty)) {
    if (saving.has(address)) continue
    if (n++ >= max) break
    save(address)
  }
}

// A rejoining player pins the same profile while its departure save is still in flight.
export function release(address: string) {
  active.delete(address)
  if (loading.has(address)) {
    void loading.get(address)!.then(() => {
      if (!active.has(address)) release(address)
    })
    return
  }
  if (dirty.has(address)) save(address)
  evictIfIdle(address)
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
