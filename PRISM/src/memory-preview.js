const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const number = value => value.toLocaleString('de-DE', { maximumFractionDigits: 1 });

/** One inventory row represents one installed DIMM, even when part numbers match. */
export function getMemoryPreview(system) {
  const modules = (Array.isArray(system?.memory) ? system.memory : [])
    .filter(module => module && typeof module === 'object' && !Array.isArray(module))
    .map(module => ({
      manufacturer: clean(module.manufacturer),
      partNumber: clean(module.partNumber),
      modelName: clean(module.modelName || module.displayName || module.name),
      deviceLocator: clean(module.deviceLocator || module.slot),
      capacityGb: positive(module.capacityGb),
      speedMhz: positive(module.speedMhz),
    }))
    .filter(module => module.manufacturer || module.partNumber || module.modelName || module.capacityGb || module.speedMhz);
  const capacityKnown = modules.length > 0 && modules.every(module => module.capacityGb !== null);
  const totalGb = capacityKnown ? modules.reduce((sum, module) => sum + module.capacityGb, 0) : null;
  const capacities = new Set(modules.map(module => module.capacityGb));
  const sameCapacity = capacityKnown && capacities.size === 1;
  const names = [...new Set(modules.map(module => module.modelName || [module.manufacturer, module.partNumber].filter(Boolean).join(' ')).filter(Boolean))];
  return {
    modules,
    // This illustrative board has four DIMM sockets. Keep the full count in its caption.
    visibleModules: modules.slice(0, 4),
    count: modules.length,
    totalGb,
    summary: modules.length ? [
      totalGb !== null ? `${number(totalGb)} GB` : null,
      sameCapacity ? `${modules.length} × ${number(modules[0].capacityGb)} GB` : `${modules.length} ${modules.length === 1 ? 'Modul' : 'Module'}`,
      names.join(' · '),
    ].filter(Boolean).join(' · ') : null,
  };
}

export function getMsiDimmPositions(count) {
  // Keep two modules in the conventional alternating sockets; four fill all sockets.
  const sockets = [0.467, 0.485, 0.503, 0.521];
  const indices = count === 1 ? [1] : count === 2 ? [1, 3] : count === 3 ? [0, 1, 3] : [0, 1, 2, 3];
  return indices.slice(0, Math.max(0, Math.min(4, count))).map(index => sockets[index]);
}
