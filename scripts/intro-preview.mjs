// Render intro frames as a contact sheet: node scripts/intro-preview.mjs out.png [ms,ms,...]
import fs from 'node:fs'
import { createCanvas } from 'canvas'
import { loadMascots } from '../src/sprites.js'
import { drawIntroFrame } from '../src/intro.js'

await loadMascots()
const times = (process.argv[3] ?? '0,500,1000,1500,1900,2400,2800,3700').split(',').map(Number)
const stats = { counts: { working: 1, waiting: 1, done: 2, idle: 4 } }
const W = 480, H = 270, cols = 2
const out = createCanvas(cols * W + 10, Math.ceil(times.length / cols) * (H + 10))
const o = out.getContext('2d')
o.fillStyle = '#444'; o.fillRect(0, 0, out.width, out.height)
times.forEach((t, i) => {
    const c = createCanvas(W, H)
    const cx = c.getContext('2d')
    drawIntroFrame(cx, W, H, t, stats)
    // simulate the device's plastic key dividers
    cx.fillStyle = '#555'
    for (let k = 0; k <= 5; k++) cx.fillRect(15 + k * 90 - 2, 0, 4, H)
    for (let r = 1; r < 3; r++) cx.fillRect(0, r * 90 - 2, W, 4)
    cx.fillRect(0, 0, 15, H); cx.fillRect(465, 0, 15, H)
    o.drawImage(c, (i % cols) * (W + 10), Math.floor(i / cols) * (H + 10))
    o.fillStyle = '#ff0'; o.font = '12px sans-serif'; o.fillText(`${t}ms`, (i % cols) * (W + 10) + 4, Math.floor(i / cols) * (H + 10) + 12)
})
fs.writeFileSync(process.argv[2], out.toBuffer('image/png'))
