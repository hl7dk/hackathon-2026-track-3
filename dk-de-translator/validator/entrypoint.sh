#!/bin/sh
set -e

IG_ARGS=""
for ig in $IGS; do IG_ARGS="$IG_ARGS -ig $ig"; done

# Without arguments, validate $INPUTS and write the reports to /data/out
if [ "$#" -eq 0 ]; then
  OUT="/data/out/${REPORT_NAME:-validator}"
  mkdir -p "$OUT"
  set -- ${INPUTS:-/data/in} -output "$OUT/outcome.json" -html-output "$OUT/report.html"
fi

exec java ${JAVA_OPTS:--Xmx4g} -jar /opt/validator/validator_cli.jar \
  -version 4.0.1 -tx "${TX_SERVER:-https://tx.fhir.org}" $IG_ARGS "$@"
