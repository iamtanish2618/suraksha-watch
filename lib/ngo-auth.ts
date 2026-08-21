import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const NGO_COOKIE = "suraksha_ngo_session";

function expectedToken() {
  const secret = process.env.NGO_SESSION_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update("ngo-access").digest("hex");
}

export async function isNgoAuthenticated() {
  const expected = expectedToken();
  const actual = (await cookies()).get(NGO_COOKIE)?.value;
  if (!expected || !actual || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function ngoSessionToken() {
  return expectedToken();
}
