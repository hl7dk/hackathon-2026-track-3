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

Local HAPI servers in the `local` compose profile: three with the same IGs as the shared ones, and one for the ConceptMaps (see Translator below):

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

A draft UI in `frontend/` (Vite, React, Tailwind): get the patient's records into a wallet, look at them next to their validation output, give consent, convert and send to a German server. Consent is a placeholder (marked as such on the page): nothing is enforced. Convert passes the data on unchanged for now.

With `.env` in place:

```sh
./dev.sh        # http://localhost:28090 (runs npm install the first time)
```

http://localhost:28090/patients.html lists the patients on each server; click one to see their record.

### Wallet sign-in

The wallet proves who the patient is. Routes in `frontend/server/walletPlugin.js`:

1. **Sign in with MitID** (`POST /wallet/sign-in`): pick a test user (`testUsers` in `config.yml`) and get an identity credential.
2. **Get my records** (`POST /verifier/requests`): the source asks for the CPR, and the wallet shows what it would share.
3. **Share** (`POST /verifier/requests/<id>/response`): the verifier checks the credential, takes the CPR from it and returns that patient's `Patient/$everything`. The browser never sends a CPR itself.

After Share, the wallet card lists what the verifier checked, also logged as `[verifier] …` in the `npm run dev` terminal. "Behind the scenes", next to the wallet card, follows it all live (`GET /events`, `frontend/server/events.js`): walt.id's issuer and verifier events (their SSE streams, followed by the dev server) and the app's own steps, such as the patient's Share or Decline. The patient has to be on the Danish source first; alternatively, load a bundle file.

`wallet.mode` in `config.yml` picks the implementation:

- **`waltid`** (default, `frontend/server/waltid.js`): walt.id's issuer, verifier and wallet on 28095-28097 plus its web wallet on 28098, started by `./dev.sh` (compose profile `wallet`, configs in `waltid/`), all in memory. Sign-in issues an EUDI PID (SD-JWT VC) with the CPR as `personal_administrative_number` into a walt.id wallet, bound to its key (OpenID4VCI). The source asks for the CPR only (OpenID4VP); the other claims stay hidden. Besides walt.id's checks, we check that the PID is signed with our issuer's published key, since walt.id only checks against the certificate inside the PID. walt.id's web wallet (http://localhost:28098, "Open my wallet") shows the PID: log in as `<test user id>@wallet.demo` with `wallet.waltid.accountPassword` from `config.yml` (the card shows both). Restarting walt.id or the dev server: sign in again.
- **`demo`** (`frontend/server/demo.js`): no extra services. The dev server signs a JWT with the CPR as subject and the browser holds it. "Try a forged credential" edits the CPR, and the verifier refuses it.

Not covered: the dev server drives both wallet and verifier, so "Share" is a button on our page rather than in the patient's own wallet app; and the plain proxy paths (`/datasource1/fhir`, used by validation and `patients.html`) are still open.

Validation uses `$validate` on the HAPI server you pick, so it needs the IGs loaded there. On a German server each resource is checked as if it claimed that server's profile, the same mapping as the CLI validators.

Server URLs, profiles, the test users and the share options are in `frontend/config.yml`. The page calls the Danish source as `/datasource1/fhir`, which `npm run dev` proxies to the shared server, adding the credentials from `.env` (`auth: basic`) so they never reach the browser. The German targets are the local servers started by `./dev.sh`, called as `/local-de-hospital/fhir` and `/local-de-gp/fhir` and proxied to ports 28081 and 28082 without credentials. To send to the shared German servers instead, point them at `datasource2` and `datasource3` with `auth: basic` (see the comment above `targets` in `config.yml`).
