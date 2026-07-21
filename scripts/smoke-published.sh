#!/usr/bin/env bash
set -euo pipefail

# End-to-end smoke test for the latest published SimpleWorkJS packages.
# This script installs from npm, generates an app, runs migrations, starts
# the server, logs in, and verifies the API.

SMOKE_DIR="$(mktemp -d -t swj-smoke-XXXXXX)"
trap 'rm -rf "$SMOKE_DIR"' EXIT

echo "==> Smoke test directory: $SMOKE_DIR"
cd "$SMOKE_DIR"

cat > package.json <<'EOF'
{
  "name": "swj-smoke",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node app.js",
    "simpleworks": "npx simpleworks"
  },
  "dependencies": {
    "@simpleworkjs/backend": "latest",
    "@simpleworkjs/conf": "latest",
    "@simpleworkjs/orm-identity": "latest"
  }
}
EOF

echo "==> Installing latest published packages..."
npm install --no-fund --no-audit

echo ""
echo "==> Installed versions:"
node -e "
const b = require('./node_modules/@simpleworkjs/backend/package.json');
const o = require('./node_modules/@simpleworkjs/orm/package.json');
const i = require('./node_modules/@simpleworkjs/orm-identity/package.json');
console.log('  backend:', b.version);
console.log('  orm:', o.version);
console.log('  orm-identity:', i.version);
"

echo ""
echo "==> Generating app..."
npx simpleworks generate smoke-app
cd smoke-app
npm install --no-fund --no-audit

echo ""
echo "==> Checking initial schema status..."
npx simpleworks orm:status | grep -q "Tables to create" || {
  echo "ERROR: orm:status did not report tables to create"
  exit 1
}

echo ""
echo "==> Creating initial migration..."
npx simpleworks orm:migrate:make init
ls migrations/*.js > /dev/null

echo ""
echo "==> Running migrations..."
npx simpleworks orm:migrate

echo ""
echo "==> Checking schema status after migration..."
npx simpleworks orm:status | grep -q "Schema is up to date" || {
  echo "ERROR: schema is not up to date after migration"
  exit 1
}

echo ""
echo "==> Starting server on a free port..."
PORT=$(node -e "const net=require('net'); const s=net.createServer(); s.listen(0,()=>{console.log(s.address().port); s.close();});")
# Patch the generated config to use the free port.
sed -i "s/port: 3000/port: ${PORT}/" conf/base.js
sed -i "s/port: 3000/port: ${PORT}/" conf/development.js
npm start > server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$SMOKE_DIR"' EXIT

BASE_URL="http://localhost:${PORT}"

# Wait for server to be ready.
for i in $(seq 1 60); do
  if curl -s --max-time 1 "${BASE_URL}/" > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo ""
echo "==> Verifying home page is reachable..."
HOME_STATUS=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "${BASE_URL}/" || true)
if [ "$HOME_STATUS" != "200" ]; then
  echo "ERROR: home page returned HTTP ${HOME_STATUS:-'(no response)'} (expected 200)"
  cat server.log
  exit 1
fi

echo ""
echo "==> Verifying frontend assets are served..."
JS_STATUS=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "${BASE_URL}/lib/js/app.js" || true)
if [ "$JS_STATUS" != "200" ]; then
  echo "ERROR: /lib/js/app.js returned HTTP ${JS_STATUS:-'(no response)'} (expected 200)"
  cat server.log
  exit 1
fi

echo ""
echo "==> Logging in as seeded admin..."
LOGIN_STATUS=$(curl -s --max-time 5 -c /tmp/swj-cookies.txt -o /tmp/swj-login-body.txt -w '%{http_code}' \
  -X POST "${BASE_URL}/login" \
  -d 'userName=admin&password=Changeme1!' || true)
echo "Login HTTP status: $LOGIN_STATUS"
if [ "$LOGIN_STATUS" != "302" ] && [ "$LOGIN_STATUS" != "301" ]; then
  echo "ERROR: login returned HTTP ${LOGIN_STATUS:-'(no response)'} (expected redirect)"
  echo "Response body:"
  cat /tmp/swj-login-body.txt
  echo ""
  echo "Server log:"
  cat server.log
  exit 1
fi

echo ""
echo "==> Verifying /api/User..."
API_BODY=$(curl -s --max-time 5 -b /tmp/swj-cookies.txt "${BASE_URL}/api/User" || true)
echo "$API_BODY" | grep -q '"userName":"admin"' || {
  echo "ERROR: /api/User did not return admin user"
  echo "$API_BODY"
  exit 1
}

echo ""
echo "==> Smoke test passed."
