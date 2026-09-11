-- Country becomes a first-class, org-managed entity like Rep and Region:
-- created in Settings → Team, assigned to customers/projects, bulk
-- reclassifiable. Replaces the free-text country field, which until recently
-- defaulted to a hardcoded "Ireland" for every tenant.
CREATE TABLE IF NOT EXISTS "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "countries" ADD CONSTRAINT "countries_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "countries_org_idx" ON "countries" ("org_id");
--> statement-breakpoint

-- customers is a VIEW over parties (0079), so the column lands on parties.
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "country_id" uuid;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "country_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parties" ADD CONSTRAINT "parties_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Rebuild the compatibility view. CREATE OR REPLACE VIEW can only APPEND
-- columns — every existing one must keep its name/type/position — so
-- country_id goes LAST, not beside region_id. Drizzle selects by name, so the
-- position is irrelevant to the application.
CREATE OR REPLACE VIEW "customers" AS SELECT
  id, org_id, name, code, country, currency, payment_terms, tax_number, risk_rating, status,
  credit_limit, account_owner_id, collection_owner_id, rep_id, region_id, notes, payment_method,
  phone, mobile, email, website, first_name, last_name, company_name,
  address_street, address_line2, address_city, address_state, address_postcode,
  qbo_id, xero_id, sage_intacct_id, chase_by_project, created_at, updated_at,
  country_id
FROM parties WHERE party_type = 'customer';
--> statement-breakpoint

-- INSTEAD OF triggers must carry the new column through, or writes silently
-- drop it. Bodies are otherwise identical to 0079.
CREATE OR REPLACE FUNCTION customers_view_insert() RETURNS trigger AS $$
DECLARE v_id uuid;
BEGIN
  v_id := COALESCE(NEW.id, gen_random_uuid());
  INSERT INTO parties (
    id, org_id, party_type, name, code, country, currency, payment_terms, tax_number,
    risk_rating, status, credit_limit, account_owner_id, collection_owner_id, rep_id, region_id,
    notes, payment_method, phone, mobile, email, website, first_name, last_name, company_name,
    address_street, address_line2, address_city, address_state, address_postcode,
    qbo_id, xero_id, sage_intacct_id, chase_by_project, created_at, updated_at, country_id
  ) VALUES (
    v_id, NEW.org_id, 'customer', NEW.name, NEW.code, NEW.country,
    COALESCE(NEW.currency, 'EUR'), COALESCE(NEW.payment_terms, 30), NEW.tax_number,
    COALESCE(NEW.risk_rating, 'Low'), COALESCE(NEW.status, 'Active'), NEW.credit_limit,
    NEW.account_owner_id, NEW.collection_owner_id, NEW.rep_id, NEW.region_id,
    NEW.notes, NEW.payment_method, NEW.phone, NEW.mobile, NEW.email, NEW.website,
    NEW.first_name, NEW.last_name, NEW.company_name,
    NEW.address_street, NEW.address_line2, NEW.address_city, NEW.address_state, NEW.address_postcode,
    NEW.qbo_id, NEW.xero_id, NEW.sage_intacct_id, COALESCE(NEW.chase_by_project, false),
    COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now()), NEW.country_id
  );
  SELECT * INTO NEW FROM customers WHERE id = v_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION customers_view_update() RETURNS trigger AS $$
BEGIN
  UPDATE parties SET
    name = NEW.name, code = NEW.code, country = NEW.country, currency = NEW.currency,
    payment_terms = NEW.payment_terms, tax_number = NEW.tax_number, risk_rating = NEW.risk_rating,
    status = NEW.status, credit_limit = NEW.credit_limit, account_owner_id = NEW.account_owner_id,
    collection_owner_id = NEW.collection_owner_id, rep_id = NEW.rep_id, region_id = NEW.region_id,
    notes = NEW.notes, payment_method = NEW.payment_method, phone = NEW.phone, mobile = NEW.mobile,
    email = NEW.email, website = NEW.website, first_name = NEW.first_name, last_name = NEW.last_name,
    company_name = NEW.company_name, address_street = NEW.address_street, address_line2 = NEW.address_line2,
    address_city = NEW.address_city, address_state = NEW.address_state, address_postcode = NEW.address_postcode,
    qbo_id = NEW.qbo_id, xero_id = NEW.xero_id, sage_intacct_id = NEW.sage_intacct_id,
    chase_by_project = NEW.chase_by_project, updated_at = NEW.updated_at, country_id = NEW.country_id
  WHERE id = OLD.id AND party_type = 'customer';
  SELECT * INTO NEW FROM customers WHERE id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Start clean: the legacy free text is the hardcoded-"Ireland" data, so it is
-- cleared rather than migrated into the new list. Scoped to CUSTOMER parties —
-- suppliers share this table and their country must survive untouched.
-- (Projects need no equivalent: they never had a country column, in schema.ts
-- or in any migration — an earlier draft of this migration assumed they did
-- and failed outright until a dry run against a real database caught it.)
UPDATE "parties" SET "country" = NULL WHERE "party_type" = 'customer';
