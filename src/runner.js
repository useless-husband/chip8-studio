// 以「一個 frame」為單位推進模擬器。瀏覽器與測試共用。

// 最多執行 cycles 個指令。回傳停止原因:
//   'done' 跑滿、'breakpoint' 遇到中斷點(尚未執行)、'halted' 停機、
//   'stalled' 等待垂直空白(display wait)、'key' 等待按鍵
export function runFrame(cpu, cycles, { breakpoints = null, skipBreakpointOnce = false } = {}) {
  let skip = skipBreakpointOnce;
  for (let i = 0; i < cycles; i++) {
    if (cpu.halted) return 'halted';
    if (!skip && breakpoints && breakpoints.has(cpu.pc)) return 'breakpoint';
    skip = false;
    if (!cpu.step()) {
      if (cpu.halted) return 'halted';
      return cpu.waitingForKey ? 'key' : 'stalled';
    }
  }
  return 'done';
}

// 跑 frames 個 frame(每個 frame 之後 tick 一次)。回傳最後一次的停止原因。
export function runFrames(cpu, frames, cyclesPerFrame = 12, opts = {}) {
  let reason = 'done';
  for (let f = 0; f < frames; f++) {
    reason = runFrame(cpu, cyclesPerFrame, opts);
    if (reason === 'halted' || reason === 'breakpoint') return reason;
    cpu.tick();
  }
  return reason;
}
