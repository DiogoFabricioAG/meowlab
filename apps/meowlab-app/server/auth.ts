import { betterAuth, type BetterAuthOptions } from "better-auth";

/** Configuration shared by every runtime (Cloudflare today, Node on the VPS later). */
export type AuthSettings = {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Extra origins allowed to call the auth API, comma separated (local development only). */
  TRUSTED_ORIGINS?: string;
};

export function googleEnabled(settings: AuthSettings): boolean {
  return Boolean(settings.GOOGLE_CLIENT_ID?.trim() && settings.GOOGLE_CLIENT_SECRET?.trim());
}

/**
 * The database is the only runtime-specific piece: a D1 binding on Cloudflare,
 * a PostgreSQL pool once the portal moves to the VPS.
 */
export function authOptions(
  database: BetterAuthOptions["database"],
  settings: AuthSettings,
  /**
   * Header with the real client IP, used by the sign-in rate limit. It must be one the
   * edge overwrites: cf-connecting-ip on Cloudflare, x-forwarded-for behind Caddy.
   * Trusting a header the client can set would let it dodge the limit.
   */
  ipAddressHeaders: string[] = ["cf-connecting-ip"],
): BetterAuthOptions {
  const extraOrigins = (settings.TRUSTED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  return {
    appName: "MeowLab",
    baseURL: settings.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: settings.BETTER_AUTH_SECRET,
    database,
    trustedOrigins: [settings.BETTER_AUTH_URL, ...extraOrigins],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    socialProviders: googleEnabled(settings)
      ? {
          google: {
            clientId: settings.GOOGLE_CLIENT_ID!.trim(),
            clientSecret: settings.GOOGLE_CLIENT_SECRET!.trim(),
            prompt: "select_account",
          },
        }
      : {},
    // E-mail ownership is not verified yet, so a Google sign-in must never be
    // attached to a password account someone else may have opened with that e-mail.
    account: { accountLinking: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 600, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: settings.BETTER_AUTH_URL.startsWith("https://"),
      ipAddress: { ipAddressHeaders },
    },
    telemetry: { enabled: false },
  };
}

export function createAuth(database: BetterAuthOptions["database"], settings: AuthSettings, ipAddressHeaders?: string[]) {
  return betterAuth(authOptions(database, settings, ipAddressHeaders));
}

export type Auth = ReturnType<typeof createAuth>;
