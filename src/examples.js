// 內建範例程式清單。原始碼放在 examples/*.c8asm,網頁用 fetch 載入。
export const EXAMPLES = [
  { id: 'bounce', file: 'examples/bounce.c8asm', title: '彈跳球', hint: '不需操作。看球在牆壁間彈跳。' },
  { id: 'pong', file: 'examples/pong.c8asm', title: '乒乓球', hint: '左:1 上、Q 下。右:4 上、R 下(預設電腦操控右邊)。' },
  { id: 'snake', file: 'examples/snake.c8asm', title: '貪食蛇', hint: 'W / A / S / D 控制方向。死後按任意鍵重來。' },
  { id: 'keytest', file: 'examples/keytest.c8asm', title: '字型與鍵盤測試', hint: '按下任意 CHIP-8 鍵,對應字型下方出現底線。' },
  { id: 'hires', file: 'examples/hires.c8asm', title: 'SUPER-CHIP 高解析', hint: '4 / 6 / 8 捲動畫面,5 回到低解析度。' },
];
