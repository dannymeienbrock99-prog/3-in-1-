'use strict';
const path = require('node:path');
const {Worker, isMainThread, parentPort, workerData} = require('node:worker_threads');
const {performance} = require('node:perf_hooks');

const QUERY_LIMITED_INFORMATION = 0x1000, SYNCHRONIZE = 0x100000;
const WAIT_OBJECT_0 = 0, WAIT_TIMEOUT = 258, ERROR_INVALID_PARAMETER = 87, ERROR_CANCELLED = 1223;
const MAX_WAIT_MS = 60000;
const fail = (message, code) => Object.assign(Error(message), {code});
const samePath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && path.win32.resolve(left.replace(/^\\\\\?\\/, '')).toLowerCase() === path.win32.resolve(right.replace(/^\\\\\?\\/, '')).toLowerCase();

// Microsoft SHELLEXECUTEINFOW: DWORD/ULONG/int remain 32-bit on x64;
// every handle, string pointer and the hIcon/hMonitor union is pointer-sized.
// https://learn.microsoft.com/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfow
function defineWindowsTypes(ffi) {
  return {
    fileTime: ffi.struct({dwLowDateTime:'uint32_t', dwHighDateTime:'uint32_t'}),
    executeInfo: ffi.struct({
      cbSize:'uint32_t', fMask:'uint32_t', hwnd:'void *', lpVerb:'str16', lpFile:'str16',
      lpParameters:'str16', lpDirectory:'str16', nShow:'int32_t', hInstApp:'void *',
      lpIDList:'void *', lpClass:'str16', hkeyClass:'void *', dwHotKey:'uint32_t',
      hIconOrMonitor:'void *', hProcess:'void *'
    })
  };
}

function nativeBindings(ffi = require('koffi')) {
  const types = defineWindowsTypes(ffi), kernel = ffi.load('kernel32.dll');
  const api = {
    open: kernel.func('void * __stdcall OpenProcess(uint32_t, int32_t, uint32_t)'),
    close: kernel.func('int32_t __stdcall CloseHandle(void *)'),
    lastError: kernel.func('uint32_t __stdcall GetLastError()'),
    wait: kernel.func('uint32_t __stdcall WaitForSingleObject(void *, uint32_t)'),
    image: kernel.func('int32_t __stdcall QueryFullProcessImageNameW(void *, uint32_t, _Out_ uint16_t *, _Inout_ uint32_t *)'),
    times: kernel.func('__stdcall', 'GetProcessTimes', 'int32_t', ['void *', ...Array(4).fill(ffi.out(ffi.pointer(types.fileTime)))]),
    types, libraries:[kernel], executeSize:ffi.sizeof(types.executeInfo)
  };
  api.prepareLaunch = () => {
    const systemDirectory = kernel.func('uint32_t __stdcall GetSystemDirectoryW(_Out_ uint16_t *, uint32_t)');
    const buffer = Buffer.alloc(32768 * 2), length = systemDirectory(buffer, 32768);
    if (!length || length >= 32768) throw fail('Windows-Systemkomponenten konnten nicht geprüft werden.', 'ADMIN_RESTART_UNAVAILABLE');
    const folder = buffer.subarray(0, length * 2).toString('utf16le');
    const shell = ffi.load(path.win32.join(folder, 'shell32.dll')), ole = ffi.load(path.win32.join(folder, 'ole32.dll'));
    api.libraries.push(shell, ole); // Remain loaded while native delegates are in use.
    api.execute = shell.func('__stdcall', 'ShellExecuteExW', 'int32_t', [ffi.inout(ffi.pointer(types.executeInfo))]);
    api.initializeCom = ole.func('int32_t __stdcall CoInitializeEx(void *, uint32_t)');
    api.uninitializeCom = ole.func('void __stdcall CoUninitialize()');
  };
  return api;
}

function processIdentity(api, handle) {
  const buffer = Buffer.alloc(32768 * 2), length = [32768];
  if (!api.image(handle, 0, buffer, length) || !Number.isInteger(length[0]) || length[0] < 1 || length[0] >= 32768)
    throw fail('Die vorherige Batto-Instanz konnte nicht bestätigt werden.', 'ADMIN_RESTART_IDENTITY');
  const created = {}, exited = {}, kernel = {}, user = {};
  if (!api.times(handle, created, exited, kernel, user))
    throw fail('Die Startzeit der Batto-Instanz konnte nicht geprüft werden.', 'ADMIN_RESTART_IDENTITY');
  return {executable:buffer.subarray(0, length[0] * 2).toString('utf16le'),
    startTime:((BigInt(created.dwHighDateTime) << 32n) | BigInt(created.dwLowDateTime)).toString()};
}

function validateOwn({executable, pid}, currentExecutable, currentPid) {
  if (typeof executable !== 'string' || !path.win32.isAbsolute(executable) || path.win32.extname(executable).toLowerCase() !== '.exe'
    || executable.includes('\0') || !samePath(executable, currentExecutable) || pid !== currentPid
    || !Number.isInteger(pid) || pid < 1 || pid > 0xffffffff)
    throw fail('Nur die laufende installierte Batto-Anwendung kann neu gestartet werden.', 'ADMIN_RESTART_FORBIDDEN');
}

function launchWithBindings(options, api, current = {executable:process.execPath, pid:process.pid}) {
  validateOwn(options, current.executable, current.pid);
  const handle = api.open(QUERY_LIMITED_INFORMATION, 0, options.pid);
  if (!handle) throw fail('Die laufende Batto-Instanz konnte nicht bestätigt werden.', 'ADMIN_RESTART_IDENTITY');
  let identity;
  try { identity = processIdentity(api, handle); }
  finally { api.close(handle); }
  if (!samePath(identity.executable, current.executable))
    throw fail('Die laufende Batto-Datei stimmt nicht überein.', 'ADMIN_RESTART_IDENTITY');
  api.prepareLaunch();
  const initialized = api.initializeCom(null, 0x2 | 0x4); // STA + disable OLE1 DDE.
  if (initialized < 0) throw fail('Der Windows-Neustart konnte nicht vorbereitet werden.', 'ADMIN_RESTART_UNAVAILABLE');
  const info = {
    cbSize:api.executeSize, fMask:0x40 | 0x100 | 0x400, hwnd:null,
    lpVerb:'runas', lpFile:current.executable,
    lpParameters:`--batto-wait-pid=${options.pid} --batto-wait-start=${identity.startTime}`,
    lpDirectory:path.win32.dirname(current.executable), nShow:1,
    hInstApp:null, lpIDList:null, lpClass:null, hkeyClass:null, dwHotKey:0, hIconOrMonitor:null, hProcess:null
  };
  try {
    if (!api.execute(info)) {
      const error = api.lastError(); // Same thread, before any further Win32 call.
      if (error === ERROR_CANCELLED) return {accepted:false, cancelled:true, code:'ADMIN_RESTART_CANCELLED'};
      throw fail(`Windows konnte Batto nicht als Administrator starten (Fehler ${error}).`, 'ADMIN_RESTART_FAILED');
    }
    return {accepted:true};
  } finally {
    if (info.hProcess) api.close(info.hProcess);
    api.uninitializeCom();
  }
}

function previousArguments(argv) {
  if (!Array.isArray(argv)) throw fail('Ungültige Batto-Neustartargumente.', 'ADMIN_RESTART_ARGUMENTS');
  const pids = argv.filter(value => typeof value === 'string' && value.startsWith('--batto-wait-pid'));
  const times = argv.filter(value => typeof value === 'string' && value.startsWith('--batto-wait-start'));
  if (!pids.length && !times.length) return null;
  if (pids.length !== 1 || times.length !== 1) throw fail('Ungültige Batto-Neustartargumente.', 'ADMIN_RESTART_ARGUMENTS');
  const pidText = /^--batto-wait-pid=([1-9]\d{0,9})$/.exec(pids[0])?.[1];
  const timeText = /^--batto-wait-start=([1-9]\d{0,19})$/.exec(times[0])?.[1];
  if (!pidText || Number(pidText) > 0xffffffff || !timeText || BigInt(timeText) > 0xffffffffffffffffn)
    throw fail('Ungültige Batto-Neustartargumente.', 'ADMIN_RESTART_ARGUMENTS');
  return {pid:Number(pidText), startTime:timeText};
}

async function awaitWithBindings(previous, api, {executable=process.execPath, pid=process.pid, now=()=>performance.now(), sleep=ms=>new Promise(resolve=>setTimeout(resolve, ms)), maximumWaitMs=MAX_WAIT_MS} = {}) {
  if (!previous) return;
  if (previous.pid === pid) throw fail('Batto kann nicht auf seine eigene Instanz warten.', 'ADMIN_RESTART_ARGUMENTS');
  const handle = api.open(QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, previous.pid);
  if (!handle) {
    if (api.lastError() === ERROR_INVALID_PARAMETER) return; // Previous PID no longer exists.
    throw fail('Das Ende der vorherigen Batto-Instanz konnte nicht geprüft werden.', 'ADMIN_RESTART_IDENTITY');
  }
  try {
    const identity = processIdentity(api, handle);
    // A reused PID is not the original instance. Never wait on another program.
    if (!samePath(identity.executable, executable) || identity.startTime !== previous.startTime) return;
    const deadline = now() + Math.min(MAX_WAIT_MS, Math.max(0, maximumWaitMs));
    for (;;) {
      const result = api.wait(handle, 0); // Nonblocking Win32 poll; keep JS responsive.
      if (result === WAIT_OBJECT_0) return;
      if (result !== WAIT_TIMEOUT) throw fail('Das Ende der vorherigen Batto-Instanz konnte nicht bestätigt werden.', 'ADMIN_RESTART_WAIT_FAILED');
      if (now() >= deadline) throw fail('Die vorherige Batto-Instanz ist nach 60 Sekunden noch aktiv. Bitte zuerst schließen und Batto erneut öffnen.', 'ADMIN_RESTART_TIMEOUT');
      await sleep(Math.min(100, Math.max(1, deadline-now())));
    }
  } finally { api.close(handle); }
}

async function launchOwnAsAdministrator({executable=process.execPath, pid=process.pid} = {}) {
  if (process.platform !== 'win32')
    throw fail('Der Administrator-Neustart steht nur in der installierten Windows-Version bereit.', 'ADMIN_RESTART_UNAVAILABLE');
  validateOwn({executable,pid}, process.execPath, process.pid);
  if (!isMainThread || !process.versions.electron || require('electron').app?.isPackaged !== true)
    throw fail('Der Administrator-Neustart steht nur in der installierten Windows-Version bereit.', 'ADMIN_RESTART_UNAVAILABLE');
  return new Promise((resolve,reject) => {
    // One Node thread in this process performs COM + runas. No launcher EXE or
    // shell is involved, and the Electron UI continues while UAC is shown.
    const worker = new Worker(__filename, {workerData:{operation:'batto-own-admin', executable:process.execPath, pid:process.pid}});
    let settled = false;
    worker.once('message', value => {
      settled = true;
      if (value?.ok === true && typeof value.result?.accepted === 'boolean') resolve(value.result);
      else reject(fail(value?.message || 'Der Windows-Neustart ist fehlgeschlagen.', value?.code || 'ADMIN_RESTART_FAILED'));
    });
    worker.once('error', error => { if (!settled) {settled=true; reject(error);} });
    worker.once('exit', () => { if (!settled) {settled=true; reject(fail('Der Windows-Neustart wurde nicht bestätigt.', 'ADMIN_RESTART_FAILED'));} });
  });
}

async function awaitPreviousInstance(argv) {
  const previous = previousArguments(argv);
  if (!previous) return;
  if (process.platform !== 'win32') throw fail('Dieser Batto-Neustart benötigt Windows.', 'ADMIN_RESTART_UNAVAILABLE');
  await awaitWithBindings(previous, nativeBindings());
}

if (!isMainThread && workerData?.operation === 'batto-own-admin') {
  try { parentPort.postMessage({ok:true, result:launchWithBindings(workerData, nativeBindings())}); }
  catch (error) { parentPort.postMessage({ok:false, code:error.code || 'ADMIN_RESTART_FAILED', message:error.message}); }
  parentPort.close();
}

module.exports = {launchOwnAsAdministrator, awaitPreviousInstance,
  // Pure adapters for deterministic ABI and lifecycle tests; never launch.
  _testing:{defineWindowsTypes, nativeBindings, launchWithBindings, previousArguments, awaitWithBindings, validateOwn}};
