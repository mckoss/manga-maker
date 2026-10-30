#!/usr/bin/env bash
# Install (or remove) a macOS launchd agent that keeps the Vite dev server
# running from this checkout, restarting it if it exits and at login.
#
#   deploy/launchd/install-dev.sh            install or reinstall
#   deploy/launchd/install-dev.sh uninstall  stop and remove
#
# Re-run after changing Node versions: the agent records the absolute path of
# the `node` found on PATH at install time.
#
# Environment overrides:
#   LABEL  launchd label        (default: com.<user>.manga-maker.dev)
#   PORT   dev server port      (default: 5173)
set -euo pipefail

LABEL="${LABEL:-com.$(id -un).manga-maker.dev}"
PORT="${PORT:-5173}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/manga-maker"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

if [[ "${1:-}" == "uninstall" ]]; then
	rm -f "$PLIST"
	echo "Removed $LABEL"
	exit 0
fi

NODE="$(command -v node)" || { echo "node not found on PATH" >&2; exit 1; }
VITE="$REPO/node_modules/vite/bin/vite.js"
[[ -f "$VITE" ]] || { echo "Missing $VITE; run npm install first" >&2; exit 1; }

mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$NODE</string>
		<string>$VITE</string>
		<string>dev</string>
		<string>--port</string><string>$PORT</string>
		<string>--strictPort</string>
	</array>
	<key>WorkingDirectory</key><string>$REPO</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>10</integer>
	<key>StandardOutPath</key><string>$LOG_DIR/dev.log</string>
	<key>StandardErrorPath</key><string>$LOG_DIR/dev.error.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $LABEL on http://127.0.0.1:$PORT (logs: $LOG_DIR)"
