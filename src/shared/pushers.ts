// Players as pushers, built the same way on the server (authoritative sim) and
// on every client (local push prediction), so both sims shove cubes alike and
// the prediction's hand-off back to the server has as little error as possible.
//
// Player positions arrive in bursts, so speed is measured over the time since
// the position last changed and then smoothed; otherwise it alternates between
// 0 and huge spikes that fling cubes. The pusher sits PUSH_LOOKAHEAD ahead
// along that speed to hide the position latency.
import * as C from '../config'
import type { Pusher } from '../sim/physics'

interface Track {
  x: number
  z: number
  since: number
  vx: number
  vz: number
}

const MIN_SPAN = 1 / 30 // never measure speed over less than one server tick
const SMOOTH_SPAN = 0.25 // a gap this long (or longer) replaces the speed outright
const STALE_AFTER = 0.25 // no new position for this long: the speed decays
const STALE_DECAY_PER_TICK = 0.8 // per 1/30 s, so it decays alike at any frame rate
const TELEPORT = 6 // m: a jump this big resets the speed

export class PusherTracker {
  private tracks = new Map<string, Track>()

  /** Feed one player's current position; returns that player's pusher. */
  update(id: string, x: number, y: number, z: number, dt: number): Pusher {
    let tr = this.tracks.get(id)
    if (!tr) {
      tr = { x, z, since: 0, vx: 0, vz: 0 }
      this.tracks.set(id, tr)
    }
    tr.since += dt
    const dx = x - tr.x
    const dz = z - tr.z
    if (dx !== 0 || dz !== 0) {
      if (dx * dx + dz * dz > TELEPORT * TELEPORT) {
        tr.vx = tr.vz = 0
      } else {
        const span = Math.max(tr.since, MIN_SPAN)
        const k = Math.min(1, span / SMOOTH_SPAN)
        tr.vx += (dx / span - tr.vx) * k
        tr.vz += (dz / span - tr.vz) * k
      }
      tr.x = x
      tr.z = z
      tr.since = 0
    } else if (tr.since > STALE_AFTER) {
      const decay = Math.pow(STALE_DECAY_PER_TICK, dt * 30)
      tr.vx *= decay
      tr.vz *= decay
    }
    return { x: x + tr.vx * C.PUSH_LOOKAHEAD, y, z: z + tr.vz * C.PUSH_LOOKAHEAD, vx: tr.vx, vz: tr.vz }
  }

  /** Forget players that are no longer present. */
  prune(present: Set<string>): void {
    for (const id of Array.from(this.tracks.keys())) if (!present.has(id)) this.tracks.delete(id)
  }
}
