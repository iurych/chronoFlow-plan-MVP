import { describe, expect, it, beforeAll } from "bun:test";
import { Elysia } from "elysia";
import { db, tenants, services, withTenant } from "@chronoflow/db";
import { signAccessToken } from "../src/lib/jwt";
import { servicesRoutes } from "../src/modules/services/routes";

describe("CF-05 — Isolamento Multitenant por RLS (Tenant A vs Tenant B -> 404)", () => {
  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-chronoflow-2026";

    // Criar Tenant A e Tenant B no banco
    await db.insert(tenants).values([
      { id: tenantAId, name: "Tenant A", slug: `tenant-a-${tenantAId.slice(0, 6)}` },
      { id: tenantBId, name: "Tenant B", slug: `tenant-b-${tenantBId.slice(0, 6)}` },
    ]).onConflictDoNothing();
  });

  it("permite que o Tenant A crie e acesse seu próprio serviço", async () => {
    const tokenA = await signAccessToken({
      sub: "user-a",
      tenantId: tenantAId,
      role: "ADMIN",
    });

    const app = new Elysia().use(servicesRoutes);

    // Criar serviço no Tenant A
    const createRes = await app.handle(
      new Request("http://localhost/services", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({
          title: "Corte de Cabelo A",
          durationMinutes: 30,
        }),
      })
    );

    expect(createRes.status).toBe(201);
    const service = await createRes.json();
    expect(service.id).toBeTruthy();
    expect(service.tenantId).toBe(tenantAId);

    // Acessar o serviço criado como Tenant A
    const getRes = await app.handle(
      new Request(`http://localhost/services/${service.id}`, {
        headers: {
          Authorization: `Bearer ${tokenA}`,
        },
      })
    );

    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.id).toBe(service.id);
  });

  it("retorna 404 ao tentar acessar um serviço do Tenant A usando o contexto do Tenant B", async () => {
    // 1. Criar um serviço no Tenant A diretamente via withTenant(tenantAId)
    const serviceId = await withTenant(tenantAId, async (tx) => {
      const [inserted] = await tx
        .insert(services)
        .values({
          tenantId: tenantAId,
          title: "Serviço Secreto do Tenant A",
          durationMinutes: 45,
        })
        .returning();
      return inserted.id;
    });

    // 2. Gerar token para um usuário do Tenant B
    const tokenB = await signAccessToken({
      sub: "user-b",
      tenantId: tenantBId,
      role: "CLIENT",
    });

    const app = new Elysia().use(servicesRoutes);

    // 3. Tentar buscar o serviço do Tenant A autenticado como Tenant B
    const res = await app.handle(
      new Request(`http://localhost/services/${serviceId}`, {
        headers: {
          Authorization: `Bearer ${tokenB}`,
        },
      })
    );

    // Deve retornar 404 Not Found devido à política RLS (app.current_tenant_id != tenantAId)
    expect(res.status).toBe(404);
  });
});
