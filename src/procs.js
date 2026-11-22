import fs from 'node:fs'
import path from 'node:path'

// Codex subcommands that are not an interactive terminal session
const NON_TUI = new Set(['app-server', 'exec-server', 'exec', 'e', 'mcp', 'mcp-server', 'login', 'logout', 'completion', 'debug', 'apply', 'cloud'])

/**
 * Find interactive Codex terminal sessions by scanning /proc.
 * Codex runs hooks in a shared app-server, so the hook's own environment can't tell
 * which terminal a session lives in; the TUI process can.
 * @returns {{pid:number, cwd:string, tilixId:string|null}[]}
 */
export function scanCodexProcesses(procRoot = '/proc') {
    let entries
    try {
        entries = fs.readdirSync(procRoot)
    } catch {
        return []
    }
    const out = []
    for (const name of entries) {
        if (!/^\d+$/.test(name)) continue
        const dir = path.join(procRoot, name)
        try {
            if (fs.readFileSync(path.join(dir, 'comm'), 'utf8').trim() !== 'codex') continue
            const argv = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8').split('\0').filter(Boolean)
            if (argv.slice(1).some(a => NON_TUI.has(a))) continue
            const env = fs.readFileSync(path.join(dir, 'environ'), 'utf8').split('\0')
            const tilix = env.find(e => e.startsWith('TILIX_ID='))?.slice('TILIX_ID='.length) || null
            out.push({ pid: Number(name), cwd: fs.readlinkSync(path.join(dir, 'cwd')), tilixId: tilix })
        } catch {
            // process vanished or is not ours
        }
    }
    return out
}
