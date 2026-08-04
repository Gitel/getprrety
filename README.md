# React + Vite

## City autocomplete data

The API uses a self-hosted [GeoNames](https://www.geonames.org/) dataset for city autocomplete.

1. Download `cities15000.zip` from `https://download.geonames.org/export/dump/`.
2. Extract `cities15000.txt` to `server/scripts/data/cities15000.txt` (this directory is gitignored).
3. Set `MONGODB_URI` in `server/.env`, then run `cd server && npm run import:cities`.

The importer replaces the `cities` collection and rebuilds its search indexes each time, so it is safe to rerun when changing GeoNames datasets.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
