set -e
# Builds the app for the end-to-end run: the relay of the build is http://localhost:8790 and the trust
# anchors are those of the test PKI (bash e2e/pki.sh first). Run from the repository root. Also writes the
# test keys (.tmp/e2e/keys, made with zeitstempel's make-key: ZEITSTEMPEL_DIR, NODE24): the relay's key file
# (version 3) and the device key texts the scripts type into the app. The audience of the build is
# `zeiterfassung-e2e`, the harness starts the relay with the same RELAY_AUDIENCE.
node e2e/make-trust.cjs
node e2e/make-keys.cjs
VITE_TIMESTAMP_RELAY=http://localhost:8790 VITE_TIMESTAMP_AUDIENCE=zeiterfassung-e2e \
  npx vite build --config e2e/vite.e2e.config.ts
