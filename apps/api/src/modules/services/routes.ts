import { services, withTenant } from "@chronoflow/db";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { authGuard } from "../../plugins/auth-guard";

export const servicesRoutes = new Elysia({ prefix: "/services" })
  .use(authGuard)
  .get(
    "/:id",
    async ({ tenantId, params, set }) => {
      return withTenant(tenantId, async (tx) => {
        const [service] = await tx
          .select()
          .from(services)
          .where(eq(services.id, params.id))
          .limit(1);

        if (!service) {
          set.status = 404;
          return { error: "Serviço não encontrado." };
        }

        return service;
      });
    },
    {
      params: t.Object({
        id: t.String({ format: "uuid" }),
      }),
    },
  )
  .post(
    "/",
    async ({ tenantId, body, set }) => {
      return withTenant(tenantId, async (tx) => {
        const [service] = await tx
          .insert(services)
          .values({
            tenantId,
            title: body.title,
            durationMinutes: body.durationMinutes,
            priceCents: body.priceCents ?? 0,
          })
          .returning();

        set.status = 201;
        return service;
      });
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        durationMinutes: t.Number({ minimum: 1 }),
        priceCents: t.Optional(t.Number({ minimum: 0 })),
      }),
    },
  );
