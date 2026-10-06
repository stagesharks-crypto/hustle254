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

Account balances are displayed from the user's `wallets` row. Task progress, referrals, activity, and admin counts are calculated from their corresponding database tables; missing records are shown as empty or unavailable rather than replaced by sample figures. Wallet transactions are recorded in `wallet_transactions`; historical balances are not reconstructed from records created before that ledger existed.

Free-tier caveat: Supabase currently includes 500 MB database storage, but pauses Free projects after one week of inactivity and does not include downloadable database backups. This is suitable for setup/testing; use a paid Supabase plan before relying on it for a live earnings product. Render's Free Postgres is a 30-day trial, so it is not the recommended persistent database.

## Hustle254 Task Publishing

Task posts are stored in PostgreSQL with `pending_review`, `approved`, or `rejected` status. Submitting a post does not collect or escrow funds; verify reward funding before approving it. Approval publishes it to the Tasks catalog.

Poster accounts are separate registrations (`/api/auth/poster-signup`) and only signed-in poster accounts can submit task posts. Their dashboard lists posts associated with their account and counts linked participant submissions. Existing task posts with no `poster_user_id` are associated by matching the stored poster email; new posts save the authenticated poster's user ID. Apply the current `db/schema.sql` before deploying these API changes because it adds `task_posts.poster_user_id` and `task_submissions.task_post_id`.

The admin dashboard uses a single admin account plus the separately configured `ADMIN_ACCESS_PASSWORD`. The Admin portal offers one-time registration only while no admin exists in the connected database; registration requires this server-side password and uses it as the admin account's login password. A database transaction and advisory lock ensure only one account can be bootstrapped, and further registration is disabled after creation. Sign in from the Admin portal using the registered email and the same password. Never expose `ADMIN_ACCESS_PASSWORD` in frontend environment variables or source control. The admin can list users and posters with stored wallet amounts, suspend/reactivate non-admin accounts, review posts and participant submissions (including submitted proof images), review deposits and withdrawals, and activate/deactivate catalog tasks and campaigns. Approving or rejecting a participant submission changes only its review status; it does not credit a reward. Task reward funding and escrow are not implemented, and only verified poster deposits currently add funds.

## Manual wallet payments

Before deploying the wallet update, apply `db/schema.sql` to the production PostgreSQL database. It adds `wallet_transactions`; the API checks for this table and will refuse production startup when the schema is missing.

Only poster accounts can submit deposits. The wallet UI displays these configured receiving destinations: M-Pesa direct to `0740582544`, M-Pesa Till `4962757`, PayPal `shadrackechesa40@gmail.com`, and USDT on BEP20 at `0x9e48fb73a5e51469897faabe06900202d9921913`. Posters enter the KSh-equivalent paid amount and submit the transfer code/hash. A deposit is pending until an admin matches the reference and amount against the actual payment; approval credits the poster wallet once. Duplicate transaction references are rejected. Use only the specified BEP20 network for the displayed USDT address.

Both user and poster accounts can request withdrawals to M-Pesa, PayPal, cryptocurrency, Till, or bank details. A withdrawal reserves the requested amount from available balance when submitted, preventing it from being spent twice. After the administrator completes the manual transfer, approving settles the request and updates withdrawn totals. Rejecting a request returns the reserved amount to available balance. No withdrawal transfer is automatically sent by the website.

The admin dashboard refreshes wallet queues periodically and immediately after an admin action. Manual review is not payment-provider verification: administrators remain responsible for checking transfer references, amounts, destinations, and transaction settlement. Poster task-post budget estimates are not escrowed or deducted from poster balances.

In local development, the API uses in-memory storage only when no usable PostgreSQL schema is configured. It starts without seeded users, balances, tasks, or activity; new local test data disappears when the server restarts. The health endpoint reports `"database":"fallback"` in this mode.

Submitting a post does not collect or escrow funds. Verify reward funding before approving a post; approval publishes it to the Tasks catalog.

## Sign-In and Admin Access

The side menu and member pages are available only after login or registration. Registration checks email address syntax on both the website and API, but does not confirm that a mailbox exists. Configure `ADMIN_ACCESS_PASSWORD` as a secret on the API service in Render before deployment. Ensure the API is connected to the production database and the current schema has been applied; the one-time Admin portal registration will not work against in-memory fallback storage. Open **Admin portal**, register the only administrator with the configured password, then sign in with the registered email and same password. Admin API routes require a short-lived admin access token; an ordinary login token is not accepted.
