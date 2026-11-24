import { EventEmitter } from 'node:events'
import {
    keyView, drawSession, drawEmpty, drawFlash, drawPageBadge, animFrame,
    statTiles, drawStat, drawKillCountdown, drawNotice,
} from './render.js'
import { formatTokens } from './tokens.js'

export const KEYS = 15
const KEYS_PER_ROW = 5
const CLAUDE_ROW = 0
const CODEX_ROW = KEYS_PER_ROW
const STATS_ROW = KEYS_PER_ROW * 2
export const PAGE_KNOB = 'knobTL'
export const BRIGHTNESS_KNOB = 'knobCL'

// Live S round buttons (verified by pressing): 0 under the dials, 1–3 right side top→bottom
export const KILL_BUTTON = 0
export const NEW_CLAUDE_BUTTON = 1
export const NEW_CODEX_BUTTON = 2
export const JUMP_BUTTON = 3
export const KILL_HOLD_MS = 2000
const NOTICE_MS = 2500

const LED = {
    [KILL_BUTTON]: '#a00000',
    [NEW_CLAUDE_BUTTON]: '#d77757',
    [NEW_CODEX_BUTTON]: '#2f5bff',
}

export class Board extends EventEmitter {
    /**
     * @param store SessionStore
     * @param opts.focus (tilixId) => Promise<boolean>
     * @param opts.killAll (sessions) => number         processes signalled
     * @param opts.newTab (agent, cwd) => Promise<boolean>
     * @param opts.tokens () => { claude, codex }
     * @param opts.intro (device, { shouldStop }) => Promise   startup animation, played on connect
     * @param opts.revealMs delay between keys when the board appears after the intro
     * @param opts.drawTimeoutMs give up on a device call the Loupedeck never answers
     */
    constructor(store, {
        focus, killAll = () => 0, newTab = async () => false, tokens = () => ({ claude: 0, codex: 0 }),
        intro = null, revealMs = 45, now = Date.now, log = () => {}, drawTimeoutMs = 2000,
    } = {}) {
        super()
        Object.assign(this, { store, focus, killAll, newTab, tokens, intro, revealMs, now, log, drawTimeoutMs })
        this.resetAbort()
        this.busy = false // intro or reveal in progress: normal rendering paused
        this.skipIntro = false
        this.page = 0
        this.brightness = 0.7
        this.device = null
        this.connected = false
        this.flashing = new Set()
        this.drawing = false
        this.dirty = false
        this.leds = {}
        this.keyCache = new Array(KEYS).fill(null)
        this.lastCwd = null
        this.killStart = null
        this.killTimer = null
        this.notice = null // { text, color, until }
    }

    pageCount() {
        const sessions = this.store.list()
        const claude = sessions.filter(s => s.agent !== 'codex').length
        const codex = sessions.length - claude
        return Math.max(1, Math.ceil(claude / KEYS_PER_ROW), Math.ceil(codex / KEYS_PER_ROW))
    }

    /** Keep each agent on its own row; page overflow independently by agent. */
    visible() {
        this.page = Math.min(this.page, this.pageCount() - 1)
        const sessions = this.store.list()
        const claude = sessions.filter(s => s.agent !== 'codex')
            .slice(this.page * KEYS_PER_ROW, (this.page + 1) * KEYS_PER_ROW)
        const codex = sessions.filter(s => s.agent === 'codex')
            .slice(this.page * KEYS_PER_ROW, (this.page + 1) * KEYS_PER_ROW)
        const slots = new Array(KEYS).fill(null)
        claude.forEach((s, i) => { slots[CLAUDE_ROW + i] = s })
        codex.forEach((s, i) => { slots[CODEX_ROW + i] = s })
        return slots
    }

    sessionAtKey(key) {
        return this.visible()[key] ?? null
    }

    /** Put summary tiles on the third row. */
    statLayout() {
        const tiles = statTiles(this.store.stats(), this.tokens(), formatTokens)
        const layout = new Map()
        tiles.forEach((tile, i) => {
            const key = KEYS - 1 - i
            if (key >= STATS_ROW) layout.set(key, tile)
        })
        return layout
    }

    turnPage(delta) {
        const next = Math.max(0, Math.min(this.pageCount() - 1, this.page + Math.sign(delta)))
        if (next === this.page) return false
        this.page = next
        return true
    }

    adjustBrightness(delta) {
        this.brightness = Math.round(Math.max(0.1, Math.min(1, this.brightness + 0.1 * Math.sign(delta))) * 10) / 10
        return this.brightness
    }

    /** Jump to a session: focus its terminal, mark it seen. */
    async jump(session, key = null) {
        if (!session) return false
        const ok = await this.focus(session.tilixId)
        this.log(`jump ${session.name} (${session.id.slice(0, 8)}) → ${ok ? 'ok' : 'failed'}`)
        if (ok) {
            this.lastCwd = session.cwd || this.lastCwd
            if (this.store.markSeen(session.id)) this.emit('change')
        } else if (key != null) {
            this.flash(key)
        }
        this.render()
        return ok
    }

    async pressKey(key) {
        if (this.killStart != null) return false
        return this.jump(this.sessionAtKey(key), key)
    }

    async pressJumpButton() {
        const s = this.store.oldestWaiting()
        if (!s) return false
        const agentSessions = this.store.list().filter(x => (x.agent === 'codex') === (s.agent === 'codex'))
        const idx = agentSessions.findIndex(x => x.id === s.id)
        this.page = Math.floor(idx / KEYS_PER_ROW)
        const row = s.agent === 'codex' ? CODEX_ROW : CLAUDE_ROW
        return this.jump(s, row + idx % KEYS_PER_ROW)
    }

    async openTab(agent) {
        const ok = await this.newTab(agent, this.lastCwd)
        this.log(`new ${agent} tab in ${this.lastCwd ?? '~'} → ${ok ? 'ok' : 'failed'}`)
        if (!ok) this.showNotice(`couldn't open\n${agent} tab`, '#555')
        return ok
    }

    // ---- kill switch: hold to confirm ----

    startKillHold() {
        if (this.killStart != null) return
        this.killStart = this.now()
        this.log('kill switch: holding')
        this.killTimer = setTimeout(() => this.fireKill(), KILL_HOLD_MS)
        this.killTicker = setInterval(() => this.render(), 100)
        this.render()
    }

    cancelKillHold() {
        if (this.killStart == null) return
        this.log('kill switch: released early, cancelled')
        this.clearKill()
        this.render()
    }

    clearKill() {
        clearTimeout(this.killTimer)
        clearInterval(this.killTicker)
        this.killStart = null
    }

    fireKill() {
        this.clearKill()
        const n = this.killAll(this.store.list())
        this.log(`kill switch: ended ${n} session(s)`)
        this.showNotice(n ? `ENDED ${n}\nSESSION${n === 1 ? '' : 'S'}` : 'NOTHING\nTO END')
        return n
    }

    showNotice(text, color = '#c62828') {
        this.notice = { text, color, until: this.now() + NOTICE_MS }
        this.render()
        setTimeout(() => this.render(), NOTICE_MS + 50)
    }

    flash(key) {
        this.flashing.add(key)
        this.render()
        setTimeout(() => { this.flashing.delete(key); this.render() }, 150)
    }

    handleButton(id) {
        if (id === KILL_BUTTON) return this.startKillHold()
        if (id === NEW_CLAUDE_BUTTON) return this.openTab('claude')
        if (id === NEW_CODEX_BUTTON) return this.openTab('codex')
        if (id === JUMP_BUTTON) return this.pressJumpButton()
    }

    /** Fresh abort signal for device calls on the current connection. */
    resetAbort() {
        const abort = { }
        abort.promise = new Promise((_, reject) => { abort.reject = reject })
        abort.promise.catch(() => {})
        this.abort = abort
    }

    /**
     * Run a device call, but fail it on disconnect or when the device never
     * answers. The loupedeck library waits forever for a reply, and one lost
     * reply would otherwise leave rendering stuck for good.
     */
    deviceCall(fn) {
        let timer
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('device did not respond')), this.drawTimeoutMs)
        })
        return Promise.race([Promise.resolve().then(fn), this.abort.promise, timeout])
            .finally(() => clearTimeout(timer))
    }

    attach(device) {
        this.device = device
        device.on('connect', async info => {
            this.resetAbort()
            this.connected = true
            this.leds = {}
            this.keyCache.fill(null)
            this.log(`device connected ${JSON.stringify(info ?? {})}`)
            try { await this.deviceCall(() => device.setBrightness(this.brightness)) } catch {}
            await this.startup()
        })
        device.on('disconnect', err => {
            this.connected = false
            this.abort.reject(new Error('device disconnected'))
            this.cancelKillHold()
            this.log(`device disconnected${err ? `: ${err.message ?? err}` : ''}`)
        })
        device.on('touchstart', ({ changedTouches }) => {
            if (this.busy) { this.skipIntro = true; return }
            const key = changedTouches?.[0]?.target?.key
            if (key != null) this.pressKey(key).catch(e => this.log(`press error: ${e.message}`))
        })
        device.on('down', ({ id }) => {
            if (this.busy) { this.skipIntro = true; return }
            Promise.resolve(this.handleButton(id)).catch(e => this.log(`button ${id} error: ${e.message}`))
        })
        device.on('up', ({ id }) => {
            if (id === KILL_BUTTON) this.cancelKillHold()
        })
        device.on('rotate', ({ id, delta }) => {
            if (id === PAGE_KNOB) {
                if (this.turnPage(delta)) this.render()
            } else if (id === BRIGHTNESS_KNOB) {
                device.setBrightness(this.adjustBrightness(delta)).catch(() => {})
            }
        })
    }

    /** Intro animation, then reveal the keys one by one. */
    async startup() {
        if (this.busy) return
        this.busy = true
        this.skipIntro = false
        try {
            if (this.intro) {
                const device = { drawScreen: (...args) => this.deviceCall(() => this.device.drawScreen(...args)) }
                await this.intro(device, { shouldStop: () => this.skipIntro || !this.connected })
            }
            const content = this.keyContent(this.now())
            const order = [...Array(KEYS).keys()]
            for (const key of order) {
                if (!this.connected) break
                const [sig, draw] = content(key)
                this.keyCache[key] = sig
                await this.deviceCall(() => this.device.drawKey(key, draw))
                if (!this.skipIntro && this.revealMs) await new Promise(r => setTimeout(r, this.revealMs))
            }
        } catch (e) {
            this.keyCache.fill(null)
            this.log(`intro error: ${e.message}`)
        } finally {
            this.busy = false
            this.skipIntro = false
        }
        this.render()
    }

    /** Redraw all keys. Coalesces overlapping calls. */
    async render() {
        if (!this.device || !this.connected || this.busy) return
        if (this.drawing) { this.dirty = true; return }
        this.drawing = true
        try {
            do {
                this.dirty = false
                await this.drawAll()
            } while (this.dirty)
        } catch (e) {
            this.keyCache.fill(null)
            this.log(`render error: ${e.message}`)
        } finally {
            this.drawing = false
        }
    }

    /** What each key shows right now, as [signature, draw(ctx,w,h)]. */
    keyContent(now) {
        if (this.killStart != null) {
            const left = Math.max(0, KILL_HOLD_MS - (now - this.killStart))
            const progress = 1 - left / KILL_HOLD_MS
            const step = Math.round(progress * 10)
            const secs = Math.max(1, Math.ceil(left / 1000))
            return () => [`kill:${step}:${secs}`, (ctx, w, h) => drawKillCountdown(ctx, w, h, step / 10, secs)]
        }
        if (this.notice && now < this.notice.until) {
            const { text, color } = this.notice
            return () => [`notice:${text}:${color}`, (ctx, w, h) => drawNotice(ctx, w, h, text, color)]
        }
        const sessions = this.visible()
        const stats = this.statLayout()
        const pages = this.pageCount()
        return key => {
            const s = sessions[key]
            const badge = key === KEYS - 1 && pages > 1 ? `${this.page + 1}/${pages}` : ''
            const flash = this.flashing.has(key)
            if (s) {
                const view = keyView(s, now)
                const frame = animFrame(s, now)
                return [JSON.stringify(['s', flash, view, frame, badge]), (ctx, w, h) => {
                    if (flash) drawFlash(ctx, w, h)
                    else drawSession(ctx, w, h, view, frame)
                    if (badge) drawPageBadge(ctx, w, h, badge)
                }]
            }
            const tile = stats.get(key)
            if (tile) {
                return [JSON.stringify(['t', tile, badge]), (ctx, w, h) => {
                    drawStat(ctx, w, h, tile)
                    if (badge) drawPageBadge(ctx, w, h, badge)
                }]
            }
            return [JSON.stringify(['e', badge]), (ctx, w, h) => {
                drawEmpty(ctx, w, h)
                if (badge) drawPageBadge(ctx, w, h, badge)
            }]
        }
    }

    async drawAll() {
        const now = this.now()
        const content = this.keyContent(now)
        for (let key = 0; key < KEYS; key++) {
            const [sig, draw] = content(key)
            if (this.keyCache[key] === sig) continue
            this.keyCache[key] = sig
            await this.deviceCall(() => this.device.drawKey(key, draw))
        }
        await this.drawLeds()
    }

    async drawLeds() {
        const want = {
            ...LED,
            [KILL_BUTTON]: this.killStart != null ? '#ff0000' : LED[KILL_BUTTON],
            [JUMP_BUTTON]: this.store.oldestWaiting() ? '#e8a317' : '#000000',
        }
        for (const [id, color] of Object.entries(want)) {
            if (this.leds[id] === color) continue
            this.leds[id] = color
            await this.deviceCall(() => this.device.setButtonColor({ id: Number(id), color })).catch(() => { delete this.leds[id] })
        }
    }
}
