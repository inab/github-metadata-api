#!/usr/bin/env bash
#
# Tests the app as it ships: inside its Docker image.
#
#   1. Builds the `test` stage, which runs the Jest suite on the image's Node.js.
#   2. Builds the production image, starts it with no credentials mounted, and checks
#      it from outside the container over HTTP.
#
# No GitHub credentials are needed and no request reaches GitHub: without the
# variables/ mount, every authenticated route fails before calling out, which is
# exactly what the error-path checks below rely on.
#
# Usage: npm run test:docker   (from the repo root)

set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="github-metadata-api:smoke-test"
CONTAINER="github-metadata-api-smoke-test-$$"
EXPECTED_NODE="v$(cat .nvmrc)"

failures=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; failures=$((failures + 1)); }

cleanup() {
    if [ "$failures" -gt 0 ] && docker inspect "$CONTAINER" >/dev/null 2>&1; then
        echo
        echo "Container logs:"
        docker logs "$CONTAINER" 2>&1 | tail -50
    fi
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Running the test suite inside the image (Node.js $EXPECTED_NODE)"
BUILD_LOG="$(mktemp)"
if ! DOCKER_BUILDKIT=1 docker build --target test --progress=plain -t "$IMAGE-tests" . >"$BUILD_LOG" 2>&1; then
    tail -60 "$BUILD_LOG"
    echo "Test suite failed inside the image"
    exit 1
fi
# The stage copies in the whole source tree, so Docker only reuses a cached result when
# nothing changed since a run that passed.
grep -E "Test Suites:|Tests:" "$BUILD_LOG" | sed -E 's/^#[0-9]+ [0-9.]+ /  /' \
    || echo "  (cached: no changes since the last passing run)"
rm -f "$BUILD_LOG"

echo "==> Building the production image"
docker build --target production -q -t "$IMAGE" . >/dev/null

echo "==> Starting the container"
docker run -d --name "$CONTAINER" -p 127.0.0.1::8080 "$IMAGE" >/dev/null
BASE_URL="http://$(docker port "$CONTAINER" 8080 | head -1)"

for _ in $(seq 1 30); do
    if curl -sf -o /dev/null "$BASE_URL/api-docs/"; then
        break
    fi
    sleep 1
done

# status METHOD PATH [JSON_BODY] -> prints the HTTP status, body in $BODY_FILE.
BODY_FILE="$(mktemp)"
status() {
    local args=(-s -o "$BODY_FILE" -w '%{http_code}' --max-time 10 -X "$1" "$BASE_URL$2")
    if [ $# -ge 3 ]; then
        args+=(-H 'Content-Type: application/json' -d "$3")
    fi
    curl "${args[@]}" || echo "timeout"
}

echo "==> Checking the running container at $BASE_URL"

node_version="$(docker exec "$CONTAINER" node --version)"
[ "$node_version" = "$EXPECTED_NODE" ] \
    && pass "runs Node.js $EXPECTED_NODE" \
    || fail "runs Node.js $EXPECTED_NODE (got $node_version)"

docker exec "$CONTAINER" sh -c '! ls /app/variables /app/*.pem /app/.env >/dev/null 2>&1' \
    && pass "image contains no credentials" \
    || fail "image contains no credentials (variables/, .pem or .env found in /app)"

code="$(status GET /api-docs/)"
[ "$code" = "200" ] && grep -q "GitHub Metadata API" "$BODY_FILE" \
    && pass "serves the Swagger UI" \
    || fail "serves the Swagger UI (HTTP $code)"

code="$(status POST /metadata '{"owner":"o","repo":"r","installationID":1}')"
[ "$code" = "500" ] && grep -q '"data": null' "$BODY_FILE" \
    && pass "POST /metadata responds with an error when GitHub auth fails" \
    || fail "POST /metadata responds with an error when GitHub auth fails (HTTP $code)"

code="$(status GET '/metadata-extractor-for-fairsoft/installation/id?owner=o&repo=r')"
[ "$code" = "500" ] \
    && pass "GET extractor installation/id responds with an error when GitHub auth fails" \
    || fail "GET extractor installation/id responds with an error when GitHub auth fails (HTTP $code)"

code="$(status POST /metadata/content '{"owner":"o","repo":"r","path":"README.md","installationID":1}')"
[ "$code" = "500" ] \
    && pass "POST /metadata/content responds with an error when GitHub auth fails" \
    || fail "POST /metadata/content responds with an error when GitHub auth fails (HTTP $code)"

code="$(status POST /metadata/pull '{"owner":"o","repo":"r","filename":"f.md","installationID":1,"metadata":"x"}')"
# HTTP 200 with the error in `code`, which is what the Evaluator front end expects.
[ "$code" = "200" ] && grep -qE '"code": ?500' "$BODY_FILE" \
    && pass "POST /metadata/pull reports an error when GitHub auth fails" \
    || fail "POST /metadata/pull reports an error when GitHub auth fails (HTTP $code)"

[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" = "true" ] \
    && pass "container is still running after the error paths" \
    || fail "container is still running after the error paths"

rm -f "$BODY_FILE"

echo
if [ "$failures" -gt 0 ]; then
    echo "$failures check(s) failed"
    exit 1
fi
echo "All checks passed"
