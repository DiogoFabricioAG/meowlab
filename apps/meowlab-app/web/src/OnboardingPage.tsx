import { useState } from "react";
import { authClient, type Me } from "./auth-client";
import { Logo } from "./App";
import { CompanyStep } from "./CompanyStep";
import { Icon } from "./icons";
import { PageHeader } from "./PageHeader";

/**
 * First thing after signing in without a company (ADR-0010, ADR-0019): create one with
 * or without RUC, or join with the owner's invitation.
 */
export function OnboardingPage({ me, onDone, onInvitation }: { me: Me; onDone: () => void; onInvitation: (code: string) => void }) {
  const [leaving, setLeaving] = useState(false);
  const firstName = me.user.name.trim().split(/\s+/)[0] || "hola";
  return (
    <div className="min-h-dvh bg-surface-subtle">
      <header className="bg-forest">
        <div className="mx-auto flex h-18 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Logo light />
          <button
            type="button"
            disabled={leaving}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-mint hover:bg-forest-card hover:text-white focus-visible:outline-mint"
            onClick={async () => {
              setLeaving(true);
              await authClient.signOut();
            }}
          >
            <Icon name="logout" className="h-4 w-4" /> Salir
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6 lg:py-14">
        <PageHeader
          eyebrow="Tu cuenta en MeowLab"
          title={`Te damos la bienvenida, ${firstName}`}
          subtitle="Elige cómo empezar con tu negocio. Si aún no tienes RUC, igual puedes usar casi todos tus gatos."
        />
        <CompanyStep onDone={onDone} onInvitation={onInvitation} />
      </main>
    </div>
  );
}
