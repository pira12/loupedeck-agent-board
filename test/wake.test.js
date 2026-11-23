import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchForResume, makeReconnector } from '../src/wake.js'

test('fires only when the wall clock jumps well past the interval', () => {
    let t = 0, tick
    const gaps = []
    watchForResume(g => gaps.push(g), { intervalMs: 2000, thresholdMs: 10_000, now: () => t, setTimer: fn => { tick = fn } })
    t = 2000; tick()
    t = 5000; tick()      // a bit late: not a resume
    t = 3_605_000; tick() // an hour asleep
    t = 3_607_000; tick()
    assert.deepEqual(gaps, [3_600_000])
})

test('reconnect closes, retries until connect succeeds, and ignores overlapping calls', async () => {
    const calls = []
    let fails = 2
    const device = {
        close: async () => { calls.push('close') },
        connect: async () => { calls.push('connect'); if (fails-- > 0) throw new Error('nope') },
    }
    const reconnect = makeReconnector(device, { sleep: async () => {} })
    await Promise.all([reconnect('test'), reconnect('again')])
    assert.deepEqual(calls, ['close', 'connect', 'close', 'connect', 'close', 'connect'])
})

test('a hanging handshake times out and is retried', async () => {
    let n = 0
    const device = {
        close: async () => {},
        connect: () => (++n === 1 ? new Promise(() => {}) : Promise.resolve()),
    }
    await makeReconnector(device, { timeoutMs: 20, sleep: async () => {} })('test')
    assert.equal(n, 2)
})
