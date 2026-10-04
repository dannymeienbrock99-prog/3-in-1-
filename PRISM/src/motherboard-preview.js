const PREVIEWS = {
  asus: { label: 'ASUS', image: '/pc-asus.png' },
  msi: { label: 'MSI', image: '/pc-msi.png' },
  generic: { label: null, image: '/pc-base.png' },
};

// Only complete manufacturer aliases count; e.g. "ASUSound" and "MSI2" do not.
const ASUS = /(?:^|[^\p{L}\p{N}])asus(?:tek)?(?=$|[^\p{L}\p{N}])/iu;
const MSI = /(?:^|[^\p{L}\p{N}])(?:msi|micro[\s\u2010-\u2015-]*star[\s\u2010-\u2015-]+international)(?=$|[^\p{L}\p{N}])/iu;
const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

function boardBrands(board) {
  const metadata = [board.manufacturer, board.name];
  return [metadata.some(value => ASUS.test(value)) && 'asus', metadata.some(value => MSI.test(value)) && 'msi'].filter(Boolean);
}

/** Select an illustrative image using actual mainboard metadata, never other devices. */
export function getMotherboardPreview(system) {
  const boards = Array.isArray(system?.motherboard)
    ? system.motherboard.filter(board => board && typeof board === 'object').map(board => ({ manufacturer: clean(board.manufacturer), name: clean(board.name) })).filter(board => board.manufacturer || board.name)
    : [];
  const models = new Map();
  for (const board of boards) {
    const model = [board.manufacturer, board.name].filter(Boolean).join(' ');
    const identity = model.toLocaleLowerCase('en');
    if (!models.has(identity)) models.set(identity, model);
  }
  const brands = boards.map(boardBrands);
  const uniqueBrands = new Set(brands.flat());
  // Unknown or conflicting board rows cannot establish a single manufacturer.
  const brand = brands.length && brands.every(found => found.length === 1) && uniqueBrands.size === 1
    ? [...uniqueBrands][0]
    : 'generic';
  return {
    brand,
    ...PREVIEWS[brand],
    modelName: models.size ? [...models.values()].join(' · ') : null,
    illustrative: true,
  };
}
