import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const room = registerMessages({
  // client -> server
  join: Schemas.Map({ n: Schemas.Int }),
  // Start game on an idle game's pad: the server starts the shared countdown. lang: the language picked on the pad.
  start: Schemas.Map({ game: Schemas.Int, lang: Schemas.String }),
  enter: Schemas.Map({ game: Schemas.Int }), // ask for a seat in a game before teleporting (max MAX_PLAYERS_PER_GAME)
  leave: Schemas.Map({ n: Schemas.Int }), // back in the lobby: give the seat up
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
  // the cubes of your game, all at once (on entering, or after a gap in cubeState): see shared/cubenet.ts
  cubeSync: Schemas.Map({ game: Schemas.Int }),
  netStats: Schemas.Map({ n: Schemas.Int }), // the live monitor asks for the server's numbers (NET_STATS)
  // server -> client
  netStatsReply: Schemas.Map({ json: Schemas.String }), // answer to netStats (server/netstats.ts)
  netAccess: Schemas.Map({ ok: Schemas.Int }), // 1: this wallet may open the live monitor (env NET_MONITOR_WALLETS)
  // Cube state for one game, sent only to its seated players (shared/cubenet.ts has the record layout).
  // s: sequence number of this game's state messages, so a client sees a gap and asks for cubeSync.
  // full: 1 while answering cubeSync (end: 1 on its last part: cubes it did not list are gone).
  cubeState: Schemas.Map({
    g: Schemas.Int,
    s: Schemas.Int,
    full: Schemas.Int,
    end: Schemas.Int,
    o: Schemas.Vector3, // the game's origin: positions are relative to it
    born: Schemas.Int64, // birth time of the records flagged FRESH
    holders: Schemas.String, // comma-separated addresses, indexed by the records
    d: Schemas.Array(Schemas.Short),
    gone: Schemas.Array(Schemas.Short) // ids removed
  }),
  // positions of the cubes that moved (plus a few at rest, in turn); s = the latest cubeState sequence number
  cubeMoves: Schemas.Map({ g: Schemas.Int, s: Schemas.Int, o: Schemas.Vector3, d: Schemas.Array(Schemas.Short) }),
  entered: Schemas.Map({ game: Schemas.Int, ok: Schemas.Int }), // answer to enter: 1 seat granted, 0 game full
  eject: Schemas.Map({ n: Schemas.Int }), // you stand in an arena without a seat: go back to the lobby
  // text: English; key + args (JSON): the same message for the client to show in its language (server/say.ts)
  toast: Schemas.Map({ text: Schemas.String, kind: Schemas.Optional(Schemas.String), key: Schemas.Optional(Schemas.String), args: Schemas.Optional(Schemas.String) }),
  fx: Schemas.Map({ kind: Schemas.String, slot: Schemas.Int }), // 'lock' | 'fail' | 'win'
  coins: Schemas.Map({ value: Schemas.Int }),
  burst: Schemas.Map({ x: Schemas.Number, y: Schemas.Number, z: Schemas.Number, gold: Schemas.Int }), // effect here: 0 grey puff (needed letter broken), 1 gold sparks (coin break), 2 bomb blast
  result: Schemas.Map({ coins: Schemas.Int, delta: Schemas.Int }), // end of round, for players who took part: coins earned and rating change
  profile: Schemas.Map({ rating: Schemas.Int, wildcard: Schemas.Int, reroll: Schemas.Int, freeze: Schemas.Int, bomb: Schemas.Int, settings: Schemas.String }), // your saved data; settings is JSON like {"showRanks":true}
  lockout: Schemas.Map({ seconds: Schemas.Int }) // collapse penalty: no grabbing, breaking, placing, hints or power-ups
})
