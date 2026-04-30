import { secureAdminRoute } from "@/lib/apiSecurity";
import {
  MARKET_TIMEZONE,
  formatMarketDate,
  getPickupDetails,
  getPrepSheetWeekInfo
} from "@/lib/pickupDetails";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ADMIN_PREP_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_PREP_GET", {
  windowMs: 60_000,
  ipMax: 120,
  userMax: 90
});

const ADMIN_PREP_ROLES = ["admin", "ops_admin"];

export const runtime = "nodejs";

export async function GET(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:prep:get",
    requiredRoles: ADMIN_PREP_ROLES,
    rateLimit: ADMIN_PREP_RATE_LIMIT,
    rateLimitExceededMessage: "Too many prep requests. Please wait and try again."
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

  const timezone = MARKET_TIMEZONE;
  const now = new Date();
  const weekInfo = getPrepSheetWeekInfo(timezone, now);
  const pickup = {
    ...getPickupDetails({ timeZone: timezone, now }),
    market_date: weekInfo.market_date,
    market_date_label: formatMarketDate(weekInfo.market_date, timezone)
  };

  const { data: prepData, error: prepError } = await supabaseAdmin.rpc(
    "get_admin_prep_data",
    {
      p_pickup_date: weekInfo.market_date,
      p_collection_start_at: weekInfo.collection_start_at,
      p_collection_end_at: weekInfo.collection_end_at
    }
  );

  if (prepError) {
    console.error("admin prep rpc error:", prepError);
    return respond.json(
      { error: "Unable to build prep data." },
      { status: 500 }
    );
  }

  return respond.json({
    week: weekInfo,
    pickup,
    timezone,
    prep: Array.isArray(prepData?.prep) ? prepData.prep : [],
    pickup_orders: Array.isArray(prepData?.pickup_orders)
      ? prepData.pickup_orders
      : []
  });
}
