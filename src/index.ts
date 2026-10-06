import { isServer } from '@dcl/sdk/network'
// Components and messages must be defined during module load (before the engine seals), so import them statically.
import './shared/schemas'
import './shared/messages'

export async function main() {
  if (isServer()) {
    const { initServer } = await import('./server/server')
    initServer()
    return
  }
  const { initClient } = await import('./client/setup')
  initClient()
}
