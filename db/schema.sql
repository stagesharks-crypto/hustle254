CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT UNIQUE,
  google_sub TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  referral_code TEXT UNIQUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance_kes NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_kes NUMERIC(12,2) NOT NULL DEFAULT 0,
  withdrawn_kes NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  payout_kes NUMERIC(12,2) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  poster_name TEXT NOT NULL,
  poster_email TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  task_url TEXT,
  proof_requirements TEXT NOT NULL,
  participant_limit INTEGER NOT NULL CHECK (participant_limit BETWEEN 1 AND 10000),
  payout_kes NUMERIC(12,2) NOT NULL CHECK (payout_kes >= 10),
  total_budget_kes NUMERIC(14,2) NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE task_posts
  ADD COLUMN IF NOT EXISTS poster_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS task_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  task_post_id UUID REFERENCES task_posts(id) ON DELETE CASCADE,
  proof_type TEXT NOT NULL DEFAULT 'camera_capture',
  notes TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  ip_address TEXT,
  device_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  CONSTRAINT task_submissions_task_reference_check
    CHECK (task_id IS NOT NULL OR task_post_id IS NOT NULL)
);

ALTER TABLE task_submissions ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE task_submissions
  ADD COLUMN IF NOT EXISTS task_post_id UUID REFERENCES task_posts(id) ON DELETE CASCADE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_submissions_task_reference_check'
  ) THEN
    ALTER TABLE task_submissions
      ADD CONSTRAINT task_submissions_task_reference_check
      CHECK (task_id IS NOT NULL OR task_post_id IS NOT NULL);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal')),
  amount_kes NUMERIC(12,2) NOT NULL CHECK (amount_kes > 0),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  payment_method TEXT,
  transaction_reference TEXT,
  destination TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT wallet_transaction_reference_required
    CHECK (transaction_type != 'deposit' OR NULLIF(BTRIM(transaction_reference), '') IS NOT NULL),
  CONSTRAINT wallet_transaction_destination_required
    CHECK (transaction_type != 'withdrawal' OR NULLIF(BTRIM(destination), '') IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_reference
  ON wallet_transactions(LOWER(transaction_reference))
  WHERE transaction_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created
  ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_review_queue
  ON wallet_transactions(transaction_type, status, created_at)
  WHERE status = 'pending_review';

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  destination TEXT NOT NULL,
  amount_kes NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commission_kes NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bonus_kes NUMERIC(12,2) NOT NULL,
  kind TEXT NOT NULL DEFAULT 'promo',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_task_submissions_user ON task_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_task_post ON task_submissions(task_post_id);
CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_task_posts_status_due_date ON task_posts(status, due_date);
CREATE INDEX IF NOT EXISTS idx_task_posts_poster_user ON task_posts(poster_user_id);
