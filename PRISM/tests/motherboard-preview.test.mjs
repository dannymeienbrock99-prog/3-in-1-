import test from 'node:test';
import assert from 'node:assert/strict';
import { getMotherboardPreview } from '../src/motherboard-preview.js';

const system = (manufacturer, name = 'Reported board model') => ({ motherboard: [{ manufacturer, name }] });

test('ASUS and ASUSTeK aliases select the ASUS illustration while retaining real metadata', () => {
  for (const manufacturer of ['ASUS', 'ASUSTeK COMPUTER INC.', 'asustek Computer Inc.', '  ASUS  ']) {
    const preview = getMotherboardPreview(system(manufacturer, ' Actual board model '));
    assert.equal(preview.brand, 'asus');
    assert.equal(preview.label, 'ASUS');
    assert.equal(preview.image, '/pc-asus.png');
    assert.equal(preview.illustrative, true);
    assert.equal(preview.modelName, `${manufacturer.trim()} Actual board model`);
    assert.ok(!preview.modelName.includes('CROSSHAIR'));
  }
});

test('MSI and Micro-Star International aliases select the MSI illustration', () => {
  for (const manufacturer of ['MSI', 'Micro-Star International Co., Ltd.', 'Micro Star International', 'MicroStar International', 'MICRO–STAR INTERNATIONAL CO., LTD.']) {
    const preview = getMotherboardPreview(system(manufacturer, 'PRO test model'));
    assert.equal(preview.brand, 'msi');
    assert.equal(preview.label, 'MSI');
    assert.equal(preview.image, '/pc-msi.png');
    assert.equal(preview.modelName, `${manufacturer} PRO test model`);
    assert.ok(!preview.modelName.includes('GODLIKE'));
  }
});

test('An explicitly branded mainboard product can supply its missing manufacturer', () => {
  assert.equal(getMotherboardPreview(system('', 'ASUS PRIME Example')).brand, 'asus');
  assert.equal(getMotherboardPreview(system(null, 'MSI PRO Example')).brand, 'msi');
});

test('Partial tokens and unrelated short model codes cannot claim a manufacturer', () => {
  for (const manufacturer of ['ASUSound', 'xASUS', 'ASUSTechnology', 'MSI2', 'AMSI', 'MSInternational', 'Micro-Star Internationalist', 'Micro-Star Industrial', 'éASUS']) {
    assert.equal(getMotherboardPreview(system(manufacturer)).brand, 'generic', manufacturer);
  }
  assert.equal(getMotherboardPreview(system('', 'MS-7XXX')).brand, 'generic');
  assert.equal(getMotherboardPreview(system('Micro-Star', 'International model')).brand, 'generic');
});

test('ASUS GPU and MSI USB names never change an unknown or absent mainboard', () => {
  const devices = {
    gpus: [{ name: 'ASUS GeForce Example', manufacturer: 'ASUSTeK COMPUTER INC.' }],
    devices: [{ name: 'MSI RGB controller', manufacturer: 'Micro-Star International' }],
    memory: [{ manufacturer: 'ASUS', partNumber: 'Example RAM' }],
  };
  assert.equal(getMotherboardPreview(devices).brand, 'generic');
  const preview = getMotherboardPreview({ ...system('Gigabyte', 'Actual board'), ...devices });
  assert.equal(preview.brand, 'generic');
  assert.equal(preview.image, '/pc-base.png');
  assert.equal(preview.modelName, 'Gigabyte Actual board');
});

test('Missing, invalid and empty inventory yields the original illustration without invented names', () => {
  for (const value of [undefined, null, {}, { motherboard: null }, { motherboard: {} }, { motherboard: [] }, { motherboard: [null, {}, { manufacturer: ' ', name: '\t' }] }, { motherboard: [{ manufacturer: 123, name: {} }] }]) {
    assert.deepEqual(getMotherboardPreview(value), { brand: 'generic', label: null, image: '/pc-base.png', modelName: null, illustrative: true });
  }
});

test('Different brands across mainboards or conflicting fields fall back to the original illustration', () => {
  for (const value of [
    { motherboard: [...system('ASUS', 'Board A').motherboard, ...system('MSI', 'Board B').motherboard] },
    system('ASUS', 'MSI product'),
    system('MSI', 'ASUS product'),
    { motherboard: [...system('MSI', 'Board A').motherboard, ...system('Unknown OEM', 'Board B').motherboard] },
  ]) {
    const preview = getMotherboardPreview(value);
    assert.equal(preview.brand, 'generic');
    assert.equal(preview.label, null);
    assert.equal(preview.image, '/pc-base.png');
    assert.ok(preview.modelName);
  }
});

test('Several matching mainboards retain the common brand and every reported model', () => {
  const preview = getMotherboardPreview({ motherboard: [
    { manufacturer: 'ASUS', name: 'Board A' },
    { manufacturer: 'ASUSTeK COMPUTER INC.', name: 'Board B' },
    { manufacturer: 'asus', name: 'board a' },
    null, {},
  ] });
  assert.equal(preview.brand, 'asus');
  assert.equal(preview.modelName, 'ASUS Board A · ASUSTeK COMPUTER INC. Board B');
});

test('Each call follows refreshed inventory immediately without mutating the input', () => {
  const value = system('MSI', 'Old model');
  const first = getMotherboardPreview(value);
  const serialized = JSON.stringify(value);
  assert.equal(first.brand, 'msi');
  assert.equal(JSON.stringify(value), serialized);
  value.motherboard = system('ASUS', 'New model').motherboard;
  const second = getMotherboardPreview(value);
  assert.equal(second.brand, 'asus');
  assert.equal(second.modelName, 'ASUS New model');
  assert.equal(first.brand, 'msi');
  value.motherboard = [];
  assert.equal(getMotherboardPreview(value).brand, 'generic');
});
