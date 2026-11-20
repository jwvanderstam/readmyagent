#!/usr/bin/env bash
# Sets up Drive access for a readmyagent instance in Google Cloud (docs/operations.md, step 1.3):
# APIs, the service account, the Workload Identity Federation pool and provider for Vercel, and the
# binding that lets only the production environment of your Vercel project act as the account.
# No key is created. Safe to run again: existing resources are kept.
#
# Usage:
#   scripts/setup-gcloud.sh --project <project-id> --team <vercel-team-slug> --vercel-project <name>
#
# Needs gcloud, signed in (`gcloud auth login`) with rights to manage IAM in the project.
set -euo pipefail

POOL=vercel
PROVIDER=vercel
SA_NAME=readmyagent-drive
PROJECT="" TEAM="" VERCEL_PROJECT="" ENVIRONMENT=production

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --team) TEAM="${2:-}"; shift 2 ;;
    --vercel-project) VERCEL_PROJECT="${2:-}"; shift 2 ;;
    --environment) ENVIRONMENT="${2:-}"; shift 2 ;;
    -h | --help) usage 0 ;;
    *) echo "Unknown argument: $1" >&2; usage 1 ;;
  esac
done

[ -n "$PROJECT" ] && [ -n "$TEAM" ] && [ -n "$VERCEL_PROJECT" ] || usage 1
# The values end up in an IAM condition and resource names; refuse anything unexpected.
for v in "$PROJECT" "$TEAM" "$VERCEL_PROJECT" "$ENVIRONMENT"; do
  [[ "$v" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "Invalid value: $v" >&2; exit 1; }
done

command -v gcloud >/dev/null || { echo "gcloud is not installed." >&2; exit 1; }

g() { gcloud --project="$PROJECT" --quiet "$@"; }
exists() { g "$@" >/dev/null 2>&1; }

echo "Project $PROJECT"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"

echo "Enabling APIs (Drive, IAM credentials, STS)"
g services enable drive.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

if exists iam service-accounts describe "$SA_EMAIL"; then
  echo "Service account $SA_EMAIL exists"
else
  echo "Creating service account $SA_EMAIL"
  g iam service-accounts create "$SA_NAME" --display-name="readmyagent Drive"
fi

if exists iam workload-identity-pools describe "$POOL" --location=global; then
  echo "Workload identity pool $POOL exists"
else
  echo "Creating workload identity pool $POOL"
  g iam workload-identity-pools create "$POOL" --location=global --display-name="Vercel"
fi

provider_args=(
  --location=global --workload-identity-pool="$POOL"
  --issuer-uri="https://oidc.vercel.com/$TEAM"
  --allowed-audiences="https://vercel.com/$TEAM"
  --attribute-mapping="google.subject=assertion.sub"
  --attribute-condition="assertion.sub.startsWith('owner:$TEAM:project:$VERCEL_PROJECT:')"
)
if exists iam workload-identity-pools providers describe "$PROVIDER" --location=global \
  --workload-identity-pool="$POOL"; then
  echo "Updating provider $PROVIDER to match this team and project"
  g iam workload-identity-pools providers update-oidc "$PROVIDER" "${provider_args[@]}"
else
  echo "Creating provider $PROVIDER"
  g iam workload-identity-pools providers create-oidc "$PROVIDER" "${provider_args[@]}"
fi

SUBJECT="owner:$TEAM:project:$VERCEL_PROJECT:environment:$ENVIRONMENT"
echo "Allowing $SUBJECT to act as the service account"
g iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/subject/$SUBJECT" \
  >/dev/null

cat <<EOF

Done. Values for Vercel ($ENVIRONMENT):
  GCP_PROJECT_NUMBER=$PROJECT_NUMBER
  GCP_SERVICE_ACCOUNT_EMAIL=$SA_EMAIL
  GCP_WORKLOAD_IDENTITY_POOL_ID=$POOL
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=$PROVIDER

Still by hand, in Google Drive (docs/operations.md, step 1.3):
  1. Share the folder Claude-agents with $SA_EMAIL as Editor.
  2. Create feedback.json in that folder yourself and note its file ID.
EOF
