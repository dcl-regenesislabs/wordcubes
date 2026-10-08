// Central tuning values. Arena is a circle centred in parcel (1,1) area of the 32x32 scene.
export const CENTER = { x: 16, z: 16 }
export const ARENA_RADIUS = 14
export const FLOOR_Y = 0.1 // top of the arena floor disc
export const WALL_HEIGHT = 9
export const WALL_SEGMENTS = 48

// Central stage (cubes are kept out of it, slots float above it)
// Two-tier pedestal. The sim treats the outer tier as a solid column that cubes cannot enter.
export const STAGE_RADIUS = 5
export const STAGE_TOP = 1.0 // taller than a cube (~0.83m) so cubes can't be on it
export const STAGE_UPPER_RADIUS = 3.6
export const STAGE_UPPER_TOP = 1.5
export const SLOT_Y = 3.1 // letter frames float about head height over the stage
export const SLOT_SPACING = 1.15

// Cubes (GLB collider is a 0.5m box, visual ~0.51m)
export const CUBE_SCALE = 1.6 // GLB is ~0.51m, so cubes are ~0.82m in the world
export const CUBE_HALF = 0.255 * CUBE_SCALE
export const CUBE_RADIUS = 0.26 * CUBE_SCALE // sphere radius used by the sim
export const HOLD_SCALE = CUBE_SCALE // carried cubes keep their full size (use a smaller number to shrink them in the hands)
export const CUBES_PER_ROUND = 300
export const SPAWN_MIN_RADIUS = STAGE_RADIUS + 1.5
export const SPAWN_MAX_RADIUS = 10 // piled in a heap around the stage, not spread to the wall
export const SPAWN_MIN_Y = 3
export const SPAWN_MAX_Y = 22

// Interaction
// The Carry_Box pose holds the box overhead in both raised hands, so the cube rides above the head bone.
// Offset is in the head bone's space: raise/lower y to meet the hands, z moves it forward/back.
export const CARRY_OFFSET = { x: 0, y: 0.65, z: 0.05 }
export const HAND_FORWARD = 0.05 // approximate world launch point for drop / throw
export const HAND_RIGHT = 0
export const HAND_HEIGHT = 2.2
export const THROW_RELEASE_DELAY = 0.2 // seconds from triggering the throw emote to release
export const TOSS_SPEED = 7 // F: forward speed of a cube you throw away (not at a frame)
export const TOSS_UP = 3.5
export const THROW_FLIGHT_TIME = 0.75
export const THROW_ARC_HEIGHT = 1.6
export const HOLD_EMOTE = 'models/carry_box_emote.glb'
export const THROW_EMOTE = 'models/throw_ball_emote.glb'
export const INTERACT_DISTANCE = 10
// Cubes don't block the player: the player pushes them instead (see PLAYER_RADIUS). If true, settled
// cubes would get a hard physics collider on top of that.
export const CUBES_BLOCK_PLAYER = false

// Economy / rules
export const COINS_PER_BREAK = 5
export const COINS_PER_WORD = 25
export const NEXT_ROUND_DELAY = 4 // seconds
export const ROUNDS_FOR_REWARD = 2

// Physics
export const GRAVITY = -14
export const RESTITUTION = 0.35
export const FLOOR_FRICTION = 2.5 // 1/s horizontal damping when grounded
export const AIR_DRAG = 0.1

// Placed cubes snap to this orientation. The letter models have the glyph's top pointing sideways on their
// +Z face, so a roll of -90 stands the letters upright for a viewer on the +Z (spawn) side.
// If letters come out upside down instead, use 90. If they face away, use a yaw of 180.
export const PLACED_YAW = 0
export const PLACED_ROLL = 90

// Player as a pusher: walking into cubes shoves them aside.
export const PLAYER_RADIUS = 0.45
export const PLAYER_HEIGHT = 1.2 // only legs/waist shove cubes, so stacks above you are left alone

// Network feel (server -> clients)
export const NEAR_RADIUS = 10 // cubes this close to any player are sent every server tick (30 Hz)
export const FAR_SEND_INTERVAL = 0.1 // all other moving cubes: 10 Hz
export const PUSH_LOOKAHEAD = 0.05 // seconds: pushers are predicted ahead to hide the player-position latency
// Client-side smoothing of moving free cubes (hides the real cube and shows a local copy). Off: a copy created on the
// fly can take a moment to load, so cubes blink out and pop back in. Real cubes are sent at 30 Hz near players instead.
export const SMOOTH_FREE_CUBES = false

// Local push prediction: cubes you walk into move on your screen right away (same sim as the server, run locally on
// a copy), then glide to where the server put them once you stop touching them. Other players still see your pushes
// through the server, as before.
export const PREDICT_PUSHES = true
// Also predict other players' pushes from where their avatar is drawn here (it arrives before the server's cubes).
export const PREDICT_REMOTE_PUSHES = true
export const PREDICT_RADIUS = 4 // m around you: free cubes mirrored into the local sim
export const PREDICT_HANDOFF = 0.35 // s after your last touch before a cube starts following the server again
export const PREDICT_BLEND_RATE = 6 // 1/s: how fast a predicted cube glides to the server's position
export const PREDICT_SNAP = 3 // m: further than this from the server's position and the prediction is dropped
export const PREDICT_MAX_TIME = 6 // s: a prediction never lasts longer than this
