const {test}=require('node:test')
const assert=require('node:assert/strict')
const {loadTs,loadI18n}=require('./load-ts.cjs')

test('Cubby guides, Bix sells, and the laboratory companion remains Cubby',()=>{
  const component=()=>{const data=new Map();return {data,has:e=>data.has(e),create:(e,v)=>data.set(e,v),get:e=>data.get(e),getOrNull:e=>data.get(e),getMutable:e=>data.get(e),getMutableOrNull:e=>data.get(e)}}
  const Transform=component(),AvatarShape=component(),TextShape=component(),GltfContainer=component(),Billboard=component()
  const systems=[],clicks=new Map();let next=10
  const engine={PlayerEntity:1,addEntity:()=>next++,removeEntity:e=>[Transform,AvatarShape,TextShape,GltfContainer,Billboard].forEach(c=>c.data.delete(e)),getEntityOrNullByName:name=>name==='VendorNpc'?900:name==='RankNpc'?901:null,addSystem:fn=>systems.push(fn)}
  const v=(x=0,y=0,z=0)=>({x,y,z})
  const math={Vector3:{create:v,add:(a,b)=>v(a.x+b.x,a.y+b.y,a.z+b.z),subtract:(a,b)=>v(a.x-b.x,a.y-b.y,a.z-b.z),One:()=>v(1,1,1),scale:(a,n)=>v(a.x*n,a.y*n,a.z*n)},Quaternion:{fromEulerDegrees:()=>({}),multiply:()=>({})},Color3:{create:v},Color4:{create:()=>({})}}
  Transform.create(900,{position:v(10,0,0)})
  Transform.create(901,{position:v(4,0,0)})
  const cs={tutorialActive:false,shop:false,showHowTo:false}
  const mod=loadTs('src/client/npcs.ts',{
    '@dcl/sdk/ecs':{engine,Transform,AvatarShape,TextShape,GltfContainer,Billboard,MeshCollider:{setBox(){}},ColliderLayer:{CL_POINTER:2},BillboardMode:{BM_Y:1},TextAlignMode:{TAM_MIDDLE_CENTER:1},InputAction:{IA_POINTER:0},pointerEventsSystem:{removeOnPointerDown:e=>clicks.delete(e),onPointerDown:(o,fn)=>clicks.set(o.entity,fn)}},
    '@dcl/sdk/math':math,'../config':loadTs('src/config.ts'),'../shared/env':{envOrigin:g=>v(50*g,0,50*g)},'./state':{cs},'./audio':{talkSfx(){}},'./lobby':{lobbyAnchors:()=>({origin:v(),pad:v(0,0,20)}),worldPosition:e=>Transform.get(e).position},'./ui/rank':{RANK_NAMES:[]},'./i18n':{uiLang:()=> 'en',t:(k,a)=>loadI18n().format('en',k,a)},'../shared/tutorial':loadTs('src/shared/tutorial.ts')
  })
  mod.setupNpcs();systems[0](0)
  const guide=mod.cubbyEntity(),guideShape=AvatarShape.get(guide)
  assert.equal(guideShape.name,'Cubby, Your Guide')
  const clickNpc=e=>{const hit=[...clicks.keys()].find(h=>Transform.get(h).parent===e);clicks.get(hit)()}
  clickNpc(guide)
  assert.equal(cs.showHowTo,false);assert.equal(cs.shop,false)
  assert.equal(cs.dialog.replayTutorial,true)
  assert.match(cs.dialog.pages[0],/tutorial again/)
  const bix=[...AvatarShape.data].find(([,a])=>a.name==='Bix, the Merchant')[0]
  const lexi=[...AvatarShape.data].find(([,a])=>a.name.startsWith('Lexi'))[0]
  assert.equal(Transform.get(bix).position.x,4,'Bix occupies the old RankNpc anchor')
  assert.equal(Transform.get(guide).position.x,10,'Cubby keeps his anchor')
  assert.equal(Transform.get(lexi).position.x,0,'Lexi extends the Cubby/Bix row by four metres')
  clickNpc(bix);assert.equal(cs.shop,true)
  assert.ok(AvatarShape.get(bix).wearables.some(w=>w.endsWith(':red_tshirt')))
  assert.ok(guideShape.wearables.some(w=>w.endsWith(':blue_tshirt')))
  assert.equal(GltfContainer.data.size,2,'shop signs belong to lobby and public arena Bix only')
  mod.spawnArenaVendor(7)
  const coach=mod.cubbyEntity(true)
  assert.equal(AvatarShape.get(coach).name,guideShape.name)
  assert.equal(GltfContainer.data.size,2,'the tutorial coach has no shop marker')
})
