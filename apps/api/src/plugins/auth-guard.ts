import { Elysia } from "elysia";
import { verifyAccessToken } from "../lib/jwt";

export const authGuard = new Elysia({ name: "auth-guard" }).derive(
  { as: "scoped" },
  async ({ headers, set }) => {
    const authHeader = headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      set.status = 401;
      throw new Error("Token de autenticação ausente ou mal formatado.");
    }

    const token = authHeader.slice("Bearer ".length).trim();

    try {
      const claims = await verifyAccessToken(token);
      return {
        userId: claims.sub,
        tenantId: claims.tenantId,
        role: claims.role,
      };
    } catch {
      set.status = 401;
      throw new Error("Token de acesso inválido ou expirado.");
    }
  }
);
