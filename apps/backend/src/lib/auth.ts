import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { passwordGroups } from "../db/schema";

const secret = process.env.APP_SECRET ?? "dev-secret";

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function verifyPasswordGroup(password: string, adminOnly: boolean) {
  const groups = await db
    .select()
    .from(passwordGroups)
    .where(and(eq(passwordGroups.isActive, true), eq(passwordGroups.isAdmin, adminOnly)));

  for (const group of groups) {
    if (await bcrypt.compare(password, group.passwordHash)) {
      return group;
    }
  }

  return null;
}

export function createAdminToken(groupId: string) {
  const payload = base64url(
    JSON.stringify({
      sub: groupId,
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8
    })
  );
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: string | undefined) {
  if (!token) return null;
  const [payload, signature] = token.replace(/^Bearer\s+/i, "").split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub: string;
    role: string;
    exp: number;
  };
  if (parsed.role !== "admin" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed;
}
