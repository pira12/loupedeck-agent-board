import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SessionStore } from '../src/store.js'
import { startServer } from '../src/server.js'
import { loadStore, saveStore } from '../src/persist.js'

async function withServer(fn) {
    const store = new SessionStore()
    let changes = 0
    const server = await startServer(store, () => changes++, 0)
    const base = `http://127.0.0.1:${server.address().port}`
    try {
        await fn({ store, base, changes: () => changes })
    } finally {
        server.close()
    }
}

const post = (base, body, headers = {}) =>
    fetch(`${base}/event`, { method: 'POST', body, headers })

test('POST hook payload with headers registers session', () => withServer(async ({ base, changes }) => {
    const payload = JSON.stringify({ session_id: 's1', cwd: '/x/proj', hook_event_name: 'SessionStart' })
    const r = await post(base, payload, {
        'X-Tilix-Id': '00000000-0000-4000-8000-000000000001', 'X-Claude-Pid': '1234',
    })
    assert.equal(r.status, 204)
    const list = await (await fetch(`${base}/sessions`)).json()
    assert.equal(list.length, 1)
    assert.equal(list[0].name, 'proj')
    assert.equal(list[0].tilixId, '00000000-0000-4000-8000-000000000001')
    assert.equal(list[0].pid, 1234)
    assert.equal(changes(), 1)
    // same event again: no change notification
    await post(base, payload)
    assert.equal(changes(), 1)
}))

test('X-Hook-Event header overrides missing hook_event_name', () => withServer(async ({ store, base }) => {
    await post(base, JSON.stringify({ session_id: 's1' }), { 'X-Hook-Event': 'Stop' })
    assert.equal(store.list()[0].status, 'done')
}))

test('bad JSON → 400, unknown route → 404', () => withServer(async ({ base }) => {
    assert.equal((await post(base, '{nope')).status, 400)
    assert.equal((await fetch(`${base}/nope`)).status, 404)
}))

test('persist roundtrip and missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldc-'))
    const file = path.join(dir, 'sub', 'sessions.json')
    assert.equal(loadStore(file).list().length, 0)
    const s = new SessionStore()
    s.applyEvent({ event: 'Stop', session_id: 'a', cwd: '/p' })
    saveStore(s, file)
    assert.deepEqual(loadStore(file).list(), s.list())
    fs.writeFileSync(file, 'garbage')
    assert.equal(loadStore(file).list().length, 0)
})

test('X-Agent codex + PermissionRequest marks a codex session waiting', () => withServer(async ({ store, base }) => {
    await post(base, JSON.stringify({ session_id: 'c1', cwd: '/x/app', hook_event_name: 'PermissionRequest' }), { 'X-Agent': 'codex' })
    const [s] = store.list()
    assert.equal(s.agent, 'codex')
    assert.equal(s.status, 'waiting')
}))
