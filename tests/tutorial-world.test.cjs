const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

function harness() {
  const config = loadTs('src/config.ts')
  const { cs } = loadTs('src/client/state.ts', { '../config': config })
  const v = (x=0,y=0,z=0) => ({x,y,z})
  const Vector3 = { create:v, Zero:v, One:()=>v(1,1,1), add:(a,b)=>v(a.x+b.x,a.y+b.y,a.z+b.z),
    subtract:(a,b)=>v(a.x-b.x,a.y-b.y,a.z-b.z), multiply:(a,b)=>v(a.x*b.x,a.y*b.y,a.z*b.z), scale:(a,n)=>v(a.x*n,a.y*n,a.z*n), rotate:a=>a }
  const component = (defaults = {}) => {
    const data = new Map()
    return { data, get:e=>data.get(e), getMutable:e=>data.get(e), getOrNull:e=>data.get(e) ?? null,
      has:e=>data.has(e), create:(e,d)=>data.set(e,{...defaults,...d}) }
  }
  const Transform=component({position:v(),scale:v(1,1,1),rotation:{}}), GltfContainer=component(), TextShape=component()
  const MeshCollider=component(), MeshRenderer=component(), PlayerIdentityData=component()
  MeshCollider.setBox = (e,mask)=>MeshCollider.create(e,{shape:'box',mask})
  MeshRenderer.setPlane = e=>MeshRenderer.create(e,{shape:'plane'})
  const Material=component()
  Material.Texture={Common:d=>d};Material.setPbrMaterial=Material.create
  const Billboard=component(), Animator=component(), AvatarModifierArea=component()
  const components=[Transform,GltfContainer,TextShape,MeshCollider,MeshRenderer,Material,Billboard,Animator,AvatarModifierArea]
  const systems=[], pointers=new Map(), teleports=[]
  const named=new Map([['Lobby',10],...config.LOBBY_PAD_NAMES.map((n,i)=>[n,20+i])])
  let next=100
  const engine={RootEntity:0,PlayerEntity:1,CameraEntity:2,addEntity:()=>next++,removeEntity:e=>components.forEach(c=>c.data.delete(e)),
    getEntityOrNullByName:n=>named.get(n)??null,getEntitiesWith:c=>c.data.entries(),addSystem:fn=>systems.push(fn)}
  const pointerEventsSystem={onPointerDown:(d,fn)=>pointers.set(d.entity,{...d.opts,fn}),removeOnPointerDown:e=>pointers.delete(e)}
  const ecs={engine,pointerEventsSystem,Transform,GltfContainer,TextShape,MeshCollider,MeshRenderer,Material,Billboard,Animator,AvatarModifierArea,PlayerIdentityData,
    ColliderLayer:{CL_PHYSICS:1,CL_POINTER:2},BillboardMode:{BM_Y:1},TextAlignMode:{TAM_MIDDLE_CENTER:1},InputAction:{IA_POINTER:1},MaterialTransparencyMode:{MTM_ALPHA_BLEND:1}}
  const math={Vector3,Quaternion:{fromEulerDegrees:()=>({}),multiply:()=>({})},Color3:{White:()=>v(1,1,1)},Color4:{create:(r,g,b,a)=>({r,g,b,a})}}
  Transform.create(1,{position:v(500,160,500)})
  Transform.create(10,{position:v(186,160,57)})
  for(let i=0;i<7;i++) Transform.create(20+i,{position:v(160+i*5,162,40),scale:v(4.4,4.4,4.4)})
  const env={envOrigin:()=>v(316,160,360),arenaAt:()=>7}
  const i18n={t:key=>key,uiLang:()=>'es'}
  const room={send:()=>{}}
  const lobby=loadTs('src/client/lobby.ts',{
    '@dcl/sdk/ecs':ecs,'@dcl/sdk/math':math,'~system/RestrictedActions':{movePlayerTo:d=>teleports.push(d)},
    '../config':config,'../shared/lang':loadTs('src/shared/lang.ts'),'./i18n':i18n,
    './ui/flags':{FLAG_ATLAS:'flags.png',planeFlagUvs:()=>[],flagAspect:()=>1},'../shared/env':env,'../shared/messages':{room},
    './practice':{startLocalPractice:()=>{cs.game=7},stopLocalPractice:()=>{}}, './state':{cs,showMessage:()=>{}},'./audio':{SFX:{},playSfx:()=>{}},'./ui/theme':{BLOCK:{green:{r:0,g:1,b:0,a:1}}},
    './gamestate':{stateOf:()=>undefined,serverNow:()=>null},'./arenas':{arenaReady:()=>true,requestArena:()=>{}},'../shared/tutorial':loadTs('src/shared/tutorial.ts')
  })
  const arena=loadTs('src/client/arena.ts',{
    '@dcl/sdk/ecs':ecs,'@dcl/sdk/math':math,'../config':config,'./i18n':i18n,'../shared/env':env,'./state':{cs},'../shared/tutorial':loadTs('src/shared/tutorial.ts')
  })
  return {config,cs,lobby,arena,ecs,systems,pointers,teleports}
}

test('pad accordion reveals rooms 1 through 7 from left to right and restores the original heights', () => {
  const h=harness(), order=[0,1,2,3,4,5,6]
  for(let i=0;i<order.length;i++) {
    h.lobby.setPadTour(1.2+i*0.45+0.2)
    for(let j=0;j<order.length;j++) assert.equal(h.lobby.padTourReveal(order[j])>0,j<=i)
  }
  h.lobby.setupLobby()
  h.lobby.setPadTour(6)
  h.systems[0](0.1)
  for(let i=0;i<7;i++) assert.equal(h.ecs.Transform.get(20+i).position.y,163.2)
  h.lobby.setPadTour(null)
  h.systems[0](0.1)
  for(let i=0;i<7;i++) assert.equal(h.ecs.Transform.get(20+i).position.y,162)
})

test('laboratory sign reuses public pad typography, white plate texture and billboard', () => {
  const h=harness()
  const sign=h.lobby.createPadSign({x:1,y:2,z:3},'Laboratorio de Cubby')
  assert.equal(h.ecs.TextShape.get(sign.entity).text,'Laboratorio de Cubby')
  assert.equal(h.ecs.TextShape.get(sign.entity).outlineWidth,0.28)
  assert.equal(h.ecs.Billboard.has(sign.entity),true)
  const plate=[...h.ecs.Transform.data].find(([,tr])=>tr.parent===sign.entity)[0]
  assert.equal(h.ecs.MeshRenderer.get(plate).shape,'plane')
  assert.equal(h.ecs.Material.get(plate).texture.src,h.config.PAD_PLATE_IMAGE)
  sign.dispose()
  assert.equal(h.ecs.Transform.has(sign.entity),false)
  assert.equal(h.ecs.Transform.has(plate),false)
})

test('every practice frame has a full pointer collider reachable from the first-letter pile', () => {
  const h=harness()
  h.cs.game=7
  let clicked=-1
  h.arena.setSlotClickHandler(i=>{clicked=i})
  h.arena.buildSlots(3)
  const hits=[...h.ecs.MeshCollider.data].filter(([,d])=>d.shape==='box')
  assert.equal(hits.length,3)
  for(const [e,d] of hits) {
    assert.equal(d.mask,h.ecs.ColliderLayer.CL_POINTER)
    assert.equal(h.pointers.get(e).maxDistance,16)
    const hit=h.ecs.Transform.get(e), frame=h.ecs.Transform.get(hit.parent)
    assert.ok(Math.abs(hit.scale.x*frame.scale.x-h.config.SLOT_HIT_WIDTH)<1e-6)
    assert.ok(Math.abs(hit.scale.y*frame.scale.y-h.config.SLOT_HIT_HEIGHT)<1e-6)
  }
  h.pointers.get(hits[0][0]).fn()
  assert.equal(clicked,0)
  h.arena.clearSlots()
  assert.equal(h.pointers.size,0,'handlers are removed with the word')
})

test('an eject response for a previous room cannot kick the player out of the private lab', () => {
  const h=harness()
  h.cs.game=7;h.cs.inGame=true
  h.lobby.onEjected(0)
  assert.equal(h.cs.game,7)
  assert.equal(h.teleports.length,0)
  h.lobby.onEjected(7)
  assert.equal(h.cs.game,7,'server cannot eject a local single-player tutorial')
  h.cs.game=0
  h.lobby.onEjected(0)
  assert.equal(h.cs.game,-1)
  assert.equal(h.teleports.length,1)
})


test('room numbers follow the existing physical pad order, keeping room one in place',()=>{
  const h=harness()
  assert.deepEqual(Array.from(h.config.LOBBY_PAD_NAMES),['StartPad.glb','StartPad.glb_5','StartPad.glb_3','StartPad.glb_6','StartPad.glb_2','StartPad.glb_7','StartPad.glb_4'])
  h.lobby.setupLobby()
  h.systems[0](0.1)
  const cubes=[...h.ecs.GltfContainer.data].filter(([,c])=>/Cube[1-7]\.glb$/.test(c.src))
  assert.equal(cubes.length,7)
  for(let game=0;game<7;game++) {
    const model=cubes.find(([,c])=>c.src===h.config.padNumberModel(game))[0]
    const root=h.ecs.Transform.get(model).parent
    const cubePosition=h.ecs.Transform.get(root).position
    const padEntity=h.ecs.engine.getEntityOrNullByName(h.config.LOBBY_PAD_NAMES[game])
    const padPosition=h.ecs.Transform.get(padEntity).position
    assert.equal(cubePosition.x,padPosition.x)
    assert.equal(cubePosition.z,padPosition.z)
  }
})
