# Word Cubes: Difficulty, Voting & Rating Design

Draft, updated 2026-10-15. Items marked *proposed* have not been confirmed. "Built" means committed on the `roundsystem` branch and type-checked, but not yet playtested by the team.

## Summary

Each room votes on its own difficulty after every round, and each player earns or loses rating against that difficulty. This doc collects what we agreed in the design discussion so the team can review it before we build.

## Where we are today

The core loop, timer, difficulty levels, voting, contributor tracking, lockout and priced hints are built. What is missing is everything that needs per-player storage (rating, rank, coins that survive a restart), the tiered word bank, and the vendor.

| Feature | In the GDD | Status |
| --- | --- | --- |
| Question with blanks, cube pile, free-for-all placing | Yes | Built |
| Wrong placement collapses the whole word | Yes | Built |
| All cubes reshuffled each round | Yes | Built |
| Physics-driven cubes, players shove them | Yes | Built |
| Coins from breaking cubes and finishing a word | Yes | Built; coins are held in memory only |
| Round timer | Implied by time freeze | Built |
| Difficulty levels 1 to 7 per room | Ideas section | Built; the level only changes the word length and the timer |
| Vote between rounds | Ideas section | Built |
| Pile can never become unsolvable | Not specified | Built |
| Coins only for the players who built the word | Not specified | Built |
| Collapse lockout | Not specified | Built |
| Hints cost coins | Not specified | Built |
| Break effect (3D particles) | Not specified | Built |
| Wearable after 2 completed cycles | Yes | Stub (a toast message only) |
| Power-ups (freeze, raise difficulty, reroll, wildcard) | Yes | Missing |
| Rating, ranks and the rank display | Not specified | Display placeholder only; rating is not built |
| Tiered word bank | Flagged as a risk | Missing; about 20 words, longest is 6 letters |
| Per-player persistence | Needed for the success metrics | Missing |
| Lobby NPCs (rank guide, vendor) | Not specified | Rank guide built (draft text); vendor not built |

## Difficulty levels

A room has one difficulty level from 1 to 7, starts at level 1, and only the players in the room can change it by voting. Players do not pick a difficulty for themselves.

Difficulty does not change the number of cubes. The pile already has plenty of decoys. Difficulty comes from the question:

| Lever | What changes | When |
| --- | --- | --- |
| Word length and obscurity | Short common words at level 1, long or obscure words at level 7 | First build |
| Question style | Direct clue versus vague or riddle-style clue | Later |
| Round timer | Shorter at higher levels | Later |
| Hints | Cheaper or automatic at low levels, off at high levels | Later |

The first build only needs a tiered word bank. A per-level settings table holds every lever, so the others can be switched on later without changing the round logic.

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
- A small coin bonus just for voting.
- Show the room's average rank on the vote screen, so people know who they are voting with.

## Contributors, points and rating

Only players who took part in building the word earn or lose anything. Standing around the room earns nothing.

**On a win**, the players who placed the cubes in the final standing word get the points. Earlier cubes that were lost in a collapse do not count.

Example: A places a correct P. B places a wrong cube and the whole word drops. C places the correct P again, and nobody else places anything. C gets the points, not A, because A's cube was not part of the word that was completed.

**On a timeout**, the round is a failure even if the word was one letter short. Contributors lose rating. In the example above, C loses rating because C took part.

**Rating**

- Each player has a rating. Each of the 7 levels has a fixed rating, evenly spaced to start and adjusted after playtests.
- The gain or loss depends on the gap between the player's rating and the level's rating, the way Elo works.
- A new player gains a lot for winning at any level and loses little for failing. As their rating grows, wins at level 1 give almost nothing and a failure at level 1 costs a lot. That pushes players to vote for harder levels.
- Rating is separate from coins. Coins are spendable and only go up. Rating can go down.
- Higher levels give no coin multiplier. With 7 levels a multiplier would reach 7x, which is too much. Coins stay flat, and progress at higher levels shows up as rating.
- *Proposed:* rating changes only apply to contributors who are still in the room when the round ends, so a player cannot place one cube and leave to avoid a loss.
- *Proposed:* new players are protected for their first few rounds with a very small loss. The length of that period is a tuning number.

## Anti-troll lockout and hints

**Collapse lockout.** A collapse is not a rating failure. Instead, the player who caused it cannot place cubes for a set time. Playtests already showed some players trolling by placing wrong cubes. *Proposed:* start at 20 to 30 seconds, show a countdown on their screen, and let them keep grabbing and breaking cubes during the lockout.

**Hints cost coins.** Hints are free and unlimited today, so anyone can spam them. They will cost coins, which also gives coins their first use. *Proposed:* the requester pays, the hint is revealed to the whole room as now, and each extra hint in the same round costs more than the one before.

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

- At the start pad, next to the room's current difficulty level.
- Inside the game, over each player's nameplate.

There is no matchmaking. Players choose a room from the pad and leave to find another if it is not for them. Whether the nameplate display is feasible in the SDK still needs checking.

## UI and feedback

Built, and kept in one UI kit (`src/client/ui/`) so desktop and phone share the same look:

- **Lobby HUD:** your coins (with a coin icon) and your rank, plus a How to play button.
- **How to play card:** opens only from its buttons, in the lobby and in the game. It does not open by itself.
- **Letter tiles:** the word shows as a row of tiles that match the cube colours. While you hold a cube, tapping an empty tile throws the cube into that frame. This is the main way to place on a phone, because aiming at the 3D frame is hard on a touch screen. Grabbing stays in the 3D pile.
- **Round result banner:** word complete or time's up, how many players built it, and your own coin reward.
- **Level banner:** "Level 2 to 3" for a moment when the vote changes the difficulty.
- **Pad sign:** the room's level and how many players are in the arena.
- **Break effect:** gold sparks when a cube pays coins, a grey puff when it was a letter the word needs.

Not built yet: sounds (needs audio assets), a highlight on the frames when you first hold a cube, a leaderboard on the lobby sign (needs persistence), and the rank over player nameplates.

## Lobby NPCs and shop

Two NPCs made from Decentraland avatars stand in the lobby. Players click one to talk, and the conversation uses the UI kit panel.

- **Lexi, Keeper of Ranks:** built. Explains the ranks, the vote and who earns the reward. The text is a draft and describes the planned system; ranks do not change yet.
- **Vendor:** not built. It needs a server-side shop (items, prices, a purchase message and an inventory per player). Questions for the team are in the list below.

## Technical dependencies

- **Round timer** on the server, paused when the room is empty. Built.
- **Tiered word bank.** Every question needs a level from 1 to 7. Word length can stand in as a first proxy, then a large generated bank replaces it. Content work, and it can run in parallel with the code.
- **Persistence by wallet address.** Coins and rating currently live in memory and reset when the server restarts. Rating, and the D7-return metric in the GDD, both need storage. This should be designed before the rating is built.
- **Per-round contributor tracking** on the server: who placed each cube in the final word, and who placed any correct cube during the round. Built.
- **New messages and UI:** a vote message and vote screen, a lockout countdown and hint pricing are built. The rank display at the pad and over nameplates is not.
- **Replacement spawn** for needed cubes that get broken. Built.
- **Shop and inventory** for the vendor: items, prices, purchase message, and what each item does in a round.

## Open questions

- [ ] On a timeout, does rating drop for every player who ever placed a correct cube, or only for players whose cubes were in the word at the end? In the example, is A penalised too?
- [ ] Does a player who only placed wrong cubes lose rating on a timeout?
- [ ] How long is the collapse lockout, and can the player still grab and break cubes during it?
- [ ] How long is a round at each level, and how long is the vote window?
- [ ] How many rounds does the new-player protection last?
- [ ] What are the final rank names?
- [ ] Where does the storage for coins and rating live, and who owns it?
- [ ] What does the "raise difficulty" power-up from the GDD become now that the room votes?
- [ ] Is the wearable reward still given after 2 completed cycles, and is that counted per player?
- [ ] What exactly does a wildcard do? For example, it fills any empty slot with the correct letter, or it matches any letter but still collapses if used in the wrong place.
- [ ] What does the vendor sell besides wildcards (reroll, time freeze, bomb), and what does each cost?
- [ ] Are bought items used in a round only, or kept in an inventory between rounds and sessions?
- [ ] Can the vendor be used inside the game, or only in the lobby?
- [ ] Should a player's rank be shown over their nameplate in the arena, or only in the lobby?

## Suggested build order

1. Done: round timer, a difficulty field on the room, a per-level settings table, and the rule that the pile can never become unsolvable.
2. Done: word selection by level, using word length as a stand-in until the real bank exists.
3. Done: vote phase on the server, plus the vote screen.
4. Done: contributor tracking, and coins only for contributors.
5. Done: collapse lockout, and hints that cost coins.
6. Next: persistence by wallet address, then the rating and rank system, then the rank display at the pad and over nameplates.
7. After the decisions above: the vendor, the shop and the wildcard.

The tiered word bank is content work and can run alongside all of these.
