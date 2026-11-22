import path from 'node:path'

/** Maps Claude Code hook event names to board status. null = remove session. */
export const EVENT_STATUS = {
    SessionStart: 'idle',
    UserPromptSubmit: 'working',
    PreToolUse: 'working',
    PostToolUse: 'working',
    Notification: 'waiting',
    PermissionRequest: 'waiting', // Codex
    Stop: 'done',
    SessionEnd: null,
}

/** Local calendar day, e.g. "2026-11-22". */
export function dayKey(t) {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const emptyDaily = day => ({ day, prompts: 0, finished: 0, waitMs: 0 })

export class SessionStore {
    constructor(now = Date.now) {
        this.now = now
        this.sessions = new Map()
        this.daily = emptyDaily(dayKey(now()))
    }

    /** Today's counters (rolls over at local midnight). */
    today() {
        const day = dayKey(this.now())
        if (this.daily.day !== day) this.daily = emptyDaily(day)
        return this.daily
    }

    /** Apply a hook event. Returns true if anything visible changed. */
    applyEvent(evt) {
        const id = evt?.session_id
        if (!id || !(evt.event in EVENT_STATUS)) return false
        if (evt.event === 'UserPromptSubmit') this.today().prompts++
        if (evt.agent === 'codex') return this.applyCodexEvent(evt)
        const status = EVENT_STATUS[evt.event]

        if (status === null) return this.sessions.delete(id)

        const t = this.now()
        let s = this.sessions.get(id)
        let changed = false
        if (!s) {
            s = {
                id,
                cwd: evt.cwd || '',
                name: path.basename(evt.cwd || '') || id.slice(0, 8),
                tilixId: evt.tilix_id || null,
                pid: evt.pid || null,
                agent: evt.agent || 'claude',
                status,
                since: t,
                started: t,
            }
            if (status === 'done') this.today().finished++
            this.sessions.set(id, s)
            return true
        }
        if (evt.tilix_id && s.tilixId !== evt.tilix_id) { s.tilixId = evt.tilix_id; changed = true }
        if (evt.pid && s.pid !== evt.pid) { s.pid = evt.pid; changed = true }
        if (evt.agent && s.agent !== evt.agent) { s.agent = evt.agent; changed = true }
        if (evt.cwd && s.cwd !== evt.cwd) {
            s.cwd = evt.cwd
            s.name = path.basename(evt.cwd) || s.name
            changed = true
        }
        return this.setStatus(s, status) || changed
    }

    /** Change status, keeping daily counters (tasks finished, time spent waiting on the user). */
    setStatus(s, status) {
        if (s.status === status) return false
        const t = this.now()
        const daily = this.today()
        if (s.status === 'waiting') daily.waitMs += Math.max(0, t - s.since)
        if (status === 'done') daily.finished++
        s.status = status
        s.since = t
        return true
    }

    /**
     * Codex runs hooks in a shared app-server, so the hook's tab/pid belong to whichever
     * terminal started that server. Terminals come from process discovery instead
     * (syncCodexProcesses); hooks are linked to them by thread id, else by cwd.
     */
    applyCodexEvent(evt) {
        const status = EVENT_STATUS[evt.event]
        const codex = [...this.sessions.values()].filter(x => x.agent === 'codex')
        let s = codex.find(x => x.threadId === evt.session_id)
        if (!s && evt.cwd) {
            const candidates = codex.filter(x => x.proc && x.cwd === evt.cwd)
            s = candidates.find(x => !x.threadId) ?? (candidates.length === 1 ? candidates[0] : null)
            if (s) s.threadId = evt.session_id
        }
        if (status === null) {
            if (!s) return false
            if (!s.proc) return this.sessions.delete(s.id)
            s.threadId = null
            return this.setStatus(s, 'idle')
        }
        if (!s) {
            const t = this.now()
            this.sessions.set(evt.session_id, {
                id: evt.session_id,
                cwd: evt.cwd || '',
                name: path.basename(evt.cwd || '') || evt.session_id.slice(0, 8),
                tilixId: null,
                pid: null,
                agent: 'codex',
                threadId: evt.session_id,
                proc: false,
                status,
                since: t,
                started: t,
            })
            if (status === 'done') this.today().finished++
            return true
        }
        return this.setStatus(s, status)
    }

    /** Add a session for every running Codex terminal not yet on the board. */
    syncCodexProcesses(procs) {
        let changed = false
        const known = new Set([...this.sessions.values()].filter(x => x.proc).map(x => x.pid))
        for (const p of procs) {
            if (known.has(p.pid)) continue
            const t = this.now()
            const s = {
                id: `codex-pid-${p.pid}`,
                cwd: p.cwd,
                name: path.basename(p.cwd) || 'codex',
                tilixId: p.tilixId,
                pid: p.pid,
                agent: 'codex',
                threadId: null,
                proc: true,
                status: 'idle',
                since: t,
                started: t,
            }
            // a hook-only session for this folder (seen before discovery) hands over its state
            const orphan = [...this.sessions.values()].find(x => x.agent === 'codex' && !x.proc && x.cwd === p.cwd)
            if (orphan) {
                Object.assign(s, { threadId: orphan.threadId, status: orphan.status, since: orphan.since })
                this.sessions.delete(orphan.id)
            }
            this.sessions.set(s.id, s)
            changed = true
        }
        return changed
    }

    /** User visited the session: done → idle. */
    markSeen(id) {
        const s = this.sessions.get(id)
        if (!s || s.status !== 'done') return false
        return this.setStatus(s, 'idle')
    }

    /** Remove sessions whose Claude process is gone. */
    prune(isAlive) {
        let changed = false
        for (const [id, s] of this.sessions) {
            if (s.pid != null && !isAlive(s.pid)) {
                this.sessions.delete(id)
                changed = true
            }
        }
        return changed
    }

    list() {
        return [...this.sessions.values()].sort((a, b) => a.started - b.started || a.id.localeCompare(b.id))
    }

    oldestWaiting() {
        let best = null
        for (const s of this.sessions.values()) {
            if (s.status === 'waiting' && (!best || s.since < best.since)) best = s
        }
        return best
    }

    /** Snapshot for stat keys. */
    stats() {
        const list = this.list()
        const counts = { working: 0, waiting: 0, done: 0, idle: 0 }
        for (const s of list) counts[s.status] = (counts[s.status] ?? 0) + 1
        const working = list.filter(s => s.status === 'working').sort((a, b) => a.since - b.since)[0] ?? null
        const t = this.now()
        const daily = this.today()
        // include time sessions are waiting right now
        const waitingNow = list.filter(s => s.status === 'waiting').reduce((sum, s) => sum + (t - s.since), 0)
        return {
            counts,
            prompts: daily.prompts,
            finished: daily.finished,
            waitMs: daily.waitMs + waitingNow,
            longest: working ? { name: working.name, agent: working.agent, ms: t - working.since } : null,
        }
    }

    toJSON() {
        return { sessions: this.list(), daily: this.daily }
    }

    static fromJSON(obj, now = Date.now) {
        const store = new SessionStore(now)
        for (const s of obj?.sessions ?? []) {
            if (s?.id) store.sessions.set(s.id, { ...s })
        }
        if (obj?.daily?.day) store.daily = { ...emptyDaily(obj.daily.day), ...obj.daily }
        return store
    }
}
