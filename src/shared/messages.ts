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
  // server -> client
  toast: Schemas.Map({ text: Schemas.String }),
  fx: Schemas.Map({ kind: Schemas.String, slot: Schemas.Int }), // 'lock' | 'fail' | 'win'
  coins: Schemas.Map({ value: Schemas.Int })
})
