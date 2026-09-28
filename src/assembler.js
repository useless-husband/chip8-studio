// CHIP-8 組譯器。兩趟式:第一趟算位址與收集標籤,第二趟編碼。
// 所有錯誤都帶行號與中文說明,並且盡量一次回報多個。

import { PROGRAM_START, MEM_SIZE } from './cpu.js';

class AsmError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AsmError';
  }
}

const REG_WORDS = new Set(['i', 'dt', 'st', 'f', 'hf', 'b', 'r', 'k']);
const DIRECTIVES = new Set(['org', 'equ', 'reg', 'db', 'dw', 'px', 'ds', 'ascii']);
const MNEMONICS = new Set([
  'cls', 'ret', 'exit', 'low', 'high', 'scr', 'scl', 'scd', 'sys', 'jp', 'call', 'se', 'sne', 'ld',
  'add', 'or', 'and', 'xor', 'sub', 'subn', 'shr', 'shl', 'rnd', 'drw', 'skp', 'sknp',
]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const V_REG = /^v([0-9a-f])$/i;

const hex = (v, w = 1) => '0x' + v.toString(16).toUpperCase().padStart(w, '0');

// ---------- 文字處理 ----------

// 移除行尾註解(分號),但不動字串裡的分號。
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ';') return line.slice(0, i);
  }
  if (quote) throw new AsmError('字串少了結尾的引號');
  return line;
}

// 以逗號分隔運算元,忽略引號與括號內的逗號。
function splitOperands(text) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const c of text) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === '(' || c === '[') {
      depth++;
      cur += c;
    } else if (c === ')' || c === ']') {
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim() !== '' || out.length > 0) out.push(cur.trim());
  return out;
}

// ---------- 運算式 ----------

function tokenize(src) {
  const toks = [];
  let i = 0;
  const prevIsValue = () => toks.length > 0 && (toks[toks.length - 1].t === 'num' || toks[toks.length - 1].t === 'id' || toks[toks.length - 1].v === ')');
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    let m;
    const rest = src.slice(i);
    if ((m = /^0[xX]([0-9a-fA-F]+)/.exec(rest)) || (!prevIsValue() && (m = /^\$([0-9a-fA-F]+)/.exec(rest)))) {
      toks.push({ t: 'num', v: parseInt(m[1], 16) }); i += m[0].length; continue;
    }
    if ((m = /^0[bB]([01]+)/.exec(rest)) || (!prevIsValue() && (m = /^%([01]+)/.exec(rest)))) {
      toks.push({ t: 'num', v: parseInt(m[1], 2) }); i += m[0].length; continue;
    }
    if ((m = /^[0-9]+/.exec(rest))) {
      if (/^[0-9]+[A-Za-z_]/.test(rest)) throw new AsmError(`數字格式不對:「${/^[0-9A-Za-z_]+/.exec(rest)[0]}」`);
      toks.push({ t: 'num', v: parseInt(m[0], 10) }); i += m[0].length; continue;
    }
    if ((m = /^'(.)'/.exec(rest))) {
      toks.push({ t: 'num', v: m[1].charCodeAt(0) }); i += m[0].length; continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
      toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue;
    }
    if ((m = /^(<<|>>|[-+*\/&|^~()])/.exec(rest))) {
      toks.push({ t: 'op', v: m[0] }); i += m[0].length; continue;
    }
    throw new AsmError(`看不懂的字元「${c}」`);
  }
  return toks;
}

// 遞迴下降。lookup(name) 回傳數值或 undefined。
function evalExpr(text, lookup) {
  const toks = tokenize(text);
  if (toks.length === 0) throw new AsmError('少了數值或運算式');
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
  const binary = (ops, next) => () => {
    let l = next();
    while (toks[p] && toks[p].t === 'op' && ops.includes(toks[p].v)) {
      const o = toks[p++].v;
      const r = next();
      switch (o) {
        case '|': l = l | r; break;
        case '^': l = l ^ r; break;
        case '&': l = l & r; break;
        case '<<': l = l << r; break;
        case '>>': l = l >> r; break;
        case '+': l = l + r; break;
        case '-': l = l - r; break;
        case '*': l = l * r; break;
        case '/':
          if (r === 0) throw new AsmError('除數不能是 0');
          l = Math.trunc(l / r);
          break;
      }
    }
    return l;
  };
  const unary = () => {
    if (isOp('-')) { p++; return -unary(); }
    if (isOp('+')) { p++; return unary(); }
    if (isOp('~')) { p++; return ~unary(); }
    return primary();
  };
  const primary = () => {
    const t = peek();
    if (!t) throw new AsmError('運算式沒寫完');
    p++;
    if (t.t === 'num') return t.v;
    if (t.t === 'id') {
      const v = lookup(t.v);
      if (v === undefined) throw new AsmError(`未定義的符號「${t.v}」`);
      return v;
    }
    if (t.v === '(') {
      const v = or();
      if (!isOp(')')) throw new AsmError('括號沒有對稱');
      p++;
      return v;
    }
    throw new AsmError(`運算式裡不該出現「${t.v}」`);
  };
  const mul = binary(['*', '/'], unary);
  const add = binary(['+', '-'], mul);
  const shift = binary(['<<', '>>'], add);
  const and = binary(['&'], shift);
  const xor = binary(['^'], and);
  const or = binary(['|'], xor);
  const v = or();
  if (p < toks.length) throw new AsmError(`運算式裡多出了「${toks[p].v}」`);
  return v;
}

// ---------- 字串 / sprite ----------

function parseString(s) {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  return null;
}

function pixelRowBytes(s) {
  const str = parseString(s);
  if (str === null) throw new AsmError(`.px 需要用雙引號包起來的像素圖案,例如 .px "..##..##"`);
  if (str.length === 0 || str.length > 16) throw new AsmError(`.px 每列必須是 1 到 16 個字元(目前 ${str.length} 個)`);
  let bits = 0;
  for (let i = 0; i < 16; i++) {
    const c = i < str.length ? str[i] : '.';
    if ('.-_ 0'.includes(c)) bits = bits << 1;
    else if ('#Xx*1'.includes(c)) bits = (bits << 1) | 1;
    else throw new AsmError(`.px 只能用「.」代表空白、「#」代表亮點,不能有「${c}」`);
  }
  return str.length <= 8 ? [bits >> 8] : [bits >> 8, bits & 0xff];
}

// ---------- 主程式 ----------

/**
 * 組譯原始碼。
 * @returns {{ok:boolean, errors:{line:number,message:string}[], bytes:Uint8Array|null,
 *   origin:number, labels:Record<string,number>, lines:{line:number,addr:number,size:number}[]}}
 */
export function assemble(source) {
  const text = String(source).replace(/\r\n?/g, '\n');
  const rawLines = text.split('\n');
  const errors = [];
  const symbols = new Map(); // name -> {kind:'label'|'equ'|'reg', value, line}
  const items = []; // 第一趟的結果:{line, addr, size, kind, ...}
  const bad = new Set();
  let addr = PROGRAM_START;

  const fail = (line, msg) => {
    errors.push({ line, message: msg });
    bad.add(line);
  };
  const lookup = (name) => {
    const s = symbols.get(name);
    return s && s.kind !== 'reg' ? s.value : undefined;
  };
  const define = (name, kind, value, line) => {
    if (!IDENT.test(name)) throw new AsmError(`「${name}」不是合法的名稱(只能用英文字母、數字、底線,且不能以數字開頭)`);
    if (V_REG.test(name) || REG_WORDS.has(name.toLowerCase())) throw new AsmError(`「${name}」是保留的暫存器名稱,不能拿來當名稱`);
    if (MNEMONICS.has(name.toLowerCase()) || DIRECTIVES.has(name.toLowerCase())) throw new AsmError(`「${name}」是指令名稱,不能拿來當名稱`);
    const old = symbols.get(name);
    if (old) throw new AsmError(`名稱「${name}」重複定義(第 ${old.line} 行已經定義過)`);
    symbols.set(name, { kind, value, line });
  };

  // ----- 第一趟 -----
  rawLines.forEach((raw, idx) => {
    const line = idx + 1;
    try {
      let s = stripComment(raw).trim();
      let m;
      while ((m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(s))) {
        define(m[1], 'label', addr, line);
        s = s.slice(m[0].length).trim();
      }
      if (!s) return;
      m = /^(\.?[A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(s);
      if (!m) throw new AsmError(`看不懂這一行:「${s}」`);
      let word = m[1].toLowerCase();
      const rest = m[2];
      const isDot = word.startsWith('.');
      if (isDot) word = word.slice(1);
      const ops = rest.trim() === '' ? [] : splitOperands(rest);

      if (DIRECTIVES.has(word)) {
        first(line, word, ops);
      } else if (!isDot && MNEMONICS.has(word)) {
        items.push({ line, addr, size: 2, kind: 'ins', word, ops });
        addr += 2;
      } else {
        throw new AsmError(`不認得的指令「${m[1]}」`);
      }
    } catch (e) {
      if (!(e instanceof AsmError)) throw e;
      fail(line, e.message);
    }
  });

  function first(line, word, ops) {
    const need = (n) => {
      if (ops.length !== n) throw new AsmError(`「.${word}」需要 ${n} 個參數,但寫了 ${ops.length} 個`);
    };
    const advance = (item) => {
      item.line = line;
      item.addr = addr;
      items.push(item);
      addr += item.size;
    };
    switch (word) {
      case 'org': {
        need(1);
        const v = evalExpr(ops[0], lookup);
        if (v < PROGRAM_START || v >= MEM_SIZE) throw new AsmError(`.org 的位址必須在 ${hex(PROGRAM_START, 3)} 到 0xFFF 之間`);
        if (v < addr) throw new AsmError(`.org ${hex(v, 3)} 往回跳了(目前已經到 ${hex(addr, 3)}),.org 只能往後填空`);
        advance({ kind: 'pad', size: v - addr });
        break;
      }
      case 'equ': {
        // 接受 ".equ NAME value" 與 ".equ NAME, value"
        let name;
        let expr;
        if (ops.length === 2) [name, expr] = ops;
        else if (ops.length === 1) {
          const mm = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(ops[0]);
          if (!mm) throw new AsmError('.equ 的格式是「.equ 名稱 值」');
          [, name, expr] = mm;
        } else throw new AsmError('.equ 的格式是「.equ 名稱 值」');
        define(name, 'equ', evalExpr(expr, lookup), line);
        break;
      }
      case 'reg': {
        let name;
        let target;
        if (ops.length === 2) [name, target] = ops;
        else if (ops.length === 1) {
          const mm = /^([A-Za-z_][A-Za-z0-9_]*)\s+(\S+)$/.exec(ops[0]);
          if (!mm) throw new AsmError('.reg 的格式是「.reg 名稱 v3」');
          [, name, target] = mm;
        } else throw new AsmError('.reg 的格式是「.reg 名稱 v3」');
        const rm = V_REG.exec(target);
        if (!rm) throw new AsmError(`.reg 只能把名稱綁到 v0 到 vf,不能是「${target}」`);
        define(name, 'reg', parseInt(rm[1], 16), line);
        break;
      }
      case 'db': {
        if (ops.length === 0) throw new AsmError('.db 後面要有資料');
        let size = 0;
        for (const o of ops) {
          const str = parseString(o);
          size += str !== null ? str.length : 1;
        }
        advance({ kind: 'db', size, ops });
        break;
      }
      case 'dw':
        if (ops.length === 0) throw new AsmError('.dw 後面要有資料');
        advance({ kind: 'dw', size: ops.length * 2, ops });
        break;
      case 'ascii': {
        need(1);
        const str = parseString(ops[0]);
        if (str === null) throw new AsmError('.ascii 需要雙引號包起來的字串');
        advance({ kind: 'db', size: str.length, ops });
        break;
      }
      case 'px': {
        if (ops.length === 0) throw new AsmError('.px 後面要有像素圖案');
        const rows = ops.map(pixelRowBytes);
        advance({ kind: 'bytes', size: rows.reduce((a, r) => a + r.length, 0), bytes: rows.flat() });
        break;
      }
      case 'ds': {
        need(1);
        const n = evalExpr(ops[0], lookup);
        if (n < 0 || n > MEM_SIZE) throw new AsmError('.ds 的長度不合理');
        advance({ kind: 'pad', size: n });
        break;
      }
    }
  }

  if (addr > MEM_SIZE) {
    fail(rawLines.length, `程式太大:需要到 ${hex(addr, 3)},但記憶體只到 0xFFF(最多 ${MEM_SIZE - PROGRAM_START} 位元組)`);
  }

  // ----- 第二趟 -----
  const out = new Uint8Array(Math.max(0, Math.min(addr, MEM_SIZE) - PROGRAM_START));
  const lines = [];
  const put = (a, b) => {
    if (a - PROGRAM_START < out.length) out[a - PROGRAM_START] = b & 0xff;
  };
  for (const it of items) {
    lines.push({ line: it.line, addr: it.addr, size: it.size });
    if (bad.has(it.line)) continue;
    try {
      switch (it.kind) {
        case 'pad':
          break;
        case 'bytes':
          it.bytes.forEach((b, i) => put(it.addr + i, b));
          break;
        case 'db': {
          let a = it.addr;
          for (const o of it.ops) {
            const str = parseString(o);
            if (str !== null) for (const ch of str) put(a++, ch.charCodeAt(0) & 0xff);
            else put(a++, checkByte(evalExpr(o, lookup)));
          }
          break;
        }
        case 'dw': {
          let a = it.addr;
          for (const o of it.ops) {
            const v = evalExpr(o, lookup);
            if (v < -32768 || v > 0xffff) throw new AsmError(`數值 ${v} 放不進 2 個位元組(-32768 ~ 65535)`);
            put(a++, (v >> 8) & 0xff);
            put(a++, v & 0xff);
          }
          break;
        }
        case 'ins': {
          const op = encode(it.word, it.ops, symbols, lookup);
          put(it.addr, op >> 8);
          put(it.addr + 1, op & 0xff);
          break;
        }
      }
    } catch (e) {
      if (!(e instanceof AsmError)) throw e;
      fail(it.line, e.message);
    }
  }

  errors.sort((a, b) => a.line - b.line);
  const labels = {};
  for (const [k, v] of symbols) if (v.kind === 'label') labels[k] = v.value;
  return {
    ok: errors.length === 0,
    errors,
    bytes: errors.length === 0 ? out : null,
    origin: PROGRAM_START,
    labels,
    lines,
  };
}

export function formatError(e) {
  return `第 ${e.line} 行:${e.message}`;
}

// ---------- 指令編碼 ----------

function checkByte(v) {
  if (v < -128 || v > 255) throw new AsmError(`數值 ${v} 放不進 1 個位元組(範圍 -128 ~ 255)`);
  return v & 0xff;
}
function checkAddr(v) {
  if (v < 0 || v > 0xfff) throw new AsmError(`位址 ${v < 0 ? v : hex(v)} 超出範圍(必須在 0x000 到 0xFFF 之間)`);
  return v;
}
function checkNibble(v) {
  if (v < 0 || v > 15) throw new AsmError(`數值 ${v} 必須在 0 到 15 之間`);
  return v;
}

function classify(text, symbols, lookup) {
  const t = text.trim();
  if (t === '') throw new AsmError('運算元是空的(逗號前後少了東西)');
  const lower = t.toLowerCase().replace(/\s+/g, '');
  if (lower === '[i]') return { k: 'MEM' };
  let m = V_REG.exec(t);
  if (m) return { k: 'V', n: parseInt(m[1], 16) };
  if (REG_WORDS.has(lower)) return { k: lower.toUpperCase() };
  const s = IDENT.test(t) ? symbols.get(t) : undefined;
  if (s && s.kind === 'reg') return { k: 'V', n: s.value };
  return { k: 'NUM', v: evalExpr(t, lookup) };
}

const KIND_NAME = {
  V: '暫存器', I: 'i', DT: 'dt', ST: 'st', F: 'f', HF: 'hf', B: 'b', R: 'r', K: 'k', MEM: '[i]', NUM: '數值',
};

function encode(word, rawOps, symbols, lookup) {
  const count = (n) => {
    if (rawOps.length !== n) {
      throw new AsmError(n === 0 ? `「${word}」不需要運算元,但寫了 ${rawOps.length} 個` : `「${word}」需要 ${n} 個運算元,但寫了 ${rawOps.length} 個`);
    }
  };
  const ops = () => rawOps.map((o) => classify(o, symbols, lookup));
  const bad = (o) => new AsmError(`「${word}」的運算元不合法:${rawOps.join(', ')}(${o})`);
  const vv = (x, y, low) => 0x8000 | (x << 8) | (y << 4) | low;

  switch (word) {
    case 'cls': count(0); return 0x00e0;
    case 'ret': count(0); return 0x00ee;
    case 'exit': count(0); return 0x00fd;
    case 'low': count(0); return 0x00fe;
    case 'high': count(0); return 0x00ff;
    case 'scr': count(0); return 0x00fb;
    case 'scl': count(0); return 0x00fc;
    case 'scd': {
      count(1);
      const [a] = ops();
      if (a.k !== 'NUM') throw bad('要填 0 到 15 的數字');
      return 0x00c0 | checkNibble(a.v);
    }
    case 'sys': case 'call': {
      count(1);
      const [a] = ops();
      if (a.k !== 'NUM') throw bad('要填位址或標籤');
      return (word === 'sys' ? 0x0000 : 0x2000) | checkAddr(a.v);
    }
    case 'jp': {
      if (rawOps.length === 1) {
        const [a] = ops();
        if (a.k !== 'NUM') throw bad('要填位址或標籤');
        return 0x1000 | checkAddr(a.v);
      }
      count(2);
      const [a, b] = ops();
      if (a.k !== 'V' || a.n !== 0) throw new AsmError('「jp」加偏移時,第一個運算元必須是 v0(寫成 jp v0, 位址)');
      if (b.k !== 'NUM') throw bad('要填位址或標籤');
      return 0xb000 | checkAddr(b.v);
    }
    case 'se': case 'sne': {
      count(2);
      const [a, b] = ops();
      if (a.k !== 'V') throw new AsmError(`「${word}」的第一個運算元必須是暫存器(v0 到 vf)`);
      const base = word === 'se' ? 0x3000 : 0x4000;
      if (b.k === 'NUM') return base | (a.n << 8) | checkByte(b.v);
      if (b.k === 'V') return (word === 'se' ? 0x5000 : 0x9000) | (a.n << 8) | (b.n << 4);
      throw bad('第二個運算元要是數值或暫存器');
    }
    case 'add': {
      count(2);
      const [a, b] = ops();
      if (a.k === 'I' && b.k === 'V') return 0xf01e | (b.n << 8);
      if (a.k !== 'V') throw new AsmError('「add」的第一個運算元必須是暫存器或 i');
      if (b.k === 'NUM') return 0x7000 | (a.n << 8) | checkByte(b.v);
      if (b.k === 'V') return vv(a.n, b.n, 4);
      throw bad('第二個運算元要是數值或暫存器');
    }
    case 'or': case 'and': case 'xor': case 'sub': case 'subn': {
      count(2);
      const [a, b] = ops();
      if (a.k !== 'V' || b.k !== 'V') throw new AsmError(`「${word}」的兩個運算元都必須是暫存器`);
      return vv(a.n, b.n, { or: 1, and: 2, xor: 3, sub: 5, subn: 7 }[word]);
    }
    case 'shr': case 'shl': {
      if (rawOps.length !== 1 && rawOps.length !== 2) throw new AsmError(`「${word}」需要 1 或 2 個暫存器運算元`);
      const o = ops();
      if (o.some((r) => r.k !== 'V')) throw new AsmError(`「${word}」的運算元必須是暫存器`);
      return vv(o[0].n, (o[1] || o[0]).n, word === 'shr' ? 6 : 0xe);
    }
    case 'rnd': {
      count(2);
      const [a, b] = ops();
      if (a.k !== 'V' || b.k !== 'NUM') throw new AsmError('「rnd」的格式是 rnd vx, 遮罩');
      return 0xc000 | (a.n << 8) | checkByte(b.v);
    }
    case 'drw': {
      count(3);
      const [a, b, c] = ops();
      if (a.k !== 'V' || b.k !== 'V' || c.k !== 'NUM') throw new AsmError('「drw」的格式是 drw vx, vy, 高度(0 到 15)');
      return 0xd000 | (a.n << 8) | (b.n << 4) | checkNibble(c.v);
    }
    case 'skp': case 'sknp': {
      count(1);
      const [a] = ops();
      if (a.k !== 'V') throw new AsmError(`「${word}」的運算元必須是暫存器`);
      return 0xe000 | (a.n << 8) | (word === 'skp' ? 0x9e : 0xa1);
    }
    case 'ld': {
      count(2);
      const [a, b] = ops();
      const pair = `${a.k},${b.k}`;
      switch (pair) {
        case 'V,NUM': return 0x6000 | (a.n << 8) | checkByte(b.v);
        case 'V,V': return vv(a.n, b.n, 0);
        case 'I,NUM': return 0xa000 | checkAddr(b.v);
        case 'V,DT': return 0xf007 | (a.n << 8);
        case 'V,K': return 0xf00a | (a.n << 8);
        case 'DT,V': return 0xf015 | (b.n << 8);
        case 'ST,V': return 0xf018 | (b.n << 8);
        case 'F,V': return 0xf029 | (b.n << 8);
        case 'HF,V': return 0xf030 | (b.n << 8);
        case 'B,V': return 0xf033 | (b.n << 8);
        case 'MEM,V': return 0xf055 | (b.n << 8);
        case 'V,MEM': return 0xf065 | (a.n << 8);
        case 'R,V':
          if (b.n > 7) throw new AsmError('「ld r, vx」的 x 只能是 0 到 7');
          return 0xf075 | (b.n << 8);
        case 'V,R':
          if (a.n > 7) throw new AsmError('「ld vx, r」的 x 只能是 0 到 7');
          return 0xf085 | (a.n << 8);
      }
      throw new AsmError(`「ld」不支援這種組合:${KIND_NAME[a.k]} 與 ${KIND_NAME[b.k]}(${rawOps.join(', ')})`);
    }
  }
  throw new AsmError(`不認得的指令「${word}」`);
}
