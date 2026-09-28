"use strict";
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "src", "renderer", "index.html");
let html = fs.readFileSync(file, "utf8");

const replacement = '<img class="overview-bg" src="./assets/multi-chat-dashboard.svg" alt="Crazy_Batto Multi Chat – TikTok, Twitch, YouTube und CNG">';
const oldImage = /<img\s+class="overview-bg"[^>]*>/;

if (oldImage.test(html)) {
  html = html.replace(oldImage, replacement);
} else if (!html.includes('multi-chat-dashboard.svg')) {
  const heroMarker = '<div class="hero-card overview-hero">';
  if (!html.includes(heroMarker)) throw new Error("Overview-Hero fehlt in renderer/index.html");
  html = html.replace(heroMarker, `${heroMarker}\n              ${replacement}`);
}

if (html.includes('./assets/bg.jpg')) throw new Error("Altes verpixeltes bg.jpg ist noch im Produktions-Renderer eingebunden.");
if (!html.includes('multi-chat-dashboard.svg')) throw new Error("Skalierbare Multi-Chat-Grafik wurde nicht eingebunden.");

fs.writeFileSync(file, html, "utf8");
console.log("Overview: bg.jpg entfernt; skalierbare Multi-Chat-SVG aktiv.");
