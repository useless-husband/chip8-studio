import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chip8, FONT_ADDR, BIGFONT_ADDR, QUIRK_PRESETS } from '../src/cpu.js';
import { makeCpu, exec, pixel, countPixels } from './helpers.js';

test('reset:字型載入在 0x50,PC 從 0x200 開始', () => {
  const c = makeCpu();
  assert.equal(c.pc, 0x200);
  assert.equal(c.memory[FONT_ADDR], 0xf0);
  assert.equal(c.memory[FONT_ADDR + 79], 0x80);
  assert.equal(c.memory[BIGFONT_ADDR], 0x3c);
});

test('load 後 reset 會保留程式', () => {
  const c = makeCpu();
  c.load([0x12, 0x34]);
  c.memory[0x200] = 0;
  c.reset();
  assert.equal(c.memory[0x200], 0x12);
  assert.equal(c.memory[0x201], 0x34);
});

test('load 太大的程式會丟出錯誤', () => {
  assert.throws(() => makeCpu().load(new Uint8Array(4000)), RangeError);
});

test('00E0 清除畫面', () => {
  const c = makeCpu();
  c.display[5] = 1;
  exec(c, 0x00e0);
  assert.equal(countPixels(c), 0);
});

test('00EE / 2NNN 呼叫與返回', () => {
  const c = makeCpu();
  exec(c, 0x2400);
  assert.equal(c.pc, 0x400);
  assert.equal(c.sp, 1);
  assert.equal(c.stack[0], 0x202);
  exec(c, 0x00ee);
  assert.equal(c.pc, 0x202);
  assert.equal(c.sp, 0);
});

test('沒有 call 就 ret 會停機(堆疊下溢)', () => {
  const c = makeCpu();
  exec(c, 0x00ee);
  assert.equal(c.halted, true);
  assert.match(c.haltReason, /堆疊下溢/);
});

test('call 超過 16 層會停機(堆疊溢位)', () => {
  const c = makeCpu();
  for (let i = 0; i < 16; i++) exec(c, 0x2300);
  assert.equal(c.halted, false);
  exec(c, 0x2300);
  assert.equal(c.halted, true);
  assert.match(c.haltReason, /堆疊溢位/);
});

test('1NNN 跳躍', () => {
  const c = makeCpu();
  exec(c, 0x1abc);
  assert.equal(c.pc, 0xabc);
});

test('3XNN 相等時跳過', () => {
  const c = makeCpu();
  c.V[1] = 0x42;
  exec(c, 0x3142);
  assert.equal(c.pc, 0x204);
  exec(c, 0x3143 & 0xffff);
  assert.equal(c.pc, 0x206);
});

test('4XNN 不相等時跳過', () => {
  const c = makeCpu();
  c.V[1] = 0x42;
  exec(c, 0x4142);
  assert.equal(c.pc, 0x202);
  exec(c, 0x4100);
  assert.equal(c.pc, 0x206);
});

test('5XY0 暫存器相等時跳過', () => {
  const c = makeCpu();
  c.V[1] = c.V[2] = 7;
  exec(c, 0x5120);
  assert.equal(c.pc, 0x204);
  c.V[2] = 8;
  exec(c, 0x5120);
  assert.equal(c.pc, 0x206);
});

test('5XY1 這種低位元不是 0 的指令會停機', () => {
  const c = makeCpu();
  exec(c, 0x5121);
  assert.equal(c.halted, true);
});

test('6XNN 設值、7XNN 加值且溢位不影響 VF', () => {
  const c = makeCpu();
  exec(c, 0x63f0);
  assert.equal(c.V[3], 0xf0);
  c.V[0xf] = 9;
  exec(c, 0x7320);
  assert.equal(c.V[3], 0x10);
  assert.equal(c.V[0xf], 9);
});

test('8XY0 複製', () => {
  const c = makeCpu();
  c.V[2] = 9;
  exec(c, 0x8120);
  assert.equal(c.V[1], 9);
});

test('8XY1/2/3 OR AND XOR', () => {
  const c = makeCpu();
  c.V[1] = 0b1100; c.V[2] = 0b1010;
  exec(c, 0x8121);
  assert.equal(c.V[1], 0b1110);
  c.V[1] = 0b1100;
  exec(c, 0x8122);
  assert.equal(c.V[1], 0b1000);
  c.V[1] = 0b1100;
  exec(c, 0x8123);
  assert.equal(c.V[1], 0b0110);
});

test('vfReset quirk:OR/AND/XOR 把 VF 清成 0', () => {
  const c = makeCpu({ vfReset: true });
  for (const op of [0x8121, 0x8122, 0x8123]) {
    c.V[0xf] = 1;
    exec(c, op);
    assert.equal(c.V[0xf], 0, op.toString(16));
  }
  const d = makeCpu({ vfReset: false });
  d.V[0xf] = 1;
  exec(d, 0x8121);
  assert.equal(d.V[0xf], 1);
});

test('8XY4 加法無進位', () => {
  const c = makeCpu();
  c.V[1] = 200; c.V[2] = 55;
  exec(c, 0x8124);
  assert.equal(c.V[1], 255);
  assert.equal(c.V[0xf], 0);
});

test('8XY4 加法有進位', () => {
  const c = makeCpu();
  c.V[1] = 200; c.V[2] = 56;
  exec(c, 0x8124);
  assert.equal(c.V[1], 0);
  assert.equal(c.V[0xf], 1);
});

test('8XY4 X 是 VF 時,旗標蓋過結果', () => {
  const c = makeCpu();
  c.V[0xf] = 0xff; c.V[2] = 2;
  exec(c, 0x8f24);
  assert.equal(c.V[0xf], 1);
});

test('8XY5 減法沒借位 VF=1', () => {
  const c = makeCpu();
  c.V[1] = 10; c.V[2] = 3;
  exec(c, 0x8125);
  assert.equal(c.V[1], 7);
  assert.equal(c.V[0xf], 1);
});

test('8XY5 減法借位 VF=0 且結果環繞', () => {
  const c = makeCpu();
  c.V[1] = 3; c.V[2] = 10;
  exec(c, 0x8125);
  assert.equal(c.V[1], 249);
  assert.equal(c.V[0xf], 0);
});

test('8XY5 相等時沒有借位 VF=1', () => {
  const c = makeCpu();
  c.V[1] = 5; c.V[2] = 5;
  exec(c, 0x8125);
  assert.equal(c.V[1], 0);
  assert.equal(c.V[0xf], 1);
});

test('8XY7 反向減法', () => {
  const c = makeCpu();
  c.V[1] = 3; c.V[2] = 10;
  exec(c, 0x8127);
  assert.equal(c.V[1], 7);
  assert.equal(c.V[0xf], 1);
  c.V[1] = 10; c.V[2] = 3;
  exec(c, 0x8127);
  assert.equal(c.V[1], 249);
  assert.equal(c.V[0xf], 0);
});

test('8XY6 右移(VX 版):忽略 VY,VF 是被移出的位元', () => {
  const c = makeCpu({ shiftUsesVY: false });
  c.V[1] = 0b101; c.V[2] = 0xff;
  exec(c, 0x8126);
  assert.equal(c.V[1], 0b10);
  assert.equal(c.V[0xf], 1);
});

test('8XY6 右移(VY 版):用 VY 的值', () => {
  const c = makeCpu({ shiftUsesVY: true });
  c.V[1] = 0xff; c.V[2] = 0b100;
  exec(c, 0x8126);
  assert.equal(c.V[1], 0b10);
  assert.equal(c.V[0xf], 0);
});

test('8XYE 左移兩種版本與旗標', () => {
  let c = makeCpu({ shiftUsesVY: false });
  c.V[1] = 0x81;
  exec(c, 0x812e);
  assert.equal(c.V[1], 0x02);
  assert.equal(c.V[0xf], 1);
  c = makeCpu({ shiftUsesVY: true });
  c.V[1] = 0; c.V[2] = 0x40;
  exec(c, 0x812e);
  assert.equal(c.V[1], 0x80);
  assert.equal(c.V[0xf], 0);
});

test('8XY9 這種未定義的 ALU 指令會停機', () => {
  const c = makeCpu();
  exec(c, 0x8129);
  assert.equal(c.halted, true);
});

test('9XY0 不相等時跳過', () => {
  const c = makeCpu();
  c.V[1] = 1; c.V[2] = 2;
  exec(c, 0x9120);
  assert.equal(c.pc, 0x204);
  c.V[2] = 1;
  exec(c, 0x9120);
  assert.equal(c.pc, 0x206);
});

test('ANNN 設定 I', () => {
  const c = makeCpu();
  exec(c, 0xa123);
  assert.equal(c.I, 0x123);
});

test('BNNN 跳到 NNN+V0;jumpWithOffset 時用 VX', () => {
  let c = makeCpu();
  c.V[0] = 0x10; c.V[2] = 0x40;
  exec(c, 0xb220);
  assert.equal(c.pc, 0x230);
  c = makeCpu({ jumpWithOffset: true });
  c.V[0] = 0x10; c.V[2] = 0x40;
  exec(c, 0xb220);
  assert.equal(c.pc, 0x260);
});

test('BNNN 結果超過 0xFFF 會環繞', () => {
  const c = makeCpu();
  c.V[0] = 0x20;
  exec(c, 0xbff0);
  assert.equal(c.pc, 0x010);
});

test('CXNN 隨機數會被遮罩', () => {
  const c = makeCpu();
  exec(c, 0xc10f);
  assert.equal(c.V[1], 0x0f);
});

test('EX9E / EXA1 依按鍵狀態跳過', () => {
  const c = makeCpu();
  c.V[1] = 5;
  exec(c, 0xe19e);
  assert.equal(c.pc, 0x202);
  c.setKey(5, true);
  exec(c, 0xe19e);
  assert.equal(c.pc, 0x206);
  exec(c, 0xe1a1);
  assert.equal(c.pc, 0x208);
  c.setKey(5, false);
  exec(c, 0xe1a1);
  assert.equal(c.pc, 0x20c);
});

test('FX07 / FX15 / FX18 計時器', () => {
  const c = makeCpu();
  c.V[1] = 3;
  exec(c, 0xf115);
  assert.equal(c.dt, 3);
  exec(c, 0xf118);
  assert.equal(c.st, 3);
  c.tick();
  exec(c, 0xf207);
  assert.equal(c.V[2], 2);
  assert.equal(c.st, 2);
});

test('tick 不會讓計時器變成負數', () => {
  const c = makeCpu();
  c.tick(); c.tick();
  assert.equal(c.dt, 0);
  assert.equal(c.st, 0);
});

test('FX0A 等待按下並放開', () => {
  const c = makeCpu();
  exec(c, 0xf30a);
  assert.equal(c.waitingForKey, true);
  assert.equal(c.step(), false);
  c.setKey(0xa, true);
  assert.equal(c.waitingForKey, true, '只按下還不算');
  c.setKey(0xa, false);
  assert.equal(c.waitingForKey, false);
  assert.equal(c.V[3], 0xa);
  assert.equal(c.pc, 0x202);
});

test('FX1E 加到 I(不影響 VF)', () => {
  const c = makeCpu();
  c.I = 0x100; c.V[1] = 0x20; c.V[0xf] = 7;
  exec(c, 0xf11e);
  assert.equal(c.I, 0x120);
  assert.equal(c.V[0xf], 7);
});

test('FX29 指向內建字型', () => {
  const c = makeCpu();
  c.V[1] = 0xa;
  exec(c, 0xf129);
  assert.equal(c.I, FONT_ADDR + 50);
  assert.equal(c.memory[c.I], 0xf0);
  assert.equal(c.memory[c.I + 1], 0x90);
});

test('FX33 BCD 轉換', () => {
  const c = makeCpu();
  c.I = 0x300;
  for (const [v, d] of [[0, [0, 0, 0]], [7, [0, 0, 7]], [42, [0, 4, 2]], [255, [2, 5, 5]], [100, [1, 0, 0]]]) {
    c.V[1] = v;
    exec(c, 0xf133);
    assert.deepEqual([...c.memory.slice(0x300, 0x303)], d, String(v));
  }
});

test('FX55 存暫存器,I 不變(現代行為)', () => {
  const c = makeCpu({ loadStoreIncrementI: false });
  c.I = 0x300;
  c.V[0] = 1; c.V[1] = 2; c.V[2] = 3; c.V[3] = 4;
  exec(c, 0xf255);
  assert.deepEqual([...c.memory.slice(0x300, 0x304)], [1, 2, 3, 0]);
  assert.equal(c.I, 0x300);
});

test('FX65 讀暫存器,並可遞增 I(COSMAC 行為)', () => {
  const c = makeCpu({ loadStoreIncrementI: true });
  c.I = 0x300;
  c.memory.set([9, 8, 7, 6], 0x300);
  exec(c, 0xf265);
  assert.deepEqual([...c.V.slice(0, 4)], [9, 8, 7, 0]);
  assert.equal(c.I, 0x303);
});

test('FX75 / FX85 SUPER-CHIP 旗標暫存器,最多 8 個', () => {
  const c = makeCpu();
  for (let i = 0; i < 16; i++) c.V[i] = i + 1;
  exec(c, 0xf975);
  c.V.fill(0);
  exec(c, 0xf985);
  assert.deepEqual([...c.V.slice(0, 9)], [1, 2, 3, 4, 5, 6, 7, 8, 0]);
});

test('FX30 大字型', () => {
  const c = makeCpu();
  c.V[1] = 3;
  exec(c, 0xf130);
  assert.equal(c.I, BIGFONT_ADDR + 30);
});

test('未知指令(FX99、EX00)會停機並說明位址', () => {
  let c = makeCpu();
  exec(c, 0xf199);
  assert.equal(c.halted, true);
  assert.match(c.haltReason, /0x200/);
  c = makeCpu();
  exec(c, 0xe100);
  assert.equal(c.halted, true);
  assert.equal(c.pc, 0x200, '停機時 PC 停在出錯的指令');
});

test('0NNN(SYS)被忽略', () => {
  const c = makeCpu();
  exec(c, 0x0123);
  assert.equal(c.halted, false);
  assert.equal(c.pc, 0x202);
});

test('停機之後 step 不再執行', () => {
  const c = makeCpu();
  exec(c, 0x00fd);
  assert.equal(c.halted, true);
  assert.equal(c.step(), false);
});

// ---------- 繪圖 ----------

test('DXYN 畫出 sprite', () => {
  const c = makeCpu();
  c.I = 0x300;
  c.memory.set([0b10100000, 0b01010000], 0x300);
  c.V[0] = 2; c.V[1] = 3;
  exec(c, 0xd012);
  assert.deepEqual([pixel(c, 2, 3), pixel(c, 3, 3), pixel(c, 4, 3)], [1, 0, 1]);
  assert.deepEqual([pixel(c, 2, 4), pixel(c, 3, 4), pixel(c, 4, 4)], [0, 1, 0]);
  assert.equal(c.V[0xf], 0);
});

test('DXYN 重複繪製會擦除並設定碰撞旗標', () => {
  const c = makeCpu();
  c.I = 0x300;
  c.memory[0x300] = 0xff;
  exec(c, 0xd001);
  assert.equal(countPixels(c), 8);
  c.pc = 0x200;
  exec(c, 0xd001);
  assert.equal(countPixels(c), 0);
  assert.equal(c.V[0xf], 1);
});

test('DXYN 部分重疊也算碰撞', () => {
  const c = makeCpu();
  c.I = 0x300;
  c.memory[0x300] = 0b11110000;
  exec(c, 0xd011);
  c.memory[0x300] = 0b11000000;
  c.V[0] = 3;
  c.pc = 0x200;
  exec(c, 0xd011);
  assert.equal(c.V[0xf], 1);
  c.memory[0x300] = 0b00001111;
  c.V[0] = 40;
  c.pc = 0x200;
  exec(c, 0xd011);
  assert.equal(c.V[0xf], 0);
});

test('DXYN 起點座標會對螢幕大小取餘數', () => {
  const c = makeCpu();
  c.I = 0x300;
  c.memory[0x300] = 0x80;
  c.V[0] = 64 + 5; c.V[1] = 32 + 2;
  exec(c, 0xd011);
  assert.equal(pixel(c, 5, 2), 1);
});

test('DXYN clipping:超出右邊與下邊的部分被裁掉', () => {
  const c = makeCpu({ clipping: true });
  c.I = 0x300;
  c.memory.set([0xff, 0xff], 0x300);
  c.V[0] = 60; c.V[1] = 31;
  exec(c, 0xd012);
  assert.equal(countPixels(c), 4);
  assert.equal(pixel(c, 63, 31), 1);
  assert.equal(pixel(c, 0, 31), 0);
  assert.equal(pixel(c, 60, 0), 0);
});

test('DXYN wrap:超出邊界會繞到另一邊', () => {
  const c = makeCpu({ clipping: false });
  c.I = 0x300;
  c.memory.set([0xff, 0xff], 0x300);
  c.V[0] = 60; c.V[1] = 31;
  exec(c, 0xd012);
  assert.equal(countPixels(c), 16);
  assert.equal(pixel(c, 0, 31), 1);
  assert.equal(pixel(c, 3, 0), 1);
  assert.equal(pixel(c, 60, 0), 1);
});

test('DXYN 高度 0(低解析度)不畫任何東西', () => {
  const c = makeCpu();
  c.I = 0x300;
  c.memory.fill(0xff, 0x300, 0x340);
  exec(c, 0xd000);
  assert.equal(countPixels(c), 0);
});

test('display wait:同一個 frame 只能畫一次,tick 後才能再畫', () => {
  const c = new Chip8({ quirks: { displayWait: true } });
  c.I = 0x300;
  c.memory[0x300] = 0x80;
  assert.equal(exec(c, 0xd001), true);
  c.pc = 0x200;
  assert.equal(exec(c, 0xd001), false, '被擋住');
  assert.equal(c.pc, 0x200);
  c.tick();
  assert.equal(c.step(), true);
});

test('display wait 關閉時可連續繪圖', () => {
  const c = makeCpu({ displayWait: false });
  c.I = 0x300;
  c.memory[0x300] = 0x80;
  assert.equal(exec(c, 0xd001), true);
  c.pc = 0x200;
  assert.equal(exec(c, 0xd001), true);
});

// ---------- SUPER-CHIP ----------

test('00FF / 00FE 切換高低解析度', () => {
  const c = makeCpu();
  exec(c, 0x00ff);
  assert.equal(c.hires, true);
  assert.equal(c.width, 128);
  assert.equal(c.display.length, 128 * 64);
  exec(c, 0x00fe);
  assert.equal(c.width, 64);
  assert.equal(c.display.length, 64 * 32);
});

test('高解析度 DXY0 畫 16x16 sprite', () => {
  const c = makeCpu();
  exec(c, 0x00ff);
  c.I = 0x300;
  for (let r = 0; r < 16; r++) c.memory.set([0xff, 0xff], 0x300 + r * 2);
  c.V[0] = 100; c.V[1] = 10;
  exec(c, 0xd010);
  assert.equal(countPixels(c), 256);
  assert.equal(pixel(c, 100, 10), 1);
  assert.equal(pixel(c, 115, 25), 1);
});

test('00CN 往下捲動 N 行', () => {
  const c = makeCpu();
  c.display[0] = 1;
  c.display[31 * 64 + 1] = 1;
  exec(c, 0x00c3);
  assert.equal(pixel(c, 0, 3), 1);
  assert.equal(pixel(c, 0, 0), 0);
  assert.equal(countPixels(c), 1, '捲出畫面的被丟掉');
});

test('00FB / 00FC 左右捲動 4 個像素', () => {
  const c = makeCpu();
  c.display[10 * 64 + 10] = 1;
  exec(c, 0x00fb);
  assert.equal(pixel(c, 14, 10), 1);
  exec(c, 0x00fc);
  exec(c, 0x00fc);
  assert.equal(pixel(c, 6, 10), 1);
  assert.equal(countPixels(c), 1);
});

test('捲動會把邊緣捲出去的像素丟掉', () => {
  const c = makeCpu();
  c.display[5 * 64 + 62] = 1;
  exec(c, 0x00fb);
  assert.equal(countPixels(c), 0);
});

test('00FD 正常結束', () => {
  const c = makeCpu();
  exec(c, 0x00fd);
  assert.equal(c.halted, true);
  assert.match(c.haltReason, /exit/);
});

test('三組 quirks 預設值有定義', () => {
  for (const k of ['cosmac', 'modern', 'schip']) {
    assert.equal(Object.keys(QUIRK_PRESETS[k]).length, 6);
  }
});

test('setQuirks 可在執行中切換', () => {
  const c = makeCpu();
  c.setQuirks({ shiftUsesVY: true });
  assert.equal(c.quirks.shiftUsesVY, true);
});
