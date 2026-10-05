#!/bin/sh
# Runs the frontend dev server (http://localhost:28090) against the servers in frontend/config.yml:
# the shared Danish source (datasource1, logging in with USERNAME/PASSWORD from .env) and the
# local German HAPI servers (hapi-de-hospital on 28081, hapi-de-gp on 28082), started here.
# The local servers keep data in memory and stay up after this exits: docker compose --profile local down
set -e
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing .env with USERNAME=... and PASSWORD=... for the datasource servers" >&2; exit 1; }

# The first start takes a few minutes while the IG packages install; until then the German servers return errors.
docker compose --profile local up -d hapi-de-hospital hapi-de-gp

cd frontend
[ -d node_modules ] || npm install
exec npm run dev
