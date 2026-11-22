# Loupedeck Claude Session Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loupedeck Live S shows every Claude Code session as a colored key; pressing a key focuses that Tilix terminal.

**Architecture:** Claude Code hooks → `hook.sh` → HTTP POST to a Node daemon on 127.0.0.1:47800. The daemon keeps a session store, renders keys with the `loupedeck` library, and focuses terminals through Tilix's D-Bus `activate-terminal` action.

**Tech Stack:** Node 24 (ESM), `loupedeck@7.2.1`, `node:test`, bash + curl, systemd user service, udev.

**Spec:** `docs/design/2026-11-22-design.md`

## Global Constraints
- Hooks: `curl --max-time 1`, always `exit 0`, never print to stdout.
- Port 47800, bind 127.0.0.1 only.
- State file `~/.local/state/loupedeck-claude/sessions.json`.
- Colors: working `#1e6fd9`, waiting `#e8a317` (pulsing), done `#2ea043`, idle `#3a3a3a`.
- Live S: 15 keys (0–14, 5×3, 90×90), knobs `knobTL` (paging), `knobCL` (brightness), buttons 0–3; button 0 = jump to longest-waiting.
- Back up `~/.claude/settings.json` before merging hooks; never drop existing settings.

## Review Focus
- Hook payload missing `TILIX_ID` (session in VS Code / other terminal) → session shown, press flashes key, no crash.
- Daemon not running → hook still exits 0 in <1.1s.
- Event for unknown session_id (daemon restarted mid-session) → session auto-created.
- Claude process killed without SessionEnd → pruned within 5s by pid check.
- Loupedeck unplugged/replugged → daemon survives and redraws on reconnect.

---

### Task 1: Session store
**Files:** Create `package.json`, `src/store.js`; Test `test/store.test.js`

**Interfaces — Produces:** `class SessionStore { constructor(now=Date.now); applyEvent(evt): boolean; markSeen(id); prune(isAlive:(pid)=>boolean): boolean; list(): Session[]; oldestWaiting(): Session|null; toJSON(); static fromJSON(obj, now) }`
`Session = { id, cwd, name /*basename(cwd)*/, tilixId|null, pid|null, status:'idle'|'working'|'waiting'|'done', since:number, started:number }`
`evt = { event, session_id, cwd, tilix_id, pid }`

- [ ] Tests: SessionStart creates idle; UserPromptSubmit/PreToolUse→working; Notification→waiting; Stop→done; SessionEnd removes; unknown id on Stop creates session in done; `since` only changes when status changes; `list()` ordered by `started`; `markSeen` turns done→idle and leaves others; `prune(pid=>pid!==2)` removes pid 2, keeps pid null; `oldestWaiting` returns smallest `since` among waiting; JSON roundtrip.
- [ ] Run `node --test` → fail; implement; run → pass.

### Task 2: Key rendering view-model
**Files:** Create `src/render.js`; Test `test/render.test.js`
**Produces:** `keyView(session, now): {title, label, elapsed, bg, pulse}`; `formatElapsed(ms): string` (`"12s"`, `"4m"`, `"2h"`); `drawSession(ctx, w, h, view, phase)`; `drawEmpty(ctx,w,h)`; `drawPageIndicator`-free (page shown as tiny text in key 14 corner only if >1 page).
- [ ] Tests: formatElapsed 0→"0s", 59_000→"59s", 60_000→"1m", 3_600_000→"1h"; keyView colors per Global Constraints; title truncated to 10 chars with "…"; label is "WORKING"/"NEEDS YOU"/"DONE"/"IDLE"; pulse only for waiting.
- [ ] Implement; draw functions use canvas text (bold title, status label, elapsed) and are not unit-tested.

### Task 3: Terminal focus
**Files:** Create `src/focus.js`; Test `test/focus.test.js`
**Produces:** `focusArgs(tilixId): string[]`; `focusTerminal(tilixId, exec=execFile): Promise<boolean>` (false if no id or gdbus fails).
- [ ] Tests: args equal `['call','--session','--dest','com.gexperts.Tilix','--object-path','/com/gexperts/Tilix','--method','org.gtk.Actions.Activate','activate-terminal',"[<'ID'>]",'{}']`; null id → false without exec; rejects UUIDs not matching `/^[0-9a-f-]{36}$/`.

### Task 4: HTTP server + persistence
**Files:** Create `src/server.js`, `src/persist.js`; Test `test/server.test.js`
**Produces:** `startServer(store, onChange, port=47800): Promise<http.Server>` (POST `/event` JSON → `applyEvent`, 204; GET `/sessions` → JSON list; bad JSON → 400); `loadStore(path, now)`, `saveStore(store, path)` (atomic write via tmp+rename).
- [ ] Tests on port 0: POST SessionStart then GET shows it; bad JSON → 400; onChange called once per change. Persist roundtrip in tmp dir; missing file → empty store.

### Task 5: Board (device wiring) + main
**Files:** Create `src/board.js`, `src/main.js`
**Produces:** `class Board { constructor(store, {focus}); attach(device); render(); }` — paging (`page`, 15 per page, knobTL rotate), brightness (knobCL, steps 0.1, clamp 0.1–1), touchstart → key → session → `focus` then `markSeen`; press on key without tilixId → flash white 150ms; button 0 → oldestWaiting; button LED 0 amber when any waiting else off; redraw every 1s (elapsed + pulse) and on change; on `connect` full redraw.
`main.js`: load store, start server, `new LoupedeckLiveS({ reconnectInterval: 3000 })` (falls back to `discover()` loop), prune every 5s with `process.kill(pid,0)`, save on change (debounced 500ms).
- [ ] Manual verify: `node src/main.js` with device, `curl` a fake SessionStart → key appears.

### Task 6: Hook script + installer
**Files:** Create `hooks/hook.sh`, `install.sh`, `systemd/loupedeck-claude.service`, `udev/99-loupedeck.rules`, `scripts/merge-hooks.mjs`, `README.md`; Test `test/merge-hooks.test.js`
- `hook.sh <Event>`: reads stdin JSON, builds payload with `jq`-free node-free approach (bash: inject fields via `printf` around stdin's session_id extracted by `sed`), POSTs; pid = `$PPID`.
- `merge-hooks.mjs`: `mergeHooks(settings, hookPath): settings` adds one command hook per event (SessionStart, UserPromptSubmit, PreToolUse, Notification, Stop, SessionEnd) idempotently, preserving existing hooks.
- [ ] Tests: merge into `{}` adds 6 events; merging twice yields no duplicates; existing unrelated hooks preserved.
- [ ] udev: `SUBSYSTEM=="tty", ATTRS{idVendor}=="2ec2", MODE="0666"` (plus `TAG+="uaccess"`).
- [ ] Manual verify: daemon stopped → `time hooks/hook.sh Stop </dev/null` exits 0 under 1.1s.
