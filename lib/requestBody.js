const getDeclaredLength = (request) => {
  const raw = request?.headers?.get?.("content-length");
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, length: null };
  }

  const normalized = String(raw).trim();
  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    return { ok: false, status: 400, code: "invalid_content_length" };
  }

  const length = Number(normalized);
  if (!Number.isSafeInteger(length)) {
    return { ok: false, status: 400, code: "invalid_content_length" };
  }

  return { ok: true, length };
};

export const readBoundedTextBody = async (request, { maxBytes }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer.");
  }

  const declared = getDeclaredLength(request);
  if (!declared.ok) return declared;
  if (declared.length !== null && declared.length > maxBytes) {
    return { ok: false, status: 413, code: "body_too_large" };
  }

  if (!request?.body) {
    return { ok: true, text: "", bytes: 0 };
  }

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
        await reader.cancel("Request body exceeded its byte limit.");
        return { ok: false, status: 413, code: "body_too_large" };
      }
      chunks.push(chunk);
    }
  } catch {
    return { ok: false, status: 400, code: "unreadable_body" };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      bytes: totalBytes
    };
  } catch {
    return { ok: false, status: 400, code: "invalid_utf8" };
  }
};

export const readBoundedJsonBody = async (request, options) => {
  const result = await readBoundedTextBody(request, options);
  if (!result.ok) return result;

  try {
    return {
      ok: true,
      data: JSON.parse(result.text),
      bytes: result.bytes
    };
  } catch {
    return { ok: false, status: 400, code: "invalid_json" };
  }
};
