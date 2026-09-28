import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY_MAP, KEYPAD_LAYOUT, KEY_HINT } from '../src/keymap.js';
import { THEMES, colorToU32, HEX_COLOR } from '../src/themes.js';

test('鍵盤對照:16 個實體鍵對應到 16 個不同的 CHIP-8 鍵', () => {
  assert.equal(Object.keys(KEY_MAP).length, 16);
  assert.deepEqual([...new Set(Object.values(KEY_MAP))].sort((a, b) => a - b), [...Array(16).keys()]);
});

test('鍵盤對照:1234/QWER/ASDF/ZXCV 的位置', () => {
  assert.equal(KEY_MAP.Digit1, 0x1);
  assert.equal(KEY_MAP.Digit4, 0xc);
  assert.equal(KEY_MAP.KeyQ, 0x4);
  assert.equal(KEY_MAP.KeyV, 0xf);
  assert.equal(KEY_MAP.KeyX, 0x0);
});

test('螢幕鍵盤排列涵蓋 0-F 各一次,而且與實體鍵盤同形狀', () => {
  assert.deepEqual([...KEYPAD_LAYOUT].sort((a, b) => a - b), [...Array(16).keys()]);
  const physical = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyZ', 'KeyX', 'KeyC', 'KeyV'];
  assert.deepEqual(physical.map((c) => KEY_MAP[c]), KEYPAD_LAYOUT);
});

test('按鈕上的提示字母', () => {
  assert.equal(KEY_HINT[0x1], '1');
  assert.equal(KEY_HINT[0xc], '4');
  assert.equal(KEY_HINT[0x5], 'W');
});

test('主題都是合法的實色,前景與背景不同', () => {
  for (const t of THEMES) {
    assert.match(t.fg, HEX_COLOR);
    assert.match(t.bg, HEX_COLOR);
    assert.notEqual(t.fg, t.bg);
  }
  assert.ok(THEMES.length >= 4);
});

test('colorToU32:ABGR 順序', () => {
  assert.equal(colorToU32('#ff0000'), 0xff0000ff);
  assert.equal(colorToU32('#00ff00'), 0xff00ff00);
  assert.equal(colorToU32('#0000ff'), 0xffff0000);
  assert.throws(() => colorToU32('red'));
});
