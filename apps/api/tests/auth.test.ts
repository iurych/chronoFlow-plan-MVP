import { beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../src/lib/jwt";
import { authGuard } from "../src/plugins/auth-guard";

describe("CF-04 — Auth JWT e AuthGuard", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-chronoflow-2026";
  });

  it("gera e valida accessToken com payload esperado", async () => {
    const token = await signAccessToken({
      sub: "user-123",
      tenantId: "tenant-456",
      role: "ADMIN",
    });

    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe("user-123");
    expect(claims.tenantId).toBe("tenant-456");
    expect(claims.role).toBe("ADMIN");
    expect(claims.type).toBe("access");
  });

  it("gera e valida refreshToken com jti único", async () => {
    const tokenA = await signRefreshToken({
      sub: "user-123",
      tenantId: "tenant-456",
      role: "CLIENT",
      jti: crypto.randomUUID(),
    });

    const tokenB = await signRefreshToken({
      sub: "user-123",
      tenantId: "tenant-456",
      role: "CLIENT",
      jti: crypto.randomUUID(),
    });

    const claimsA = await verifyRefreshToken(tokenA);
    const claimsB = await verifyRefreshToken(tokenB);

    expect(claimsA.type).toBe("refresh");
    expect(claimsA.jti).not.toBe(claimsB.jti);
  });

  it("bloqueia rota protegida sem header Authorization (401)", async () => {
    const app = new Elysia()
      .use(authGuard)
      .get("/protected", ({ userId, tenantId }) => ({ userId, tenantId }));

    const res = await app.handle(new Request("http://localhost/protected"));
    expect(res.status).toBe(401);
  });

  it("permite acesso a rota protegida com Bearer token válido e injeta userId e tenantId", async () => {
    const token = await signAccessToken({
      sub: "user-999",
      tenantId: "tenant-888",
      role: "PROFESSIONAL",
    });

    const app = new Elysia().use(authGuard).get("/protected", ({ userId, tenantId, role }) => ({
      userId,
      tenantId,
      role,
    }));

    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      userId: "user-999",
      tenantId: "tenant-888",
      role: "PROFESSIONAL",
    });
  });
});
