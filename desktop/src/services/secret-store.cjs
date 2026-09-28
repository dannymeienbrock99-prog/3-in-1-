"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

class SecretStore {
  constructor(filename, safeStorage) {
    this.filename = path.resolve(filename);
    this.safeStorage = safeStorage;
    this.values = {};
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filename, "utf8"));
      this.values = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      this.values = {};
    }
    this.loaded = true;
  }

  available() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  async get(key) {
    await this.load();
    const encoded = this.values[String(key)];
    if (!encoded || !this.available()) return "";
    try {
      return this.safeStorage.decryptString(Buffer.from(encoded, "base64"));
    } catch {
      return "";
    }
  }

  async set(key, value) {
    await this.load();
    const name = String(key);
    const text = String(value || "");
    if (!text) {
      delete this.values[name];
      await this.save();
      return false;
    }
    if (!this.available()) {
      throw new Error("Windows-Verschlüsselung ist nicht verfügbar. Das Passwort wurde nicht gespeichert.");
    }
    this.values[name] = this.safeStorage.encryptString(text).toString("base64");
    await this.save();
    return true;
  }

  async delete(key) {
    await this.load();
    delete this.values[String(key)];
    await this.save();
  }

  async has(key) {
    return Boolean(await this.get(key));
  }

  async save() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.values, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.rename(temporary, this.filename);
  }
}

module.exports = {
  SecretStore
};
