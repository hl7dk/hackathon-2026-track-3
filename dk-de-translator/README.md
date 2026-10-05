# dk-de-translator

A frontend and two validators for testing DK → DE translation, against the shared HAPI servers `https://datasource1..4.hl7-your-health.projects.alexandrainst.dk/fhir` (basic auth):

| Role | Server |
|---|---|
| Danish source (DK-Core) | datasource1 |
| German hospital (ISiK / MII) | datasource2 |
| German GP (KBV) | datasource3 |

Put the credentials in `.env` (gitignored) next to this file:

```sh
USERNAME=...
PASSWORD=...
```

### Local servers (optional)

Three local HAPI servers with the same IGs, in the `local` compose profile:

| Server | Port | IGs |
|---|---|---|
| hapi-dk | 28080 | DK-Core 3.7.0 |
| hapi-de-hospital | 28081 | de.basisprofil.r4 1.5.2, ISiK, MII |
| hapi-de-gp | 28082 | de.basisprofil.r4 1.5.4, KBV Basis, ePA medication |

```sh
docker compose --profile local up -d
```

They keep data in memory, so a restart wipes it. To use them, point `frontend/config.yml` at them (see its header).

#### German test patient: Max Mustermann

For the DE → DK direction, `data/in/` has a German patient, Max Mustermann (KVNR `M123456785`, no CPR), as one transaction Bundle per German system: `max-de-gp-bundle.json` (KBV) and `max-de-hospital-bundle.json` (ISiK / MII, with an inpatient Encounter). Once `./dev.sh` has started the local German servers and they answer (the first start takes a few minutes), load him from this folder:

```sh
curl -s -X POST http://localhost:28082/fhir -H 'Content-Type: application/fhir+json' \
  --data-binary @data/in/max-de-gp-bundle.json | jq -r '.entry[].response.location'
curl -s -X POST http://localhost:28081/fhir -H 'Content-Type: application/fhir+json' \
  --data-binary @data/in/max-de-hospital-bundle.json | jq -r '.entry[].response.location'
```

Each prints the new resource locations; if it prints nothing, the server is still starting, so wait and retry. Check with `curl -s -H 'Cache-Control: no-cache' "http://localhost:28082/fhir/Patient?identifier=http://fhir.de/sid/gkv/kvid-10|M123456785" | jq .total` (without `no-cache`, HAPI may answer a repeated search from its cache for about a minute), or pick the German server in the patient view (http://localhost:28090/patients.html). Posting again creates a second copy; `docker compose --profile local restart hapi-de-hospital hapi-de-gp` wipes both servers to start clean.

## Validators

Put resources or bundles in `data/in/`, then:

```sh
docker compose run --rm validator-hospital
docker compose run --rm validator-gp
```

Reports go to `data/out/<hospital|gp>/report.html`. Set `INPUTS` to validate specific files (paths inside the container, e.g. `INPUTS=/data/in/bundle.json`), and `TX_SERVER=n/a` to run offline.

## Frontend

A draft UI in `frontend/` (Vite, React, Tailwind): get the patient's records into a wallet, look at them next to their validation output, give consent, convert and send to a German server. The wallet, sign-in and consent are placeholders (marked as such on the page): every button just works, nothing is authenticated or enforced. Convert passes the data on unchanged for now.

With `.env` in place:

```sh
./dev.sh        # http://localhost:28090 (runs npm install the first time)
```

"Get my records" in the wallet looks up the patient by CPR on the Danish source and reads `Patient/$everything`, so the patient has to be on that server first. Alternatively, load a bundle file with the file picker.

Validation uses `$validate` on the HAPI server you pick, so it needs the IGs loaded there. On a German server each resource is checked as if it claimed that server's profile, the same mapping as the CLI validators.

Server URLs, profiles, the default patient and the share options are in `frontend/config.yml`. The page calls the servers as `/datasource1/fhir`, `/datasource2/fhir` and `/datasource3/fhir`; `npm run dev` proxies those to the shared servers and adds the credentials from `.env` (`auth: basic`), so they never reach the browser.
