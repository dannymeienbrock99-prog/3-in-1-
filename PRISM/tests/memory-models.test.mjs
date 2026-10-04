import test from 'node:test';
import assert from 'node:assert/strict';
import {describeMemoryPart,memorySummary} from '../server/memory-models.mjs';
import {readSystemInventory} from '../server/inventory.mjs';
test('Kingston specs describe verified part numbers without creating hardware',()=>{
 assert.equal(describeMemoryPart(' kf556c40bba-8 ').modelName,'Kingston FURY Beast RGB DDR5-5600 CL40');
 assert.equal(describeMemoryPart('KF556C40BBAK2-16').kitModules,2);
 assert.equal(describeMemoryPart('KF556C40BB-8'),null);
 assert.equal(describeMemoryPart('Other RGB memory'),null);
 assert.equal(describeMemoryPart(null),null);
 assert.equal(describeMemoryPart('KF556C40BBA-8').controllable,undefined);
});
test('four physical DIMMs remain four 8GB modules even if firmware reports a kit part number',async()=>{
 const system={cpus:()=>[{model:'Fixture CPU'}],totalmem:()=>32*1024**3,type:()=>'',release:()=>'',arch:()=>''};
 const value=await readSystemInventory({platform:'win32',system,query:async category=>category.key==='memory'?Array.from({length:4},(_,i)=>({Manufacturer:'Kingston',PartNumber:'KF556C40BBAK2-16',Capacity:8*1024**3,ConfiguredClockSpeed:4800,Speed:5600,DeviceLocator:`DIMM ${i+1}`})):[]});
 assert.equal(value.memory.length,4);assert.equal(value.installedMemoryGb,32);
 assert.deepEqual(memorySummary(value.memory),{moduleCount:4,totalGb:32,moduleCapacityGb:8});
 assert.deepEqual(value.memory.map(m=>m.slot),['DIMM 1','DIMM 2','DIMM 3','DIMM 4']);
 assert(value.memory.every(m=>m.speedMhz===4800&&m.ratedSpeedMt===5600&&m.ratedCasLatency===40));
});
test('missing and mixed capacity stay honest; unknown RAM is not renamed Kingston',()=>{
 assert.deepEqual(memorySummary([]),{moduleCount:0,totalGb:null,moduleCapacityGb:null});
 assert.equal(memorySummary([{capacityGb:8},{capacityGb:null}]).totalGb,null);
 assert.equal(memorySummary([{capacityGb:8},{capacityGb:16}]).moduleCapacityGb,null);
});
