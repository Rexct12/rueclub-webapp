import "server-only";

import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@/lib/domain";
import { getUsers } from "@/server/store";

const cookieName = "rueclub_session";
const defaultDevSecret = "local-development-secret-change-before-production";

function sessionSecret() {
  const secret = process.env.SESSION_PASSWORD ?? defaultDevSecret;
  return new TextEncoder().encode(secret);
}

async function getCookieStore() {
  return cookies();
}

export async function createSession(user: Pick<User, "id" | "name" | "role">) {
  const token = await new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(sessionSecret());
  const cookieStore = await getCookieStore();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSession() {
  const cookieStore = await getCookieStore();
  cookieStore.delete(cookieName);
}

export async function getSessionUser() {
  const cookieStore = await getCookieStore();
  const token = cookieStore.get(cookieName)?.value;

  if (!token) {
    return null;
  }

  try {
    const verified = await jwtVerify(token, sessionSecret());
    const payload = verified.payload;
    if (
      typeof payload.id === "string" &&
      typeof payload.name === "string" &&
      payload.role === "admin"
    ) {
      return {
        id: payload.id,
        name: payload.name,
        role: payload.role,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function verifyLogin(name: string, pin: string) {
  const normalized = name.trim().toLowerCase();
  const users = await getUsers();
  const found = users.find((user) => user.active && user.name.toLowerCase() === normalized);

  if (!found) {
    return null;
  }

  const valid = await bcrypt.compare(pin, found.pinHash);
  return valid ? found : null;
}

