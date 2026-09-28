"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = path.join(__dirname, "..", "src", "renderer");

test("overview uses the Crazy_Batto Multi Chat hero without stretching the old bg artwork", () => {
  const html = fs.readFileSync(path.join(renderer, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(renderer, "overview-hero.css"), "utf8");

  assert.match(html, /Crazy_Batto Multi Chat/);
  assert.match(html, /BATTO OBS TOOL 2\.1\.0/);
  assert.match(html, /OBS, TikTok und Multi-Chat zentral steuern/);
  assert.match(html, /Produktionskern für OBS, TikTok LIVE Studio\/API, Multi-Chat, Touch-Deck und Browser-Overlays\./);
  assert.match(html, /Stand 02\.08\.2026/);
  assert.doesNotMatch(html, /Touch-Deck Pro/);
  assert.match(css, /BATTO MULTI-CHAT/);
  assert.match(css, /\.overview-hero \.overview-bg\{display:none!important\}/);
  assert.doesNotMatch(css, /object-fit:\s*cover/);
});
