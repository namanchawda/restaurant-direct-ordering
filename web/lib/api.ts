export type ApiErrorDetail = {
  field: string;
  message: string;
};

export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;

  constructor(message: string, status: number, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = Object.fromEntries(
      details.map(({ field, message: detail }) => [field.replace(/^body\./, ""), detail]),
    );
  }
}

export const NETWORK_DOWN_STATUS = 0;

export const NETWORK_DOWN_MESSAGE =
  "We can't reach the server. Check your connection and try again.";

const DEFAULT_ERROR_MESSAGES: Record<number, string> = {
  400: "We couldn't process that request. Check the details and try again.",
  401: "Your session has expired. Please sign in again.",
  403: "You don't have permission to do that.",
  404: "We couldn't find that.",
  409: "That can't be done right now. Try again in a moment.",
  422: "Please check the details you entered and try again.",
  429: "That's a bit fast. Wait a moment and try again.",
  500: "Something went wrong on our side. Please try again in a moment.",
  502: "The server is briefly unavailable. Please try again in a moment.",
  503: "The server is briefly unavailable. Please try again in a moment.",
  504: "The server took too long to reply. Please try again.",
};

function defaultMessageFor(status: number): string {
  if (status >= 500) return DEFAULT_ERROR_MESSAGES[500] as string;
  return DEFAULT_ERROR_MESSAGES[status] ?? DEFAULT_ERROR_MESSAGES[500] as string;
}

export function describeApiError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "hyderabad-biryani-token";
const USER_KEY = "hyderabad-biryani-user";

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event("auth:session-cleared"));
}

export function saveSession(token: string, user: unknown) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function readSession(): { token: string | null; user: unknown | null } {
  const token = window.localStorage.getItem(TOKEN_KEY);
  const rawUser = window.localStorage.getItem(USER_KEY);
  if (!rawUser) return { token, user: null };
  try {
    return { token, user: JSON.parse(rawUser) as unknown };
  } catch {
    clearSession();
    return { token: null, user: null };
  }
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  let message = "";
  let details: ApiErrorDetail[] = [];

  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const error = body.error;
      if (typeof error === "object" && error !== null && "message" in error) {
        if (typeof error.message === "string") message = error.message;
        if ("details" in error && Array.isArray(error.details)) {
          details = error.details.filter(
            (detail): detail is ApiErrorDetail =>
              typeof detail === "object" &&
              detail !== null &&
              "field" in detail &&
              "message" in detail &&
              typeof detail.field === "string" &&
              typeof detail.message === "string",
          );
        }
      }
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const detail = body.detail;
      if (typeof detail === "string") message = detail;
    }
  } catch {
    // No readable body; fall back to the friendly status message below.
  }

  if (!message) message = defaultMessageFor(response.status);
  return new ApiError(message, response.status, details);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (fetchError) {
    if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
      throw fetchError;
    }
    throw new ApiError(NETWORK_DOWN_MESSAGE, NETWORK_DOWN_STATUS);
  }

  if (!response.ok) {
    const error = await errorFromResponse(response);
    if (response.status === 401 && typeof window !== "undefined") {
      clearSession();
    }
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type User = {
  id: string;
  name: string | null;
  phone: string;
  role: "admin" | "kitchen" | "customer";
  outlet_id: string | null;
  marketing_opt_in?: boolean;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

export type Category = {
  id: string;
  name: string;
  sort_order: number;
  available_from: string | null;
  available_to: string | null;
};

export type Variant = { id?: string; name: string; price_inr: number };
export type Addon = { id: string; name: string; price_inr: number };
export type MenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string;
  photo_url: string;
  is_veg: boolean;
  spice_level: number;
  allergens: string[];
  base_price_inr: number;
  active: boolean;
  sort_order: number;
  variants: Variant[];
  addon_ids: string[];
};
export type Outlet = { id: string; name: string; city: string; is_open: boolean };
export type CityPrice = { id: string; item_id: string; city: string; price_inr: number };

export const jsonBody = (body: unknown): string => JSON.stringify(body);
