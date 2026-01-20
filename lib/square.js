const squareEnv = (process.env.SQUARE_ENV || "production").toLowerCase();
const squareBaseUrl =
  squareEnv === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
const squareAccessToken = process.env.SQUARE_ACCESS_TOKEN;
const squareVersion = process.env.SQUARE_VERSION || "2024-01-18";

export const squareConfig = squareAccessToken
  ? {
      baseUrl: squareBaseUrl,
      accessToken: squareAccessToken,
      version: squareVersion
    }
  : null;

export async function squareRequest(path, { method = "GET", body } = {}) {
  if (!squareConfig) {
    return {
      ok: false,
      status: 500,
      error: "Square is not configured."
    };
  }

  const response = await fetch(`${squareConfig.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${squareConfig.accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": squareConfig.version
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.errors || data?.error || data || text
    };
  }

  return { ok: true, status: response.status, data };
}
