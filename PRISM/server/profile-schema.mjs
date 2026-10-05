export const MAX_LIGHT_PROFILES = 100;
export const PROFILE_DOCUMENT_VERSION = 2;
export const MAX_PROFILE_BYTES = 128 * 1024;

export function profileMetadata(value) {
  const result = {};
  if (value.category !== undefined) {
    if (typeof value.category !== 'string' || value.category.length > 40 || /[\u0000-\u001f]/.test(value.category)) throw new Error('Die Szenenkategorie ist ungültig (maximal 40 Zeichen).');
    result.category = value.category.trim();
  }
  if (value.favorite !== undefined) {
    if (typeof value.favorite !== 'boolean') throw new Error('Die Favoritenangabe ist ungültig.');
    result.favorite = value.favorite;
  }
  if (value.targetDevices !== undefined) {
    if (!Array.isArray(value.targetDevices) || value.targetDevices.length > 128 || value.targetDevices.some(id => !Number.isInteger(id) || id < 0 || id > 0x7fffffff) || new Set(value.targetDevices).size !== value.targetDevices.length) throw new Error('Die gespeicherte Geräteauswahl ist ungültig.');
    result.targetDevices = [...value.targetDevices];
  }
  return result;
}

export function profileDocumentItems(value, { allowArray = true } = {}) {
  if (allowArray && Array.isArray(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.app !== 'PRISM' || ![1, PROFILE_DOCUMENT_VERSION].includes(value.version) || !Array.isArray(value.profiles)) throw new Error('Keine unterstützte RGB-Profildatei (Version 1 oder 2).');
  return value.profiles;
}

export function profileDocument(profiles) { return { app: 'PRISM', version: PROFILE_DOCUMENT_VERSION, profiles }; }
