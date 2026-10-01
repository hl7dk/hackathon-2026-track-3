# dk-de-translator

Three HAPI FHIR servers and two validators for testing DK → DE translation.

| Server | Port | IGs |
|---|---|---|
| hapi-dk | 28080 | DK-Core 3.7.0 |
| hapi-de-hospital | 28081 | de.basisprofil.r4 1.5.2, ISiK, MII |
| hapi-de-gp | 28082 | de.basisprofil.r4 1.5.4, KBV Basis, ePA medication |

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

## Frontend

A draft UI in `frontend/` (Vite, React, Tailwind): get the patient's records into a wallet, look at them next to their
validation output, give consent, convert and send to a German server. The wallet, sign-in and consent are placeholders
(marked as such on the page): every button just works, nothing is authenticated or enforced. Convert passes the data on
unchanged for now.

With the servers up:

```sh
cd frontend
npm install     # once
npm run dev     # http://localhost:28090
```

"Get my records" in the wallet looks up the patient by CPR on `hapi-dk` and reads `Patient/$everything`, so the patient
has to be on that server first. Alternatively, load a bundle file with the file picker.

Validation uses `$validate` on the HAPI server you pick, so it needs the IGs loaded there. On a German server each
resource is checked as if it claimed that server's profile, the same mapping as the CLI validators.

Server URLs, profiles, the default patient and the share options are in `frontend/config.yml`. The page calls the
servers as `/hapi-dk/fhir`, `/hapi-de-hospital/fhir` and `/hapi-de-gp/fhir`; `npm run dev` proxies those to the ports above.
For a remote server, set its full URL and drop `proxyTo`.
