// Helpers shared by the server manager and every game: who is online, profile messages and coins.
import { engine, Transform, PlayerIdentityData } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import * as C from '../config'
import { room } from '../shared/messages'
import { profileOf, touch } from './profiles'

export interface PlayerInfo {
  address: string
  pos: Vector3
  rot: Quaternion
}

export function players(): PlayerInfo[] {
  const out: PlayerInfo[] = []
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const t = Transform.getOrNull(entity)
    if (!t) continue
    out.push({ address: identity.address.toLowerCase(), pos: t.position, rot: t.rotation })
  }
  return out
}

export function playerOf(address: string): PlayerInfo | null {
  return players().find((p) => p.address === address) ?? null
}

export const coinsOf = (address: string): number => profileOf(address)?.coins ?? 0

export function sendProfile(address: string) {
  const p = profileOf(address)
  if (!p) return
  room.send('coins', { value: p.coins }, { to: [address] })
  room.send(
    'profile',
    { rating: Math.round(p.rating), wildcard: p.items.wildcard ?? 0, reroll: p.items.reroll ?? 0, freeze: p.items.freeze ?? 0, bomb: p.items.bomb ?? 0, settings: JSON.stringify(p.settings) },
    { to: [address] }
  )
}

export function giveCoins(address: string, amount: number) {
  const p = profileOf(address)
  if (!p) return
  p.coins = Math.max(0, p.coins + amount)
  touch(address)
  room.send('coins', { value: p.coins }, { to: [address] })
}

export function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

export function handPos(p: PlayerInfo): Vector3 {
  const fwd = Vector3.rotate(Vector3.Forward(), p.rot)
  const right = Vector3.rotate(Vector3.Right(), p.rot)
  return Vector3.create(
    p.pos.x + fwd.x * C.HAND_FORWARD + right.x * C.HAND_RIGHT,
    p.pos.y + C.HAND_HEIGHT,
    p.pos.z + fwd.z * C.HAND_FORWARD + right.z * C.HAND_RIGHT
  )
}
