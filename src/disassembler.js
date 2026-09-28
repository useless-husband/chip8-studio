// 反組譯器:輸出的語法與 assembler.js 完全一致,可以直接再組譯回同樣的位元組。

const hex = (v, w) => '0x' + v.toString(16).toUpperCase().padStart(w, '0');
const reg = (n) => 'v' + n.toString(16);

// 把一個 16 位元指令轉成組合語言文字。無法辨識的指令輸出成 ".dw 0xNNNN"。
export function disasm(op) {
  const x = (op >> 8) & 0xf;
  const y = (op >> 4) & 0xf;
  const n = op & 0xf;
  const nn = op & 0xff;
  const nnn = op & 0xfff;
  const vx = reg(x);
  const vy = reg(y);
  const unknown = '.dw ' + hex(op, 4);

  switch (op >> 12) {
    case 0x0:
      if ((op & 0xfff0) === 0x00c0) return `scd ${n}`;
      switch (op) {
        case 0x00e0: return 'cls';
        case 0x00ee: return 'ret';
        case 0x00fb: return 'scr';
        case 0x00fc: return 'scl';
        case 0x00fd: return 'exit';
        case 0x00fe: return 'low';
        case 0x00ff: return 'high';
      }
      return `sys ${hex(nnn, 3)}`;
    case 0x1: return `jp ${hex(nnn, 3)}`;
    case 0x2: return `call ${hex(nnn, 3)}`;
    case 0x3: return `se ${vx}, ${hex(nn, 2)}`;
    case 0x4: return `sne ${vx}, ${hex(nn, 2)}`;
    case 0x5: return n === 0 ? `se ${vx}, ${vy}` : unknown;
    case 0x6: return `ld ${vx}, ${hex(nn, 2)}`;
    case 0x7: return `add ${vx}, ${hex(nn, 2)}`;
    case 0x8:
      switch (n) {
        case 0x0: return `ld ${vx}, ${vy}`;
        case 0x1: return `or ${vx}, ${vy}`;
        case 0x2: return `and ${vx}, ${vy}`;
        case 0x3: return `xor ${vx}, ${vy}`;
        case 0x4: return `add ${vx}, ${vy}`;
        case 0x5: return `sub ${vx}, ${vy}`;
        case 0x6: return `shr ${vx}, ${vy}`;
        case 0x7: return `subn ${vx}, ${vy}`;
        case 0xe: return `shl ${vx}, ${vy}`;
      }
      return unknown;
    case 0x9: return n === 0 ? `sne ${vx}, ${vy}` : unknown;
    case 0xa: return `ld i, ${hex(nnn, 3)}`;
    case 0xb: return `jp v0, ${hex(nnn, 3)}`;
    case 0xc: return `rnd ${vx}, ${hex(nn, 2)}`;
    case 0xd: return `drw ${vx}, ${vy}, ${n}`;
    case 0xe:
      if (nn === 0x9e) return `skp ${vx}`;
      if (nn === 0xa1) return `sknp ${vx}`;
      return unknown;
    case 0xf:
      switch (nn) {
        case 0x07: return `ld ${vx}, dt`;
        case 0x0a: return `ld ${vx}, k`;
        case 0x15: return `ld dt, ${vx}`;
        case 0x18: return `ld st, ${vx}`;
        case 0x1e: return `add i, ${vx}`;
        case 0x29: return `ld f, ${vx}`;
        case 0x30: return `ld hf, ${vx}`;
        case 0x33: return `ld b, ${vx}`;
        case 0x55: return `ld [i], ${vx}`;
        case 0x65: return `ld ${vx}, [i]`;
        case 0x75: return x < 8 ? `ld r, ${vx}` : unknown;
        case 0x85: return x < 8 ? `ld ${vx}, r` : unknown;
      }
      return unknown;
  }
  return unknown;
}

// 從 base 位址開始,兩個位元組一組反組譯。回傳 [{addr, op, text}]。
// 位元組數是奇數時,最後一個位元組輸出成 ".db"。
export function disassemble(bytes, base = 0x200) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 >= bytes.length) {
      out.push({ addr: base + i, op: bytes[i], size: 1, text: '.db ' + hex(bytes[i], 2) });
    } else {
      const op = (bytes[i] << 8) | bytes[i + 1];
      out.push({ addr: base + i, op, size: 2, text: disasm(op) });
    }
  }
  return out;
}

// 產生可以直接貼回編輯器、再組譯的完整原始碼(每行附位址註解)。
export function disassembleToSource(bytes, base = 0x200) {
  const lines = ['; 由 .ch8 反組譯而來', ''];
  for (const r of disassemble(bytes, base)) {
    const raw = r.size === 2 ? r.op.toString(16).toUpperCase().padStart(4, '0') : r.op.toString(16).toUpperCase().padStart(2, '0');
    lines.push(`${r.text.padEnd(22)}; ${hex(r.addr, 3)}  ${raw}`);
  }
  return lines.join('\n') + '\n';
}
