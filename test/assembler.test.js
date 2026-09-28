import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, formatError } from '../src/assembler.js';

const ok = (src) => {
  const r = assemble(src);
  assert.equal(r.ok, true, r.errors.map(formatError).join('\n'));
  return [...r.bytes];
};
const err = (src) => {
  const r = assemble(src);
  assert.equal(r.ok, false, '應該要組譯失敗');
  assert.equal(r.bytes, null);
  return r.errors;
};

test('基本指令編碼', () => {
  assert.deepEqual(ok('cls\nret\nld v1, 0x2A\nld i, 0x300\njp 0x234\ncall 0x456'),
    [0x00, 0xe0, 0x00, 0xee, 0x61, 0x2a, 0xa3, 0x00, 0x12, 0x34, 0x24, 0x56]);
});

test('暫存器對暫存器的運算', () => {
  assert.deepEqual(ok('ld v1, v2\nor v1, v2\nand v1, v2\nxor v1, v2\nadd v1, v2\nsub v1, v2\nsubn v1, v2\nshr v1, v2\nshl v1, v2'),
    [0x81, 0x20, 0x81, 0x21, 0x81, 0x22, 0x81, 0x23, 0x81, 0x24, 0x81, 0x25, 0x81, 0x27, 0x81, 0x26, 0x81, 0x2e]);
});

test('shr / shl 只寫一個運算元時 Y=X', () => {
  assert.deepEqual(ok('shr v3\nshl vA'), [0x83, 0x36, 0x8a, 0xae]);
});

test('大小寫不分:指令與暫存器', () => {
  assert.deepEqual(ok('LD V0, 0xFF\nCLS\nDrw VA, Vb, 5'), [0x60, 0xff, 0x00, 0xe0, 0xda, 0xb5]);
});

test('skip 與 draw 指令', () => {
  assert.deepEqual(ok('se v1, 5\nsne v2, v3\nse v4, v5\nskp v6\nsknp v7\ndrw v0, v1, 0\nrnd v2, 0x0F'),
    [0x31, 0x05, 0x92, 0x30, 0x54, 0x50, 0xe6, 0x9e, 0xe7, 0xa1, 0xd0, 0x10, 0xc2, 0x0f]);
});

test('特殊暫存器的 ld 形式', () => {
  assert.deepEqual(ok('ld v1, dt\nld v2, k\nld dt, v3\nld st, v4\nld f, v5\nld hf, v6\nld b, v7\nld [i], v8\nld v9, [i]\nld r, v2\nld v3, r\nadd i, va'),
    [0xf1, 0x07, 0xf2, 0x0a, 0xf3, 0x15, 0xf4, 0x18, 0xf5, 0x29, 0xf6, 0x30, 0xf7, 0x33, 0xf8, 0x55, 0xf9, 0x65, 0xf2, 0x75, 0xf3, 0x85, 0xfa, 0x1e]);
});

test('SUPER-CHIP 指令', () => {
  assert.deepEqual(ok('high\nlow\nscr\nscl\nscd 5\nexit'), [0x00, 0xff, 0x00, 0xfe, 0x00, 0xfb, 0x00, 0xfc, 0x00, 0xc5, 0x00, 0xfd]);
});

test('jp v0, 位址 與 sys', () => {
  assert.deepEqual(ok('jp v0, 0x300\nsys 0x123'), [0xb3, 0x00, 0x01, 0x23]);
});

test('add 負數會轉成補數', () => {
  assert.deepEqual(ok('add v1, -1\nld v2, -2'), [0x71, 0xff, 0x62, 0xfe]);
});

test('數字格式:十進位、十六進位、二進位、字元', () => {
  assert.deepEqual(ok('.db 10, 0x10, $10, 0b101, %101, \'A\''), [10, 16, 16, 5, 5, 65]);
});

test('運算式:四則、位元、位移、括號', () => {
  assert.deepEqual(ok('.db 1+2*3, (1+2)*3, 0xF0 >> 4, 1 << 3, 0xFF & 0x0F, 8 | 1, 7 ^ 2, 20/3, -1+2'),
    [7, 9, 0x0f, 8, 0x0f, 9, 5, 6, 1]);
});

test('標籤(含前向參照)與位址', () => {
  const r = assemble('start:\n  jp end\n  cls\nend: ret');
  assert.equal(r.ok, true);
  assert.deepEqual(r.labels, { start: 0x200, end: 0x204 });
  assert.deepEqual([...r.bytes], [0x12, 0x04, 0x00, 0xe0, 0x00, 0xee]);
});

test('標籤可以和指令同一行,也可以連續多個', () => {
  const r = assemble('one: two: cls\nthree: ret');
  assert.deepEqual(r.labels, { one: 0x200, two: 0x200, three: 0x202 });
});

test('.equ 常數,兩種寫法', () => {
  assert.deepEqual(ok('.equ SPEED, 5\n.equ MASK 0x0F\nld v0, SPEED\nld v1, MASK+1'), [0x60, 5, 0x61, 0x10]);
});

test('.reg 暫存器別名', () => {
  assert.deepEqual(ok('.reg x v3\n.reg y, v4\nld x, 1\nadd x, y\ndrw x, y, 2'), [0x63, 0x01, 0x83, 0x44, 0xd3, 0x42]);
});

test('.db / .dw / .ascii / 字串', () => {
  assert.deepEqual(ok('.db 1, 2, "AB"\n.dw 0x1234, 0xBEEF\n.ascii "hi"'), [1, 2, 65, 66, 0x12, 0x34, 0xbe, 0xef, 104, 105]);
});

test('不加點的 db / dw 也可以', () => {
  assert.deepEqual(ok('db 1, 2\ndw 0x0102'), [1, 2, 1, 2]);
});

test('.px 像素圖案:8 格以內是 1 位元組,9 到 16 格是 2 位元組', () => {
  assert.deepEqual(ok('.px "#..#..#."\n.px "##"\n.px "################"\n.px "#.......#"'),
    [0b10010010, 0b11000000, 0xff, 0xff, 0x80, 0x80]);
});

test('.px 也可以用 X 與空白字元', () => {
  assert.deepEqual(ok('.px "X X X X "'), [0b10101010]);
});

test('.ds 保留空間、.org 補到指定位址', () => {
  const r = assemble('.ds 3\nx: cls\n.org 0x210\ny: ret');
  assert.equal(r.labels.x, 0x203);
  assert.equal(r.labels.y, 0x210);
  assert.equal(r.bytes.length, 0x212 - 0x200);
  assert.equal(r.bytes[0x10], 0x00);
  assert.equal(r.bytes[0x11], 0xee);
});

test('註解:分號後面被忽略,字串裡的分號不算', () => {
  assert.deepEqual(ok('; 整行註解\ncls ; 尾巴\n.ascii ";"'), [0x00, 0xe0, 0x3b]);
});

test('接受 CRLF 換行', () => {
  assert.deepEqual(ok('cls\r\nret\r\n'), [0, 0xe0, 0, 0xee]);
});

test('lines 對照表:行號對應位址', () => {
  const r = assemble('; c\ncls\n\nret');
  assert.deepEqual(r.lines, [{ line: 2, addr: 0x200, size: 2 }, { line: 4, addr: 0x202, size: 2 }]);
});

test('空原始碼組譯出空程式', () => {
  const r = assemble('');
  assert.equal(r.ok, true);
  assert.equal(r.bytes.length, 0);
});

// ---------- 錯誤訊息 ----------

test('錯誤:不認得的指令,帶行號', () => {
  const e = err('cls\nfoo v1');
  assert.equal(e[0].line, 2);
  assert.match(e[0].message, /不認得的指令「foo」/);
});

test('錯誤:數值超出範圍', () => {
  const e = err('ld v0, 300');
  assert.match(e[0].message, /放不進 1 個位元組/);
});

test('錯誤:位址超出範圍', () => {
  assert.match(err('jp 0x1000')[0].message, /位址.*超出範圍/);
  assert.match(err('ld i, -1')[0].message, /超出範圍/);
});

test('錯誤:未定義的符號', () => {
  const e = err('cls\njp nowhere');
  assert.equal(e[0].line, 2);
  assert.match(e[0].message, /未定義的符號「nowhere」/);
});

test('錯誤:運算元數量不對', () => {
  assert.match(err('ld v1')[0].message, /需要 2 個運算元,但寫了 1 個/);
  assert.match(err('cls v1')[0].message, /不需要運算元/);
  assert.match(err('drw v1, v2')[0].message, /需要 3 個運算元/);
});

test('錯誤:ld 的組合不支援', () => {
  assert.match(err('ld dt, st')[0].message, /不支援這種組合/);
  assert.match(err('ld i, v1')[0].message, /不支援這種組合/);
});

test('錯誤:暫存器名稱不合法會被當成未定義符號', () => {
  assert.match(err('ld v10, 1')[0].message, /未定義的符號「v10」/);
});

test('錯誤:標籤重複定義,並指出先前的行號', () => {
  const e = err('aa: cls\nbb: cls\naa: ret');
  assert.equal(e[0].line, 3);
  assert.match(e[0].message, /重複定義.*第 1 行/);
});

test('錯誤:不能用暫存器或指令名稱當標籤', () => {
  assert.match(err('v1: cls')[0].message, /保留的暫存器名稱/);
  assert.match(err('ld: cls')[0].message, /指令名稱/);
});

test('錯誤:drw 高度超過 15', () => {
  assert.match(err('drw v0, v1, 16')[0].message, /必須在 0 到 15 之間/);
});

test('錯誤:jp 偏移必須是 v0', () => {
  assert.match(err('jp v1, 0x300')[0].message, /必須是 v0/);
});

test('錯誤:ld r 只能 v0-v7', () => {
  assert.match(err('ld r, v8')[0].message, /0 到 7/);
});

test('錯誤:字串沒有結尾引號', () => {
  assert.match(err('.ascii "abc')[0].message, /結尾的引號/);
});

test('錯誤:.px 圖案含非法字元、過長', () => {
  assert.match(err('.px "#a#"')[0].message, /只能用/);
  assert.match(err('.px "#################"')[0].message, /1 到 16 個字元/);
  assert.match(err('.px #..#')[0].message, /雙引號/);
});

test('錯誤:運算式括號不對稱、除以 0、看不懂的字元', () => {
  assert.match(err('ld v0, (1+2')[0].message, /括號/);
  assert.match(err('ld v0, 1/0')[0].message, /除數/);
  assert.match(err('ld v0, 1 @ 2')[0].message, /看不懂的字元/);
});

test('錯誤:.org 往回跳', () => {
  assert.match(err('.org 0x210\ncls\n.org 0x204')[0].message, /往回跳/);
  assert.match(err('.org 0x100')[0].message, /之間/);
});

test('錯誤:程式太大', () => {
  const e = err('.ds 4000');
  assert.match(e[0].message, /程式太大/);
});

test('一次回報多個錯誤,依行號排序', () => {
  const e = err('foo\ncls\nbar\nld v1, 999');
  assert.deepEqual(e.map((x) => x.line), [1, 3, 4]);
});

test('formatError 格式', () => {
  assert.equal(formatError({ line: 7, message: 'x' }), '第 7 行:x');
});
