import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from 'canvas'
import { loadMascots } from '../src/sprites.js'
import { drawIntroFrame, playIntro, INTRO_MS } from '../src/intro.js'

const stats = { counts: { working: 1, waiting: 0, done: 0, idle: 2 } }

test('every phase of the intro draws without throwing, with and without sessions', async () => {
    await loadMascots()
    const ctx = createCanvas(480, 270).getContext('2d')
    for (let t = 0; t <= INTRO_MS; t += 100) {
        drawIntroFrame(ctx, 480, 270, t, stats)
        drawIntroFrame(ctx, 480, 270, t, { counts: { working: 0, waiting: 0, done: 0, idle: 0 } })
    }
})

test('playIntro draws full-screen frames until done or stopped', async () => {
    let frames = 0
    const device = { drawScreen: async (id, cb) => { assert.equal(id, 'center'); frames++; cb(createCanvas(480, 270).getContext('2d'), 480, 270) } }
    let t = 0
    await playIntro(device, () => stats, { now: () => (t += 50) })
    assert.ok(frames > 10)
    frames = 0
    await playIntro(device, () => stats, { shouldStop: () => frames >= 3 })
    assert.equal(frames, 3)
})
