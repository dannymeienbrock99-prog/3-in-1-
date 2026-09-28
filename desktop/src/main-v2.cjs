"use strict";

const testMode = process.argv.includes("--self-test") || process.argv.includes("--ui-smoke-test");

require("./main.cjs");
if (process.argv.includes('--suite-smoke')) require('./suite-bootstrap.cjs');

if (!testMode) {
  require("./stream-overlay-bootstrap.cjs");
  require("./deck-bootstrap.cjs");
  require("./deck-creatorhub-bootstrap.cjs");
  require("./chat-bootstrap.cjs");
  require("./mobile-bootstrap.cjs");
  require("./suite-bootstrap.cjs");
}
