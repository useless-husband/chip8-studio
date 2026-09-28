import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, formatError } from '../src/assembler.js';
import { Chip8, QUIRK_PRESETS } from '../src/cpu.js';
import { runFrames, runFrame } from '../src/runner.js';
import { EXAMPLES } from '../src/examples.js';
import { countPixels, pixel } from './helpers.js';

const source = (ex) => readFileSync(new URL('../' + ex.file, import.meta.url), 'utf8');

function boot(id, preset = 'modern', random) {
  const ex = EXAMPLES.find((e) => e.id === id);
  const r = assemble(source(ex));
  assert.equal(r.ok, true, r.errors.map(formatError).join('\n'));
  const cpu = new Chip8({ quirks: QUIRK_PRESETS[preset], random });
  cpu.load(r.bytes);
  return { cpu, asm: r };
}

const press = (cpu, k, frames = 3) => {
  cpu.setKey(k, true);
  runFrames(cpu, frames);
  cpu.setKey(k, false);
};

test('至少有 4 個內建範例,而且檔案都存在', () => {
  assert.ok(EXAMPLES.length >= 4);
  for (const ex of EXAMPLES) assert.ok(source(ex).length > 100, ex.id);
});

for (const ex of EXAMPLES) {
  for (const preset of Object.keys(QUIRK_PRESETS)) {
    test(`範例 ${ex.id}:能組譯,在 ${preset} 相容模式跑 5 秒不當機`, () => {
      const { cpu } = boot(ex.id, preset);
      let most = 0;
      for (let f = 0; f < 300; f++) {
        const reason = runFrames(cpu, 1, 12);
        assert.notEqual(reason, 'halted', cpu.haltReason);
        most = Math.max(most, countPixels(cpu));
      }
      assert.equal(cpu.halted, false, cpu.haltReason);
      assert.ok(most > 0, '畫面應該有東西');
    });
  }
  test(`範例 ${ex.id}:沒有無用的空白行尾或 Tab 混用,且檔案以換行結尾`, () => {
    const s = source(ex);
    assert.ok(s.endsWith('\n'));
    assert.ok(!/\t/.test(s));
  });
}

test('範例不含本機路徑', () => {
  for (const ex of EXAMPLES) assert.ok(!source(ex).includes('/Users/'));
});

test('bounce:球會移動,而且一直留在螢幕內', () => {
  const { cpu, asm } = boot('bounce');
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    // 跑到迴圈開頭(球剛畫好)才取樣,避免取到「擦掉了還沒重畫」的瞬間
    for (let f = 0; f < 10 && (f === 0 || cpu.pc !== asm.labels.loop); f++) {
      runFrame(cpu, 400, { breakpoints: new Set([asm.labels.loop]), skipBreakpointOnce: f === 0 });
      cpu.tick();
    }
    assert.ok(cpu.V[0] <= 60 && cpu.V[1] <= 28, `球跑出去了 x=${cpu.V[0]} y=${cpu.V[1]}`);
    seen.add(cpu.V[0] + ',' + cpu.V[1]);
  }
  assert.ok(seen.size > 100);
  assert.equal(countPixels(cpu), 12, '球是 12 個像素,沒有殘影');
});

test('pong:電腦球拍會動、按鍵能移動左球拍、球持續在場', () => {
  const { cpu } = boot('pong');
  runFrames(cpu, 60);
  const lp0 = cpu.V[2];
  const bx0 = cpu.V[4];
  press(cpu, 0x4, 20); // Q = 往下
  assert.ok(cpu.V[2] > lp0, `左球拍應該往下 (${lp0} -> ${cpu.V[2]})`);
  const lp1 = cpu.V[2];
  press(cpu, 0x1, 40); // 1 = 往上
  assert.ok(cpu.V[2] < lp1);
  runFrames(cpu, 600);
  assert.equal(cpu.halted, false);
  assert.notEqual(cpu.V[4], bx0);
});

test('pong:球拍不會超出範圍', () => {
  const { cpu } = boot('pong');
  cpu.setKey(0x4, true);
  runFrames(cpu, 200);
  assert.equal(cpu.V[2], 24);
  cpu.setKey(0x4, false);
  cpu.setKey(0x1, true);
  runFrames(cpu, 200);
  assert.equal(cpu.V[2], 8);
});

test('pong:沒人接球時對手得分,分數增加', () => {
  const { cpu } = boot('pong');
  runFrames(cpu, 20 * 60);
  assert.ok(cpu.V[8] + cpu.V[9] >= 1, '20 秒內至少有一方得分');
});

test('snake:不按鍵會撞牆,顯示分數並等待按鍵,按鍵後重新開始', () => {
  const { cpu } = boot('snake');
  runFrames(cpu, 8 * 60);
  assert.equal(cpu.waitingForKey, true, '撞牆後應該在等按鍵');
  assert.ok(countPixels(cpu) > 0, '分數畫面應有字型');
  assert.equal(cpu.width, 64);
  press(cpu, 0x5, 3);
  runFrames(cpu, 10);
  assert.equal(cpu.waitingForKey, false, '按鍵後重新開始');
  assert.ok(cpu.V[2] >= 16 && cpu.V[2] <= 18, '蛇頭回到起點附近');
});

test('snake:W/S 鍵能轉彎', () => {
  const { cpu } = boot('snake');
  runFrames(cpu, 20);
  const y0 = cpu.V[3];
  cpu.setKey(0x8, true); // S = 往下
  runFrames(cpu, 30);
  cpu.setKey(0x8, false);
  assert.ok(cpu.V[3] > y0, '蛇往下走');
  assert.equal(cpu.V[5], 1);
  cpu.setKey(0x7, true); // A = 往左
  runFrames(cpu, 12);
  cpu.setKey(0x7, false);
  assert.equal(cpu.V[4], 0xff, '往左');
});

test('snake:不能原地迴轉(往右走時按左沒有效果)', () => {
  const { cpu } = boot('snake');
  runFrames(cpu, 6);
  cpu.setKey(0x7, true);
  runFrames(cpu, 12);
  cpu.setKey(0x7, false);
  assert.equal(cpu.V[4], 1);
  assert.equal(cpu.waitingForKey, false);
});

test('snake:吃到食物分數 +1 且蛇變長', () => {
  // 讓食物固定出現在蛇頭正前方第 3 格 (19, 8)
  let n = 0;
  const seq = [19, 8];
  const { cpu } = boot('snake', 'modern', () => seq[n++ % 2]);
  runFrames(cpu, 60);
  assert.equal(cpu.V[0xa], 1, '分數');
  assert.notEqual(cpu.V[6], cpu.V[7], '蛇尾與蛇頭位置分開了 = 長度 > 1');
});

test('keytest:16 個字型都畫出來;按鍵出現底線,放開消失', () => {
  const { cpu } = boot('keytest');
  runFrames(cpu, 30, 2000);
  const glyphs = countPixels(cpu);
  assert.ok(glyphs > 100);
  cpu.setKey(0xb, true);
  runFrames(cpu, 3, 2000);
  assert.equal(countPixels(cpu), glyphs + 4, '多出 4 個像素的底線');
  assert.equal(pixel(cpu, 36, 31), 1);
  cpu.setKey(0xb, false);
  runFrames(cpu, 3, 2000);
  assert.equal(countPixels(cpu), glyphs);
});

test('hires:進入 128x64,畫出大字型與 16x16 笑臉,鍵 5 回低解析度', () => {
  const { cpu } = boot('hires');
  runFrames(cpu, 30, 500);
  assert.equal(cpu.hires, true);
  assert.equal(cpu.width, 128);
  assert.equal(pixel(cpu, 56 + 6, 28), 1);
  const before = countPixels(cpu);
  press(cpu, 0x8, 10); // 往下捲
  assert.ok(countPixels(cpu) <= before);
  assert.equal(pixel(cpu, 56 + 6, 28), 0, '笑臉被捲走了');
  press(cpu, 0x5, 10);
  assert.equal(cpu.hires, false);
});

test('所有範例都會排在 0x200 開始且小於 1KB', () => {
  for (const ex of EXAMPLES) {
    const r = assemble(source(ex));
    assert.equal(r.origin, 0x200);
    assert.ok(r.bytes.length < 1024, `${ex.id} ${r.bytes.length}`);
  }
});

test('runFrame:中斷點會在執行前停下,skipBreakpointOnce 可以跨過', () => {
  const { cpu, asm } = boot('bounce');
  const bp = new Set([asm.labels.loop]);
  assert.equal(runFrame(cpu, 1000, { breakpoints: bp }), 'breakpoint');
  assert.equal(cpu.pc, asm.labels.loop);
  assert.equal(runFrame(cpu, 3, { breakpoints: bp, skipBreakpointOnce: true }), 'done');
  assert.notEqual(cpu.pc, asm.labels.loop);
});

test('runFrame:停機與等待按鍵的回傳值', () => {
  const c = new Chip8();
  c.load([0xf0, 0x0a]);
  assert.equal(runFrame(c, 10), 'key');
  const d = new Chip8();
  d.load([0x00, 0xfd]);
  assert.equal(runFrame(d, 10), 'halted');
});
