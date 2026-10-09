// These are illustrative control points on the bundled 4:3 PC images.
// Their IDs and sample indices are local UI coordinates, never hardware LED IDs.
export const PC_COMPONENTS = [
  { type: 'fans', label: 'Lüfter', x: 82.2, y: 47.6, width: 21, height: 76 },
  { type: 'motherboard', label: 'Mainboard', x: 37, y: 30, width: 16, height: 21 },
  { type: 'ram', label: 'Arbeitsspeicher', x: 52.7, y: 29, width: 9, height: 33 },
  { type: 'gpu', label: 'Grafikkarte', x: 39, y: 61.8, width: 57, height: 16 },
  { type: 'strip', label: 'LED-Streifen', x: 41, y: 86.6, width: 61, height: 6 },
  { type: 'strimer', label: 'Strimer-Kabel', x: 61, y: 69, width: 13, height: 32 },
];

// iCUE's generic lighting-controller category can be "strip" even when its
// confirmed channel configuration contains RGB fans. This adds a photo target,
// without changing the device category, zones or any hardware LED addresses.
export function getPreviewDeviceTypes(device) {
  if (/strimer/i.test(device.name || '')) return ['strimer'];
  const types = device.category ? [device.category] : [];
  const fanChannel = device.provider === 'corsair' && Array.isArray(device.channels)
    && device.channels.some(channel => channel.complete === true
      && channel.source === 'icue-configuration'
      && [channel.name, ...(Array.isArray(channel.devices) ? channel.devices.map(item => item.name) : [])]
        .some(name => typeof name === 'string' && /(?:lüfter|luefter|\bfans?\b)/i.test(name)));
  if (fanChannel && !types.includes('fans')) types.push('fans');
  return types;
}

export function getPreviewPoints({ types = [], dimmPositions = null, layout = {} } = {}) {
  const visible = new Set(types), points = [];
  function add(type, group, index, x, y, position, sampleIndex = index) {
    if (!visible.has(type)) return;
    const base = PC_COMPONENTS.find(component => component.type === type);
    const placed = layout[type];
    if (placed) {
      x = placed.x / 100 + (x - base.x / 100) * placed.width / base.width;
      y = placed.y / 100 + (y - base.y / 100) * placed.height / base.height;
    }
    // A moved component can extend past the photo; invisible points must not
    // leave invisible keyboard targets outside the clipped preview.
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    points.push({ id: `${type}-${group}-${index}`, type, x, y, position, sampleIndex });
  }

  [0.235, 0.477, 0.715].forEach((centerY, fan) => {
    for (let index = 0; index < 12; index++) {
      const angle = -Math.PI * 3 / 4 + index / 12 * Math.PI * 2;
      add('fans', `${fan}-outer`, index, 0.822 + Math.cos(angle) * 0.0844,
        centerY + Math.sin(angle) * 0.0844 * 4 / 3, index / 12);
    }
    for (let index = 0; index < 4; index++) {
      const angle = -Math.PI / 2 + index / 4 * Math.PI * 2;
      add('fans', `${fan}-hub`, index, 0.822 + Math.cos(angle) * 0.018,
        centerY + Math.sin(angle) * 0.024, index / 4, 12 + index);
    }
  });

  // Only the existing cooler outline, deliberately no ASUS-display points.
  const cooler = [
    [0.337, 0.227], [0.370, 0.227], [0.404, 0.227],
    [0.426, 0.251], [0.426, 0.299], [0.426, 0.346],
    [0.404, 0.370], [0.370, 0.370], [0.337, 0.370],
    [0.315, 0.346], [0.315, 0.299], [0.315, 0.251],
  ];
  cooler.forEach(([x, y], index) => add('motherboard', 'rim', index, x, y, index / cooler.length));
  (dimmPositions ?? [0.511, 0.544]).forEach((x, module) => {
    for (let index = 0; index < 10; index++) {
      add('ram', `module-${module}`, index, x, 0.148 + index / 9 * 0.287, index / 9);
    }
  });
  for (let index = 0; index < 10; index++) {
    add('gpu', 'bar', index, 0.115 + index / 9 * 0.288, 0.619, index / 11);
  }
  add('gpu', 'bar', 10, 0.416, 0.609, 10 / 11);
  add('gpu', 'bar', 11, 0.428, 0.599, 1);
  for (let index = 0; index < 16; index++) {
    add('strip', 'bar', index, 0.132 + index / 15 * 0.567, 0.866, index / 15);
  }
  for (let strand = 0; strand < 8; strand++) {
    for (let index = 0; index < 10; index++) {
      add('strimer', `strand-${strand}`, index, 0.575 + strand * 0.009,
        0.55 + index / 9 * 0.28, index / 9, strand * 10 + index);
    }
  }
  return points;
}
