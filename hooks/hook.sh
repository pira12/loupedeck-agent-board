#!/usr/bin/env bash
# Claude Code / Codex hook → Loupedeck board. Usage: hook.sh <HookEventName> [claude|codex]
# Never blocks Claude: 1s timeout, all output discarded, always exits 0.

event="${1:-}"
agent="${2:-claude}"
port="${LOUPEDECK_CLAUDE_PORT:-47800}"

# Find the claude process (hooks may run under an intermediate shell)
pid=$PPID
for _ in 1 2 3 4; do
    comm=$(cat "/proc/$pid/comm" 2>/dev/null) || break
    [[ "$comm" == claude* || "$comm" == codex* || "$comm" == node ]] && break
    pid=$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null) || break
    [[ -z "$pid" || "$pid" -le 1 ]] && { pid=$PPID; break; }
done

curl -s -o /dev/null --max-time 1 \
    -H "Content-Type: application/json" \
    -H "X-Hook-Event: $event" \
    -H "X-Agent: $agent" \
    -H "X-Tilix-Id: ${TILIX_ID:-}" \
    -H "X-Claude-Pid: $pid" \
    --data-binary @- \
    "http://127.0.0.1:${port}/event" >/dev/null 2>&1 || true

exit 0
