#!/bin/sh
# Installs the conformance resources of a FHIR package (StructureDefinitions, ValueSets, CodeSystems, ...)
# into a running server with PUT, for a server whose IG configuration we cannot change (the shared ones).
# A local server gets the package in its yaml instead.
#   ./install_package.sh <fhir base url> <package> <version>
#   ./install_package.sh https://datasource2.hl7-your-health.projects.alexandrainst.dk/fhir de.fhir.medication 1.0.7
set -e
cd "$(dirname "$0")"

BASE=${1:?usage: ./install_package.sh <fhir base url> <package> <version>}
PKG=${2:?package name}
VERSION=${3:?package version}
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

for f in "$TMP"/package/*.json; do
  type=$(jq -r '.resourceType // empty' "$f")
  case "$type" in
    StructureDefinition|ValueSet|CodeSystem|ConceptMap|SearchParameter|NamingSystem) ;;
    *) continue ;;
  esac
  id=$(jq -r .id "$f")
  status=$(curl -s -o /dev/null -w '%{http_code}' ${AUTH:+-u "$AUTH"} -X PUT "$BASE/$type/$id" \
    -H 'Content-Type: application/fhir+json' --data-binary @"$f")
  echo "$status $type/$id"
done
