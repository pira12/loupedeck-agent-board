// Pixel-art mascots, decoded from terminal block art so they match the originals exactly.

// Quadrant block characters → [TL, TR, BL, BR]
const QUAD = {
    ' ': [0, 0, 0, 0], '█': [1, 1, 1, 1],
    '▘': [1, 0, 0, 0], '▝': [0, 1, 0, 0], '▖': [0, 0, 1, 0], '▗': [0, 0, 0, 1],
    '▀': [1, 1, 0, 0], '▄': [0, 0, 1, 1], '▌': [1, 0, 1, 0], '▐': [0, 1, 0, 1],
    '▛': [1, 1, 1, 0], '▜': [1, 1, 0, 1], '▙': [1, 0, 1, 1], '▟': [0, 1, 1, 1],
    '▚': [1, 0, 0, 1], '▞': [0, 1, 1, 0],
}

/** Turn block-character art into a 2D pixel grid (rows of 0/1). */
export function decodeBlocks(lines) {
    const width = Math.max(...lines.map(l => [...l].length)) * 2
    const grid = []
    for (const line of lines) {
        const top = new Array(width).fill(0)
        const bottom = new Array(width).fill(0)
        ;[...line].forEach((ch, i) => {
            const [tl, tr, bl, br] = QUAD[ch] ?? QUAD[' ']
            top[i * 2] = tl; top[i * 2 + 1] = tr
            bottom[i * 2] = bl; bottom[i * 2 + 1] = br
        })
        grid.push(top, bottom)
    }
    return grid
}

// Claude Code's startup mascot
export const CLAUDE_ART = [
    ' ▐▛███▜▌',
    '▝▜█████▛▘',
    '  ▘▘ ▝▝',
]
export const CLAUDE_COLOR = '#d77757'

const clone = g => g.map(r => [...r])

/**
 * Pose a mascot grid for a status/frame. Works on any decoded grid by
 * detecting eye gaps (holes inside the body) and side arms.
 * Returns { grid, dy } where dy is a vertical bounce offset in pixels.
 */
export function pose(base, status, frame) {
    const g = clone(base)
    const h = g.length, w = g[0].length
    // eyes = empty pixels with filled neighbours left and right on the same row
    const eyes = []
    for (let y = 0; y < h; y++) {
        for (let x = 1; x < w - 1; x++) {
            if (!g[y][x] && g[y][x - 1] && g[y][x + 1] && y > 0 && g[y - 1][x]) eyes.push([x, y])
        }
    }
    // arms = the widest row's outermost pixels
    let armRow = 0
    g.forEach((r, y) => { if (r.reduce((a, b) => a + b) > g[armRow].reduce((a, b) => a + b)) armRow = y })
    const left = g[armRow].indexOf(1), right = g[armRow].lastIndexOf(1)
    const raiseArms = (l, r) => {
        if (armRow < 1) return
        if (l) { g[armRow][left] = 0; g[armRow - 1][left] = 1 }
        if (r) { g[armRow][right] = 0; g[armRow - 1][right] = 1 }
    }

    let dy = 0
    switch (status) {
        case 'working': // typing: arms alternate, slight bounce
            raiseArms(frame % 2 === 0, frame % 2 === 1)
            dy = frame % 2
            break
        case 'waiting': // waving both arms + hop
            if (frame % 2 === 0) { raiseArms(true, true); dy = -1 }
            break
        case 'walk': // legs shuffle, body bobs
            {
                let legRow = -1
                g.forEach((r, y) => { if (r.some(Boolean)) legRow = y })
                if (legRow >= 0 && frame % 2) g[legRow] = [0, ...g[legRow].slice(0, -1)]
                dy = frame % 2 ? -1 : 0
            }
            break
        case 'done': // cheering
            raiseArms(true, true)
            dy = frame % 2 === 0 ? 0 : -1
            break
        default: // idle: eyes closed (2 = eyelid: only the lower sliver stays open)
            for (const [x, y] of eyes) g[y][x] = 2
    }
    return { grid: g, dy }
}

export const MASCOTS = {
    claude: { grid: decodeBlocks(CLAUDE_ART), color: CLAUDE_COLOR, eye: '#000' },
}

// ---- Sprite-sheet mascots (Codex pets) ----

export const PET_CELL = { w: 192, h: 208, cols: 8 }
/** Board status → sprite-sheet row. `rest` is the still pose (done after its celebration, idle). */
export const PET_ROWS = { idle: 0, done: 4, waiting: 6, working: 7 }
// Union of the pet's bounding boxes over the rows we use, so it never jumps around when cropped
const PET_CROP = { x: 13, y: 8, w: 166, h: 192 }

/**
 * Load a Codex pet sprite sheet and pre-scale its frames to `height` px.
 * Returns { type: 'sprite', frames: { status: Canvas[] }, width, height }.
 */
export async function loadPetMascot(file, height = 44, rows = PET_ROWS) {
    const { loadImage, createCanvas } = await import('canvas')
    const sheet = await loadImage(file)
    const scale = height / PET_CROP.h
    const width = Math.round(PET_CROP.w * scale)
    const frames = {}
    for (const [status, row] of Object.entries(rows)) {
        frames[status] = []
        for (let col = 0; col < PET_CELL.cols; col++) {
            const sx = col * PET_CELL.w, sy = row * PET_CELL.h
            // stop at the first fully transparent cell
            const probe = createCanvas(PET_CELL.w, PET_CELL.h).getContext('2d')
            probe.drawImage(sheet, sx, sy, PET_CELL.w, PET_CELL.h, 0, 0, PET_CELL.w, PET_CELL.h)
            const alpha = probe.getImageData(0, 0, PET_CELL.w, PET_CELL.h).data
            let any = false
            for (let i = 3; i < alpha.length; i += 4) if (alpha[i]) { any = true; break }
            if (!any) break
            const c = createCanvas(width, height)
            const ctx = c.getContext('2d')
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            ctx.drawImage(sheet, sx + PET_CROP.x, sy + PET_CROP.y, PET_CROP.w, PET_CROP.h, 0, 0, width, height)
            frames[status].push(c)
        }
    }
    return { type: 'sprite', frames, width, height }
}

/** Load sprite mascots into MASCOTS. Missing files are skipped (falls back to the Claude mascot). */
export async function loadMascots(root = new URL('..', import.meta.url).pathname) {
    try {
        MASCOTS.codex = await loadPetMascot(`${root}/assets/pets/codex.png`)
        // big version for the startup animation
        MASCOTS.codexIntro = await loadPetMascot(`${root}/assets/pets/codex.png`, 104, { runLeft: 2, waving: 3, jumping: 4, idle: 0 })
    } catch (e) {
        console.error(`codex pet not loaded: ${e.message}`)
    }
}
