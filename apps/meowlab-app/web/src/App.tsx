import { useEffect, useState } from "react";
import { authClient, fetchJson, type Me, type PortalConfig } from "./auth-client";
import { AuthPage } from "./AuthPage";
import { Panel } from "./Panel";

export function App() {
  const { data: session, isPending } = authClient.useSession();
  const [config, setConfig] = useState<PortalConfig>({ google: false, passwordReset: false });
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    void fetchJson<PortalConfig>("/api/config").then((value) => value && setConfig(value));
  }, []);

  useEffect(() => {
    if (!session) {
      setMe(null);
      return;
    }
    void fetchJson<Me>("/api/me").then(setMe);
  }, [session?.user.id]);

  if (isPending || (session && !me)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-white" aria-busy="true">
        <img src="/meowlab-black.png" alt="" className="h-12 w-12 animate-pulse object-contain mix-blend-multiply" />
      </div>
    );
  }
  if (!session || !me) return <AuthPage config={config} />;
  return <Panel me={me} />;
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex select-none items-center gap-2">
      <img
        src="/meowlab-black.png"
        alt=""
        className={`h-9 w-9 shrink-0 object-contain ${light ? "invert" : "mix-blend-multiply"}`}
      />
      <span className={`font-title text-xl font-semibold tracking-tight ${light ? "text-white" : "text-ink"}`}>
        meow<span className={light ? "font-normal text-mint" : "font-bold text-forest"}>lab</span>
      </span>
    </span>
  );
}
