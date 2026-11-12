const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const ts=require('typescript')
const path=require('node:path')
const {loadTs}=require('./load-ts.cjs')
const sdk=require(path.resolve('node_modules/@dcl/ecs/dist-cjs/index.js'))
const math={Vector3:{Zero:()=>({x:0,y:0,z:0})}}

test('real SDK keeps frame click registration and restores serialized pointer options after every cinematic',async()=>{
  const {engine,PointerEvents,Transform,UiTransform,InputAction}=sdk
  const source=fs.readFileSync('src/client/tutorial.ts','utf8')
  const mocks=Object.fromEntries(ts.preProcessFile(source).importedFiles.map(i=>[i.fileName,{}]))
  Object.assign(mocks,{'@dcl/sdk/ecs':sdk,'@dcl/sdk/math':math,'../config':loadTs('src/config.ts'),'../shared/tutorial':loadTs('src/shared/tutorial.ts')})
  const tutorial=loadTs('src/client/tutorial.ts',mocks,'exports.pointers={hide:hideWorldPointers,restore:restoreWorldPointers}')
  const frame=engine.addEntity(),button=engine.addEntity()
  Transform.create(frame,{})
  UiTransform.create(button,{})
  let clicks=0,target=null
  const events=sdk.createPointerEventsSystem(engine,{getClick:()=>null,getInputCommand:(_button,_type,entity)=>entity===target?{button:InputAction.IA_POINTER}:null})
  events.onPointerDown({entity:frame,opts:{button:InputAction.IA_POINTER,hoverText:'Place',maxDistance:10}},()=>{clicks++})
  events.onPointerDown({entity:button,opts:{button:InputAction.IA_POINTER}},()=>{})
  const original=JSON.parse(JSON.stringify(PointerEvents.get(frame)))
  const uiOriginal=JSON.parse(JSON.stringify(PointerEvents.get(button)))
  for(let i=0;i<5;i++) {
    tutorial.pointers.hide();tutorial.pointers.hide()
    assert.equal(PointerEvents.get(frame).pointerEvents.length,1)
    assert.equal(PointerEvents.get(frame).pointerEvents[0].eventInfo.showFeedback,false)
    assert.deepEqual(JSON.parse(JSON.stringify(PointerEvents.get(button))),uiOriginal)
    tutorial.pointers.restore()
    assert.deepEqual(JSON.parse(JSON.stringify(PointerEvents.get(frame))),original)
    target=frame
    await engine.update(0.016)
    target=null
    assert.equal(clicks,i+1,'registered world callback survives repeated cinematics')
  }
  events.removeOnPointerDown(frame);events.removeOnPointerDown(button)
  engine.removeEntity(frame);engine.removeEntity(button)
})
