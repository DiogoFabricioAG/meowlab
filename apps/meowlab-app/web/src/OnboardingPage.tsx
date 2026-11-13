import { useState } from "react";
import { authClient, type Me } from "./auth-client";
import { Logo } from "./App";
import { CompanyStep } from "./CompanyStep";
import { Icon } from "./icons";

/**
 * First thing after signing in without a company (ADR-0010): create one with the RUC or
 * join with the owner's invitation. The panel opens once the account belongs to a company.
 */
export function OnboardingPage({ me, onDone, onInvitation }: { me: Me; onDone: () => void; onInvitation: (code: string) => void }) {
  const [leaving, setLeaving] = useState(false);
  const firstName = me.user.name.trim().split(/\s+/)[0] || "hola";
  return (
    <div className="min-h-dvh bg-mint-light">
      <header className="bg-forest">
        <div className="mx-auto flex h-20 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Logo light />
          <button type="button" disabled={leaving} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-mint hover:text-white focus-visible:outline-mint"
            onClick={async () => {
              setLeaving(true);
              await authClient.signOut();
            }}>
            <Icon name="logout" className="h-4 w-4" /> Salir
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 lg:py-16">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Te damos la bienvenida, {firstName}</h1>
          <p className="max-w-[60ch] text-lg text-ink-muted">
            Un paso antes de entrar a tu panel.
          </p>
        </div>
        <CompanyStep onDone={onDone} onInvitation={onInvitation} />
      </main>
    </div>
  );
}
