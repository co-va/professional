#!/usr/bin/env bash
# Deterministic local integration: real production image and Nginx routing,
# mock only the public raw GitHub static upstream. No real account mutations.
set -euo pipefail
tmp="$(mktemp -d)"
cid=""
mock=""
cleanup() {
  if [ -n "$cid" ]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
  if [ -n "$mock" ]; then kill "$mock" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
mkdir -p "$tmp/raw/co-va/professional"
ln -s "$PWD" "$tmp/raw/co-va/professional/staging"
# HTTP mock only for static files; preserve the production HTTPS API config.
sed 's@https://raw.githubusercontent.com/co-va/professional/staging@http://127.0.0.1:19090/co-va/professional/staging@' nginx.conf > "$tmp/nginx.conf"
python3 -m http.server 19090 --bind 127.0.0.1 --directory "$tmp/raw" >"$tmp/mock.log" 2>&1 &
mock=$!
cid="$(docker run -d --network host -v "$tmp/nginx.conf:/etc/nginx/conf.d/default.conf:ro" professional-release)"
for i in $(seq 1 20); do
  if curl -fsS -H 'Host: prof.va-tools.ru' http://127.0.0.1:3000/ -o "$tmp/main.html"; then break; fi
  sleep 1
done
grep -q '/assets/' "$tmp/main.html"
preview='professional-volokovykh.msk1.amvera.tech'
fetch() { curl -fsS -H "Host: $preview" -D "$tmp/headers" "http://127.0.0.1:3000$1" -o "$tmp/body"; }
check() {
  fetch "$1"
  grep -qi '^X-CO-VA-Preview: staging' "$tmp/headers"
  grep -qi "^Content-Type: $2" "$tmp/headers"
  grep -qi '^Cache-Control:.*no-store' "$tmp/headers"
}
check / text/html
grep -q 'src="professional.js"' "$tmp/body"
check /professional.js application/javascript
cmp professional.js "$tmp/body"
check /ui/v2/v2.css text/css
cmp ui/v2/v2.css "$tmp/body"
check /booking text/html
grep -q 'online-booking/booking-entry.js' "$tmp/body"
check /invite/ text/html
grep -q 'invite.js' "$tmp/body"
check /service-worker.js application/javascript
status="$(curl -sS -H "Host: $preview" -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/PROJECT_STATE.md)"
test "$status" = 404
status="$(curl -sS -H "Host: $preview" -X POST -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/professional.js)"
test "$status" = 403
echo 'PASS: one Amvera container, main production bundle, staging preview routes, MIME, cache and static access boundaries'

# The local HTTP fixture verifies routing but cannot prove the real upstream TLS.
# Exercise the unmodified production image against both real HTTPS upstreams.
docker rm -f "$cid" >/dev/null
cid="$(docker run -d --network host professional-release)"
for i in $(seq 1 20); do
  if curl -fsS -H 'Host: prof.va-tools.ru' http://127.0.0.1:3000/ -o "$tmp/main.html"; then break; fi
  sleep 1
done
if ! curl -fsS --retry 3 --retry-all-errors --retry-delay 2 --max-time 25 -H "Host: $preview" -D "$tmp/headers" http://127.0.0.1:3000/ -o "$tmp/body"; then
  docker logs --tail 60 "$cid"
  exit 1
fi
grep -qi '^X-CO-VA-Preview: staging' "$tmp/headers"
grep -q 'src="professional.js"' "$tmp/body"
for host in "$preview" prof.va-tools.ru; do
  status="$(curl -sS --max-time 25 -H "Host: $host" -H 'Authorization: Bearer ci-invalid-professional-token' -o "$tmp/api.body" -w '%{http_code}' http://127.0.0.1:3000/api/auth/me)"
  case "$status" in 401|403) ;; *) docker logs --tail 60 "$cid"; echo "Unexpected API status: $status"; exit 1;; esac
done
echo 'PASS: real GitHub and Core HTTPS upstreams with certificate verification enabled'
