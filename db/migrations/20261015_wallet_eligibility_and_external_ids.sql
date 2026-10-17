BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS external_user_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external_user_id
  ON users(external_user_id);

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS fee_amount_kes NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_fee_nonnegative'
  ) THEN
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT wallet_transactions_fee_nonnegative CHECK (fee_amount_kes >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('task_reward', 'streak_reward', 'survey_reward', 'referral_reward', 'adjustment')),
  amount_kes NUMERIC(12,2) NOT NULL CHECK (amount_kes > 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_created
  ON wallet_ledger_entries(user_id, created_at DESC);

INSERT INTO wallet_ledger_entries
  (wallet_id, user_id, entry_type, amount_kes, source_type, source_id, description, created_at)
SELECT wallets.id, claims.user_id, 'streak_reward', claims.amount_kes,
       'streak_reward_claim', claims.id::text, 'Seven-day login streak reward', claims.created_at
FROM streak_reward_claims AS claims
JOIN wallets ON wallets.user_id = claims.user_id
ON CONFLICT (source_type, source_id) DO NOTHING;

COMMIT;
