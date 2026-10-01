#!/bin/sh
# Starts the HAPI servers, loads any Danish bundles from data/in/ into hapi-dk,
# then runs the frontend dev server. Ctrl-C stops the frontend only (http://localhost:28090);
# `docker compose down` stops the servers (and wipes their data).
set -e
cd "$(dirname "$0")"

docker compose up -d hapi-dk hapi-de-hospital hapi-de-gp

# The first start installs the IG packages and can take several minutes.
for port in 28080 28081 28082; do
  base="http://localhost:$port/fhir"
  i=0
  until curl -sf "$base/metadata" > /dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 120 ]; then
      echo "No FHIR server at $base after 10 minutes. Check: docker compose logs" >&2
      exit 1
    fi
    [ $((i % 6)) -eq 1 ] && echo "waiting for $base ..."
    sleep 5
  done
  echo "up: $base"
done

# Transaction bundles named *-dk-bundle.json go to the Danish server,
# unless it already has patients (servers were still running from before).
patients=$(curl -s "http://localhost:28080/fhir/Patient?_summary=count" | sed -n 's/.*"total": *\([0-9]*\).*/\1/p')
[ "${patients:-0}" -gt 0 ] && echo "hapi-dk already has $patients patients, not loading data/in/"
[ "${patients:-0}" -gt 0 ] || for f in data/in/*-dk-bundle.json; do
  [ -e "$f" ] || { echo "no data/in/*-dk-bundle.json to load; use the file picker in the frontend"; break; }
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:28080/fhir \
    -H 'Content-Type: application/fhir+json' --data-binary "@$f")
  echo "$code  loaded $(basename "$f")"
done

cd frontend
[ -d node_modules ] || npm install
exec npm run dev
