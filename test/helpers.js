import { Chip8 } from '../src/cpu.js';

// 建立一個乾淨的 CPU。random 固定回傳 0xFF,方便測 CXNN 的遮罩。
export function makeCpu(quirks = {}, random = () => 0xff) {
  return new Chip8({ quirks: { displayWait: false, ...quirks }, random });
}

// 把 opcode 放在目前 PC 執行一次。
export function exec(cpu, op) {
  cpu.memory[cpu.pc] = op >> 8;
  cpu.memory[cpu.pc + 1] = op & 0xff;
  return cpu.step();
}

export function pixel(cpu, x, y) {
  return cpu.display[y * cpu.width + x];
}

export function countPixels(cpu) {
  return cpu.display.reduce((a, b) => a + b, 0);
}

// 固定種子的 xorshift32 亂數，讓依賴 RND 指令的範例測試每次結果都一樣
export function seededRandom(seed = 1) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x & 0xff;
  };
}
