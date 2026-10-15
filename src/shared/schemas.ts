import { engine, Schemas, Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// One per cube. Transform is only meaningful while mode === 'free'; for the other modes the server parks the
// real cube underground and clients draw their own copy (held in a player's hands, in flight, or in a frame).
export const CubeData = engine.defineComponent('wc:Cube', {
  id: Schemas.Int,
  letter: Schemas.String,
  mode: Schemas.String, // 'free' | 'held' | 'flying' | 'placed'
  slot: Schemas.Int, // frame index for 'flying' / 'placed', else -1
  holder: Schemas.String // lowercased address of the player holding / throwing it, else ''
})

// Singleton room state. The answer itself is never in here, only the letters already placed or hinted.
export const GameState = engine.defineComponent('wc:GameState', {
  phase: Schemas.String, // 'playing' | 'won' | 'timeout' | 'vote'
  round: Schemas.Int,
  difficulty: Schemas.Int, // room level, 1..7
  timeLeft: Schemas.Int, // whole seconds left in the round (stops while nobody is in the arena)
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

if (isServer()) {
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

export function modelFor(letter: string): string {
  if (letter === '*') return 'assets/models/CubeWildCard.glb' // the wildcard box
  if (letter === 'Ñ') return 'assets/models/CubeNh.glb'
  return `assets/models/Cube${letter}.glb`
}
