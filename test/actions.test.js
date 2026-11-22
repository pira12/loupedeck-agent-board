import { test } from 'node:test'
import assert from 'node:assert/strict'
import { killSessions, newTabArgs, openAgentTab } from '../src/actions.js'

test('killSessions only signals live claude/codex processes, once each', () => {
    const comms = { 10: 'claude', 11: 'codex', 12: 'bash', 13: null }
    const sent = []
    const n = killSessions(
        [{ pid: 10 }, { pid: 10 }, { pid: 11 }, { pid: 12 }, { pid: 13 }, { pid: null }, { pid: 1 }],
        { kill: (pid, sig) => sent.push([pid, sig]), comm: pid => comms[pid] ?? null, graceMs: 0 },
    )
    assert.equal(n, 2)
    assert.deepEqual(sent, [[10, 'SIGTERM'], [11, 'SIGTERM']])
})

test('killSessions escalates to SIGKILL only for survivors that are still agents', async () => {
    const comms = { 10: 'claude', 11: 'codex' }
    const sent = []
    killSessions([{ pid: 10 }, { pid: 11 }], {
        kill: (pid, sig) => { sent.push([pid, sig]); if (pid === 10) comms[10] = null },
        comm: pid => comms[pid] ?? null,
        graceMs: 10,
    })
    await new Promise(r => setTimeout(r, 30))
    assert.deepEqual(sent, [[10, 'SIGTERM'], [11, 'SIGTERM'], [11, 'SIGKILL']])
})

test('newTabArgs runs the agent then keeps a shell', () => {
    assert.deepEqual(newTabArgs('claude', '/p/shop', '/usr/bin/zsh'), [
        '-a', 'app-new-session', '-w', '/p/shop', '-e', "/usr/bin/zsh -ic 'claude; exec /usr/bin/zsh'",
    ])
    assert.throws(() => newTabArgs('rm -rf', '/', '/bin/sh'))
})

test('openAgentTab falls back to home for a missing folder', async () => {
    let args
    const exec = (cmd, a, opts, cb) => { args = a; cb(null) }
    assert.equal(await openAgentTab('codex', '/does/not/exist', { exec, shell: '/bin/zsh', home: '/home/u' }), true)
    assert.equal(args[3], '/home/u')
})
