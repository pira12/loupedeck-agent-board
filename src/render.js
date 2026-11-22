import { MASCOTS, pose } from './sprites.js'

export const COLORS = {
    working: '#1e6fd9',
    waiting: '#e8a317',
    done: '#2ea043',
    idle: '#5a5a5a',
}

const LABELS = {
    working: 'WORKING',
    waiting: 'NEEDS YOU',
    done: 'DONE',
    idle: 'IDLE',
}

const DONE_ANIM_MS = 20_000

export function formatElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000))
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m`
    return `${Math.floor(s / 3600)}h`
}

function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '…' : str
}

export function keyView(session, now) {
    const status = session.status in COLORS ? session.status : 'idle'
    return {
        title: truncate(session.name || '?', 10),
        label: LABELS[status],
        elapsed: formatElapsed(now - session.since),
        bg: COLORS[status],
        pulse: status === 'waiting',
        blink: status === 'waiting' && Math.floor(now / FRAME_MS) % 2 === 1,
        status,
        jumpable: !!session.tilixId,
        agent: session.agent === 'codex' ? 'codex' : 'claude',
        rest: status === 'idle' || (status === 'done' && now - session.since > DONE_ANIM_MS),
    }
}

/** Claude mascot flips pose every FRAME_MS; sprite pets advance every PET_FRAME_MS. */
export const FRAME_MS = 500
export const PET_FRAME_MS = 200

/** Animation frame index for a key (0 when resting, so still keys never redraw). */
export function animFrame(session, now) {
    const view = keyView(session, now)
    if (view.rest) return 0
    const m = MASCOTS[view.agent]
    if (m?.type === 'sprite') return Math.floor(now / PET_FRAME_MS) % (m.frames[view.status]?.length || 1)
    return Math.floor(now / FRAME_MS) % 2
}

/** sx/sy: pixel size. Terminal block pixels are ~1:2 (w:h), so sy ≈ 2·sx keeps the original look. */
export function drawMascot(ctx, mascot, status, frame, cx, top, sx, sy = sx) {
    const { grid, dy } = pose(mascot.grid, status, frame)
    const w = grid[0].length
    const x0 = Math.round(cx - (w * sx) / 2)
    const y0 = top + Math.round((dy * sy) / 2)
    ctx.fillStyle = mascot.color
    grid.forEach((row, y) => row.forEach((on, x) => {
        if (on === 1) ctx.fillRect(x0 + x * sx, y0 + y * sy, sx, sy)
        else if (on === 2) ctx.fillRect(x0 + x * sx, y0 + y * sy, sx, sy - Math.max(1, Math.round(sy / 4)))
    }))
}

function drawPet(ctx, mascot, view, frame, cx, top) {
    const row = view.rest ? mascot.frames.idle : mascot.frames[view.status]
    const img = row?.[frame % row.length] ?? mascot.frames.idle?.[0]
    if (img) ctx.drawImage(img, Math.round(cx - mascot.width / 2), top)
}

export function drawSession(ctx, w, h, view, frame = 0) {
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // card with a status-colored border; waiting border blinks
    roundRect(ctx, 2, 2, w - 4, h - 4, 10)
    ctx.fillStyle = '#141414'
    ctx.fill()
    ctx.lineWidth = view.blink ? 2 : 4
    ctx.strokeStyle = view.bg
    ctx.stroke()

    const mascot = MASCOTS[view.agent] ?? MASCOTS.claude
    if (mascot.type === 'sprite') drawPet(ctx, mascot, view, frame, w / 2, 5)
    else drawMascot(ctx, mascot, view.status, frame, w / 2, 12, 3, 6)

    // status glyph top-right
    const glyph = { waiting: '!', done: '✓', idle: 'z' }[view.status]
    if (glyph) {
        ctx.font = 'bold 14px sans-serif'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'top'
        ctx.fillStyle = view.status === 'idle' ? '#888' : view.bg
        ctx.fillText(glyph, w - 9, 7 - (view.status !== 'idle' && frame % 2 ? 2 : 0))
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText(view.title, w / 2, 58, w - 12)

    ctx.font = 'bold 11px sans-serif'
    ctx.fillStyle = view.status === 'idle' ? '#999' : view.bg
    ctx.fillText(`${view.label} · ${view.elapsed}`, w / 2, 75, w - 12)

    if (!view.jumpable) {
        ctx.font = '10px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillStyle = '#888'
        ctx.fillText('⊘', 9, 7)
    }
}

export function drawEmpty(ctx, w, h) {
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
}

export function drawFlash(ctx, w, h) {
    ctx.globalAlpha = 1
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
}

/** Small page indicator overlay, e.g. "2/3". */
export function drawPageBadge(ctx, w, h, text) {
    ctx.globalAlpha = 1
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = '#ccc'
    ctx.fillText(text, w - 6, h - 4)
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
}

// ---- Stat tiles ----

/**
 * Build stat tiles from store.stats() + token totals.
 * Order = placement priority from the bottom-right key backwards.
 * Each tile: { kind, title, rows: [{ label, value, color }] }
 */
export function statTiles(stats, tokens, fmtTokens) {
    const c = stats.counts
    return [
        {
            kind: 'now', title: 'RIGHT NOW', rows: [
                { label: 'working', value: String(c.working), color: COLORS.working },
                { label: 'needs you', value: String(c.waiting), color: COLORS.waiting },
                { label: 'done', value: String(c.done), color: COLORS.done },
                { label: 'idle', value: String(c.idle), color: '#999' },
            ],
        },
        {
            kind: 'today', title: 'TODAY', rows: [
                { label: 'prompts', value: String(stats.prompts), color: '#fff' },
                { label: 'finished', value: String(stats.finished), color: COLORS.done },
            ],
        },
        {
            kind: 'tokens', title: 'TOKENS TODAY', rows: [
                { label: 'Claude', value: fmtTokens(tokens.claude), color: '#d77757' },
                { label: 'Codex', value: fmtTokens(tokens.codex), color: '#5b8cff' },
            ],
        },
        {
            kind: 'longest', title: 'LONGEST TASK', rows: stats.longest
                ? [
                    { label: '', value: truncate(stats.longest.name, 11), color: '#fff' },
                    { label: '', value: formatDuration(stats.longest.ms), color: COLORS.working },
                ]
                : [{ label: '', value: 'nothing', color: '#777' }, { label: '', value: 'running', color: '#777' }],
        },
        {
            kind: 'waited', title: 'WAITED ON YOU', rows: [
                { label: '', value: formatDuration(stats.waitMs), color: COLORS.waiting },
                { label: '', value: 'today', color: '#777' },
            ],
        },
    ]
}

/** 65_000 → "1m 5s", 3_900_000 → "1h 5m" */
export function formatDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000))
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s`
    return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function drawStat(ctx, w, h, tile) {
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    roundRect(ctx, 2, 2, w - 4, h - 4, 10)
    ctx.fillStyle = '#0d0d0d'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = '#333'
    ctx.stroke()

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#8a8a8a'
    ctx.font = 'bold 9px sans-serif'
    ctx.fillText(tile.title, w / 2, 13, w - 10)

    const rows = tile.rows
    const big = rows.length <= 2
    const gap = big ? 22 : 15
    const mid = 22 + (h - 22) / 2
    rows.forEach((r, i) => {
        const y = Math.round(mid + (i - (rows.length - 1) / 2) * gap)
        ctx.fillStyle = r.color
        if (r.label) {
            ctx.font = `${big ? 11 : 10}px sans-serif`
            ctx.textAlign = 'left'
            ctx.fillText(r.label, 8, y, 40)
            ctx.font = `bold ${big ? 15 : 12}px sans-serif`
            ctx.textAlign = 'right'
            ctx.fillText(r.value, w - 8, y, 34)
        } else {
            ctx.font = `bold ${big ? 15 : 12}px sans-serif`
            ctx.textAlign = 'center'
            ctx.fillText(r.value, w / 2, y, w - 12)
        }
    })
}

/** Kill-switch countdown: red key with a draining bar. progress 0..1 */
export function drawKillCountdown(ctx, w, h, progress, secondsLeft) {
    ctx.globalAlpha = 1
    ctx.fillStyle = '#2a0000'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#c62828'
    ctx.fillRect(0, h - h * progress, w, h * progress)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 30px sans-serif'
    ctx.fillText(String(secondsLeft), w / 2, h / 2 - 6)
    ctx.font = 'bold 10px sans-serif'
    ctx.fillText('KILL ALL', w / 2, h / 2 + 20)
}

/** Full-key notice, e.g. after the kill switch fired. */
export function drawNotice(ctx, w, h, text, color = '#c62828') {
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 13px sans-serif'
    const lines = text.split('\n')
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 16, w - 8))
}
