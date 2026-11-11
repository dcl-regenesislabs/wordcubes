# Word Cubes — onboarding with Cubby

## Current owner direction

The tutorial is a **single-player, client-only experience**. Cubes, grabs, throws, Cubby's assistance, collapse, reconstruction and step progression run locally. There is no tutorial server instance, seat reservation, gameplay validation, sync packet or acknowledgement. Other players must not be visible anywhere in this sequence, including the lobby welcome.

This supersedes the earlier implementation of a private server-backed practice game. The owner explicitly clarified that the practice scene is for one player and needs neither a server nor validation. That earlier approach has been removed; the seven public games keep their existing server implementation.

The tutorial is mandatory until completed once, has no Skip button, and can later be replayed from How to Play. Original inspiration: issue #57 brainstorm, https://github.com/dcl-regenesislabs/wordcubes/issues/57#issuecomment-6638819622. The owner chose the Cubby laboratory over coaching in a public round.

## Sequence

1. Arrive talking to Cubby. A cinematic shows the public pads rising in order 1, 2, 3, 4, 5, 6, 7. This does not reorder the rooms.
2. Cubby spawns a practice pad with the normal pad collider and white status plate. Walk onto it and create practice in the language selected on the phone/app (saved UI language on desktop).
3. A copy of the existing arena appears locally at the unused eighth location within the current parcels. Only the local player and the scene's local NPCs remain visible.
4. The first arena cinematic explains the arrow: it marks the beginning and reading direction; the first **letter** goes in the adjacent first frame.
5. Solve SUN in English or SOL in Spanish/Portuguese, with an obvious clue. The first letter is placed near the player, away from the pedestal. Tap the letter or the explicit mobile pickup button; it is held immediately.
6. The player places the first letter, Cubby throws the middle letter in a cinematic, and the player finds, carries and throws the last letter. Cinematics alternate with playable steps.
7. Cubby explains the shared-word rule, demonstrates an incorrect X, and the whole word falls. Practice has no lockout; Cubby explains the public-room penalty.
8. Cubby rebuilds the first two letters and the player places the last letter again. Celebrate and return to the public lobby.

The word selection and scripted X demonstration are implementation choices within the approved easy-word and safe-error lesson. Coins, shop items, ranks and voting are deferred.

## Local runtime and persistence

- All practice cube and GameState entities are local and are never synced. The normal cube models, carrying/throw animations, letter frames, highlighting and sounds are reused.
- The practice pile has deterministic positions; it does not run the public server physics or push prediction. No tutorial actions can change public rooms, award coins, spend items, or alter rating.
- Pickups and placements do not wait for network replies or perform server distance checks. The coach still guides one letter/frame at a time.
- An avatar modifier covers the lobby and lab while the tutorial is active, excluding the local player and local NPCs. NPC AvatarShape IDs use stable address-shaped scene identifiers so mobile keeps those identities in modifier exclusions; the coach is excluded before spawning. Other players' cube packets, effects and toasts cannot affect the lab. The server does not eject visitors from the local lab coordinate.
- Leaving or interrupting practice removes its local cubes/state and restores camera/input/avatar visibility. Replaying creates a fresh local practice.
- The server supplies the initial profile check and completion storage: after completion, save `tutorialComplete` in the existing profile, without checking gameplay. It is retried in the background until the profile acknowledges it. Neither completion nor practice waits for this save.
- On arrival, wait for the server profile and connection before deciding whether onboarding is required. If the server is unavailable, keep the connection screen; never assume the tutorial is unfinished.
- The public-game connection gate remains in place outside the tutorial. It releases local tutorial input and cannot override an active cinematic when a late connection arrives.

## Mobile presentation

- No Skip button; no black letterbox entities in either tutorial renderer.
- Cream/violet Cubby dialogue with body text at 1/30 of landscape viewport height, a larger name and touch action, always centred at the bottom. Body/name/button proportions are informed by Marsh Colony's dialogue, using viewport-based sizing to avoid simulator/DPR inflation. Next and pickup actions sit beside the text.
- English, Spanish and Portuguese touch prompts. The pickup button targets the highlighted letter; letters must be carried to the world frames and placed there; the dialogue has no placement controls. Brief touch guards prevent one finger action from advancing dialogue and immediately placing a cube.
- Cinematics hide joystick/crosshair/native actions and freeze movement while preserving carry emotes. Playable steps restore joystick, jump and pointer. Unrelated break/hint/toss actions are not part of the lesson.
- Mobile never requests cursor lock. Narrow-screen camera framing uses camera height instead of unsupported FOV changes. Godot phone preview and device side safe insets select the mobile layout.

## Verification and remaining limits

Automated checks exercise the full local word/collapse/rebuild loop in all languages with zero gameplay network messages, instant pickup that cannot be undone by a timeout, cleanup, public-game prediction, local progression after an initial profile check, delayed profile gating, cinematic input, saved completion, avatar exclusions, mobile touch controls and caption bounds. Public-game tests remain in place.

Real-device visual framing, readability, avatar modifier behavior and touch behavior still need in-world confirmation. Passing tests does not establish that the player understands the lesson. No assets were downloaded and parcels were not changed.

The lab pad is ten metres from Cubby and seven metres from the welcome teleport, outside its 4.4-metre visible footprint with walking space. Its activation radius matches the normal pad radius. Enter practice shows a three-second cinematic countdown before local arena entry. The player manually finds, carries and throws the first and last letters; Cubby helps by throwing the middle letter during a cinematic. Only the post-collapse final letter introduces UI placement. Cinematics retain world PointerEvents descriptors, temporarily set their reach to zero and hide feedback, then restore their full options during playable steps. UI events remain untouched. Practice world frames use a forgiving sixteen-metre pointer reach so third-person camera distance does not block placement.

Cubby is the tutorial guide, without a shop sign, and asks whether to replay the tutorial when spoken to outside the tutorial. Bix is a separate merchant with a red shirt and dark hair, shop markers and shop interactions in the lobby and public arenas. The practice companion remains Cubby. Tutorial replay is a lobby-only action in How to Play, removed from Settings.

Lobby order follows the existing Cubby-to-Lexi anchor line: Cubby stays at VendorNpc, Bix takes RankNpc, and Lexi moves four metres beyond Bix along that line. Cubby offers explicit replay / not now choices; merely talking to him never starts the tutorial.

Mobile dialogue aligns a complete name/text column with a vertically centred action column. Panel and button rims share the same viewport-based scale; Next, pickup and retry tile keep a consistent action-column width. The mistake caption stays visible through the collapse and waits for Next instead of auto-advancing, on both desktop and mobile.

Public room pads are mapped to their physical left-to-right order, keeping the original room 1 in place. Each room number, status, lights, interaction and cinematic reveal uses that same mapping.

Tutorial entry always waits for the initial server profile and scene connection to be ready before checking tutorialComplete. There is no timeout fallback to an assumed first visit; manual replay also respects this entry gate. After the initial decision, the practice mechanics remain entirely local.
