BEGIN;

ALTER TABLE task_posts
  DROP CONSTRAINT IF EXISTS task_posts_payout_kes_check,
  DROP CONSTRAINT IF EXISTS task_posts_payout_kes_minimum;

ALTER TABLE task_posts
  ADD CONSTRAINT task_posts_payout_kes_minimum CHECK (payout_kes >= 1);

COMMIT;
