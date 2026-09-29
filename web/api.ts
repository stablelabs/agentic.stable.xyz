export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAfter = 2000,
  ) {
    super(message);
  }
}
let limitedUntil = 0;
export async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  if (limitedUntil > Date.now()) {
    throw new ApiError(
      'RATE_LIMITED',
      'Please wait before checking again.',
      limitedUntil - Date.now(),
    );
  }
  let res: Response;
  try {
    res = await fetch(`/api/agentic/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(
      'CONNECTION_UNKNOWN',
      'Connection interrupted. Checking the same request; no new purchase will be created.',
    );
  }
  const data = await res.json().catch(() => null);
  const retryAfter = Math.max(2000, Number(res.headers.get('Retry-After') || 2) * 1000);
  if (res.status === 429) limitedUntil = Date.now() + retryAfter;
  if (!res.ok)
    throw new ApiError(
      data?.error?.code || 'SERVICE_UNAVAILABLE',
      data?.error?.message || 'The service is temporarily unavailable.',
      retryAfter,
    );
  if (!data)
    throw new ApiError(
      'CONNECTION_UNKNOWN',
      'The response was interrupted. Recover the same request.',
    );
  return data;
}
