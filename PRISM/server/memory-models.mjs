// Product metadata only: a recognized RAM part never creates an RGB controller.
const KINGSTON_PARTS = new Map([
  ['KF556C40BBA-8', {modelName:'Kingston FURY Beast RGB DDR5-5600 CL40',kitModules:1,skuCapacityGb:8}],
  ['KF556C40BBAK2-16', {modelName:'Kingston FURY Beast RGB DDR5-5600 CL40 (K2)',kitModules:2,skuCapacityGb:16}],
]);
export function describeMemoryPart(partNumber) {
  if(typeof partNumber!=='string')return null;
  const model=KINGSTON_PARTS.get(partNumber.trim().toUpperCase());
  return model ? {...model,memoryType:'DDR5',ratedSpeedMt:5600,ratedCasLatency:40,rgbModel:true,modelSource:'Kingston-Teilenummer'} : null;
}
export function memorySummary(modules = []) {
  const rows=Array.isArray(modules)?modules.filter(row=>row&&typeof row==='object'):[];
  const capacities=rows.map(row=>Number(row.capacityGb));
  const known=rows.length>0&&capacities.every(value=>Number.isFinite(value)&&value>0);
  const totalGb=known?Math.round(capacities.reduce((sum,value)=>sum+value,0)*10)/10:null;
  const sameCapacity=known&&capacities.every(value=>value===capacities[0]);
  return {moduleCount:rows.length,totalGb,moduleCapacityGb:sameCapacity?capacities[0]:null};
}
