import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const room = registerMessages({
  // client -> server
  join: Schemas.Map({ n: Schemas.Int }),
  grab: Schemas.Map({ cubeId: Schemas.Int }),
  place: Schemas.Map({ slot: Schemas.Int }),
  toss: Schemas.Map({ n: Schemas.Int }),
  breakCube: Schemas.Map({ n: Schemas.Int }),
  hint: Schemas.Map({ n: Schemas.Int }),
  vote: Schemas.Map({ choice: Schemas.Int }), // -1 easier, 0 same, 1 harder
  // where a cube you pushed came to rest in your local prediction (predict.ts); the server checks it and adopts it
  settle: Schemas.Map({ cubeId: Schemas.Int, x: Schemas.Number, y: Schemas.Number, z: Schemas.Number, yaw: Schemas.Number }),
  // server -> client
  toast: Schemas.Map({ text: Schemas.String }),
  fx: Schemas.Map({ kind: Schemas.String, slot: Schemas.Int }), // 'lock' | 'fail' | 'win'
  coins: Schemas.Map({ value: Schemas.Int }),
  lockout: Schemas.Map({ seconds: Schemas.Int }) // you caused a collapse: no placing for this many seconds
})
