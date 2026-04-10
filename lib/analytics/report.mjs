import { createClient } from "@supabase/supabase-js";

const DEFAULT_PAGE_SIZE = 1_000;
const CLICK_EVENT_NAMES = new Set([
  "cta_click",
  "nav_click",
  "product_add_to_cart",
  "email_popup_submit",
  "email_signup_submit",
  "testimonial_open",
  "faq_toggle",
  "checkout_submit"
]);

const incrementMap = (map, key, amount = 1) => {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
};

const toPercent = (part, whole) => {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(1));
};

const toSortedCounts = (map, labelKey = "id", countKey = "count") =>
  [...map.entries()]
    .map(([key, count]) => ({
      [labelKey]: key,
      [countKey]: count
    }))
    .sort((left, right) => right[countKey] - left[countKey]);

const toRangeTimestamp = (value) => {
  const match = String(value || "")
    .trim()
    .toLowerCase()
    .match(/^(\d+)([dhm])$/);

  if (!match) {
    throw new Error("Range must look like 7d, 30d, 12h, or 90m.");
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Range must be a positive duration.");
  }

  const unitMs =
    unit === "d"
      ? 24 * 60 * 60 * 1000
      : unit === "h"
        ? 60 * 60 * 1000
        : 60 * 1000;

  return {
    label: `${amount}${unit}`,
    amount,
    unit,
    since: new Date(Date.now() - amount * unitMs).toISOString()
  };
};

const summarizeTopFieldErrors = (fieldErrors) =>
  [...fieldErrors.entries()]
    .map(([fieldName, count]) => ({
      field_name: fieldName,
      count
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

const summarizeSections = (views, skips, clicks) =>
  [...views.entries()]
    .map(([sectionId, viewCount]) => {
      const skipCount = skips.get(sectionId) || 0;
      const clickCount = clicks.get(sectionId) || 0;
      return {
        section_id: sectionId,
        views: viewCount,
        skips: skipCount,
        clicks: clickCount,
        skip_rate: toPercent(skipCount, viewCount),
        click_through_rate: toPercent(clickCount, viewCount)
      };
    })
    .sort((left, right) => {
      if (right.views !== left.views) return right.views - left.views;
      return right.skip_rate - left.skip_rate;
    });

const summarizeProducts = (impressions, adds) =>
  [...impressions.entries()]
    .map(([productSku, impressionCount]) => {
      const addCount = adds.get(productSku) || 0;
      return {
        product_sku: productSku,
        impressions: impressionCount,
        add_to_cart: addCount,
        add_rate: toPercent(addCount, impressionCount)
      };
    })
    .sort((left, right) => {
      if (right.impressions !== left.impressions) return right.impressions - left.impressions;
      return left.add_rate - right.add_rate;
    });

const buildRecommendations = ({
  sectionPerformance,
  productPerformance,
  topFieldErrors,
  popupFunnel,
  inlineEmailFunnel,
  topNavItems
}) => {
  const recommendations = [];

  const topSkippedSection = [...sectionPerformance]
    .sort((left, right) => right.skip_rate - left.skip_rate)
    .find((section) => section.views >= 3 && section.skip_rate >= 45);

  if (topSkippedSection) {
    recommendations.push({
      priority: "high",
      action: `Shorten or restructure the ${topSkippedSection.section_id} section.`,
      evidence: `${topSkippedSection.skip_rate}% of ${topSkippedSection.views} viewers moved past it without engaging.`
    });
  }

  const weakProduct = [...productPerformance].find(
    (product) => product.impressions >= 3 && product.add_rate <= 15
  );

  if (weakProduct) {
    recommendations.push({
      priority: "high",
      action: `Improve the ${weakProduct.product_sku} product card with sharper proof, CTA copy, or pricing context.`,
      evidence: `${weakProduct.impressions} impressions produced only ${weakProduct.add_to_cart} add-to-cart actions (${weakProduct.add_rate}% add rate).`
    });
  }

  if (topFieldErrors[0]?.count >= 2) {
    recommendations.push({
      priority: "medium",
      action: `Simplify the ${topFieldErrors[0].field_name} checkout input and validation copy.`,
      evidence: `It produced ${topFieldErrors[0].count} validation errors in the selected range.`
    });
  }

  if (popupFunnel.opens >= 3 && popupFunnel.dismiss_rate >= 60 && popupFunnel.success_rate <= 10) {
    recommendations.push({
      priority: "medium",
      action: "Delay the email popup or tighten the offer before showing it.",
      evidence: `${popupFunnel.dismiss_rate}% of popup opens ended in a dismissal, while only ${popupFunnel.success_rate}% converted.`
    });
  }

  if (inlineEmailFunnel.views >= 3 && inlineEmailFunnel.success_rate <= 10) {
    recommendations.push({
      priority: "medium",
      action: "Strengthen the inline email section with a clearer incentive and lower-friction copy.",
      evidence: `Inline email captured ${inlineEmailFunnel.successes} successful signups from ${inlineEmailFunnel.views} section views (${inlineEmailFunnel.success_rate}% success rate).`
    });
  }

  if (topNavItems[0]?.element_id === "site_header_founder" || topNavItems[0]?.element_id === "jump_nav_our_story") {
    recommendations.push({
      priority: "low",
      action: "Surface more founder-story trust signals closer to the shop CTA.",
      evidence: `Story-focused navigation is the most clicked nav path (${topNavItems[0].count} clicks).`
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: "low",
      action: "Keep collecting more data before changing the site aggressively.",
      evidence: "Current analytics do not yet show a dominant friction point."
    });
  }

  return recommendations.slice(0, 5);
};

export const createAnalyticsReportClient = ({ supabaseUrl, serviceRoleKey }) => {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Analytics reporting requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false
    }
  });
};

export const fetchAnalyticsRows = async ({
  client,
  since,
  until = new Date().toISOString(),
  pageSize = DEFAULT_PAGE_SIZE
}) => {
  const rows = [];
  let from = 0;

  for (;;) {
    const { data, error } = await client
      .from("analytics_events")
      .select(
        "event_name, visitor_id, session_id, page_path, section_id, element_id, product_sku, checkout_step, metadata, created_at"
      )
      .gte("created_at", since)
      .lte("created_at", until)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error("Unable to read analytics events.");
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    if (batch.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
};

export const buildAnalyticsReportFromRows = (
  rows,
  { rangeLabel = "30d", generatedAt = new Date().toISOString() } = {}
) => {
  const visitors = new Set();
  const sessions = new Set();
  const countsByEvent = new Map();
  const ctaClicks = new Map();
  const navClicks = new Map();
  const sectionViews = new Map();
  const sectionSkips = new Map();
  const sectionClicks = new Map();
  const productImpressions = new Map();
  const productAdds = new Map();
  const fieldErrors = new Map();
  const validationBlocks = new Map();
  const popup = { opens: 0, dismisses: 0, submits: 0, successes: 0 };
  const inlineEmail = { submits: 0, successes: 0 };
  const payments = { success: 0, error: 0, cancel: 0 };

  for (const row of rows || []) {
    const eventName = String(row?.event_name || "").trim();
    const sectionId = String(row?.section_id || "").trim();
    const elementId = String(row?.element_id || "").trim();
    const productSku = String(row?.product_sku || "").trim().toUpperCase();
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};

    incrementMap(countsByEvent, eventName);
    if (row?.visitor_id) visitors.add(String(row.visitor_id));
    if (row?.session_id) sessions.add(String(row.session_id));

    if (eventName === "cta_click") incrementMap(ctaClicks, elementId);
    if (eventName === "nav_click") incrementMap(navClicks, elementId);
    if (eventName === "section_view") incrementMap(sectionViews, sectionId);
    if (eventName === "section_skip") incrementMap(sectionSkips, sectionId);
    if (CLICK_EVENT_NAMES.has(eventName)) incrementMap(sectionClicks, sectionId);
    if (eventName === "product_card_view") incrementMap(productImpressions, productSku);
    if (eventName === "product_add_to_cart") incrementMap(productAdds, productSku);

    if (eventName === "checkout_field_error") {
      incrementMap(fieldErrors, String(metadata.fieldName || "unknown"));
    }

    if (eventName === "checkout_validation_blocked") {
      incrementMap(validationBlocks, String(metadata.reason || "unknown"));
    }

    if (eventName === "email_popup_open") popup.opens += 1;
    if (eventName === "email_popup_dismiss") popup.dismisses += 1;
    if (eventName === "email_popup_submit") popup.submits += 1;
    if (eventName === "email_popup_result" && metadata.result === "success") popup.successes += 1;
    if (eventName === "email_signup_submit") inlineEmail.submits += 1;
    if (eventName === "email_signup_result" && metadata.result === "success") inlineEmail.successes += 1;

    if (eventName === "payment_result") {
      if (metadata.result === "success") payments.success += 1;
      if (metadata.result === "error") payments.error += 1;
      if (metadata.result === "cancel") payments.cancel += 1;
    }
  }

  const topCtas = toSortedCounts(ctaClicks, "element_id").slice(0, 8);
  const topNavItems = toSortedCounts(navClicks, "element_id").slice(0, 8);
  const sectionPerformance = summarizeSections(sectionViews, sectionSkips, sectionClicks);
  const productPerformance = summarizeProducts(productImpressions, productAdds);
  const topFieldErrors = summarizeTopFieldErrors(fieldErrors);
  const popupFunnel = {
    opens: popup.opens,
    dismisses: popup.dismisses,
    submits: popup.submits,
    successes: popup.successes,
    dismiss_rate: toPercent(popup.dismisses, popup.opens),
    success_rate: toPercent(popup.successes, popup.opens)
  };
  const inlineEmailFunnel = {
    views: sectionViews.get("join_email") || 0,
    submits: inlineEmail.submits,
    successes: inlineEmail.successes,
    success_rate: toPercent(inlineEmail.successes, sectionViews.get("join_email") || 0)
  };

  const recommendations = buildRecommendations({
    sectionPerformance,
    productPerformance,
    topFieldErrors,
    popupFunnel,
    inlineEmailFunnel,
    topNavItems
  });

  return {
    generated_at: generatedAt,
    range: rangeLabel,
    summary: {
      total_events: rows.length,
      unique_visitors: visitors.size,
      unique_sessions: sessions.size,
      page_views: countsByEvent.get("page_view") || 0,
      product_views: countsByEvent.get("product_card_view") || 0,
      add_to_cart: countsByEvent.get("product_add_to_cart") || 0,
      checkout_submits: countsByEvent.get("checkout_submit") || 0,
      successful_payments: payments.success,
      email_popup_opens: popup.opens,
      inline_email_successes: inlineEmail.successes
    },
    funnels: {
      shop: {
        page_views: countsByEvent.get("page_view") || 0,
        product_views: countsByEvent.get("product_card_view") || 0,
        add_to_cart: countsByEvent.get("product_add_to_cart") || 0,
        checkout_submits: countsByEvent.get("checkout_submit") || 0,
        successful_payments: payments.success,
        add_to_cart_rate: toPercent(
          countsByEvent.get("product_add_to_cart") || 0,
          countsByEvent.get("product_card_view") || 0
        ),
        checkout_completion_rate: toPercent(
          payments.success,
          countsByEvent.get("checkout_submit") || 0
        )
      },
      email_popup: popupFunnel,
      inline_email: inlineEmailFunnel
    },
    friction_points: {
      sections: [...sectionPerformance]
        .sort((left, right) => right.skip_rate - left.skip_rate)
        .slice(0, 5),
      checkout_fields: topFieldErrors,
      validation_blocks: toSortedCounts(validationBlocks, "reason").slice(0, 5),
      payments
    },
    opportunities: {
      top_ctas: topCtas,
      top_nav_items: topNavItems,
      section_view_click_gaps: [...sectionPerformance]
        .sort((left, right) => left.click_through_rate - right.click_through_rate)
        .slice(0, 5),
      skipped_sections: [...sectionPerformance]
        .sort((left, right) => right.skip_rate - left.skip_rate)
        .slice(0, 5),
      low_conversion_products: [...productPerformance]
        .filter((product) => product.impressions >= 3)
        .sort((left, right) => left.add_rate - right.add_rate)
        .slice(0, 5),
      email_popup: popupFunnel,
      inline_email: inlineEmailFunnel
    },
    recommended_actions: recommendations
  };
};

export const formatAnalyticsReportMarkdown = (report) => {
  const summary = report.summary;
  const shopFunnel = report.funnels.shop;
  const friction = report.friction_points;
  const opportunities = report.opportunities;

  const lines = [
    `# Analytics Report (${report.range})`,
    "",
    `Generated: ${report.generated_at}`,
    "",
    "## Summary",
    `- ${summary.page_views} page views from ${summary.unique_visitors} visitors across ${summary.unique_sessions} sessions.`,
    `- ${summary.product_views} product card views, ${summary.add_to_cart} add-to-cart actions, and ${summary.successful_payments} successful payments.`,
    `- ${summary.email_popup_opens} popup opens and ${summary.inline_email_successes} successful inline email signups.`,
    "",
    "## Funnels",
    `- Shop funnel: ${shopFunnel.product_views} product views -> ${shopFunnel.add_to_cart} add-to-cart (${shopFunnel.add_to_cart_rate}%) -> ${shopFunnel.checkout_submits} checkout submits -> ${shopFunnel.successful_payments} successful payments (${shopFunnel.checkout_completion_rate}% completion from checkout submit).`,
    `- Popup email funnel: ${report.funnels.email_popup.opens} opens -> ${report.funnels.email_popup.submits} submits -> ${report.funnels.email_popup.successes} successes (${report.funnels.email_popup.success_rate}% open-to-success).`,
    `- Inline email funnel: ${report.funnels.inline_email.views} section views -> ${report.funnels.inline_email.submits} submits -> ${report.funnels.inline_email.successes} successes (${report.funnels.inline_email.success_rate}% section-view-to-success).`,
    "",
    "## Friction Points",
    ...friction.sections.slice(0, 3).map(
      (section) =>
        `- Section ${section.section_id}: ${section.skip_rate}% skip rate, ${section.click_through_rate}% click-through across ${section.views} views.`
    ),
    ...friction.checkout_fields.slice(0, 3).map(
      (field) => `- Checkout field ${field.field_name}: ${field.count} validation errors.`
    ),
    ...friction.validation_blocks.slice(0, 3).map(
      (block) => `- Validation block ${block.reason}: ${block.count} occurrences.`
    ),
    "",
    "## Opportunities",
    ...opportunities.top_ctas.slice(0, 3).map(
      (cta) => `- CTA ${cta.element_id}: ${cta.count} clicks.`
    ),
    ...opportunities.low_conversion_products.slice(0, 3).map(
      (product) =>
        `- Product ${product.product_sku}: ${product.impressions} impressions and ${product.add_to_cart} add-to-cart actions (${product.add_rate}% add rate).`
    ),
    "",
    "## Recommended Actions",
    ...report.recommended_actions.map(
      (action) => `- [${action.priority}] ${action.action} Evidence: ${action.evidence}`
    )
  ];

  return lines.join("\n");
};

export const parseAnalyticsRange = toRangeTimestamp;
