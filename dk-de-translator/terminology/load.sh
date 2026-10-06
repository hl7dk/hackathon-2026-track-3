#!/bin/sh
# Loads the ConceptMaps in conceptmaps/ into a FHIR server (PUT, so loading again updates them).
#   ./load.sh                    # the local matchbox container (http://localhost:28084/matchboxv3/fhir); ../maps/load.sh runs this too
#   ./load.sh https://datasource1.hl7-your-health.projects.alexandrainst.dk/fhir  # a shared server, with USERNAME/PASSWORD from ../.env
# Check with: curl "<base>/ConceptMap/\$translate?system=urn:oid:1.2.208.176.2.4.12&code=DE119&targetsystem=http://fhir.de/CodeSystem/bfarm/icd-10-gm"
set -e
cd "$(dirname "$0")"

BASE=${1:-http://localhost:28084/matchboxv3/fhir}
AUTH=""
case "$BASE" in
  https://*)
    [ -f ../.env ] || { echo "Missing ../.env with USERNAME=... and PASSWORD=..." >&2; exit 1; }
    set -a; . ../.env; set +a
    AUTH="$USERNAME:$PASSWORD"
    ;;
esac

for f in conceptmaps/*.json; do
  id=$(basename "$f" .json)
  status=$(curl -s -o /dev/null -w '%{http_code}' ${AUTH:+-u "$AUTH"} -X PUT "$BASE/ConceptMap/$id" \
    -H 'Content-Type: application/fhir+json' --data-binary @"$f")
  echo "$status ConceptMap/$id"
done
