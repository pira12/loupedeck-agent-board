import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mergeHooks, removeHooks, EVENTS } from '../scripts/merge-hooks.mjs'

const HP = '/opt/ld/hooks/hook.sh'

test('merge into empty settings adds all events', () => {
    const s = mergeHooks({}, HP)
    assert.deepEqual(Object.keys(s.hooks).sort(), [...EVENTS].sort())
    assert.equal(s.hooks.Stop[0].hooks[0].command, `${HP} Stop`)
})

test('merging twice does not duplicate', () => {
    const s = mergeHooks(mergeHooks({}, HP), HP)
    for (const e of EVENTS) assert.equal(s.hooks[e].length, 1)
})

test('existing settings and unrelated hooks are preserved; remove restores them', () => {
    const orig = {
        model: 'opus',
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }] },
    }
    const s = mergeHooks(orig, HP)
    assert.equal(s.model, 'opus')
    assert.equal(s.hooks.Stop.length, 2)
    assert.equal(s.hooks.Stop[0].hooks[0].command, 'notify-send done')
    assert.deepEqual(removeHooks(s, HP), orig)
    assert.equal(orig.hooks.Stop.length, 1) // input not mutated
})

test('hook.sh exits 0 quickly when the daemon is not running', () => {
    const t = Date.now()
    const r = spawnSync('bash', ['hooks/hook.sh', 'Stop'], {
        input: '{"session_id":"x"}', env: { ...process.env, LOUPEDECK_CLAUDE_PORT: '1' }, encoding: 'utf8',
    })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
    assert.ok(Date.now() - t < 1500)
})

test('codex hooks use PermissionRequest and pass the agent', () => {
    const s = mergeHooks({}, HP, 'codex')
    assert.ok(s.hooks.PermissionRequest)
    assert.equal(s.hooks.Notification, undefined)
    assert.equal(s.hooks.Stop[0].hooks[0].command, `${HP} Stop codex`)
    assert.deepEqual(removeHooks(s, HP), {})
})
