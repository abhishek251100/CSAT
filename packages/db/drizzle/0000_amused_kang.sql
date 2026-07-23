CREATE TYPE "public"."account_status" AS ENUM('prospect', 'active', 'paused', 'churned');--> statement-breakpoint
CREATE TYPE "public"."action_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."action_source_type" AS ENUM('rca', 'escalation', 'standalone');--> statement-breakpoint
CREATE TYPE "public"."action_status" AS ENUM('open', 'in_progress', 'blocked', 'done');--> statement-breakpoint
CREATE TYPE "public"."ai_kind" AS ENUM('sentiment', 'theme', 'category_suggestion', 'summary');--> statement-breakpoint
CREATE TYPE "public"."error_category" AS ENUM('people', 'process', 'product');--> statement-breakpoint
CREATE TYPE "public"."escalation_source" AS ENUM('form', 'email', 'call', 'meeting', 'other');--> statement-breakpoint
CREATE TYPE "public"."escalation_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."metric_type" AS ENUM('csat', 'nps');--> statement-breakpoint
CREATE TYPE "public"."period_grain" AS ENUM('monthly', 'quarterly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('scale', 'text', 'single_choice', 'multi_choice');--> statement-breakpoint
CREATE TYPE "public"."rca_method" AS ENUM('five_whys', 'fishbone', 'scatter');--> statement-breakpoint
CREATE TYPE "public"."rca_status" AS ENUM('open', 'in_progress', 'closed');--> statement-breakpoint
CREATE TYPE "public"."rca_subject" AS ENUM('escalation', 'dsat_response');--> statement-breakpoint
CREATE TYPE "public"."role_key" AS ENUM('super_admin', 'network_admin', 'agency_admin', 'account_director', 'account_manager', 'team_member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('network', 'agency', 'account');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."survey_source" AS ENUM('google_form', 'native', 'import');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"role" "role_key" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_scope_key" UNIQUE("user_id","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" "ai_kind" NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"output" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_analyses_entity_kind_hash_key" UNIQUE("entity_type","entity_id","kind","input_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"diff" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_rollups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"period_grain" "period_grain" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"value" numeric,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_rollups_scope_metric_period_key" UNIQUE("scope_type","scope_id","metric","period_grain","period_start")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" "survey_source" NOT NULL,
	"account_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status" NOT NULL,
	"rows_seen" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"industry" text,
	"brand_owner" text,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"external_form_url" text,
	"external_sheet_id" text,
	"external_form_id" text,
	"csat_cadence" "period_grain" DEFAULT 'monthly' NOT NULL,
	"nps_cadence" "period_grain" DEFAULT 'quarterly' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_agency_id_slug_key" UNIQUE("agency_id","slug")
);
--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_network_id_slug_key" UNIQUE("network_id","slug")
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "networks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "response_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"question_id" uuid,
	"question_label" text,
	"answer_text" text,
	"answer_value" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"survey_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"kind" "question_kind" NOT NULL,
	"position" integer NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"survey_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "metric_type" NOT NULL,
	"score" smallint NOT NULL,
	"respondent_name" text,
	"respondent_email" text,
	"source" "survey_source" NOT NULL,
	"external_response_id" text,
	"period_start" date,
	"period_end" date,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "survey_responses_source_external_id_key" UNIQUE("source","external_response_id"),
	CONSTRAINT "survey_responses_score_range_check" CHECK (("survey_responses"."type" = 'csat' AND "survey_responses"."score" BETWEEN 1 AND 5)
       OR ("survey_responses"."type" = 'nps'  AND "survey_responses"."score" BETWEEN 0 AND 10))
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "metric_type" NOT NULL,
	"title" text NOT NULL,
	"source" "survey_source" NOT NULL,
	"source_form_id" text,
	"cadence" "period_grain" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"source_type" "action_source_type" DEFAULT 'standalone' NOT NULL,
	"rca_id" uuid,
	"escalation_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"eta" date,
	"priority" "action_priority",
	"status" "action_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"raised_by_user_id" uuid,
	"source" "escalation_source" NOT NULL,
	"severity" "severity" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "escalation_status" DEFAULT 'open' NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rca_causes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rca_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"cause" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rca_whys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rca_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rcas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"subject_type" "rca_subject" NOT NULL,
	"escalation_id" uuid,
	"response_id" uuid,
	"method" "rca_method" NOT NULL,
	"error_category" "error_category",
	"problem_statement" text NOT NULL,
	"findings" jsonb,
	"status" "rca_status" DEFAULT 'open' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "rcas_one_of_subject_check" CHECK (("rcas"."subject_type" = 'escalation'    AND "rcas"."escalation_id" IS NOT NULL AND "rcas"."response_id" IS NULL)
       OR ("rcas"."subject_type" = 'dsat_response' AND "rcas"."response_id"   IS NOT NULL AND "rcas"."escalation_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_answers" ADD CONSTRAINT "response_answers_response_id_survey_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_answers" ADD CONSTRAINT "response_answers_question_id_survey_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."survey_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_rca_id_rcas_id_fk" FOREIGN KEY ("rca_id") REFERENCES "public"."rcas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."escalations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rca_causes" ADD CONSTRAINT "rca_causes_rca_id_rcas_id_fk" FOREIGN KEY ("rca_id") REFERENCES "public"."rcas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rca_whys" ADD CONSTRAINT "rca_whys_rca_id_rcas_id_fk" FOREIGN KEY ("rca_id") REFERENCES "public"."rcas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcas" ADD CONSTRAINT "rcas_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcas" ADD CONSTRAINT "rcas_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."escalations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcas" ADD CONSTRAINT "rcas_response_id_survey_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_responses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcas" ADD CONSTRAINT "rcas_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_scope_idx" ON "memberships" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "metric_rollups_scope_metric_start_idx" ON "metric_rollups" USING btree ("scope_type","scope_id","metric","period_start");--> statement-breakpoint
CREATE INDEX "sync_runs_account_started_idx" ON "sync_runs" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE INDEX "accounts_agency_id_idx" ON "accounts" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "accounts_status_idx" ON "accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agencies_network_id_idx" ON "agencies" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "response_answers_response_id_idx" ON "response_answers" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "survey_questions_survey_id_idx" ON "survey_questions" USING btree ("survey_id");--> statement-breakpoint
CREATE INDEX "survey_responses_account_submitted_idx" ON "survey_responses" USING btree ("account_id","submitted_at");--> statement-breakpoint
CREATE INDEX "survey_responses_type_submitted_idx" ON "survey_responses" USING btree ("type","submitted_at");--> statement-breakpoint
CREATE INDEX "survey_responses_survey_id_idx" ON "survey_responses" USING btree ("survey_id");--> statement-breakpoint
CREATE INDEX "surveys_account_id_type_idx" ON "surveys" USING btree ("account_id","type");--> statement-breakpoint
CREATE INDEX "action_items_owner_status_idx" ON "action_items" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "action_items_account_status_eta_idx" ON "action_items" USING btree ("account_id","status","eta");--> statement-breakpoint
CREATE INDEX "escalations_account_status_reported_idx" ON "escalations" USING btree ("account_id","status","reported_at");--> statement-breakpoint
CREATE INDEX "rca_causes_rca_id_idx" ON "rca_causes" USING btree ("rca_id");--> statement-breakpoint
CREATE INDEX "rca_whys_rca_id_level_idx" ON "rca_whys" USING btree ("rca_id","level");--> statement-breakpoint
CREATE INDEX "rcas_account_created_idx" ON "rcas" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "rcas_error_category_idx" ON "rcas" USING btree ("error_category");