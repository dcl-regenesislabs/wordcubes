import { engine, Schemas, Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// One per cube. Transform is only meaningful while mode === 'free'; for the other modes the server parks the
// real cube underground and clients draw their own copy (held in a player's hands, in flight, or in a frame).
export const CubeData = engine.defineComponent('wc:Cube', {
  game: Schemas.Int, // which game (arena) the cube belongs to; clients only show cubes of the game they are in
  id: Schemas.Int,
  letter: Schemas.String,
  mode: Schemas.String, // 'free' | 'held' | 'flying' | 'placed'
  slot: Schemas.Int, // frame index for 'flying' / 'placed', else -1
  holder: Schemas.String, // lowercased address of the player holding / throwing it, else ''
  // Server time (ms) the cube was created as part of a freshly settled pile, 0 otherwise. The server settles a new pile
  // before anyone sees it; clients play the fall from this time (cubes.ts), and everyone ends on the same resting spots.
  born: Schemas.Int64
})

// Per-game room state (one entity per game). The answer itself is never in here, only the letters already placed or hinted.
export const GameState = engine.defineComponent('wc:GameState', {
  game: Schemas.Int, // game index 0..GAME_COUNT-1, one GameState entity per game
  active: Schemas.Int, // 1 while the game has players and is running, 0 when it is idle and waiting for a first player
  phase: Schemas.String, // 'playing' | 'won' | 'timeout' | 'vote'
  round: Schemas.Int,
  difficulty: Schemas.Int, // room level, 1..7
  timeLeft: Schemas.Int, // whole seconds left in the round (stops while nobody is in the arena)
  board: Schemas.String, // top players: "address:rating,address:rating,..." best first
  frozen: Schemas.Int, // seconds of Time Freeze left (the round timer is stopped)
  players: Schemas.Int, // players standing in the arena
  builders: Schemas.Int, // how many players built the last finished word
  voteLeft: Schemas.Int, // whole seconds left in the vote (phase 'vote')
  voteDown: Schemas.Int, // votes cast so far: easier / same / harder
  voteSame: Schemas.Int,
  voteUp: Schemas.Int,
  completed: Schemas.Int,
  question: Schemas.String,
  length: Schemas.Int,
  masked: Schemas.String, // placed letters, '_' for empty frames, e.g. "BR_D__"
  hint: Schemas.String, // revealed hint letters, '' if none yet
  hintCost: Schemas.Int, // coins the next hint costs, 0 when no hints are left
  heartbeat: Schemas.Int64
})

// Everyone's rating, so every client can put a rank over each player: "address:rating,address:rating,..."
export const PlayerRanks = engine.defineComponent('wc:Ranks', { data: Schemas.String })

if (isServer()) {
  PlayerRanks.validateBeforeChange((v) => v.senderAddress === AUTH_SERVER_PEER_ID)
  CubeData.validateBeforeChange((v) => v.senderAddress === AUTH_SERVER_PEER_ID)
  GameState.validateBeforeChange((v) => v.senderAddress === AUTH_SERVER_PEER_ID)
}

type ComponentWithValidation = {
  validateBeforeChange: (entity: Entity, cb: (value: { senderAddress: string }) => boolean) => void
}

// Server only: stop clients from writing built-in components on a server-owned entity.
export function protectServerEntity(entity: Entity, components: ComponentWithValidation[]) {
  for (const component of components) {
    component.validateBeforeChange(entity, (value) => value.senderAddress === AUTH_SERVER_PEER_ID)
  }
}

/** What to call a cube in text: the wildcard box is '*' internally. */
export const letterLabel = (letter: string): string => (letter === '*' ? 'Wildcard' : letter)

export function modelFor(letter: string): string {
  if (letter === '*') return 'assets/models/CubeWildCard.glb' // the wildcard box
  if (letter === 'Ñ') return 'assets/models/CubeNh.glb'
  return `assets/models/Cube${letter}.glb`
}
