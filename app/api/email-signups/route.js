import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getRateLimitHeaders,
  getRetryAfterSeconds,
  rateLimitByRequest,
  getClientId
} from "@/lib/rateLimit";

const SIGNUP_WINDOW_MS = 60_000;
const SIGNUP_MAX = 10;

const payloadSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  source: z.string().trim().min(1).max(64).optional()
});

export const runtime = "nodejs";

export async function POST(request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const clientId = getClientId(request);
  const limit = rateLimitByRequest(request, {
    scope: "email-signups:create",
    identifier: clientId,
    windowMs: SIGNUP_WINDOW_MS,
    max: SIGNUP_MAX
  });

  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please wait and try again." },
      {
        status: 429,
        headers: {
          ...getRateLimitHeaders(limit, SIGNUP_MAX),
          "Retry-After": String(getRetryAfterSeconds(limit.resetAt))
        }
      }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Invalid email address.";
    return NextResponse.json({ error: message }, { status: 400 });
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
    return NextResponse.json(
      { error: "Unable to save email signup." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
