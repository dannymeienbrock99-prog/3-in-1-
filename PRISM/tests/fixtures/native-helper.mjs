import readline from 'node:readline';
for await (const line of readline.createInterface({ input: process.stdin })) {
  const { requestId, command, deviceId, colors } = JSON.parse(line);
  let result;
  if (command === 'enumerate') result = { devices: [
    { id: 0, name: 'Mock LampArray', vendor: 'Test', ledCount: 3, provider: 'windows' },
    { id: 10000, name: 'Mock Corsair RAM', vendor: 'Corsair', type: 1, ledCount: 2, provider: 'corsair', channels: [{index:0,name:'QL-RGB-Lüfter',ledCount:2}], zones: [{id:0,name:'QL-RGB-Lüfter',startIndex:0,ledCount:2}] },
    { id: 10001, name: 'Corsair K70 RGB', vendor: 'Corsair', type: 5, ledCount: 3, provider: 'corsair' },
    { id: 42, name: 'Elgato Stream Deck', vendor: 'Elgato', ledCount: 15, provider: 'windows' }
  ], environment: { corsair: { status: 'connected', deviceCount: 2 }, windows: { foregroundOnly: true } },
    discovery: [{name:'Corsair unsupported model',provider:'corsair',status:'unavailable',reason:'LED-Daten nicht verfügbar.'}, {name:'Elgato Stream Deck',provider:'corsair',status:'excluded'}],
    warnings: ['Ein Gerät meldet keine LED-Daten.'], excludedCount: 1 };
  else if (command === 'set') result = { updated: true, deviceId, colors };
  else if (command === 'show') result = { shown: true };
  else if (command === 'release') result = { released: true };
  process.stdout.write(JSON.stringify({ requestId, ok: true, result }) + '\n');
}
