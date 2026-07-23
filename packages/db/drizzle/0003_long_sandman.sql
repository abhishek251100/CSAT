ALTER TABLE "survey_responses" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "surveys" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;