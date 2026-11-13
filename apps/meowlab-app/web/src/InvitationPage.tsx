import { useEffect, useState, type ReactNode } from "react";
import { fetchJson, postJson, type Me } from "./auth-client";
import { Logo } from "./App";
import { WhatsAppLink } from "./WhatsAppLink";

// The code survives the sign-in (including Google's redirect) in this tab only.
const PENDING_KEY = "meowlab.invitation";
const CODE = /^[A-Za-z0-9_-]{22}$/;

export function readPendingInvitation(): string | null {
  try {
    const code = window.sessionStorage.getItem(PENDING_KEY);
    return code && CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function storePendingInvitation(code: string) {
  try {
    window.sessionStorage.setItem(PENDING_KEY, code);
  } catch {
    // Storage blocked: the invitation is kept in memory by the caller.
  }
}

export function clearPendingInvitation() {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing stored.
  }
}

/** Accepts the full link or the bare code. */
export function invitationCodeFrom(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/\/invitacion\/([A-Za-z0-9_-]{22})(?:[/?#]|$)/) ?? trimmed.match(/^([A-Za-z0-9_-]{22})$/);
  return match ? match[1] : null;
}

/** Takes /invitacion/<code> out of the address bar and keeps the code for after sign-in. */
export function captureInvitationFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const code = invitationCodeFrom(window.location.pathname);
  if (!code) return null;
  storePendingInvitation(code);
  window.history.replaceState(null, "", "/");
  return code;
}

type Preview =
  | { status: "ok"; invitation: { companyName: string; invitedByName: string | null; expiresAt: string; maskedPhone: string | null; alreadyMember: boolean } }
  | { status: "invalid" | "expired" | "used" | "rate_limited" };

type AcceptResult = { status: "joined" | "invalid" | "expired" | "used" | "already_member" | "needs_whatsapp" | "phone_mismatch" | "rate_limited" };

const PROBLEMS: Record<string, { title: string; text: string }> = {
  invalid: { title: "Este enlace no es válido", text: "Puede que lo hayan anulado o que se haya copiado incompleto. Pídele uno nuevo." },
  expired: { title: "Este enlace venció", text: "Las invitaciones duran 7 días. Pide a quien administra la empresa que te envíe una nueva." },
  used: { title: "Este enlace ya se usó", text: "Cada invitación sirve para una sola persona. Pide a quien administra la empresa una invitación para ti." },
  rate_limited: { title: "Demasiados intentos", text: "Espera unos minutos y vuelve a abrir el enlace." },
  unavailable: { title: "No pudimos abrir la invitación", text: "Inténtalo otra vez en unos minutos." },
};

export function InvitationPage({ code, me, onDone }: { code: string; me: Me; onDone: (joined: boolean) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void fetchJson<Preview>(`/api/invitations/${code}`).then((value) => (value ? setPreview(value) : setFailed(true)))
      .catch(() => setFailed(true));
  }, [code]);

  async function accept() {
    setBusy(true);
    setProblem(null);
    const result = await postJson<AcceptResult>(`/api/invitations/${code}/accept`).catch(() => null);
    setBusy(false);
    if (result?.status === "joined" || result?.status === "already_member") return onDone(true);
    setProblem(result?.status ?? "unavailable");
  }

  const shell = (children: ReactNode) => (
    <div className="min-h-dvh bg-mint-light">
      <header className="bg-forest">
        <div className="mx-auto flex h-20 max-w-3xl items-center px-4 sm:px-6">
          <Logo light />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-16">{children}</main>
    </div>
  );

  if (!preview && !failed) {
    return shell(<p className="text-ink-muted" aria-busy="true">Abriendo la invitación…</p>);
  }
  if (failed || !preview || preview.status !== "ok") {
    const info = PROBLEMS[failed || !preview ? "unavailable" : preview.status] ?? PROBLEMS.unavailable;
    return shell(
      <section className="space-y-4 rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{info.title}</h1>
        <p className="text-ink-2">{info.text}</p>
        <button type="button" className="btn-secondary" onClick={() => onDone(false)}>Ir a mi panel</button>
      </section>,
    );
  }

  const { invitation } = preview;
  if (invitation.alreadyMember) {
    return shell(
      <section className="space-y-4 rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Ya eres parte de {invitation.companyName}</h1>
        <p className="text-ink-2">No necesitas este enlace. Puedes devolvérselo a quien te invitó para que lo use con otra persona.</p>
        <button type="button" className="btn-primary" onClick={() => onDone(false)}>Ir a mi panel</button>
      </section>,
    );
  }

  const needsWhatsApp = problem === "needs_whatsapp" || (invitation.maskedPhone !== null && !me.whatsapp.linked);
  return shell(
    <div className="space-y-6">
      <section className="space-y-5 rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8">
        <span className="chip border border-line-mint bg-mint-light text-forest">Invitación</span>
        <h1 className="text-3xl font-bold tracking-tight text-ink">
          {invitation.invitedByName ? `${invitation.invitedByName} te invitó a` : "Te invitaron a"} {invitation.companyName}
        </h1>
        <p className="max-w-[60ch] text-ink-2">
          Al unirte verás la empresa en tu panel y, con tu WhatsApp vinculado, podrás trabajar con sus agentes según el acceso
          que te dieron.
        </p>
        {invitation.maskedPhone && (
          <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-2">
            Esta invitación es para el WhatsApp <strong className="font-semibold text-ink">{invitation.maskedPhone}</strong>. Debes
            tenerlo vinculado a tu cuenta.
          </p>
        )}
        {problem === "phone_mismatch" && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Tu cuenta tiene vinculado otro número. Pide una invitación para tu número o vincula el correcto.
          </p>
        )}
        {problem && problem !== "phone_mismatch" && problem !== "needs_whatsapp" && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {(PROBLEMS[problem] ?? PROBLEMS.unavailable).text}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={accept} disabled={busy || needsWhatsApp} className="btn-primary">
            {busy ? "Uniéndote…" : `Unirme a ${invitation.companyName}`}
          </button>
          <button type="button" onClick={() => onDone(false)} className="btn-secondary">Ahora no</button>
        </div>
        <p className="text-sm text-ink-muted">
          Vence el {new Date(invitation.expiresAt).toLocaleDateString("es-PE", { day: "numeric", month: "long" })}.
        </p>
      </section>
      {needsWhatsApp && <WhatsAppLink whatsapp={me.whatsapp} onChange={() => window.location.reload()} />}
    </div>,
  );
}
