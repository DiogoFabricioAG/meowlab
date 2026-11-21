import { useEffect, useState } from "react";
import { authClient, fetchJson, type Me, type PortalConfig } from "./auth-client";
import { installNativeListeners, isNativeApp, readAuthToken } from "./api";
import { AuthPage } from "./AuthPage";
import { Panel } from "./Panel";
import { OnboardingPage } from "./OnboardingPage";
import { InvitationPage, captureInvitationFromUrl, clearPendingInvitation, readPendingInvitation, storePendingInvitation } from "./InvitationPage";

// Before anything renders: /invitacion/<code> leaves the address bar and waits for the sign-in.
const invitedWith = captureInvitationFromUrl();

export function App() {
  const { data: session, isPending } = authClient.useSession();
  const [config, setConfig] = useState<PortalConfig>({ google: false, passwordReset: false });
  const [me, setMe] = useState<Me | null>(null);
  const [invitation, setInvitation] = useState<string | null>(() => invitedWith ?? readPendingInvitation());
  const [tokenReady, setTokenReady] = useState(() => !isNativeApp());
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    if (isNativeApp()) {
      void readAuthToken().finally(() => setTokenReady(true));
    }
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const uninstallNative = installNativeListeners(setOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      uninstallNative();
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    void fetchJson<PortalConfig>("/api/config").then((value) => value && setConfig(value));
  }, [online]);

  useEffect(() => {
    if (!tokenReady || !online) return;
    if (!session) {
      setMe(null);
      return;
    }
    void fetchJson<Me>("/api/me").then(setMe);
  }, [session?.user.id, tokenReady, online]);

  if (!online) {
    return (
      <main className="grid min-h-dvh place-items-center bg-white px-6 text-center">
        <div className="max-w-sm space-y-4">
          <Logo />
          <h1 className="text-2xl text-ink">Sin conexión a internet</h1>
          <p className="text-sm text-ink-muted">
            Revisa tu señal o Wi-Fi para ver tus comprobantes y avisos de MeowLab.
          </p>
          <button type="button" onClick={() => window.location.reload()} className="btn-primary w-full">
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  if (!tokenReady || isPending || (session && !me)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-white" aria-busy="true" role="status" aria-label="Cargando MeowLab">
        <img
          src="/meowlab-black.webp"
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 animate-pulse object-contain mix-blend-multiply motion-reduce:animate-none"
          decoding="async"
        />
      </div>
    );
  }
  const refresh = () => void fetchJson<Me>("/api/me").then(setMe);
  if (!session || !me) return <AuthPage config={config} invited={invitation !== null} />;
  if (invitation) {
    return (
      <InvitationPage
        code={invitation}
        me={me}
        onDone={(joined) => {
          clearPendingInvitation();
          setInvitation(null);
          if (joined) refresh();
        }}
      />
    );
  }
  // Without a company there is no panel yet: create one or join by invitation first.
  if (me.companies !== null && me.companies.length === 0) {
    return (
      <OnboardingPage
        me={me}
        onDone={refresh}
        onInvitation={(code) => {
          storePendingInvitation(code);
          setInvitation(code);
        }}
      />
    );
  }
  return <Panel me={me} onChange={refresh} />;
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex select-none items-center gap-2">
      <img
        src={light ? "/meowlab-white.webp" : "/meowlab-black.webp"}
        alt=""
        width={36}
        height={36}
        className={`h-9 w-9 shrink-0 object-contain ${light ? "mix-blend-screen" : "mix-blend-multiply"}`}
        decoding="async"
      />
      <span className={`font-brand text-xl font-semibold tracking-tight ${light ? "text-white" : "text-ink"}`}>
        meow<span className={light ? "font-normal text-mint" : "font-bold text-forest"}>lab</span>
      </span>
    </span>
  );
}
