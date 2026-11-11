const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')
test('connecting gate releases the local tutorial and late connection cannot override cinematic input',()=>{
  const values=new Map(),handlers=new Map()
  const InputModifier={has:e=>values.has(e),createOrReplace:(e,d)=>values.set(e,d),deleteFrom:e=>values.delete(e),Mode:{Standard:d=>d}}
  const cs={myAddress:'alice',tutorialActive:false}
  let synced=false
  const mod=loadTs('src/client/connection.ts',{
    '@dcl/sdk/ecs':{engine:{PlayerEntity:1,getEntitiesWith:()=>Array.from({length:7},(_,i)=>[i,{game:i}])},InputModifier},
    '@dcl/sdk/network':{isStateSyncronized:()=>synced},'../shared/messages':{room:{onMessage:(n,fn)=>handlers.set(n,fn),send(){}}},
    '../shared/schemas':{GameState:{}},'./state':{cs},'../config':{SKIP_SERVER_GATE:false,GAME_COUNT:7,JOIN_RETRY_SECONDS:2}
  })
  mod.setupConnection();mod.connectionSystem(1)
  assert.equal(values.get(1).mode.disableAll,true)
  cs.tutorialActive=true;mod.releaseTutorialGate()
  assert.equal(values.has(1),false)
  InputModifier.createOrReplace(1,{mode:{disableWalk:true}})
  mod.connectionSystem(1)
  assert.equal(values.get(1).mode.disableWalk,true)
  synced=true;handlers.get('profile')({});mod.connectionSystem(1)
  assert.equal(mod.serverReady(),true)
  assert.equal(values.get(1).mode.disableWalk,true,'profile arrival must not unlock the active cinematic')
})
