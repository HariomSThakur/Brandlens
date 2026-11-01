const DEFAULT_BODY_BYTES = 256_000;

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function readJsonBody(req, maxBytes = DEFAULT_BODY_BYTES) {
  const byteLimit = Number.isSafeInteger(maxBytes) && maxBytes >= 0 ? maxBytes : DEFAULT_BODY_BYTES;
  const declaredLength = Number(req.headers?.['content-length']);
  if (Number.isSafeInteger(declaredLength) && declaredLength > byteLimit) {
    req.pause?.();
    return Promise.reject(httpError(`Request body exceeds the ${byteLimit}-byte limit.`, 413));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let oversized = false;
    let settled = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.byteLength;
      if (totalBytes > byteLimit) {
        oversized = true;
        chunks.length = 0;
        req.pause?.();
        fail(httpError(`Request body exceeds the ${byteLimit}-byte limit.`, 413));
      } else if (!oversized) chunks.push(bytes);
    });
    req.on('error', error => fail(error));
    req.on('aborted', () => fail(httpError('Request body was interrupted.', 400)));
    req.on('end', () => {
      if (settled) return;
      if (oversized) return fail(httpError(`Request body exceeds the ${byteLimit}-byte limit.`, 413));
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
        settled = true;
      } catch {
        fail(httpError('Request body must contain valid JSON.', 400));
      }
    });
  });
}

export async function readJsonResponse(response, maxBytes = 1_000_000) {
  const byteLimit = Number.isSafeInteger(maxBytes) && maxBytes >= 0 ? maxBytes : 1_000_000;
  const reader = response.body?.getReader?.();
  if (!reader) throw httpError('Ollama returned an empty response body.', 502);
  const cancelAndFail = async message => {
    try { await reader.cancel(); } catch { /* The upstream may already have closed. */ }
    throw httpError(message, 502);
  };
  const declaredLength = Number(response.headers?.get('content-length'));
  if (Number.isSafeInteger(declaredLength) && declaredLength > byteLimit) {
    return cancelAndFail(`Ollama response exceeds the ${byteLimit}-byte limit.`);
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > byteLimit) return await cancelAndFail(`Ollama response exceeds the ${byteLimit}-byte limit.`);
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
  } finally {
    reader.releaseLock();
  }
}

export function validateAiReviewPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Request must be a JSON object.' };
  }
  if (typeof payload.draft !== 'string' || payload.draft.length > 30_000) {
    return { valid: false, error: 'Draft must be text under 30,000 characters.' };
  }
  const sources = payload.sources === undefined ? [] : payload.sources;
  if (!Array.isArray(sources) || sources.length > 20) {
    return { valid: false, error: 'Sources must be an array of at most 20 records.' };
  }
  let aggregateCharacters = 0;
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || typeof source.title !== 'string' || source.title.length > 200
      || typeof source.content !== 'string' || source.content.length > 12_000) {
      return { valid: false, error: 'Each source needs a title under 200 characters and content under 12,000 characters.' };
    }
    aggregateCharacters += source.content.length;
    if (aggregateCharacters > 150_000) {
      return { valid: false, error: 'Combined source content must stay under 150,000 characters.' };
    }
  }
  return { valid: true };
}

export function createAiReviewGuard({ now = Date.now, windowMs = 60_000, maxRequests = 12, maxConcurrent = 2 } = {}) {
  if (![windowMs, maxRequests, maxConcurrent].every(value => Number.isFinite(value) && value > 0)) {
    throw new TypeError('AI review guard limits must be positive numbers.');
  }
  const requestTimes = [];
  let inFlight = 0;

  return {
    acquire() {
      const timestamp = Number(now());
      const currentTime = Number.isFinite(timestamp) ? timestamp : Date.now();
      while (requestTimes.length && requestTimes[0] <= currentTime - windowMs) requestTimes.shift();
      if (requestTimes.length >= maxRequests) {
        const retryAfterSeconds = Math.max(1, Math.ceil((requestTimes[0] + windowMs - currentTime) / 1000));
        return { allowed: false, reason: 'rate_limited', retryAfterSeconds };
      }
      if (inFlight >= maxConcurrent) {
        return { allowed: false, reason: 'concurrency_limited', retryAfterSeconds: 1 };
      }

      requestTimes.push(currentTime);
      inFlight += 1;
      let released = false;
      return {
        allowed: true,
        release() {
          if (released) return;
          released = true;
          inFlight = Math.max(0, inFlight - 1);
        }
      };
    }
  };
}
