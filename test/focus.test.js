import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusArgs, focusTerminal } from '../src/focus.js'

const ID = '00000000-0000-4000-8000-000000000001'

test('focusArgs builds the gdbus activate-terminal call', () => {
    assert.deepEqual(focusArgs(ID), [
        'call', '--session', '--dest', 'com.gexperts.Tilix',
        '--object-path', '/com/gexperts/Tilix',
        '--method', 'org.gtk.Actions.Activate',
        'activate-terminal', `[<'${ID}'>]`, '{}',
    ])
})

test('focusTerminal returns false without calling exec for missing/invalid ids', async () => {
    let called = false
    const exec = () => { called = true }
    assert.equal(await focusTerminal(null, exec), false)
    assert.equal(await focusTerminal("x'; rm -rf /", exec), false)
    assert.equal(called, false)
})

test('focusTerminal resolves true on success, false on failure', async () => {
    const ok = (cmd, args, opts, cb) => { assert.equal(cmd, 'gdbus'); cb(null, '()', '') }
    const bad = (cmd, args, opts, cb) => cb(new Error('no tilix'), '', 'err')
    assert.equal(await focusTerminal(ID, ok), true)
    assert.equal(await focusTerminal(ID, bad), false)
})
