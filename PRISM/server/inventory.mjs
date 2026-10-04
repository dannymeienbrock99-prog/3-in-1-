import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describeMemoryPart } from './memory-models.mjs';

const execute = promisify(execFile);
const CLASSES = [
  { key: 'motherboard', label: 'Mainboard', className: 'Win32_BaseBoard', properties: ['Manufacturer', 'Product'] },
  { key: 'cpus', label: 'Prozessor', className: 'Win32_Processor', properties: ['Name', 'NumberOfCores', 'NumberOfLogicalProcessors'] },
  { key: 'memory', label: 'Arbeitsspeicher', className: 'Win32_PhysicalMemory', properties: ['Manufacturer', 'PartNumber', 'Capacity', 'Speed', 'ConfiguredClockSpeed', 'DeviceLocator', 'BankLabel'] },
  { key: 'gpus', label: 'Grafikkarte', className: 'Win32_VideoController', properties: ['Name', 'DriverVersion'] },
  { key: 'drives', label: 'Laufwerke', className: 'Win32_DiskDrive', properties: ['Model', 'Size', 'InterfaceType'] },
  { key: 'devices', label: 'Windows-Geräte', className: 'Win32_PnPEntity', filter: 'Present = TRUE', properties: ['Name', 'Caption', 'Description', 'Manufacturer', 'PNPClass', 'PNPDeviceID', 'DeviceID', 'Status', 'ConfigManagerErrorCode', 'Present'] },
  { key: 'monitors', label: 'Bildschirm-Modellnamen', className: 'WmiMonitorID', namespace: 'root\\wmi', filter: 'Active = TRUE', allowEmpty: true, properties: ['InstanceName', 'Active', 'ManufacturerName', 'ProductCodeID', 'UserFriendlyName'] },
  { key: 'deviceNames', label: 'USB-Gerätenamen', allowEmpty: true, supplementary: true, command: `
  $ids = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.InstanceId -match '^(USB|HID)\\\\' } | Select-Object -ExpandProperty InstanceId)
  $items = @()
  if ($ids.Count -gt 0) {
    $items = @(Get-PnpDeviceProperty -InstanceId $ids -KeyName 'DEVPKEY_Device_BusReportedDeviceDesc','DEVPKEY_Device_FriendlyName','DEVPKEY_Device_Manufacturer' -ErrorAction SilentlyContinue | Select-Object DeviceID,InstanceId,KeyName,Data)
  }` },
];
const text = value => typeof value === 'string' ? value.trim() : '';
const positive = value => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; };
const rounded = (value, divisor) => { const number = positive(value); return number === null ? null : Math.round(number / divisor * 10) / 10; };
const array = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
const edidText = value => Array.isArray(value) ? value.filter(code => Number.isInteger(code) && code >= 32 && code <= 126).map(code => String.fromCharCode(code)).join('').trim() : '';
const genericDeviceName = value => /^(?:device|wireless_device|usb audio|usb[- ]?(?:device|input device|composite device|eingabegerät|verbundgerät)|hid[- ](?:compliant|konform).*|generic .+|generisch.+)$/i.test(value);
const CLASS_CATEGORIES = {
  keyboard: 'keyboard', mouse: 'mouse', hidclass: 'peripheral', media: 'audio', audioendpoint: 'audio',
  monitor: 'monitor', display: 'gpu', net: 'network', bluetooth: 'bluetooth', camera: 'camera', image: 'camera',
  printer: 'printer', printqueue: 'printer', usb: 'usb', usbdevice: 'usb', ports: 'controller',
  scsiadapter: 'controller', hdc: 'controller', diskdrive: 'storage', volume: 'storage', storagevolume: 'storage',
  processor: 'processor', system: 'system', computer: 'system', firmware: 'system', softwarecomponent: 'system',
};

function normalizeDevice(item) {
  const instanceId = text(item.PNPDeviceID) || text(item.DeviceID);
  const name = text(item.Name) || text(item.Caption) || text(item.Description) || 'Name von Windows nicht gemeldet';
  const manufacturer = text(item.Manufacturer);
  const className = text(item.PNPClass);
  const deviceClass = className.toLowerCase();
  const protectedDevice = /stream[ -]?deck|elgato/i.test(`${name} ${manufacturer}`) || /\\VID_0FD9(?:[&\\]|$)/i.test(instanceId);
  const prefix = instanceId.split('\\')[0].toUpperCase();
  const connection = { USB: 'USB', HID: 'HID', PCI: 'PCI', BTH: 'Bluetooth', BTHENUM: 'Bluetooth', BTHLE: 'Bluetooth', SW: 'Software', SWD: 'Software', ROOT: 'Software', DISPLAY: 'Display', ACPI: 'ACPI' }[prefix] || prefix || 'Windows';
  const errorCode = item.ConfigManagerErrorCode == null ? NaN : Number(item.ConfigManagerErrorCode);
  return {
    id: `windows:${instanceId || `${className}:${name}`}`,
    instanceId, name, windowsName: name, model: name, manufacturer, className,
    category: CLASS_CATEGORIES[deviceClass] || (prefix === 'USB' ? 'usb' : prefix === 'HID' ? 'peripheral' : 'system'),
    status: text(item.Status) || 'Unknown', problemCode: Number.isInteger(errorCode) && errorCode >= 0 ? errorCode : null,
    connection, present: true, protected: protectedDevice, controllable: false,
    lightingSupport: protectedDevice ? 'excluded' : 'not_checked', source: 'Windows',
  };
}
const normalizers = {
  motherboard: item => ({ manufacturer: text(item.Manufacturer), name: text(item.Product) }),
  cpus: item => ({ name: text(item.Name), cores: positive(item.NumberOfCores), logicalCores: positive(item.NumberOfLogicalProcessors) }),
  memory: item => ({ manufacturer: text(item.Manufacturer), partNumber: text(item.PartNumber), capacityGb: rounded(item.Capacity, 1024 ** 3), speedMhz: positive(item.ConfiguredClockSpeed) ?? positive(item.Speed), ...(text(item.DeviceLocator)||text(item.BankLabel) ? {slot:text(item.DeviceLocator)||text(item.BankLabel)} : {}), ...(describeMemoryPart(text(item.PartNumber))||{}) }),
  gpus: item => ({ name: text(item.Name), driverVersion: text(item.DriverVersion) }),
  drives: item => ({ model: text(item.Model), sizeGb: rounded(item.Size, 1e9), interfaceType: text(item.InterfaceType) }),
  devices: normalizeDevice,
  monitors: item => ({ name: edidText(item.UserFriendlyName) || edidText(item.ProductCodeID) || 'Bildschirm-Modellname nicht gemeldet', manufacturer: edidText(item.ManufacturerName), productCode: edidText(item.ProductCodeID), instanceId: text(item.InstanceName), active: item.Active === true, source: 'Windows-EDID' }),
  deviceNames: item => ({ instanceId: text(item.DeviceID) || text(item.InstanceId), key: text(item.KeyName), value: text(item.Data) }),
};
const meaningful = {
  motherboard: item => Boolean(item.manufacturer || item.name),
  cpus: item => Boolean(item.name),
  memory: item => Boolean(item.manufacturer || item.partNumber || item.capacityGb !== null || item.speedMhz !== null),
  gpus: item => Boolean(item.name),
  drives: item => Boolean(item.model || item.sizeGb !== null),
  devices: item => Boolean(item.instanceId || item.name !== 'Name von Windows nicht gemeldet'),
  monitors: item => Boolean(item.instanceId),
  deviceNames: item => Boolean(item.instanceId && item.value),
};

async function queryWindows(category) {
  // These are local, read-only Windows metadata queries. No USB/HID or RGB device is opened.
  // Each category has its own process and timeout, so one provider cannot discard the rest.
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  ${category.command || `$items = @(Get-CimInstance -ClassName ${category.className}${category.namespace ? ` -Namespace '${category.namespace}'` : ''}${category.filter ? ` -Filter '${category.filter}'` : ''} -Property ${category.properties.join(',')} -OperationTimeoutSec 8 | Select-Object ${category.properties.join(',')})`}
  [ordered]@{ ok = $true; items = $items } | ConvertTo-Json -Depth 4 -Compress
} catch {
  [ordered]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Depth 4 -Compress
}
`;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 12_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
  const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  if (!result.ok) { const error = new Error(text(result.error) || 'Windows konnte diese Geräteinformationen nicht lesen.'); error.code = 'CIM_FAILED'; throw error; }
  return array(result.items);
}

export async function readSystemInventory({ platform = process.platform, query = queryWindows, system = os } = {}) {
  const cpuMetadata = system.cpus();
  const value = {
    os: { name: platform === 'win32' ? 'Windows' : system.type(), version: system.release(), architecture: system.arch() },
    totalMemoryGb: rounded(system.totalmem(), 1024 ** 3),
    cpus: [{ name: text(cpuMetadata[0]?.model) || 'Nicht verfügbar', logicalCores: cpuMetadata.length }],
    motherboard: [], memory: [], gpus: [], drives: [], devices: [], monitors: [], deviceCounts: {}, source: 'Betriebssystem', error: null, errors: [], warnings: [],
  };
  if (platform !== 'win32') return value;
  const results = await Promise.allSettled(CLASSES.map(category => query(category)));
  let succeeded = 0, nameProperties = [];
  results.forEach((result, index) => {
    const category = CLASSES[index];
    if (result.status === 'fulfilled') {
      const items = array(result.value).filter(item => item && typeof item === 'object' && (category.key !== 'devices' || item.Present !== false) && (category.key !== 'monitors' || item.Active !== false)).map(normalizers[category.key]).filter(meaningful[category.key]);
      if (category.supplementary) { nameProperties = items; return; }
      if (items.length) { value[category.key] = items; succeeded++; return; }
      if (category.allowEmpty) return;
      value.errors.push({ component: category.key, label: category.label, code: 'INVENTORY_EMPTY', message: `Windows meldet keine Detailinformationen für ${category.label}.` });
      return;
    }
    const timeout = result.reason?.killed || result.reason?.code === 'ETIMEDOUT';
    value.errors.push({ component: category.key, label: category.label, code: timeout ? 'INVENTORY_TIMEOUT' : 'INVENTORY_UNAVAILABLE', message: timeout ? `Die Windows-Abfrage für ${category.label} hat zu lange gedauert.` : `Windows konnte die Detailinformationen für ${category.label} nicht lesen.`, detail: text(result.reason?.message).slice(0, 300) });
  });
  const properties = new Map();
  for (const property of nameProperties) {
    if (!property.instanceId || !property.value) continue;
    const id = property.instanceId.toUpperCase();
    if (!properties.has(id)) properties.set(id, {});
    properties.get(id)[property.key] = property.value;
  }
  const monitorById = new Map(value.monitors.map(monitor => [monitor.instanceId.replace(/_\d+$/, '').toUpperCase(), monitor]));
  const seen = new Set();
  value.devices = value.devices.filter(device => {
    const identity = device.id.toUpperCase();
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  }).map(device => {
    const detail = properties.get(device.instanceId.toUpperCase());
    if (detail) {
      const busName = detail.DEVPKEY_Device_BusReportedDeviceDesc;
      const friendlyName = detail.DEVPKEY_Device_FriendlyName;
      const candidates = [busName, friendlyName, device.name].filter(Boolean);
      device.name = candidates.find(name => !genericDeviceName(name)) || candidates[0];
      device.model = device.name;
      device.manufacturer = detail.DEVPKEY_Device_Manufacturer || device.manufacturer;
      device.nameSource = device.name === busName ? 'Windows-BusReportedName' : device.name === friendlyName ? 'Windows-FriendlyName' : 'Windows';
    }
    const monitor = monitorById.get(device.instanceId.toUpperCase());
    if (device.category === 'monitor' && monitor) { device.name = monitor.name; device.model = monitor.name; device.nameSource = 'Windows-EDID'; }
    // Enriched names may identify an Elgato device whose generic PnP name did not.
    if (/stream[ -]?deck|elgato/i.test(`${device.name} ${device.manufacturer}`)) { device.protected = true; device.lightingSupport = 'excluded'; }
    value.deviceCounts[device.category] = (value.deviceCounts[device.category] || 0) + 1;
    return device;
  }).sort((left, right) => left.name.localeCompare(right.name, 'de', { numeric: true }) || left.id.localeCompare(right.id));
  if (succeeded) value.source = 'Windows-Geräteinformationen';
  if (value.memory.length && value.memory.every(item => item.capacityGb !== null)) value.installedMemoryGb = Math.round(value.memory.reduce((sum, item) => sum + item.capacityGb, 0) * 10) / 10;
  value.warnings = value.errors.map(error => error.message);
  if (value.errors.length) value.error = `PC-Details fehlen bei: ${value.errors.map(error => error.label).join(', ')}. Prozessor und RAM-Gesamtgröße bleiben aus dem Betriebssystem verfügbar.`;
  return value;
}

export function createInventoryReader(read = readSystemInventory, now = Date.now) {
  let cache = null, pending = null;
  return async function systemInventory({ force = false } = {}) {
    const ttl = cache?.value.errors?.length ? 5_000 : 30_000;
    if (!force && cache && now() - cache.timestamp < ttl) return cache.value;
    if (pending) return pending;
    pending = read().then(value => { cache = { timestamp: now(), value }; return value; }).finally(() => { pending = null; });
    return pending;
  };
}

export const systemInventory = createInventoryReader();
