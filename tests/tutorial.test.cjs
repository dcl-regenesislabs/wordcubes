const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs, loadI18n } = require('./load-ts.cjs')

function harness(phone = false, canvas, opts = {}) {
  const config = loadTs('src/config.ts')
  const { cs } = loadTs('src/client/state.ts', { '../config': config })
  cs.myAddress = 'alice'
  let next = 100
  const component = () => {
    const data = new Map()
    return { data, has: e => data.has(e), get: e => data.get(e), getOrNull: e => data.get(e) ?? null,
      getMutable: e => data.get(e), getMutableOrNull: e => data.get(e) ?? null,
      create: (e, v) => data.set(e, v), createOrReplace: (e, v) => data.set(e, v), deleteFrom: e => data.delete(e) }
  }
  const Transform = component(), MainCamera = component(), VirtualCamera = component(), InputModifier = component(), PointerLock = component()
  InputModifier.Mode = { Standard: v => v }
  VirtualCamera.Transition = { Time: seconds => seconds }
  const GameState = component(), CubeData = component(), TextShape = component(), AvatarShape = component()
  const extra = Array.from({ length: 6 }, component)
  const all = [AvatarShape, Transform, MainCamera, VirtualCamera, InputModifier, PointerLock, GameState, CubeData, TextShape, ...extra]
  const systems = [], handlers = new Map(), sent = [], teleports = [], padTour = [], localStarts = []
  const named = new Map(config.LOBBY_PAD_NAMES.map((name, i) => [name, 20 + i]))
  const engine = { PlayerEntity: 1, CameraEntity: 2, RootEntity: 0,
    addEntity: () => next++, removeEntity: e => all.forEach(c => c.data.delete(e)),
    getEntityOrNullByName: name => named.get(name) ?? null,
    getEntitiesWith: c => c.data.entries(), addSystem: fn => systems.push(fn) }
  const vec = (x = 0, y = 0, z = 0) => ({ x, y, z })
  const Vector3 = { create: vec, Zero: vec, One: () => vec(1, 1, 1), add: (a, b) => vec(a.x+b.x, a.y+b.y, a.z+b.z),
    subtract: (a, b) => vec(a.x-b.x, a.y-b.y, a.z-b.z), scale: (a, n) => vec(a.x*n, a.y*n, a.z*n),
    lerp: (a, b, t) => vec(a.x+(b.x-a.x)*t, a.y+(b.y-a.y)*t, a.z+(b.z-a.z)*t),
    distance: (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z) }
  Transform.create(1, { position: vec(180, 1, 50) })
  Transform.create(2, { position: vec(180, 3, 45) })
  Transform.create(10, { position: vec(178, 0, 25) }) // lobby Cubby
  AvatarShape.create(10, { id: loadTs('src/shared/tutorial.ts').npcAvatarId('wc-npc-guide-lobby') })
  AvatarShape.create(12, { id: loadTs('src/shared/tutorial.ts').npcAvatarId('wc-npc-ranker') })
  for (let i = 0; i < 7; i++) Transform.create(20+i, { position: vec(170+i*4, 0, 40), scale: vec(4.4,4.4,4.4) })
  const noop = () => {}
  const quaternion = { fromLookAt: () => ({}), fromEulerDegrees: () => ({}) }
  const room = { onMessage: (name, fn) => handlers.set(name, fn), send: (name, data) => sent.push({ name, data }) }
  const tutorial = loadTs('src/shared/tutorial.ts')
  const i18n = loadI18n()
  let language = 'es'
  const overlay = {}
  const info = canvas ?? { width: phone ? 1600 : 1920, height: phone ? 720 : 1080, devicePixelRatio: 1 }
  const platform = loadTs('src/client/ui/platform.ts', {
    '@dcl/sdk/ecs': { engine, UiCanvasInformation: { getOrNull: () => info } },
    '@dcl/sdk/react-ecs': { ReactEcsRenderer: {} }, '~system/Runtime': {}
  })
  platform.forceMobile(phone)
  let stageValue = 'intro'
  let held = -1
  let ready = true
  let lobbyReturns = 0
  const mod = loadTs('src/client/tutorial.ts', {
    '@dcl/sdk/ecs': { engine, AvatarShape, Transform, MainCamera, VirtualCamera, InputModifier, PointerLock, TextShape, PointerEvents: extra[3], UiTransform: extra[4],
      ColliderLayer: { CL_PHYSICS: 1, CL_POINTER: 2 }, GltfContainer: extra[0], Billboard: extra[1], BillboardMode: { BM_Y: 1 },
      MeshRenderer: { setSphere: noop }, Material: { setPbrMaterial: noop }, AvatarModifierArea: extra[2], AvatarModifierType: { AMT_HIDE_AVATARS: 1 }, RealmInfo: { getOrNull: () => ({ isPreview: !!opts.isPreview }) } },
    '@dcl/sdk/math': { Vector3, Quaternion: quaternion, Color3: { create: vec }, Color4: { create: (r,g,b,a) => ({r,g,b,a}) } },
    '~system/RestrictedActions': { movePlayerTo: p => { teleports.push(p); return Promise.resolve() } },
    '../config': config, '../shared/tutorial': tutorial, '../shared/schemas': { GameState, CubeData }, '../shared/messages': { room },
    '../shared/env': { envOrigin: () => vec(316,160,360) }, './state': { cs },
    './connection': { serverReady: () => ready, releaseTutorialGate: () => {} }, './i18n': { uiLang: () => language, t: (k, a) => i18n.format(language, k, a, phone) },
    '../shared/lang': loadTs('src/shared/lang.ts'),
    './npcs': { cubbyEntity: practice => practice ? (Transform.has(11) ? 11 : undefined) : 10, cubbyEmote: noop },
    './practice': { localPracticeStage: () => stageValue, localPracticeAction: action => { if (action === 'begin') stageValue = 'first' }, stopLocalPractice: () => GameState.data.clear() },
    './lobby': { setPadTour: time => padTour.push(time), createPadSign: (position, text) => { const entity = engine.addEntity(); Transform.create(entity, { position }); TextShape.create(entity, { text }); return { entity, dispose: () => engine.removeEntity(entity) } }, worldPosition: e => Transform.get(e).position, lobbyAnchors: () => ({ origin: vec(186,0,57), pad: vec(167,0,38) }),
      requestPractice: lang => { localStarts.push(lang); cs.game = 7 },
      returnToLobby: () => { cs.game = -1; cs.inGame = false; lobbyReturns++ } },
    './arena': { slotPosition: i => vec(315+i,163,360), getSlotEntities: () => [40,41,42], startArrowEntity: () => null },
    './cubenet': { cubeEntity: id => id, cubeGuessPending: () => false, myHeldCubeId: () => held },
    './gamestate': { myState: () => [...GameState.data.values()].find(g => g.game === cs.game) },
    './audio': { talkSfx: noop }, './ui/platform': platform, '../ui/TutorialOverlay': { state: overlay }
  }, 'exports.testing = { setStep: v => { step = v; age = 0 }, step: () => step, padPosition: () => padPosition, cameras: () => cameras, setStage: v => { stage = v } }')
  mod.setupTutorial()
  const tick = (dt = 1) => mod.tutorialSystem(dt)
  const advance = () => { tick(['rooms', 'outro'].includes(mod.testing.step()) ? 6 : 1); mod.nextTutorial() }
  const stage = (v, masked = '___') => {
    stageValue = v
    GameState.createOrReplace(50, { game: 7, masked })
    tick()
  }
  const enter = () => {
    advance() // welcome -> rooms
    advance() // rooms -> pad
    advance() // pad -> walk
    Transform.get(1).position = { ...mod.testing.padPosition() }
    tick() // create
    advance() // countdown
    tick(3) // waiting
    cs.game = 7; cs.inGame = true
    Transform.create(11, { position: vec(312,160,356) })
    stage('intro') // arrow
  }
  return { mod, cs, Transform, InputModifier, MainCamera, VirtualCamera, PointerLock, GameState, CubeData, isolationAreas: extra[2], PointerEvents: extra[3], UiTransform: extra[4], handlers, sent, teleports,
    config, overlay, platform, tick, advance, enter, stage, localStarts, GltfContainer: extra[0], padTour, setHeld: id => { held = id }, setLanguage: lang => { language = lang },
    returns: () => lobbyReturns, setReady: v => { ready = v } }
}

test('first visit starts with Cubby; skip restores the previous camera, movement and pointer state', () => {
  const h = harness()
  h.VirtualCamera.create(90, { fov: 60 })
  h.MainCamera.create(2, { virtualCameraEntity: 90 })
  h.InputModifier.create(1, { mode: { disableJump: true } })
  h.PointerLock.create(2, { isPointerLocked: false })
  h.tick()
  assert.equal(h.mod.testing.step(), 'welcome')
  assert.equal(h.cs.tutorialCinematic, true)
  assert.equal(h.InputModifier.get(1).mode.disableAll, true)
  const firstCamera = h.MainCamera.get(2).virtualCameraEntity
  h.advance()
  assert.notEqual(h.MainCamera.get(2).virtualCameraEntity, firstCamera, 'new shots use another camera so the renderer blends')
  h.mod.stopTutorial()
  assert.equal(h.cs.tutorialActive, false)
  assert.equal(h.MainCamera.get(2).virtualCameraEntity, 90)
  assert.equal(h.InputModifier.get(1).mode.disableJump, true)
  assert.equal(h.PointerLock.get(2).isPointerLocked, false)
  assert.ok(h.mod.testing.cameras().every(e => h.VirtualCamera.has(e)), 'camera rigs survive the handback blend')
  h.tick()
  assert.equal(h.mod.testing.step(), 'off', 'does not restart after skipping')
})

test('completed tutorial suppresses automatic welcome; replay still works', () => {
  const h = harness()
  h.cs.settings.tutorialComplete = true
  h.setReady(false)
  h.tick()
  assert.equal(h.mod.testing.step(), 'off')
  h.setReady(true)
  h.tick()
  assert.equal(h.mod.testing.step(), 'off')
  h.mod.startTutorial()
  assert.equal(h.mod.testing.step(), 'welcome')
})

test('practice uses the language at creation and arrow explanation precedes every pickup', () => {
  const h = harness()
  h.tick()
  h.advance(); h.advance(); h.advance()
  assert.equal(h.mod.testing.step(), 'walk')
  assert.equal(h.cs.tutorialCinematic, false)
  h.Transform.get(1).position = { ...h.mod.testing.padPosition() }
  h.tick()
  h.setLanguage('pt')
  h.advance()
  assert.equal(h.mod.testing.step(),'countdown')
  assert.equal(h.localStarts.length,0)
  h.tick(2.9)
  assert.equal(h.localStarts.length,0)
  h.tick(0.1)
  assert.equal(h.localStarts.at(-1), 'pt')
  h.cs.game = 7; h.cs.inGame = true
  h.Transform.create(11, { position: { x:312,y:160,z:356 } })
  h.stage('intro')
  assert.equal(h.mod.testing.step(), 'arrow')
  assert.equal(h.cs.practiceLetter, '', 'no pickup until the arrow and clue have been explained')
  assert.match(h.overlay.text, /PRIMEIRA LETRA/)
  h.advance()
  assert.equal(h.mod.testing.step(), 'clue')
  h.advance()
  assert.equal(h.mod.testing.step(), 'grab')
  assert.equal(h.cs.practiceLetter, 'S')
  assert.equal(h.cs.tutorialCinematic, false)
})

for (const [phone, offline] of [[false,false],[true,false],[true,true]]) test(`coached actions trigger cinematics, collapse, rebuild and return to the lobby (${phone ? 'mobile' : 'desktop'}, ${offline ? 'offline' : 'online'})`, () => {
  const h = harness(phone)
  h.tick(2) // the initial server profile must be checked before any tutorial
  if (offline) h.setReady(false)
  h.enter()
  h.advance(); h.advance() // arrow -> clue -> grab
  h.CubeData.create(70, { game: 7, letter: 'S', mode: 'held', holder: 'alice' })
  h.setHeld(70); h.tick()
  assert.equal(h.mod.testing.step(), 'throw')
  assert.equal(h.cs.tutorialCinematic, true)
  h.advance()
  assert.equal(h.cs.practiceSlot, 0)
  h.setHeld(-1); h.stage('assist', 'S__')
  assert.equal(h.mod.testing.step(), 'team')
  h.advance()
  assert.equal(h.mod.testing.step(), 'helping')
  assert.equal(h.cs.tutorialCinematic,true)
  h.stage('last', 'SO_')
  assert.equal(h.mod.testing.step(), 'lastGrab')
  h.CubeData.create(71, { game: 7, letter: 'L', mode: 'held', holder: 'alice' })
  h.setHeld(71); h.tick(); h.advance()
  assert.equal(h.mod.testing.step(), 'lastPlace')
  h.setHeld(-1); h.stage('won', 'SOL')
  assert.equal(h.mod.testing.step(), 'win')
  h.advance(); h.advance() // win -> warning -> mistake
  h.stage('collapsed'); h.tick(20)
  assert.equal(h.mod.testing.step(), 'mistake','the X explanation waits until the player has read it')
  assert.equal(h.overlay.primaryDisplay,'flex')
  h.advance()
  assert.equal(h.mod.testing.step(), 'collapse')
  h.advance(); h.stage('retry', 'SO_')
  assert.equal(h.mod.testing.step(), 'retryGrab')
  h.setHeld(71); h.tick(); h.advance(); h.tick(0.01)
  assert.equal(h.overlay.framesDisplay,'flex','UI placement is taught only after collapse')
  h.setHeld(-1); h.stage('complete', 'SOL')
  assert.equal(h.mod.testing.step(), 'complete')
  h.advance()
  assert.equal(h.mod.testing.step(), 'outro')
  assert.equal(h.returns(), 1)
  h.advance()
  assert.equal(h.cs.tutorialActive, false)
  assert.equal(h.MainCamera.get(2).virtualCameraEntity, undefined)
  assert.equal(h.InputModifier.has(1), false)
})

test('skip during entry cancels it; late private states cannot resurrect the tour', () => {
  const h = harness()
  h.tick(); h.advance(); h.advance(); h.advance()
  h.Transform.get(1).position = { ...h.mod.testing.padPosition() }
  h.tick(); h.advance()
  assert.equal(h.mod.testing.step(), 'countdown')
  h.mod.stopTutorial()
  assert.equal(h.returns(), 1)
  assert.equal(h.handlers.has('practiceState'), false, 'no network practice subscription')
  assert.equal(h.GameState.data.size, 0)
  assert.equal(h.cs.tutorialActive, false)
})

for (const [name, canvas] of [['small phone', undefined], ['high density phone', { width:2400,height:1080,devicePixelRatio:3 }]]) test(`tutorial caption stays in bounds on ${name}`, () => {
  const h = harness(true, canvas)
  h.tick()
  const { w, h: height } = h.platform.view()
  const o = h.overlay
  assert.ok(o.left >= 0 && o.left + o.width <= w)
  assert.ok(o.bottom >= 0 && o.bottom + o.height <= height)
  assert.ok(o.buttonWidth <= o.width - 2 * (o.padding + o.border))
  assert.ok(o.font >= 18)
})

test('being ejected during a practice cinematic restores control and removes the private state', () => {
  const h = harness()
  h.tick(); h.enter()
  assert.equal(h.cs.tutorialCinematic, true)
  h.cs.game = -1; h.cs.inGame = false
  h.tick()
  assert.equal(h.cs.tutorialActive, false)
  assert.equal(h.cs.tutorialCinematic, false)
  assert.equal(h.InputModifier.has(1), false)
  assert.equal(h.MainCamera.get(2).virtualCameraEntity, undefined)
  assert.equal(h.GameState.data.size, 0)
})

test('laboratory pad enables its existing 3D collider and skipping resets the public pad animation', () => {
  const h = harness()
  h.tick(); h.advance(); h.advance() // pad reveal
  const pad = [...h.GltfContainer.data.values()].find(d => d.src.endsWith('/StartPad.glb'))
  assert.equal(pad.invisibleMeshesCollisionMask, 3)
  h.mod.stopTutorial()
  assert.equal(h.padTour.at(-1), null)
})

const renderOverlay=(state,props={})=>{
  const react={default:{createElement:(type,props,...children)=>({type,props:props??{},children:children.flat()})},Label:'Label',UiEntity:'UiEntity'}
  const ui=loadTs('src/ui/TutorialOverlay.tsx',{'@dcl/sdk/react-ecs':react,'../client/arena':{clickSlot:props.clickSlot??(()=>{})},'../client/ui/theme':{Frame:'Frame',PillButton:'PillButton',LetterTile:'LetterTile',OutlineLabel:'OutlineLabel',PAL:{}}})
  Object.assign(ui.state,state)
  const nodes=[]
  const visit=n=>{if(n&&typeof n==='object'){if(typeof n.type==='function'){visit(n.type(n.props));return}nodes.push(n);for(const c of n.children??[])visit(c)}}
  visit(ui.TutorialOverlay({onNext:props.onNext??(()=>{}),onGrab:props.onGrab??(()=>{})}))
  return nodes
}
const ART={'assets/images/ui-kit/hand.png':184/216}
const assertNativeAspect=nodes=>{for(const n of nodes){const src=n.props.uiBackground?.texture?.src;if(!src||n.props.uiTransform?.display==='none')continue;const {width,height}=n.props.uiTransform;assert.ok(ART[src],`unexpected image ${src}`);assert.ok(Math.abs(width/height-ART[src])<0.01*ART[src],`${src} drawn at ${width}x${height} keeps its aspect`)}}

for (const phone of [false,true]) test(`only the hand animates: the strip and button hold still (${phone?'mobile':'desktop'})`, () => {
  const h = harness(phone)
  const o = h.overlay, seen = new Set(), hands = new Set()
  h.tick()
  for (let i = 0; i < 12; i++) { h.tick(0.07); seen.add([o.stripLeft,o.stripBottom,o.stripW,o.actionLeft,o.actionBottom,o.tabBottom,o.dotsBottom].join()); hands.add(o.handBottom) }
  assert.equal(seen.size, 1, 'the dialogue does not move frame to frame')
  assert.ok(hands.size > 1, 'the hand taps')
  if (phone) assert.ok(o.stripW <= h.platform.view().w * 0.5 + 1, 'the phone strip takes about half the screen')
})

test('desktop tutorial uses the kit card, candy button and hand, right of the chat column', () => {
  const h = harness()
  h.tick()
  const o = h.overlay, {w,h:height} = h.platform.view()
  assert.equal(o.mode,'talk')
  assert.ok(o.stripLeft>=0&&o.actionLeft+o.actionW<=w&&o.stripBottom>=0&&o.stripBottom+o.stripH<height*0.5,'Cubby talks from the bottom of the screen')
  let nexts=0
  const nodes = renderOverlay(o,{onNext:()=>nexts++})
  assertNativeAspect(nodes)
  const images=[...new Set(nodes.map(n=>n.props.uiBackground?.texture?.src).filter(Boolean))].sort()
  assert.deepEqual(images,['assets/images/ui-kit/hand.png'],'cards and buttons come from the kit pieces; the hand is the only image here')
  const crisp=nodes.find(n=>n.props.key==='crisp-strip')
  assert.equal(crisp.props.uiTransform.width,o.stripW)
  assert.equal(crisp.props.uiTransform.height,o.stripH)
  assert.ok(o.handLeft>o.actionLeft+o.actionW*0.7,'the hand points at the corner, not the label')
  assert.ok(o.stripLeft>=h.platform.LEFT_RESERVE(),'the dialogue starts right of the desktop chat column')
  assert.ok(o.stripH<=height*0.13,'a compact strip on desktop')
  assert.ok(o.handBottom>=0&&o.handLeft+o.handW<=w&&o.actionLeft+o.actionW<=w,'button and hand are fully on screen')
  nodes.find(n=>n.type==='PillButton'&&n.props.id==='tutorial-action').props.onClick()
  assert.equal(nexts,1)
  h.advance(); h.advance(); h.advance(); h.tick()
  assert.equal(h.mod.testing.step(),'walk')
  assert.equal(o.mode,'action')
  assert.ok(o.stripBottom+o.stripH<height*0.5,'the mission stays in the bottom strip')
  assert.ok(o.actionDisplay==='none'||o.actionLeft>=o.stripLeft+o.stripW,'the desktop action sits beside the strip')
})

test('the local preview does not force the tutorial; deployed worlds do', () => {
  for (const isPreview of [true, false]) {
    const h = harness(false, undefined, { isPreview })
    h.tick()
    assert.equal(h.cs.tutorialActive, !isPreview)
  }
})

test('previously skipped or interrupted players must finish the tutorial on their next entry', () => {
  const h = harness()
  h.cs.settings.tutorialSeen = true
  h.tick()
  assert.equal(h.mod.testing.step(), 'welcome')
  h.mod.stopTutorial()
  assert.equal(h.cs.settings.tutorialComplete, undefined)
  assert.ok(!h.sent.some(m => m.data.action === 'seen'), 'cleanup does not record completion or skipping')
})

test('walking to the pad keeps it visible and the tutorial has no Skip button', () => {
  const h = harness()
  h.tick(); h.advance(); h.advance(); h.advance()
  assert.equal(h.mod.testing.step(), 'walk')
  h.tick(1)
  assert.equal(h.cs.tutorialActive, true)
  assert.ok([...h.GltfContainer.data.values()].some(d => d.src.endsWith('/StartPad.glb')))
  const keys = renderOverlay(h.overlay).map(n => n.props.key ?? n.props.id).filter(Boolean)
  assert.ok(keys.includes('mobile-tutorial-strip'))
  assert.ok(!keys.includes('tutorial-skip'))
})

for (const canvas of [
  { width:1600,height:720,devicePixelRatio:1 },
  { width:2400,height:1080,devicePixelRatio:3,screenInsetArea:{left:80,right:40,top:15,bottom:25} },
  { width:720,height:1600,devicePixelRatio:1,screenInsetArea:{left:10,right:10,top:35,bottom:25} }
]) test(`mobile strip, button and hand stay on screen on ${canvas.width}x${canvas.height}`, () => {
  const h = harness(true, canvas)
  const {w,h:height} = h.platform.view(), o=h.overlay
  const inside = (l,b,wd,ht) => l >= 0 && l + wd <= w && b >= 0 && b + ht <= height
  h.tick()
  assert.equal(o.mode,'talk','Cubby talks while the camera is cinematic')
  assert.ok(inside(o.stripLeft,o.stripBottom,o.stripW,o.stripH))
  assert.ok(inside(o.actionLeft,o.actionBottom,o.actionW,o.actionH),'the Next button is on screen')
  assert.ok(inside(o.handLeft,o.handBottom,o.handW,o.handH),'the tapping hand is not cut by the screen edge')
  assert.ok(o.stripBottom + o.stripH < height * 0.5, 'Cubby talks from the bottom, leaving the scene visible')
  assertNativeAspect(renderOverlay(o))
  assert.equal(o.barHeight, 0, 'no cinematic bars on mobile')
  h.enter(); h.advance(); h.advance(); h.tick() // grab prompt
  assert.equal(h.mod.testing.step(),'grab')
  assert.equal(o.mode,'action')
  assert.ok(inside(o.stripLeft,o.stripBottom,o.stripW,o.stripH))
  assert.ok(o.stripBottom + o.stripH < height * 0.5, 'Cubby keeps talking from the bottom while you play')
  assert.ok(o.stripLeft + o.stripW < o.actionLeft || o.actionBottom > o.stripBottom + o.stripH, 'the strip never sits under the action button')
  assert.equal(o.goalDisplay,'flex')
  assert.equal(o.goalLetter,'S')
  assert.equal(o.actionDisplay,'flex')
  assert.ok(inside(o.actionLeft,o.actionBottom,o.actionW,o.actionH))
  assert.ok(o.actionBottom >= height * 0.3, 'the action button sits above the native jump and E buttons')
  assert.ok(o.actionH >= Math.min(w,height) * 0.1, 'a deliberate touch target')
  assert.equal(o.handDisplay,'flex')
  assert.ok(o.handBottom < o.actionBottom, 'the hand taps the button from below')
  assert.ok(inside(o.handLeft,o.handBottom,o.handW,o.handH),'the tapping hand is not cut by the screen edge')
  assertNativeAspect(renderOverlay(o))
  h.CubeData.create(70,{game:7,letter:'S',mode:'held',holder:'alice'})
  h.setHeld(70);h.tick();h.advance();h.tick()
  assert.equal(o.mode,'action')
  assert.equal(o.actionDisplay,'none','placing happens on the world frame')
  assert.equal(o.handDisplay,'none')
  assert.equal(o.framesDisplay,'none')
  assert.match(o.text,/tocá/i)
  assert.ok(!/clic|click|Press|presion/i.test(o.text))
})

test('tutorial places letters only through world frames, without dialogue tiles', () => {
  const h=harness(true)
  h.tick(); h.advance(); h.advance(); h.advance(); h.tick()
  assert.equal(h.overlay.framesDisplay,'none')
  assert.ok(!renderOverlay(h.overlay).some(n=>n.type==='LetterTile'&&n.props.onClick),'no clickable dialogue frame')
})

test('mobile native controls hide for cinematics, return for actions, and reset on exit', () => {
  const ts=require('typescript'),fs=require('node:fs')
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/client/setup.ts'),'utf8')
  const mocks=Object.fromEntries(ts.preProcessFile(source).importedFiles.map(i=>[i.fileName,{}]))
  const config=loadTs('src/config.ts'),state=loadTs('src/client/state.ts',{'../config':config})
  const InputAction=Object.fromEntries(['IA_PRIMARY','IA_SECONDARY','IA_ACTION_3','IA_ACTION_4','IA_ACTION_5','IA_ACTION_6','IA_POINTER','IA_JUMP'].map(k=>[k,k]))
  const writes=[]
  Object.assign(mocks,{'@dcl/sdk/ecs':{engine:{RootEntity:0},InputAction,TouchScreenControls:{createOrReplace:(_,v)=>writes.push(v)}},'./state':state,'../config':config,'./ui/platform':{mobile:()=>true}})
  const mod=loadTs('src/client/setup.ts',mocks,'exports.touch = syncTouchButtons')
  state.cs.tutorialActive=true;state.cs.tutorialCinematic=true
  mod.touch(false,false,false)
  assert.ok(writes.at(-1).touchInputs.every(i=>i.hide))
  assert.equal(writes.at(-1).hideJoystick,true)
  state.cs.tutorialCinematic=false
  mod.touch(true,true,false)
  const inputs=new Map(writes.at(-1).touchInputs.map(i=>[i.inputAction,i.hide]))
  assert.equal(inputs.get('IA_JUMP'),false)
  assert.equal(inputs.get('IA_POINTER'),false)
  assert.equal(inputs.get('IA_PRIMARY'),true,'unneeded break action stays hidden during coaching')
  assert.equal(writes.at(-1).hideJoystick,false)
  state.cs.tutorialActive=false
  mod.touch(true,true,false)
  assert.equal(writes.at(-1).touchInputs.find(i=>i.inputAction==='IA_PRIMARY').hide,false)
})

test('mobile talk uses the kit card, the candy button and the tapping hand, and both advance', () => {
  const h=harness(true)
  h.tick()
  const o=h.overlay
  assert.equal(o.mobile,true)
  assert.equal(o.mode,'talk')
  assert.equal(o.tabName,'Cubby')
  assert.equal(o.actionDisplay,'flex')
  assert.equal(o.handDisplay,'flex')
  assert.ok(o.stripFont>=h.platform.view().h/36, 'readable copy on landscape mobile')
  let nexts=0
  const nodes=renderOverlay(o,{onNext:()=>nexts++})
  nodes.find(n=>n.props.key==='mobile-tutorial-strip').props.onMouseDown()
  nodes.find(n=>n.type==='PillButton'&&n.props.id==='tutorial-action').props.onClick()
  assert.equal(nexts,2)
  const images=[...new Set(nodes.map(n=>n.props.uiBackground?.texture?.src).filter(Boolean))].sort()
  assert.deepEqual(images,['assets/images/ui-kit/hand.png'],'cards and buttons come from the kit pieces; the hand is the only image here')
  assert.ok(nodes.some(n=>n.props.key==='crisp-strip'))
  assert.equal(nodes.filter(n=>String(n.props.key).startsWith('dot-')).length,o.chapters)
  h.advance();h.advance();h.advance();h.tick()
  assert.equal(h.mod.testing.step(),'walk')
  assert.equal(o.mode,'action','walking shows the mission in the same bottom strip')
  assert.ok(o.stripBottom + o.stripH < h.platform.view().h * 0.5)
  assert.equal(o.actionDisplay,'none')
  assert.equal(o.goalDisplay,'none','no letter cube before there is a letter to fetch')
})

test('mobile hold cinematic freezes movement without disabling the carry emote', () => {
  const h=harness(true)
  h.tick();h.enter();h.advance();h.advance()
  h.CubeData.create(70,{game:7,letter:'S',mode:'held',holder:'alice'})
  h.setHeld(70);h.tick()
  assert.equal(h.mod.testing.step(),'throw')
  const mode=h.InputModifier.get(1).mode
  assert.equal(mode.disableWalk,true)
  assert.equal(mode.disableJog,true)
  assert.equal(mode.disableJump,true)
  assert.notEqual(mode.disableAll,true)
  assert.notEqual(mode.disableEmote,true)
  assert.equal(h.CubeData.get(70).mode,'held')
})

test('tutorial cannot draw cinematic bars even if the device is misclassified as desktop', () => {
  const react={default:{createElement:(type,props,...children)=>({type,props:props??{},children:children.flat()})},Label:'Label',UiEntity:'UiEntity'}
  const ui=loadTs('src/ui/TutorialOverlay.tsx',{'@dcl/sdk/react-ecs':react,'../client/arena':{clickSlot(){}},'../client/ui/theme':{Frame:'Frame',PillButton:'PillButton',LetterTile:'LetterTile',OutlineLabel:'OutlineLabel',PAL:{}}})
  for(const phone of [false,true]) {
    Object.assign(ui.state,{mobile:phone,display:'flex',barHeight:100})
    const nodes=[]
    const visit=n=>{if(n&&typeof n==='object'){if(typeof n.type==='function'){visit(n.type(n.props));return}nodes.push(n);for(const c of n.children??[])visit(c)}}
    visit(ui.TutorialOverlay({onNext(){}}))
    assert.ok(!nodes.some(n=>n.props.uiTransform?.height===100),'no letterbox entities exist in either renderer')
  }
})

test('mobile offers Agarrar S only after Cubby is ready and targets the nearest highlighted S', () => {
  const h=harness(true)
  h.tick();h.enter();h.advance();h.advance();h.tick()
  assert.equal(h.mod.testing.step(),'grab')
  assert.equal(h.overlay.grabDisplay,'flex','the local grab step is ready immediately')
  h.Transform.get(1).position={x:310,y:160,z:350}
  h.Transform.create(70,{position:{x:310,y:160.4,z:351}})
  h.CubeData.create(70,{id:70,game:7,letter:'S',mode:'free'})
  h.Transform.create(71,{position:{x:316,y:160.4,z:350}})
  h.CubeData.create(71,{id:71,game:7,letter:'S',mode:'free'})
  h.stage('first')
  assert.equal(h.overlay.grabDisplay,'flex')
  assert.equal(h.overlay.grabLabel,'Agarrar S')
  assert.equal(h.cs.practiceCubeId,70)
  assert.equal(h.overlay.actionLabel,'Agarrar S')
  const requests=[]
  const nodes=renderOverlay(h.overlay,{onGrab(){requests.push(h.cs.practiceCubeId)},onNext(){requests.push('next')}})
  nodes.find(n=>n.type==='PillButton'&&n.props.id==='tutorial-action').props.onClick()
  assert.deepEqual(requests,[70])
})

test('tutorial hides other players in both lobby and lab, while keeping its local NPCs visible', () => {
  const h=harness()
  h.tick()
  const areas=[...h.isolationAreas.data.values()]
  assert.equal(areas.length,1)
  assert.ok(areas[0].area.x>=1000&&areas[0].area.z>=1000)
  assert.ok(areas[0].excludeIds.includes('alice'))
  assert.ok(areas[0].excludeIds.includes(loadTs('src/shared/tutorial.ts').npcAvatarId('wc-npc-guide-lobby')))
  assert.ok(areas[0].excludeIds.includes(loadTs('src/shared/tutorial.ts').npcAvatarId('wc-npc-ranker')))
  assert.ok(areas[0].excludeIds.includes(loadTs('src/shared/tutorial.ts').npcAvatarId('cubby-coach')))
  assert.ok(!areas[0].excludeIds.includes('bob'))
  h.mod.stopTutorial()
  assert.equal(h.isolationAreas.data.size,0)
})

for(const completed of [false,true]) test(`tutorial waits for the server profile before deciding whether to start (completed=${completed})`,()=>{
  const h=harness(true)
  h.setReady(false)
  for(let i=0;i<5;i++) h.tick(60)
  assert.equal(h.mod.testing.step(),'off')
  assert.equal(h.cs.tutorialActive,false)
  assert.equal(h.teleports.length,0)
  h.mod.startTutorial()
  assert.equal(h.cs.tutorialActive,false,'manual replay cannot bypass the initial server gate')
  h.cs.settings.tutorialComplete=completed
  h.setReady(true)
  h.tick()
  assert.equal(h.cs.tutorialActive,!completed)
  assert.equal(h.mod.testing.step(),completed?'off':'welcome')
})

test('NPC identities survive the mobile address filter and remain distinct across arenas', () => {
  const {npcAvatarId}=loadTs('src/shared/tutorial.ts')
  const keys=['wc-npc-ranker','wc-npc-guide-lobby','wc-npc-vendor-lobby','cubby-coach',...Array.from({length:8},(_,i)=>`wc-npc-vendor-arena-${i}`)]
  const ids=keys.map(npcAvatarId)
  assert.equal(new Set(ids).size,keys.length)
  for(const id of ids) assert.match(id,/^0x[0-9a-f]{40}$/)
})


test('cinematics suppress world feedback and range without unregistering clicks, then restore manual play', () => {
  const h=harness(true)
  const events={pointerEvents:[{eventType:0,eventInfo:{hoverText:'Talk to Cubby',maxDistance:6}}]}
  h.PointerEvents.create(10,events)
  const nextEvents={pointerEvents:[{eventType:0,eventInfo:{button:0}}]}
  h.UiTransform.create(200,{})
  h.PointerEvents.create(200,nextEvents)
  // A UI entity must stay clickable even if another helper adds a Transform.
  h.Transform.create(200,{position:{x:0,y:0,z:0}})
  h.tick()
  assert.equal(h.PointerEvents.get(200),nextEvents,'Next keeps its pointer handlers during the welcome')
  h.tick()
  assert.equal(h.PointerEvents.get(200),nextEvents,'subsequent cinematic ticks preserve UI input')
  assert.equal(h.PointerEvents.get(10).pointerEvents.length,1)
  assert.equal(h.PointerEvents.get(10).pointerEvents[0].eventInfo.showFeedback,false)
  assert.equal(h.PointerEvents.get(10).pointerEvents[0].eventInfo.maxDistance,0)
  assert.equal(h.teleports.length,1)
  const npc=h.Transform.get(10).position,spawn=h.teleports[0].newRelativePosition
  assert.ok(Math.hypot(spawn.x-npc.x,spawn.z-npc.z)<=3.01)
  h.advance();h.advance();h.advance()
  assert.equal(JSON.stringify(h.PointerEvents.get(10)),JSON.stringify(events))
  const pad=h.mod.testing.padPosition()
  assert.ok(Math.hypot(spawn.x-pad.x,spawn.z-pad.z)>h.config.PAD_RADIUS+2,'welcome is outside the visible pad with walking space')
})

test('post-collapse UI frame throws into the last slot on desktop and mobile', () => {
  for (const mobile of [false,true]) {
    const clicks=[]
    const react={default:{createElement:(type,props,...children)=>({type,props:props??{},children:children.flat()})},Label:'Label',UiEntity:'UiEntity'}
    const ui=loadTs('src/ui/TutorialOverlay.tsx',{'@dcl/sdk/react-ecs':react,'../client/arena':{clickSlot:i=>clicks.push(i)},'../client/ui/theme':{Frame:'Frame',PillButton:'PillButton',LetterTile:'LetterTile',OutlineLabel:'OutlineLabel',PAL:{}}})
    Object.assign(ui.state,{mobile,mode:'action',framesDisplay:'flex',tileSize:60,primaryDisplay:'none',grabDisplay:'none'})
    const nodes=[]
    const visit=n=>{if(n&&typeof n==='object'){if(typeof n.type==='function'){visit(n.type(n.props));return}nodes.push(n);for(const c of n.children??[])visit(c)}}
    visit(ui.TutorialOverlay({onNext(){}}))
    const tiles=nodes.filter(n=>n.type==='LetterTile'&&n.props.onClick)
    assert.equal(tiles.length,1)
    tiles[0].props.onClick()
    assert.deepEqual(clicks,[2])
  }
})


test('after the pad shot, the player and camera turn toward the pad, without moving', () => {
  const h=harness(true)
  h.tick()
  h.advance();h.advance()
  const before=h.teleports.length, me={...h.Transform.get(1).position}
  h.advance()
  assert.equal(h.mod.testing.step(),'walk')
  assert.equal(h.teleports.length,before+1)
  const turn=h.teleports.at(-1), pad=h.mod.testing.padPosition()
  assert.deepEqual(turn.newRelativePosition,me,'the player stays where they are')
  assert.equal(turn.cameraTarget.x,pad.x); assert.equal(turn.cameraTarget.z,pad.z)
  assert.equal(turn.avatarTarget.x,pad.x); assert.equal(turn.avatarTarget.z,pad.z)
  // stepping on and off the pad does not turn the camera again
  h.Transform.get(1).position={...pad}; h.tick()
  assert.equal(h.mod.testing.step(),'create')
  h.Transform.get(1).position={x:pad.x+10,y:pad.y,z:pad.z}; h.tick()
  assert.equal(h.mod.testing.step(),'walk')
  assert.equal(h.teleports.length,before+1)
})

test('arriving beside Cubby never skips walking onto the laboratory pad',()=>{
  const h=harness()
  h.tick()
  h.Transform.get(1).position={...h.teleports[0].newRelativePosition}
  h.advance();h.advance();h.advance()
  assert.equal(h.mod.testing.step(),'walk')
  for(let i=0;i<5;i++) h.tick()
  assert.equal(h.mod.testing.step(),'walk','standing at the welcome position does not enable creation')
  assert.equal(h.localStarts.length,0)
  h.Transform.get(1).position={...h.mod.testing.padPosition()}
  h.tick()
  assert.equal(h.mod.testing.step(),'create')
})

for(const canvas of [{width:1600,height:720,devicePixelRatio:1},{width:2400,height:1080,devicePixelRatio:3},{width:720,height:1600,devicePixelRatio:1}]) test(`mobile word party is a kit card with the answer on ${canvas.width}x${canvas.height}`,()=>{
  const h=harness(true,canvas)
  const o=h.overlay, {w,h:height}=h.platform.view()
  h.tick()
  h.cs.game=7; h.cs.inGame=true; h.mod.testing.setStep('win'); h.tick(0.3)
  assert.equal(o.mode,'party')
  assert.equal(o.partyTitle,'¡Palabra completa!')
  assert.equal(o.word0+o.word1+o.word2,'SOL','the practice answer in the lab language')
  assert.ok(o.panelLeft>=0&&o.panelLeft+o.panelW<=w&&o.panelTop>=0&&o.panelTop+o.panelH<=height)
  assert.equal(o.actionDisplay,'flex')
  assert.ok(o.actionBottom+o.actionH<=height-o.panelTop-o.panelH-8,'the button sits apart, below the card')
  assert.ok(o.handBottom>=0,'the hand under it stays on screen')
  let nexts=0
  const nodes=renderOverlay(o,{onNext:()=>nexts++})
  assertNativeAspect(nodes)
  assert.deepEqual(nodes.filter(n=>n.type==='LetterTile').map(n=>n.props.letter),[o.word0,o.word1,o.word2])
  nodes.find(n=>n.type==='PillButton'&&n.props.id==='tutorial-action').props.onClick()
  assert.equal(nexts,1)
  const dim=nodes.find(n=>n.props.key==='party-dim')
  assert.ok(dim.props.uiTransform.position.left<0&&dim.props.uiTransform.width>w,'the dim reaches past the safe area to the real screen edges')
})
