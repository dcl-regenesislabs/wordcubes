// Per-player saved data, keyed by wallet address. Kept in memory while the player is around and written to the
// server Storage at checkpoints (never per change: storage writes are capped). Server only.
import { Storage } from '@dcl/sdk/server'

export interface Profile {
  coins: number
  rating: number
  rounds: number // rounds played that counted (built a word, or took part in one that timed out)
  wins: number
  rewarded: boolean // legacy stored flag; retained for profile compatibility
  items: Record<string, number>
  settings: Record<string, boolean | number> // switches (true / false) and volume levels (0..VOLUME_MAX)
}

const KEY = 'wc:profile'
const fresh = (): Profile => ({ coins: 0, rating: 0, rounds: 0, wins: 0, rewarded: false, items: {}, settings: {} })

const cache = new Map<string, Profile>()
const loading = new Map<string, Promise<Profile | undefined>>()
const dirty = new Set<string>()
const active = new Set<string>()
const saving = new Set<string>()

export const profileOf = (address: string): Profile | undefined => cache.get(address)

// Reads go through a queue: when many players arrive at once (a full world joining together), firing every read at
// the same moment passes the isolate's 40 host calls in flight and the excess fail. A read that fails is not replaced
// by an empty profile: nothing is cached (so nothing can overwrite the saved one) and it is tried again a little later.
// The server's housekeeping asks again every second for every present player, which is what retries it.
const MAX_READS = 10 // profile reads in flight at once; saves, the leaderboard and env vars share the same 40
const RETRY_MS = [1000, 2000, 5000, 10000, 15000] // wait after the 1st, 2nd... failed read (the last one repeats)
const waiting: { address: string; done: (p: Profile | undefined) => void }[] = []
let reading = 0
const failures = new Map<string, { n: number; at: number }>() // address -> failed reads in a row, time of the last

/** Pin a present player's profile before starting or joining an asynchronous load. Undefined: not loaded (yet). */
export function retain(address: string): Promise<Profile | undefined> {
  active.add(address)
  return loadProfile(address)
}

export function loadProfile(address: string): Promise<Profile | undefined> {
  const have = cache.get(address)
  if (have) return Promise.resolve(have)
  const pending = loading.get(address)
  if (pending) return pending
  const failed = failures.get(address)
  if (failed && Date.now() - failed.at < RETRY_MS[Math.min(failed.n, RETRY_MS.length) - 1]) return Promise.resolve(undefined)
  const p = new Promise<Profile | undefined>((done) => waiting.push({ address, done }))
  loading.set(address, p)
  pump()
  return p
}

function pump() {
  while (reading < MAX_READS && waiting.length > 0) {
    const { address, done } = waiting.shift()!
    reading++
    Storage.player
      .get<Profile>(address, KEY)
      .then(
        (stored): Profile | undefined => {
          const profile = { ...fresh(), ...(stored ?? {}), items: { ...(stored?.items ?? {}) }, settings: { ...(stored?.settings ?? {}) } }
          cache.set(address, profile)
          failures.delete(address)
          return profile
        },
        (e) => {
          const n = (failures.get(address)?.n ?? 0) + 1
          failures.set(address, { n, at: Date.now() })
          console.log('[SERVER] profile read failed, will retry', address, 'attempt', n, e)
          return undefined
        }
      )
      .then((profile) => {
        reading--
        loading.delete(address)
        done(profile)
        pump()
      })
  }
}

export function touch(address: string) {
  if (cache.has(address)) dirty.add(address)
}

function evictIfIdle(address: string) {
  if (active.has(address) || saving.has(address) || dirty.has(address) || loading.has(address)) return
  cache.delete(address)
}

function save(address: string) {
  const profile = cache.get(address)
  if (!profile || saving.has(address)) return
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
  failures.delete(address)
  if (loading.has(address)) {
    void loading.get(address)!.then(() => {
      if (!active.has(address)) release(address)
    })
    return
  }
  if (dirty.has(address)) save(address)
  evictIfIdle(address)
}

/** Forget the failed reads of players who are gone (their retry clock starts over if they come back). */
export function forgetFailures(present: Set<string>) {
  for (const address of Array.from(failures.keys())) if (!present.has(address)) failures.delete(address)
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
