import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMsiDll, installMsiSdk, msiSetupStatus } from '../server/msi-setup.mjs';

test('MSI download requires explicit opt-in before any network or file writes', async () => {
  for (const value of [undefined, {}, { acceptDownload: 'true' }, { acceptLicense: true }]) {
    await assert.rejects(installMsiSdk(value), { code: 'MSI_DOWNLOAD_CONSENT_REQUIRED' });
  }
});
test('MSI rejects unpinned and malformed archives', () => {
  for (const value of [null, Buffer.alloc(0), Buffer.alloc(22), Buffer.alloc(4 * 1024 * 1024 + 1)]) {
    assert.throws(() => extractMsiDll(value), { code: 'MSI_DOWNLOAD_INVALID' });
  }
});
test('MSI setup reports the official required application and source', async () => {
  const value = await msiSetupStatus();
  assert.equal(value.needsMysticLight, true);
  assert.equal(value.downloadUrl, 'https://download.msi.com/uti_exe/Mystic_light_SDK.zip');
  assert.equal(typeof value.sdkInstalled, 'boolean');
});
