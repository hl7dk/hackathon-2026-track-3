#!/bin/sh
# Loads the ConceptMaps (../terminology/conceptmaps/) and the StructureMaps in this folder (FML, *.map)
# into Matchbox (PUT, so loading again updates them). Run after every Matchbox start and every map edit.
#   ./load.sh                    # the local matchbox container (http://localhost:28084/matchboxv3/fhir)
#   ./load.sh https://datasource4.hl7-your-health.projects.alexandrainst.dk/matchboxv3/fhir  # with USERNAME/PASSWORD from ../.env
# Try it: curl -X POST -H 'Content-Type: application/fhir+json' --data-binary @../data/in/anne-dk-bundle.json \
#   "http://localhost:28084/matchboxv3/fhir/StructureMap/\$transform?source=https://hl7-your-health.projects.alexandrainst.dk/fhir/StructureMap/dk-to-kbv"
set -e
cd "$(dirname "$0")"

BASE=${1:-http://localhost:28084/matchboxv3/fhir}
AUTH=""
case "$BASE" in
  https://*)
    [ -f ../.env ] || { echo "Missing ../.env with USERNAME=... and PASSWORD=..." >&2; exit 1; }
    AUTH="$(grep '^USERNAME=' ../.env | cut -d= -f2-):$(grep '^PASSWORD=' ../.env | cut -d= -f2-)"
    ;;
esac

../terminology/load.sh "$BASE"

# The common groups first: the target maps import them.
for f in dk-to-de-common.map $(ls *.map | grep -v '^dk-to-de-common.map$'); do
  id=$(basename "$f" .map)
  out=$(curl -s -w '\n%{http_code}' ${AUTH:+-u "$AUTH"} -X PUT "$BASE/StructureMap/$id" \
    -H 'Content-Type: text/fhir-mapping' -H 'Accept: application/fhir+json' --data-binary @"$f")
  status=$(echo "$out" | tail -n1)
  echo "$status StructureMap/$id"
  case "$status" in 2*) ;; *) echo "$out" | sed '$d' | head -c 2000; echo ;; esac
done
