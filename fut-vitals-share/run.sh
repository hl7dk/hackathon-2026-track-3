#!/bin/sh
# Builds and runs the citizen app on http://localhost:8090 against FUT devenvcgi, writing shared
# vital signs to the personal health record (datasource1 by default).
#
# PHR credentials are read from ../dk-de-translator/.env (USERNAME / PASSWORD), unless PHR_USERNAME
# and PHR_PASSWORD are already set. Behind an HTTPS_PROXY (e.g. the devcontainer firewall) the JVM is
# pointed at it, since Java ignores the environment variable.
set -e
cd "$(dirname "$0")"

ENV_FILE=../dk-de-translator/.env
if [ -z "$PHR_USERNAME" ] && [ -f "$ENV_FILE" ]; then
    PHR_USERNAME=$(grep '^USERNAME=' "$ENV_FILE" | cut -d= -f2-)
    PHR_PASSWORD=$(grep '^PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
fi
export PHR_USERNAME PHR_PASSWORD

ENV=${FUT_ENV:-devenvcgi}
export EHEALTH_CITIZEN_ISSUER_URI=${EHEALTH_CITIZEN_ISSUER_URI:-https://saml.$ENV.ehealth.sundhed.dk/auth/realms/nemlogin}
export EHEALTH_CITIZEN_CLIENT_ID=${EHEALTH_CITIZEN_CLIENT_ID:-ehealth-reference-citizen-client}
export SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_CITIZEN_CLIENT_AUTHENTICATION_METHOD=none
export FHIR_SERVER_PATIENT=${FHIR_SERVER_PATIENT:-https://patient.$ENV.ehealth.sundhed.dk/fhir}
export FHIR_SERVER_CARE_PLAN=${FHIR_SERVER_CARE_PLAN:-https://careplan.$ENV.ehealth.sundhed.dk/fhir}
export FHIR_SERVER_PLAN=${FHIR_SERVER_PLAN:-https://plan.$ENV.ehealth.sundhed.dk/fhir}
export FHIR_SERVER_MEASUREMENT=${FHIR_SERVER_MEASUREMENT:-https://measurement.$ENV.ehealth.sundhed.dk/fhir}
export FHIR_SERVER_TASK=${FHIR_SERVER_TASK:-https://task.$ENV.ehealth.sundhed.dk/fhir}
export FHIR_SERVER_DEVICE=${FHIR_SERVER_DEVICE:-https://device.$ENV.ehealth.sundhed.dk/fhir}

JAVA_OPTS=""
if [ -n "$HTTPS_PROXY" ]; then
    hostport=${HTTPS_PROXY#*://}
    hostport=${hostport%/}
    JAVA_OPTS="-Dhttps.proxyHost=${hostport%:*} -Dhttps.proxyPort=${hostport##*:} -Dhttp.nonProxyHosts=localhost|127.0.0.1"
fi

# The app needs Java 21; use mise's when the default java is older.
java_major=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)
if [ "${java_major:-0}" -lt 21 ] && command -v mise >/dev/null 2>&1; then
    JAVA_HOME=$(mise where java@temurin-21 2>/dev/null || (mise install -q java@temurin-21 && mise where java@temurin-21))
    export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
fi

MVN=mvn
[ -x ./mvnw ] && ! command -v mvn >/dev/null 2>&1 && MVN=./mvnw
$MVN -B -q -ntp -pl citizen-client -am -DskipTests package
exec java $JAVA_OPTS -jar citizen-client/target/citizen-client-*.jar
