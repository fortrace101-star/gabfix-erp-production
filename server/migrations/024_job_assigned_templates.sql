-- 024: job.assigned must survive the scheduler so the bells can show it.
--
-- EVENT_RULES dispatches `job.assigned` (in-app row per assignee → portal
-- task list, push row → store app bell), but message_templates carried no
-- `job_assigned` rows. The scheduler's sendOne() therefore flipped every
-- queued row to status 'failed' with error "Template not found", and the
-- bell queries only surface queued/sent/delivered/read — hiding the
-- assignment from the employee's task list entirely.
--
-- (key, channel) is the primary key, so this is idempotent.
INSERT INTO message_templates (key, channel, subject, body, variables, approved) VALUES
  ('job_assigned', 'inapp', NULL,
   'New job {{job_number}} — {{customer_name}} · {{service_name}} · {{scheduled}} {{address}}',
   ARRAY['job_number','customer_name','service_name','scheduled','address'], TRUE),
  ('job_assigned', 'push', NULL,
   'New job {{job_number}} — {{customer_name}}',
   ARRAY['job_number','customer_name','service_name','scheduled','address'], TRUE)
ON CONFLICT (key, channel) DO NOTHING;
