#!/usr/bin/env bash
# Install (or remove) a macOS launchd agent that keeps a Cloudflare Tunnel
# running, so the dev server is reachable from the internet behind
# Cloudflare Access. Restarts the tunnel if it exits and at login.
#
#   deploy/launchd/install-tunnel.sh            install or reinstall
#   deploy/launchd/install-tunnel.sh uninstall  stop and remove
#
# Prerequisites (one time, see README "Reaching it from the internet"):
#   cloudflared tunnel login
#   cloudflared tunnel create manga-maker
#   ~/.cloudflared/config.yml routing the hostname to http://127.0.0.1:5173
#   cloudflared tunnel route dns manga-maker <hostname>
#   a Cloudflare Access application protecting <hostname>
#
# Environment overrides:
#   LABEL   launchd label           (default: com.<user>.manga-maker.tunnel)
#   CONFIG  cloudflared config file (default: ~/.cloudflared/config.yml)
set -euo pipefail

LABEL="${LABEL:-com.$(id -un).manga-maker.tunnel}"
CONFIG="${CONFIG:-$HOME/.cloudflared/config.yml}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/manga-maker"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

if [[ "${1:-}" == "uninstall" ]]; then
	rm -f "$PLIST"
	echo "Removed $LABEL"
	exit 0
fi

CLOUDFLARED="$(command -v cloudflared)" || {
	echo "cloudflared not found on PATH; brew install cloudflared" >&2
	exit 1
}
[[ -f "$CONFIG" ]] || { echo "Missing $CONFIG" >&2; exit 1; }
"$CLOUDFLARED" tunnel --config "$CONFIG" ingress validate >/dev/null

mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$CLOUDFLARED</string>
		<string>tunnel</string>
		<string>--config</string><string>$CONFIG</string>
		<string>--no-autoupdate</string>
		<string>run</string>
	</array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>10</integer>
	<key>StandardOutPath</key><string>$LOG_DIR/tunnel.log</string>
	<key>StandardErrorPath</key><string>$LOG_DIR/tunnel.error.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $LABEL using $CONFIG (logs: $LOG_DIR)"
