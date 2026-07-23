-- SPEC.md §4.1: updated_at is "maintained via Drizzle $onUpdate plus a DB
-- trigger as backstop".
--
-- $onUpdate covers every write that goes through the ORM. This trigger covers
-- the rest: raw SQL, a psql session, a future rollup job using sql``, or a
-- migration that touches data. Without it, updated_at silently lies about rows
-- changed outside Drizzle.
--
-- Applied only to the tables that actually carry updated_at. Tables that are
-- append-only by design (survey_responses, response_answers, rca_whys,
-- rca_causes, sync_runs, ai_analyses, audit_logs, metric_rollups) have no
-- updated_at column and are deliberately excluded.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER networks_set_updated_at
  BEFORE UPDATE ON "networks"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER agencies_set_updated_at
  BEFORE UPDATE ON "agencies"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON "memberships"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER surveys_set_updated_at
  BEFORE UPDATE ON "surveys"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER escalations_set_updated_at
  BEFORE UPDATE ON "escalations"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER rcas_set_updated_at
  BEFORE UPDATE ON "rcas"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER action_items_set_updated_at
  BEFORE UPDATE ON "action_items"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
