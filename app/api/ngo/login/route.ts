import { NextRequest, NextResponse } from "next/server";
import { NGO_COOKIE, ngoSessionToken } from "../../../../lib/ngo-auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const configuredPin = process.env.NGO_ACCESS_PIN;
  if (!configuredPin || body?.pin !== configuredPin)
    return NextResponse.json(
      { error: "Incorrect NGO access PIN" },
      { status: 401 },
    );

  const token = ngoSessionToken();
  if (!token)
    return NextResponse.json(
      { error: "NGO authentication is not configured" },
      { status: 503 },
    );

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(NGO_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
