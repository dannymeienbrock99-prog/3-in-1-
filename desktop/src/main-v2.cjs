"use strict";

const testMode = process.argv.includes("--self-test") || process.argv.includes("--ui-smoke-test");

require("./main.cjs");
if (process.argv.includes('--suite-smoke') && !process.argv.includes('--suite-full-smoke')) require('./suite-bootstrap.cjs');

if (!testMode || process.argv.includes('--suite-full-smoke')) {
  require("./stream-overlay-bootstrap.cjs");
  require("./deck-bootstrap.cjs");
  require("./deck-creatorhub-bootstrap.cjs");
  require("./chat-bootstrap.cjs");
  require("./mobile-bootstrap.cjs");
  require("./suite-bootstrap.cjs");
}
