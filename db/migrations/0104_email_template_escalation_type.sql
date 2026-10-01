-- Lets an org target a specific escalation type (Legal, Retention, ...) with
-- its own template instead of every escalation type sharing one generic
-- "Escalated" template. Nullable: existing templates keep matching by stage
-- alone, exactly as before.
ALTER TABLE "email_templates" ADD COLUMN "escalation_type" varchar(64);
