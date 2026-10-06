import ReactEcs, { ReactEcsRenderer, UiEntity, Label, Button } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { GameState } from '../shared/schemas'
import { cs } from './state'
import { heldLetter } from './cubes'
import { room } from '../shared/messages'

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
}

function game() {
  for (const [, g] of engine.getEntitiesWith(GameState)) return g
  return null
}

const spaced = (s: string) => s.split('').join(' ')

// Coded (not UI-Designer-editable) HUD: everything comes from the server's synced state each frame.
export const uiMenu = () => {
  const g = game()
  const held = heldLetter()
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 30, left: 560 },
          width: 800,
          height: 200,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
      >
        <Label value={g ? g.question : 'Connecting...'} fontSize={30} color={Color4.White()} uiTransform={{ width: '100%', height: 50 }} />
        <Label value={g ? spaced(g.masked) : ''} fontSize={64} color={Color4.create(1, 0.85, 0.3, 1)} uiTransform={{ width: '100%', height: 90 }} />
        <Label value={g && g.hint ? `Hint: ${spaced(g.hint)}` : ''} fontSize={26} color={Color4.create(0.6, 0.9, 1, 1)} uiTransform={{ width: '100%', height: 30 }} />
      </UiEntity>

      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 30, right: 30 }, width: 260, height: 110, flexDirection: 'column' }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
      >
        <Label value={`Coins: ${cs.coins}`} fontSize={28} color={Color4.White()} uiTransform={{ width: '100%', height: 36 }} />
        <Label value={g ? `Round ${g.round}  Done ${g.completed}` : ''} fontSize={22} color={Color4.White()} uiTransform={{ width: '100%', height: 30 }} />
        <Label value={held ? `Holding ${held}` : 'Hands empty'} fontSize={22} color={Color4.White()} uiTransform={{ width: '100%', height: 30 }} />
      </UiEntity>

      <Button
        value="Hint (1)"
        variant="primary"
        fontSize={30}
        uiTransform={{ positionType: 'absolute', position: { top: 160, right: 30 }, width: 260, height: 70 }}
        onMouseDown={() => room.send('hint', { n: 0 })}
      />

      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { bottom: 40, left: 460 }, width: 1000, height: 120, flexDirection: 'column', alignItems: 'center' }}
      >
        <Label value={cs.message} fontSize={36} color={Color4.White()} uiTransform={{ width: '100%', height: 60 }} />
        <Label
          value="Click cube: grab   Click frame: throw it there   E: break for coins   F: throw away   1: hint"
          fontSize={22}
          color={Color4.create(1, 1, 1, 0.8)}
          uiTransform={{ width: '100%', height: 40 }}
        />
      </UiEntity>
    </UiEntity>
  )
}
