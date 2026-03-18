import { NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/adminAuth";
import {
  combineRateLimitResults,
  enforceRateLimit,
  getRateLimitHeaders,
  getRetryAfterSeconds
} from "@/lib/rateLimit";

const applyHeaders = (response, headers) => {
  Object.entries(headers || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    response.headers.set(key, String(value));
  });

  return response;
};

export const jsonWithSecurity = (body, init = {}, { rateLimit } = {}) => {
  const response = NextResponse.json(body, init);
  return applyHeaders(response, getRateLimitHeaders(rateLimit?.primary));
};

export const createRouteResponder = (context = {}) => ({
  json: (body, init = {}) => jsonWithSecurity(body, init, context)
});

const rateLimitResponse = (message, rateLimit) =>
  jsonWithSecurity(
    { error: message },
    {
      status: 429,
      headers: {
        "Retry-After": String(getRetryAfterSeconds(rateLimit?.primary?.resetAt))
      }
    },
    { rateLimit }
  );

const authErrorResponse = (authResult, rateLimit) =>
  jsonWithSecurity(
    { error: authResult.error },
    {
      status: authResult.status,
      headers: authResult.wwwAuthenticate
        ? {
            "WWW-Authenticate": authResult.wwwAuthenticate
          }
        : undefined
    },
    { rateLimit }
  );

export const securePublicRoute = async (
  request,
  { scope, rateLimit, rateLimitExceededMessage }
) => {
  const limit = await enforceRateLimit(request, {
    scope,
    windowMs: rateLimit.windowMs,
    ipMax: rateLimit.ipMax
  });

  if (!limit.ok) {
    return {
      ok: false,
      response: rateLimitResponse(rateLimitExceededMessage, limit)
    };
  }

  return {
    ok: true,
    rateLimit: limit,
    respond: createRouteResponder({ rateLimit: limit })
  };
};

export const secureAdminRoute = async (
  request,
  { scope, requiredRoles = [], rateLimit, rateLimitExceededMessage }
) => {
  const ipLimit = await enforceRateLimit(request, {
    scope,
    windowMs: rateLimit.windowMs,
    ipMax: rateLimit.ipMax
  });

  if (!ipLimit.ok) {
    return {
      ok: false,
      response: rateLimitResponse(rateLimitExceededMessage, ipLimit)
    };
  }

  const auth = authenticateAdminRequest(request, { requiredRoles });
  if (!auth.ok) {
    return {
      ok: false,
      response: authErrorResponse(auth, ipLimit)
    };
  }

  const userLimit = await enforceRateLimit(request, {
    scope,
    windowMs: rateLimit.windowMs,
    userId: auth.auth.subject,
    userMax: rateLimit.userMax
  });
  const combined = combineRateLimitResults(ipLimit, userLimit);

  if (!combined.ok) {
    return {
      ok: false,
      response: rateLimitResponse(rateLimitExceededMessage, combined)
    };
  }

  return {
    ok: true,
    auth: auth.auth,
    rateLimit: combined,
    respond: createRouteResponder({ rateLimit: combined })
  };
};
