#!/usr/bin/env bash
# One reviewed repair for the existing DartFlow provider; default is offline plan.
# Only attributeCondition may change. No tokens, keys, roles, APIs or new resources.
set -euo pipefail
set +x
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
project_id=''
apply=false
while (($#)); do
  case "$1" in
    --project) [[ $# -ge 2 && -z "$project_id" ]] || fail 'Geef precies één expliciete project-ID op.'; project_id=$2; shift 2 ;;
    --apply) [[ "$apply" == false ]] || fail '--apply mag maar één keer voorkomen.'; apply=true; shift ;;
    *) fail 'Gebruik: bash ops/player-play-cloud-repair-subject.sh --project dartflow [--apply]' ;;
  esac
done
[[ "$project_id" == dartflow ]] || fail 'Deze eenmalige repair is uitsluitend voor project dartflow (955883910359).'
readonly pool_id='dartflow-player-play'
readonly provider_id='github-main'
readonly pool_name='projects/955883910359/locations/global/workloadIdentityPools/dartflow-player-play'
readonly provider_name="$pool_name/providers/$provider_id"
readonly marker='Managed by ops/player-play-cloud-setup.sh v1; package nl.dartflow.app'
readonly workflow='dartflow/platform/.github/workflows/player-play-release.yml@refs/heads/main'
readonly legacy_subject='repo:dartflow/platform:environment:player-play-production'
readonly subject='repo:dartflow@355255545/platform@1453713803:environment:player-play-production'
readonly old_condition="assertion.repository_id == '1453713803' && assertion.repository_owner_id == '355255545' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '$workflow' && assertion.sub == '$legacy_subject' && assertion.environment == 'player-play-production' && assertion.event_name == 'workflow_dispatch'"
readonly new_condition="assertion.repository_id == '1453713803' && assertion.repository_owner_id == '355255545' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '$workflow' && assertion.sub == '$subject' && assertion.environment == 'player-play-production' && assertion.event_name == 'workflow_dispatch'"
readonly mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref,attribute.environment=assertion.environment,attribute.event_name=assertion.event_name'
if [[ "$apply" == false ]]; then
  printf 'Alleen plan; geen Cloud-aanroep of wijziging. Project: dartflow (955883910359)\nProvider: %s\n' "$provider_name"
  printf 'Oude subject: %s\nNieuwe subject: %s\n' "$legacy_subject" "$subject"
  printf '%s\n' 'Uitsluitend attributeCondition wordt aangepast; alle andere trustvoorwaarden en providervelden blijven exact gelijk.'
  exit 0
fi
command -v gcloud >/dev/null || fail 'Gebruik de eigen geauthenticeerde Google Cloud Shell.'
command -v python3 >/dev/null || fail 'Python 3 ontbreekt.'
temporary_directory=$(mktemp -d)
trap 'rm -rf -- "$temporary_directory"' EXIT
trap 'exit 130' INT TERM
cloud() {
  local destination=$1;shift
  gcloud --quiet "$@" >"$temporary_directory/$destination.json" 2>"$temporary_directory/cloud-error.log" || fail 'De beperkte providerrepair is geweigerd. Er worden geen alternatieve rechten of resources ingesteld.'
}
cloud selected config get-value project
[[ $(tr -d '\r\n' <"$temporary_directory/selected.json") == dartflow ]] || fail 'Selecteer eerst bewust project dartflow in Cloud Shell.'
cloud project projects describe dartflow --project=dartflow --format=json
python3 - "$temporary_directory/project.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]))
if v.get('projectId')!='dartflow' or str(v.get('projectNumber'))!='955883910359' or v.get('lifecycleState')!='ACTIVE':sys.exit('De exacte actieve projectidentiteit ontbreekt.')
PY
cloud pool iam workload-identity-pools list --project=dartflow --location=global --filter="name=$pool_name" --format=json
cloud before iam workload-identity-pools providers list --project=dartflow --location=global --workload-identity-pool="$pool_id" --format=json
state=$(python3 - "$temporary_directory/pool.json" "$temporary_directory/before.json" "$pool_name" "$provider_name" "$marker" "$mapping" "$old_condition" "$new_condition" <<'PY'
import json,sys
pool_path,path,pool,provider,marker,mapping,old,new=sys.argv[1:]
def require(value):
 if not value:sys.exit('Bestaande provider wijkt af; geen reparatie uitgevoerd. Laat de inrichting afzonderlijk beoordelen.')
pools=json.load(open(pool_path));require(isinstance(pools,list) and len(pools)==1)
p=pools[0];require(p.get('name')==pool and p.get('description')==marker and p.get('displayName')=='DartFlow player Play' and p.get('state')=='ACTIVE' and not p.get('disabled',False))
values=json.load(open(path));require(isinstance(values,list) and len(values)==1)
v=values[0];require(v.get('name')==provider and v.get('description')==marker and v.get('displayName')=='DartFlow player GitHub main' and v.get('state')=='ACTIVE' and not v.get('disabled',False))
require(v.get('attributeMapping')==dict(item.split('=',1) for item in mapping.split(',')))
oidc=v.get('oidc',{});require(isinstance(oidc,dict) and oidc.get('issuerUri')=='https://token.actions.githubusercontent.com' and not oidc.get('allowedAudiences') and set(oidc)<={'issuerUri','allowedAudiences'})
require(not any(key in v for key in ('aws','saml','x509','actorProviders')))
require(v.get('attributeCondition') in (old,new))
print('unchanged' if v['attributeCondition']==new else 'legacy')
PY
)
if [[ "$state" == unchanged ]]; then
  printf '%s\n' 'Provider is al correct; geen Cloud-mutatie uitgevoerd.'
  exit 0
fi
[[ "$state" == legacy ]] || fail 'Onbekende providerstatus; geen reparatie uitgevoerd.'
cloud update iam workload-identity-pools providers update-oidc "$provider_id" --project=dartflow --location=global --workload-identity-pool="$pool_id" --attribute-condition="$new_condition" --format=json
cloud after iam workload-identity-pools providers list --project=dartflow --location=global --workload-identity-pool="$pool_id" --format=json
python3 - "$temporary_directory/before.json" "$temporary_directory/after.json" "$new_condition" <<'PY'
import json,sys
before=json.load(open(sys.argv[1]));after=json.load(open(sys.argv[2]));expected=sys.argv[3]
if not isinstance(after,list) or len(after)!=1:sys.exit('Providerrepair niet bevestigd; controleer de exacte provider.')
v=dict(before[0]);v['attributeCondition']=expected
if after[0]!=v:sys.exit('Providerrepair gewijzigd buiten de verwachte condition; stop en controleer de inrichting.')
PY
printf '%s\n' 'De bestaande providercondition is gecontroleerd hersteld naar de immutable GitHub-subject. Geen issuer, mapping, labels, rollen, sleutels of andere resources gewijzigd.'
