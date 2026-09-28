"use strict";

(() => {
  const viewport = document.getElementById("overlay-viewport");
  const stage = document.getElementById("overlay-stage");
  if (!viewport || !stage) return;

  let config = null;
  let telemetry = null;
  let catalog = [];
  let catalogById = new Map();
  let eventStream = null;
  let raf = 0;

  function getByPath(value, path) {
    return String(path || "")
      .split(".")
      .filter(Boolean)
      .reduce((current, key) => current == null ? undefined : current[key], value);
  }

  function computedValue(metric) {
    if (metric.computed === "vramPercent") {
      const used = Number(telemetry?.gpu?.memoryUsedMb);
      const total = Number(telemetry?.gpu?.memoryTotalMb);
      return Number.isFinite(used) && Number.isFinite(total) && total > 0
        ? used / total * 100
        : null;
    }
    if (metric.computed === "streamStatus") return telemetry?.output?.streamActive ? "LIVE" : "Nicht aktiv";
    if (metric.computed === "recordStatus") return telemetry?.output?.recordActive ? "AUFNAHME" : "Nicht aktiv";
    if (metric.computed === "networkStatus") return telemetry?.system?.network?.connected ? "Verbunden" : "Getrennt";
    if (metric.computed === "networkWarning") return telemetry?.system?.network?.unstable ? "Verbindung instabil" : "Verbindung stabil";
    return undefined;
  }

  function metricRaw(metric) {
    return metric.computed ? computedValue(metric) : getByPath(telemetry, metric.path);
  }

  function formatBytes(value) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let current = Math.max(0, Number(value) || 0);
    let index = 0;
    while (current >= 1024 && index < units.length - 1) {
      current /= 1024;
      index += 1;
    }
    return `${current.toFixed(index < 2 ? 0 : 2)} ${units[index]}`;
  }

  function formatValue(metric, card, raw) {
    if (metric.kind === "lineChart") {
      const history = Array.isArray(raw) ? raw : [];
      return { available: history.length > 0, raw: history, text: history.length ? `${history.length} Messpunkte` : "Noch keine Messpunkte" };
    }
    if (metric.kind === "coreBars") {
      const values = Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : [];
      return { available: values.length > 0, raw: values, text: values.length ? `${values.length} Kerne` : "Nicht verfügbar" };
    }
    if (["text", "status", "timecode"].includes(metric.kind)) {
      const text = String(raw ?? "").trim();
      return { available: Boolean(text), raw: text || null, text: text || "Nicht verfügbar" };
    }
    if (metric.kind === "bytes") {
      const value = Number(raw);
      return Number.isFinite(value)
        ? { available: true, raw: value, text: formatBytes(value) }
        : unavailable();
    }
    if (metric.kind === "bitrate") {
      const value = Number(raw);
      if (!Number.isFinite(value)) return unavailable();
      const mbps = value * 8 / 1_000_000;
      return { available: true, raw: mbps, text: `${mbps.toFixed(2)} Mbit/s` };
    }
    if (metric.kind === "kilobits") {
      const value = Number(raw);
      if (!Number.isFinite(value)) return unavailable();
      const unit = card.unit || metric.unit || "Kbit/s";
      return {
        available: true,
        raw: value,
        text: `${value.toLocaleString("de-DE", { maximumFractionDigits: 0 })}${unit ? ` ${unit}` : ""}`
      };
    }
    if (metric.kind === "megabytes") {
      const value = Number(raw);
      if (!Number.isFinite(value)) return unavailable();
      if ((card.unit || metric.unit) === "GB" || value >= 1024) {
        return { available: true, raw: value, text: `${(value / 1024).toFixed(2)} GB` };
      }
      return { available: true, raw: value, text: `${value.toFixed(0)} MB` };
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return unavailable();
    const decimals = Math.max(0, Math.min(4, Number(card.decimals ?? metric.decimals) || 0));
    const unit = String(card.unit ?? metric.unit ?? "");
    return {
      available: true,
      raw: value,
      text: `${value.toLocaleString("de-DE", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      })}${unit ? ` ${unit}` : ""}`
    };
  }

  function unavailable() {
    return { available: false, raw: null, text: "Nicht verfügbar" };
  }

  function activeLayout() {
    if (!config) return [];
    const profile = telemetry?.profileName || config.activeProfile || "Standard";
    return config.layoutsByProfile?.[profile]
      || config.layoutsByProfile?.[config.activeProfile]
      || config.layoutsByProfile?.Standard
      || [];
  }

  function dynamicLabel(metric) {
    if (metric.id === "obs.encoder") {
      return telemetry?.encoder?.label === "Aktiver Encoder" ? "Aktiver Encoder" : "Encoder";
    }
    return metric.label;
  }

  function sourceText(metric) {
    if (metric.id.startsWith("gpu.")) return telemetry?.gpu?.source || "";
    if (metric.id.startsWith("cpu.")) return telemetry?.system?.cpu?.source || "";
    if (metric.id.startsWith("ram.")) return telemetry?.system?.ram?.source || "";
    if (metric.id.startsWith("network.")) return telemetry?.system?.network?.source || "";
    return "OBS Studio";
  }

  function render() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!config || !telemetry || !catalog.length) return;
      resizeStage();
      const fragment = document.createDocumentFragment();
      for (const card of activeLayout().filter((entry) => entry.enabled)) {
        const metric = catalogById.get(card.id);
        if (!metric) continue;
        const resolved = formatValue(metric, card, metricRaw(metric));
        const element = document.createElement("article");
        element.className = "monitor-card";
        element.dataset.metricId = metric.id;
        element.dataset.kind = metric.kind;
        element.style.left = `${card.x}px`;
        element.style.top = `${card.y}px`;
        element.style.width = `${card.width}px`;
        element.style.height = `${card.height}px`;
        element.style.fontFamily = card.fontFamily;
        element.style.color = card.fontColor;
        element.style.backgroundColor = hexWithOpacity(card.backgroundColor, card.opacity);
        element.style.borderColor = card.borderColor;
        element.style.borderWidth = `${card.borderWidth}px`;
        element.style.borderRadius = `${card.borderRadius}px`;
        element.style.setProperty("--card-accent", card.accentColor);
        if (!resolved.available) element.classList.add("unavailable");
        if (resolved.available && Number.isFinite(Number(resolved.raw))) {
          const value = Number(resolved.raw);
          if (Number.isFinite(card.critical) && value >= Number(card.critical)) element.classList.add("critical");
          else if (Number.isFinite(card.warning) && value >= Number(card.warning)) element.classList.add("warning");
        }

        const label = document.createElement("span");
        label.className = "monitor-card-label";
        label.textContent = dynamicLabel(metric);
        element.append(label);

        if (metric.kind === "lineChart") {
          const canvas = document.createElement("canvas");
          canvas.className = "frametime-chart";
          canvas.setAttribute("aria-label", "Frametime-Verlauf");
          element.append(canvas);
          const legend = document.createElement("div");
          legend.className = "chart-legend";
          const latest = resolved.raw.at(-1)?.value;
          const maximum = Math.max(0, ...resolved.raw.map((entry) => Number(entry.value) || 0));
          const latestText = Number.isFinite(Number(latest)) ? `${Number(latest).toFixed(2)} ms` : "Nicht verfügbar";
          const maxText = maximum > 0 ? `Spitze ${maximum.toFixed(2)} ms` : "Noch keine Daten";
          const left = document.createElement("span");
          left.textContent = latestText;
          const right = document.createElement("span");
          right.textContent = maxText;
          legend.append(left, right);
          element.append(legend);
          requestAnimationFrame(() => drawChart(canvas, resolved.raw, card));
        } else if (metric.kind === "coreBars") {
          const bars = document.createElement("div");
          bars.className = "core-bars";
          resolved.raw.forEach((value, index) => {
            const row = document.createElement("div");
            row.className = "core-bar";
            const text = document.createElement("span");
            text.textContent = `C${index + 1}`;
            const track = document.createElement("span");
            track.className = "core-bar-track";
            const fill = document.createElement("span");
            fill.className = "core-bar-fill";
            fill.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
            track.append(fill);
            row.append(text, track);
            bars.append(row);
          });
          if (!resolved.available) {
            const value = document.createElement("strong");
            value.className = "monitor-card-value";
            value.textContent = resolved.text;
            value.style.fontSize = `${card.fontSize}px`;
            element.append(value);
          } else {
            element.append(bars);
          }
        } else {
          const value = document.createElement("strong");
          value.className = "monitor-card-value";
          value.textContent = resolved.text;
          value.style.fontSize = `${card.fontSize}px`;
          if (metric.kind === "status") {
            value.classList.toggle("status-live", ["LIVE", "AUFNAHME", "Verbunden", "Verbindung stabil"].includes(resolved.text));
            value.classList.toggle("status-offline", ["Nicht aktiv", "Getrennt"].includes(resolved.text));
          }
          element.append(value);
          const source = document.createElement("small");
          source.className = "monitor-card-source";
          source.textContent = sourceText(metric);
          element.append(source);
        }
        fragment.append(element);
      }
      stage.replaceChildren(fragment);
    });
  }

  function drawChart(canvas, history, card) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(2, Math.round(rect.width * devicePixelRatio));
    const height = Math.max(2, Math.round(rect.height * devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const values = history
      .slice(-Math.max(2, Math.round((card.chartSeconds || 60) * 2)))
      .map((entry) => Number(entry.value))
      .filter(Number.isFinite);
    if (values.length < 2) return;
    const maximum = Math.max(5, Number(card.chartMaximum) || 40, ...values);
    context.lineWidth = Math.max(1, devicePixelRatio);
    context.strokeStyle = card.borderColor;
    context.globalAlpha = 0.45;
    for (let index = 1; index < 4; index += 1) {
      const y = height * index / 4;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.strokeStyle = card.accentColor;
    context.lineWidth = Math.max(2, devicePixelRatio * 1.5);
    context.beginPath();
    values.forEach((value, index) => {
      const x = values.length === 1 ? 0 : index / (values.length - 1) * width;
      const y = height - Math.min(maximum, Math.max(0, value)) / maximum * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }

  function resizeStage() {
    const width = Number(config?.overlayWidth) || 1920;
    const height = Number(config?.overlayHeight) || 1080;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
    stage.style.transform = `scale(${Number.isFinite(scale) && scale > 0 ? scale : 1})`;
  }

  function hexWithOpacity(hex, opacity) {
    const normalized = /^#[0-9a-f]{6}$/i.test(String(hex || "")) ? String(hex) : "#0a1018";
    const alpha = Math.max(0, Math.min(1, Number(opacity) || 0));
    const red = parseInt(normalized.slice(1, 3), 16);
    const green = parseInt(normalized.slice(3, 5), 16);
    const blue = parseInt(normalized.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function connect() {
    try { eventStream?.close(); } catch {}
    const current = new EventSource("/events");
    eventStream = current;
    current.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "snapshot" || message.type === "status") {
          config = message.config;
          telemetry = message.telemetry;
          catalog = message.catalog || catalog;
          catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
          render();
        } else if (message.type === "config") {
          config = message.config;
          render();
        } else if (message.type === "telemetry") {
          telemetry = message.telemetry;
          render();
        }
      } catch {
        // Invalid data cannot be allowed to break the OBS browser source.
      }
    });
  }

  fetch("/api/status", { cache: "no-store" })
    .then((response) => response.json())
    .then((message) => {
      config = message.config;
      telemetry = message.telemetry;
      catalog = message.catalog || [];
      catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
      render();
      connect();
    })
    .catch(() => connect());

  window.addEventListener("resize", render);
})();
