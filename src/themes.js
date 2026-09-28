// 畫面配色。全部是實色,前景 = 亮起的像素,背景 = 熄滅的像素。
export const THEMES = [
  { id: 'green', name: '綠底', fg: '#8fd694', bg: '#0f2418' },
  { id: 'amber', name: '琥珀', fg: '#ffb000', bg: '#1c1200' },
  { id: 'mono', name: '黑白', fg: '#ffffff', bg: '#000000' },
  { id: 'paper', name: '紙張', fg: '#1d1d1b', bg: '#efeadb' },
  { id: 'blue', name: '藍圖', fg: '#cfe3ff', bg: '#12305c' },
];

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// '#rrggbb' -> 給 Uint32Array 寫進 ImageData 用的數值(little-endian ABGR)
export function colorToU32(hex) {
  if (!HEX_COLOR.test(hex)) throw new Error('顏色必須是 #rrggbb');
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
