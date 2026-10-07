import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React, {useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';

const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const start=source.indexOf('function ConnectionDialog('),end=source.indexOf('\nfunction DevicePage(',start);
assert(start>=0&&end>start,'Production ConnectionDialog component must be available');
const transformed=await transform(source.slice(start,end),{loader:'jsx',jsx:'transform'});
const context={React,useState,Modal:({children})=>React.createElement('section',null,children)};
for(const name of ['Monitor','Download','ExternalLink','Info','Search'])context[name]=()=>React.createElement('span',{'aria-hidden':true});
vm.runInNewContext(transformed.code+'\nglobalThis.Dialog=ConnectionDialog;',context,{filename:'production-connection-dialog.jsx'});

function render(windows,busy=false){
 let windowActions=0;
 const html=renderToStaticMarkup(React.createElement(context.Dialog,{status:{native:{windows}},busy,corsair:{sdkInstalled:true},msi:{sdkInstalled:true},onShowWindow:()=>windowActions++}));
 return {html,windowActions};
}

test('integrated LampArray devices explain Batto foreground ownership without exposing an unavailable window action',()=>{
 const result=render({deviceCount:2,inProcess:true,showWindowAvailable:false,message:'Two fixture devices'});
 assert.match(result.html,/Für diese Geräte muss Batto im Vordergrund bleiben/);
 assert.match(result.html,/RGB-Steuerung ist direkt in Batto integriert/);
 assert.doesNotMatch(result.html,/RGB-Steuerfenster nach vorne holen/);
 assert.match(result.html,/Two fixture devices/);assert.equal(result.windowActions,0);
});

test('external and earlier Windows providers retain their functioning foreground-window control',()=>{
 for(const windows of [{deviceCount:2},{deviceCount:2,showWindowAvailable:true}]){
  const result=render(windows);
  assert.match(result.html,/RGB-Steuerfenster nach vorne holen/);
  assert.match(result.html,/RGB-Steuerfenster im Vordergrund bleiben/);
  assert.doesNotMatch(result.html,/direkt in Batto integriert/);assert.equal(result.windowActions,0);
 }
});

test('no-device and busy states cannot expose an actionable foreground operation',()=>{
 assert.doesNotMatch(render({deviceCount:0,showWindowAvailable:true}).html,/RGB-Steuerfenster nach vorne holen/);
 assert.match(render({deviceCount:1,showWindowAvailable:true},true).html,/<button[^>]*disabled=""[^>]*>[^<]*<span[^>]*><\/span>RGB-Steuerfenster nach vorne holen/);
 assert.doesNotMatch(render({deviceCount:1,showWindowAvailable:false},true).html,/RGB-Steuerfenster nach vorne holen/);
});
