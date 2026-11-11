# Uitrolvoorbeelden

Gebruik de bestaande workflows, runnerregistraties en releasewrapper als bron. Deze bestanden maken het bedoelde contract concreet.

- Vul `hostprofiel.template.json` per omgeving in met de daadwerkelijk geverifieerde waarden.
- `release.yml.example` is een workflowontwerp. Vervang de actie-SHA's, bronref, CI-workflow, labels en variabelen door de goedgekeurde waarden. Houd de productieworkflow gekoppeld aan de bestaande GitHub-environment `production`.
- Het ontwerp gebruikt twee repo-adapters. Bouw of koppel `ops/ci/deploy-verified-release ENV SHA RUN_ID` aan het aangetroffen `dg-site-deploy`-contract. Koppel `ops/ci/accept-staging SHA` aan de echte geautomatiseerde stagingtests. Deze adapters moeten falen bij een verkeerde identiteit, backend, actieve SHA of mislukte test. Ze staan niet in het prototype. Voeg ze uitsluitend toe als het bestaande contract geen gelijkwaardige handelingen biedt.
- Plaats `check-release.sh` bij de verificatiescripts in de applicatierepository als het bestaande healthcontract met dit voorbeeld overeenkomt. Anders pas je de responsevelden aan. Het script vraagt `curl` en `jq`, accepteert één HTTPS- of loopback-origin, en volgt geen redirects.
- Pas `dartflow.service.example` en `Caddyfile.example` uitsluitend toe binnen bestaand DG-beheer. De voorbeeldunit verwacht Next.js standalone. Houd de al geregistreerde eigen runtimegebruiker, paden, poort en hardening aan.
- Leg de resultaten vast in `releasebewijs.template.md`. Werkelijk uitgevoerde staging- en productiedeploys krijgen ieder hun eigen bewijs.

## GitHub-variabelen in het workflowontwerp

| Scope | Variabele | Waarde |
|---|---|---|
| Repo | `DARTFLOW_CI_WORKFLOW` | De beschermde CI-workflowbestandsnaam, bijvoorbeeld `ci.yml`. |
| Repo | `DARTFLOW_REQUIRED_CI_JOBS_JSON` | Niet-lege JSON-array met exact vereiste jobnamen uit die workflow, bijvoorbeeld `["Typecheck","Tests","Build"]`. Neem de echte matrixjobnamen op. Het ontwerp controleert de laatste poging van de exacte run. |
| Staging | `DARTFLOW_ORIGIN` | Gecontroleerde staging HTTPS-origin. |
| Staging | `DARTFLOW_LOOPBACK_ORIGIN` | Werkelijke staging loopback-origin. |
| Staging | `DARTFLOW_RUNNER_NAME` | Geregistreerde stagingrunner. |
| Productie | `DARTFLOW_ORIGIN` | Gecontroleerde productie HTTPS-origin. |
| Productie | `DARTFLOW_LOOPBACK_ORIGIN` | Werkelijke productie loopback-origin. |
| Productie | `DARTFLOW_RUNNER_NAME` | Geregistreerde productierunner. |
| Per omgeving | `NEXT_PUBLIC_SUPABASE_URL` en `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publieke buildwaarden van de doelomgeving als de wrapper ze via GitHub-variabelen aanlevert. |

Beschermde runtime- en migratiewaarden komen via de bestaande secretvoorziening. De release hoeft geen Resend API-sleutel, Google client secret of productie-OTP te ontvangen als die via het beoogde beheerpad worden ingesteld.

[GitHub Workflow jobs API](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt) · [GitHub CLI paginering](https://cli.github.com/manual/gh_api)
