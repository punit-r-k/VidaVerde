import { GOOGLE_REVIEW_FALLBACK_RATING } from "@/lib/siteMetadata";

const GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_PLACES_PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";
const DEFAULT_GOOGLE_REVIEW_TEXT_QUERY = "Vida Verde Sauerkraut Richmond TX";

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeReviewSummary = (payload, isLive) => {
  const rating = toFiniteNumber(payload?.rating);
  const userRatingCount = toFiniteNumber(payload?.userRatingCount);

  return {
    rating: rating ?? GOOGLE_REVIEW_FALLBACK_RATING,
    userRatingCount,
    isLive
  };
};

const fetchPlaceDetails = async (placeId, apiKey) => {
  const response = await fetch(
    `${GOOGLE_PLACES_PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "rating,userRatingCount"
      },
      next: { revalidate: 3600 }
    }
  );

  if (!response.ok) {
    throw new Error(`Google Place Details request failed with status ${response.status}.`);
  }

  return response.json();
};

const searchPlace = async (textQuery, apiKey) => {
  const response = await fetch(GOOGLE_PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.rating,places.userRatingCount"
    },
    body: JSON.stringify({ textQuery }),
    next: { revalidate: 3600 }
  });

  if (!response.ok) {
    throw new Error(`Google Text Search request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.places) ? payload.places[0] || null : null;
};

export async function getGoogleReviewSummary() {
  const apiKey = String(process.env.GOOGLE_PLACES_API_KEY || "").trim();
  const placeId = String(process.env.GOOGLE_PLACES_PLACE_ID || "").trim();
  const textQuery = String(
    process.env.GOOGLE_PLACES_TEXT_QUERY || DEFAULT_GOOGLE_REVIEW_TEXT_QUERY
  ).trim();

  if (!apiKey) {
    return normalizeReviewSummary(null, false);
  }

  try {
    if (placeId) {
      const details = await fetchPlaceDetails(placeId, apiKey);
      return normalizeReviewSummary(details, true);
    }

    const place = await searchPlace(textQuery, apiKey);
    return normalizeReviewSummary(place, Boolean(place));
  } catch {
    return normalizeReviewSummary(null, false);
  }
}
