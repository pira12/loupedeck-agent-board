// Render the whole 5×3 board as the device shows it.
//   node scripts/board-preview.mjs out.png          sessions from the running service
//   node scripts/board-preview.mjs --demo out.png   made-up demo sessions (used for the README)
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { createCanvas } from 'canvas'
import { SessionStore } from '../src/store.js'
import { Board } from '../src/board.js'
import { loadMascots } from '../src/sprites.js'
import { TokenCounter } from '../src/tokens.js'

const args = process.argv.slice(2)
const demo = args.includes('--demo')
const outFile = args.find(a => !a.startsWith('--'))
if (!outFile) {
    console.error('usage: board-preview.mjs [--demo] out.png')
    process.exit(2)
}

await loadMascots()

const NOW = new Date(2026, 0, 15, 14, 30).getTime()
const min = m => m * 60_000

export function demoStore() {
    const store = new SessionStore(() => NOW)
    const add = (id, agent, name, status, sinceMin, startedMin) => store.sessions.set(id, {
        id, agent, name, cwd: `/home/me/code/${name}`, status,
        since: NOW - min(sinceMin), started: NOW - min(startedMin),
        tilixId: '00000000-0000-4000-8000-000000000000', pid: null, proc: agent === 'codex',
    })
    add('c1', 'claude', 'webshop', 'working', 6, 90)
    add('c2', 'claude', 'api-server', 'waiting', 1, 80)
    add('c3', 'claude', 'docs', 'done', 0.2, 70)
    add('c4', 'claude', 'mobile-app', 'idle', 25, 60)
    add('x1', 'codex', 'blog', 'working', 3, 50)
    add('x2', 'codex', 'infra', 'done', 0.1, 40)
    add('x3', 'codex', 'data-etl', 'idle', 42, 30)
    Object.assign(store.daily, { prompts: 47, finished: 31, waitMs: min(18) + 40_000 })
    return store
}

let store, tokens
if (demo) {
    store = demoStore()
    tokens = () => ({ claude: 1_840_000, codex: 412_000 })
} else {
    const sessions = await (await fetch('http://127.0.0.1:47800/sessions')).json()
    store = SessionStore.fromJSON({ sessions })
    const counter = new TokenCounter()
    counter.scan()
    tokens = () => counter.totals()
}

const K = 90, G = 6, S = 2, PAD = 14
const out = createCanvas((5 * (K + G) - G + 2 * PAD) * S, (3 * (K + G) - G + 2 * PAD) * S)
const octx = out.getContext('2d')
octx.fillStyle = '#1c1c1e'
octx.fillRect(0, 0, out.width, out.height)
class Dev extends EventEmitter {
    async drawKey(key, cb) {
        const c = createCanvas(K, K)
        cb(c.getContext('2d'), K, K)
        octx.drawImage(c, (PAD + (key % 5) * (K + G)) * S, (PAD + Math.floor(key / 5) * (K + G)) * S, K * S, K * S)
    }
    async setBrightness() {}
    async setButtonColor() {}
}
const board = new Board(store, { focus: async () => true, tokens, now: () => (demo ? NOW + 1250 : Date.now()) })
board.attach(new Dev())
board.connected = true
await board.drawAll()
fs.writeFileSync(outFile, out.toBuffer('image/png'))
console.log(`wrote ${outFile}`)
