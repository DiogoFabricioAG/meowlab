import { useEffect, useState, type FormEvent } from "react";
import { postJson, type Me } from "./auth-client";

type LinkResponse =
  | { status: "code_sent"; challengeId: string; expiresAt: string; resendAfterSeconds: number; maskedPhone: string }
  | { status: "invalid_phone" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "delivery_failed" }
  | { status: "linked"; maskedPhone: string; linkedAt: string }
  | { status: "invalid_code"; attemptsLeft: number | null }
  | { status: "expired" }
  | { status: "unlinked" };

type Step = { kind: "phone" } | { kind: "code"; challengeId: string; maskedPhone: string; resendAt: number };

const STEPS = [
  { n: "1", text: "Escribe el número con el que hablas con Manolo." },
  { n: "2", text: "Te llega un código de 6 dígitos por WhatsApp." },
  { n: "3", text: "Lo pegas aquí y se abren tus datos." },
];

function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} min`;
}

export function WhatsAppLink({ whatsapp, onChange }: { whatsapp: Me["whatsapp"]; onChange: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "phone" });
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (step.kind !== "code") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [step.kind]);

  if (whatsapp.linked) {
    return <LinkedCard maskedPhone={whatsapp.maskedPhone} onChange={onChange} />;
  }

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setMessage(null);
    setBusy(true);
    const result = await postJson<LinkResponse>("/api/whatsapp/start", { phone });
    setBusy(false);
    if (!result) return setMessage({ tone: "error", text: "No pudimos pedir el código. Inténtalo en unos minutos." });
    switch (result.status) {
      case "code_sent":
        setCode("");
        setStep({ kind: "code", challengeId: result.challengeId, maskedPhone: result.maskedPhone,
          resendAt: Date.now() + result.resendAfterSeconds * 1_000 });
        return;
      case "invalid_phone":
        return setMessage({ tone: "error", text: "Revisa el número: escribe los 9 dígitos de tu celular o el número con código de país." });
      case "rate_limited":
        return setMessage({ tone: "error", text: `Pediste varios códigos seguidos. Podrás pedir otro en ${waitText(result.retryAfterSeconds)}.` });
      case "delivery_failed":
        return setMessage({ tone: "error", text: "No pudimos enviar el código por WhatsApp. Inténtalo en unos minutos." });
      default:
        return setMessage({ tone: "error", text: "No pudimos pedir el código. Inténtalo otra vez." });
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (step.kind !== "code") return;
    setMessage(null);
    setBusy(true);
    const result = await postJson<LinkResponse>("/api/whatsapp/verify", { challengeId: step.challengeId, code });
    setBusy(false);
    if (result?.status === "linked") return onChange();
    if (result?.status === "invalid_code") {
      return setMessage({
        tone: "error",
        text: result.attemptsLeft === null || result.attemptsLeft > 0
          ? `El código no coincide.${result.attemptsLeft ? ` Te quedan ${result.attemptsLeft} intentos.` : ""}`
          : "El código no coincide y ya no admite más intentos. Pide uno nuevo.",
      });
    }
    if (result?.status === "expired") {
      return setMessage({ tone: "error", text: "Ese código venció o ya no es válido. Pide uno nuevo." });
    }
    setMessage({ tone: "error", text: "No pudimos verificar el código. Inténtalo otra vez." });
  }

  const resendIn = step.kind === "code" ? Math.max(0, Math.ceil((step.resendAt - now) / 1_000)) : 0;

  return (
    <section className="rounded-3xl border border-line-mint bg-mint-light p-6 sm:p-8" aria-labelledby="link-title">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2 lg:max-w-md">
          <span className="chip border border-line-mint bg-white text-forest">
            <span className="h-2 w-2 rounded-full bg-whatsapp" aria-hidden="true" /> Primer paso
          </span>
          <h2 id="link-title" className="text-2xl font-bold tracking-tight text-ink">
            Vincula tu WhatsApp
          </h2>
          <p className="text-ink-2">
            Tus datos están asociados al número con el que hablas con Manolo. Te enviaremos un código a ese WhatsApp para
            confirmar que es tuyo.
          </p>
        </div>
        <ol className="grid gap-3 sm:grid-cols-3 lg:max-w-xl">
          {STEPS.map((item) => (
            <li key={item.n} className="rounded-2xl bg-white p-4 shadow-soft">
              <span className="mb-2 grid h-8 w-8 place-items-center rounded-lg bg-mint text-sm font-bold text-forest">
                {item.n}
              </span>
              <span className="block text-sm leading-relaxed text-ink-2">{item.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 border-t border-line-mint pt-6">
        {!whatsapp.available ? (
          <p className="text-sm text-ink-muted">La vinculación todavía no está disponible. Vuelve a intentarlo más tarde.</p>
        ) : step.kind === "phone" ? (
          <form onSubmit={requestCode} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 space-y-1.5 sm:max-w-sm">
              <span className="text-sm font-semibold text-ink-2">Tu número de WhatsApp</span>
              <input
                className="field bg-white"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="987 654 321"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={32}
                required
              />
            </label>
            <button type="submit" disabled={busy || !phone.trim()} className="btn-primary">
              {busy ? "Enviando…" : "Enviarme el código"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <p className="text-ink-2">
              Si <strong className="font-semibold text-ink">{step.maskedPhone}</strong> habla con Manolo, te llegó un
              código por WhatsApp. Vence en 10 minutos.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-ink-2">Código</span>
                <input
                  className="field w-44 bg-white text-center font-title text-2xl tracking-[0.35em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  aria-describedby="code-help"
                  required
                />
              </label>
              <button type="submit" disabled={busy || code.length !== 6} className="btn-primary">
                {busy ? "Verificando…" : "Verificar"}
              </button>
            </div>
            <p id="code-help" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
              <button
                type="button"
                className="font-semibold text-forest underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
                disabled={busy || resendIn > 0}
                onClick={() => void requestCode()}
              >
                {resendIn > 0 ? `Reenviar en ${resendIn} s` : "Reenviar código"}
              </button>
              <button
                type="button"
                className="font-semibold text-forest underline-offset-4 hover:underline"
                onClick={() => {
                  setStep({ kind: "phone" });
                  setMessage(null);
                }}
              >
                Cambiar número
              </button>
            </p>
          </form>
        )}
        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
              message.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-line-mint bg-white text-ink-2"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}

function LinkedCard({ maskedPhone, onChange }: { maskedPhone: string; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function unlink() {
    setBusy(true);
    await postJson("/api/whatsapp/unlink");
    setBusy(false);
    onChange();
  }

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-line bg-white p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-mint text-forest" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-6 w-6">
            <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
          </svg>
        </span>
        <div>
          <h2 className="text-lg font-bold text-ink">WhatsApp vinculado</h2>
          <p className="text-ink-muted">{maskedPhone}</p>
        </div>
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-2">¿Desvincular este número?</span>
          <button type="button" onClick={unlink} disabled={busy} className="btn-danger px-4 py-2.5 text-sm">
            Sí, desvincular
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="btn-secondary px-4 py-2.5 text-sm">
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="btn-secondary px-4 py-2.5 text-sm">
          Desvincular
        </button>
      )}
    </section>
  );
}
