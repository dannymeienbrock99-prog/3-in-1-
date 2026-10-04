import test from 'node:test';
import assert from 'node:assert/strict';
import { getMemoryPreview, getMsiDimmPositions } from '../src/memory-preview.js';

const kingston = locator => ({ manufacturer: 'Kingston', modelName: 'Kingston FURY Beast RGB DDR5-5600 CL40', partNumber: 'KF556C40BBA-8', capacityGb: 8, speedMhz: 4800, deviceLocator: locator });

test('Four populated DIMM rows remain four modules with their actual configured speed', () => {
  const memory = ['DIMM_A1', 'DIMM_A2', 'DIMM_B1', 'DIMM_B2'].map(kingston);
  const before = JSON.stringify(memory);
  const preview = getMemoryPreview({ memory });
  assert.equal(preview.count, 4);
  assert.equal(preview.visibleModules.length, 4);
  assert.equal(preview.totalGb, 32);
  assert.equal(preview.summary, '32 GB · 4 × 8 GB · Kingston FURY Beast RGB DDR5-5600 CL40');
  assert.deepEqual(preview.modules.map(module => module.speedMhz), [4800, 4800, 4800, 4800]);
  assert.deepEqual(preview.modules.map(module => module.deviceLocator), ['DIMM_A1', 'DIMM_A2', 'DIMM_B1', 'DIMM_B2']);
  assert.equal(JSON.stringify(memory), before);
});

test('A two-module kit is not invented as four installed modules', () => {
  const preview = getMemoryPreview({ installedMemoryGb: 32, memory: [kingston('A2'), kingston('B2')] });
  assert.equal(preview.count, 2);
  assert.equal(preview.totalGb, 16);
  assert.equal(preview.visibleModules.length, 2);
  assert.equal(getMsiDimmPositions(preview.count).length, 2);
});

test('Unknown or malformed inventory leaves MSI sockets empty without a model or capacity claim', () => {
  for (const system of [undefined, {}, { totalMemoryGb: 32 }, { memory: null }, { memory: {} }, { memory: [null, {}, [], { manufacturer: ' ', partNumber: {}, capacityGb: 0 }] }]) {
    assert.deepEqual(getMemoryPreview(system), { modules: [], visibleModules: [], count: 0, totalGb: null, summary: null });
  }
  assert.deepEqual(getMsiDimmPositions(0), []);
});

test('Mixed and partial modules retain only reported names and capacities', () => {
  const preview = getMemoryPreview({ memory: [kingston('A2'), { manufacturer: 'Other vendor', partNumber: 'Unspecified DDR5', capacityGb: null }] });
  assert.equal(preview.count, 2);
  assert.equal(preview.totalGb, null);
  assert.equal(preview.summary, '2 Module · Kingston FURY Beast RGB DDR5-5600 CL40 · Other vendor Unspecified DDR5');
  assert.equal(preview.modules[1].modelName, '');
  const mixed = getMemoryPreview({ memory: [kingston('A2'), { manufacturer: 'Kingston', capacityGb: 16 }] });
  assert.equal(mixed.totalGb, 24);
  assert.ok(mixed.summary.startsWith('24 GB · 2 Module'));
});

test('A board illustration limits visible sockets while the caption keeps the full installed count', () => {
  const preview = getMemoryPreview({ memory: Array.from({ length: 8 }, (_, i) => kingston(`DIMM_${i}`)) });
  assert.equal(preview.count, 8);
  assert.equal(preview.visibleModules.length, 4);
  assert.ok(preview.summary.startsWith('64 GB · 8 × 8 GB'));
  assert.deepEqual(getMsiDimmPositions(4), [0.467, 0.485, 0.503, 0.521]);
  assert.deepEqual(getMsiDimmPositions(8), [0.467, 0.485, 0.503, 0.521]);
});
