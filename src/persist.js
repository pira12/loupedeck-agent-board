import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SessionStore } from './store.js'

export const DEFAULT_STATE_FILE = path.join(
    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'loupedeck-claude', 'sessions.json',
)

export function loadStore(file = DEFAULT_STATE_FILE, now = Date.now) {
    try {
        return SessionStore.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')), now)
    } catch {
        return new SessionStore(now)
    }
}

export function saveStore(store, file = DEFAULT_STATE_FILE) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(store))
    fs.renameSync(tmp, file)
}
