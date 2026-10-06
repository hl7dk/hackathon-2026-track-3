#!/bin/sh
# Runs the frontend dev server (http://localhost:28090) against the servers in frontend/config.yml:
# the shared Danish source (datasource1) and German targets (datasource2 hospital, datasource3 GP),
# logging in with USERNAME/PASSWORD from .env. The local HAPI servers are not started; see README.md.
# Also starts the walt.id issuer, verifier and wallet (28095-28097) and its web wallet (28098) for the
# wallet sign-in. They keep data in memory and stay up after this exits: docker compose --profile wallet down
set -e
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing .env with USERNAME=... and PASSWORD=... for the datasource servers" >&2; exit 1; }

# The first start takes a few minutes while the IG packages install; until then the German servers return errors.
# Using the remote servers
# docker compose --profile local up -d hapi-de-hospital hapi-de-gp
docker compose --profile wallet up -d waltid-issuer waltid-verifier waltid-wallet waltid-web-wallet

cd frontend
[ -d node_modules ] || npm install
exec npm run dev
