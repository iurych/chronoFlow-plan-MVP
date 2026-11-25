import { beforeAll, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

const fakeUser = {
  id: "user-seed-1",
  tenantId: "tenant-seed-1",
  email: "admin@chronoflow.local",
  passwordHash: "$argon2id$v=19$m=65536,t=2,p=1$fakehash",
  role: "ADMIN",
};

mock.module("@chronoflow/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [fakeUser],
        }),
      }),
    }),
  },
  users: {
    email: "email",
    tenantId: "tenantId",
  },
}));

Bun.password.verify = async (plain: string) => plain === "SenhaCorreta123";

const { authRoutes } = await import("../src/modules/auth/routes");

describe("CF-04 — Fluxo /auth/login, /auth/me e /auth/refresh", () => {
  const app = new Elysia().use(authRoutes);

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-chronoflow-2026";
  });

  it("rejeita login com senha inválida (401)", async () => {
    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fakeUser.email,
          password: "SenhaErrada",
        }),
      })
    );

    expect(res.status).toBe(401);
  });

  it("faz login, acessa /auth/me e rotaciona refreshToken impedindo reuso", async () => {
    const loginRes = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fakeUser.email,
          password: "SenhaCorreta123",
        }),
      })
    );

    expect(loginRes.status).toBe(200);
    const { accessToken, refreshToken } = await loginRes.json();
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();

    const meRes = await app.handle(
      new Request("http://localhost/auth/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    );
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({
      userId: fakeUser.id,
      tenantId: fakeUser.tenantId,
      role: fakeUser.role,
    });

    const refreshRes = await app.handle(
      new Request("http://localhost/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      })
    );
    expect(refreshRes.status).toBe(200);
    const rotated = await refreshRes.json();
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(refreshToken);

    // Se REDIS_URL estiver ativo, reutilizar o refreshToken antigo deve falhar com 401
    if (process.env.REDIS_URL) {
      const reuseRes = await app.handle(
        new Request("http://localhost/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        })
      );
      expect(reuseRes.status).toBe(401);
    }
  });
});
