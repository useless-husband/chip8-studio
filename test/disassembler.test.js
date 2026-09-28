import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/assembler.js';
import { disasm, disassemble, disassembleToSource } from '../src/disassembler.js';

test('常見指令的反組譯文字', () => {
  const cases = {
    0x00e0: 'cls', 0x00ee: 'ret', 0x1234: 'jp 0x234', 0x2abc: 'call 0xABC', 0x312a: 'se v1, 0x2A',
    0x8124: 'add v1, v2', 0xa300: 'ld i, 0x300', 0xb200: 'jp v0, 0x200', 0xd125: 'drw v1, v2, 5',
    0xe19e: 'skp v1', 0xf00a: 'ld v0, k', 0xf155: 'ld [i], v1', 0xf265: 'ld v2, [i]', 0xf01e: 'add i, v0',
    0x00ff: 'high', 0x00c4: 'scd 4', 0xfa30: 'ld hf, va',
  };
  for (const [op, text] of Object.entries(cases)) assert.equal(disasm(Number(op)), text);
});

test('無法辨識的指令輸出成 .dw', () => {
  assert.equal(disasm(0x5121), '.dw 0x5121');
  assert.equal(disasm(0xe100), '.dw 0xE100');
  assert.equal(disasm(0xf999), '.dw 0xF999');
  assert.equal(disasm(0xf975), '.dw 0xF975');
});

test('全部 65536 種指令:反組譯後再組譯,得到同一個 opcode', () => {
  let bad = 0;
  for (let op = 0; op < 0x10000; op++) {
    const r = assemble(disasm(op));
    if (!r.ok || ((r.bytes[0] << 8) | r.bytes[1]) !== op) bad++;
  }
  assert.equal(bad, 0);
});

test('disassemble:位址與奇數長度', () => {
  const rows = disassemble(new Uint8Array([0x00, 0xe0, 0xa2, 0x50, 0x7f]), 0x200);
  assert.deepEqual(rows.map((r) => [r.addr, r.text]), [[0x200, 'cls'], [0x202, 'ld i, 0x250'], [0x204, '.db 0x7F']]);
});

test('組譯 -> 反組譯來回:整個程式位元組一致', () => {
  const src = 'start: ld v0, 5\n loop: add v0, -1\n se v0, 0\n jp loop\n drw v1, v2, 3\n ld [i], v3\n ld b, v0\n .dw 0xFFFF\n';
  const a = assemble(src);
  assert.equal(a.ok, true);
  const text = disassembleToSource(a.bytes);
  const b = assemble(text);
  assert.equal(b.ok, true, JSON.stringify(b.errors));
  assert.deepEqual([...b.bytes], [...a.bytes]);
});

test('隨機位元組經 disassembleToSource 再組譯,位元組完全相同', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) & 0xff;
  const bytes = Uint8Array.from({ length: 401 }, rnd);
  const r = assemble(disassembleToSource(bytes));
  assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 2)));
  assert.deepEqual([...r.bytes], [...bytes]);
});
