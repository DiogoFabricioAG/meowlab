import { useState, type FormEvent } from "react";
import { authClient, errorMessage, type PortalConfig } from "./auth-client";
import { Logo } from "./App";

type Mode = "sign-in" | "sign-up";

const HIGHLIGHTS = [
  { n: "1", title: "Tus comprobantes en un lugar", text: "Facturas, boletas, notas y guías que emitiste con Manolo, con su estado en SUNAT." },
  { n: "2", title: "Descargas al instante", text: "PDF, XML y CDR de cada comprobante, sin pedirlos por el chat." },
  { n: "3", title: "Vinculado a tu WhatsApp", text: "Sólo ves los datos del número que tú confirmas desde tu propio WhatsApp." },
];

export function AuthPage({ config }: { config: PortalConfig }) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = mode === "sign-in"
      ? await authClient.signIn.email({ email: email.trim(), password })
      : await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
    setBusy(false);
    if (result.error) setError(errorMessage(result.error));
  }

  async function google() {
    setError(null);
    setBusy(true);
    const result = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
    if (result.error) {
      setBusy(false);
      setError(errorMessage(result.error));
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-12">
      <aside className="hidden flex-col justify-between bg-forest p-10 text-white lg:col-span-5 lg:flex xl:p-14">
        <a href="https://meowlab.tech" className="w-fit rounded-xl" aria-label="Ir a meowlab.tech">
          <Logo light />
        </a>
        <div className="space-y-8">
          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight xl:text-5xl">Lo que hacen tus agentes, a la vista</h1>
            <p className="max-w-[46ch] text-lg leading-relaxed text-mint">
              Manolo trabaja por WhatsApp. Aquí revisas con calma lo que emitió y descargas tus documentos.
            </p>
          </div>
          <ul className="space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.n} className="flex items-start gap-4 rounded-xl bg-forest-card p-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-mint text-sm font-bold text-forest">
                  {item.n}
                </span>
                <span className="space-y-1">
                  <span className="block font-title text-lg font-bold">{item.title}</span>
                  <span className="block leading-relaxed text-mint-text">{item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-mint">¿Dudas? Escríbenos a Manolo desde tu WhatsApp.</p>
      </aside>

      <main className="flex flex-col px-4 py-8 sm:px-8 lg:col-span-7 lg:justify-center lg:px-16">
        <div className="mb-10 lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto w-full max-w-md space-y-8">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {mode === "sign-in" ? "Entra a tu panel" : "Crea tu cuenta"}
            </h2>
            <p className="text-ink-muted">
              {mode === "sign-in"
                ? "Usa el correo con el que te registraste."
                : "Luego vincularás el número de WhatsApp con el que hablas con Manolo."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-surface-subtle p-1" role="tablist">
            {(["sign-in", "sign-up"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => switchMode(value)}
                className={`rounded-[10px] px-4 py-2.5 text-sm font-semibold transition-colors ${
                  mode === value ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"
                }`}
              >
                {value === "sign-in" ? "Iniciar sesión" : "Crear cuenta"}
              </button>
            ))}
          </div>

          {config.google && (
            <>
              <button type="button" onClick={google} disabled={busy} className="btn-secondary w-full">
                <GoogleMark />
                Continuar con Google
              </button>
              <div className="flex items-center gap-3 text-sm text-ink-muted">
                <span className="h-px flex-1 bg-line" />o con tu correo<span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          <form onSubmit={submit} className="space-y-4" noValidate={false}>
            {mode === "sign-up" && (
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-ink-2">Nombre</span>
                <input
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  maxLength={80}
                />
              </label>
            )}
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink-2">Correo</span>
              <input
                className="field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink-2">Contraseña</span>
              <input
                className="field"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                minLength={10}
                maxLength={128}
                required
              />
              {mode === "sign-up" && <span className="block text-sm text-ink-muted">Mínimo 10 caracteres.</span>}
            </label>

            {error && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? "Un momento…" : mode === "sign-in" ? "Entrar" : "Crear cuenta"}
            </button>
            {mode === "sign-in" && !config.passwordReset && (
              <p className="text-center text-sm text-ink-muted">
                ¿Olvidaste tu contraseña? Por ahora pídele ayuda al equipo de MeowLab.
              </p>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  );
}
