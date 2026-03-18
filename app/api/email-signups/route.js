import { securePublicRoute } from "@/lib/apiSecurity";
import { getClientId, getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

const EMAIL_SIGNUP_RATE_LIMIT = getRouteRateLimitConfig("EMAIL_SIGNUPS_CREATE", {
  windowMs: 60_000,
  ipMax: 10
});

const payloadSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  source: z.string().trim().min(1).max(64).optional()
});

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
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const clientId = getClientId(request);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json({ error: "Invalid payload." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Invalid email address.";
    return respond.json({ error: message }, { status: 400 });
  }

  const email = parsed.data.email;
  const source = parsed.data.source || "website";
  const userAgent = request.headers.get("user-agent") || null;

  const { error } = await supabaseAdmin.from("email_signups").insert({
    email,
    source,
    ip_address: clientId,
    user_agent: userAgent
  });

  if (error) {
    console.error("email signup insert error:", error);
    return respond.json(
      { error: "Unable to save email signup." },
      { status: 500 }
    );
  }

  return respond.json({ ok: true }, { status: 201 });
}
