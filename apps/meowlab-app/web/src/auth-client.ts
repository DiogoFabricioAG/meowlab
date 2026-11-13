import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ basePath: "/api/auth" });

export type PortalConfig = { google: boolean; passwordReset: boolean; whatsappLinking?: boolean };

export type PortalModule = {
  key: string;
  title: string;
  status: "needs_whatsapp" | "available" | "no_company" | "coming_soon";
};

export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  isAdmin?: boolean;
  whatsapp:
    | { linked: true; maskedPhone: string; linkedAt: string; available: true }
    | { linked: false; available: boolean };
  modules: PortalModule[];
};

export async function postJson<T>(path: string, body: Record<string, unknown> = {}): Promise<T | null> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export async function fetchJson<T>(path: string): Promise<T | null> {
  const response = await fetch(path, { credentials: "same-origin" });
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
