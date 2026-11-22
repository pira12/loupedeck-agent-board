// Render the startup animation to an animated GIF (for the README): node scripts/intro-gif.mjs out.gif
import fs from 'node:fs'
import { createCanvas } from 'canvas'
import sharp from 'sharp'
import { loadMascots } from '../src/sprites.js'
import { drawIntroFrame, INTRO_MS, INTRO_FPS, GRID } from '../src/intro.js'

await loadMascots()
const stats = { counts: { working: 2, waiting: 1, done: 2, idle: 2 } }
const W = 480, H = 270, S = 1.5
const frameMs = 1000 / INTRO_FPS
const frames = []
for (let t = 0; t <= INTRO_MS + 800; t += frameMs) {
    const c = createCanvas(W, H)
    const ctx = c.getContext('2d')
    drawIntroFrame(ctx, W, H, Math.min(t, INTRO_MS - 1), stats)
    // the device's plastic key dividers
    ctx.fillStyle = '#1c1c1e'
    for (let k = 0; k <= GRID.cols; k++) ctx.fillRect(GRID.x0 + k * GRID.size - 3, 0, 6, H)
    for (let r = 0; r <= GRID.rows; r++) ctx.fillRect(0, r * GRID.size - 3, W, 6)
    ctx.fillRect(0, 0, GRID.x0, H)
    ctx.fillRect(GRID.x0 + GRID.cols * GRID.size, 0, W, H)
    const big = createCanvas(W * S, H * S)
    const b = big.getContext('2d')
    b.imageSmoothingEnabled = false
    b.drawImage(c, 0, 0, W * S, H * S)
    frames.push(await sharp(big.toBuffer('image/png')).toBuffer())
}
await sharp(frames, { join: { animated: true } })
    .gif({ delay: frames.map(() => Math.round(frameMs)), loop: 0, effort: 7 })
    .toFile(process.argv[2])
console.log(`wrote ${process.argv[2]} (${frames.length} frames)`)
