import { NextResponse } from "next/server";
import { getCorsHeaders, isPreflightRequest, validateCorsRequest } from "@/lib/cors";
import {
  ensureSafeSecurityConfig,
  hasAmbiguousRequestFraming
} from "@/lib/securityConfig";

ensureSafeSecurityConfig();

const jsonError = (message, status, headers = new Headers()) => {
  const response = NextResponse.json({ error: message }, { status });
  headers.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};

export function middleware(request) {
  if (hasAmbiguousRequestFraming(request)) {
    console.warn("Rejected ambiguous request framing", {
      path: request.nextUrl.pathname
    });
    return jsonError("Ambiguous request framing is not allowed.", 400);
  }

  const cors = validateCorsRequest(request);

  if (!cors.ok) {
    return jsonError("Origin is not allowed.", 403);
  }

  if (isPreflightRequest(request)) {
    const response = new NextResponse(null, {
      status: 204,
      headers: cors.headers
    });
    return response;
  }

  const response = NextResponse.next();
  const origin = request.headers.get("origin");

  if (origin) {
    const headers = getCorsHeaders(origin);
    headers.forEach((value, key) => {
      response.headers.set(key, value);
    });
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"]
};
