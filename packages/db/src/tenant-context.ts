import { sql } from "drizzle-orm";
import { db } from "./client";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const withTenant = async <T>(
  tenantId: string,
  callback: (tx: TenantTx) => Promise<T>,
): Promise<T> => {
  if (!UUID_REGEX.test(tenantId)) {
    throw new Error("Invalid tenantId format for RLS context.");
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE chronoflow_app`);
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    return callback(tx);
  });
};
