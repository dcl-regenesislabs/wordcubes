import { engine, InputAction, TouchScreenControls } from '@dcl/sdk/ecs'

// Use the mobile client's existing action cluster, rather than duplicating it in the HUD.
// Five visible actions fit without the native '+' overflow menu. Desktop is unaffected.
export function setupTouchControls() {
  TouchScreenControls.createOrReplace(engine.RootEntity, {
    hideJoystick: false,
    hideCrosshair: false,
    mainAction: InputAction.IA_JUMP,
    touchInputs: [
      { inputAction: InputAction.IA_POINTER, hide: false },
      { inputAction: InputAction.IA_JUMP, hide: false },
      {
        inputAction: InputAction.IA_PRIMARY, hide: false,
        icon: { tex: { $case: 'texture', texture: { src: 'assets/images/ui/cartoon-break.png' } } }
      },
      {
        inputAction: InputAction.IA_SECONDARY, hide: false,
        icon: { tex: { $case: 'texture', texture: { src: 'assets/images/ui/cartoon-toss.png' } } }
      },
      {
        inputAction: InputAction.IA_ACTION_3, hide: false,
        icon: { tex: { $case: 'texture', texture: { src: 'assets/images/ui/cartoon-hint.png' } } }
      },
      { inputAction: InputAction.IA_ACTION_4, hide: true },
      { inputAction: InputAction.IA_ACTION_5, hide: true },
      { inputAction: InputAction.IA_ACTION_6, hide: true }
    ]
  })
}
