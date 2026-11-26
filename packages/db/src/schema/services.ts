import { boolean, index, integer, pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const services = pgTable(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    priceCents: integer("price_cents").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (table) => [index("services_tenant_id_idx").on(table.tenantId)],
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
