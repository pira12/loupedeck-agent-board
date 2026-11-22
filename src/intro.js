import { MASCOTS, pose } from './sprites.js'
import { COLORS } from './render.js'

// Startup scene on the full 480×270 screen (keys sit in x 15..465).
//   0    – 1500 ms  Claude walks in from the left, the Codex pet runs in from the right
//   1500 – 2600 ms  they meet and wave
//   2600 – 4000 ms  names on top, session counts appear in the bottom row's keys
// Afterwards the board reveals its keys one by one (see Board.reveal).
export const INTRO_MS = 4000
export const INTRO_FPS = 20

const WALK_END = 1500
const WAVE_END = 2600

// The screen sits behind a 5×3 grid of key windows (90 px, starting at x=15). Plastic dividers
// hide the borders, so everything readable is laid out inside single key cells.
export const GRID = { x0: 15, size: 90, cols: 5, rows: 3 }
const cellX = col => GRID.x0 + col * GRID.size
const cellY = row => row * GRID.size
const cellCenter = col => cellX(col) + GRID.size / 2

const GROUND = cellY(2) - 6 // feet near the bottom of the middle row
const CLAUDE = { sx: 5, sy: 10 } // 90×50: exactly one key wide; terminal pixels are ~1:2
const PET_H = 78 // fits inside the middle row
const CLAUDE_COL = 1
const PET_COL = 3

const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)
const lerp = (a, b, x) => a + (b - a) * x

function drawClaude(ctx, status, frame, cx, ground) {
    const m = MASCOTS.claude
    const { grid, dy } = pose(m.grid, status, frame)
    // drop empty bottom rows so feet sit on the ground
    let rows = grid.length
    while (rows > 0 && !grid[rows - 1].some(Boolean)) rows--
    const w = grid[0].length * CLAUDE.sx
    const x0 = Math.round(cx - w / 2)
    const y0 = ground - rows * CLAUDE.sy + Math.round((dy * CLAUDE.sy) / 2)
    ctx.fillStyle = m.color
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            if (grid[y][x]) ctx.fillRect(x0 + x * CLAUDE.sx, y0 + y * CLAUDE.sy, CLAUDE.sx, CLAUDE.sy)
        }
    }
}

function drawPet(ctx, row, frame, cx, ground) {
    const m = MASCOTS.codexIntro
    const frames = m?.frames?.[row]
    if (!frames?.length) return
    const img = frames[frame % frames.length]
    const h = PET_H, w = Math.round((m.width / m.height) * h)
    ctx.drawImage(img, Math.round(cx - w / 2), ground - h + 4, w, h)
}

/** Text centered inside one key cell. */
function cellText(ctx, col, row, lines) {
    const cx = cellCenter(col), top = cellY(row)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const l of lines) {
        ctx.fillStyle = l.color
        ctx.font = l.font
        ctx.fillText(l.text, cx, top + l.y, GRID.size - 12)
    }
}

/** The 5 summary cells for the bottom row. */
export function summaryCells(stats) {
    const c = stats.counts
    const total = Object.values(c).reduce((a, b) => a + b, 0)
    const cell = (value, label, color) => ({ value: String(value), label, color })
    return [
        cell(total, total === 1 ? 'SESSION' : 'SESSIONS', '#fff'),
        cell(c.working, 'WORKING', COLORS.working),
        cell(c.waiting, 'NEED YOU', COLORS.waiting),
        cell(c.done, 'DONE', COLORS.done),
        cell(c.idle, 'IDLE', '#aaa'),
    ]
}

/** Draw one intro frame at time t (ms). stats = store.stats() */
export function drawIntroFrame(ctx, w, h, t, stats) {
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // dotted floor along the middle row
    ctx.fillStyle = '#2a2a2a'
    for (let x = cellX(0) + 6; x < cellX(GRID.cols) - 6; x += 8) ctx.fillRect(x, GROUND + 2, 4, 2)

    const tick = Math.floor(t / (1000 / INTRO_FPS))
    const claudeEnd = cellCenter(CLAUDE_COL)
    const petEnd = cellCenter(PET_COL)

    if (t < WALK_END) {
        const p = ease(t / WALK_END)
        drawClaude(ctx, 'walk', Math.floor(tick / 2), lerp(-60, claudeEnd, p), GROUND)
        drawPet(ctx, 'runLeft', tick, lerp(w + 60, petEnd, p), GROUND)
        return
    }

    const f = tick - Math.floor((t < WAVE_END ? WALK_END : WAVE_END) / (1000 / INTRO_FPS))
    if (t < WAVE_END) {
        drawClaude(ctx, 'waiting', Math.floor(f / 3), claudeEnd, GROUND)
        drawPet(ctx, 'waving', Math.floor(f / 2), petEnd, GROUND)
        if (t > WALK_END + 150) {
            const hi = [{ text: 'hi!', y: 52, font: 'bold 24px sans-serif', color: '#fff' }]
            cellText(ctx, CLAUDE_COL, 0, hi)
            cellText(ctx, PET_COL, 0, hi)
        }
        return
    }

    drawClaude(ctx, 'done', Math.floor(f / 3), claudeEnd, GROUND)
    drawPet(ctx, 'jumping', Math.floor(f / 2), petEnd, GROUND)
    cellText(ctx, CLAUDE_COL, 0, [{ text: 'CLAUDE', y: 62, font: 'bold 15px sans-serif', color: MASCOTS.claude.color }])
    cellText(ctx, PET_COL, 0, [{ text: 'CODEX', y: 62, font: 'bold 15px sans-serif', color: '#5b8cff' }])

    // summary cells appear one after another
    summaryCells(stats).forEach((c, col) => {
        const a = ease((t - WAVE_END - col * 120) / 300)
        if (a <= 0) return
        ctx.globalAlpha = a
        cellText(ctx, col, 2, [
            { text: c.value, y: 38 + (1 - a) * 8, font: 'bold 34px sans-serif', color: c.color },
            { text: c.label, y: 70, font: 'bold 12px sans-serif', color: c.color },
        ])
        ctx.globalAlpha = 1
    })
}

/**
 * Play the intro on a device. Stops early when shouldStop() returns true.
 * Resolves when finished or skipped.
 */
export async function playIntro(device, getStats, { shouldStop = () => false, now = Date.now } = {}) {
    const start = now()
    const frameMs = 1000 / INTRO_FPS
    while (!shouldStop()) {
        const t = now() - start
        if (t >= INTRO_MS) break
        await device.drawScreen('center', (ctx, w, h) => drawIntroFrame(ctx, w, h, t, getStats()))
        const spent = now() - start - t
        if (spent < frameMs) await new Promise(r => setTimeout(r, frameMs - spent))
    }
}
