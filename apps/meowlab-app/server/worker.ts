import { createApp } from "./app";
import { createAuth, googleEnabled, type AuthSettings } from "./auth";
import { createPortalBridge } from "./bridge";

type Env = AuthSettings & {
  DB: D1Database;
  /** Manolo bridge on the VPS, e.g. https://bridge.example (no trailing slash). */
  BRIDGE_URL?: string;
  PORTAL_BRIDGE_HMAC_SECRET?: string;
};

export default {
  fetch(request, env, ctx) {
    const auth = createAuth(env.DB, env);
    const allowedOrigins = [env.BETTER_AUTH_URL, ...(env.TRUSTED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean)];
    return createApp({
      auth,
      googleEnabled: googleEnabled(env),
      bridge: createPortalBridge(env.BRIDGE_URL, env.PORTAL_BRIDGE_HMAC_SECRET),
      allowedOrigins,
    }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
