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

Local HAPI servers in the `local` compose profile: three with the same IGs as the shared ones, and Matchbox for the translation (see Translator below):

| Server | Port | IGs |
|---|---|---|
| hapi-dk | 28080 | DK-Core 3.7.0 |
| hapi-de-hospital | 28081 | de.basisprofil.r4 1.5.2, ISiK, MII |
| hapi-de-gp | 28082 | de.basisprofil.r4 1.5.4, KBV Basis, ePA medication |
| matchbox | 28084 | none (StructureMaps and ConceptMaps) |

```sh
docker compose --profile local up -d
```

They keep data in memory, so a restart wipes it. `./dev.sh` does not start them. To use them, point `frontend/config.yml` at them (see its header and the comment above `targets`).

#### German test patient: Max Mustermann

For the DE → DK direction, `data/in/` has a German patient, Max Mustermann (KVNR `M123456785`, no CPR), as one transaction Bundle per German system: `max-de-gp-bundle.json` (KBV) and `max-de-hospital-bundle.json` (ISiK / MII, with an inpatient Encounter). Load him from this folder into the shared German servers:

```sh
export FHIR_USERNAME=$(grep '^USERNAME=' .env | cut -d= -f2-)
export FHIR_PASSWORD=$(grep '^PASSWORD=' .env | cut -d= -f2-)
curl -s -u "$FHIR_USERNAME:$FHIR_PASSWORD" -X POST https://datasource3.hl7-your-health.projects.alexandrainst.dk/fhir \
  -H 'Content-Type: application/fhir+json' --data-binary @data/in/max-de-gp-bundle.json | jq -r '.entry[].response.location'
curl -s -u "$FHIR_USERNAME:$FHIR_PASSWORD" -X POST https://datasource2.hl7-your-health.projects.alexandrainst.dk/fhir \
  -H 'Content-Type: application/fhir+json' --data-binary @data/in/max-de-hospital-bundle.json | jq -r '.entry[].response.location'
```

Or into the local German servers, once they answer (the first start takes a few minutes):

```sh
curl -s -X POST http://localhost:28082/fhir -H 'Content-Type: application/fhir+json' \
  --data-binary @data/in/max-de-gp-bundle.json | jq -r '.entry[].response.location'
curl -s -X POST http://localhost:28081/fhir -H 'Content-Type: application/fhir+json' \
  --data-binary @data/in/max-de-hospital-bundle.json | jq -r '.entry[].response.location'
```

Each prints the new resource locations; if it prints nothing, the server is still starting, so wait and retry. Check with `curl -s -H 'Cache-Control: no-cache' "http://localhost:28082/fhir/Patient?identifier=http://fhir.de/sid/gkv/kvid-10|M123456785" | jq .total` (without `no-cache`, HAPI may answer a repeated search from its cache for about a minute), or pick the German server on the dashboard (http://localhost:28090/patients.html). Every resource has a fixed id (`PUT Patient/max-gp-patient`, …), so loading again replaces Max instead of adding a copy; `docker compose --profile local restart hapi-de-hospital hapi-de-gp` wipes both servers to start clean.

## Validators

Put resources or bundles in `data/in/`, then:

```sh
docker compose run --rm validator-hospital
docker compose run --rm validator-gp
```

Reports go to `data/out/<hospital|gp>/report.html`. Set `INPUTS` to validate specific files (paths inside the container, e.g. `INPUTS=/data/in/bundle.json`), and `TX_SERVER=n/a` to run offline.

## Frontend

A draft UI in `frontend/` (Vite, React, Tailwind): get the patient's records into a wallet, look at them next to their validation output, give consent, convert and send to a German server. Consent is a placeholder (marked as such on the page): nothing is enforced. Convert runs the FHIR maps, then the page shows what they fixed and asks for what is missing (see below).

With `.env` in place:

```sh
./dev.sh        # http://localhost:28090 (runs npm install first, so new dependencies are picked up)
```

The dashboard, http://localhost:28090/patients.html, lists the patients on each server; click one to see their record, or delete them (on servers with `allowDelete` in `config.yml`) to run the demo again.

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

Server URLs, profiles, the test users and the share options are in `frontend/config.yml`. The page calls the Danish source as `/datasource1/fhir`, which `npm run dev` proxies to the shared server, adding the credentials from `.env` (`auth: basic`) so they never reach the browser. The German targets work the same way: `/datasource2/fhir` (hospital) and `/datasource3/fhir` (GP). To use the local servers instead, see the comment above `targets` in `config.yml`.

## Translator: StructureMap/$transform on Matchbox

The translation is FHIR all the way: a StructureMap per target, written in the FHIR Mapping Language (FML) in `maps/`, run with `StructureMap/$transform` on [Matchbox](https://ahdis.github.io/matchbox/) (a HAPI-based server; plain HAPI has no `$transform`), the shared one on datasource4 (`docker-compose.yml` and `matchbox/` are its configuration):

| StructureMap | For |
|---|---|
| `dk-to-kbv` | German GP (KBV Basis) |
| `dk-to-isik` | German hospital (ISiK / MII) |
| `dk-to-de-common` | groups both import: copying DK-Core resources, translating codes |
| `de-to-epj` | the other way: a German record (KBV or ISiK / MII) for the Danish EHR (EPJ, DK-Core), with SKS (`http://medinfo.dk/sks`, e.g. `DE780`) and WHO ATC codings in front of the German ones; e.g. `data/in/anne-de-gp-bundle.json` |

Each map takes the Danish Bundle and returns a collection Bundle: German profiles in `meta.profile`, a German coding (with `version`) in front of every Danish one, which stays, and the structural changes for the target (KBV: a contained Medication behind `medicationReference`, versions on the AllergyIntolerance codings). Vital signs (blood pressure, heart rate, SpO2) are LOINC on both sides: they keep their codes and get the German vital-sign profile for their LOINC code (KBV, or de.basisprofil for the hospital, as ISiK keeps its own in a module the server does not have), a SNOMED CT coding next to each LOINC one, and for SpO2 the pulse oximetry code and method. Codes go through FML `translate()` with the ConceptMaps in `terminology/conceptmaps/`:

| ConceptMap | From | To |
|---|---|---|
| `sks-to-icd10gm` | SKS diagnoses | ICD-10-GM 2026 |
| `icpc2-to-icd10gm` | ICPC-2 | ICD-10-GM 2026 |
| `atc-who-to-bfarm` | WHO ATC | BfArM ATC |
| `icd10gm-to-sks` | ICD-10-GM | SKS (DE → DK) |
| `atc-bfarm-to-who` | BfArM ATC | WHO ATC (DE → DK) |

They cover only the codes in the test patients. The FML engine refuses a match whose equivalence is `narrower`, so a more specific German code (DE119 → E11.90) is `inexact`, with a comment.

```sh
./maps/load.sh https://datasource4.hl7-your-health.projects.alexandrainst.dk/matchboxv3/fhir   # ConceptMaps and StructureMaps; again after every edit or redeploy (./dev.sh does it if they are missing)
docker compose up -d matchbox && ./maps/load.sh                                                # or a local Matchbox, http://localhost:28084/matchboxv3/fhir, no IGs
```

Try it:

```sh
curl -s -X POST -H 'Content-Type: application/fhir+json' --data-binary @data/in/anne-dk-bundle.json \
  'http://localhost:28084/matchboxv3/fhir/StructureMap/$transform?source=https://hl7-your-health.projects.alexandrainst.dk/fhir/StructureMap/dk-to-kbv' | jq
```

The German servers need two things their IGs leave out, or they reject correct German data:

- **BfArM ATC codes.** The German packages ship `http://fhir.de/CodeSystem/bfarm/atc` as an empty placeholder (`content: not-present`), so every BfArM ATC code fails. For the demo, the shared German servers hold a full BfArM ATC CodeSystem in its place, built from the WIdO ATC index (copyrighted, so not in this repo). Version 2025: MII Medikation binds BfArM ATC only up to 2025.
- **`de.fhir.medication` 1.0.7** (DosageDE), a dependency of MII Medikation that HAPI does not install by itself. It is in `hapi/de-hospital.yaml`; for a server whose configuration we cannot change, `hapi/install_package.sh <base> de.fhir.medication 1.0.7`.

In the frontend, Convert (`frontend/src/lib/convert.js`) runs the target's map (`map` under `targets` in `config.yml`) on the `transform` server. Step 5, Check and complete (`FixPanel.jsx`, `lib/issues.js`), validates the Danish record and the converted one on the receiver and sorts its errors:

- **Translated by the map**: the codes, and every error gone after the transform.
- **Only you know this**: what the Danish record does not have but the patient knows (when a diagnosis was made, since when a medicine is taken). The answer goes into the resource, which is validated again.
- **Left to the receiver**: what only the German side can assign (the hospital's Patientennummer, the Encounter that `isik-con1` asks for).
- **Not solved**: everything else, and codes without a mapping.

On send, `submit.js` PUTs every resource under an id derived from the Danish one (`dk-<id>`), so sending again replaces the earlier copy, and rewrites references to match. The Patient is only created if the receiver has no one with her CPR; otherwise the record attaches to the Patient it already has (e.g. Anne at her German GP, `data/in/anne-de-gp-bundle.json`). To run the demo again, delete the patient on the German server from the dashboard (`allowDelete` in `config.yml`).
