# Get Pretty

Get Pretty is a Vite React app packaged for iOS and Android with Capacitor.

## Development

1. Copy `.env.example` to `.env` and set the required `VITE_*` values.
2. Run `npm install`.
3. Start the web app with `npm run dev`.

## AI features

Skin analysis, scan score readings, product recommendations and admin AI tests use Claude
Opus 5.5 through the official Anthropic SDK on the server. Set `ANTHROPIC_API_KEY` in `server/.env` (or the API
host's environment) and install the dependencies in `server/`. Keep the key on the server.
The API does not use AWS credentials for AI calls.

The provider client counts tokens before generating, keeps the existing request spending
and time limits, disables automatic SDK retries, and validates the complete JSON before
returning a result. Existing saved Bedrock and Gemini results remain readable; new results
are saved with `source: "anthropic"`.

## Admin API keys

Built-in admins (the `ADMIN_ALLOWED_EMAILS` accounts) can replace PerfectCorp and Anthropic
keys at `/admin/api-keys`. Other admins can see status but cannot check or replace keys.
Each replacement is verified before saving; failure keeps the current key. Saved keys are
encrypted in MongoDB and override the matching server environment key for new requests,
without a restart. Saved values are never displayed or included in audit logs.

One-time deployment setup: generate a random 32-byte value, base64-encode it, and configure
`API_KEYS_ENCRYPTION_KEY` in the API server environment. Deploy this version and restart the
API once. Preserve that encryption key across deployments and back it up separately from
the database; changing or losing it makes saved provider keys unreadable. Do not put it in
frontend configuration or source control. Existing environment provider keys keep working
until replaced in admin. No database migration script is needed: the application writes
an optional `ProviderCredential` document for each provider and new audit action names.

The page shows the last verification time and credential errors reported by live provider
requests, including PerfectCorp `ExpiredApiKey`. Use **Check current key** to refresh status.
PerfectCorp verification only requests a disposable upload slot: no photo is uploaded and
no paid scan is started. Anthropic verification checks access to the configured analysis
model without generating text; this does not establish available account credits. Status
is based on checks and observed errors, not a prediction of the provider's expiration date.
Rollback to older code uses environment keys again and ignores admin replacements, so
restore working environment credentials before rolling back. No hosted environment changes
or production verification are performed by the tests.

## Native apps

The `android/` and `ios/` folders are the checked-in Capacitor projects. After changing web code or Capacitor configuration, run:

```sh
npm run cap:sync
```

Open the native projects with `npm run cap:android` or `npm run cap:ios`. Building the iOS app requires macOS with Xcode.

Capacitor services replace the previous native runtime integrations:

- Camera and photo-library access use `@capacitor/camera`.
- Token/reminder preferences use `@capacitor/preferences`.
- Location uses `@capacitor/geolocation`.
- Ritual reminders use `@capacitor/local-notifications`.

## City autocomplete data

The API uses a self-hosted [GeoNames](https://www.geonames.org/) dataset for city autocomplete.

1. Download `cities15000.zip` from `https://download.geonames.org/export/dump/`.
2. Extract `cities15000.txt` to `server/scripts/data/cities15000.txt` (this directory is gitignored).
3. Set `MONGODB_URI` in `server/.env`, then run `cd server && npm run import:cities`.

The importer replaces the `cities` collection and rebuilds its search indexes each time, so it is safe to rerun when changing GeoNames datasets.
