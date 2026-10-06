'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const koffi = require('koffi');
const {launchOwnAsAdministrator,awaitPreviousInstance,_testing} = require('../src/services/admin-restart.cjs');
const {defineWindowsTypes,nativeBindings,launchWithBindings,previousArguments,awaitWithBindings,validateOwn} = _testing;
const own = {executable:'C:\\Program Files\\Batto 3-in-1\\Batto.exe',pid:4242};
const time = {dwLowDateTime:0x12345678,dwHighDateTime:0x1dcac00};
const startTime = ((BigInt(time.dwHighDateTime)<<32n)|BigInt(time.dwLowDateTime)).toString();

function fixture({image=own.executable,created=time,openError=0,waits=[0],executeError=0,comError=0}={}){
  const calls=[], closed=[];
  let info;
  const api={
    executeSize:112,
    open:(rights,inherit,pid)=>{calls.push(['open',rights,inherit,pid]);return openError?null:101n;},
    close:handle=>{calls.push(['close',handle]);closed.push(handle);return 1;},
    image:(_handle,flags,buffer,length)=>{assert.equal(flags,0);Buffer.from(image,'utf16le').copy(buffer);length[0]=image.length;return 1;},
    times:(_handle,creation)=>{Object.assign(creation,created);return 1;},
    prepareLaunch:()=>calls.push(['prepare']),
    initializeCom:(_reserved,flags)=>{calls.push(['com',flags]);return comError;},
    uninitializeCom:()=>calls.push(['uncom']),
    execute:value=>{info={...value};calls.push(['execute']);if(executeError)return 0;value.hProcess=202n;return 1;},
    lastError:()=>executeError||openError,
    wait:(handle,milliseconds)=>{assert.equal(handle,101n);assert.equal(milliseconds,0);return waits.length>1?waits.shift():waits[0];}
  };
  return {api,calls,closed,get info(){return info;}};
}

test('Win32 FILETIME and ShellExecuteInfo definitions use the current pointer ABI without loading a DLL',()=>{
  const types=defineWindowsTypes(koffi);
  assert.equal(koffi.sizeof(types.fileTime),8);
  assert.equal(koffi.offsetof(types.fileTime,'dwHighDateTime'),4);
  const wide=koffi.sizeof('void *')===8;
  assert.equal(koffi.sizeof(types.executeInfo),wide?112:60);
  assert.equal(koffi.offsetof(types.executeInfo,'nShow'),wide?48:28);
  assert.equal(koffi.offsetof(types.executeInfo,'hInstApp'),wide?56:32);
  assert.equal(koffi.offsetof(types.executeInfo,'dwHotKey'),wide?88:48);
  assert.equal(koffi.offsetof(types.executeInfo,'hIconOrMonitor'),wide?96:52);
  assert.equal(koffi.offsetof(types.executeInfo,'hProcess'),wide?104:56);
});

test('the same ShellExecuteInfo fields calculate correctly for both x86 and x64 pointer layouts',()=>{
  for(const width of [4,8]){
    const fake={struct:members=>{
      let offset=0,maximum=1;const offsets={};
      for(const [name,type] of Object.entries(members)){
        const size=type==='void *'||type==='str16'?width:4;
        maximum=Math.max(maximum,size);offset=Math.ceil(offset/size)*size;offsets[name]=offset;offset+=size;
      }
      return {size:Math.ceil(offset/maximum)*maximum,offsets};
    }};
    const t=defineWindowsTypes(fake);
    assert.equal(t.executeInfo.size,width===8?112:60);
    assert.equal(t.executeInfo.offsets.hProcess,width===8?104:56);
    assert.equal(t.executeInfo.offsets.dwHotKey,width===8?88:48);
    assert.equal(t.fileTime.size,8);
  }
});

test('every Windows prototype compiles in real Koffi while library loads and all native calls are mocked',()=>{
  const loaded=[],functions=[];
  const ffi={...koffi,load:file=>{
    loaded.push(file);
    return {func:(...args)=>{
      const type=koffi.proto(...args);assert.ok(type);functions.push(args);
      if(args.length===1&&args[0].includes('GetSystemDirectoryW'))return (buffer)=>{const folder='C:\\Windows\\System32';Buffer.from(folder,'utf16le').copy(buffer);return folder.length;};
      return ()=>{throw Error('This ABI test never calls Windows');};
    }};
  }};
  const api=nativeBindings(ffi);api.prepareLaunch();
  assert.deepEqual(loaded,['kernel32.dll','C:\\Windows\\System32\\shell32.dll','C:\\Windows\\System32\\ole32.dll']);
  assert.equal(functions.length,10);
  assert.equal(typeof api.execute,'function');assert.equal(typeof api.initializeCom,'function');
});

test('launch prepares only the verified own executable with runas and fixed identity arguments',()=>{
  const f=fixture();
  assert.deepEqual(launchWithBindings(own,f.api,own),{accepted:true});
  assert.equal(f.info.lpVerb,'runas');assert.equal(f.info.lpFile,own.executable);
  assert.equal(f.info.lpParameters,`--batto-wait-pid=4242 --batto-wait-start=${startTime}`);
  assert.equal(f.info.lpDirectory,'C:\\Program Files\\Batto 3-in-1');
  assert.equal(f.info.cbSize,112);assert.equal(f.info.fMask,0x40|0x100|0x400);
  assert.equal(f.info.nShow,1);assert.equal(f.info.lpClass,null);
  assert.deepEqual(f.closed,[101n,202n]);
  assert.deepEqual(f.calls.filter(c=>['prepare','com','execute','uncom'].includes(c[0])),[['prepare'],['com',6],['execute'],['uncom']]);
});

test('cancelled UAC keeps the old app running and returns cancellation without accepted success',()=>{
  const f=fixture({executeError:1223});
  assert.deepEqual(launchWithBindings(own,f.api,own),{accepted:false,cancelled:true,code:'ADMIN_RESTART_CANCELLED'});
  assert.deepEqual(f.closed,[101n]);assert.equal(f.calls.at(-1)[0],'uncom');
});

test('native launch errors and COM errors are reported and never claim accepted',()=>{
  for(const options of [{executeError:5},{comError:-2147417850}]){
    const f=fixture(options);
    assert.throws(()=>launchWithBindings(own,f.api,own),error=>['ADMIN_RESTART_FAILED','ADMIN_RESTART_UNAVAILABLE'].includes(error.code));
    assert.deepEqual(f.closed,[101n]);
    if(options.comError)assert.equal(f.calls.some(call=>call[0]==='execute'||call[0]==='uncom'),false);
  }
});

test('arbitrary executables and unrelated PIDs are rejected before native launch',()=>{
  for(const patch of [{executable:'C:\\Windows\\System32\\cmd.exe'},{executable:'https://example.com/a.exe'},
    {executable:'Batto.exe'},{executable:own.executable+'\0cmd.exe'},{pid:4243},{pid:0}]){
    const f=fixture();assert.throws(()=>launchWithBindings({...own,...patch},f.api,own),{code:'ADMIN_RESTART_FORBIDDEN'});assert.deepEqual(f.calls,[]);
  }
  const wrong=fixture({image:'C:\\Other\\Batto.exe'});
  assert.throws(()=>launchWithBindings(own,wrong.api,own),{code:'ADMIN_RESTART_IDENTITY'});
  assert.equal(wrong.calls.some(call=>call[0]==='prepare'||call[0]==='execute'),false);
});

test('production launch refuses development Node without attempting a real UAC prompt',async()=>{
  await assert.rejects(launchOwnAsAdministrator(),{code:'ADMIN_RESTART_UNAVAILABLE'});
});

test('normal startup requires no native library and incomplete or duplicate wait arguments fail closed',async()=>{
  await awaitPreviousInstance(['Batto.exe']);assert.equal(previousArguments([]),null);
  const valid=[`--batto-wait-pid=4242`,`--batto-wait-start=${startTime}`];
  assert.deepEqual(previousArguments(valid),{pid:4242,startTime});
  for(const args of [[valid[0]],[valid[1]],valid.concat(valid[0]),['--batto-wait-pid=0',valid[1]],
    ['--batto-wait-pid=4294967296',valid[1]],[valid[0],'--batto-wait-start=18446744073709551616'],
    [valid[0],'--batto-wait-start=1;cmd'],['--batto-wait-pid',valid[1]]]){
    assert.throws(()=>previousArguments(args),{code:'ADMIN_RESTART_ARGUMENTS'});
  }
});

test('before-bootstrap wait stays asynchronous, holds one verified process handle and closes it after exit',async()=>{
  const f=fixture({waits:[258,258,0]});let clock=0,sleeps=0;
  await awaitWithBindings({pid:own.pid,startTime},f.api,{executable:own.executable,pid:7777,now:()=>clock,sleep:async ms=>{sleeps++;clock+=ms;}});
  assert.equal(sleeps,2);assert.deepEqual(f.closed,[101n]);
  assert.deepEqual(f.calls[0],['open',0x101000,0,4242]);
});

test('PID reuse, different files and an already-ended previous instance never wait or affect another process',async()=>{
  for(const options of [{created:{...time,dwLowDateTime:time.dwLowDateTime+1}},{image:'C:\\Another.exe'},{openError:87}]){
    const f=fixture(options);let sleeps=0;
    await awaitWithBindings({pid:own.pid,startTime},f.api,{executable:own.executable,pid:7777,sleep:async()=>sleeps++});
    assert.equal(sleeps,0);assert.deepEqual(f.closed,options.openError?[]:[101n]);
  }
});

test('an unverified process or a timeout prevents bootstrap and keeps handle cleanup bounded',async()=>{
  const denied=fixture({openError:5});
  await assert.rejects(awaitWithBindings({pid:own.pid,startTime},denied.api,{executable:own.executable,pid:7777}),{code:'ADMIN_RESTART_IDENTITY'});
  const f=fixture({waits:[258]});let clock=0;
  await assert.rejects(awaitWithBindings({pid:own.pid,startTime},f.api,{executable:own.executable,pid:7777,now:()=>clock,sleep:async ms=>{clock+=ms;},maximumWaitMs:25}),{code:'ADMIN_RESTART_TIMEOUT'});
  assert.equal(clock,25);assert.deepEqual(f.closed,[101n]);
  await assert.rejects(awaitWithBindings({pid:own.pid,startTime},fixture().api,own),{code:'ADMIN_RESTART_ARGUMENTS'});
});

test('failed Win32 wait closes the handle and reports a startup failure',async()=>{
  const f=fixture({waits:[0xffffffff]});
  await assert.rejects(awaitWithBindings({pid:own.pid,startTime},f.api,{executable:own.executable,pid:7777}),{code:'ADMIN_RESTART_WAIT_FAILED'});
  assert.deepEqual(f.closed,[101n]);
});
