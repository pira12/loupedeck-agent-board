// Render a preview sheet of keys: node scripts/preview.mjs <out.png> [claude,codex]
import fs from 'node:fs'
import { createCanvas } from 'canvas'
const root = new URL("..", import.meta.url).pathname
const { keyView, drawSession } = await import(`${root}/src/render.js`)
await (await import(`${root}/src/sprites.js`)).loadMascots(root)
const out = process.argv[2]
const agents = process.argv[3] ? process.argv[3].split(',') : ['claude', 'codex']
const statuses = ['working', 'waiting', 'done', 'idle']
const S = 2, K = 90, G = 8
const rows = agents.length * 2
const c = createCanvas((statuses.length * (K + G) + G) * S, (rows * (K + G) + G) * S)
const ctx = c.getContext('2d')
ctx.fillStyle = '#222'; ctx.fillRect(0, 0, c.width, c.height)
agents.forEach((agent, ai) => [0, 1].forEach(frame => {
    statuses.forEach((status, i) => {
        const key = createCanvas(K, K)
        const now = 125_000 + frame * 500
        drawSession(key.getContext('2d'), K, K, keyView({ id: 'x', name: agent === 'codex' ? 'blog' : 'webshop', status, since: status === 'done' ? now - 5000 : 0, started: 0, tilixId: 'x', agent }, now), agent === 'codex' ? frame * 3 : frame)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(key, (G + i * (K + G)) * S, (G + (ai * 2 + frame) * (K + G)) * S, K * S, K * S)
    })
}))
fs.writeFileSync(out, c.toBuffer('image/png'))
