#!/usr/bin/env bash
# Reviewed Cloud Shell bootstrap for nl.dartflow.app. Default: offline plan only.
# No credentials, service-account keys, billing changes or project-role grants.
set -euo pipefail
set +x
umask 077

fail() { printf '%s\n' "$1" >&2; exit 1; }
usage() { printf '%s\n' 'Gebruik: bash ops/player-play-cloud-setup.sh --project PROJECT_ID [--apply]'; }
project_id=''
apply=false
while (($#)); do
  case "$1" in
    --project) [[ $# -ge 2 && -z "$project_id" ]] || fail 'Geef precies één expliciete project-ID op.'; project_id=$2; shift 2 ;;
    --apply) [[ "$apply" == false ]] || fail '--apply mag maar één keer voorkomen.'; apply=true; shift ;;
    --help) [[ $# == 1 && -z "$project_id" && "$apply" == false ]] || fail 'Gebruik --help afzonderlijk.'; usage; exit 0 ;;
    *) fail 'Onbekend argument; gebruik --help.' ;;
  esac
done
[[ "$project_id" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail 'Gebruik een geldige Google Cloud-project-ID (6–30 tekens), geen projectnaam of nummer.'

readonly pool_id='dartflow-player-play'
readonly provider_id='github-main'
readonly account_id='dartflow-player-play'
readonly account_name='DartFlow player Play publisher'
readonly marker='Managed by ops/player-play-cloud-setup.sh v1; package nl.dartflow.app'
readonly workflow='dartflow/platform/.github/workflows/player-play-release.yml@refs/heads/main'
readonly subject='repo:dartflow/platform:environment:player-play-production'
readonly condition="assertion.repository_id == '1453713803' && assertion.repository_owner_id == '355255545' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '$workflow' && assertion.sub == '$subject' && assertion.environment == 'player-play-production' && assertion.event_name == 'workflow_dispatch'"
readonly mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref,attribute.environment=assertion.environment,attribute.event_name=assertion.event_name'
readonly account_email="$account_id@$project_id.iam.gserviceaccount.com"

if [[ "$apply" == false ]]; then
  printf 'Alleen plan; geen Cloud-aanroep of wijziging. Project: %s\n' "$project_id"
  printf 'Serviceaccount: %s\nProvider: %s / %s\nTrustcondition: %s\n' "$account_email" "$pool_id" "$provider_id" "$condition"
  printf '%s\n' 'Na review: hetzelfde commando met --apply in Cloud Shell, met dit project geselecteerd.'
  exit 0
fi

command -v gcloud >/dev/null || fail 'Google Cloud CLI ontbreekt; gebruik de eigen geauthenticeerde Cloud Shell.'
command -v python3 >/dev/null || fail 'Python 3 ontbreekt.'
temporary_directory=$(mktemp -d)
trap 'rm -rf -- "$temporary_directory"' EXIT
trap 'exit 130' INT TERM

# Capture API/configuration output privately. Never print tokens, account lists,
# IAM policies or raw errors; no credential-returning command is used.
cloud() {
  local destination=$1
  shift
  gcloud --quiet "$@" >"$temporary_directory/$destination.json" 2>"$temporary_directory/cloud-error.log" || fail 'Cloud-stap geweigerd. Controleer project, bestaande resources, organisatiebeleid en eigen rechten; het script verbreedt geen rechten.'
}
cloud selected config get-value project
selected_project=$(tr -d '\r\n' <"$temporary_directory/selected.json")
[[ "$selected_project" == "$project_id" ]] || fail 'Het geselecteerde Cloud Shell-project wijkt af van --project. Selecteer bewust het juiste project en probeer opnieuw.'
cloud project projects describe "$project_id" --project="$project_id" --format=json
project_number=$(python3 - "$temporary_directory/project.json" "$project_id" <<'PY'
import json,re,sys
value=json.load(open(sys.argv[1]))
if value.get('projectId')!=sys.argv[2] or value.get('lifecycleState')!='ACTIVE' or not re.fullmatch(r'[0-9]+',str(value.get('projectNumber',''))):
    sys.exit('Projectidentiteit of actieve status niet bevestigd.')
print(value['projectNumber'])
PY
)
readonly pool_name="projects/$project_number/locations/global/workloadIdentityPools/$pool_id"
readonly provider_name="$pool_name/providers/$provider_id"
readonly principal="principalSet://iam.googleapis.com/$pool_name/attribute.repository_id/1453713803"

# JSON validators reject conflicting resources instead of updating/reusing them.
validate() {
  python3 - "$1" "$temporary_directory/$2.json" "$project_id" "$pool_name" "$provider_name" "$account_email" "$marker" "$account_name" "$condition" "$mapping" "$principal" <<'PY'
import json,sys
mode,path,project,pool,provider,email,marker,display,condition,mapping,principal=sys.argv[1:]
value=json.load(open(path))
def require(ok):
    if not ok: sys.exit('Bestaande Cloud-inrichting wijkt af; stop voor onafhankelijke review. Er worden geen resources overschreven.')
if mode in ('account','pool','provider'):
    require(isinstance(value,list) and len(value)<=1)
    if not value: print('missing'); sys.exit(0)
    value=value[0]
    require(not value.get('disabled',False) and value.get('description')==marker)
    if mode=='account':
        require(value.get('projectId')==project and value.get('email')==email and value.get('displayName')==display)
    elif mode=='pool':
        require(value.get('name')==pool and value.get('state')=='ACTIVE' and value.get('displayName')=='DartFlow player Play')
    else:
        expected=dict(item.split('=',1) for item in mapping.split(','))
        require(value.get('name')==provider and value.get('state')=='ACTIVE' and value.get('displayName')=='DartFlow player GitHub main')
        require(value.get('attributeMapping')==expected and value.get('attributeCondition')==condition)
        oidc=value.get('oidc',{})
        require(oidc.get('issuerUri')=='https://token.actions.githubusercontent.com' and not oidc.get('allowedAudiences') and set(oidc)<= {'issuerUri','allowedAudiences'})
        require(not any(key in value for key in ('aws','saml','x509')))
    print('present')
elif mode=='project-policy':
    require(all('serviceAccount:'+email not in binding.get('members',[]) for binding in value.get('bindings',[])))
elif mode=='account-policy':
    bindings=value.get('bindings',[])
    require(len(bindings)<=1)
    for binding in bindings:
        require(binding.get('role')=='roles/iam.workloadIdentityUser' and binding.get('members')==[principal] and not binding.get('condition'))
    print('present' if bindings else 'missing')
elif mode=='keys':
    require(value==[])
else:
    sys.exit('Onbekende validatie.')
PY
}

# API activation is the only project-wide change. Billing is never linked or
# modified. A denied activation halts; it never triggers an alternate setup.
cloud enabled services enable androidpublisher.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com --project="$project_id" --format=json
cloud project-policy projects get-iam-policy "$project_id" --project="$project_id" --format=json
validate project-policy project-policy

cloud accounts iam service-accounts list --project="$project_id" --filter="email=$account_email" --format=json
account_state=$(validate account accounts)
cloud pools iam workload-identity-pools list --project="$project_id" --location=global --filter="name=$pool_name" --format=json
pool_state=$(validate pool pools)
provider_state=missing
account_policy_state=missing
if [[ "$pool_state" == present ]]; then
  # The dedicated pool may have no other provider: another provider could forge
  # the same mapped repository_id and satisfy a principalSet membership.
  cloud providers iam workload-identity-pools providers list --project="$project_id" --location=global --workload-identity-pool="$pool_id" --format=json
  provider_state=$(validate provider providers)
fi
if [[ "$account_state" == present ]]; then
  cloud account-policy iam service-accounts get-iam-policy "$account_email" --project="$project_id" --format=json
  account_policy_state=$(validate account-policy account-policy)
  cloud keys iam service-accounts keys list --iam-account="$account_email" --managed-by=user --project="$project_id" --format=json
  validate keys keys
fi

if [[ "$account_state" == missing ]]; then
  cloud created-account iam service-accounts create "$account_id" --project="$project_id" --display-name="$account_name" --description="$marker" --format=json
fi
if [[ "$pool_state" == missing ]]; then
  cloud created-pool iam workload-identity-pools create "$pool_id" --project="$project_id" --location=global --display-name='DartFlow player Play' --description="$marker" --format=json
fi
if [[ "$provider_state" == missing ]]; then
  # Empty allowedAudiences uses Google's canonical provider-resource audience,
  # compatible with the existing google-github-actions/auth default audience.
  cloud created-provider iam workload-identity-pools providers create-oidc "$provider_id" --project="$project_id" --location=global --workload-identity-pool="$pool_id" --display-name='DartFlow player GitHub main' --description="$marker" --issuer-uri='https://token.actions.githubusercontent.com' --attribute-mapping="$mapping" --attribute-condition="$condition" --format=json
fi
if [[ "$account_policy_state" == missing ]]; then
  cloud bound-account iam service-accounts add-iam-policy-binding "$account_email" --project="$project_id" --role=roles/iam.workloadIdentityUser --member="$principal" --condition=None --format=json
fi

# Re-read effective resources and policy, including on an interrupted-run retry.
cloud accounts iam service-accounts list --project="$project_id" --filter="email=$account_email" --format=json
[[ $(validate account accounts) == present ]] || fail 'Serviceaccount ontbreekt na inrichting.'
cloud pools iam workload-identity-pools list --project="$project_id" --location=global --filter="name=$pool_name" --format=json
[[ $(validate pool pools) == present ]] || fail 'Workloadpool ontbreekt na inrichting.'
cloud providers iam workload-identity-pools providers list --project="$project_id" --location=global --workload-identity-pool="$pool_id" --format=json
[[ $(validate provider providers) == present ]] || fail 'Provider ontbreekt na inrichting.'
cloud account-policy iam service-accounts get-iam-policy "$account_email" --project="$project_id" --format=json
[[ $(validate account-policy account-policy) == present ]] || fail 'De beperkte federatiebinding ontbreekt.'
cloud keys iam service-accounts keys list --iam-account="$account_email" --managed-by=user --project="$project_id" --format=json
validate keys keys
cloud project-policy projects get-iam-policy "$project_id" --project="$project_id" --format=json
validate project-policy project-policy

printf 'PLAY_WIF_PROVIDER=%s\nPLAY_SERVICE_ACCOUNT=%s\n' "$provider_name" "$account_email"
printf '%s\n' 'Handmatig in Play Console → Gebruikers en rechten: voeg uitsluitend nl.dartflow.app toe.'
printf '%s\n' 'App-rechten: App-gegevens bekijken (alleen-lezen); Apps vrijgeven aan testtracks; Releasen naar productie, apparaten uitsluiten en app-ondertekening van Play gebruiken.'
printf '%s\n' 'Laat alle overige app-rechten en alle accountrechten uit. Laat PLAYER_PLAY_ENABLED=false tot Play-rechten en eerste handmatige AAB-upload zijn gecontroleerd.'
