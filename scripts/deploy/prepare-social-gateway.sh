#!/bin/sh
# Idempotent secret provisioning on the authorized production host. Never print secret values.
set -eu
cd /opt/zuno
[ -f .env.zuno ] || exit 1
umask 077
STAMP=$(date +%Y%m%d%H%M%S)
cp .env.zuno "/root/.env.zuno.pre-social-gateway-$STAMP"
node <<'NODE'
const fs = require('fs');
const { randomBytes } = require('crypto');
const path = '/opt/zuno/.env.zuno';
let text = fs.readFileSync(path, 'utf8');
for (const [name, make] of [
  ['SOCIAL_GATEWAY_TOKEN', () => randomBytes(48).toString('base64url')],
  ['SOCIAL_GATEWAY_ENCRYPTION_KEY', () => randomBytes(32).toString('base64')],
]) {
  const pattern = new RegExp('^' + name + '=(.*)$', 'm');
  const match = text.match(pattern);
  if (match && match[1].trim()) continue;
  const line = name + '=' + make();
  text = match ? text.replace(pattern, line) : text.trimEnd() + '\n' + line + '\n';
}
fs.writeFileSync(path + '.social-tmp', text, { mode: 0o600 });
fs.renameSync(path + '.social-tmp', path);
console.log('SOCIAL_GATEWAY_SECRETS_CONFIGURED (values withheld)');
NODE
