import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

const AGENT_COMMS = new Set(['claude', 'codex'])
const AGENT_COMMANDS = { claude: 'claude', codex: 'codex' }

function readComm(pid) {
    try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() } catch { return null }
}

/**
 * End every Claude/Codex session process (tabs stay open: the shell that launched it remains).
 * Re-checks the process name right before signalling so a recycled pid is never hit.
 * Returns the number of processes signalled.
 */
export function killSessions(sessions, {
    kill = (pid, sig) => process.kill(pid, sig),
    comm = readComm,
    graceMs = 5000,
    log = () => {},
} = {}) {
    const pids = [...new Set(sessions.map(s => s.pid).filter(pid => pid > 1 && pid !== process.pid))]
    const targets = pids.filter(pid => AGENT_COMMS.has(comm(pid)))
    for (const pid of targets) {
        try { kill(pid, 'SIGTERM'); log(`SIGTERM ${pid}`) } catch {}
    }
    if (graceMs > 0 && targets.length) {
        setTimeout(() => {
            for (const pid of targets) {
                if (AGENT_COMMS.has(comm(pid))) {
                    try { kill(pid, 'SIGKILL'); log(`SIGKILL ${pid} (ignored SIGTERM)`) } catch {}
                }
            }
        }, graceMs).unref?.()
    }
    return targets.length
}

/** Tilix args to open a new tab in `cwd` running the agent, then a shell when it exits. */
export function newTabArgs(agent, cwd, shell) {
    const cmd = AGENT_COMMANDS[agent]
    if (!cmd) throw new Error(`unknown agent ${agent}`)
    return ['-a', 'app-new-session', '-w', cwd, '-e', `${shell} -ic '${cmd}; exec ${shell}'`]
}

export function openAgentTab(agent, cwd, {
    exec = execFile,
    shell = os.userInfo().shell || '/bin/bash',
    home = os.homedir(),
} = {}) {
    let dir = home
    try { if (cwd && fs.statSync(cwd).isDirectory()) dir = cwd } catch {}
    const args = newTabArgs(agent, dir, shell)
    return new Promise(resolve => exec('tilix', args, { timeout: 5000 }, err => resolve(!err)))
}
