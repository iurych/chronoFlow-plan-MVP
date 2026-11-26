import { and, eq } from "drizzle-orm";
import { client, db, services, tenants, users } from "./index";

async function seed() {
  const defaultSlug = "chronoflow-demo";
  const defaultPassword = process.env.SEED_DEFAULT_PASSWORD ?? "ChronoFlow@123";

  // 1. Garante o tenant inicial de forma idempotente
  await db
    .insert(tenants)
    .values({
      name: "ChronoFlow Studio",
      slug: defaultSlug,
      defaultTimezone: "America/Sao_Paulo",
      settings: {
        bookingWindowDays: 30,
        allowCancellationHours: 12,
      },
    })
    .onConflictDoNothing({ target: tenants.slug });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, defaultSlug)).limit(1);

  if (!tenant) {
    throw new Error(`Falha ao obter ou criar o tenant '${defaultSlug}'.`);
  }

  // 2. Gera o hash Argon2id com Bun.password
  const passwordHash = await Bun.password.hash(defaultPassword, {
    algorithm: "argon2id",
  });

  const seedUsers = [
    {
      tenantId: tenant.id,
      email: "admin@chronoflow.local",
      passwordHash,
      role: "ADMIN" as const,
      timezone: tenant.defaultTimezone,
    },
    {
      tenantId: tenant.id,
      email: "pro@chronoflow.local",
      passwordHash,
      role: "PROFESSIONAL" as const,
      timezone: tenant.defaultTimezone,
    },
    {
      tenantId: tenant.id,
      email: "cliente@chronoflow.local",
      passwordHash,
      role: "CLIENT" as const,
      timezone: tenant.defaultTimezone,
    },
  ];

  await db
    .insert(users)
    .values(seedUsers)
    .onConflictDoNothing({ target: [users.tenantId, users.email] });

  // 3. Garante serviços iniciais sem duplicar em execuções repetidas
  const seedServices = [
    {
      title: "Consulta Inicial",
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 15000,
      active: true,
    },
    {
      title: "Acompanhamento",
      durationMinutes: 30,
      bufferMinutes: 10,
      priceCents: 9000,
      active: true,
    },
  ];

  for (const item of seedServices) {
    const [existing] = await db
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.tenantId, tenant.id), eq(services.title, item.title)))
      .limit(1);

    if (!existing) {
      await db.insert(services).values({
        tenantId: tenant.id,
        ...item,
      });
    }
  }

  console.log("Seed concluído com sucesso para o tenant:", tenant.slug);
}

seed()
  .catch((error) => {
    console.error("Erro ao executar seed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
