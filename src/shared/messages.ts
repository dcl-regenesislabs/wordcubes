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
  cheat: Schemas.Map({ n: Schemas.Int }), // testing cheat (see CHEATS_ENABLED in config)
  setSetting: Schemas.Map({ key: Schemas.String, value: Schemas.Int }), // a Settings panel switch: 1 on, 0 off
  buy: Schemas.Map({ item: Schemas.String }), // vendor: buy one of ITEMS with coins
  useItem: Schemas.Map({ item: Schemas.String }), // arena: use one from your inventory
  // where a cube you pushed came to rest in your local prediction (predict.ts); the server checks it and adopts it
  settle: Schemas.Map({ cubeId: Schemas.Int, x: Schemas.Number, y: Schemas.Number, z: Schemas.Number, yaw: Schemas.Number }),
  // server -> client
  toast: Schemas.Map({ text: Schemas.String }),
  fx: Schemas.Map({ kind: Schemas.String, slot: Schemas.Int }), // 'lock' | 'fail' | 'win'
  coins: Schemas.Map({ value: Schemas.Int }),
  burst: Schemas.Map({ x: Schemas.Number, y: Schemas.Number, z: Schemas.Number, gold: Schemas.Int }), // effect here: 0 grey puff (needed letter broken), 1 gold sparks (coin break), 2 bomb blast
  result: Schemas.Map({ coins: Schemas.Int, delta: Schemas.Int }), // end of round, for players who took part: coins earned and rating change
  profile: Schemas.Map({ rating: Schemas.Int, wildcard: Schemas.Int, reroll: Schemas.Int, freeze: Schemas.Int, bomb: Schemas.Int, settings: Schemas.String }), // your saved data; settings is JSON like {"showRanks":true}
  lockout: Schemas.Map({ seconds: Schemas.Int }) // collapse penalty: no grabbing, breaking, placing, hints or power-ups
})
