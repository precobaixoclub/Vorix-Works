#!/bin/sh
# Vorix social tunnel — server side (run once, as root, on the production host).
#
# The owner's PC opens `ssh -N -R 172.20.0.1:1080 root@<host>` with a dedicated key: OpenSSH then
# serves a SOCKS proxy on the zuno docker bridge whose connections leave from the PC (a Brazilian
# home connection), so Instagram/Facebook logins and posts are not blocked as datacenter traffic.
#
# Usage: sh server-setup.sh "<contents of vorix_social_tunnel_ed25519.pub>"
# Safe to run again: every step checks before changing, and sshd is validated before reload.
set -eu
PUB=${1:?pass the tunnel public key}
case "$PUB" in ssh-ed25519\ *vorix-social-tunnel*) ;; *) echo "not the vorix-social-tunnel key" >&2; exit 2 ;; esac
BRIDGE_IP=172.20.0.1
BRIDGE_IF=br-$(docker network inspect zuno_network -f '{{.Id}}' | cut -c1-12)
[ "$(docker network inspect zuno_network -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}')" = "$BRIDGE_IP" ] || { echo "zuno_network gateway is not $BRIDGE_IP" >&2; exit 3; }
STAMP=$(date +%Y%m%d%H%M%S)

# 1. Let a client choose the listen address of a remote forward (only keys allowed by permitlisten can).
CONF=/etc/ssh/sshd_config.d/20-vorix-social-tunnel.conf
if [ ! -f "$CONF" ]; then
  printf '%s\n' "# Vorix social tunnel: SOCKS proxy on the zuno docker bridge ($BRIDGE_IP:1080), see scripts/social-tunnel." "GatewayPorts clientspecified" > "$CONF"
fi

# 2. The tunnel key can only open that one remote forward: no shell, no other forwards.
KEYS=/root/.ssh/authorized_keys
if ! grep -q 'vorix-social-tunnel' "$KEYS"; then
  cp -a "$KEYS" "$KEYS.bak-$STAMP"
  echo "restrict,port-forwarding,permitlisten=\"$BRIDGE_IP:1080\",permitopen=\"127.0.0.1:9\",command=\"/usr/bin/false\" $PUB" >> "$KEYS"
fi

sshd -t
systemctl reload ssh
sshd -T | grep -qi '^gatewayports clientspecified' || { echo "GatewayPorts did not apply" >&2; exit 4; }

# 3. Only containers on zuno_network reach the proxy; nothing on the public interface.
ufw status | grep -q "vorix social tunnel" || ufw allow in on "$BRIDGE_IF" from 172.20.0.0/16 to "$BRIDGE_IP" port 1080 proto tcp comment 'vorix social tunnel' >/dev/null

# 4. The gateway sends browser traffic through the tunnel (socks5 = DNS resolved at home too).
ENV=/opt/zuno/.env.zuno
if ! grep -q '^SOCIAL_GATEWAY_PROXY_URL=' "$ENV"; then
  cp -a "$ENV" "/root/.env.zuno.pre-social-tunnel-$STAMP"
  echo "SOCIAL_GATEWAY_PROXY_URL=socks5://$BRIDGE_IP:1080" >> "$ENV"
fi
cd /opt/zuno && docker compose --env-file .env.zuno -f docker-compose.zuno.yml up -d --no-deps social-provider-gateway
echo SOCIAL_TUNNEL_SERVER_READY
