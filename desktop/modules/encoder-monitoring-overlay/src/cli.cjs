"use strict";

const os = require("node:os");
const path = require("node:path");
const { MonitoringOverlayServer } = require("./server.cjs");

async function main() {
  const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
  const port = portArgument ? Number(portArgument.split("=")[1]) : 17822;
  const configFile = process.env.BATTO_ENCODER_OVERLAY_CONFIG
    || path.join(os.homedir(), ".batto-obs-tool", "encoder-overlay.json");
  const server = new MonitoringOverlayServer({ port, configFile });
  const status = await server.start();
  process.stdout.write([
    "Batto OBS Tool – Encoder-Monitoring-Overlay",
    `Editor:  ${status.editorUrl}`,
    `OBS-URL: ${status.overlayUrl}`,
    "Beenden mit Strg+C"
  ].join("\n") + "\n");

  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
