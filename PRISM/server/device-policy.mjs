import { BridgeError } from './openrgb.mjs';

export const PROTECTED_DEVICES = ['Stream Deck', 'Elgato'];

export function isProtectedDevice(device) {
  if (device?.protected === true) return true;
  const identity = ['name', 'vendor', 'description', 'location', 'nativeId', 'devicePath']
    .map(key => String(device?.[key] ?? '')).join(' ');
  return /stream[\s_-]*deck|\belgato\b|vid[_:=\s-]?0fd9\b/i.test(identity);
}

export function assertDeviceAllowed(device) {
  if (isProtectedDevice(device)) throw new BridgeError('Stream Deck und Elgato-Geräte sind von der RGB-Steuerung ausgeschlossen.', 'DEVICE_PROTECTED', 422);
}
