// Central tuning values. All positions below are LOCAL to the "GameEnv" entity (see shared/env.ts):
// x/z = 0 is the centre of the arena, y = 0 is the top of GameFloor.glb.
// Keep these in step with the environment models (GameFloor / GameWalls / MidPlatform).
export const ARENA_RADIUS = 14 // inner face of GameWalls (collider ~14.0)
export const FLOOR_Y = 0 // top of GameFloor

// MidPlatform (cubes are kept out of it, slots float above it). Single cylinder, solid for the sim.
export const STAGE_RADIUS = 5
export const STAGE_TOP = 1.5
export const STAGE_UPPER_RADIUS = 0 // no second tier any more
export const STAGE_UPPER_TOP = STAGE_TOP
export const SLOT_Y = 3.1 // letter frames float about head height over the platform
export const SLOT_SPACING = 1.15
// PathArrow marker standing left of the first frame, level with its centre, tip pointing at it.
export const START_ARROW_SCALE = 1
export const START_ARROW_GAP = 0.15 // metres between the arrow's tip and the first frame

// Cubes (GLB collider is a 0.5m box, visual ~0.51m)
export const CUBE_SCALE = 1.6 // GLB is ~0.51m, so cubes are ~0.82m in the world
export const CUBE_HALF = 0.255 * CUBE_SCALE
export const CUBE_RADIUS = 0.26 * CUBE_SCALE // sphere radius used by the sim
export const HOLD_SCALE = CUBE_SCALE // carried cubes keep their full size (use a smaller number to shrink them in the hands)
export const CUBES_PER_ROUND = 300
export const SPAWN_MIN_RADIUS = STAGE_RADIUS + 1.5
export const SPAWN_MAX_RADIUS = 10 // piled in a heap around the stage, not spread to the wall
export const SPAWN_MIN_Y = 3
export const SPAWN_MAX_Y = 22 // local to GameEnv

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
// Cubes you push yourself stay where your prediction left them: the client reports the resting spot and the server
// adopts it (if it is plausible) instead of gliding the cube back to the server's own result.
export const SETTLE_REPORTS = true
export const SETTLE_WAIT = 1 // s: a reported cube holds still this long waiting for the server to confirm it
export const SETTLE_REACH = PREDICT_RADIUS + 2 // m: the server ignores reports of cubes further than this from the player
// A report is only taken from a player whose own path (as the server saw it) came within touching distance of the cube
// recently. Measured against the path, not the server sim's pushes: those are what miss in the first place.
export const SETTLE_TOUCH_WINDOW = 3 // s of each player's path the server keeps for this check
export const SETTLE_TOUCH_SLACK = 0.6 // m added to the touching distance (player positions are late and sparse)
export const SETTLE_COOLDOWN = 0.5 // s: a cube takes at most one report per this interval

// Grass (client-only decoration). Children of the composite entity named "Grass" sway in the wind and bend away from players.
export const GRASS_ENTITY_NAME = 'Grass'
export const GRASS_LEAN_AXIS: 'x' | 'z' = 'x' // the model's OWN local axis that both wind sway and player push rotate around
export const GRASS_WIND_SPEED = 1.4 // rad/s of the main sway
export const GRASS_WIND_AMPLITUDE = 4 // degrees
export const GRASS_WIND_WAVELENGTH = 9 // metres between wind crests (phase shift across the field)
export const GRASS_PUSH_RADIUS = 2.2 // metres: players closer than this bend the grass
export const GRASS_PUSH_ANGLE = 14 // degrees of lean at point-blank range
export const GRASS_SPRING = 12 // stiffness: higher snaps back faster
export const GRASS_DAMPING = 6 // lower = more wobble after a player passes

// Lobby: one start pad. Stand on it and the lights spin up, a countdown runs, then you are teleported to the game.
export const LOBBY_PAD_NAME = 'StartPad.glb_6' // the one pad (child of "Lobby") that starts the game
export const LOBBY_LIGHTS_MODEL = 'assets/models/environment/StartPadLight.glb' // lights spawned over that pad
export const PAD_RADIUS = 4.4 // m from the pad centre that counts as standing on it
export const PAD_LEAVE_MARGIN = 1 // extra metres before you count as having left (no flicker on the rim)
export const PAD_HEIGHT_RANGE = 6 // m: vertical window around the pad
export const LOBBY_COUNTDOWN_SECONDS = 10
export const GAME_SPAWN_RADIUS = 11 // m from GameEnv centre, outside the cube heap, where lobby players land
export const LOBBY_LIGHTS_SPIN_SLOW = 30 // deg/s with someone on the pad
export const LOBBY_LIGHTS_SPIN_FAST = 540 // deg/s at the end of the countdown
export const LOBBY_LIGHTS_TALL = 1.5 // vertical stretch for the last 3 seconds

// Falling off the floating lobby / arena: below this many metres under the floor you are sent back
export const LOBBY_ENTITY_NAME = 'Lobby'
export const LOBBY_RADIUS = 60 // m from the Lobby centre that counts as "in the lobby" (for choosing where to respawn)
export const FALL_RESPAWN_DEPTH = 15 // m below the floor
export const LOBBY_RESPAWN_HEIGHT = 2.8 // m above the Lobby origin (top of the island floor)
export const PAD_LABEL_HEIGHT = 5 // m above the pad centre to the "Join game" text

// DEV ONLY: shows the game HUD with a fake looping round, no server or game needed (stand anywhere in the scene).
// Set to false before merging.
export const UI_PREVIEW = false
