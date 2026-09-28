"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_CONFIG,
  cssVariables,
  normalizeConfig,
  normalizeStyle,
  resolveStyle,
  roleFromMessage
} = require("../src/holo-style-engine.cjs");

test("role priority matches broadcaster moderator VIP subscriber viewer", () => {
  assert.equal(roleFromMessage({ roles: { broadcaster: true, moderator: true } }), "broadcaster");
  assert.equal(roleFromMessage({ roles: { moderator: true, vip: true } }), "moderator");
  assert.equal(roleFromMessage({ roles: { vip: true, subscriber: true } }), "vip");
  assert.equal(roleFromMessage({ roles: { subscriber: true } }), "subscriber");
  assert.equal(roleFromMessage({ roles: {} }), "viewer");
});

test("per-user style overrides the role without any boost or entitlement state", () => {
  const config = normalizeConfig({
    roleStyles: {
      moderator: { colors: ["#00ff00", "#00ffff"] }
    },
    userStyles: {
      crazy_batto: { colors: ["#ff0000", "#ffd700"], glow: 30 }
    }
  });
  const resolved = resolveStyle({
    username: "Crazy_Batto",
    roles: { moderator: true }
  }, config);
  assert.equal(resolved.userKey, "crazy_batto");
  assert.deepEqual(resolved.style.colors, ["#ff0000", "#ffd700"]);
  assert.equal(resolved.style.glow, 30);
});

test("role style is used when no individual Twitch name exists", () => {
  const config = normalizeConfig({
    roleStyles: {
      vip: { colors: ["#ff00ff", "#7b2cff"] }
    }
  });
  const resolved = resolveStyle({
    username: "SomeVip",
    roles: { vip: true }
  }, config);
  assert.equal(resolved.userKey, null);
  assert.equal(resolved.role, "vip");
  assert.deepEqual(resolved.style.colors, ["#ff00ff", "#7b2cff"]);
});

test("invalid colors and unsafe values are bounded", () => {
  const style = normalizeStyle({
    colors: ["red", "#123456", "#abcdef"],
    angle: 999,
    speedSeconds: 0,
    glow: 999,
    brightness: 9,
    saturation: -4,
    fontWeight: 9000
  });
  assert.deepEqual(style.colors, ["#123456", "#abcdef"]);
  assert.equal(style.angle, 360);
  assert.equal(style.speedSeconds, 0.6);
  assert.equal(style.glow, 50);
  assert.equal(style.brightness, 2);
  assert.equal(style.saturation, 0);
  assert.equal(style.fontWeight, 1000);
});

test("CSS variables contain only normalized effect values", () => {
  const variables = cssVariables({
    colors: ["#112233", "#445566"],
    angle: 90,
    speedSeconds: 3,
    glow: 12,
    brightness: 1.1,
    saturation: 1.3,
    fontWeight: 800
  });
  assert.equal(
    variables["--batto-holo-gradient"],
    "linear-gradient(90deg, #112233, #445566)"
  );
  assert.equal(variables["--batto-holo-speed"], "3s");
  assert.equal(variables["--batto-holo-glow"], "12px");
});

test("the module does not contain a server boost requirement", () => {
  const config = normalizeConfig(DEFAULT_CONFIG);
  assert.equal(Object.prototype.hasOwnProperty.call(config, "boostRequired"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config, "discordRequired"), false);
  assert.equal(config.enabled, true);
});
