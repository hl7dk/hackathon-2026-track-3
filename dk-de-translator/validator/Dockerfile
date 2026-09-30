FROM eclipse-temurin:21-jre

ARG VALIDATOR_VERSION=6.10.4
ARG IGS

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/validator
RUN curl -fsSL -o validator_cli.jar \
    "https://github.com/hapifhir/org.hl7.fhir.core/releases/download/${VALIDATOR_VERSION}/validator_cli.jar"

# Download the IGs at build time so they are cached in the image
RUN echo '{"resourceType":"Basic","code":{"text":"warmup"}}' > /tmp/warmup.json \
    && java -jar validator_cli.jar /tmp/warmup.json -version 4.0.1 -tx n/a \
       $(for ig in $IGS; do printf -- '-ig %s ' "$ig"; done) \
    && rm /tmp/warmup.json

ENV IGS=${IGS}
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /data
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
