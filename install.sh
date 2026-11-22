#!/usr/bin/env bash
# Installs the Loupedeck Claude board. Re-runnable. `./install.sh --uninstall` removes it.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
UNIT_DIR="$HOME/.config/systemd/user"
HOOK="$DIR/hooks/hook.sh"
CODEX_HOOKS="${CODEX_HOME:-$HOME/.codex}/hooks.json"
NODE="$(command -v node)"
RULE=/etc/udev/rules.d/70-loupedeck.rules

if [[ $EUID -eq 0 ]]; then
    echo "Run this as your normal user (not with sudo); it asks for sudo only for the device rule." >&2
    exit 1
fi

if [[ "${1:-}" == "--uninstall" ]]; then
    systemctl --user disable --now loupedeck-claude.service 2>/dev/null || true
    rm -f "$UNIT_DIR/loupedeck-claude.service"
    systemctl --user daemon-reload
    [[ -f "$SETTINGS" ]] && "$NODE" "$DIR/scripts/merge-hooks.mjs" "$SETTINGS" "$HOOK" --remove
    [[ -f "$CODEX_HOOKS" ]] && "$NODE" "$DIR/scripts/merge-hooks.mjs" "$CODEX_HOOKS" "$HOOK" --remove
    echo "Uninstalled. (udev rule left at $RULE; remove with: sudo rm $RULE)"
    exit 0
fi

echo "==> Device permission (udev rule, needs sudo)"
# uaccess must be applied before 73-seat-late.rules, hence the 70- prefix
if ! cmp -s "$DIR/udev/70-loupedeck.rules" "$RULE" || [[ -e /etc/udev/rules.d/99-loupedeck.rules ]]; then
    sudo rm -f /etc/udev/rules.d/99-loupedeck.rules
    sudo install -m 644 "$DIR/udev/70-loupedeck.rules" "$RULE"
    sudo udevadm control --reload-rules
    sudo udevadm trigger --action=add --subsystem-match=tty
    sudo udevadm settle
fi

echo "==> Node dependencies"
(cd "$DIR" && npm install --no-fund --no-audit)

echo "==> Codex pet artwork (downloaded from OpenAI's CDN, not shipped in this repo)"
"$NODE" "$DIR/scripts/fetch-pets.mjs"

echo "==> Claude Code hooks"
chmod +x "$HOOK"
mkdir -p "$(dirname "$SETTINGS")"
if [[ -f "$SETTINGS" ]]; then
    cp "$SETTINGS" "$SETTINGS.bak-loupedeck-$(date +%Y%m%d-%H%M%S)"
fi
"$NODE" "$DIR/scripts/merge-hooks.mjs" "$SETTINGS" "$HOOK"

echo "==> Codex hooks"
mkdir -p "$(dirname "$CODEX_HOOKS")"
if [[ -f "$CODEX_HOOKS" ]]; then
    cp "$CODEX_HOOKS" "$CODEX_HOOKS.bak-loupedeck-$(date +%Y%m%d-%H%M%S)"
fi
"$NODE" "$DIR/scripts/merge-hooks.mjs" "$CODEX_HOOKS" "$HOOK" codex

echo "==> systemd user service"
mkdir -p "$UNIT_DIR"
sed -e "s#@NODE@#$NODE#" -e "s#@DIR@#$DIR#" "$DIR/systemd/loupedeck-claude.service.in" > "$UNIT_DIR/loupedeck-claude.service"
systemctl --user daemon-reload
systemctl --user enable --now loupedeck-claude.service
systemctl --user restart loupedeck-claude.service

echo
echo "Done. Logs: journalctl --user -u loupedeck-claude -f"
echo "Already-running Claude sessions appear after their next prompt."
echo "Codex: run /hooks once inside Codex and trust the Loupedeck hooks."
