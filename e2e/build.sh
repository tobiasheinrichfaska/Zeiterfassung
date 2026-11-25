set -e
# Builds the app for the end-to-end run: the relay of the build is http://localhost:8790 and the trust
# anchors are those of the test PKI (bash e2e/pki.sh first). Run from the repository root. Also writes the
# test keys (.tmp/e2e/keys): the relay's key file and the device key texts the scripts type into the app.
node e2e/make-trust.cjs
node e2e/make-keys.cjs
VITE_TIMESTAMP_RELAY=http://localhost:8790 npx vite build --config e2e/vite.e2e.config.ts
