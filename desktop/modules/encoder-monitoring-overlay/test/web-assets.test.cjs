"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const webRoot = path.join(__dirname, "..", "web");
const read = (filename) => fs.readFileSync(path.join(webRoot, filename), "utf8");

test("overlay root is fully transparent and contains no full-screen pseudo layer", () => {
  const css = read("overlay.css");
  assert.match(css, /html,\s*\nbody[\s\S]*background:\s*transparent\s*!important/);
  assert.match(css, /#overlay-viewport[\s\S]*background:\s*transparent\s*!important/);
  assert.match(css, /#overlay-stage[\s\S]*background:\s*transparent\s*!important/);
  assert.doesNotMatch(css, /#overlay-(?:viewport|stage)::(?:before|after)/);
});

test("overlay and editor never display the obsolete Kandidat label", () => {
  for (const filename of ["overlay.html", "overlay.css", "overlay.js", "editor.html", "editor.css", "editor.js"]) {
    assert.doesNotMatch(read(filename), /Kandidat/i, filename);
  }
});

test("editor contains drag resize presets copy button and frametime controls", () => {
  const html = read("editor.html");
  const js = read("editor.js");
  assert.match(html, /OBS-Adresse kopieren/);
  assert.match(html, /data-preset="3dmark"/);
  assert.match(html, /data-preset="afterburner"/);
  assert.match(js, /pointerdown/);
  assert.match(js, /resize/);
  assert.match(js, /chartSeconds/);
  assert.match(js, /chartMaximum/);
});
