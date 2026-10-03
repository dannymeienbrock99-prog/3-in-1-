'use strict';
const {app}=require('electron');
const path=require('node:path');
// Own app identity, settings and single-instance lock; never open the original data directory.
app.setName('Batto 3-in-1');
app.setPath('userData',process.env.BATTO_OBS_DATA||path.join(app.getPath('appData'),'Batto3in1-v247'));
require('./bootstrap.cjs');
require('../src/suite-bootstrap.cjs');
require('../src/dual-stream/bootstrap.cjs');
require('../src/touch-bootstrap.cjs');
if(process.argv.includes('--suite-smoke'))require('./suite-smoke.cjs');
if(process.argv.includes('--suite-performance')&&process.env.BATTO_TEST_INSTANCE==='1')require('./suite-performance.cjs');
if(process.argv.includes('--suite-resources')&&process.env.BATTO_TEST_INSTANCE==='1')require('./suite-resources.cjs');
if(process.argv.includes('--dual-stream-test')&&process.env.BATTO_TEST_INSTANCE==='1')require('./dual-stream-test.cjs');
if(process.argv.includes('--touch-deck-test')&&process.env.BATTO_TEST_INSTANCE==='1')require('./touch-deck-test.cjs');
if(process.argv.includes('--touch-advanced-test')&&process.env.BATTO_TEST_INSTANCE==='1')require('./touch-advanced-test.cjs');
