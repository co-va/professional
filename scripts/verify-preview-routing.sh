#!/usr/bin/env bash
set -euo pipefail
tmp="$(mktemp -d)"
cid=""
cleanup() { if [ -n "$cid" ]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi; rm -rf "$tmp"; }
trap cleanup EXIT
preview='professional-volokovykh.msk1.amvera.tech'
base='http://127.0.0.1:3000'
git clone --quiet --bare . "$tmp/fixture.git"
git --git-dir="$tmp/fixture.git" update-ref refs/heads/staging HEAD
mkdir "$tmp/cache"
sync_fixture() {
  docker run --rm -v "$tmp/cache:/var/cache/professional-preview" -v "$tmp/fixture.git:/fixture.git:ro" \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/fixture.git \
    --entrypoint /usr/local/bin/professional-preview-refresh professional-release --once "$1"
}
sync_fixture /fixture.git
expected="$(git rev-parse HEAD)"
test "$(cat "$tmp/cache/current/__preview_revision")" = "$expected"
# Failure must not replace a verified snapshot.
if sync_fixture /missing.git; then echo 'Unexpected successful missing repository fetch'; exit 1; fi
test "$(cat "$tmp/cache/current/__preview_revision")" = "$expected"
cid="$(docker run -d --network host -v "$tmp/cache:/var/cache/professional-preview:ro" --entrypoint nginx professional-release -g 'daemon off;')"
ready() {
  for i in $(seq 1 25); do
    if curl -fsS -H 'Host: prof.va-tools.ru' "$base/" -o "$tmp/main.html"; then break; fi
    sleep 1
  done
  grep -q '/assets/' "$tmp/main.html"
}
ready
fetch() { curl -fsS -H "Host: $preview" -D "$tmp/headers" "$base$1" -o "$tmp/body"; }
check() {
  fetch "$1"
  grep -qi '^X-CO-VA-Preview: staging' "$tmp/headers"
  grep -qi "^Content-Type: $2" "$tmp/headers"
  grep -qi '^Cache-Control:.*no-store' "$tmp/headers"
}
check / text/html
grep -q 'src="professional.js"' "$tmp/body"
check /__preview_revision text/plain
test "$(cat "$tmp/body")" = "$expected"
check /professional.js application/javascript
cmp professional.js "$tmp/body"
check /professional/workspace.js application/javascript
cmp professional/workspace.js "$tmp/body"
check /ui/v2/v2.css text/css
cmp ui/v2/v2.css "$tmp/body"
check /booking text/html
grep -q 'online-booking/booking-entry.js' "$tmp/body"
check /invite/ text/html
grep -q 'invite.js' "$tmp/body"
check /service-worker.js application/javascript
test "$(curl -sS -H "Host: $preview" -o /dev/null -w '%{http_code}' "$base/PROJECT_STATE.md")" = 404
test "$(curl -sS -H "Host: $preview" -X POST -o /dev/null -w '%{http_code}' "$base/professional.js")" = 403
echo 'PASS: production and staging separation, verified snapshot, MIME and static access boundaries'
# Load the entire workspace graph in a real browser against the actual container.
node --input-type=module <<'JS'
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,args:['--host-resolver-rules=MAP professional-volokovykh.msk1.amvera.tech 127.0.0.1','--no-proxy-server']});
try {
  const page=await browser.newPage();
  const errors=[];
  page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure()?.errorText));
  page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
  await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await page.goto('http://professional-volokovykh.msk1.amvera.tech:3000/',{waitUntil:'domcontentloaded'});
  const loaded=await page.evaluate(async()=>typeof (await import('/professional/workspace.js')).renderAuthenticated==='function');
  if(!loaded||errors.length)throw Error('Workspace import failed: '+errors.join('\n'));
  console.log('PASS: complete workspace dependency graph loaded from local staging snapshot');
} finally {await browser.close();}
JS
docker rm -f "$cid" >/dev/null
cid="$(docker run -d --network host professional-release)"
ready
for i in $(seq 1 30); do
  if fetch /__preview_revision; then break; fi
  sleep 2
done
if ! grep -Eq '^[0-9a-f]{40}$' "$tmp/body"; then docker logs --tail 60 "$cid"; exit 1; fi
check /professional/workspace.js application/javascript
for host in "$preview" prof.va-tools.ru; do
  status="$(curl -sS --max-time 25 -H "Host: $host" -H 'Authorization: Bearer ci-invalid-professional-token' -o "$tmp/api.body" -w '%{http_code}' "$base/api/auth/me")"
  case "$status" in 401|403) ;; *) docker logs --tail 60 "$cid"; echo "Unexpected API status: $status"; exit 1;; esac
done
echo 'PASS: real GitHub staging fetch and Core API HTTPS in the production container'
