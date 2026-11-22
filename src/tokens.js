import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dayKey } from './store.js'

/**
 * Counts today's token usage from Claude Code and Codex transcripts.
 * "Tokens" = fresh input + output. Cache reads are excluded: they re-count the whole
 * conversation on every message and would dwarf everything else.
 *
 * Claude: ~/.claude/projects/** /*.jsonl, assistant lines with message.usage
 *   (several lines can share one message id → deduped, last one wins).
 * Codex:  ~/.codex/sessions/** /*.jsonl, payload.type === 'token_count' → info.last_token_usage.
 */
export class TokenCounter {
    constructor({
        claudeDir = path.join(os.homedir(), '.claude', 'projects'),
        codexDir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'),
        now = Date.now,
    } = {}) {
        Object.assign(this, { claudeDir, codexDir, now })
        this.reset(dayKey(now()))
    }

    reset(day) {
        this.day = day
        this.offsets = new Map() // file → bytes already read
        this.partial = new Map() // file → trailing incomplete line
        this.claudeMsgs = new Map() // message id → tokens
        this.codex = 0
    }

    totals() {
        let claude = 0
        for (const v of this.claudeMsgs.values()) claude += v
        return { claude, codex: this.codex }
    }

    /** Read new transcript lines. Returns true if totals changed. */
    scan() {
        const today = dayKey(this.now())
        if (today !== this.day) this.reset(today)
        const before = JSON.stringify(this.totals())
        const midnight = new Date(this.now()).setHours(0, 0, 0, 0)
        for (const f of recentJsonl(this.claudeDir, midnight, 3)) this.readNew(f, line => this.claudeLine(line))
        for (const f of recentJsonl(this.codexDir, midnight, 4)) this.readNew(f, line => this.codexLine(line))
        return JSON.stringify(this.totals()) !== before
    }

    readNew(file, onLine) {
        let fd
        try {
            const size = fs.statSync(file).size
            let offset = this.offsets.get(file) ?? 0
            if (size < offset) offset = 0 // truncated/rewritten
            if (size === offset) return
            fd = fs.openSync(file, 'r')
            const buf = Buffer.alloc(size - offset)
            fs.readSync(fd, buf, 0, buf.length, offset)
            this.offsets.set(file, size)
            const text = (this.partial.get(file) ?? '') + buf.toString('utf8')
            const lines = text.split('\n')
            this.partial.set(file, lines.pop())
            for (const line of lines) {
                if (!line.includes('usage')) continue // cheap pre-filter
                let obj
                try { obj = JSON.parse(line) } catch { continue }
                if (obj?.timestamp && dayKey(Date.parse(obj.timestamp)) !== this.day) continue
                onLine(obj)
            }
        } catch {
            // file vanished or unreadable; skip
        } finally {
            if (fd !== undefined) fs.closeSync(fd)
        }
    }

    claudeLine(obj) {
        const u = obj?.message?.usage
        if (obj?.type !== 'assistant' || !u) return
        const id = obj.message.id ?? obj.uuid
        const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0)
        this.claudeMsgs.set(id, tokens)
    }

    codexLine(obj) {
        const p = obj?.payload
        if (p?.type !== 'token_count') return
        const u = p.info?.last_token_usage
        if (!u) return
        this.codex += Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)) + (u.output_tokens ?? 0)
    }
}

/** .jsonl files under dir (max depth) modified since `since`. */
function recentJsonl(dir, since, depth) {
    const out = []
    const walk = (d, level) => {
        let entries
        try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
            const p = path.join(d, e.name)
            if (e.isDirectory()) {
                if (level < depth) walk(p, level + 1)
            } else if (e.name.endsWith('.jsonl')) {
                try { if (fs.statSync(p).mtimeMs >= since) out.push(p) } catch {}
            }
        }
    }
    walk(dir, 1)
    return out
}

/** 1234 → "1.2k", 1234567 → "1.2M" */
export function formatTokens(n) {
    if (n < 1000) return String(n)
    if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`
    return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`
}
