import { BridgeError } from './openrgb.mjs';
import { assertDeviceAllowed } from './device-policy.mjs';

export function nativeLightingState(device) {
 const active=device.activeNativeEffect;
 if(!active)return null;
 const settings=typeof active==='object'&&!Array.isArray(active)?active:device.nativeSettings;
 if(!settings||typeof settings.effectId!=='string'||!settings.effectId||typeof active==='string'&&settings.effectId!==active)return null;
 const state={deviceId:device.id,provider:device.provider,effectId:settings.effectId};
 for(const key of ['colors','brightness','speed','direction','background','irDelay','length','width','hue','multicolor','powerSaving','controllerScope','confirmWholeController','appliedAt','confirmation','acknowledgement'])if(settings[key]!==undefined)state[key]=structuredClone(settings[key]);
 return state;
}

export function validateNativeEffect(client, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BridgeError('Herstellereffekt fehlt.', 'INVALID_SETTINGS', 400);
  if (!Array.isArray(input.deviceIds) || !input.deviceIds.length || input.deviceIds.length > 128 || input.deviceIds.some(id => !Number.isInteger(id) || id < 0)) throw new BridgeError('Bitte gültige RGB-Geräte auswählen.', 'INVALID_TARGETS', 400);
  if (typeof input.effectId !== 'string' || !input.effectId || input.effectId.length > 80) throw new BridgeError('Ungültiger Herstellereffekt.', 'INVALID_EFFECT', 400);
  if (input.zoneIds !== undefined) throw new BridgeError('Herstellereffekte gelten für den ausdrücklich ausgewählten Anschluss oder RAM-Riegel.', 'INVALID_ZONES', 400);
  const colors = input.colors ?? ['#8b5cf6', '#06b6d4'];
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 10 || colors.some(value => typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) throw new BridgeError('Eine bis zehn Farben im Format #RRGGBB erwartet.', 'INVALID_COLORS', 400);
  const options = { colors: colors.map(value => value.toLowerCase()) };
  for (const [key, fallback, min] of [['brightness', 80, 0], ['speed', 50, 1]]) {
    const value = input[key] ?? fallback;
    if (!Number.isInteger(value) || value < min || value > 100) throw new BridgeError('Helligkeit oder Geschwindigkeit ist ungültig.', 'INVALID_SETTINGS', 400);
    options[key] = value;
  }
  options.direction = input.direction ?? 'forward';
  if (!['forward', 'reverse'].includes(options.direction)) throw new BridgeError('Ungültige Richtung.', 'INVALID_SETTINGS', 400);
  const targets = [...new Set(input.deviceIds)].map(id => {
    const device = client.devices.find(value => value.id === id);
    if (!device) throw new BridgeError('Ein ausgewähltes Gerät ist nicht mehr verfügbar.', 'DEVICE_NOT_FOUND', 404);
    assertDeviceAllowed(device);
    const effect = device.nativeEffects?.find(value => value.id === input.effectId && value.supported !== false);
    if (!effect) throw new BridgeError(`${device.name}: Dieser Herstellereffekt ist für das Gerät nicht verfügbar.`, 'NATIVE_EFFECT_UNSUPPORTED', 422);
    return { device, effect };
  });
  if(targets.some(({device})=>device.wholeControllerOnly===true)){
    if(targets.length!==1||input.controllerScope!=='all'||input.confirmWholeController!==true)throw new BridgeError('Diese Strimer-Ausgabe benötigt einen einzelnen ausdrücklich ausgewählten Controller und die bestätigte Änderung aller seiner Kanäle.','WHOLE_CONTROLLER_REQUIRED',422);
    options.controllerScope='all';options.confirmWholeController=true;
  }
  if (input.background !== undefined) {
    if (typeof input.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.background)) throw new BridgeError('Ungültige Hintergrundfarbe.', 'INVALID_COLORS', 400);
    options.background = input.background;
  }
  for (const key of ['irDelay','length','width','hue']) {
    if (input[key] === undefined) continue;
    if (!Number.isInteger(input[key]) || input[key] < 0 || input[key] > 1000) throw new BridgeError('Ungültige Feineinstellung.', 'INVALID_SETTINGS', 400);
    options[key] = input[key];
  }
  for (const key of ['multicolor','powerSaving']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') throw new BridgeError('Ungültige Effektschalter.', 'INVALID_SETTINGS', 400);
    options[key] = input[key];
  }
  for (const { effect } of targets) {
    if (options.direction === 'reverse' && effect.controls?.direction === false) throw new BridgeError('Dieser Effekt bietet keine umkehrbare Richtung.', 'INVALID_SETTINGS', 400);
    if (effect.colorsMax > 0 && options.colors.length > effect.colorsMax) throw new BridgeError('Die Farbanzahl überschreitet die Möglichkeiten dieses Effekts.', 'INVALID_COLORS', 400);
    for (const key of ['background','irDelay','length','width','hue','multicolor','powerSaving']) {
      if (options[key] !== undefined && !effect.controls?.[key]) throw new BridgeError('Eine Feineinstellung wird von diesem Effekt nicht unterstützt.', 'INVALID_SETTINGS', 400);
    }
    for (const key of ['irDelay','length']) {
      if (options[key] !== undefined && (options[key] < effect[key+'Min'] || options[key] > effect[key+'Max'])) throw new BridgeError('Die Feineinstellung liegt außerhalb des Gerätebereichs.', 'INVALID_SETTINGS', 400);
    }
    if (options.width > 4 || options.hue !== undefined && ![0,20,40,60,80].includes(options.hue)) throw new BridgeError('Ungültige Breite oder Farbton.', 'INVALID_SETTINGS', 400);
  }
  return { targets, options, effectId: input.effectId };
}

export async function applyNativeEffect(client, engine, input) {
  if (!client.connected) throw new BridgeError('Die RGB-Verbindung ist nicht aktiv.', 'RGB_DISCONNECTED', 409);
  const { targets, options, effectId } = validateNativeEffect(client, input);
  engine.stop(targets.map(({ device }) => device.id));
  if (engine.framePromise) await engine.framePromise;
  const applied = [];
  const appliedAt = Date.now();
  try {
    for (const { device } of targets) {
      const result = await client.applyNativeEffect(device, effectId, options);
      device.nativeSettings = structuredClone({effectId,...options});
      device.activeNativeEffect = { effectId, ...structuredClone(options), appliedAt, confirmation:result?.transmitted ? 'transmitted' : 'api', acknowledgement:result?.acknowledgement || null }; applied.push(device.id);
    }
  } catch (error) {
    // Successful acknowledgements are kept visible; never claim an atomic multi-device write.
    error.appliedDeviceIds = applied;
    throw error;
  }
  return { applied, effectId, options, streamed: false };
}
