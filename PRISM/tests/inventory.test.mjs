import test from 'node:test';
import assert from 'node:assert/strict';
import { readSystemInventory, createInventoryReader } from '../server/inventory.mjs';

const system = { cpus: () => [{ model: ' Actual OS CPU ' }, { model: ' Actual OS CPU ' }], totalmem: () => 32 * 1024 ** 3, type: () => 'Test OS', release: () => 'Test version', arch: () => 'x64' };
const metadata = {
  motherboard: [{ Manufacturer: ' ASUS ', Product: ' Example board ' }],
  cpus: [{ Name: ' Ryzen ', NumberOfCores: 8, NumberOfLogicalProcessors: 16 }],
  memory: [{ Manufacturer: ' Corsair ', PartNumber: ' Example RAM ', Capacity: '17179869184', ConfiguredClockSpeed: 6000, Speed: 4800 }, { Manufacturer: ' Corsair ', PartNumber: ' Example RAM ', Capacity: '17179869184', ConfiguredClockSpeed: 6000, Speed: 4800 }],
  gpus: [{ Name: ' Example GPU ', DriverVersion: ' 1.2 ' }],
  drives: [{ Model: ' Example SSD ', Size: '2000000000000', InterfaceType: ' SCSI ' }],
  devices: [{ Name: 'Example keyboard', PNPClass: 'Keyboard', PNPDeviceID: 'USB\\VID_1234&PID_5678\\TEST', Present: true, Status: 'OK' }],
  monitors: [], deviceNames: [],
};

test('One failed Windows provider preserves independently discovered RAM and other components', async () => {
  const value = await readSystemInventory({ platform: 'win32', system, query: async category => {
    if (category.key === 'gpus') { const error = new Error('Permission denied'); error.code = 'EACCES'; throw error; }
    return metadata[category.key];
  } });
  assert.equal(value.memory.length, 2);
  assert.equal(value.memory[0].partNumber, 'Example RAM');
  assert.equal(value.memory[0].capacityGb, 16);
  assert.equal(value.memory[0].speedMhz, 6000);
  assert.equal(value.installedMemoryGb, 32);
  assert.equal(value.motherboard[0].name, 'Example board');
  assert.equal(value.drives[0].sizeGb, 2000);
  assert.deepEqual(value.gpus, []);
  assert.equal(value.errors[0].component, 'gpus');
  assert.equal(value.errors[0].code, 'INVENTORY_UNAVAILABLE');
  assert.equal(value.warnings.length, 1);
});

test('A timed-out provider never erases other categories, all queries are launched independently', async () => {
  const launched = [];
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const reading = readSystemInventory({ platform: 'win32', system, query: async category => {
    launched.push(category.key);
    if (category.key === 'drives') { await wait; const error = new Error('timeout'); error.killed = true; throw error; }
    return metadata[category.key];
  } });
  assert.equal(launched.length, 8);
  release();
  const value = await reading;
  assert.equal(value.memory.length, 2);
  assert.equal(value.gpus[0].name, 'Example GPU');
  assert.equal(value.errors[0].code, 'INVENTORY_TIMEOUT');
});

test('All failing providers retain genuine OS CPU and total RAM without inventing modules', async () => {
  const value = await readSystemInventory({ platform: 'win32', system, query: async () => { throw new Error('WMI unavailable'); } });
  assert.deepEqual(value.cpus, [{ name: 'Actual OS CPU', logicalCores: 2 }]);
  assert.equal(value.totalMemoryGb, 32);
  assert.deepEqual(value.memory, []);
  assert.equal(value.errors.length, 8);
  assert.equal(value.source, 'Betriebssystem');
});

test('Empty provider and irregular numeric metadata remain explicit instead of showing NaN', async () => {
  const value = await readSystemInventory({ platform: 'win32', system, query: async category => category.key === 'memory' ? { Manufacturer: '  ', Capacity: 'invalid', ConfiguredClockSpeed: 0, Speed: '4800' } : [] });
  assert.equal(value.memory[0].capacityGb, null);
  assert.equal(value.memory[0].speedMhz, 4800);
  assert.equal(value.errors.length, 5);
  assert.equal(value.cpus[0].name, 'Actual OS CPU');
});

test('Windows USB descriptors name generic devices while Elgato remains visible and excluded from control', async () => {
  const streamId = 'USB\\VID_0FD9&PID_0080\\TEST';
  const hubId = 'USB\\VID_1B1C&PID_0C1A\\TEST';
  const value = await readSystemInventory({ platform: 'win32', system, query: async category => {
    if (category.key === 'devices') return [
      { Name: 'USB-Eingabegerät', Manufacturer: '(Standardsystemgeräte)', PNPClass: 'HIDClass', PNPDeviceID: streamId, Present: true },
      { Name: 'USB-Eingabegerät', PNPClass: 'HIDClass', PNPDeviceID: hubId, Present: true },
    ];
    if (category.key === 'deviceNames') return [
      { DeviceID: streamId, KeyName: 'DEVPKEY_Device_BusReportedDeviceDesc', Data: ' Stream Deck MK.2 ' },
      { DeviceID: hubId, KeyName: 'DEVPKEY_Device_BusReportedDeviceDesc', Data: 'CORSAIR Lighting Node CORE' },
    ];
    return metadata[category.key];
  } });
  const stream = value.devices.find(device => device.name === 'Stream Deck MK.2');
  assert.equal(stream.windowsName, 'USB-Eingabegerät');
  assert.equal(stream.nameSource, 'Windows-BusReportedName');
  assert.equal(stream.protected, true);
  assert.equal(stream.lightingSupport, 'excluded');
  assert.ok(value.devices.every(device => device.controllable === false));
  assert.ok(value.devices.some(device => device.name === 'CORSAIR Lighting Node CORE'));
  assert.equal(value.deviceCounts.peripheral, 2);
});

test('More specific Windows names survive an unhelpful generic USB descriptor', async () => {
  const id = 'USB\\VID_1234&PID_5678\\TEST';
  const value = await readSystemInventory({ platform: 'win32', system, query: async category => {
    if (category.key === 'devices') return [{ Name: 'Specific microphone model', PNPClass: 'MEDIA', PNPDeviceID: id, Present: true }];
    if (category.key === 'deviceNames') return [{ DeviceID: id, KeyName: 'DEVPKEY_Device_BusReportedDeviceDesc', Data: 'USB Audio' }];
    return metadata[category.key];
  } });
  assert.equal(value.devices[0].name, 'Specific microphone model');
  assert.equal(value.devices[0].nameSource, 'Windows');
});

test('Present Windows device inventory removes duplicate instances and disconnected entries without collapsing same-named devices', async () => {
  const value = await readSystemInventory({ platform: 'win32', system, query: async category => category.key === 'devices' ? [
    { Name: 'Same model', PNPClass: 'USB', PNPDeviceID: 'USB\\FIRST', Present: true },
    { Name: 'Same model', PNPClass: 'USB', PNPDeviceID: 'usb\\first', Present: true },
    { Name: 'Same model', PNPClass: 'USB', PNPDeviceID: 'USB\\SECOND', Present: true },
    { Name: 'Disconnected device', PNPClass: 'USB', PNPDeviceID: 'USB\\OLD', Present: false },
    {},
  ] : metadata[category.key] });
  assert.equal(value.devices.length, 2);
  assert.equal(value.deviceCounts.usb, 2);
  assert.notEqual(value.devices[0].id, value.devices[1].id);
});

test('Extra USB name provider failure retains PnP names and all independently discovered PC components', async () => {
  const value = await readSystemInventory({ platform: 'win32', system, query: async category => {
    if (category.key === 'deviceNames') { const error = new Error('timeout'); error.killed = true; throw error; }
    return metadata[category.key];
  } });
  assert.equal(value.devices[0].name, 'Example keyboard');
  assert.equal(value.memory.length, 2);
  assert.equal(value.errors.length, 1);
  assert.equal(value.errors[0].component, 'deviceNames');
  assert.equal(value.errors[0].code, 'INVENTORY_TIMEOUT');
});

test('EDID names attach only to the exact monitor instance, with a separately reported monitor list', async () => {
  const encode = value => [...value].map(char => char.charCodeAt(0)).concat([0, 0]);
  const value = await readSystemInventory({ platform: 'win32', system, query: async category => {
    if (category.key === 'devices') return [
      { Name: 'Generic PnP monitor', PNPClass: 'Monitor', PNPDeviceID: 'DISPLAY\\MODEL\\MONITOR_1', Present: true },
      { Name: 'Other generic monitor', PNPClass: 'Monitor', PNPDeviceID: 'DISPLAY\\MODEL\\MONITOR_2', Present: true },
    ];
    if (category.key === 'monitors') return [{ InstanceName: 'DISPLAY\\MODEL\\MONITOR_1_0', UserFriendlyName: encode('Real monitor model'), ManufacturerName: encode('SAM'), ProductCodeID: encode('ABCD'), Active: true }];
    return metadata[category.key];
  } });
  assert.equal(value.monitors[0].name, 'Real monitor model');
  assert.equal(value.monitors[0].manufacturer, 'SAM');
  assert.equal(value.devices.find(device => device.instanceId.endsWith('MONITOR_1')).name, 'Real monitor model');
  assert.equal(value.devices.find(device => device.instanceId.endsWith('MONITOR_2')).name, 'Other generic monitor');
});

test('Blank metadata rows cannot replace genuine OS CPU information or fabricate unnamed devices', async () => {
  const value = await readSystemInventory({ platform: 'win32', system, query: async () => [{}, null] });
  assert.equal(value.cpus[0].name, 'Actual OS CPU');
  assert.equal(value.cpus[0].logicalCores, 2);
  assert.deepEqual(value.memory, []);
  assert.deepEqual(value.devices, []);
  assert.ok(value.errors.some(error => error.component === 'cpus' && error.code === 'INVENTORY_EMPTY'));
});

test('A rejected inventory read clears its in-flight state so a later refresh can recover', async () => {
  let count = 0;
  const reader = createInventoryReader(async () => { if (++count === 1) throw new Error('temporary failure'); return { devices: [], errors: [] }; });
  await assert.rejects(reader({ force: true }), /temporary failure/);
  const value = await reader({ force: true });
  assert.deepEqual(value.devices, []);
  assert.equal(count, 2);
});

test('Non-Windows inventory uses OS facts without running Windows queries', async () => {
  const value = await readSystemInventory({ platform: 'linux', system, query: () => { throw new Error('Should not execute'); } });
  assert.equal(value.os.name, 'Test OS');
  assert.equal(value.totalMemoryGb, 32);
  assert.equal(value.error, null);
});

test('Cache shares in-flight reads, refresh bypasses cached value, partial errors retry sooner', async () => {
  let count = 0, time = 100;
  const reader = createInventoryReader(async () => ({ totalMemoryGb: ++count, errors: [{ component: 'gpus' }] }), () => time);
  const values = await Promise.all([reader(), reader()]);
  assert.equal(count, 1);
  assert.equal(values[0], values[1]);
  await reader(); assert.equal(count, 1);
  await reader({ force: true }); assert.equal(count, 2);
  time += 5_001;
  await reader(); assert.equal(count, 3);
});

test('Successful inventory cache expires after 30 seconds and explicit refresh removes unplugged entries', async () => {
  let count = 0, time = 0;
  const reader = createInventoryReader(async () => ({ devices: ++count < 3 ? [{ name: `Current model ${count}` }] : [], errors: [] }), () => time);
  assert.equal((await reader()).devices[0].name, 'Current model 1');
  time = 29_999;
  assert.equal((await reader()).devices[0].name, 'Current model 1');
  time = 30_001;
  assert.equal((await reader()).devices[0].name, 'Current model 2');
  assert.deepEqual((await reader({ force: true })).devices, []);
});

// Independent, injected Windows metadata from different hypothetical PCs.
// The USB instance IDs are synthetic. These fixtures test discovery/name handling,
// not physical RGB support, and are never imported by production modules.
const crossPcFixtures = [
  {
    label: 'Intel / MSI / G.Skill / AMD Radeon / Lian Li',
    osCpu: 'Intel(R) Core(TM) i7-14700K', totalBytes: 32 * 1024 ** 3,
    motherboard: [{ Manufacturer: 'Micro-Star International Co., Ltd.', Product: 'MAG Z790 TOMAHAWK MAX WIFI' }],
    cpus: [{ Name: 'Intel(R) Core(TM) i7-14700K', NumberOfCores: 20, NumberOfLogicalProcessors: 28 }],
    memory: [
      { Manufacturer: 'G.Skill', PartNumber: 'F5-6000J3038F16G', Capacity: 16 * 1024 ** 3, ConfiguredClockSpeed: 6000 },
      { Manufacturer: 'G.Skill', PartNumber: 'F5-6000J3038F16G', Capacity: 16 * 1024 ** 3, ConfiguredClockSpeed: 6000 },
    ],
    gpus: [{ Name: 'AMD Radeon RX 7900 XT', DriverVersion: 'Example driver A' }],
    drives: [{ Model: 'WD_BLACK SN850X 2000GB', Size: 2_000_000_000_000, InterfaceType: 'SCSI' }],
    devices: [
      { Name: 'USB Input Device', Manufacturer: 'Microsoft', PNPClass: 'HIDClass', PNPDeviceID: 'USB\\CROSS_PC_FIXTURE_A\\LIAN_LI', Present: true, Status: 'OK' },
      { Name: 'Intel Ethernet Controller', Manufacturer: 'Intel Corporation', PNPClass: 'Net', PNPDeviceID: 'PCI\\CROSS_PC_FIXTURE_A\\NETWORK', Present: true, Status: 'OK' },
    ],
    deviceNames: [
      { DeviceID: 'USB\\CROSS_PC_FIXTURE_A\\LIAN_LI', KeyName: 'DEVPKEY_Device_BusReportedDeviceDesc', Data: 'Lian Li UNI FAN Controller' },
      { DeviceID: 'USB\\CROSS_PC_FIXTURE_A\\LIAN_LI', KeyName: 'DEVPKEY_Device_Manufacturer', Data: 'Lian Li' },
    ], monitors: [],
  },
  {
    label: 'AMD / ASRock / Kingston / NVIDIA / NZXT / Razer',
    osCpu: 'AMD Ryzen 9 7950X 16-Core Processor', totalBytes: 64 * 1024 ** 3,
    motherboard: [{ Manufacturer: 'ASRock', Product: 'X670E Steel Legend' }],
    cpus: [{ Name: 'AMD Ryzen 9 7950X 16-Core Processor', NumberOfCores: 16, NumberOfLogicalProcessors: 32 }],
    memory: [
      { Manufacturer: 'Kingston', PartNumber: 'KF560C36BBE-32', Capacity: 32 * 1024 ** 3, Speed: 6000, ConfiguredClockSpeed: 5600 },
      { Manufacturer: 'Kingston', PartNumber: 'KF560C36BBE-32', Capacity: 32 * 1024 ** 3, Speed: 6000, ConfiguredClockSpeed: 5600 },
    ],
    gpus: [{ Name: 'NVIDIA GeForce RTX 4070', DriverVersion: 'Example driver B' }],
    drives: [{ Model: 'Crucial T500 1TB', Size: 1_000_000_000_000, InterfaceType: 'SCSI' }],
    devices: [
      { Name: 'USB Composite Device', Manufacturer: 'Microsoft', PNPClass: 'USB', PNPDeviceID: 'USB\\CROSS_PC_FIXTURE_B\\NZXT', Present: true, Status: 'OK' },
      { Name: 'HID Keyboard Device', Manufacturer: 'Microsoft', PNPClass: 'Keyboard', PNPDeviceID: 'HID\\CROSS_PC_FIXTURE_B\\RAZER', Present: true, Status: 'OK' },
    ],
    deviceNames: [
      { DeviceID: 'USB\\CROSS_PC_FIXTURE_B\\NZXT', KeyName: 'DEVPKEY_Device_BusReportedDeviceDesc', Data: 'NZXT RGB & Fan Controller' },
      { DeviceID: 'USB\\CROSS_PC_FIXTURE_B\\NZXT', KeyName: 'DEVPKEY_Device_Manufacturer', Data: 'NZXT' },
      { DeviceID: 'HID\\CROSS_PC_FIXTURE_B\\RAZER', KeyName: 'DEVPKEY_Device_BusReportedDeviceDesc', Data: 'Razer BlackWidow V4' },
      { DeviceID: 'HID\\CROSS_PC_FIXTURE_B\\RAZER', KeyName: 'DEVPKEY_Device_Manufacturer', Data: 'Razer' },
    ], monitors: [],
  },
];

for (const fixture of crossPcFixtures) {
  test(`Inventory derives every model dynamically on an independent ${fixture.label} PC`, async () => {
    const pcOs = { ...system, cpus: () => Array.from({ length: fixture.cpus[0].NumberOfLogicalProcessors }, () => ({ model: fixture.osCpu })), totalmem: () => fixture.totalBytes };
    const value = await readSystemInventory({ platform: 'win32', system: pcOs, query: async category => fixture[category.key] });
    assert.equal(value.cpus[0].name, fixture.cpus[0].Name);
    assert.equal(value.cpus[0].cores, fixture.cpus[0].NumberOfCores);
    assert.equal(value.motherboard[0].name, fixture.motherboard[0].Product);
    assert.equal(value.motherboard[0].manufacturer, fixture.motherboard[0].Manufacturer);
    assert.deepEqual(value.memory.map(item => item.manufacturer), fixture.memory.map(item => item.Manufacturer));
    assert.deepEqual(value.memory.map(item => item.partNumber), fixture.memory.map(item => item.PartNumber));
    assert.equal(value.installedMemoryGb, fixture.totalBytes / 1024 ** 3);
    assert.equal(value.gpus[0].name, fixture.gpus[0].Name);
    assert.equal(value.drives[0].model, fixture.drives[0].Model);
    for (const item of fixture.deviceNames.filter(item => item.KeyName === 'DEVPKEY_Device_BusReportedDeviceDesc')) {
      const actual = value.devices.find(device => device.instanceId === item.DeviceID);
      assert.equal(actual.name, item.Data);
      assert.equal(actual.nameSource, 'Windows-BusReportedName');
      assert.equal(actual.controllable, false);
      assert.equal(actual.lightingSupport, 'not_checked');
    }
    assert.deepEqual(value.errors, []);
  });
}

test('Another PC with an unknown OEM retains its actual Unicode names without inventing RGB support', async () => {
  const deviceId = 'USB\\VID_FFFE&PID_0001\\UNKNOWN_OEM_FIXTURE';
  const input = { ...crossPcFixtures[0], devices: [{ Name: 'USB Input Device', PNPClass: 'CustomVendorClass', PNPDeviceID: deviceId, Present: true }], deviceNames: [
    { DeviceID: deviceId, KeyName: 'DEVPKEY_Device_BusReportedDeviceDesc', Data: '  未知メーカー RGB 装置 Ω  ' },
    { DeviceID: deviceId, KeyName: 'DEVPKEY_Device_Manufacturer', Data: '  Beispiel-ÖEM  ' },
  ] };
  const value = await readSystemInventory({ platform: 'win32', system, query: async category => input[category.key] });
  assert.equal(value.devices[0].name, '未知メーカー RGB 装置 Ω');
  assert.equal(value.devices[0].manufacturer, 'Beispiel-ÖEM');
  assert.equal(value.devices[0].category, 'usb');
  assert.equal(value.devices[0].protected, false);
  assert.equal(value.devices[0].controllable, false);
  assert.equal(value.devices[0].lightingSupport, 'not_checked');
});

test('Switching refreshed metadata to a different PC does not retain models from the previous inventory', async () => {
  let fixture = crossPcFixtures[0];
  const reader = createInventoryReader(() => readSystemInventory({ platform: 'win32', system, query: async category => fixture[category.key] }));
  const first = await reader();
  fixture = crossPcFixtures[1];
  const second = await reader({ force: true });
  assert.equal(second.motherboard[0].manufacturer, 'ASRock');
  assert.equal(second.memory[0].manufacturer, 'Kingston');
  assert.notEqual(second.cpus[0].name, first.cpus[0].name);
  assert.notEqual(second.gpus[0].name, first.gpus[0].name);
  assert.ok(second.devices.some(device => device.name === 'Razer BlackWidow V4'));
  assert.ok(!second.devices.some(device => device.name === 'Lian Li UNI FAN Controller'));
});
