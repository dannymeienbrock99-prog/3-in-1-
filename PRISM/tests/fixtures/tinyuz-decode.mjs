import assert from 'node:assert/strict';

// Independent test decoder based on the published tinyuz decompressor format:
// https://github.com/sisong/tinyuz/blob/1d74ffa4d453796df352df470733f45dfa099bb1/decompress/tuz_dec.c
export function decodeTinyUz(code, expectedLength) {
  assert(Buffer.isBuffer(code) && code.length >= 5 && Number.isInteger(expectedLength) && expectedLength > 0 && expectedLength <= 196608);
  assert.equal(code.readUInt32LE(0), 4096);
  let cursor = 4, types = 0, typeCount = 0, haveLiteral = false, back = 1;
  const output = [];
  const byte = () => { assert(cursor < code.length, 'truncated code'); return code[cursor++]; };
  function bits(count) {
    let result = 0;
    for (let bit = 0; bit < count; bit++) {
      if (typeCount === 0) { types = byte(); typeCount = 8; }
      result |= (types & 1) << bit; types >>>= 1; typeCount--;
    }
    return result;
  }
  function length(packBits) {
    let value = 0;
    for (let limit = 0; limit < 24; limit++) {
      const group = bits(packBits + 1);
      value = value * (1 << packBits) + (group & ((1 << packBits) - 1));
      if (!(group & (1 << packBits))) return value;
      value++;
    }
    throw Error('length overflow');
  }
  for (let safety = 0; safety <= expectedLength + 1; safety++) {
    if (bits(1) === 1) { output.push(byte()); haveLiteral = true; }
    else {
      let savedLength = length(1), distance;
      if (haveLiteral && bits(1)) distance = back;
      else {
        distance = byte();
        if (distance >= 128) distance = (distance & 127) + length(2) * 128 + 128;
        if (distance > 2687) savedLength++;
      }
      haveLiteral = false;
      if (distance) {
        assert(distance <= 4096 && distance <= output.length);
        const count = savedLength + 2; back = distance;
        assert(output.length + count <= expectedLength);
        for (let i = 0; i < count; i++) output.push(output[output.length - distance]);
      } else if (savedLength === 1) {
        const count = length(2) + 15;
        for (let i = 0; i < count; i++) output.push(byte());
        haveLiteral = true;
      } else {
        back = 1; typeCount = 0;
        if (savedLength === 3) { assert.equal(output.length, expectedLength); return Buffer.from(output); }
        assert.equal(savedLength, 2);
      }
    }
    assert(output.length <= expectedLength);
  }
  throw Error('missing terminator');
}
