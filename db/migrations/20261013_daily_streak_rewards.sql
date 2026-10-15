BEGIN;

CREATE TABLE IF NOT EXISTS user_streaks (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak BETWEEN 0 AND 7),
  last_login_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS streak_reward_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streak_day DATE NOT NULL,
  reward_usd NUMERIC(8,3) NOT NULL,
  amount_kes NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, streak_day)
);

CREATE INDEX IF NOT EXISTS idx_streak_reward_claims_user_created
  ON streak_reward_claims(user_id, created_at DESC);

COMMIT;
