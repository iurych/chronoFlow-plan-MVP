import { db, users } from "@chronoflow/db";
import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  REFRESH_TOKEN_TTL_SECONDS,
  type UserRole,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../lib/jwt";
import { authGuard } from "../../plugins/auth-guard";

// Cliente Redis nativo do Bun (requer REDIS_URL no ambiente)
const redisClient = process.env.REDIS_URL ? new Bun.RedisClient(process.env.REDIS_URL) : null;

function refreshKey(jti: string): string {
  return `chronoflow:refresh:${jti}`;
}

async function storeRefreshJti(jti: string, userId: string): Promise<void> {
  if (!redisClient) return;
  await redisClient.set(refreshKey(jti), userId);
  await redisClient.expire(refreshKey(jti), REFRESH_TOKEN_TTL_SECONDS);
}

async function consumeRefreshJti(jti: string): Promise<string | null> {
  if (!redisClient) return "stateless-ok";
  const ownerId = await redisClient.get(refreshKey(jti));
  if (!ownerId) return null;
  await redisClient.del(refreshKey(jti));
  return ownerId;
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .post(
    "/login",
    async ({ body, set }) => {
      const emailNormalized = body.email.trim().toLowerCase();

      const conditions = [eq(users.email, emailNormalized)];
      if (body.tenantId) {
        conditions.push(eq(users.tenantId, body.tenantId));
      }

      const [user] = await db
        .select()
        .from(users)
        .where(and(...conditions))
        .limit(1);

      if (!user) {
        set.status = 401;
        return { error: "Credenciais inválidas." };
      }

      const validPassword = await Bun.password.verify(body.password, user.passwordHash);
      if (!validPassword) {
        set.status = 401;
        return { error: "Credenciais inválidas." };
      }

      const role = user.role as UserRole;
      const jti = crypto.randomUUID();

      const accessToken = await signAccessToken({
        sub: user.id,
        tenantId: user.tenantId,
        role,
      });

      const refreshToken = await signRefreshToken({
        sub: user.id,
        tenantId: user.tenantId,
        role,
        jti,
      });

      await storeRefreshJti(jti, user.id);

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          role,
        },
      };
    },
    {
      body: t.Object({
        email: t.String({ minLength: 3 }),
        password: t.String({ minLength: 1 }),
        tenantId: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/refresh",
    async ({ body, set }) => {
      try {
        const claims = await verifyRefreshToken(body.refreshToken);
        const storedUserId = await consumeRefreshJti(claims.jti);

        if (!storedUserId || storedUserId !== claims.sub) {
          set.status = 401;
          return { error: "Refresh token inválido ou já rotacionado." };
        }

        const nextJti = crypto.randomUUID();
        const accessToken = await signAccessToken({
          sub: claims.sub,
          tenantId: claims.tenantId,
          role: claims.role,
        });

        const refreshToken = await signRefreshToken({
          sub: claims.sub,
          tenantId: claims.tenantId,
          role: claims.role,
          jti: nextJti,
        });

        await storeRefreshJti(nextJti, claims.sub);

        return {
          accessToken,
          refreshToken,
        };
      } catch {
        set.status = 401;
        return { error: "Refresh token inválido ou expirado." };
      }
    },
    {
      body: t.Object({
        refreshToken: t.String({ minLength: 10 }),
      }),
    }
  )
  .use(authGuard)
  .get("/me", ({ userId, tenantId, role }) => {
    return {
      userId,
      tenantId,
      role,
    };
  });
