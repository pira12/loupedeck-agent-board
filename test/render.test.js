import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from 'canvas'
import { keyView, formatElapsed, drawSession, drawEmpty, COLORS } from '../src/render.js'

test('formatElapsed', () => {
    assert.equal(formatElapsed(0), '0s')
    assert.equal(formatElapsed(-5), '0s')
    assert.equal(formatElapsed(59_000), '59s')
    assert.equal(formatElapsed(60_000), '1m')
    assert.equal(formatElapsed(3_599_000), '59m')
    assert.equal(formatElapsed(3_600_000), '1h')
    assert.equal(formatElapsed(90_000_000), '25h')
})

const base = { id: 's', name: 'proj', status: 'working', since: 0, started: 0, tilixId: 'x', pid: 1 }

test('keyView colors, labels, pulse', () => {
    const expect = {
        working: ['WORKING', COLORS.working, false],
        waiting: ['NEEDS YOU', COLORS.waiting, true],
        done: ['DONE', COLORS.done, false],
        idle: ['IDLE', COLORS.idle, false],
    }
    for (const [status, [label, bg, pulse]] of Object.entries(expect)) {
        const v = keyView({ ...base, status }, 61_000)
        assert.equal(v.label, label)
        assert.equal(v.bg, bg)
        assert.equal(v.pulse, pulse)
        assert.equal(v.elapsed, '1m')
    }
    assert.equal(COLORS.working, '#1e6fd9')
    assert.equal(COLORS.waiting, '#e8a317')
    assert.equal(COLORS.done, '#2ea043')
    assert.equal(COLORS.idle, '#5a5a5a')
})

test('long names are truncated to 10 chars with ellipsis', () => {
    assert.equal(keyView({ ...base, name: 'abcdefghijklmnop' }, 0).title, 'abcdefghi…')
    assert.equal(keyView({ ...base, name: 'abcdefghij' }, 0).title, 'abcdefghij')
})

test('draw functions run on a 90x90 canvas without throwing', () => {
    const ctx = createCanvas(90, 90).getContext('2d')
    drawSession(ctx, 90, 90, keyView({ ...base, status: 'waiting' }, 0), 0.5)
    drawSession(ctx, 90, 90, keyView({ ...base, tilixId: null }, 0), 0)
    drawEmpty(ctx, 90, 90)
})

test('keyView carries the agent', () => {
    assert.equal(keyView({ ...base, agent: 'codex' }, 0).agent, 'codex')
    assert.equal(keyView(base, 0).agent, 'claude')
})

test('codex pet loads with real animation rows and draws', async () => {
    const { loadMascots, MASCOTS } = await import('../src/sprites.js')
    const { animFrame } = await import('../src/render.js')
    await loadMascots()
    const m = MASCOTS.codex
    assert.equal(m.type, 'sprite')
    assert.equal(m.height, 44)
    assert.equal(m.frames.idle.length, 6)
    assert.equal(m.frames.done.length, 5)
    assert.equal(m.frames.waiting.length, 6)
    assert.equal(m.frames.working.length, 6)
    const s = { ...base, agent: 'codex', status: 'working', since: 0 }
    const frames = new Set([0, 200, 400, 600, 800, 1000].map(t => animFrame(s, t)))
    assert.equal(frames.size, 6)
    assert.equal(animFrame({ ...s, status: 'idle' }, 999), 0)
    assert.equal(animFrame({ ...s, status: 'done' }, 25_000), 0)
    const ctx = createCanvas(90, 90).getContext('2d')
    for (const st of ['working', 'waiting', 'done', 'idle']) {
        drawSession(ctx, 90, 90, keyView({ ...s, status: st }, 1000), 3)
    }
})
