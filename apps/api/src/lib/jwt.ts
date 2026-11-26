import { jwtVerify, SignJWT } from "jose";

export type UserRole = "ADMIN" | "PROFESSIONAL" | "CLIENT";

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
  jti: string;
  type: "refresh";
}

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error("JWT_SECRET não está configurada no ambiente.");
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(payload: Omit<AccessTokenPayload, "type">): Promise<string> {
  return await new SignJWT({ ...payload, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecretKey());
}

export async function signRefreshToken(
  payload: Omit<RefreshTokenPayload, "type">,
): Promise<string> {
  return await new SignJWT({ ...payload, type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .sign(getSecretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecretKey());
  if (
    payload.type !== "access" ||
    typeof payload.sub !== "string" ||
    typeof payload.tenantId !== "string" ||
    typeof payload.role !== "string"
  ) {
    throw new Error("Token de acesso inválido.");
  }

  return {
    sub: payload.sub,
    tenantId: payload.tenantId,
    role: payload.role as UserRole,
    type: "access",
  };
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, getSecretKey());
  if (
    payload.type !== "refresh" ||
    typeof payload.sub !== "string" ||
    typeof payload.tenantId !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.jti !== "string"
  ) {
    throw new Error("Refresh token inválido.");
  }

  return {
    sub: payload.sub,
    tenantId: payload.tenantId,
    role: payload.role as UserRole,
    jti: payload.jti,
    type: "refresh",
  };
}
