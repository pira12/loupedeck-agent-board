import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TokenCounter, formatTokens } from '../src/tokens.js'

const NOW = new Date(2026, 10, 22, 15, 0, 0).getTime()
const TODAY = new Date(2026, 10, 22, 12, 0, 0).toISOString()
const YESTERDAY = new Date(2026, 10, 21, 12, 0, 0).toISOString()

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-'))
    const claudeDir = path.join(root, 'claude', 'projects')
    const codexDir = path.join(root, 'codex', 'sessions')
    fs.mkdirSync(path.join(claudeDir, '-p-shop'), { recursive: true })
    fs.mkdirSync(path.join(codexDir, '2026', '11', '22'), { recursive: true })
    let t = NOW
    const now = () => t
    const counter = new TokenCounter({ claudeDir, codexDir, now })
    return { claudeDir, codexDir, counter, setNow: v => { t = v } }
}

const claudeMsg = (id, ts, u) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, usage: u } }) + '\n'
const codexTok = (ts, u) => JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: u } } }) + '\n'

test('sums today: claude deduped by message id, cache reads excluded; codex fresh input + output', () => {
    const { claudeDir, codexDir, counter } = setup()
    const cf = path.join(claudeDir, '-p-shop', 'a.jsonl')
    fs.writeFileSync(cf,
        claudeMsg('m1', TODAY, { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 99999, output_tokens: 5 }) +
        claudeMsg('m1', TODAY, { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 99999, output_tokens: 50 }) +
        claudeMsg('m0', YESTERDAY, { input_tokens: 1000, output_tokens: 1000 }) +
        JSON.stringify({ type: 'user', timestamp: TODAY, message: { content: 'usage' } }) + '\n')
    const xf = path.join(codexDir, '2026', '11', '22', 'rollout.jsonl')
    fs.writeFileSync(xf, codexTok(TODAY, { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 30 }))
    assert.equal(counter.scan(), true)
    assert.deepEqual(counter.totals(), { claude: 160, codex: 230 })
    assert.equal(counter.scan(), false)
})

test('reads appended lines incrementally, including a line split across scans', () => {
    const { claudeDir, counter } = setup()
    const cf = path.join(claudeDir, '-p-shop', 'a.jsonl')
    const line = claudeMsg('m2', TODAY, { input_tokens: 1, output_tokens: 2 })
    fs.writeFileSync(cf, line.slice(0, 20))
    counter.scan()
    assert.equal(counter.totals().claude, 0)
    fs.appendFileSync(cf, line.slice(20))
    counter.scan()
    assert.equal(counter.totals().claude, 3)
})

test('resets at midnight', () => {
    const { claudeDir, counter, setNow } = setup()
    fs.writeFileSync(path.join(claudeDir, '-p-shop', 'a.jsonl'), claudeMsg('m3', TODAY, { input_tokens: 5, output_tokens: 5 }))
    counter.scan()
    assert.equal(counter.totals().claude, 10)
    setNow(NOW + 24 * 3600_000)
    counter.scan()
    assert.equal(counter.totals().claude, 0)
})

test('missing directories are fine', () => {
    const c = new TokenCounter({ claudeDir: '/nope/a', codexDir: '/nope/b' })
    assert.equal(c.scan(), false)
    assert.deepEqual(c.totals(), { claude: 0, codex: 0 })
})

test('formatTokens', () => {
    assert.equal(formatTokens(999), '999')
    assert.equal(formatTokens(1234), '1.2k')
    assert.equal(formatTokens(56_789), '57k')
    assert.equal(formatTokens(1_234_567), '1.2M')
    assert.equal(formatTokens(12_345_678), '12M')
})
