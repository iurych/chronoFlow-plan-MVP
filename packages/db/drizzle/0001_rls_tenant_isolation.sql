DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chronoflow_app') THEN
    CREATE ROLE chronoflow_app LOGIN PASSWORD 'app123';
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO chronoflow_app;
GRANT USAGE ON SCHEMA public TO chronoflow_app;

ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "services" FORCE ROW LEVEL SECURITY;

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "services_tenant_isolation" ON "services";
CREATE POLICY "services_tenant_isolation" ON "services"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

DROP POLICY IF EXISTS "users_tenant_isolation" ON "users";
CREATE POLICY "users_tenant_isolation" ON "users"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''::text)
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''::text)
  );

DROP POLICY IF EXISTS "tenants_self_isolation" ON "tenants";
CREATE POLICY "tenants_self_isolation" ON "tenants"
  USING (
    "id" = NULLIF(current_setting('app.current_tenant_id', true), ''::text)
  )
  WITH CHECK (
    "id" = NULLIF(current_setting('app.current_tenant_id', true), ''::text)
  );
