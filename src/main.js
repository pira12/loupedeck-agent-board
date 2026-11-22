import { LoupedeckLiveS } from 'loupedeck'
import { Board } from './board.js'
import { focusTerminal } from './focus.js'
import { startServer } from './server.js'
import { loadStore, saveStore, DEFAULT_STATE_FILE } from './persist.js'
import { loadMascots } from './sprites.js'
import { scanCodexProcesses } from './procs.js'
import { TokenCounter } from './tokens.js'
import { killSessions, openAgentTab } from './actions.js'
import { playIntro } from './intro.js'

const PORT = Number(process.env.LOUPEDECK_CLAUDE_PORT) || 47800
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`)

function isAlive(pid) {
    try {
        process.kill(pid, 0)
        return true
    } catch (e) {
        return e.code === 'EPERM'
    }
}

await loadMascots()
const store = loadStore(DEFAULT_STATE_FILE)
store.prune(isAlive)
store.syncCodexProcesses(scanCodexProcesses())
const tokens = new TokenCounter()
tokens.scan()
const board = new Board(store, {
    focus: focusTerminal,
    killAll: sessions => killSessions(sessions, { log }),
    newTab: (agent, cwd) => openAgentTab(agent, cwd),
    tokens: () => tokens.totals(),
    intro: (device, opts) => playIntro(device, () => store.stats(), opts),
    log,
})

let saveTimer = null
function changed() {
    board.render()
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
        try { saveStore(store, DEFAULT_STATE_FILE) } catch (e) { log(`save failed: ${e.message}`) }
    }, 500)
}
board.on('change', changed)

await startServer(store, changed, PORT)
log(`listening on 127.0.0.1:${PORT}, ${store.list().length} session(s) restored`)

const device = new LoupedeckLiveS({ reconnectInterval: 3000, autoConnect: false })
board.attach(device)
device.connect().catch(e => log(`waiting for Loupedeck: ${e.message ?? e}`))

// Discover Codex terminals (their hooks can't tell us which tab they're in)
setInterval(() => { if (store.syncCodexProcesses(scanCodexProcesses())) changed() }, 2000)
// Token usage from transcripts
setInterval(() => { if (tokens.scan()) board.render() }, 30_000)
// Prune closed sessions
setInterval(() => { if (store.prune(isAlive)) changed() }, 5000)
// Tick: elapsed times + pulsing (only changed keys are actually sent)
setInterval(() => board.render(), 200)

async function shutdown() {
    log('shutting down')
    try { saveStore(store, DEFAULT_STATE_FILE) } catch {}
    try { await device.close() } catch {}
    process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
