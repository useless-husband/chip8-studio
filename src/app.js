// 網頁 IDE 的介面程式。模擬器、組譯器都在別的模組,這裡只負責接線。
import { Chip8, QUIRK_PRESETS, QUIRK_KEYS } from './cpu.js';
import { assemble, formatError } from './assembler.js';
import { disasm, disassembleToSource } from './disassembler.js';
import { runFrame } from './runner.js';
import { EXAMPLES } from './examples.js';
import { KEY_MAP, KEYPAD_LAYOUT, KEY_HINT } from './keymap.js';
import { THEMES, colorToU32, HEX_COLOR } from './themes.js';

const $ = (id) => document.getElementById(id);
const hex = (v, w) => v.toString(16).toUpperCase().padStart(w, '0');

const store = {
  get(k, d = null) {
    try { const v = localStorage.getItem('chip8studio.' + k); return v === null ? d : v; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('chip8studio.' + k, v); } catch { /* 隱私模式等情況可以忽略 */ }
  },
};

const QUIRK_INFO = {
  shiftUsesVY: ['位移使用 VY', '開:8XY6 / 8XYE 把 VY 位移後放進 VX(原版)。關:直接位移 VX,忽略 VY。'],
  loadStoreIncrementI: ['讀寫記憶體後 I 遞增', '開:FX55 / FX65 執行完 I 會加上 X+1(原版)。關:I 保持不變。'],
  jumpWithOffset: ['跳躍偏移使用 VX', '開:BNNN 變成 BXNN,跳到 XNN + VX(SUPER-CHIP)。關:跳到 NNN + V0。'],
  vfReset: ['邏輯運算後 VF 歸零', '開:OR / AND / XOR 之後 VF 被清成 0(原版)。關:VF 不變。'],
  displayWait: ['畫圖等待垂直空白', '開:每個 60Hz frame 最多畫一個 sprite(原版,速度會被限制)。關:想畫幾次都行。'],
  clipping: ['超出畫面的 sprite 被裁掉', '開:sprite 超出邊緣的部分不顯示。關:超出的部分繞到畫面另一邊。'],
};

// ---------- 狀態 ----------
const cpu = new Chip8({ quirks: QUIRK_PRESETS.modern });
let asm = null; // 最近一次成功的組譯結果
let asmSource = ''; // 產生 asm 的原始碼
let state = 'idle'; // idle | running | paused | halted
let ips = 700;
let cyclesCarry = 0;
let acc = 0;
let lastTs = 0;
let skipBp = false;
let bpLines = new Set();
let bpAddrs = new Set();
let addrToLine = new Map();
let errLines = new Set();
let prevRegs = null;
let debugTick = 0;
let prevFrame = null;
let fgU32 = 0;
let bgU32 = 0;
let smooth = true;
let currentName = 'program';

const canvas = $('screen');
const ctx = canvas.getContext('2d');
let img = ctx.createImageData(64, 32);
const src = $('src');

// ---------- 聲音 ----------
let audio = null;
let osc = null;
let gain = null;
function ensureAudio() {
  if (audio || !window.AudioContext) return;
  try {
    audio = new AudioContext();
    gain = audio.createGain();
    gain.gain.value = 0;
    gain.connect(audio.destination);
    osc = audio.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 440;
    osc.connect(gain);
    osc.start();
  } catch { audio = null; }
}
function updateBeep() {
  if (!audio) return;
  const on = state === 'running' && cpu.st > 0 && $('sound').checked;
  gain.gain.setTargetAtTime(on ? 0.06 : 0, audio.currentTime, 0.005);
}
document.addEventListener('pointerdown', ensureAudio, { once: true });
document.addEventListener('keydown', ensureAudio, { once: true });

// ---------- 畫面 ----------
function setColors(fg, bg) {
  fgU32 = colorToU32(fg);
  bgU32 = colorToU32(bg);
  $('fg').value = fg;
  $('bg').value = bg;
  prevFrame = null;
  render(true);
}

function render(force = false) {
  if (!force && !cpu.dirty && !(smooth && prevFrame)) return;
  const { width: w, height: h, display } = cpu;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    img = ctx.createImageData(w, h);
    prevFrame = null;
  }
  const px = new Uint32Array(img.data.buffer);
  const ghost = smooth && prevFrame && prevFrame.length === display.length ? prevFrame : null;
  for (let i = 0; i < display.length; i++) px[i] = display[i] || (ghost && ghost[i]) ? fgU32 : bgU32;
  ctx.putImageData(img, 0, 0);
  prevFrame = smooth ? display.slice() : null;
  cpu.dirty = false;
}

// ---------- 編輯器 ----------
const LH = 20;
const PAD = 8;

function lineCount() {
  return src.value.split('\n').length;
}

function renderGutter() {
  const n = lineCount();
  const g = $('gutter');
  if (g.childElementCount !== n) {
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= n; i++) {
      const d = document.createElement('div');
      d.className = 'ln';
      d.dataset.line = i;
      d.textContent = i;
      frag.appendChild(d);
    }
    g.replaceChildren(frag);
  }
  markGutter();
  g.scrollTop = src.scrollTop;
}

function markGutter() {
  const cur = currentLine();
  for (const d of $('gutter').children) {
    const n = +d.dataset.line;
    d.classList.toggle('bp', bpLines.has(n));
    d.classList.toggle('err', errLines.has(n));
    d.classList.toggle('cur', n === cur);
  }
  const hl = $('hl');
  if (cur) {
    hl.hidden = false;
    hl.style.top = PAD + (cur - 1) * LH - src.scrollTop + 'px';
  } else hl.hidden = true;
}

function isStale() {
  return asm !== null && src.value !== asmSource;
}

function currentLine() {
  if (!asm || isStale() || state === 'running' || state === 'idle') return 0;
  return addrToLine.get(cpu.pc) || 0;
}

function scrollToLine(n) {
  const top = PAD + (n - 1) * LH;
  if (top < src.scrollTop + LH || top > src.scrollTop + src.clientHeight - LH * 3) {
    src.scrollTop = Math.max(0, top - src.clientHeight / 3);
  }
}

function toggleBreakpoint(line) {
  if (bpLines.has(line)) bpLines.delete(line);
  else bpLines.add(line);
  recomputeBreakpoints();
  markGutter();
  updateDebug();
}

function recomputeBreakpoints() {
  bpAddrs = new Set();
  if (!asm) return;
  // 中斷點設在只有標籤/註解的行時,順延到下一個有程式碼的行
  const code = asm.lines.filter((l) => l.size > 0).sort((a, b) => a.line - b.line);
  for (const n of bpLines) {
    const hit = code.find((l) => l.line >= n);
    if (hit) bpAddrs.add(hit.addr);
  }
}

function focusLine(n) {
  const lines = src.value.split('\n');
  let start = 0;
  for (let i = 0; i < n - 1 && i < lines.length; i++) start += lines[i].length + 1;
  src.focus();
  src.setSelectionRange(start, start + (lines[n - 1] || '').length);
  scrollToLine(n);
}

$('gutter').addEventListener('click', (e) => {
  const d = e.target.closest('.ln');
  if (d) toggleBreakpoint(+d.dataset.line);
});

src.addEventListener('scroll', () => {
  $('gutter').scrollTop = src.scrollTop;
  markGutter();
});

let tabEscapes = false;
src.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { tabEscapes = true; return; }
  if (e.key === 'Tab' && !tabEscapes) {
    e.preventDefault();
    const { selectionStart: s, selectionEnd: t, value: v } = src;
    if (e.shiftKey) {
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const m = /^ {1,4}/.exec(v.slice(ls));
      if (m) {
        src.setRangeText('', ls, ls + m[0].length, 'preserve');
        src.setSelectionRange(Math.max(ls, s - m[0].length), Math.max(ls, t - m[0].length));
        onEdit();
      }
    } else {
      src.setRangeText('    ', s, t, 'end');
      onEdit();
    }
    return;
  }
  tabEscapes = false;
  if (e.key === 'F9') {
    e.preventDefault();
    toggleBreakpoint(src.value.slice(0, src.selectionStart).split('\n').length);
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runFromEditor();
  }
});
src.addEventListener('blur', () => { tabEscapes = false; });
src.addEventListener('input', onEdit);

function onEdit() {
  store.set('source', src.value);
  renderGutter();
  if (asm && isStale()) showStale();
}

function showStale() {
  const m = $('messages');
  if (!m.querySelector('.warn')) {
    const p = document.createElement('p');
    p.className = 'warn';
    p.textContent = '原始碼已修改,尚未重新組譯。按「組譯並執行」套用。';
    m.appendChild(p);
  }
  markGutter();
}

// ---------- 組譯 / 載入 ----------
function showMessages(res) {
  const m = $('messages');
  m.replaceChildren();
  errLines = new Set(res.errors.map((e) => e.line));
  if (res.ok) {
    const p = document.createElement('p');
    p.className = 'ok';
    const end = res.origin + res.bytes.length - 1;
    p.textContent = `組譯成功:${res.bytes.length} 位元組(0x${hex(res.origin, 3)}–0x${hex(Math.max(end, res.origin), 3)}),${Object.keys(res.labels).length} 個標籤。`;
    m.appendChild(p);
  } else {
    const ul = document.createElement('ul');
    for (const e of res.errors) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = formatError(e);
      b.addEventListener('click', () => focusLine(e.line));
      li.appendChild(b);
      ul.appendChild(li);
    }
    m.appendChild(ul);
  }
  markGutter();
}

function adopt(res, text) {
  asm = res;
  asmSource = text;
  addrToLine = new Map();
  for (const l of res.lines) if (l.size > 0 && !addrToLine.has(l.addr)) addrToLine.set(l.addr, l.line);
  recomputeBreakpoints();
}

function runFromEditor() {
  ensureAudio();
  const text = src.value;
  const res = assemble(text);
  showMessages(res);
  if (!res.ok) {
    setStatus(`組譯失敗:${res.errors.length} 個錯誤`);
    return false;
  }
  adopt(res, text);
  cpu.load(res.bytes);
  prevFrame = null;
  cyclesCarry = 0;
  start();
  canvas.focus({ preventScroll: true });
  return true;
}

async function loadExample(id) {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) return;
  $('example-hint').textContent = ex.hint;
  try {
    const r = await fetch(ex.file);
    if (!r.ok) throw new Error(r.status);
    src.value = await r.text();
  } catch {
    src.value = '; 無法載入範例(請用 http 伺服器開啟本頁,不要直接開檔案)\n';
  }
  currentName = ex.id;
  store.set('source', src.value);
  bpLines = new Set();
  renderGutter();
  runFromEditor();
}

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 4096 - 0x200) {
    setStatus(`檔案大小不合理(${bytes.length} 位元組),CHIP-8 程式最多 ${4096 - 0x200} 位元組。`);
    return;
  }
  ensureAudio();
  const text = disassembleToSource(bytes);
  src.value = text;
  currentName = f.name.replace(/\.[^.]+$/, '') || 'program';
  store.set('source', text);
  bpLines = new Set();
  $('example-hint').textContent = `已載入 ${f.name}(${bytes.length} 位元組),編輯器裡是它的反組譯結果。`;
  renderGutter();
  const res = assemble(text);
  showMessages(res);
  adopt(res, text);
  cpu.load(bytes);
  prevFrame = null;
  start();
});

$('btn-download').addEventListener('click', () => {
  let res = asm;
  if (!res || isStale()) {
    res = assemble(src.value);
    showMessages(res);
    if (!res.ok) { setStatus('原始碼有錯誤,無法下載。'); return; }
  }
  const blob = new Blob([res.bytes], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = currentName + '.ch8';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('btn-run').addEventListener('click', runFromEditor);

// ---------- 執行控制 ----------
function setStatus(t) {
  $('status').textContent = t;
}

function refreshStatus() {
  let t;
  switch (state) {
    case 'running': t = cpu.waitingForKey ? '執行中(等待按鍵…)' : '執行中'; break;
    case 'paused': t = `已暫停,PC = 0x${hex(cpu.pc, 3)}${currentLine() ? `(第 ${currentLine()} 行)` : ''}`; break;
    case 'halted': t = `已停止:${cpu.haltReason}`; break;
    default: t = '尚未載入程式';
  }
  setStatus(t);
  const loaded = state !== 'idle';
  $('btn-toggle').disabled = !loaded || state === 'halted';
  $('btn-toggle').textContent = state === 'running' ? '暫停' : '繼續';
  $('btn-step').disabled = !loaded || state === 'running' || state === 'halted';
  $('btn-frame').disabled = $('btn-step').disabled;
  $('btn-reset').disabled = !loaded;
}

function start() {
  state = 'running';
  skipBp = false;
  acc = 0;
  lastTs = performance.now();
  afterChange();
}

function pause(reason) {
  if (state === 'running') state = 'paused';
  afterChange();
  if (reason === 'breakpoint') {
    const l = currentLine();
    if (l) scrollToLine(l);
    setStatus(`中斷點:PC = 0x${hex(cpu.pc, 3)}${l ? `(第 ${l} 行)` : ''}`);
  }
}

function afterChange() {
  if (cpu.halted) state = 'halted';
  refreshStatus();
  updateDebug();
  markGutter();
  render(true);
  updateBeep();
  const l = currentLine();
  if (l && state !== 'running') scrollToLine(l);
}

$('btn-toggle').addEventListener('click', () => {
  if (state === 'running') pause();
  else if (state === 'paused') { skipBp = true; start(); }
});

function stepOne() {
  if (!cpu.step() && !cpu.halted && !cpu.waitingForKey) {
    cpu.tick(); // 被 display wait 擋住:等到下一個 frame
    cpu.step();
  }
}

$('btn-step').addEventListener('click', () => {
  if (state !== 'paused') return;
  stepOne();
  afterChange();
});

$('btn-frame').addEventListener('click', () => {
  if (state !== 'paused') return;
  runFrame(cpu, Math.round(ips / 60), { breakpoints: bpAddrs, skipBreakpointOnce: true });
  cpu.tick();
  afterChange();
});

$('btn-reset').addEventListener('click', () => {
  const was = state;
  cpu.reset();
  prevFrame = null;
  cyclesCarry = 0;
  if (was === 'running' || was === 'halted') start();
  else { state = 'paused'; afterChange(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'F10' && state === 'paused') {
    e.preventDefault();
    stepOne();
    afterChange();
  }
});

function frame(ts) {
  requestAnimationFrame(frame);
  if (state === 'running') {
    acc += Math.min(ts - lastTs, 100);
    lastTs = ts;
    let n = 0;
    while (acc >= 1000 / 60 && n < 6 && state === 'running') {
      acc -= 1000 / 60;
      n++;
      cyclesCarry += ips / 60;
      const cycles = Math.floor(cyclesCarry);
      cyclesCarry -= cycles;
      const reason = runFrame(cpu, cycles, { breakpoints: bpAddrs, skipBreakpointOnce: skipBp });
      skipBp = false;
      if (reason === 'breakpoint') { pause('breakpoint'); break; }
      if (reason === 'halted') { afterChange(); break; }
      cpu.tick();
    }
    if (acc > 200) acc = 0;
    render();
    updateBeep();
    if (state === 'running' && ++debugTick % 6 === 0) {
      updateDebug();
      refreshStatusLight();
    }
  } else {
    render();
  }
}

let lastWaiting = false;
function refreshStatusLight() {
  if (lastWaiting !== cpu.waitingForKey) {
    lastWaiting = cpu.waitingForKey;
    refreshStatus();
  }
}

// ---------- 除錯面板 ----------
function buildDebug() {
  const regs = $('regs');
  for (let i = 0; i < 16; i++) {
    const d = document.createElement('div');
    d.innerHTML = `<b>V${i.toString(16).toUpperCase()}</b><span></span>`;
    regs.appendChild(d);
  }
  const sp = $('specials');
  for (const name of ['I', 'PC', 'SP', 'DT', 'ST', '週期', '模式']) {
    const d = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = name;
    const dd = document.createElement('dd');
    d.append(dt, dd);
    sp.appendChild(d);
  }
  const st = $('stack');
  for (let i = 0; i < 16; i++) st.appendChild(document.createElement('li'));
}

function updateDebug() {
  const cells = $('regs').children;
  for (let i = 0; i < 16; i++) {
    cells[i].lastChild.textContent = hex(cpu.V[i], 2);
    cells[i].classList.toggle('chg', !!prevRegs && prevRegs.V[i] !== cpu.V[i]);
  }
  const vals = [
    '0x' + hex(cpu.I, 3), '0x' + hex(cpu.pc, 3), String(cpu.sp), hex(cpu.dt, 2), hex(cpu.st, 2),
    String(cpu.cycles), cpu.hires ? '128×64' : '64×32',
  ];
  const keys = ['I', 'pc', 'sp', 'dt', 'st'];
  [...$('specials').children].forEach((d, i) => {
    d.lastChild.textContent = vals[i];
    d.classList.toggle('chg', !!prevRegs && i < 5 && prevRegs[keys[i]] !== cpu[keys[i]]);
  });
  [...$('stack').children].forEach((li, i) => {
    li.className = i < cpu.sp ? 'used' : '';
    if (i === cpu.sp - 1) li.classList.add('top');
    li.textContent = `${i.toString(16).toUpperCase()}: ${i < cpu.sp ? '0x' + hex(cpu.stack[i], 3) : '—'}`;
  });
  prevRegs = { V: Uint8Array.from(cpu.V), I: cpu.I, pc: cpu.pc, sp: cpu.sp, dt: cpu.dt, st: cpu.st };

  const list = $('disasm');
  const rows = [];
  for (let k = 0; k < 8; k++) {
    const a = (cpu.pc + k * 2) & 0xfff;
    const op = cpu.fetch(a);
    const li = document.createElement('li');
    if (k === 0) li.className = 'pc';
    if (bpAddrs.has(a)) li.classList.add('bp');
    li.innerHTML = `<span class="a">0x${hex(a, 3)}</span><span class="h">${hex(op, 4)}</span><span></span>`;
    li.lastChild.textContent = disasm(op);
    rows.push(li);
  }
  list.replaceChildren(...rows);
  updateMemory();
}

function updateMemory() {
  const mode = $('mem-mode').value;
  let start;
  if (mode === 'pc') start = Math.max(0, (cpu.pc & 0xff0) - 32);
  else if (mode === 'i') start = Math.max(0, (cpu.I & 0xff0) - 32);
  else start = (parseInt($('mem-addr').value, 16) || 0) & 0xff0;
  start = Math.min(start, 4096 - 256);
  let out = '';
  for (let r = 0; r < 16; r++) {
    const base = start + r * 16;
    out += `<span class="addr">${hex(base, 3)}</span> `;
    for (let c = 0; c < 16; c++) {
      const a = base + c;
      const t = hex(cpu.memory[a], 2);
      if (a === cpu.pc || a === cpu.pc + 1) out += `<span class="pcb">${t}</span> `;
      else if (a === cpu.I) out += `<span class="ib">${t}</span> `;
      else out += t + ' ';
    }
    out += '\n';
  }
  $('mem').innerHTML = out;
}
$('mem-mode').addEventListener('change', () => { $('mem-addr').disabled = $('mem-mode').value !== 'addr'; updateMemory(); });
$('mem-addr').addEventListener('input', updateMemory);

// ---------- 鍵盤 ----------
const padButtons = new Map();
function buildKeypad() {
  const pad = $('keypad');
  for (const k of KEYPAD_LAYOUT) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${hex(k, 1)}<small>${KEY_HINT[k]}</small>`;
    b.setAttribute('aria-label', `鍵 ${hex(k, 1)}(電腦鍵盤 ${KEY_HINT[k]})`);
    const down = (e) => {
      e.preventDefault();
      ensureAudio();
      b.setPointerCapture?.(e.pointerId);
      press(k, true);
    };
    const up = () => press(k, false);
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) press(k, true); } });
    b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') press(k, false); });
    pad.appendChild(b);
    padButtons.set(k, b);
  }
}

const held = new Set();
function press(k, down) {
  if (down) held.add(k); else held.delete(k);
  cpu.setKey(k, down);
  padButtons.get(k)?.classList.toggle('down', down);
}

function isTyping(el) {
  return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text') || el.tagName === 'SELECT');
}
window.addEventListener('keydown', (e) => {
  const k = KEY_MAP[e.code];
  if (k === undefined || e.ctrlKey || e.metaKey || e.altKey || isTyping(document.activeElement)) return;
  e.preventDefault();
  if (!e.repeat) press(k, true);
});
window.addEventListener('keyup', (e) => {
  const k = KEY_MAP[e.code];
  if (k !== undefined && held.has(k)) press(k, false);
});
window.addEventListener('blur', () => { for (const k of [...held]) press(k, false); });
canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));

// ---------- 設定 ----------
function buildSettings() {
  const sel = $('theme');
  for (const t of THEMES) sel.add(new Option(t.name, t.id));
  sel.add(new Option('自訂', 'custom'));
  const saved = store.get('theme', 'green');
  let fg;
  let bg;
  if (saved === 'custom' && HEX_COLOR.test(store.get('fg', '')) && HEX_COLOR.test(store.get('bg', ''))) {
    fg = store.get('fg'); bg = store.get('bg'); sel.value = 'custom';
  } else {
    const t = THEMES.find((x) => x.id === saved) || THEMES[0];
    fg = t.fg; bg = t.bg; sel.value = t.id;
  }
  setColors(fg, bg);
  sel.addEventListener('change', () => {
    const t = THEMES.find((x) => x.id === sel.value);
    if (t) setColors(t.fg, t.bg);
    store.set('theme', sel.value);
    if (!t) { store.set('fg', $('fg').value); store.set('bg', $('bg').value); }
  });
  const custom = () => {
    sel.value = 'custom';
    setColors($('fg').value, $('bg').value);
    store.set('theme', 'custom');
    store.set('fg', $('fg').value);
    store.set('bg', $('bg').value);
  };
  $('fg').addEventListener('input', custom);
  $('bg').addEventListener('input', custom);

  const speed = $('speed');
  const savedSpeed = parseInt(store.get('speed', '700'), 10);
  if (savedSpeed >= 100 && savedSpeed <= 3000) speed.value = savedSpeed;
  const applySpeed = () => { ips = +speed.value; $('speed-out').textContent = ips; store.set('speed', ips); };
  speed.addEventListener('input', applySpeed);
  applySpeed();

  smooth = store.get('smooth', '1') === '1';
  $('smooth').checked = smooth;
  $('smooth').addEventListener('change', () => { smooth = $('smooth').checked; store.set('smooth', smooth ? '1' : '0'); prevFrame = null; render(true); });
  $('sound').checked = store.get('sound', '1') === '1';
  $('sound').addEventListener('change', () => { store.set('sound', $('sound').checked ? '1' : '0'); updateBeep(); });

  // quirks
  const box = $('quirks');
  for (const key of QUIRK_KEYS) {
    const [title, desc] = QUIRK_INFO[key];
    const wrap = document.createElement('div');
    wrap.className = 'quirk';
    wrap.innerHTML = `<input type="checkbox" id="q-${key}"><label for="q-${key}"></label><p></p>`;
    wrap.querySelector('label').textContent = title;
    wrap.querySelector('p').textContent = desc;
    wrap.querySelector('input').addEventListener('change', (ev) => {
      cpu.setQuirks({ [key]: ev.target.checked });
      syncPresetName();
    });
    box.appendChild(wrap);
  }
  $('preset').addEventListener('change', () => {
    if ($('preset').value === 'custom') return;
    cpu.setQuirks(QUIRK_PRESETS[$('preset').value]);
    syncQuirkBoxes();
  });
  const savedPreset = store.get('preset', 'modern');
  cpu.setQuirks(QUIRK_PRESETS[savedPreset] || QUIRK_PRESETS.cosmac);
  syncQuirkBoxes();
}

function syncQuirkBoxes() {
  for (const key of QUIRK_KEYS) $('q-' + key).checked = cpu.quirks[key];
  syncPresetName();
}
function syncPresetName() {
  const match = Object.keys(QUIRK_PRESETS).find((p) => QUIRK_KEYS.every((k) => QUIRK_PRESETS[p][k] === cpu.quirks[k]));
  $('preset').value = match || 'custom';
  if (match) store.set('preset', match);
}

// ---------- 啟動 ----------
function init() {
  const sel = $('example');
  for (const ex of EXAMPLES) sel.add(new Option(ex.title, ex.id));
  sel.add(new Option('(我自己的程式)', 'mine'));
  sel.addEventListener('change', () => {
    if (sel.value !== 'mine') loadExample(sel.value);
  });
  buildDebug();
  buildKeypad();
  buildSettings();
  $('mem-addr').disabled = true;
  requestAnimationFrame(frame);

  const saved = store.get('source');
  if (saved && saved.trim()) {
    src.value = saved;
    sel.value = 'mine';
    $('example-hint').textContent = '已還原你上次編輯的內容。要看範例請從上面的選單挑一個。';
    renderGutter();
    runFromEditor();
  } else {
    sel.value = EXAMPLES[0].id;
    loadExample(EXAMPLES[0].id);
  }
  refreshStatus();
}

// 給自動化測試與除錯用
window.__chip8 = { cpu, press, get state() { return state; } };

init();
