// CHIP-8 / SUPER-CHIP 模擬器核心。不依賴瀏覽器,可在 Node 直接測試。

export const MEM_SIZE = 4096;
export const PROGRAM_START = 0x200;
export const FONT_ADDR = 0x50;
export const BIGFONT_ADDR = 0xa0;

export const FONT = [
  0xf0, 0x90, 0x90, 0x90, 0xf0, 0x20, 0x60, 0x20, 0x20, 0x70, 0xf0, 0x10, 0xf0, 0x80, 0xf0, 0xf0,
  0x10, 0xf0, 0x10, 0xf0, 0x90, 0x90, 0xf0, 0x10, 0x10, 0xf0, 0x80, 0xf0, 0x10, 0xf0, 0xf0, 0x80,
  0xf0, 0x90, 0xf0, 0xf0, 0x10, 0x20, 0x40, 0x40, 0xf0, 0x90, 0xf0, 0x90, 0xf0, 0xf0, 0x90, 0xf0,
  0x10, 0xf0, 0xf0, 0x90, 0xf0, 0x90, 0x90, 0xe0, 0x90, 0xe0, 0x90, 0xe0, 0xf0, 0x80, 0x80, 0x80,
  0xf0, 0xe0, 0x90, 0x90, 0x90, 0xe0, 0xf0, 0x80, 0xf0, 0x80, 0xf0, 0xf0, 0x80, 0xf0, 0x80, 0x80,
];

// SUPER-CHIP 8x10 大字型(只有 0-9)
export const BIGFONT = [
  0x3c, 0x7e, 0xe7, 0xc3, 0xc3, 0xc3, 0xc3, 0xe7, 0x7e, 0x3c,
  0x18, 0x38, 0x58, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x7e,
  0x3e, 0x7f, 0xc3, 0x06, 0x0c, 0x18, 0x30, 0x60, 0xff, 0xff,
  0x3c, 0x7e, 0xc3, 0x03, 0x0e, 0x0e, 0x03, 0xc3, 0x7e, 0x3c,
  0x06, 0x0e, 0x1e, 0x36, 0x66, 0xc6, 0xff, 0xff, 0x06, 0x06,
  0xff, 0xff, 0xc0, 0xc0, 0xfc, 0xfe, 0x03, 0xc3, 0x7e, 0x3c,
  0x3e, 0x7c, 0xc0, 0xc0, 0xfc, 0xfe, 0xc3, 0xc3, 0x7e, 0x3c,
  0xff, 0xff, 0x03, 0x06, 0x0c, 0x18, 0x30, 0x60, 0x60, 0x60,
  0x3c, 0x7e, 0xc3, 0xc3, 0x7e, 0x7e, 0xc3, 0xc3, 0x7e, 0x3c,
  0x3c, 0x7e, 0xc3, 0xc3, 0x7f, 0x3f, 0x03, 0x03, 0x3e, 0x7c,
];

export const QUIRK_KEYS = [
  'shiftUsesVY',
  'loadStoreIncrementI',
  'jumpWithOffset',
  'vfReset',
  'displayWait',
  'clipping',
];

export const QUIRK_PRESETS = {
  // 1977 年 COSMAC VIP 的原始行為
  cosmac: {
    shiftUsesVY: true,
    loadStoreIncrementI: true,
    jumpWithOffset: false,
    vfReset: true,
    displayWait: true,
    clipping: true,
  },
  // 多數現代 ROM 與 Octo 預設的行為
  modern: {
    shiftUsesVY: false,
    loadStoreIncrementI: false,
    jumpWithOffset: false,
    vfReset: false,
    displayWait: true,
    clipping: true,
  },
  // SUPER-CHIP 1.1 的行為
  schip: {
    shiftUsesVY: false,
    loadStoreIncrementI: false,
    jumpWithOffset: true,
    vfReset: false,
    displayWait: false,
    clipping: true,
  },
};

export class Chip8 {
  constructor(opts = {}) {
    this.quirks = { ...QUIRK_PRESETS.modern, ...(opts.quirks || {}) };
    this.rom = null;
    this.rpl = new Uint8Array(8);
    this.random = opts.random || (() => Math.floor(Math.random() * 256));
    this.reset();
  }

  reset() {
    this.memory = new Uint8Array(MEM_SIZE);
    this.memory.set(FONT, FONT_ADDR);
    this.memory.set(BIGFONT, BIGFONT_ADDR);
    this.V = new Uint8Array(16);
    this.I = 0;
    this.pc = PROGRAM_START;
    this.sp = 0;
    this.stack = new Uint16Array(16);
    this.dt = 0;
    this.st = 0;
    this.keys = new Array(16).fill(false);
    this.keyWait = null;
    this.hires = false;
    this.width = 64;
    this.height = 32;
    this.display = new Uint8Array(this.width * this.height);
    this.halted = false;
    this.haltReason = '';
    this.vblank = true;
    this.cycles = 0;
    this.dirty = true;
    if (this.rom) this.memory.set(this.rom, PROGRAM_START);
  }

  load(bytes, addr = PROGRAM_START) {
    if (addr + bytes.length > MEM_SIZE) throw new RangeError('程式太大,放不進 4096 位元組的記憶體');
    this.rom = Uint8Array.from(bytes);
    this.reset();
    if (addr !== PROGRAM_START) {
      this.memory.set(this.rom, addr);
      this.pc = addr;
    }
  }

  setQuirks(q) {
    Object.assign(this.quirks, q);
  }

  setKey(k, down) {
    k &= 0xf;
    this.keys[k] = !!down;
    // FX0A:按下再放開才算一次輸入
    if (this.keyWait) {
      if (down && this.keyWait.key < 0) this.keyWait.key = k;
      else if (!down && this.keyWait.key === k) {
        this.V[this.keyWait.reg] = k;
        this.keyWait = null;
      }
    }
  }

  // 60Hz 計時器。畫面更新時機也在這裡。
  tick() {
    if (this.dt > 0) this.dt--;
    if (this.st > 0) this.st--;
    this.vblank = true;
  }

  halt(reason) {
    this.halted = true;
    this.haltReason = reason;
  }

  get waitingForKey() {
    return !!this.keyWait;
  }

  fetch(addr = this.pc) {
    return (this.memory[addr & 0xfff] << 8) | this.memory[(addr + 1) & 0xfff];
  }

  // 執行一個指令。回傳 true 表示真的執行了;
  // 停機、等待按鍵、等待垂直空白(display wait)時回傳 false。
  step() {
    if (this.halted || this.keyWait) return false;
    const pc = this.pc;
    const op = this.fetch(pc);
    const hi = op >> 12;
    const x = (op >> 8) & 0xf;
    const y = (op >> 4) & 0xf;
    const n = op & 0xf;
    const nn = op & 0xff;
    const nnn = op & 0xfff;
    const V = this.V;
    const q = this.quirks;

    if (hi === 0xd && q.displayWait && !this.vblank) return false;
    this.pc = (pc + 2) & 0xfff;
    this.cycles++;

    switch (hi) {
      case 0x0:
        if ((op & 0xfff0) === 0x00c0) this.scrollDown(n);
        else if (op === 0x00e0) {
          this.display.fill(0);
          this.dirty = true;
        } else if (op === 0x00ee) {
          if (this.sp === 0) return this.fault('堆疊下溢:在沒有 call 的情況下執行 ret', pc, op);
          this.pc = this.stack[--this.sp];
        } else if (op === 0x00fb) this.scrollRight();
        else if (op === 0x00fc) this.scrollLeft();
        else if (op === 0x00fd) this.halt('程式呼叫 exit(00FD)正常結束');
        else if (op === 0x00fe) this.setMode(false);
        else if (op === 0x00ff) this.setMode(true);
        // 其他 0NNN 是 SYS 呼叫,現代模擬器一律忽略
        break;
      case 0x1:
        this.pc = nnn;
        break;
      case 0x2:
        if (this.sp >= 16) return this.fault('堆疊溢位:call 巢狀超過 16 層', pc, op);
        this.stack[this.sp++] = this.pc;
        this.pc = nnn;
        break;
      case 0x3:
        if (V[x] === nn) this.skip();
        break;
      case 0x4:
        if (V[x] !== nn) this.skip();
        break;
      case 0x5:
        if (n !== 0) return this.fault('不合法的指令', pc, op);
        if (V[x] === V[y]) this.skip();
        break;
      case 0x6:
        V[x] = nn;
        break;
      case 0x7:
        V[x] = (V[x] + nn) & 0xff;
        break;
      case 0x8:
        if (!this.alu(n, x, y)) return this.fault('不合法的指令', pc, op);
        break;
      case 0x9:
        if (n !== 0) return this.fault('不合法的指令', pc, op);
        if (V[x] !== V[y]) this.skip();
        break;
      case 0xa:
        this.I = nnn;
        break;
      case 0xb:
        this.pc = (nnn + (q.jumpWithOffset ? V[x] : V[0])) & 0xfff;
        break;
      case 0xc:
        V[x] = this.random() & nn;
        break;
      case 0xd:
        this.draw(V[x], V[y], n);
        break;
      case 0xe:
        if (nn === 0x9e) {
          if (this.keys[V[x] & 0xf]) this.skip();
        } else if (nn === 0xa1) {
          if (!this.keys[V[x] & 0xf]) this.skip();
        } else return this.fault('不合法的指令', pc, op);
        break;
      case 0xf:
        if (!this.misc(nn, x)) return this.fault('不合法的指令', pc, op);
        break;
    }
    return true;
  }

  fault(msg, pc, op) {
    const hex = (v, w) => v.toString(16).toUpperCase().padStart(w, '0');
    this.pc = pc;
    this.cycles--;
    this.halt(`${msg}(位址 0x${hex(pc, 3)},指令 0x${hex(op, 4)})`);
    return false;
  }

  skip() {
    this.pc = (this.pc + 2) & 0xfff;
  }

  alu(n, x, y) {
    const V = this.V;
    const q = this.quirks;
    switch (n) {
      case 0x0:
        V[x] = V[y];
        break;
      case 0x1:
        V[x] |= V[y];
        if (q.vfReset) V[0xf] = 0;
        break;
      case 0x2:
        V[x] &= V[y];
        if (q.vfReset) V[0xf] = 0;
        break;
      case 0x3:
        V[x] ^= V[y];
        if (q.vfReset) V[0xf] = 0;
        break;
      case 0x4: {
        const sum = V[x] + V[y];
        V[x] = sum & 0xff;
        V[0xf] = sum > 0xff ? 1 : 0;
        break;
      }
      case 0x5: {
        const flag = V[x] >= V[y] ? 1 : 0;
        V[x] = (V[x] - V[y]) & 0xff;
        V[0xf] = flag;
        break;
      }
      case 0x6: {
        const src = q.shiftUsesVY ? V[y] : V[x];
        V[x] = src >> 1;
        V[0xf] = src & 1;
        break;
      }
      case 0x7: {
        const flag = V[y] >= V[x] ? 1 : 0;
        V[x] = (V[y] - V[x]) & 0xff;
        V[0xf] = flag;
        break;
      }
      case 0xe: {
        const src = q.shiftUsesVY ? V[y] : V[x];
        V[x] = (src << 1) & 0xff;
        V[0xf] = src >> 7;
        break;
      }
      default:
        return false;
    }
    return true;
  }

  misc(nn, x) {
    const V = this.V;
    const mem = this.memory;
    switch (nn) {
      case 0x07:
        V[x] = this.dt;
        break;
      case 0x0a:
        this.keyWait = { reg: x, key: -1 };
        break;
      case 0x15:
        this.dt = V[x];
        break;
      case 0x18:
        this.st = V[x];
        break;
      case 0x1e:
        this.I = (this.I + V[x]) & 0xfff;
        break;
      case 0x29:
        this.I = FONT_ADDR + (V[x] & 0xf) * 5;
        break;
      case 0x30:
        this.I = BIGFONT_ADDR + (V[x] % 10) * 10;
        break;
      case 0x33: {
        const v = V[x];
        mem[this.I & 0xfff] = Math.floor(v / 100);
        mem[(this.I + 1) & 0xfff] = Math.floor(v / 10) % 10;
        mem[(this.I + 2) & 0xfff] = v % 10;
        break;
      }
      case 0x55:
        for (let i = 0; i <= x; i++) mem[(this.I + i) & 0xfff] = V[i];
        if (this.quirks.loadStoreIncrementI) this.I = (this.I + x + 1) & 0xfff;
        break;
      case 0x65:
        for (let i = 0; i <= x; i++) V[i] = mem[(this.I + i) & 0xfff];
        if (this.quirks.loadStoreIncrementI) this.I = (this.I + x + 1) & 0xfff;
        break;
      case 0x75:
        for (let i = 0; i <= Math.min(x, 7); i++) this.rpl[i] = V[i];
        break;
      case 0x85:
        for (let i = 0; i <= Math.min(x, 7); i++) V[i] = this.rpl[i];
        break;
      default:
        return false;
    }
    return true;
  }

  draw(px, py, n) {
    const W = this.width;
    const H = this.height;
    const clip = this.quirks.clipping;
    const big = n === 0 && this.hires;
    const rows = big ? 16 : n;
    const cols = big ? 16 : 8;
    const x0 = px % W;
    const y0 = py % H;
    let hit = 0;
    for (let r = 0; r < rows; r++) {
      let y = y0 + r;
      if (y >= H) {
        if (clip) break;
        y %= H;
      }
      const a = this.I + (big ? r * 2 : r);
      const bits = big ? (this.memory[a & 0xfff] << 8) | this.memory[(a + 1) & 0xfff] : this.memory[a & 0xfff];
      for (let c = 0; c < cols; c++) {
        if (!((bits >> (cols - 1 - c)) & 1)) continue;
        let x = x0 + c;
        if (x >= W) {
          if (clip) continue;
          x %= W;
        }
        const idx = y * W + x;
        if (this.display[idx]) hit = 1;
        this.display[idx] ^= 1;
      }
    }
    this.V[0xf] = hit;
    this.vblank = false;
    this.dirty = true;
  }

  setMode(hires) {
    this.hires = hires;
    this.width = hires ? 128 : 64;
    this.height = hires ? 64 : 32;
    this.display = new Uint8Array(this.width * this.height);
    this.dirty = true;
  }

  scrollDown(n) {
    const W = this.width;
    const d = this.display;
    if (n > 0) {
      d.copyWithin(n * W, 0, d.length - n * W);
      d.fill(0, 0, n * W);
    }
    this.dirty = true;
  }

  scrollRight() {
    const W = this.width;
    for (let y = 0; y < this.height; y++) {
      const row = y * W;
      this.display.copyWithin(row + 4, row, row + W - 4);
      this.display.fill(0, row, row + 4);
    }
    this.dirty = true;
  }

  scrollLeft() {
    const W = this.width;
    for (let y = 0; y < this.height; y++) {
      const row = y * W;
      this.display.copyWithin(row, row + 4, row + W);
      this.display.fill(0, row + W - 4, row + W);
    }
    this.dirty = true;
  }
}
