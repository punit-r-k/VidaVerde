import { securePublicRoute } from "@/lib/apiSecurity";
import { getClientId, getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

const EMAIL_SIGNUP_RATE_LIMIT = getRouteRateLimitConfig("EMAIL_SIGNUPS_CREATE", {
  windowMs: 60_000,
  ipMax: 10
});
const SOURCE_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_USER_AGENT_LENGTH = 500;

const payloadSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Please enter a valid email address.")
      .max(254, "Please keep your email under 254 characters."),
    source: z
      .string()
      .trim()
      .regex(SOURCE_REGEX, "That signup form looks out of date. Please refresh and try again.")
      .transform((value) => value.toLowerCase())
      .optional()
  })
  .strict();

const sanitizeHeaderText = (value, maxLength) => {
  const text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text ? text.slice(0, maxLength) : null;
};

export const runtime = "nodejs";

export async function POST(request) {
  const security = await securePublicRoute(request, {
    scope: "email-signups:create",
    rateLimit: EMAIL_SIGNUP_RATE_LIMIT,
    rateLimitExceededMessage: "Too many signup attempts. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Email signup is not available right now. Please try again later." },
      { status: 500 }
    );
  }

  const clientId = getClientId(request);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json(
      { error: "We couldn't read that signup. Please try again." },
      { status: 400 }
    );
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message || "Please enter a valid email address.";
    return respond.json({ error: message }, { status: 400 });
  }

  const email = parsed.data.email;
  const source = parsed.data.source || "website";
  const userAgent = sanitizeHeaderText(
    request.headers.get("user-agent"),
    MAX_USER_AGENT_LENGTH
  );

  const { error } = await supabaseAdmin.from("email_signups").insert({
    email,
    source,
    ip_address: clientId,
    user_agent: userAgent
  });

  if (error) {
    console.error("email signup insert error:", error);
    return respond.json(
      { error: "We couldn't save your email right now. Please try again." },
      { status: 500 }
    );
  }

  return respond.json({ ok: true }, { status: 201 });
}
