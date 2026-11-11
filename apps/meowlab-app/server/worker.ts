import { createApp } from "./app";
import { createAuth, googleEnabled, type AuthSettings } from "./auth";

type Env = AuthSettings & {
  DB: D1Database;
};

export default {
  fetch(request, env, ctx) {
    const auth = createAuth(env.DB, env);
    return createApp({ auth, googleEnabled: googleEnabled(env) }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
