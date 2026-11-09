// Wire format of the cube messages (server/cubesync.ts sends them, client/cubenet.ts reads them).
// Cubes are not synced entities: the SDK broadcasts synced changes to the whole scene, so every player received every
// game's cubes. These messages go only to the players seated in that game.
//
// Records are packed into one Short array (2 bytes a field). Positions are absolute (never deltas), in cm from the
// game's origin, so any message can be applied on its own and a lost one is fixed by the next.

export const MODES = ['free', 'held', 'flying', 'placed'] as const
export type CubeMode = (typeof MODES)[number]

/** id, letter, mode | FRESH, slot, holder index (-1 none), x, y, z, yaw */
export const STATE_FIELDS = 9
/** id, x, y, z, yaw */
export const MOVE_FIELDS = 5
export const FRESH = 4 // mode flag: part of the pile born at the message's `born` time (the client plays its fall)

// Keep every message well under the 12 KB comms limit: room messages are not split into chunks like synced state.
export const MAX_STATE_RECORDS = 300 // 9 fields x 2 bytes x 300 = 5.4 KB
export const MAX_MOVE_RECORDS = 500 // 5 x 2 x 500 = 5 KB

export const MAX_CUBE_ID = 32000 // ids travel as Shorts

const SHORT = 32767
const clampShort = (v: number) => Math.max(-SHORT, Math.min(SHORT, Math.round(v)))

/** Metres from the origin to a Short in cm (+-327 m). */
export const packPos = (metres: number) => clampShort(metres * 100)
export const unpackPos = (v: number) => v / 100

/** Yaw in radians to a Short in hundredths of a degree, -180..180. */
export function packYaw(radians: number): number {
  let deg = (radians * 180) / Math.PI
  deg = ((((deg + 180) % 360) + 360) % 360) - 180
  return clampShort(deg * 100)
}
export const unpackYawDeg = (v: number) => v / 100

export const packLetter = (letter: string) => letter.charCodeAt(0)
export const unpackLetter = (v: number) => String.fromCharCode(v)

export const packMode = (mode: string, fresh: boolean) => Math.max(0, MODES.indexOf(mode as CubeMode)) | (fresh ? FRESH : 0)
export const unpackMode = (v: number): { mode: CubeMode; fresh: boolean } => ({ mode: MODES[v & 3], fresh: (v & FRESH) !== 0 })
