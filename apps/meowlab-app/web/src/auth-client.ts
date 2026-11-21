import { createAuthClient } from "better-auth/react";
import {
  API_ORIGIN,
  apiFetch,
  clearAuthToken,
  getAuthTokenSync,
  isNativeApp,
  readAuthToken,
  saveAuthToken,
} from "./api";

export const authClient = createAuthClient({
  baseURL: API_ORIGIN || undefined,
  basePath: "/api/auth",
  fetchOptions: {
    credentials: isNativeApp() ? "omit" : "same-origin",
    auth: {
      type: "Bearer",
      token: () => (isNativeApp() ? getAuthTokenSync() ?? undefined : undefined),
    },
    onRequest: async (ctx) => {
      if (!isNativeApp()) return;
      const token = getAuthTokenSync() ?? (await readAuthToken());
      if (token) {
        const headers = new Headers(ctx.headers);
        if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
        ctx.headers = headers;
      }
    },
    onResponse: async (ctx) => {
      if (!isNativeApp()) return;
      const token = ctx.response.headers.get("set-auth-token");
      if (token) await saveAuthToken(token);
      if (ctx.request.url.toString().includes("/sign-out")) {
        await clearAuthToken();
      }
    },
  },
});

export type PortalConfig = { google: boolean; passwordReset: boolean; whatsappLinking?: boolean };

export type PortalModule = {
  key: string;
  title: string;
  status: "needs_whatsapp" | "available" | "no_company" | "coming_soon";
};

/** A company this account belongs to (ADR-0010). */
export type Membership = {
  id: string;
  name: string;
  legalName: string | null;
  ruc: string | null;
  role: "owner" | "member";
  invoicing: "active" | "needs_sol";
};

export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  isAdmin?: boolean;
  whatsapp:
    | { linked: true; maskedPhone: string; linkedAt: string; available: true }
    | { linked: false; available: boolean };
  modules: PortalModule[];
  /** Null when the bridge cannot answer. */
  companies: Membership[] | null;
};

export async function postJson<T>(path: string, body: Record<string, unknown> = {}): Promise<T | null> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export async function fetchJson<T>(path: string): Promise<T | null> {
  const response = await apiFetch(path);
  if (!response.ok) return null;
  return (await response.json()) as T;
}

const ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "El correo o la contraseña no coinciden.",
  USER_ALREADY_EXISTS: "Ya existe una cuenta con ese correo. Inicia sesión.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Ya existe una cuenta con ese correo. Inicia sesión.",
  PASSWORD_TOO_SHORT: "La contraseña debe tener al menos 10 caracteres.",
  PASSWORD_TOO_LONG: "La contraseña es demasiado larga.",
  INVALID_EMAIL: "Revisa el correo: no parece válido.",
  ACCOUNT_NOT_LINKED: "Ese correo ya tiene una cuenta con contraseña. Inicia sesión con tu correo.",
};

export function errorMessage(error: { code?: string; status?: number; message?: string } | null | undefined): string {
  if (!error) return "No pudimos completar la solicitud. Inténtalo otra vez.";
  if (error.status === 429) return "Demasiados intentos. Espera un minuto y vuelve a intentarlo.";
  return (error.code && ERRORS[error.code]) || "No pudimos completar la solicitud. Inténtalo otra vez.";
}
