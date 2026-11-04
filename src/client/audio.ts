// One-shot sound effects, clients only. Each clip gets one lazily created global AudioSource entity that is retriggered
// with AudioSource.playSound (same pattern as the other scenes). Everything the server tells you about happens in your own
// game, so the sounds are flat (not positional). The volume sliders in Settings (Music, Sound effects) scale them; 0 is off.
import { AudioSource, EngineInfo, engine, Transform } from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { cs, volumeLevel } from './state'
import { VOLUME_MAX } from '../config'
import { myState } from './gamestate'

const S = 'assets/sounds/'
export const SFX = {
  click: S + 'bong_001.ogg', // any UI button
  grab: S + 'PickUpCube.wav', // you pick a cube up
  lock: S + 'PlaceCorrectCube.wav', // a right letter lands in a frame
  throw: S + 'FruitDrop01.wav', // you throw a cube at a frame
  drop: S + 'DropCube.mp3', // you throw the cube you hold away (F)
  fail: S + 'Hurt.wav', // wrong letter / word collapsed
  win: S + 'WinAGame.wav', // word completed
  timeout: S + 'LoseAGame.wav', // time ran out
  start: S + 'StartGo.wav', // a new round begins
  tick: S + 'ClockTick.wav', // last seconds of the round
  teleport: S + 'teleport.wav', // to a game / back to the lobby
  coin: S + 'CoinsSound.ogg', // coins went up
  rankUp: S + 'breed.mp3', // new rank
  spell: S + 'magicspell.wav', // wildcard / reroll / freeze used
  bomb: S + 'Bomb.mp3', // a bomb blast
  breakCube: S + 'BreakCube.wav', // a cube was broken
  talk1: S + 'NPCTalk.ogg', // an NPC speaks
  talk2: S + 'NPCTalk2.wav'
}
// Each clip's own volume at the default effects level (the Settings slider scales them all). The files were recorded at
// very different levels (a clip's peak is shown), so these even them out: the quiet ones play at full volume, the loud
// ones are turned down. A volume cannot go above 1, so a clip like PlaceCorrectCube sets how loud the others can be.
const GAIN: Record<string, number> = {
  [SFX.grab]: 1, // peak 0.25
  [SFX.lock]: 0.7, // 0.29, normalized to 0.92 in the file
  [SFX.throw]: 0.7, // 0.57, normalized to 0.92 in the file
  [SFX.drop]: 1, // 0.11, very quiet
  [SFX.fail]: 0.7, // 0.42
  [SFX.win]: 0.6, // 0.58
  [SFX.timeout]: 0.6, // 0.50
  [SFX.start]: 0.3, // 1.00
  [SFX.teleport]: 0.3, // 1.00
  [SFX.coin]: 0.4, // 0.86
  [SFX.rankUp]: 0.5, // 0.66
  [SFX.spell]: 1, // 0.12, quiet
  [SFX.bomb]: 0.8, // 0.40
  [SFX.breakCube]: 0.5, // 0.65
  [SFX.talk1]: 1, // 0.31
  [SFX.talk2]: 0.4 // 0.95
}
const MUSIC = S + 'BackgroundMusicWordCubes.mp3' // one loop for the lobby and the games
const SFX_REFERENCE = 6 // the sfx level at which every clip plays at its own volume below; higher is louder, lower quieter
const musicVolume = () => volumeLevel('musicVol') / VOLUME_MAX

const TICK_FROM = 10 // seconds left when the clock starts ticking

const entities = new Map<string, Entity>()
const voiceOf = new Map<string, number>()

// `voices` > 1 spreads repeats of a clip over that many entities, so a clip fired every second never has to wait for its
// own previous play to be over (used by the clock tick).
function emitter(src: string, volume: number, voice = 0): Entity {
  const key = `${src}#${voice}`
  let e = entities.get(key)
  if (!e) {
    e = engine.addEntity()
    Transform.create(e, {})
    AudioSource.create(e, { audioClipUrl: src, playing: false, global: true, volume })
    entities.set(key, e)
  }
  return e
}

export function playSfx(src: string, volume = GAIN[src] ?? 0.7, voices = 1): void {
  const level = volumeLevel('sfxVol')
  if (level <= 0) return
  volume = Math.min(1, volume * (level / SFX_REFERENCE))
  const voice = (voiceOf.get(src) ?? 0) % voices
  voiceOf.set(src, voice + 1)
  const e = emitter(src, volume, voice)
  AudioSource.getMutable(e).volume = volume
  AudioSource.playSound(e, src)
}

let talkFlip = false
/** An NPC speaks: the two voices take turns. */
export function talkSfx(): void {
  talkFlip = !talkFlip
  playSfx(talkFlip ? SFX.talk1 : SFX.talk2)
}

/** Create every clip's audio entity at start (silent) so the files are fetched before the first time they are needed. */
export function preloadSfx(): void {
  for (const src of new Set(Object.values(SFX))) {
    const e = emitter(src, 0)
    AudioSource.getMutable(e).volume = 0
  }
  AudioSource.getMutable(emitter(SFX.tick, 0, 1)).volume = 0
}

// ---- background music: one looping track, always on, switched by the "Music" setting ----
const MUSIC_WAIT = 5 // seconds to wait for your saved settings before starting anyway
let music: Entity | undefined
let musicPlaying = false
let profileSeen = false
let musicWaited = 0

/** Your saved settings arrived: the music can now respect your Music volume. */
export function onProfileLoaded(): void {
  profileSeen = true
}

function musicSystem(dt: number): void {
  if (!music) {
    music = engine.addEntity()
    Transform.create(music, {})
    AudioSource.create(music, { audioClipUrl: MUSIC, playing: false, loop: true, global: true, volume: musicVolume() })
  }
  if (!profileSeen) musicWaited += dt
  // quiet behind the loading screen and while a full-screen Explorer panel (map, backpack) covers the scene
  const hidden = EngineInfo.getOrNull(engine.RootEntity)?.sceneHidden ?? false
  const vol = musicVolume()
  if (AudioSource.get(music).volume !== vol) AudioSource.getMutable(music).volume = vol
  const want = (profileSeen || musicWaited > MUSIC_WAIT) && vol > 0 && !hidden
  if (want === musicPlaying) return
  musicPlaying = want
  if (want) AudioSource.playSound(music, MUSIC, false)
  else AudioSource.stopSound(music, false)
}

// ---- things that follow from state rather than from a single message ----
let watchedGame = -2
let lastPhase = ''
let lastRound = -1
let lastTick = -1

/** Call once a frame: round start, the clock's last seconds and running out of time. */
export function audioSystem(dt: number): void {
  musicSystem(dt)
  const g = myState()
  if (cs.game !== watchedGame || !g) {
    // joined, left or switched games: learn the state silently
    watchedGame = cs.game
    lastPhase = g ? g.phase : ''
    lastRound = g ? g.round : -1
    lastTick = -1
    return
  }
  if (g.phase !== lastPhase) {
    if (g.phase === 'playing' && g.round !== lastRound) playSfx(SFX.start)
    else if (g.phase === 'timeout') playSfx(SFX.timeout)
    lastPhase = g.phase
    lastRound = g.round
    lastTick = -1
  }
  if (g.phase === 'playing' && g.frozen === 0 && g.timeLeft > 0 && g.timeLeft <= TICK_FROM && g.timeLeft !== lastTick) {
    lastTick = g.timeLeft
    playSfx(SFX.tick, 0.9, 2)
  }
}

let lastCoins = -1
/** The server sent your coin total. The first one after joining is just the saved balance. */
export function onCoins(value: number): void {
  if (lastCoins >= 0 && value > lastCoins) playSfx(SFX.coin)
  lastCoins = value
}

/** The server sent your inventory: a smaller count than before means you just used that power-up. */
let itemsKnown = false
export function onItems(prev: Record<string, number>, next: Record<string, number>): void {
  if (!itemsKnown) {
    itemsKnown = true // the first one is your saved inventory
    return
  }
  for (const id of Object.keys(next)) {
    // a bigger count is a purchase; the bomb's blast has its own sound (fx.ts)
    if ((prev[id] ?? 0) < next[id]) playSfx(SFX.coin)
    else if (id !== 'bomb' && (prev[id] ?? 0) > next[id]) playSfx(SFX.spell)
  }
}
