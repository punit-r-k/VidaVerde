import { securePublicRoute } from "@/lib/apiSecurity";
import {
  ANALYTICS_CHECKOUT_STEPS,
  ANALYTICS_MAX_BATCH_SIZE,
  ANALYTICS_MAX_CLOCK_SKEW_MS,
  ANALYTICS_MAX_EVENT_AGE_MS,
  ANALYTICS_MAX_METADATA_KEYS,
  ANALYTICS_MAX_PAYLOAD_BYTES,
  ANALYTICS_EVENT_NAMES,
  normalizeAnalyticsOccurredAt,
  sanitizeAnalyticsEvent,
  toAnalyticsInsertRow
} from "@/lib/analytics";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

const ANALYTICS_RATE_LIMIT = getRouteRateLimitConfig("ANALYTICS_CREATE", {
  windowMs: 60_000,
  ipMax: 180
});

const MAX_REQUEST_BYTES = ANALYTICS_MAX_PAYLOAD_BYTES + 6_000;
const ALLOWED_SEC_FETCH_SITE_VALUES = new Set(["same-origin", "none"]);

const metadataValueSchema = z.union([
  z.string().trim().max(120),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

const analyticsEventSchema = z
  .object({
    name: z.enum(ANALYTICS_EVENT_NAMES),
    occurredAt: z.string().datetime().max(64).optional(),
    visitorId: z.string().trim().min(1).max(80),
    sessionId: z.string().trim().min(1).max(80),
    pageViewId: z.string().trim().min(1).max(80),
    pagePath: z.string().trim().min(1).max(240),
    pageSearch: z.string().trim().max(240).optional(),
    referrerPath: z.string().trim().max(240).optional(),
    sectionId: z.string().trim().max(80).nullable().optional(),
    elementId: z.string().trim().max(80).nullable().optional(),
    productSku: z.string().trim().max(32).nullable().optional(),
    checkoutStep: z.enum(ANALYTICS_CHECKOUT_STEPS).nullable().optional(),
    metadata: z.record(z.string(), metadataValueSchema).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value.metadata || {}).length > ANALYTICS_MAX_METADATA_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata"],
        message: "That analytics event has too much extra detail."
      });
    }
  });

const payloadSchema = z
  .object({
    events: z.array(analyticsEventSchema).min(1).max(ANALYTICS_MAX_BATCH_SIZE)
  })
  .strict();

const getSiteOrigin = () => {
  const siteUrl = String(process.env.SITE_URL || "").trim();
  if (!siteUrl) return "";

  try {
    return new URL(siteUrl).origin;
  } catch {
    return "";
  }
};

const validateSameOriginAnalyticsRequest = (request) => {
  if (process.env.NODE_ENV !== "production") {
    return { ok: true };
  }

  const siteOrigin = getSiteOrigin();
  if (!siteOrigin) {
    return {
      ok: false,
      status: 500,
      error: "Analytics is not set up right now."
    };
  }

  const origin = request.headers.get("origin") || "";
  const referer = request.headers.get("referer") || "";
  const secFetchSite = (request.headers.get("sec-fetch-site") || "").trim().toLowerCase();

  if (origin && origin !== siteOrigin) {
    return {
      ok: false,
      status: 403,
      error: "Origin is not allowed."
    };
  }

  if (referer) {
    try {
      if (new URL(referer).origin !== siteOrigin) {
        return {
          ok: false,
          status: 403,
          error: "Origin is not allowed."
        };
      }
    } catch {
      return {
        ok: false,
        status: 403,
        error: "Origin is not allowed."
      };
    }
  }

  if (!origin && !referer && !ALLOWED_SEC_FETCH_SITE_VALUES.has(secFetchSite)) {
    return {
      ok: false,
      status: 403,
      error: "Origin is not allowed."
    };
  }

  return { ok: true };
};

export const runtime = "nodejs";

export async function POST(request) {
  const security = await securePublicRoute(request, {
    scope: "analytics:create",
    rateLimit: ANALYTICS_RATE_LIMIT,
    rateLimitExceededMessage: "Too many analytics requests. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Analytics is not connected right now." },
      { status: 500 }
    );
  }

  const sourceCheck = validateSameOriginAnalyticsRequest(request);
  if (!sourceCheck.ok) {
    return respond.json(
      { error: sourceCheck.error },
      { status: sourceCheck.status }
    );
  }

  const declaredLength = Number.parseInt(request.headers.get("content-length") || "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return respond.json(
      { error: "Analytics payload is too large." },
      { status: 413 }
    );
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return respond.json(
      { error: "We couldn't read that analytics request." },
      { status: 400 }
    );
  }

  if (!rawBody || Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    return respond.json(
      { error: "Analytics payload is too large." },
      { status: 413 }
    );
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return respond.json(
      { error: "We couldn't read that analytics request." },
      { status: 400 }
    );
  }

  const parsedPayload = payloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return respond.json(
      {
        error:
          parsedPayload.error.issues[0]?.message || "That analytics request looks off."
      },
      { status: 400 }
    );
  }

  const now = Date.now();
  const rows = [];

  for (const analyticsEvent of parsedPayload.data.events) {
    const sanitizedEvent = sanitizeAnalyticsEvent(analyticsEvent);
    if (!sanitizedEvent) {
      return respond.json(
        { error: "That analytics event looks off." },
        { status: 400 }
      );
    }

    const normalizedOccurredAt = normalizeAnalyticsOccurredAt(
      sanitizedEvent.occurredAt,
      now
    );
    if (!normalizedOccurredAt) {
      return respond.json(
        {
          error: `Please send analytics events from the last ${Math.round(
            ANALYTICS_MAX_EVENT_AGE_MS / (60 * 60 * 1000)
          )} hours, and no more than ${Math.round(
            ANALYTICS_MAX_CLOCK_SKEW_MS / (60 * 1000)
          )} minutes in the future.`
        },
        { status: 400 }
      );
    }

    rows.push(
      toAnalyticsInsertRow({
        ...sanitizedEvent,
        occurredAt: normalizedOccurredAt
      })
    );
  }

  const { error } = await supabaseAdmin.from("analytics_events").insert(rows);

  if (error) {
    console.error("analytics insert error:", error);
    return respond.json(
      { error: "We couldn't save analytics right now." },
      { status: 500 }
    );
  }

  return respond.json(
    {
      ok: true,
      accepted: rows.length
    },
    { status: 202 }
  );
}
