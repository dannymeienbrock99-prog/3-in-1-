"use strict";

const { TikTokHybridAdapter, normalizeTikFinityPayload } = require("./tiktok-hybrid-adapter.cjs");
const { isOfflineError } = require("./tiktok-direct-adapter.cjs");

class TikTokAdapter extends TikTokHybridAdapter {
  constructor(options = {}) {
    super({ ...options, directOptions: options.directOptions || options });
  }
}

module.exports = {
  TikTokAdapter,
  TikTokHybridAdapter,
  normalizeTikFinityPayload,
  isOfflineError
};
