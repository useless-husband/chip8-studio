// 電腦鍵盤 <-> CHIP-8 十六進位鍵盤對照。用 event.code,不受輸入法與鍵盤排列影響。
//   1 2 3 4        1 2 3 C
//   Q W E R   ->   4 5 6 D
//   A S D F        7 8 9 E
//   Z X C V        A 0 B F
export const KEY_MAP = {
  Digit1: 0x1, Digit2: 0x2, Digit3: 0x3, Digit4: 0xc,
  KeyQ: 0x4, KeyW: 0x5, KeyE: 0x6, KeyR: 0xd,
  KeyA: 0x7, KeyS: 0x8, KeyD: 0x9, KeyF: 0xe,
  KeyZ: 0xa, KeyX: 0x0, KeyC: 0xb, KeyV: 0xf,
};

// 螢幕上 4x4 鍵盤的排列(由左到右、由上到下)
export const KEYPAD_LAYOUT = [0x1, 0x2, 0x3, 0xc, 0x4, 0x5, 0x6, 0xd, 0x7, 0x8, 0x9, 0xe, 0xa, 0x0, 0xb, 0xf];

// CHIP-8 鍵 -> 對應的電腦鍵盤字母(顯示在按鈕上)
export const KEY_HINT = Object.fromEntries(
  Object.entries(KEY_MAP).map(([code, k]) => [k, code.replace(/^(Key|Digit)/, '')]),
);
