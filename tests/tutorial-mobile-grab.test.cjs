const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./load-ts.cjs')
function harness(phone=true,local=true) {
  const config=loadTs('src/config.ts'),sent=[],guesses=[]
  const cs={myAddress:'alice',game:local?7:0,inGame:true,tutorialActive:local,tutorialCinematic:false,practiceLetter:'S',practiceSlot:0,practiceCubeId:10}
  const cube={id:10,game:cs.game,letter:'S',mode:'free',holder:'',slot:-1}
  const held=()=>cube.mode==='held'?10:-1
  const actions=loadTs('src/client/actions.ts',{
    '@dcl/sdk/ecs':{engine:{PlayerEntity:1},Transform:{get:()=>({position:{x:-6,y:0,z:-7}}),getOrNull:()=>({position:{x:-6,y:0,z:-7}})}},
    '@dcl/sdk/math':{Vector3:{distance:()=>0}},'../config':config,'../shared/messages':{room:{send:(name,data)=>sent.push({name,data})}},
    '../shared/tutorial':loadTs('src/shared/tutorial.ts'),'../shared/schemas':{CubeData:{get:()=>cube}},'../shared/env':{envOrigin:()=>({x:0,y:0,z:0})},
    './cubes':{isHolding:()=>held()>=0},'./cubenet':{cubeEntity:()=>10,myHeldCubeId:held,slotTaken:()=>false,guessMode:(id,mode,slot)=>{guesses.push({id,mode,slot});Object.assign(cube,{mode,slot,holder:'alice'})}},
    './practice':{grabLocalCube:id=>Object.assign(cube,{mode:'held',holder:'alice'}),placeLocalCube:slot=>Object.assign(cube,{mode:'flying',slot}),localLetterCube:()=>10},
    './gamestate':{myState:()=>({phase:'playing',masked:'___'})},'./state':{cs,lockoutLeft:()=>0,showMessage(){}},
    './audio':{SFX:{},playSfx(){}},'./emotes':{playThrowEmote(){}},'./i18n':{t:k=>k},'./ui/platform':{mobile:()=>phone}
  })
  return {actions,cs,cube,sent,guesses}
}
for(const phone of [false,true]) test(`local ${phone?'mobile':'desktop'} grab and place are immediate with no network or guesses`,()=>{
  const h=harness(phone)
  if(phone)h.actions.grabTutorialCube();else h.actions.grabCube(10)
  assert.equal(h.cube.mode,'held')
  h.actions.tossHeld()
  assert.equal(h.cube.mode,'held')
  h.actions.throwAtFrame(0)
  assert.equal(h.cube.mode,'flying')
  assert.equal(h.cube.slot,0)
  assert.equal(h.sent.length,0)
  assert.equal(h.guesses.length,0)
})
test('public game pickup still uses its existing server and prediction',()=>{
  for(const phone of [false,true]){
    const h=harness(phone,false)
    h.actions.grabCube(10)
    assert.equal(h.sent[0].name,'grab')
    assert.equal(h.guesses.length,1)
  }
})
test('mobile tap cannot advance dialogue and immediately grab or place',()=>{
  const h=harness()
  h.cs.practiceTouchReady=false
  h.actions.grabTutorialCube()
  assert.equal(h.cube.mode,'free')
  h.cs.practiceTouchReady=true
  h.actions.grabTutorialCube()
  h.cs.practiceTouchReady=false
  h.actions.throwAtFrame(0)
  assert.equal(h.cube.mode,'held')
})
