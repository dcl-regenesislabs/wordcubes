# Word Cubes: Pillars, Retention & Rewards

Draft, 2026-11-17. Design only: nothing in this doc is built yet. It defines the core pillars (issue #1) and the rewards ladder (issue #4). Numbers are first guesses to tune in the balance pass (issue #30).

## Core pillars

1. **Build together, fall together.** The word is shared. Everyone digs and places, and one wrong cube drops the whole word, so cooperation always carries some tension.
2. **Words you can grab.** Letters are physical cubes you pick up, carry, throw and break. Word Cubes is a word game played with your hands, not with a keyboard.
3. **A reason to come back every day.** One Daily Word for everyone and a streak that grows with each day you solve it.
4. **Progress you can see.** Rank, titles and cosmetics show over your head and on your cubes, so other players can see how far you have come.

Design and balance decisions should support at least one pillar and must not work against any of them.

## Why players come back

Today the only long-term progress is rating, and it can go down. Coins only buy power-ups that help you win more coins, so saving them up leaves nothing to show. Nothing changes from one day to the next, and with 315 words a returning player soon sees repeats.

The answer has three layers:

| Horizon | Hook | Reward |
| --- | --- | --- |
| Every round | Build the word | Coins and rating (built) |
| Every day | **Daily Word** and **streak** | Daily coins, streak bonuses, streak titles |
| Every week or month | **Milestones**, **cosmetics** and **seasons** | Titles, cosmetics, season ranking and Hall of Fame |

There are no wearable rewards. The team has no wearables to give, and nothing in the game should promise one. Wearables can be added to milestones later without changing this structure.

## Daily Word

- One special word per day, per language, the same for every player. The day changes at 00:00 UTC.
- It is harder than a normal round, with a more elaborate clue such as a riddle. It is picked from a curated list, separate from the level lists, so the main bank is not used up. A year needs 365 words per language.
- It is played in a dedicated **Daily Word** room with its own pad in the lobby. Its sign shows the day's clue category and how many players have solved it today. Whoever is in the room cooperates as usual, and a single player can solve it alone. Its round timer is fixed and the room does not vote.
- A player solves the day's word by contributing to it: placing a cube in the final standing word, as in public rooms. The first solve each day pays **100 coins** and counts for the streak. Later solves that day pay normal round coins only.
- **Today's board:** players who solved it, sorted by solve time measured from the round start. This board is separate from the rating leaderboard.
- Daily Word rounds do not change rating, so a hard daily word never feels like a punishment.

## Streak

- Your streak counts the consecutive UTC days on which you solved the Daily Word. Missing a day resets it to 0. The profile also keeps your best streak.
- Streak milestones pay out once per streak run:

| Streak | Reward |
| --- | --- |
| 3 days | 50 coins |
| 7 days | 150 coins and the title *On Fire* |
| 14 days | 300 coins |
| 30 days | 500 coins and the title *Wordsmith* |

- The current streak shows in the lobby HUD next to coins and rank, and a toast announces each new day ("Streak: 4 days").
- *Later, optional:* a **Streak Shield** item from the vendor that saves your streak once if you miss a day. Only add it if playtests show that losing a streak makes players quit.

## Cosmetics (coin sink)

Coins currently have no use that other players can see. Cosmetics fix that. They change only how things look, never gameplay, and they are saved in the profile.

| Cosmetic | Where it shows | Price (coins) |
| --- | --- | --- |
| **Title** | Under your rank label above your head | 150 to 400, or unlock only |
| **Burst colour** | The particles when a cube you placed locks in, or you break a cube | 200 |
| **Placement trail** | A short trail behind a cube you throw | 300 |
| **Cube skin** | The look of cubes you are holding (pattern or material tint) | 600 |

- You equip one of each from the Settings panel or from Bix's shop under a new Cosmetics tab.
- Some titles can't be bought: they come from streaks, milestones or seasons. Those are the ones that show status.
- Cosmetics must be readable on mobile and must never hide the cube's letter.

## Milestones

Lifetime achievements paid once, based on profile counters:

| Milestone | Reward |
| --- | --- |
| First word built | 50 coins |
| 10 words built | Title *Builder* |
| 50 words built | 300 coins |
| 100 words built | Title *Architect* |
| 250 words built | A burst colour that can't be bought |
| First Daily Word | Title *Early Bird* |
| 25 Daily Words | Title *Daily Devotee* |

A toast and a short card announce each milestone. How to Play or Lexi's dialogue lists the next one, so there is always a visible goal.

## Seasons

- A season lasts one calendar month (UTC).
- At the start of a season everyone's rating is halved. This soft reset keeps ranks meaningful and gives players who lost rating a fresh climb.
- The leaderboard sign gets a **This season** tab ranked by peak rating during the season.
- At season end, the top 10 receive a permanent title naming the season (for example *Champion · Dec 2026*), and the top 3 go on a **Hall of Fame** board in the lobby.

## Profile and data

New fields on the saved profile (`src/server/profiles.ts`). All of them have defaults, so old profiles load unchanged:

- `firstDay`, `lastDay`: UTC day numbers of the first and last day a counted round was played.
- `daysPlayed`: number of distinct days played.
- `streak`, `bestStreak`, `dailySolvedDay`: Daily Word streak state.
- `dailySolves`: number of Daily Words solved.
- `milestones`: milestones already paid out.
- `cosmetics`: owned cosmetic ids. `equipped`: equipped id per slot.
- `season`, `seasonPeak`: current season id and peak rating in that season.

The legacy `rewarded` flag stays as is for compatibility.

**Retention metrics.** `firstDay`, `lastDay` and `daysPlayed` make it possible to measure D1 and D7 return. A small server-side report should count, per first day, how many players came back one day later and seven days later.

## Effect on balance (#30)

Daily coins, streak bonuses and milestones add income, and cosmetics add a large coin sink. Tune power-up prices only after this lands. The goal is that a regular player can afford a power-up most days and a new cosmetic about every week.

## Build order

1. Profile fields and daily tracking (`lastDay`, `daysPlayed`), plus the D1/D7 report. This is cheap and starts measuring right away.
2. Daily Word room, curated daily list (EN/ES/PT), today's board.
3. Streak, its HUD counter and streak rewards.
4. Milestones and titles over the rank label.
5. Cosmetics shop tab, burst colours, trails, cube skins.
6. Seasons, the soft reset, the season leaderboard tab and the Hall of Fame.

## Open questions

- [ ] Who writes and reviews the daily word lists, and how far in advance?
- [ ] Final names for titles, and whether they are translated or kept in English.
- [ ] Is a halved rating the right soft reset, or should everyone drop one rank instead?
- [ ] Does the Daily Word room need its own location, or can it reuse a public arena slot?
