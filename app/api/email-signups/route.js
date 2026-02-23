import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";

const SIGNUP_WINDOW_MS = 60_000;
const SIGNUP_MAX = 10;

const payloadSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  source: z.string().trim().min(1).max(64).optional()
});

const getClientId = (request) => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip") || "unknown";
};

export const runtime = "nodejs";

export async function POST(request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const clientId = getClientId(request);
  const limit = rateLimit(clientId, {
    windowMs: SIGNUP_WINDOW_MS,
    max: SIGNUP_MAX
  });

  if (!limit.ok) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many signup attempts. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter)
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
