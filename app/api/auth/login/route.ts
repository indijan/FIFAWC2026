import { NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE_NAME, getAccessToken, isPasswordConfigured, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const redirectTarget = String(formData.get("redirect") ?? "/");

  if (!isPasswordConfigured()) {
    return NextResponse.redirect(new URL("/login?missingPassword=1", request.url));
  }

  if (!verifyPassword(password)) {
    return NextResponse.redirect(new URL(`/login?error=1&redirect=${encodeURIComponent(redirectTarget)}`, request.url));
  }

  const response = NextResponse.redirect(new URL(redirectTarget, request.url));
  const token = await getAccessToken();

  if (token) {
    response.cookies.set({
      name: ACCESS_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }

  return response;
}

