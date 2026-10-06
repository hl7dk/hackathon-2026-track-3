#!/bin/sh
# Uploads the StructureDefinitions of a FHIR package again under a shorter version label, for a HAPI server
# that resolves versioned canonicals only by exact version. KBV Basis 1.9.0 points at its de.basisprofil
# parents as e.g. http://fhir.de/StructureDefinition/humanname-de-basis|1.5, which HAPI does not match to
# 1.5.4, so every KBV validation fails with HAPI-0705 (the HL7 validator does match them).
# The copies get the id <id>-<alias>, so the originals stay as they are.
#   ./add_version_alias.sh <fhir base url> <package> <version> <alias>
#   ./add_version_alias.sh https://datasource3.hl7-your-health.projects.alexandrainst.dk/fhir de.basisprofil.r4 1.5.4 1.5
set -e
cd "$(dirname "$0")"

BASE=${1:?usage: ./add_version_alias.sh <fhir base url> <package> <version> <alias>}
PKG=${2:?package name}
VERSION=${3:?package version}
ALIAS=${4:?version alias}
AUTH=""
case "$BASE" in
  https://*)
    [ -f ../.env ] || { echo "Missing ../.env with USERNAME=... and PASSWORD=..." >&2; exit 1; }
    AUTH="$(grep '^USERNAME=' ../.env | cut -d= -f2-):$(grep '^PASSWORD=' ../.env | cut -d= -f2-)"
    ;;
esac

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -sfL -o "$TMP/package.tgz" "https://packages.fhir.org/$PKG/$VERSION"
tar xzf "$TMP/package.tgz" -C "$TMP"

suffix=$(echo "$ALIAS" | tr '.' '-')
for f in "$TMP"/package/StructureDefinition-*.json; do
  id="$(jq -r .id "$f")-$suffix"
  id=$(echo "$id" | cut -c1-64)
  status=$(jq --arg id "$id" --arg v "$ALIAS" '.id = $id | .version = $v' "$f" \
    | curl -s -o /dev/null -w '%{http_code}' ${AUTH:+-u "$AUTH"} -X PUT "$BASE/StructureDefinition/$id" \
      -H 'Content-Type: application/fhir+json' --data-binary @-)
  echo "$status StructureDefinition/$id"
done
