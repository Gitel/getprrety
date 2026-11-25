# OVH Docker deployment

Production remains on its existing host until data reconciliation and DNS cutover.
The migration branch builds in GitHub Actions without changing the old deployment.
Set the environment secret OVH_DEPLOY_KEY and repository variable
OVH_DEPLOY_ENABLED=true only when the target is ready for that application's
deployment pipeline. Never copy database credentials into workflow files.

The OVH checkout retains this repository as origin. Release artifacts contain
the exact validated Git commit and image; data, runtime configuration and
credentials stay outside release artifacts. Future Note and GetPretty staging
use DISABLE_BACKGROUND_JOBS=1 until their single-worker handoff.
