// Centralized API client. Every network call to the backend goes through here.
//
// - Base URL: VITE_API_BASE_URL (default "/api/v1", proxied to the FastAPI
//   backend by vite in dev).
// - Unwraps the backend `{ success, data }` envelope.
// - Turns `{ success: false, error }` responses into a typed ApiError so the UI
//   can render a safe message (never a raw backend exception).
// - Sends the operator identity headers the backend uses for RBAC / policy.

import { getAuthHeaders, handleUnauthorized } from "./auth";

const BASE_URL =
  (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/$/, "") || "/api/v1";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  count?: number;
  error?: {
    code: string;
    message: string;
    timestamp?: string;
    requestId?: string;
  };
}

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;

  constructor(code: string, message: string, status: number, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; count?: number }> {
  const { method = "GET", query, body, signal } = opts;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    /* non-JSON response */
  }

  if (!res.ok || !payload || payload.success === false) {
    const err = payload?.error;
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(
      err?.code || `HTTP_${res.status}`,
      err?.message || "The request could not be completed. Please try again.",
      res.status,
      err?.requestId,
    );
  }

  return { data: payload.data, count: payload.count };
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "GET", query, signal }),
  post: <T>(path: string, body?: unknown, query?: RequestOptions["query"]) =>
    apiRequest<T>(path, { method: "POST", body, query }),
  patch: <T>(path: string, body?: unknown, query?: RequestOptions["query"]) =>
    apiRequest<T>(path, { method: "PATCH", body, query }),
};
