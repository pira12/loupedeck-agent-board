import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore } from '../src/store.js'

function clock(start = 1000) {
    let t = start
    const now = () => t
    now.advance = ms => { t += ms }
    return now
}

const ev = (event, extra = {}) => ({
    event, session_id: 's1', cwd: '/home/u/proj-a', tilix_id: null, pid: 10, ...extra,
})

test('SessionStart creates an idle session with name from cwd', () => {
    const s = new SessionStore(clock())
    assert.equal(s.applyEvent(ev('SessionStart', { tilix_id: 'abc' })), true)
    const [x] = s.list()
    assert.equal(x.id, 's1')
    assert.equal(x.name, 'proj-a')
    assert.equal(x.status, 'idle')
    assert.equal(x.tilixId, 'abc')
    assert.equal(x.pid, 10)
})

test('status transitions per event', () => {
    const s = new SessionStore(clock())
    s.applyEvent(ev('SessionStart'))
    const cases = [
        ['UserPromptSubmit', 'working'], ['Notification', 'waiting'],
        ['PreToolUse', 'working'], ['Stop', 'done'],
    ]
    for (const [e, status] of cases) {
        s.applyEvent(ev(e))
        assert.equal(s.list()[0].status, status, e)
    }
    s.applyEvent(ev('SessionEnd'))
    assert.equal(s.list().length, 0)
})

test('unknown session on Stop is created as done', () => {
    const s = new SessionStore(clock())
    s.applyEvent(ev('Stop', { session_id: 'zz' }))
    assert.equal(s.list()[0].status, 'done')
})

test('since only changes when status changes; repeat events report no change', () => {
    const now = clock()
    const s = new SessionStore(now)
    s.applyEvent(ev('UserPromptSubmit'))
    const since = s.list()[0].since
    now.advance(5000)
    assert.equal(s.applyEvent(ev('PreToolUse')), false)
    assert.equal(s.list()[0].since, since)
    s.applyEvent(ev('Stop'))
    assert.equal(s.list()[0].since, since + 5000)
})

test('later events fill in missing tilixId/pid', () => {
    const s = new SessionStore(clock())
    s.applyEvent(ev('Stop', { tilix_id: null, pid: null }))
    assert.equal(s.applyEvent(ev('Stop', { tilix_id: 'abc', pid: 7 })), true)
    assert.equal(s.list()[0].tilixId, 'abc')
    assert.equal(s.list()[0].pid, 7)
})

test('list is ordered by start time', () => {
    const now = clock()
    const s = new SessionStore(now)
    s.applyEvent(ev('SessionStart', { session_id: 'b' }))
    now.advance(1)
    s.applyEvent(ev('SessionStart', { session_id: 'a' }))
    assert.deepEqual(s.list().map(x => x.id), ['b', 'a'])
})

test('markSeen turns done into idle and leaves others alone', () => {
    const s = new SessionStore(clock())
    s.applyEvent(ev('Stop'))
    s.applyEvent(ev('Notification', { session_id: 's2' }))
    assert.equal(s.markSeen('s1'), true)
    assert.equal(s.markSeen('s2'), false)
    assert.deepEqual(s.list().map(x => x.status), ['idle', 'waiting'])
})

test('prune removes dead pids, keeps pid null', () => {
    const s = new SessionStore(clock())
    s.applyEvent(ev('SessionStart', { session_id: 'a', pid: 1 }))
    s.applyEvent(ev('SessionStart', { session_id: 'b', pid: 2 }))
    s.applyEvent(ev('SessionStart', { session_id: 'c', pid: null }))
    assert.equal(s.prune(pid => pid !== 2), true)
    assert.deepEqual(s.list().map(x => x.id).sort(), ['a', 'c'])
    assert.equal(s.prune(() => true), false)
})

test('oldestWaiting returns the longest-waiting session', () => {
    const now = clock()
    const s = new SessionStore(now)
    assert.equal(s.oldestWaiting(), null)
    s.applyEvent(ev('Notification', { session_id: 'a' }))
    now.advance(10)
    s.applyEvent(ev('Notification', { session_id: 'b' }))
    assert.equal(s.oldestWaiting().id, 'a')
})

test('ignores events without session_id or with unknown event name', () => {
    const s = new SessionStore(clock())
    assert.equal(s.applyEvent({ event: 'Stop' }), false)
    assert.equal(s.applyEvent(ev('Bogus')), false)
    assert.equal(s.list().length, 0)
})

test('JSON roundtrip', () => {
    const now = clock()
    const s = new SessionStore(now)
    s.applyEvent(ev('Notification', { tilix_id: 'abc' }))
    const copy = SessionStore.fromJSON(JSON.parse(JSON.stringify(s)), now)
    assert.deepEqual(copy.list(), s.list())
})

// ---- Codex: sessions come from process discovery, hooks only update status ----
const T1 = '11111111-1111-1111-1111-111111111111'
const T2 = '22222222-2222-2222-2222-222222222222'
const cx = (event, extra = {}) => ({
    event, agent: 'codex', session_id: 'thread-a', cwd: '/p/shop', tilix_id: 'daemon-tab', pid: 999, ...extra,
})

test('discovered codex processes appear idle with their own tab, and sync is idempotent', () => {
    const s = new SessionStore(clock())
    assert.equal(s.syncCodexProcesses([{ pid: 10, cwd: '/p/shop', tilixId: T1 }]), true)
    assert.equal(s.syncCodexProcesses([{ pid: 10, cwd: '/p/shop', tilixId: T1 }]), false)
    const [x] = s.list()
    assert.equal(x.agent, 'codex')
    assert.equal(x.status, 'idle')
    assert.equal(x.name, 'shop')
    assert.equal(x.tilixId, T1)
    assert.equal(x.pid, 10)
})

test('codex hook links to the process session by cwd and ignores the daemon tab/pid', () => {
    const s = new SessionStore(clock())
    s.syncCodexProcesses([{ pid: 10, cwd: '/p/shop', tilixId: T1 }, { pid: 11, cwd: '/p/api', tilixId: T2 }])
    s.applyEvent(cx('UserPromptSubmit'))
    s.applyEvent(cx('PermissionRequest', { session_id: 'thread-b', cwd: '/p/api' }))
    const byName = Object.fromEntries(s.list().map(x => [x.name, x]))
    assert.equal(s.list().length, 2)
    assert.equal(byName.shop.status, 'working')
    assert.equal(byName.shop.tilixId, T1)
    assert.equal(byName.shop.pid, 10)
    assert.equal(byName.api.status, 'waiting')
    assert.equal(byName.api.tilixId, T2)
})

test('later events for a linked thread find it even without cwd', () => {
    const s = new SessionStore(clock())
    s.syncCodexProcesses([{ pid: 10, cwd: '/p/shop', tilixId: T1 }])
    s.applyEvent(cx('UserPromptSubmit'))
    s.applyEvent(cx('Stop', { cwd: undefined }))
    assert.equal(s.list()[0].status, 'done')
    assert.equal(s.list().length, 1)
})

test('codex SessionEnd resets a process session to idle instead of removing it', () => {
    const s = new SessionStore(clock())
    s.syncCodexProcesses([{ pid: 10, cwd: '/p/shop', tilixId: T1 }])
    s.applyEvent(cx('Stop'))
    s.applyEvent(cx('SessionEnd'))
    assert.equal(s.list().length, 1)
    assert.equal(s.list()[0].status, 'idle')
    // a new thread (/new) in the same terminal relinks
    s.applyEvent(cx('UserPromptSubmit', { session_id: 'thread-c' }))
    assert.equal(s.list()[0].status, 'working')
    assert.equal(s.list().length, 1)
})

test('two codex terminals in the same folder: new threads go to the unlinked one', () => {
    const s = new SessionStore(clock())
    s.syncCodexProcesses([{ pid: 10, cwd: '/p/shop', tilixId: T1 }, { pid: 11, cwd: '/p/shop', tilixId: T2 }])
    s.applyEvent(cx('UserPromptSubmit', { session_id: 'a' }))
    s.applyEvent(cx('PermissionRequest', { session_id: 'b' }))
    assert.deepEqual(s.list().map(x => x.status).sort(), ['waiting', 'working'])
})

test('codex hook without a matching process creates a non-jumpable session', () => {
    const s = new SessionStore(clock())
    s.applyEvent(cx('UserPromptSubmit', { cwd: '/elsewhere' }))
    const [x] = s.list()
    assert.equal(x.agent, 'codex')
    assert.equal(x.tilixId, null)
    assert.equal(x.pid, null)
    s.applyEvent(cx('SessionEnd'))
    assert.equal(s.list().length, 0)
})

test('hook-only codex sessions are replaced once a process in that folder is discovered', () => {
    const s = new SessionStore(clock())
    s.applyEvent(cx('Stop'))
    s.syncCodexProcesses([{ pid: 10, cwd: '/p/shop', tilixId: T1 }])
    assert.equal(s.list().length, 1)
    assert.equal(s.list()[0].pid, 10)
})

// ---- daily stats ----
test('daily stats: prompts, finished, wait time, longest task; roll over at midnight', () => {
    const now = clock(new Date(2026, 10, 22, 10, 0, 0).getTime())
    const s = new SessionStore(now)
    s.applyEvent(ev('UserPromptSubmit'))
    s.applyEvent(ev('UserPromptSubmit')) // second prompt, same status: still counted
    s.applyEvent(ev('UserPromptSubmit', { session_id: 's2', cwd: '/p/api' }))
    now.advance(60_000)
    s.applyEvent(ev('Notification'))
    now.advance(30_000)
    let st = s.stats()
    assert.equal(st.prompts, 3)
    assert.equal(st.waitMs, 30_000) // currently waiting counts too
    assert.deepEqual(st.counts, { working: 1, waiting: 1, done: 0, idle: 0 })
    assert.equal(st.longest.name, 'api')
    assert.equal(st.longest.ms, 90_000)
    s.applyEvent(ev('Stop'))
    st = s.stats()
    assert.equal(st.finished, 1)
    assert.equal(st.waitMs, 30_000)
    // JSON keeps daily
    assert.deepEqual(SessionStore.fromJSON(JSON.parse(JSON.stringify(s)), now).stats().prompts, 3)
    now.advance(24 * 3600_000)
    st = s.stats()
    assert.equal(st.prompts, 0)
    assert.equal(st.finished, 0)
})

test('codex prompts count toward daily prompts', () => {
    const s = new SessionStore(clock())
    s.applyEvent({ event: 'UserPromptSubmit', agent: 'codex', session_id: 't', cwd: '/x' })
    assert.equal(s.stats().prompts, 1)
})
