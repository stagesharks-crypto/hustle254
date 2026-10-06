# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Supabase Database Setup

The API uses Supabase's hosted PostgreSQL through `pg`; it does not need the Supabase `anon` or `service_role` API keys. Keep the Postgres connection URI private and never add it to frontend variables or commit it.

1. Create a Supabase project. Choose a region near your Render API region and save the database password in a password manager.
2. In the project dashboard, open **Connect**, choose **Session pooler**, and copy the URI. Use the URI exactly as provided (pooler host, port `5432`, and username containing the project ref). Percent-encode special characters in the password if needed.
3. In **SQL Editor**, open a new query, paste the contents of `db/schema.sql`, and run it. The API checks for all tables used by the live account, task, and admin views at startup.
4. In Supabase **Table Editor**, verify that `users`, `wallets`, `tasks`, `task_posts`, `task_submissions`, `payouts`, `referrals`, and `campaigns` exist.
5. In Render, open the API Web Service's **Environment** settings and add `DATABASE_URL` with the Supabase Session Pooler URI. Also set `NODE_ENV=production`, a unique long random `JWT_SECRET`, `ADMIN_ACCESS_PASSWORD`, and `CLIENT_URL` to the deployed website origin.
6. Save and redeploy the API. Check `https://<your-api-service>.onrender.com/api/health`; it must report `"database":"connected"`. Production now refuses to start if the database URL or required schema is missing, instead of accepting writes into mock memory.
7. Create a test account on the deployed site, then verify the row appears in Supabase **Table Editor > users**. Restart/redeploy the API and log in again to confirm the account persists.

For the Vite frontend, set `VITE_API_BASE_URL` in the Render Static Site's environment/build settings to the API service's public origin. In local development, Vite proxies `/api` to `http://localhost:4000`; put the local Supabase URI in the ignored `.env` file as `DATABASE_URL`.

Account balances are displayed from the user's `wallets` row. Task progress, referrals, activity, and admin counts are calculated from their corresponding database tables; missing records are shown as empty or unavailable rather than replaced by sample figures. The schema does not contain a wallet transaction ledger, so date-based earnings and transaction history cannot be reconstructed from balances or task submissions.

Free-tier caveat: Supabase currently includes 500 MB database storage, but pauses Free projects after one week of inactivity and does not include downloadable database backups. This is suitable for setup/testing; use a paid Supabase plan before relying on it for a live earnings product. Render's Free Postgres is a 30-day trial, so it is not the recommended persistent database.

## Hustle254 Task Publishing

Task posts are stored in PostgreSQL with `pending_review`, `approved`, or `rejected` status. Submitting a post does not collect or escrow funds; verify reward funding before approving it. Approval publishes it to the Tasks catalog.

In local development, the API uses in-memory storage only when no usable PostgreSQL schema is configured. It starts without seeded users, balances, tasks, or activity; new local test data disappears when the server restarts. The health endpoint reports `"database":"fallback"` in this mode.

Submitting a post does not collect or escrow funds. Verify reward funding before approving a post; approval publishes it to the Tasks catalog.

## Sign-In and Admin Access

The side menu and member pages are available only after login or registration. Registration checks email address syntax on both the website and API, but does not confirm that a mailbox exists. Configure `ADMIN_ACCESS_PASSWORD` in the ignored local `.env` file and as a secret on the API service in Render. After signing in, enter this password to receive a short-lived admin access token. Admin API routes require that token; an ordinary login token is not accepted.
