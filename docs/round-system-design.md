# Word Cubes: Difficulty, Voting & Rating Design

Draft, updated 2026-10-15. Items marked *proposed* have not been confirmed. "Built" means committed on the `roundsystem` branch and type-checked, but not yet playtested by the team.

## Summary

Each room votes on its own difficulty after every round, and each player earns or loses rating against that difficulty. This doc collects what we agreed in the design discussion so the team can review it before we build.

## Where we are today

Everything in this doc is built on the `roundsystem` branch and type-checked. None of it has been playtested by the team yet. What is left is content (a bigger word bank, sounds), tuning, and delivering the real wearable.

| Feature | Status |
| --- | --- |
| Core loop: question, cube pile, free-for-all placing, collapse on a wrong cube | Built |
| Round timer, difficulty levels 1 to 7, vote between rounds | Built |
| Word bank with a list per level | Built; 105 words, a starter set |
| Pile can never become unsolvable | Built |
| Coins only for the players who built the word; vote bonus | Built |
| Collapse lockout, hints that cost coins | Built |
| Saved profiles: coins, rating, inventory (by wallet) | Built, in server Storage |
| Rating and ranks (Elo against the room level) | Built |
| Rank shown in the lobby, on the in-game badge, over other players, and on a leaderboard | Built |
| Vendor with Wildcard, Time Freeze, Reroll and Bomb, in the lobby and in the arena | Built |
| Rank guide NPC | Built (draft text) |
| Break and bomb effects (3D particles) | Built |
| Wearable reward after 2 won rounds | Announced per player; the real wearable is not delivered |
| Sounds | Missing: the project has no audio files |
| Question bank big enough for 24/7 play | Missing: needs bulk content |

## Difficulty levels

A room has one difficulty level from 1 to 7, starts at level 1, and only the players in the room can change it by voting. Players do not pick a difficulty for themselves.

Difficulty does not change the number of cubes. The pile already has plenty of decoys. Difficulty comes from the question:

| Lever | What changes | When |
| --- | --- | --- |
| Word length and obscurity | Short common words at level 1, long or obscure words at level 7 | Built |
| Question style | Direct clue versus vague or riddle-style clue | Later |
| Round timer | Shorter at higher levels (240 s at level 1, 150 s at level 7) | Built |
| Hints | Cheaper or automatic at low levels, off at high levels | Later |

Each level has its own word list and its own round timer (`LEVELS` in `config.ts`). The other levers can be switched on later without changing the round logic.

**Rule: the pile can never become unsolvable.** Each round already spawns every letter of the answer, duplicates included. But a player can break a needed cube and remove it for good. When that happens, or any needed cube is otherwise lost, the server spawns a replacement so the pile always holds at least the letters the word still needs.

Rooms start when players join and can run for days. If the room is empty, the timer and any vote pause.

## Voting

After every round, won or timed out, the players in the room vote Easier, Same or Harder, and the majority of votes sets the next round's level.

- The level moves at most one step per round, so a room cannot jump from 1 to 7.
- Only players currently in the room vote. A tie keeps the level. *Proposed:* no vote counts as Same.
- The vote needs a longer gap than today's 4-second delay between rounds, probably 10 to 15 seconds.

Getting people to vote is the main risk. *Proposed* ways to help:

- A large, central vote screen with a visible countdown and three big buttons.
- End the vote early once everyone present has voted.
- A small coin bonus just for voting (3 coins, built).
- Show the room's average rank on the vote screen, so people know who they are voting with.

## Contributors, points and rating

Only players who took part in building the word earn or lose anything. Standing around the room earns nothing.

**On a win**, the players who placed the cubes in the final standing word get the points. Earlier cubes that were lost in a collapse do not count.

Example: A places a correct P. B places a wrong cube and the whole word drops. C places the correct P again, and nobody else places anything. C gets the points, not A, because A's cube was not part of the word that was completed.

**On a timeout**, the round is a failure even if the word was one letter short. Everyone who locked in at least one correct cube during the round, and is still in the arena, loses rating. In the example above, both A and C lose rating, because both locked in a correct cube. A player who only placed wrong cubes does not.

**Rating**

- Each player has a rating. Each of the 7 levels has a fixed rating in the middle of its rank band: 100, 300, 500 and so on up to 1300. They are evenly spaced to start and can be adjusted after playtests.
- The gain or loss depends on the gap between the player's rating and the level's rating, the way Elo works.
- A new player gains a lot for winning at any level and loses little for failing. As their rating grows, wins at level 1 give almost nothing and a failure at level 1 costs a lot. That pushes players to vote for harder levels.
- Rating is separate from coins. Coins are spendable and only go up. Rating can go down.
- Higher levels give no coin multiplier. With 7 levels a multiplier would reach 7x, which is too much. Coins stay flat, and progress at higher levels shows up as rating.
- Rating changes only apply to contributors who are still in the arena when the round ends, so a player cannot place one cube and leave to avoid a loss.
- New players are protected for their first 5 rounds: wins are worth 1.5 times as much and losses a quarter as much. A rating never goes below 0.
- The formula is Elo with K = 40. A brand new player gains about 38 points for winning at level 1 and loses about 4 for a timeout. A player rated 600 gains about 2 points at level 1 and loses about 38.
- Each rank covers 200 rating points, and there are 7 ranks.

## Anti-troll lockout and hints

**Collapse lockout.** A collapse is not a rating failure. Instead, the player who caused it cannot place cubes for 25 seconds. Playtests already showed some players trolling by placing wrong cubes. A countdown shows on their screen, and they can still grab, break and throw cubes during the lockout.

**Hints cost coins.** Hints are free and unlimited today, so anyone can spam them. They now cost coins: 10 for the first hint in a round, then 20, 30 and so on. The requester pays and the whole room sees the letter.

## Ranks and display

Players see a rank name, not the rating number, which hides the formula and is friendlier. The names should be word-themed. These are placeholders for the team to replace:

| Rank | Placeholder name |
| --- | --- |
| 1 | Letter |
| 2 | Syllable |
| 3 | Word |
| 4 | Phrase |
| 5 | Sentence |
| 6 | Paragraph |
| 7 | Author |

Where ranks show:

- In the lobby, next to your coins.
- On the in-game badge, next to the level.
- Over every player's head (yours too), as a small floating label (the SDK has no way to edit the built-in name tag).
- On a Top players panel that appears when you stand near the Leaderboard sign in the lobby.

There is no matchmaking. Players choose a room from the pad and leave to find another if it is not for them.

## UI and feedback

Built, and kept in one UI kit (`src/client/ui/`) so desktop and phone share the same look:

- **Lobby HUD:** your coins (with a coin icon) and your rank, plus a How to play button.
- **How to play card:** opens only from its buttons, in the lobby and in the game. It does not open by itself.
- **Letter tiles:** the word shows as a row of tiles that match the cube colours. While you hold a cube, tapping an empty tile throws the cube into that frame. This is the main way to place on a phone, because aiming at the 3D frame is hard on a touch screen. Grabbing stays in the 3D pile.
- **Round result banner:** word complete or time's up, how many players built it, and your own coin reward.
- **Level banner:** "Level 2 to 3" for a moment when the vote changes the difficulty.
- **Pad sign:** the room's level and how many players are in the arena.
- **Break effect:** gold sparks when a cube pays coins, a grey puff when it was a letter the word needs.

- **Frame glow:** while you hold a cube, the empty frames pulse gold, and so do the empty letter tiles.
- **Settings panel:** on/off switches saved with the player's profile. The first switch hides the rank labels over heads. New switches are one line in `SETTINGS` in `config.ts`.
- **Item bar:** the power-ups you own appear as buttons on the right while a round runs.
- **Rank up message** when your rating crosses into a new rank, and the rating change in the round result.

Not built yet: sounds. The project has no audio files, and the sounds in the team's other scenes have no recorded licence, so none were copied.

## Lobby NPCs and shop

Two kinds of NPC made from Decentraland avatars. Players click one to talk, and the conversation or shop uses the UI kit panel.

- **Lexi, Keeper of Ranks:** explains the ranks, the vote and who earns the reward. The text is a draft.
- **Cubby, the Vendor:** there are two, one in the lobby and one inside the arena, so players can restock without leaving. A spinning wildcard box and a SHOP sign float over each, so they are easy to spot. Their outfits use base wearables only; a more distinctive look needs wearable URNs from the team.

Move an NPC by adding an empty entity with its name in the Creator Hub: `RankNpc`, `VendorNpc` (lobby) or `VendorNpcGame` (arena). Without one, the code places them.

Items are bought with coins, kept in the player's saved inventory between rounds and sessions, and used in the arena. A player can carry up to 9 of each.

| Item | Price (coins) | What it does |
| --- | --- | --- |
| Wildcard | 250 | You get a wildcard box in your hands. Place it in any empty frame: it counts as the right letter and stays put when the word collapses. One wildcard per round in the whole room. |
| Time Freeze | 90 | Stops the round timer for 20 seconds. |
| Reroll | 60 | Throws out the loose pile and drops a fresh set of cubes. |
| Bomb | 70 | Removes the loose letters around you that the word does not use, and shoves the useful ones away. |

Each player has a 30-second cooldown between power-ups. Wildcards are limited by the one-per-round rule instead. A wildcard cannot be broken for coins. The "raise difficulty" power-up from the GDD is replaced by the vote.

Prices are a first guess. Coins come from 25 per finished word, 5 per broken cube, and 3 per vote, so a wildcard takes roughly ten finished words.

## Technical dependencies

- **Round timer** on the server, paused when the room is empty. Built.
- **Tiered word bank.** Built with 7 levels and 105 words. A 24/7 room needs a much larger bank, which is content work (a generated bank, reviewed).
- **Persistence by wallet address.** Built with the server Storage. Profiles are saved at most every 15 seconds and when a player leaves, never on every change. Reading the data back for the D7-return metric is not built.
- **Per-round contributor tracking** on the server: who placed each cube in the final word, and who placed any correct cube during the round. Built.
- **New messages and UI:** a vote message and vote screen, a lockout countdown and hint pricing are built. The rank display at the pad and over nameplates is not.
- **Replacement spawn** for needed cubes that get broken. Built.
- **Shop and inventory** for the vendor. Built.

## Open questions

- [ ] Should the real wearable reward still go out after 2 won rounds, and how is it delivered?
- [ ] Are the item prices and the 30-second cooldown right? Tune after playtests.
- [ ] Should the one-wildcard-per-round limit apply to the room (as built) or to each player?
- [ ] What are the final rank names?
- [ ] How long should a round last at each level?
- [ ] Which wearables should the vendor wear?
- [ ] Who writes and reviews the larger word bank, and in which languages?
- [ ] Which sounds do we want, and where do they come from?

## Build order and what is left

1. Done: round timer, difficulty levels, per-level word lists, and the rule that the pile can never become unsolvable.
2. Done: vote phase, vote screen and vote bonus.
3. Done: contributor tracking, coins only for builders, collapse lockout, priced hints.
4. Done: saved profiles, rating, ranks, leaderboard and rank labels.
5. Done: vendor, inventory, wildcard, Time Freeze, Reroll and Bomb.
6. Left: playtest and tune (timers, prices, rating numbers).
7. Left: a much bigger word bank, sounds, the real wearable reward, and vendor outfits.
