# Fetman Digital Management Frontend

This is a separate React, TypeScript, and Vite application. It does not
replace or modify the public website in the repository root.

## Run locally

Configure the backend first; see the repository README for the local
MySQL, environment, and one-time Developer setup steps. Start the backend
on port 3000, then from this directory:

```sh
npm install
npm run dev
```

The frontend is available at `http://localhost:5173` and proxies `/api`
requests to the backend at `http://localhost:3000`. Use `npm run build` to
type-check and create a production build, or `npm run lint` to run Oxlint.

## Current status

The frontend includes an API-backed Developer login and protected
dashboard. Department modules remain placeholders. Local authentication
requires manually approved database tables and a Developer account created
with the backend bootstrap command. Do not treat this local milestone as
production-ready or deploy it.
