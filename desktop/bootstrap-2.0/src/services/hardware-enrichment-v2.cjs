"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function finite(value) {
  const number = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      result.push(current.trim()); current = "";
    } else current += character;
  }
  result.push(current.trim());
  return result;
}

function parseNvidiaSmi(output) {
  const rows = [];
  for (const line of String(output || "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    const columns = splitCsvLine(line);
    if (columns.length < 3) continue;
    const [name, memoryTotalMb, driverVersion, temperatureC, utilizationPercent, encoderUtilizationPercent, graphicsClockMhz, memoryClockMhz, powerWatts, powerLimitWatts, fanPercent] = columns;
    rows.push({
      name,
      vendor: "NVIDIA",
      memoryTotalMb: finite(memoryTotalMb),
      memoryMb: finite(memoryTotalMb),
      memoryGb: finite(memoryTotalMb) !== null ? finite(memoryTotalMb) / 1024 : null,
      driverVersion,
      temperatureC: finite(temperatureC),
      utilizationPercent: finite(utilizationPercent),
      encoderUtilizationPercent: finite(encoderUtilizationPercent),
      graphicsClockMhz: finite(graphicsClockMhz),
      memoryClockMhz: finite(memoryClockMhz),
      powerWatts: finite(powerWatts),
      powerLimitWatts: finite(powerLimitWatts),
      fanPercent: finite(fanPercent),
      dedicated: true,
      integrated: false,
      source: "nvidia-smi"
    });
  }
  return rows;
}

function nvidiaSmiCandidates() {
  return [
    "nvidia-smi.exe",
    path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe")
  ];
}

async function readNvidiaGpus() {
  const query = "name,memory.total,driver_version,temperature.gpu,utilization.gpu,utilization.encoder,clocks.gr,clocks.mem,power.draw,power.limit,fan.speed";
  let lastError;
  for (const candidate of nvidiaSmiCandidates()) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    try {
      const result = await execFileAsync(candidate, [`--query-gpu=${query}`, "--format=csv,noheader,nounits"], {
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 2 * 1024 * 1024
      });
      const rows = parseNvidiaSmi(result.stdout);
      if (rows.length) return rows;
    } catch (error) { lastError = error; }
  }
  if (lastError && process.platform === "win32") console.warn("nvidia-smi konnte nicht gelesen werden:", lastError.message);
  return [];
}

function gpuName(value) {
  return String(value?.name || value?.model || value?.description || "").trim();
}

function similarity(left, right) {
  const a = gpuName(left).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const b = gpuName(right).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 80;
  const words = new Set(a.split(/\s+/));
  return b.split(/\s+/).filter((word) => words.has(word)).length;
}

function mergeGpu(existing = {}, live = {}) {
  return {
    ...existing,
    ...Object.fromEntries(Object.entries(live).filter(([, value]) => value !== null && value !== undefined && value !== "")),
    name: live.name || existing.name || existing.model,
    model: live.name || existing.model || existing.name,
    memoryMb: live.memoryTotalMb ?? existing.memoryMb,
    memoryGb: live.memoryGb ?? existing.memoryGb,
    preferred: true,
    dedicated: true,
    integrated: false
  };
}

async function enrichHardware(input = {}) {
  const hardware = input && typeof input === "object" ? input : {};
  const existing = Array.isArray(hardware.gpus) ? [...hardware.gpus] : hardware.gpu ? [hardware.gpu] : [];
  const live = await readNvidiaGpus();
  for (const nvidia of live) {
    let bestIndex = -1;
    let bestScore = 0;
    existing.forEach((gpu, index) => {
      const score = similarity(gpu, nvidia);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestIndex >= 0 && bestScore >= 2) existing[bestIndex] = mergeGpu(existing[bestIndex], nvidia);
    else existing.push(mergeGpu({}, nvidia));
  }
  const hasDedicated = existing.some((gpu) => gpu.dedicated && !gpu.integrated);
  existing.forEach((gpu) => {
    const name = gpuName(gpu);
    const integrated = gpu.integrated === true || /radeon\(tm\) graphics|intel (?:uhd|iris|hd) graphics|microsoft basic/i.test(name);
    gpu.integrated = integrated;
    gpu.dedicated = gpu.dedicated === true || !integrated;
    gpu.preferred = false;
  });
  const preferred = existing
    .map((gpu, index) => ({ index, score: (gpu.integrated ? -1000 : 0) + (/nvidia|geforce|rtx/i.test(gpuName(gpu)) ? 500 : 0) + (Number(gpu.memoryGb) || 0) * 10 }))
    .sort((left, right) => right.score - left.score)[0];
  if (preferred) existing[preferred.index].preferred = true;
  hardware.gpus = existing;
  if (existing.length) hardware.gpu = existing[preferred?.index ?? 0];
  hardware.preferredGpu = existing[preferred?.index ?? 0] || null;
  hardware.hasDedicatedGpu = hasDedicated || existing.some((gpu) => gpu.dedicated && !gpu.integrated);
  return hardware;
}

module.exports = { enrichHardware, parseNvidiaSmi, readNvidiaGpus, splitCsvLine };
