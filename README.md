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
3. In **SQL Editor**, open a new query, paste the contents of `db/schema.sql`, and run it for a new database. For an existing database, run `db/migrations/20261015_streak_check_in_history.sql` first, followed by `db/migrations/20261015_wallet_eligibility_and_external_ids.sql`. The API checks for the required tables and columns at startup.
4. In Supabase **Table Editor**, verify that `users`, `wallets`, `user_streak_check_ins`, `wallet_transactions`, `wallet_ledger_entries`, `tasks`, `task_posts`, `task_submissions`, `payouts`, `referrals`, and `campaigns` exist.
5. In Render, open the API Web Service's **Environment** settings and add `DATABASE_URL` with the Supabase Session Pooler URI. Also set `NODE_ENV=production`, a unique long random `JWT_SECRET`, `ADMIN_ACCESS_PASSWORD`, and `CLIENT_URL` to the deployed website origin.
6. Save and redeploy the API. Check `https://<your-api-service>.onrender.com/api/health`; it must report `"database":"connected"`. Production now refuses to start if the database URL or required schema is missing, instead of accepting writes into mock memory.
7. Create a test account on the deployed site, then verify the row appears in Supabase **Table Editor > users**. Restart/redeploy the API and log in again to confirm the account persists.

For the Vite frontend, set `VITE_API_BASE_URL` in the Render Static Site's environment/build settings to the API service's public origin. In local development, Vite proxies `/api` to `http://localhost:4000`; put the local Supabase URI in the ignored `.env` file as `DATABASE_URL`.

Account balances are displayed from the user's `wallets` row. Task progress, referrals, activity, and admin counts are calculated from their corresponding database tables; missing records are shown as empty or unavailable rather than replaced by sample figures. Wallet transactions are recorded in `wallet_transactions`; account wallet summaries show pending, approved, rejected, and withdrawn amounts and refresh every 15 seconds. Historical transaction totals are not reconstructed from records created before that ledger existed.

## Daily login streak rewards

Users and posters receive one daily streak check-in automatically when their authenticated session opens. Check-ins are counted by calendar day in `Africa/Nairobi`; repeat checks on the same day do not increase the streak, and a missed day restarts it. Every seventh consecutive login credits `$0.023` (shown in the app with its KSh equivalent) to the account wallet. The reward is credited automatically once per seven-day streak; no claim action is required. Every check-in is saved in `user_streak_check_ins`; current progress is rebuilt from that history, while `user_streaks` stores the latest progress and `streak_reward_claims` stores paid rewards. The streak page also displays the best recorded consecutive run and number of saved check-ins.

Before deploying streak rewards to an existing database, apply `db/migrations/20261013_daily_streak_rewards.sql` and then `db/migrations/20261015_streak_check_in_history.sql` (or apply the updated `db/schema.sql` to a new database). The history migration backfills dates represented by existing streak progress and seven-day reward claims. Earlier daily check-ins that were never recorded cannot be reconstructed. The API checks for the history table at startup and production will not start until the migration is applied.

## Appearance

Use the Light/Dark control in the top bar to switch between the original dark appearance and the light appearance. The selection is saved in the browser and applies across pages on the same device.

Free-tier caveat: Supabase currently includes 500 MB database storage, but pauses Free projects after one week of inactivity and does not include downloadable database backups. This is suitable for setup/testing; use a paid Supabase plan before relying on it for a live earnings product. Render's Free Postgres is a 30-day trial, so it is not the recommended persistent database.

## Hustle254 Task Publishing

Task posts are stored in PostgreSQL with `pending_review`, `approved`, or `rejected` status. Submitting a post does not collect or escrow funds; verify reward funding before approving it. Approval publishes it to the Tasks catalog.

Poster accounts are separate registrations (`/api/auth/poster-signup`) and only signed-in poster accounts can submit task posts. Their dashboard lists posts associated with their account and counts linked participant submissions. Existing task posts with no `poster_user_id` are associated by matching the stored poster email; new posts save the authenticated poster's user ID. Before deploying task-post submission changes, apply `db/schema.sql`. For an existing production database, run the idempotent `db/migrations/20261013_task_submission_post_link.sql` in the PostgreSQL SQL editor first; it makes `task_submissions.task_id` nullable so a community task submission can link through `task_post_id`, while retaining the constraint that each submission references a task. The API health check verifies required columns but does not detect this nullability mismatch.

The admin dashboard uses a single admin account plus the separately configured `ADMIN_ACCESS_PASSWORD`. The Admin portal offers one-time registration only while no admin exists in the connected database; registration requires this server-side password and uses it as the admin account's login password. A database transaction and advisory lock ensure only one account can be bootstrapped, and further registration is disabled after creation. Sign in from the Admin portal using the registered email and the same password. Never expose `ADMIN_ACCESS_PASSWORD` in frontend environment variables or source control. The admin can list users and posters with stored wallet amounts, suspend/reactivate non-admin accounts, review posts and participant submissions (including submitted proof images), review deposits and withdrawals, and activate/deactivate catalog tasks and campaigns. The Wallet transparency section summarizes all recorded received, pending, rejected, available, reserved, and withdrawn balances, while its activity list displays pending transactions plus the 200 most recent settled transactions. Approving or rejecting a participant submission changes only its review status; it does not credit a reward. Task reward funding and escrow are not implemented, and only verified poster deposits currently add funds.

## Manual wallet payments

Before deploying the wallet update, apply `db/schema.sql` to the production PostgreSQL database. It adds `wallet_transactions`; the API checks for this table and will refuse production startup when the schema is missing.

Only poster accounts can submit deposits. The wallet UI displays these configured receiving destinations: M-Pesa direct to `0740582544`, M-Pesa Till `4962757`, PayPal `shadrackechesa40@gmail.com`, and USDT on BEP20 at `0x9e48fb73a5e51469897faabe06900202d9921913`. Posters enter the KSh-equivalent paid amount and submit the transfer code/hash. A deposit is pending until an admin matches the reference and amount against the actual payment; approval credits the poster wallet once. Duplicate transaction references are rejected. Use only the specified BEP20 network for the displayed USDT address.

Both user and poster accounts can request withdrawals to M-Pesa, PayPal, cryptocurrency, Till, or bank details. Only confirmed, eligible wallet funds can be requested. Requests must be between KSh 50 and KSh 100,000. Fees are KSh 10 for KSh 50–384 (up to $3 at the fixed KSh 128 per USD display reference), KSh 15 above KSh 384 through KSh 896 (over $3–$7), and KSh 25 above KSh 896 (over $7); the fee is deducted from the requested amount. M-Pesa withdrawals can only be sent to the phone number registered to the user's Hustle254 account; alternate numbers are rejected for account safety. Withdrawal requests are processed within 5 minutes, while transfer arrival time may vary by payout provider. A withdrawal reserves the requested amount when submitted, preventing it from being spent twice. Completing the request settles the reserved balance and records the net payout; declining it returns the reserved amount. The website does not automatically send a payout.

`wallet_ledger_entries` records credited task and streak rewards using unique source identifiers, so an approved task submission or streak reward cannot be credited twice. Deposit transfer references also have a case-insensitive unique index. Apply `db/migrations/20261015_wallet_eligibility_and_external_ids.sql` to an existing database before deploying these changes; `db/schema.sql` contains the corresponding new-database structure. User and poster accounts have a stable external UUID for partner integrations; it does not change when they sign in again.

The Surveys page requires `CPX_APP_ID` and `CPX_SURVEY_IFRAME_URL` to be set on the API. Use the HTTPS offerwall URL provided by the CPX Research partner account; the API validates the provider domain and appends the authenticated account's stable `ext_user_id`. Without these settings, the page clearly reports that partner setup is not complete. Survey reward callbacks and crediting are not enabled until the partner's signed callback format is configured and verified.

The admin dashboard refreshes wallet queues periodically and immediately after an admin action. Platform summary totals are calculated across all wallet transaction history and wallet balances; the activity list is intentionally limited to pending items plus 200 recent settled items. Manual review is not payment-provider verification: administrators remain responsible for checking transfer references, amounts, destinations, and transaction settlement. Poster task-post budget estimates are not escrowed or deducted from poster balances.

In local development, the API uses in-memory storage only when no usable PostgreSQL schema is configured. It starts without seeded users, balances, tasks, or activity; new local test data disappears when the server restarts. The health endpoint reports `"database":"fallback"` in this mode.

Submitting a post does not collect or escrow funds. Verify reward funding before approving a post; approval publishes it to the Tasks catalog.

## Sign-In and Admin Access

The side menu and member pages are available only after login or registration. Registration checks email address syntax on both the website and API, but does not confirm that a mailbox exists. Configure `ADMIN_ACCESS_PASSWORD` as a secret on the API service in Render before deployment. Ensure the API is connected to the production database and the current schema has been applied; the one-time Admin portal registration will not work against in-memory fallback storage. Open **Admin portal**, register the only administrator with the configured password, then sign in with the registered email and same password. Admin API routes require a short-lived admin access token; an ordinary login token is not accepted.
