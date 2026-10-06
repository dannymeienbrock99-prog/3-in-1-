import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = process.env.PRISM_LIANLI_FIXTURE_HELPER || fileURLToPath(new URL('../native-lianli/bin/PRISM-LianLi.exe', import.meta.url));
test('optional native service guard validates fixed identities and restores initial states using fake services only', {
  skip: process.platform !== 'win32' || !existsSync(helper),
}, () => {
  const run = spawnSync(helper, ['--wireless-handoff-fixtures'], { encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536 });
  assert.equal(run.status,0,run.stderr);
  const fixture = JSON.parse(run.stdout);
  assert.equal(fixture.hardwarePackets,0);
  assert.equal(fixture.realServiceControls,0);
  assert.equal(fixture.passed,20);
  assert.deepEqual(fixture.checks, ['pipeAllowlist','tokenExact','boundedPipeMessage','oversizedPipeRejected','workerIdleExpiry','workerActiveExpiry','workerOwnerExit','fixedServiceImage','otherServiceRejected','otherAccountRejected',
    'argumentsRejected','otherImageRejected','unquotedRejected','pauseOrder','restoreOrder','initiallyStoppedPreserved',
    'watcherFailureRestores','serviceFailureRestoresBoth','validateAllBeforeMutation','restoreFailureTruthful']);
});
