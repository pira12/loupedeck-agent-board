import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createCanvas } from 'canvas'
import { SessionStore } from '../src/store.js'
import { Board, KEYS, PAGE_KNOB, BRIGHTNESS_KNOB, JUMP_BUTTON, KILL_BUTTON, NEW_CLAUDE_BUTTON, NEW_CODEX_BUTTON, KILL_HOLD_MS } from '../src/board.js'

const TID = '00000000-0000-4000-8000-000000000001'

class FakeDevice extends EventEmitter {
    constructor() { super(); this.draws = 0; this.brightness = null; this.leds = [] }
    async drawKey(key, cb) { this.draws++; this.drawn = (this.drawn ?? []); this.drawn.push(key); cb(createCanvas(90, 90).getContext('2d'), 90, 90) }
    async setBrightness(b) { this.brightness = b }
    async setButtonColor(c) { this.leds.push(c) }
}

function setup(n, { focusOk = true, ...opts } = {}) {
    let t = 0
    const store = new SessionStore(() => t++)
    for (let i = 0; i < n; i++) {
        store.applyEvent({ event: 'Stop', session_id: `s${i}`, cwd: `/p/${i}`, tilix_id: i % 2 ? null : TID })
    }
    const focused = []
    const board = new Board(store, { focus: async id => { focused.push(id); return focusOk && !!id }, revealMs: 0, ...opts })
    const dev = new FakeDevice()
    board.attach(dev)
    return { store, board, dev, focused }
}

test('pressing a key focuses that session and marks it seen', async () => {
    const { store, board, focused } = setup(3)
    assert.equal(await board.pressKey(0), true)
    assert.deepEqual(focused, [TID])
    assert.equal(store.list()[0].status, 'idle')
})

test('pressing a key without tilixId does not crash and keeps status', async () => {
    const { store, board } = setup(3)
    assert.equal(await board.pressKey(1), false)
    assert.equal(store.list()[1].status, 'done')
})

test('pressing an empty key does nothing', async () => {
    const { board, focused } = setup(2)
    assert.equal(await board.pressKey(9), false)
    assert.deepEqual(focused, [])
})

const addCodex = (store, n) => {
    for (let i = 0; i < n; i++) store.applyEvent({ event: 'Stop', agent: 'codex', session_id: `c${i}`, cwd: `/c/${i}` })
}

test('claude sessions fill the top row, codex the middle row; each pages by 5', () => {
    const { store, board } = setup(7)
    addCodex(store, 2)
    assert.equal(board.pageCount(), 2)
    const ids = () => board.visible().map(x => x?.id ?? null)
    assert.deepEqual(ids().slice(0, 10), ['s0', 's1', 's2', 's3', 's4', 'c0', 'c1', null, null, null])
    assert.equal(board.turnPage(-1), false)
    assert.equal(board.turnPage(+3), true)
    assert.deepEqual(ids().slice(0, 10), ['s5', 's6', null, null, null, null, null, null, null, null])
    assert.equal(board.turnPage(+1), false)
})

test('page clamps when sessions disappear', () => {
    const { store, board } = setup(6)
    board.turnPage(1)
    assert.equal(board.page, 1)
    store.applyEvent({ event: 'SessionEnd', session_id: 's5' })
    assert.equal(board.visible()[0].id, 's0')
    assert.equal(board.page, 0)
})

test('brightness clamps between 0.1 and 1', () => {
    const { board } = setup(0)
    for (let i = 0; i < 20; i++) board.adjustBrightness(-1)
    assert.equal(board.brightness, 0.1)
    for (let i = 0; i < 20; i++) board.adjustBrightness(5)
    assert.equal(board.brightness, 1)
})

test('jump button goes to the longest-waiting session, on its agent row and page', async () => {
    const { store, board, focused } = setup(7)
    store.applyEvent({ event: 'Notification', session_id: 's6', tilix_id: TID })
    assert.equal(await board.pressJumpButton(), true)
    assert.equal(board.page, 1)
    assert.equal(board.sessionAtKey(1).id, 's6')
    assert.deepEqual(focused, [TID])
})

test('jump button finds a waiting codex session on the middle row', async () => {
    const { store, board } = setup(1)
    addCodex(store, 3)
    store.applyEvent({ event: 'PermissionRequest', agent: 'codex', session_id: 'c2', cwd: '/c/2' })
    let flashed = null
    board.flash = key => { flashed = key }
    await board.pressJumpButton() // c2 has no terminal → flashes its key
    assert.equal(board.page, 0)
    assert.equal(flashed, 7)
})

test('device events drive the board; render draws all keys and sets LED', async () => {
    const { store, board, dev } = setup(1)
    dev.emit('connect', {})
    await new Promise(r => setTimeout(r, 10))
    assert.equal(dev.brightness, 0.7)
    assert.ok(dev.draws >= KEYS)
    store.applyEvent({ event: 'Notification', session_id: 's0' })
    await board.render()
    assert.deepEqual(dev.leds.filter(l => l.id === JUMP_BUTTON).at(-1), { id: JUMP_BUTTON, color: '#e8a317' })
    dev.emit('rotate', { id: BRIGHTNESS_KNOB, delta: 1 })
    assert.equal(board.brightness, 0.8)
    dev.emit('rotate', { id: PAGE_KNOB, delta: 1 })
    assert.equal(board.page, 0)
})

test('render does nothing while disconnected', async () => {
    const { board, dev } = setup(1)
    await board.render()
    assert.equal(dev.draws, 0)
})

test('unchanged keys are not redrawn', async () => {
    const { board, dev } = setup(2)
    dev.emit('connect', {})
    await new Promise(r => setTimeout(r, 10))
    const before = dev.draws
    await board.render()
    assert.equal(dev.draws, before)
    dev.drawn = []
    await board.pressKey(0) // done → idle: key 0 and the "right now" stat tile change
    assert.ok(dev.drawn.includes(0))
    assert.ok(!dev.drawn.includes(1))
})

test('stat tiles always occupy the bottom row', () => {
    for (const n of [0, 5, 12]) {
        const layout = setup(n).board.statLayout()
        assert.deepEqual([...layout.keys()].sort((a, b) => a - b), [10, 11, 12, 13, 14])
        assert.deepEqual([14, 13, 12, 11, 10].map(k => layout.get(k).kind), ['now', 'today', 'tokens', 'longest', 'waited'])
    }
})

test('kill switch fires only after a full hold, and ignores key presses meanwhile', async () => {
    let killed = null
    const { board, dev, focused } = setup(2, { killAll: list => { killed = list.length; return list.length } })
    dev.emit('connect', {})
    dev.emit('down', { id: KILL_BUTTON })
    await board.pressKey(0)
    assert.deepEqual(focused, [])
    await new Promise(r => setTimeout(r, KILL_HOLD_MS + 100))
    assert.equal(killed, 2)
    assert.match(board.notice.text, /ENDED 2/)
})

test('releasing the kill button early cancels', async () => {
    let killed = false
    const { board, dev } = setup(1, { killAll: () => { killed = true; return 1 } })
    dev.emit('down', { id: KILL_BUTTON })
    await new Promise(r => setTimeout(r, 300))
    dev.emit('up', { id: KILL_BUTTON })
    await new Promise(r => setTimeout(r, KILL_HOLD_MS))
    assert.equal(killed, false)
    assert.equal(board.killStart, null)
})

test('new tab buttons open claude/codex in the folder of the last jumped session', async () => {
    const opened = []
    const { board, dev } = setup(1, { newTab: async (agent, cwd) => { opened.push([agent, cwd]); return true } })
    dev.emit('down', { id: NEW_CLAUDE_BUTTON })
    await board.pressKey(0)
    dev.emit('down', { id: NEW_CODEX_BUTTON })
    await new Promise(r => setTimeout(r, 10))
    assert.deepEqual(opened, [['claude', null], ['codex', '/p/0']])
})

test('intro plays on connect, pauses rendering, and a touch skips it without pressing a key', async () => {
    let introCalls = 0
    let stopSeen = false
    const intro = async (device, { shouldStop }) => {
        introCalls++
        while (!shouldStop()) await new Promise(r => setTimeout(r, 5))
        stopSeen = true
    }
    const { board, dev, focused } = setup(2, { intro, revealMs: 0 })
    dev.emit('connect', {})
    await new Promise(r => setTimeout(r, 20))
    assert.equal(introCalls, 1)
    assert.equal(board.busy, true)
    const before = dev.draws
    await board.render()
    assert.equal(dev.draws, before) // paused
    dev.emit('touchstart', { changedTouches: [{ target: { key: 0 } }] })
    await new Promise(r => setTimeout(r, 30))
    assert.equal(stopSeen, true)
    assert.equal(board.busy, false)
    assert.deepEqual(focused, []) // the skip touch didn't jump
    assert.ok(dev.draws >= before + KEYS) // revealed every key
})

test('intro errors do not break the board', async () => {
    const { board, dev } = setup(1, { intro: async () => { throw new Error('boom') }, revealMs: 0 })
    dev.emit('connect', {})
    await new Promise(r => setTimeout(r, 20))
    assert.equal(board.busy, false)
})
