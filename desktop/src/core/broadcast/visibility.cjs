'use strict';

// Match only sources assigned by our outbound broadcast path, never message text.
function isAutoBroadcast(message) {
  const source = message?.raw?.meta?.sourceConnector || message?.meta?.sourceConnector || '';
  return /^(?:(?:local|cng-local)-)?(?:auto-broadcast|broadcast-manual-test|broadcast(?:-run)?:[a-zA-Z0-9_-]{1,100})$/.test(source);
}

// A run groups local/CNG copies and confirmed platform echoes without matching
// message text. A later identical broadcast remains a separate visible message.
function broadcastRun(message) {
  const source=message?.raw?.meta?.sourceConnector || message?.meta?.sourceConnector || '';
  return source.match(/^(?:(?:local|cng-local)-)?broadcast-run:([a-zA-Z0-9_-]{1,100})$/)?.[1] || '';
}

module.exports = { isAutoBroadcast, broadcastRun };
