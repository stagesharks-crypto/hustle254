BEGIN;

CREATE TABLE IF NOT EXISTS user_streak_check_ins (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_in_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, check_in_date)
);

INSERT INTO user_streak_check_ins (user_id, check_in_date)
SELECT streak.user_id, check_in.check_in_date::date
FROM user_streaks AS streak
CROSS JOIN LATERAL generate_series(
  streak.last_login_date - (GREATEST(1, LEAST(streak.current_streak, 7)) - 1),
  streak.last_login_date,
  INTERVAL '1 day'
) AS check_in(check_in_date)
WHERE streak.last_login_date IS NOT NULL
ON CONFLICT (user_id, check_in_date) DO NOTHING;

INSERT INTO user_streak_check_ins (user_id, check_in_date)
SELECT claim.user_id, check_in.check_in_date::date
FROM streak_reward_claims AS claim
CROSS JOIN LATERAL generate_series(
  claim.streak_day - 6,
  claim.streak_day,
  INTERVAL '1 day'
) AS check_in(check_in_date)
ON CONFLICT (user_id, check_in_date) DO NOTHING;

COMMIT;
