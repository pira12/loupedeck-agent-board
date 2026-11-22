#!/usr/bin/env node
// Adds Loupedeck board hooks to a Claude Code settings.json or Codex hooks.json, idempotently.
// Usage: node scripts/merge-hooks.mjs <file.json> <path/to/hook.sh> [claude|codex] [--remove]
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop', 'SessionEnd']
export const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop', 'SessionEnd']

const isOurs = (h, hookPath) => typeof h?.command === 'string' && h.command.startsWith(`${hookPath} `)

export function removeHooks(settings, hookPath) {
    const out = structuredClone(settings ?? {})
    if (!out.hooks) return out
    for (const event of Object.keys(out.hooks)) {
        out.hooks[event] = out.hooks[event]
            .map(group => ({ ...group, hooks: (group.hooks ?? []).filter(h => !isOurs(h, hookPath)) }))
            .filter(group => group.hooks.length > 0)
        if (out.hooks[event].length === 0) delete out.hooks[event]
    }
    if (Object.keys(out.hooks).length === 0) delete out.hooks
    return out
}

export function mergeHooks(settings, hookPath, agent = 'claude') {
    const out = removeHooks(settings, hookPath)
    out.hooks ??= {}
    for (const event of agent === 'codex' ? CODEX_EVENTS : EVENTS) {
        out.hooks[event] ??= []
        out.hooks[event].push({
            ...(event === 'PreToolUse' ? { matcher: '*' } : {}),
            hooks: [{ type: 'command', command: `${hookPath} ${event}${agent === 'codex' ? ' codex' : ''}`, timeout: 2 }],
        })
    }
    return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2)
    const flag = args.includes('--remove') ? '--remove' : null
    const [file, hookPath, agent = 'claude'] = args.filter(a => a !== '--remove')
    if (!file || !hookPath) {
        console.error('usage: merge-hooks.mjs <file.json> <hook.sh> [claude|codex] [--remove]')
        process.exit(2)
    }
    const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
    const next = flag === '--remove' ? removeHooks(current, hookPath) : mergeHooks(current, hookPath, agent)
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n')
    console.log(`${flag === '--remove' ? 'removed' : 'installed'} Loupedeck hooks in ${file}`)
}
