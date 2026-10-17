BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referred_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS reward_type TEXT,
  ADD COLUMN IF NOT EXISTS reward_kes NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS qualifying_event_id TEXT,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ;

UPDATE referrals
SET reward_type = CASE users.role WHEN 'poster' THEN 'poster' ELSE 'tasker' END,
    reward_kes = CASE users.role WHEN 'poster' THEN 30 ELSE 5 END,
    status = CASE WHEN referrals.commission_kes > 0 THEN 'paid' ELSE 'pending' END,
    qualified_at = CASE WHEN referrals.commission_kes > 0 THEN referrals.created_at ELSE NULL END,
    credited_at = CASE WHEN referrals.commission_kes > 0 THEN referrals.created_at ELSE NULL END
FROM users
WHERE users.id = referrals.referred_user_id
  AND (referrals.reward_type IS NULL OR referrals.reward_kes IS NULL);

UPDATE users
SET referred_by_user_id = referrals.referrer_id
FROM referrals
WHERE users.id = referrals.referred_user_id
  AND users.referred_by_user_id IS NULL;

ALTER TABLE referrals
  ALTER COLUMN reward_type SET NOT NULL,
  ALTER COLUMN reward_kes SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referrals_reward_type_check'
  ) THEN
    ALTER TABLE referrals
      ADD CONSTRAINT referrals_reward_type_check
      CHECK (reward_type IN ('tasker', 'poster'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referrals_reward_amount_check'
  ) THEN
    ALTER TABLE referrals
      ADD CONSTRAINT referrals_reward_amount_check
      CHECK (reward_kes > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referrals_status_check'
  ) THEN
    ALTER TABLE referrals
      ADD CONSTRAINT referrals_status_check
      CHECK (status IN ('pending', 'paid'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_one_per_referred_user
  ON referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_reward_pending
  ON referrals(reward_type, status)
  WHERE status = 'pending';

COMMIT;
