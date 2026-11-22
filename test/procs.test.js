import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanCodexProcesses } from '../src/procs.js'

function fakeProc(root, pid, { comm, argv, env = {}, cwd = '/' }) {
    const d = path.join(root, String(pid))
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'comm'), comm + '\n')
    fs.writeFileSync(path.join(d, 'cmdline'), argv.join('\0') + '\0')
    fs.writeFileSync(path.join(d, 'environ'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\0'))
    fs.symlinkSync(cwd, path.join(d, 'cwd'))
}

test('finds interactive codex TUIs with their Tilix id and cwd; skips servers and exec', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'))
    const T = '00000000-0000-4000-8000-000000000001'
    fakeProc(root, 100, { comm: 'codex', argv: ['codex'], env: { TILIX_ID: T }, cwd: '/home/u/shop' })
    fakeProc(root, 101, { comm: 'codex', argv: ['codex', 'resume', '--last'], cwd: '/home/u/api' })
    fakeProc(root, 102, { comm: 'codex', argv: ['/x/bin/codex', 'app-server', '--listen', 'unix://'], cwd: '/' })
    fakeProc(root, 103, { comm: 'codex', argv: ['codex', 'exec', 'do it'], cwd: '/' })
    fakeProc(root, 104, { comm: 'claude', argv: ['claude'], cwd: '/' })
    fakeProc(root, 105, { comm: 'codex', argv: ['/x/bin/codex', 'app-server', 'daemon', 'pid-update-loop'], cwd: '/' })
    fs.mkdirSync(path.join(root, 'self'))
    const found = scanCodexProcesses(root).sort((a, b) => a.pid - b.pid)
    assert.deepEqual(found, [
        { pid: 100, cwd: '/home/u/shop', tilixId: T },
        { pid: 101, cwd: '/home/u/api', tilixId: null },
    ])
})

test('unreadable /proc root yields empty list', () => {
    assert.deepEqual(scanCodexProcesses('/nonexistent-proc'), [])
})
