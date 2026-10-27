export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const enc = encodeURIComponent;

/** Builds a query string, skipping null / undefined / empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: HeadersInit = { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers };
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError('The local API is not reachable. Start the API and try again.', 0);
  }
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      detail = body.detail ?? body.title ?? body.message ?? detail;
    } catch {
      /* response has no JSON body */
    }
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const jsonBody = (value: unknown) => JSON.stringify(value);
export const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error');
