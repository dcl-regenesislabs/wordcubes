const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')

function harness() {
  const config=loadTs('src/config.ts'), shared=loadTs('src/shared/tutorial.ts')
  const component=()=>{const data=new Map();return {data,has:e=>data.has(e),create:(e,d)=>data.set(e,d),get:e=>data.get(e),getMutable:e=>data.get(e),getOrNull:e=>data.get(e)??null}}
  const Transform=component(),CubeData=component(),GameState=component()
  let next=500
  const engine={addEntity:()=>next++,removeEntity:e=>[Transform,CubeData,GameState].forEach(c=>c.data.delete(e))}
  const v=(x=0,y=0,z=0)=>({x,y,z})
  const Vector3={create:v,One:()=>v(1,1,1),scale:(a,n)=>v(a.x*n,a.y*n,a.z*n)}
  const math={Vector3,Quaternion:{fromEulerDegrees:()=>({})}}
  const cs={game:-1,inGame:false,myAddress:'alice',coins:50,rating:100,settings:{},tutorialSavePending:false}
  const network=[], handlers=new Map()
  const room={send:(...m)=>network.push(m),onMessage:(n,fn)=>handlers.set(n,fn)}
  const net=loadTs('src/client/cubenet.ts',{
    '@dcl/sdk/ecs':{engine,Transform},'@dcl/sdk/math':math,'../config':config,'../shared/messages':{room},
    '../shared/schemas':{CubeData},'../shared/cubenet':loadTs('src/shared/cubenet.ts'),'./state':{cs},'../shared/tutorial':shared
  })
  net.setupCubeNet()
  const practice=loadTs('src/client/practice.ts',{
    '@dcl/sdk/ecs':{engine,Transform},'@dcl/sdk/math':math,'../config':config,'../shared/schemas':{CubeData,GameState},
    '../shared/tutorial':shared,'../shared/env':{envOrigin:()=>v(316,160,360)},'./cubenet':net,'./state':{cs}
  })
  const fx=[];practice.setPracticeEffect((kind,slot)=>fx.push({kind,slot}))
  const state=()=>[...GameState.data.values()][0]
  const tick=(dt=2)=>{practice.localPracticeSystem(dt);net.cubeNetSystem(dt)}
  return {practice,net,cs,network,handlers,state,tick,CubeData,Transform,GameState,fx}
}

for(const lang of ['en','es','pt']) test(`single-player ${lang} tutorial completes offline, with instant pickup and zero game messages`,()=>{
  const h=harness(),p=h.practice,answer=lang==='en'?'SUN':'SOL'
  const checkFloorSpacing=()=>{
    const free=[...h.CubeData.data].filter(([,d])=>d.mode==='free')
    for(let i=0;i<free.length;i++) for(let j=i+1;j<free.length;j++) {
      const a=h.Transform.get(free[i][0]).position,b=h.Transform.get(free[j][0]).position
      assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>1.2,`${free[i][1].letter} and ${free[j][1].letter} need separate floor positions`)
    }
  }
  p.startLocalPractice(lang)
  checkFloorSpacing()
  assert.equal(h.cs.game,7)
  assert.equal(h.state().lang,lang)
  assert.equal(h.state().players,1)
  p.localPracticeAction('begin')
  const id=p.localLetterCube(answer[0])
  p.grabLocalCube(id)
  assert.equal(h.net.myHeldCubeId(),id,'pickup is immediate, no confirmation or distance gate')
  h.net.cubeNetSystem(100)
  assert.equal(h.net.myHeldCubeId(),id,'no server timeout can undo the pickup')
  p.placeLocalCube(0);h.tick()
  assert.equal(p.localPracticeStage(),'assist')
  assert.equal(h.state().masked,answer[0]+'__')
  const middle=p.localLetterCube(answer[1])
  p.localPracticeAction('assist')
  const middleData=[...h.CubeData.data.values()].find(d=>d.id===middle)
  assert.equal(middleData.mode,'flying')
  assert.equal(middleData.holder,'cubby-coach')
  h.tick()
  assert.equal(h.state().masked,answer.slice(0,2)+'_')
  assert.equal(p.localPracticeStage(),'last')
  const putLast=()=>{p.grabLocalCube(p.localLetterCube(answer[2]));p.placeLocalCube(2);h.tick()}
  putLast()
  assert.equal(p.localPracticeStage(),'won')
  p.localPracticeAction('mistake');h.tick()
  assert.equal(p.localPracticeStage(),'collapsed')
  checkFloorSpacing()
  assert.equal(h.state().masked,'___')
  p.localPracticeAction('rebuild');h.tick();checkFloorSpacing();putLast()
  assert.equal(p.localPracticeStage(),'complete')
  assert.equal(h.cs.settings.tutorialComplete,true)
  assert.equal(h.cs.tutorialSavePending,true,'only the completed flag needs eventual profile storage')
  assert.equal(h.cs.coins,50)
  assert.equal(h.cs.rating,100)
  assert.equal(h.network.length,0,'no seat, sync, grab, place, hint or practice network traffic')
  assert.ok(h.fx.some(f=>f.kind==='fail'))
  assert.equal(h.fx.filter(f=>f.kind==='win').length,2)
  p.stopLocalPractice()
  assert.equal(h.CubeData.data.size,0)
  assert.equal(h.GameState.data.size,0)
  assert.equal(h.net.myHeldCubeId(),-1)
})

test('foreign server cube packets cannot introduce other players cubes into the laboratory',()=>{
  const h=harness()
  h.practice.startLocalPractice('es')
  const count=h.CubeData.data.size
  h.handlers.get('cubeState')({g:7,full:1,end:1,s:999,d:[],gone:[]})
  h.handlers.get('cubeMoves')({g:7,s:999,d:[]})
  assert.equal(h.CubeData.data.size,count)
  h.tick(100)
  assert.equal(h.network.length,0)
})
