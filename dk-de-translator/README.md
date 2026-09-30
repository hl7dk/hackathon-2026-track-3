# dk-de-translator

Three HAPI FHIR servers and two validators for testing DK → DE translation.

| Server | Port | IGs |
|---|---|---|
| hapi-dk | 8080 | DK-Core 3.7.0 |
| hapi-de-hospital | 8081 | de.basisprofil.r4 1.5.2, ISiK, MII |
| hapi-de-gp | 8082 | de.basisprofil.r4 1.5.4, KBV Basis, ePA medication |

```sh
docker compose up -d
```

The servers keep data in memory, so a restart wipes it.

## Validators

Put resources or bundles in `data/in/`, then:

```sh
docker compose run --rm validator-hospital
docker compose run --rm validator-gp
```

Reports go to `data/out/<hospital|gp>/report.html`. Set `INPUTS` to validate specific files
(paths inside the container, e.g. `INPUTS=/data/in/bundle.json`), and `TX_SERVER=n/a` to run offline.
