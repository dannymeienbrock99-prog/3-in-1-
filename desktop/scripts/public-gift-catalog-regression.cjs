'use strict';
const assert = require('assert/strict');
const { parsePublicCatalog } = require('../src/core/gifts/public-catalog-parser.cjs');
const row = { id:5655,name:'Rose',diamondCount:1,imageUrl:'https://example.com/rose.png' };
function script(payload) { return '<script>self.__next_f.push(' + JSON.stringify(payload).replace(/</g, '\\u003c') + ')</script>'; }
function page(rows) { return script([1, '1:I[99,[],"ignored"]\n2:'+JSON.stringify(['$', 'div',null,{children:{initialGifts:rows}}])+'\n']); }
assert.deepEqual(parsePublicCatalog(page([row]))[0], { giftId:'5655',name:'Rose',coins:1,imageUrl:'https://example.com/rose.png',source:'https://www.eulerstream.com/tools/tiktok-gifts-calculator' });
const escaped = parsePublicCatalog(page([{...row,name:'Rose "\n</script><script>throw new Error("executed")</script>'}]))[0];
assert.match(escaped.name, /<\/script>/);
const data='a:'+JSON.stringify({initialGifts:[row]})+'\n';
assert.equal(parsePublicCatalog(script([1,data.slice(0,30)])+script([1,data.slice(30)]))[0].giftId,'5655');
for (const malformed of ['', '<script>global.__catalogExecuted=true</script>',script([1,'1:{"initialGifts":['+JSON.stringify(row)]),page([]),page([row,row]),page([{...row,id:0}]),page([{...row,id:1.5}]),page([{...row,name:''}])]) assert.throws(()=>parsePublicCatalog(malformed));
assert.equal(global.__catalogExecuted,undefined);
assert.equal(parsePublicCatalog(page([{...row,imageUrl:'javascript:alert(1)'}]))[0].imageUrl,'');
assert.equal(parsePublicCatalog(page([{...row,imageUrl:'https://secret:password@example.com/gift'}]))[0].imageUrl,'');
assert.throws(()=>parsePublicCatalog('x'.repeat(5*1024*1024+1)));
console.log('PASS public gift catalogue: public-source JSON parser, split chunks, escaped text, malformed/empty/duplicate IDs, URL validation, no execution.');

