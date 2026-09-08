# Get Pretty

Get Pretty is a Vite React app packaged for iOS and Android with Capacitor.

## Development

1. Copy `.env.example` to `.env` and set the required `VITE_*` values.
2. Run `npm install`.
3. Start the web app with `npm run dev`.

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
