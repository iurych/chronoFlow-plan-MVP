DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chronoflow_app') THEN
    CREATE ROLE chronoflow_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT chronoflow_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO chronoflow_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO chronoflow_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chronoflow_app;
--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "services" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "services_tenant_isolation" ON "services";
--> statement-breakpoint
CREATE POLICY "services_tenant_isolation" ON "services"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "users_tenant_isolation" ON "users";
--> statement-breakpoint
CREATE POLICY "users_tenant_isolation" ON "users"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "tenants_self_isolation" ON "tenants";
--> statement-breakpoint
CREATE POLICY "tenants_self_isolation" ON "tenants"
  USING (
    "id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );
