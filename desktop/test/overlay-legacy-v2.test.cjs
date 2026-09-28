"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("stream overlay editor contains all legacy event element types", () => {
  const root = path.join(__dirname, "..", "src", "stream-overlay");
  const html = fs.readFileSync(path.join(root, "editor.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "editor.js"), "utf8");
  for (const type of ["treasure", "portal", "tiktokEvent"]) {
    assert.match(html, new RegExp(`data-add="${type}"`));
    assert.match(script, new RegExp(`${type}:`));
  }
});

test("overlay runtime accepts legacy event envelopes", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "stream-overlay", "overlay.js"), "utf8");
  assert.match(source, /tiktokevent/);
  assert.match(source, /portal/);
  assert.match(source, /treasure/);
});
