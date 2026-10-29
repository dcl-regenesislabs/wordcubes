import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import * as C from '../config'
import { retain, profileOf, touch, saveSome, release as releaseProfile, allCached } from './profiles'
import { room } from '../shared/messages'
import { arenaAt } from '../shared/env'
import { CubeData, GameState, PlayerRanks } from '../shared/schemas'
import { Storage } from '@dcl/sdk/server'
import { players, giveCoins, sendProfile } from './common'
import { createGame } from './game'
import type { Game } from './game'

// The server runs GAME_COUNT independent games (see game.ts). This module owns what they share: the player list,
// saved profiles, the leaderboard and the rank labels, and it routes each player's messages to the game they sit in.

const BOARD_KEY = 'wc:board'
let board: { a: string; r: number }[] = []
let boardDirty = false
let ranksEntity: Entity
const rankPages: Entity[] = [] // small synced batches; include every present player without a profile-count cutoff
let lastRanks = ''
const absent = new Map<string, number>() // address -> housekeeping checks without finding the player
const lastEject = new Map<string, number>()
let saveAcc = 0
let housekeepAcc = 0
let heartbeatAcc = 0
let clock = 0
const games: Game[] = []

const toastTo = (text: string, to: string) => room.send('toast', { text }, { to: [to] })

const gameOf = (addr: string): Game | undefined => games.find((g) => g.hasSeat(addr))

const boardText = () => board.map((b) => `${b.a}:${b.r}`).join(',')

// Top 5 by rating, across all games. Updated when someone's rating changes, saved with the profiles, shown on the lobby sign.
function updateBoard(address: string, rating: number) {
  const r = Math.round(rating)
  const at = board.findIndex((b) => b.a === address)
  if (at >= 0) board[at].r = r
  else board.push({ a: address, r })
  board.sort((x, y) => y.r - x.r)
  board = board.slice(0, 5)
  boardDirty = true
  publishBoard()
}

function publishBoard() {
  const text = boardText()
  for (const g of games) if (GameState.get(g.stateEntity).board !== text) GameState.getMutable(g.stateEntity).board = text
}

function publishRanks() {
  const entries = players()
    .map(({ address }) => `${address}:${Math.round(profileOf(address)?.rating ?? 0)}`)
    .sort()
  const data = entries.join(',')
  if (data === lastRanks) return
  lastRanks = data
  const pages = Math.max(1, Math.ceil(entries.length / 60))
  for (let page = 0; page < pages; page++) {
    const text = entries.slice(page * 60, (page + 1) * 60).join(',')
    if (page >= rankPages.length) {
      const entity = engine.addEntity()
      PlayerRanks.create(entity, { data: text })
      syncEntity(entity, [PlayerRanks.componentId])
      rankPages.push(entity)
    } else if (PlayerRanks.get(rankPages[page]).data !== text) {
      PlayerRanks.getMutable(rankPages[page]).data = text
    }
  }
  while (rankPages.length > pages) engine.removeEntity(rankPages.pop()!)
}

const itemOf = (id: string) => C.ITEMS.find((i) => i.id === id)

// ---------- messages ----------

function init() {
  room.onMessage('join', (_data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    void retain(addr).then(() => sendProfile(addr))
  })

  // The start pad asks for a seat before the client teleports. At most MAX_PLAYERS_PER_GAME per game.
  room.onMessage('enter', (data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    const index = Math.round(data.game)
    const game = games[index]
    if (!game) return
    // a full game leaves you where you are: only give up your current seat once the new one is granted
    const current = gameOf(addr)
    const ok = game.requestSeat(addr)
    if (ok && current && current !== game) current.leaveSeat(addr)
    console.log('[ENTER]', addr, 'game', index, ok ? 'seat granted' : 'full')
    room.send('entered', { game: index, ok: ok ? 1 : 0 }, { to: [addr] })
    if (!ok) toastTo(`Game ${index + 1} is full (${C.MAX_PLAYERS_PER_GAME} players). Try another pad.`, addr)
  })

  room.onMessage('leave', (_data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    gameOf(addr)?.leaveSeat(addr)
  })

  // Everything below belongs to the game the player sits in; a message from anyone else is ignored.
  for (const name of ['grab', 'place', 'toss', 'breakCube', 'settle', 'vote', 'useItem', 'hint'] as const) {
    room.onMessage(name, (data, ctx) => {
      if (!ctx) return
      const addr = ctx.from.toLowerCase()
      gameOf(addr)?.handle(name, addr, data)
    })
  }

  room.onMessage('cheat', (_data, ctx) => {
    if (!ctx || !C.CHEATS_ENABLED) return
    const addr = ctx.from.toLowerCase()
    giveCoins(addr, C.CHEAT_COINS)
    toastTo(`+${C.CHEAT_COINS} coins (test cheat)`, addr)
  })

  room.onMessage('setSetting', (data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    const p = profileOf(addr)
    if (!p || !C.SETTINGS.some((s) => s.id === data.key)) return // only switches listed in config
    p.settings[data.key] = data.value === 1
    touch(addr)
  })

  room.onMessage('buy', (data, ctx) => {
    if (!ctx) return
    const addr = ctx.from.toLowerCase()
    const item = itemOf(data.item)
    const p = profileOf(addr)
    if (!item || !p) return
    if ((p.items[item.id] ?? 0) >= 9) return toastTo(`You already carry 9 ${item.name}s.`, addr)
    if (p.coins < item.price) return toastTo(`${item.name} costs ${item.price} coins. You have ${p.coins}.`, addr)
    giveCoins(addr, -item.price)
    p.items[item.id] = (p.items[item.id] ?? 0) + 1
    touch(addr)
    sendProfile(addr)
    toastTo(`Bought ${item.name}!`, addr)
  })
}

// ---------- main loop ----------

function serverSystem(dt: number) {
  clock += dt
  for (const g of games) g.tick(dt)

  housekeepAcc += dt
  if (housekeepAcc >= 1) {
    housekeepAcc = 0
    const list = players()
    const present = new Set(list.map((p) => p.address))
    // a player who left the scene gives up their seat
    for (const g of games) for (const addr of Array.from(g.seats.keys())) if (!present.has(addr)) g.leaveSeat(addr)
    for (const g of games) g.housekeep()
    // standing in an arena without a seat (walked in, or the game was full): back to the lobby
    for (const p of list) {
      const at = arenaAt(p.pos.x, p.pos.y, p.pos.z)
      if (at < 0 || games[at]?.hasSeat(p.address)) continue
      if (clock - (lastEject.get(p.address) ?? -Infinity) < 3) continue
      lastEject.set(p.address, clock)
      room.send('eject', { n: at }, { to: [p.address] })
    }
    for (const addr of Array.from(lastEject.keys())) if (!present.has(addr)) lastEject.delete(addr)
    // Presence also recovers profiles if the client's one-shot join message was missed.
    for (const addr of present) {
      const loaded = profileOf(addr) !== undefined
      void retain(addr).then(() => {
        if (!loaded) sendProfile(addr)
      })
    }
    for (const [addr] of allCached()) {
      if (present.has(addr)) absent.delete(addr)
      else if ((absent.get(addr) ?? 0) >= 2) {
        absent.delete(addr)
        releaseProfile(addr)
      } else absent.set(addr, (absent.get(addr) ?? 0) + 1)
    }
    publishRanks()
    saveAcc += 1
    if (saveAcc >= C.PROFILE_SAVE_SECONDS) {
      saveAcc = 0
      saveSome()
      if (boardDirty) {
        boardDirty = false
        void Storage.set(BOARD_KEY, board).then((ok) => {
          if (!ok) boardDirty = true
        })
      }
    }
  }

  heartbeatAcc += dt
  if (heartbeatAcc >= 2) {
    heartbeatAcc = 0
    const now = Date.now()
    for (const g of games) GameState.getMutable(g.stateEntity).heartbeat = now
  }
}

// A restarted server can inherit entities from the previous run's snapshot: clear the old ones.
function clearStaleEntities() {
  for (const [entity] of engine.getEntitiesWith(CubeData)) {
    if (((entity as number) & 0xffff) < 512) continue
    engine.removeEntity(entity)
  }
  for (const [entity] of engine.getEntitiesWith(GameState)) {
    if (((entity as number) & 0xffff) < 512) continue
    engine.removeEntity(entity)
  }
  for (const [entity] of engine.getEntitiesWith(PlayerRanks)) {
    if (((entity as number) & 0xffff) < 512) continue
    engine.removeEntity(entity)
  }
}

export function initServer() {
  clearStaleEntities()
  for (let i = 0; i < C.GAME_COUNT; i++) {
    const stateEntity = engine.addEntity()
    GameState.create(stateEntity, {
      game: i,
      active: 0,
      phase: 'playing',
      round: 0,
      difficulty: C.START_DIFFICULTY,
      timeLeft: 0,
      board: '',
      frozen: 0,
      players: 0,
      builders: 0,
      voteLeft: 0,
      voteDown: 0,
      voteSame: 0,
      voteUp: 0,
      completed: 0,
      question: '',
      length: 0,
      masked: '',
      hint: '',
      hintCost: C.HINT_BASE_COST,
      heartbeat: Date.now()
    })
    syncEntity(stateEntity, [GameState.componentId], 10 + i)
    games.push(createGame(i, stateEntity, { onRating: updateBoard }))
  }
  ranksEntity = engine.addEntity()
  PlayerRanks.create(ranksEntity, { data: '' })
  rankPages.push(ranksEntity)
  syncEntity(ranksEntity, [PlayerRanks.componentId], 2)
  void Storage.get<{ a: string; r: number }[]>(BOARD_KEY)
    .then((stored) => {
      if (stored && Array.isArray(stored)) {
        board = stored.slice(0, 5)
        publishBoard()
      }
    })
    .catch((e) => console.log('[SERVER] board read failed', e))
  init()
  engine.addSystem(serverSystem, 1, 'word-cubes-server')
  console.log(`[SERVER] Word Cubes server started with ${C.GAME_COUNT} games`)
}
