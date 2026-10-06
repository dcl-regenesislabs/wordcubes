# Word Cubes

A persistent, multiplayer word-hunting game for [Decentraland](https://decentraland.org), built with SDK7 and the
Multiplayer Server (the beta `auth-server` SDK branch).

A question appears with the answer shown as blanks. A big pile of letter cubes lies around a central stage. Players dig
through the pile, pick the cubes they need and throw them into the frames. **One wrong cube and the whole word
collapses back to the floor**, for everyone in the room. Cubes you are sure don't belong can be broken for coins.

This is a first playable prototype. The core loop works end to end, with the server owning all game state. Several
things are rough on purpose, see [Status and next steps](#status-and-next-steps).

## How to play

| Action | Control |
| --- | --- |
| Grab a cube | Click it (within ~10 m) |
| Throw it into a frame | Click the frame while holding a cube |
| Break the held cube for coins | `E` (coins only if the letter is **not** in the word) |
| Throw the held cube away | `F` |
| Hint (reveals one more letter, shared) | `1` or the Hint button (free the cursor first) |

Walking into cubes pushes them. A completed word gives every player in the room coins, and the next round starts after a
short delay with a completely fresh pile. Finishing 2 words is meant to unlock a wearable reward (a stub message for now).

The game design lives in the team's Notion: **GDD Word Cubes** (Content Team).

## Run it

You need Node 22 (the `sdk-commands` build uses `fs.globSync`, which Node 20 does not have).

```bash
npm install
npm run start        # starts the preview and a local Multiplayer Server
npm run build        # bundle + type-check only
```

Or import the folder in the [Creator Hub](https://decentraland.org/download/creator-hub) and press Play.

**Testing with more than one player**

- In Creator Hub's Play Options tick **Multi-Instance Preview** and press Play again for each extra window. Each window
  needs a different account.
- Or keep the desktop client open and add the **Web (Bevy)** client as a second player
  (`npm run start -- --web`).

**AI coding assistants.** The Decentraland skills are not committed. Install them with
`npx skills add decentraland/sdk-skills --all` (see `AGENTS.md`).

`package.json` pins `@dcl/sdk` and `@dcl/js-runtime` to the `auth-server` prerelease. Do not swap them for the stable SDK,
it has no server APIs. `authoritativeMultiplayer: true` in `scene.json` is added by the build, do not remove it.

## Architecture

```
src/
  index.ts            entry: isServer() branches into the server or the client
  config.ts           every tuning value (arena, cubes, physics, timings, network feel)
  shared/
    schemas.ts        synced components: CubeData (per cube), GameState (singleton)
    messages.ts       client -> server actions and server -> client events
  server/
    server.ts         rounds, slots, coins, hints, validation, 30 Hz physics, position sync
    words.ts          hardcoded question/answer bank (~20 entries)
  sim/
    physics.ts        pure TypeScript cube physics (no SDK imports)
  client/
    setup.ts          input, message handlers, per-frame systems
    cubes.ts          client view of the server's cubes (see "proxies" below)
    arena.ts          floor, two-tier stage, wall, letter frames (all local, static)
    frames.ts         frame effects: lock-in, fail shake, win wave
    emotes.ts         carry / throw emotes
    ui.tsx            HUD (React-ECS, not editable in the UI Designer)
assets/models/        Cube<A-Z>.glb, CubeNh (N with tilde), CubeWildCard (unused), CubeFrame
models/               emote clips (must end in _emote.glb)
```

**Server authority.** Clients never write game state. They send `grab`, `place`, `toss`, `breakCube`, `hint`, and the
server validates each one (phase, ownership, distance to the cube). Whether a thrown cube is correct is decided on the
server when it lands. The answer is never in synced state, only the letters already placed or hinted.

**Cubes.** The server creates every cube as a synced entity (`Transform`, `GltfContainer`, `CubeData`) and runs the
physics. While a cube is `free`, its synced `Transform` is the truth. In every other mode (`held`, `flying`, `placed`) the
server parks the real cube underground and each client draws a local copy ("proxy"): carried on the head bone of the
holder, flying to a frame, or sitting in a frame. That is how carrying and the frame animations work without writing the
synced transforms from the client.

**Physics.** `sim/physics.ts` treats each cube as an upright sphere with yaw spin only (no tumbling, so corners never sink
into the floor). It has gravity, a floor, a circular wall, a stage column that cubes slide off, sleeping, and players as
cylinders that shove cubes. It is plain TypeScript with no SDK imports, so it can be tested in Node or moved elsewhere.

## Status and next steps

Works: full loop (round, grab, carry with the carry-box emote, throw into a frame, lock-in, collapse on a wrong cube,
word complete wave, new round), hints, break-for-coins, multiple players sharing one room.

**The sync and physics feel is the main thing to improve.** Specifically:

- **Latency of pushes.** All physics runs on the server and positions are written to the synced `Transform`s, so a cube
  only reacts after the server has seen the player move. Mitigations in place: cubes within `NEAR_RADIUS` of a player are
  written every tick (30 Hz), the rest at 10 Hz; pushers are predicted `PUSH_LOOKAHEAD` ahead; player speed is smoothed
  because positions arrive in bursts. Ideas: client-side prediction of the local player's pushes, a velocity-based
  snapshot format with client interpolation, or moving the pile to client-simulated physics with the server only
  arbitrating.
- **Chaotic pushing.** Walking through the dense pile can still send cubes in odd directions. The sim measures calm in
  isolation (a simulated 5 m/s run moves no cube faster than ~3 m/s), so the rest is probably network and rendering. The
  push logic is in `sim/physics.ts` (`PUSH_*` constants) and the server-side speed estimate is in `server.ts`.
- **Client smoothing is off.** `SMOOTH_FREE_CUBES` in `config.ts` shows a local interpolated copy of moving cubes, but a
  copy created on the fly can take a moment to load, so cubes blink and pop. Turning it on works best with preloaded,
  pooled proxies.
- **Cube count.** 300 cubes per round is the most we tried. The opening drop is the heaviest sync moment. A deeper heap
  (like the concept art) needs several times more cubes.
- **Cubes do not block the player.** They only get a pointer collider. Players push them instead. `CUBES_BLOCK_PLAYER`
  would also give settled cubes a physics collider.

Other known gaps and untested assumptions:

- **Not persisted.** Coins live in server memory and reset when the server restarts. There is no storage yet.
- **No server liveness UI.** On a cold start in production the server takes ~15 s. There is a `heartbeat` field in
  `GameState` but no "server waking up" screen.
- **Frame colors.** The frame effects recolor `CubeFrame.glb` through `GltfNodeModifiers`. The frame model has no
  material, so the engine may ignore the override. If the frames stay pink, give the model a simple material.
- **Carry pose.** The carry cube sits above the head bone (`CARRY_OFFSET`) to match the Carry_Box clip. It needs in-world
  tuning. The throw uses the one-handed ball-throw clip and looks odd after an overhead carry.
- **Letter orientation.** The letter models are authored sideways on the face shown, so placed cubes use
  `PLACED_ROLL = 90`. Flip the sign if letters ever show upside down.
- **Frame reading direction.** The frame row reads left to right only from the spawn side of the circular room. Ideas:
  numbered frames with a START marker, a glow on the next empty frame, or a ring of mirrored rows.
- **Content.** The word bank is 21 hardcoded English entries. The GDD calls for a large bank and per-language rooms
  (Brazil / LatAm). Power-ups (time freeze, reroll, wildcard) and the `CubeWildCard` model are not wired up yet.
- **HUD** is coded React-ECS, so the Creator Hub UI Designer cannot edit it.

## Tuning

Almost everything is a constant in [`src/config.ts`](src/config.ts): arena and stage size, cube scale and count, hold
and throw offsets and timings, push strength, network send rates and the effect timings in `client/frames.ts`.
