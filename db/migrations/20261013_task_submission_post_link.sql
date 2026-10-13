BEGIN;

ALTER TABLE task_submissions
  ADD COLUMN IF NOT EXISTS task_post_id UUID REFERENCES task_posts(id) ON DELETE CASCADE;

ALTER TABLE task_submissions
  ALTER COLUMN task_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.task_submissions'::regclass
      AND conname = 'task_submissions_task_reference_check'
  ) THEN
    ALTER TABLE task_submissions
      ADD CONSTRAINT task_submissions_task_reference_check
      CHECK (task_id IS NOT NULL OR task_post_id IS NOT NULL);
  END IF;
END $$;

COMMIT;
