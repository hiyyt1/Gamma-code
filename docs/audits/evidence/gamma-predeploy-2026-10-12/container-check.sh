#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
mkdir -p /srv/gamma-audit
tar -xf /source.tar -C /srv/gamma-audit
cd /srv/gamma-audit
apt-get update
apt-get install -y python3 ca-certificates
python3 -B - <<'PY'
import sys
sys.path.insert(0,'deploy/installer')
import gamma_installer as g
h=g.Host()
h.run(['apt-get','install','-y',*g.PACKAGES], extra={'DEBIAN_FRONTEND':'noninteractive'})
g.create_users(h)
g.install_runtimes(h)
print('OS packages and SHA-256 verified Bun/Node installed',flush=True)
PY
chown -R gamma-build:gamma-build /srv/gamma-audit
export PATH=/opt/gamma/runtime/bun-1.3.14:/opt/gamma/runtime/node-v22.22.0-linux-x64/bin:/usr/bin:/bin
/usr/sbin/runuser -u gamma-build -- env -i HOME=/home/gamma-build PATH="$PATH" HUSKY=0 bun install --frozen-lockfile
if [ -f runtime/bsl-language-server.jar ]; then
  /usr/sbin/runuser -u gamma-build -- env -i HOME=/home/gamma-build PATH="$PATH" bun script/1c-agent/download-bsl.ts /srv/gamma-audit/runtime/bsl-language-server.jar --verify
else
  /usr/sbin/runuser -u gamma-build -- env -i HOME=/home/gamma-build PATH="$PATH" bun script/1c-agent/download-bsl.ts /srv/gamma-audit/runtime/bsl-language-server.jar
fi
/usr/sbin/runuser -u gamma-build -- env -i HOME=/home/gamma-build PATH="$PATH" PLAYWRIGHT_BROWSERS_PATH=/srv/gamma-audit/.playwright bun packages/opencode/node_modules/playwright/cli.js install chromium
/usr/sbin/runuser -u gamma-build -- env -i HOME=/home/gamma-build PATH="$PATH" OPENCODE_CHANNEL=prod NODE_OPTIONS=--max-old-space-size=4096 bun run --cwd packages/app build
chown -R root:root /srv/gamma-audit
chmod -R a+rX,go-w /srv/gamma-audit
/usr/sbin/runuser -u gamma -- env -i HOME=/home/gamma LANG=C.UTF-8 LC_ALL=C.UTF-8 PATH="$PATH" PLAYWRIGHT_BROWSERS_PATH=/srv/gamma-audit/.playwright bun -e 'const {chromium}=await import("./packages/opencode/node_modules/playwright/index.mjs"); const browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.setContent("<h1>Gamma</h1>");if(await page.locator("h1").textContent()!=="Gamma")throw Error("browser failed");await browser.close();console.log("CHROMIUM_OK")'
echo CLEAN_BUILD_OK

/usr/sbin/runuser -u gamma -- env -i HOME=/home/gamma LANG=C.UTF-8 LC_ALL=C.UTF-8 PATH="$PATH" python3 /tmp/gamma-runtime-smoke.py /srv/gamma-audit
sha256sum bun.lock

cd /srv/gamma-audit/packages/opencode
/usr/sbin/runuser -u gamma -- env -i HOME=/home/gamma LANG=C.UTF-8 LC_ALL=C.UTF-8 PATH="$PATH" PLAYWRIGHT_BROWSERS_PATH=/srv/gamma-audit/.playwright GAMMA_1C_PYTHON=/usr/bin/python3 GAMMA_BSL_JAR=/srv/gamma-audit/runtime/bsl-language-server.jar bun test test/tool/installer-permissions.test.ts test/session/agent-market.test.ts test/mcp/1c-sources.test.ts test/mcp/1c-agent.test.ts
/usr/sbin/runuser -u gamma -- env -i HOME=/home/gamma LANG=C.UTF-8 LC_ALL=C.UTF-8 PATH="$PATH" PLAYWRIGHT_BROWSERS_PATH=/srv/gamma-audit/.playwright bun test test/presentation
