import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Membership } from "./auth-client";
import {
  DEFAULT_BRAND_COLOR,
  PAYMENT_KIND_LABEL,
  QuoteDocument,
  contrastWithWhite,
  type BrandKit,
  type BrandKitView,
  type PaymentEntry,
  type Quote,
} from "./QuoteDocument";

const MAX_LOGO_BYTES = 300 * 1024;
const MAX_LOGO_SIDE = 600;
const MIN_CONTRAST = 4.5;
/** Colors that always read well with white text. */
const SUGGESTED = ["#0f3d2e", "#1d4ed8", "#7c2d12", "#6d28d9", "#be123c", "#334155"];

type Form = {
  primaryColor: string;
  contactAddress: string;
  contactPhone: string;
  contactEmail: string;
  contactWeb: string;
  paymentMethods: PaymentEntry[];
  footerText: string;
  quoteValidDays: string;
  quotePaymentTerms: string;
  quoteDeliveryTerms: string;
};

const toForm = (kit: BrandKit): Form => ({
  primaryColor: kit.primaryColor ?? "",
  contactAddress: kit.contactAddress ?? "",
  contactPhone: kit.contactPhone ?? "",
  contactEmail: kit.contactEmail ?? "",
  contactWeb: kit.contactWeb ?? "",
  paymentMethods: kit.paymentMethods,
  footerText: kit.footerText ?? "",
  quoteValidDays: kit.quoteValidDays ? String(kit.quoteValidDays) : "",
  quotePaymentTerms: kit.quotePaymentTerms ?? "",
  quoteDeliveryTerms: kit.quoteDeliveryTerms ?? "",
});

const empty = (value: string) => (value.trim() ? value.trim() : null);
const toKit = (form: Form): BrandKit => ({
  primaryColor: empty(form.primaryColor.toLowerCase()),
  contactAddress: empty(form.contactAddress),
  contactPhone: empty(form.contactPhone),
  contactEmail: empty(form.contactEmail),
  contactWeb: empty(form.contactWeb),
  paymentMethods: form.paymentMethods.filter((method) => method.value.trim()),
  footerText: empty(form.footerText),
  quoteValidDays: form.quoteValidDays ? Number(form.quoteValidDays) : null,
  quotePaymentTerms: empty(form.quotePaymentTerms),
  quoteDeliveryTerms: empty(form.quoteDeliveryTerms),
});

const PROBLEMS: Record<string, string> = {
  color_contrast: "Ese color es muy claro: el texto blanco no se leería. Elige uno más oscuro.",
  invalid_color: "Escribe el color como #RRGGBB, por ejemplo #0f3d2e.",
  invalid_email: "Revisa el correo: no parece válido.",
  invalid_web: "Revisa la web: escríbela como tuempresa.pe o https://tuempresa.pe.",
  invalid_field: "Revisa los datos: alguno es demasiado largo o está incompleto.",
  forbidden: "Solo quien administra la empresa puede cambiar sus documentos.",
  size: "El logo pesa demasiado incluso reducido. Prueba con una imagen más simple.",
  format: "Ese archivo no es una imagen PNG o JPG válida.",
  dimensions: "El logo es demasiado pequeño. Usa una imagen de al menos 16 píxeles por lado.",
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Trims empty borders (transparent or white), reduces to 600 px and encodes as PNG,
 * or as JPEG on white when the PNG would weigh more than 300 KB.
 */
async function prepareLogo(file: File): Promise<Blob> {
  // Decoded without an object URL: the portal's CSP does not allow blob: images.
  const image = await createImageBitmap(file);
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context || !source.width || !source.height) throw new Error("image");
  context.drawImage(image, 0, 0);
  image.close();
  const { data, width, height } = context.getImageData(0, 0, source.width, source.height);
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const blank = data[at + 3] < 16 || (data[at] > 245 && data[at + 1] > 245 && data[at + 2] > 245);
      if (blank) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) {
    left = 0; top = 0; right = width - 1; bottom = height - 1;
  }
  const pad = 4;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const scale = Math.min(1, MAX_LOGO_SIDE / Math.max(cropWidth, cropHeight));
  const output = document.createElement("canvas");
  output.width = Math.max(16, Math.round(cropWidth * scale));
  output.height = Math.max(16, Math.round(cropHeight * scale));
  const out = output.getContext("2d");
  if (!out) throw new Error("image");
  out.imageSmoothingQuality = "high";
  out.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, output.width, output.height);
  const png = await toBlob(output, "image/png");
  if (png && png.size <= MAX_LOGO_BYTES) return png;
  out.globalCompositeOperation = "destination-over";
  out.fillStyle = "#ffffff";
  out.fillRect(0, 0, output.width, output.height);
  const jpeg = await toBlob(output, "image/jpeg", 0.85);
  if (jpeg && jpeg.size <= MAX_LOGO_BYTES) return jpeg;
  throw new Error("size");
}

function sampleQuote(company: Membership, form: Form): Quote {
  const today = new Date();
  const days = Number(form.quoteValidDays) || 7;
  return {
    company: { name: company.name, legalName: company.legalName, ruc: company.ruc, address: null },
    number: 27,
    issuedAt: today.toISOString(),
    validUntil: new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10),
    customerName: "Cliente de ejemplo S.A.C.",
    subtotalCents: 81_000,
    discountCents: 0,
    totalCents: 81_000,
    notes: null,
    paymentTerms: empty(form.quotePaymentTerms),
    deliveryTerms: empty(form.quoteDeliveryTerms),
    lines: [
      { description: "Producto de ejemplo", quantity: 12, unitPriceCents: 4_500, totalCents: 54_000 },
      { description: "Servicio de ejemplo", quantity: 1, unitPriceCents: 27_000, totalCents: 27_000 },
    ],
  };
}

/**
 * «Configuración → Documentos» (ADR-0012, phase 1): logo, color, contact, payment
 * methods and quote terms, with a live preview of a quote. Owners edit; members look.
 */
export function BrandKitPanel({ company, onBack }: { company: Membership; onBack: () => void }) {
  const [view, setView] = useState<BrandKitView | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = `/api/companies/${encodeURIComponent(company.id)}/brand`;

  const apply = (body: { status?: string; brand?: BrandKitView; canEdit?: boolean; problem?: string } | null, saved?: string) => {
    if (body?.status === "ok" && body.brand) {
      setView(body.brand);
      setCanEdit(Boolean(body.canEdit));
      setForm(toForm(body.brand));
      if (saved) setMessage({ tone: "ok", text: saved });
      return true;
    }
    const problem = body?.problem ?? body?.status ?? "";
    setMessage({ tone: "error", text: PROBLEMS[problem] ?? "No pudimos guardar. Inténtalo otra vez en unos minutos." });
    return false;
  };

  useEffect(() => {
    setState("loading");
    setMessage(null);
    void fetch(base, { credentials: "same-origin" })
      .then(async (response) => {
        const body = response.ok ? await response.json() : null;
        if (body?.status === "ok" && body.brand) {
          setView(body.brand);
          setCanEdit(Boolean(body.canEdit));
          setForm(toForm(body.brand));
          setState("ready");
        } else {
          setState("error");
        }
      })
      .catch(() => setState("error"));
  }, [base]);

  const color = form?.primaryColor && /^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor.toLowerCase() : null;
  const contrast = color ? contrastWithWhite(color) : null;
  const colorProblem = form?.primaryColor && !color ? "invalid_color" : contrast !== null && contrast < MIN_CONTRAST ? "color_contrast" : null;
  const preview = useMemo(() => (form && view ? sampleQuote(company, form) : null), [company, form, view]);

  if (state !== "ready" || !form || !view || !preview) {
    return (
      <div className="space-y-4" aria-busy={state === "loading"}>
        <button type="button" onClick={onBack} className="text-sm font-semibold text-forest">← Configuración</button>
        <p className="text-ink-muted">{state === "loading" ? "Cargando los documentos de tu empresa…" : "No pudimos cargar los documentos. Inténtalo otra vez en unos minutos."}</p>
      </div>
    );
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setMessage(null);
  };
  const setMethods = (change: (methods: PaymentEntry[]) => PaymentEntry[]) => {
    setForm((current) => (current ? { ...current, paymentMethods: change(current.paymentMethods) } : current));
    setMessage(null);
  };
  const setMethod = (index: number, patch: Partial<PaymentEntry>) =>
    setMethods((methods) => methods.map((method, at) => (at === index ? { ...method, ...patch } : method)));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || colorProblem) return;
    setSaving(true);
    try {
      const response = await fetch(base, {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toKit(form)),
      });
      apply(response.status === 503 ? null : await response.json().catch(() => null), "Listo. Tus próximas cotizaciones salen con estos datos.");
    } catch {
      apply(null);
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setLogoBusy(true);
    setMessage(null);
    try {
      const blob = await prepareLogo(file);
      const response = await fetch(`${base}/logo`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": blob.type }, body: blob });
      apply(await response.json().catch(() => null), "Logo guardado.");
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message === "size" ? PROBLEMS.size : "No pudimos leer esa imagen. Usa un PNG o JPG." });
    } finally {
      setLogoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      const response = await fetch(`${base}/logo`, { method: "DELETE", credentials: "same-origin" });
      apply(await response.json().catch(() => null), "Logo quitado.");
    } catch {
      apply(null);
    } finally {
      setLogoBusy(false);
    }
  }

  const logoUrl = view.logo ? `${base}/logo?v=${view.logo.version}` : null;
  const text = (key: keyof Form, label: string, props: { max: number; type?: string; placeholder?: string; inputMode?: "tel" | "email" | "url" }) => (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-ink-2">{label}</span>
      <input className="field bg-white" type={props.type ?? "text"} inputMode={props.inputMode} placeholder={props.placeholder}
        maxLength={props.max} value={form[key] as string} onChange={(event) => set(key, event.target.value)} />
    </label>
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <button type="button" onClick={onBack} className="text-sm font-semibold text-forest">← Configuración</button>
        <h1 className="text-3xl font-bold tracking-tight text-ink">Documentos de {company.name}</h1>
        <p className="max-w-2xl text-lg text-ink-muted">
          Tu logo, tu color y tus datos de contacto y de pago. Hoy se usan en las cotizaciones de Sales Cat; pronto también en tus
          facturas, boletas y guías. Los datos que pide SUNAT no se pueden quitar.
        </p>
      </header>

      {!canEdit && (
        <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-2">Solo quien administra la empresa puede cambiar estos datos. Tú puedes verlos.</p>
      )}

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <form onSubmit={save} className="space-y-6" aria-label="Kit de marca">
          <fieldset disabled={!canEdit} className="space-y-6">
            <section className="space-y-3 rounded-3xl border border-line bg-white p-6 shadow-card" aria-labelledby="brand-logo">
              <h2 id="brand-logo" className="text-lg font-bold text-ink">Logo</h2>
              <div className="flex items-center gap-4">
                <span className="grid h-20 w-28 shrink-0 place-items-center rounded-xl border border-line bg-white p-2">
                  {logoUrl ? <img src={logoUrl} alt="Logo actual" className="max-h-full max-w-full object-contain" />
                    : <span className="text-xs text-ink-muted">Sin logo</span>}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" disabled={logoBusy || !canEdit} onClick={() => fileInput.current?.click()}>
                    {logoBusy ? "Procesando…" : view.logo ? "Cambiar logo" : "Subir logo"}
                  </button>
                  {view.logo && <button type="button" className="btn-secondary" disabled={logoBusy || !canEdit} onClick={removeLogo}>Quitar</button>}
                </div>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true"
                  onChange={(event) => void uploadLogo(event.target.files?.[0])} />
              </div>
              <p className="text-sm text-ink-muted">PNG o JPG. Le quitamos los bordes vacíos y lo reducimos a 600 px.</p>
            </section>

            <section className="space-y-3 rounded-3xl border border-line bg-white p-6 shadow-card" aria-labelledby="brand-color">
              <h2 id="brand-color" className="text-lg font-bold text-ink">Color principal</h2>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Colores sugeridos">
                {SUGGESTED.map((swatch) => (
                  <button key={swatch} type="button" onClick={() => set("primaryColor", swatch)} aria-label={`Usar ${swatch}`}
                    aria-pressed={color === swatch}
                    className={`h-9 w-9 rounded-full ring-offset-2 ${color === swatch ? "ring-2 ring-ink" : ""}`} style={{ background: swatch }} />
                ))}
                <input type="color" aria-label="Elegir otro color" value={color ?? DEFAULT_BRAND_COLOR}
                  onChange={(event) => set("primaryColor", event.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-white" />
                <input className="field w-32 bg-white font-mono text-sm" aria-label="Color en hexadecimal" placeholder="#0f3d2e" maxLength={7}
                  value={form.primaryColor} onChange={(event) => set("primaryColor", event.target.value.trim())} aria-invalid={Boolean(colorProblem)}
                  aria-describedby="color-help" />
              </div>
              <p id="color-help" className={`text-sm ${colorProblem ? "font-semibold text-red-700" : "text-ink-muted"}`}>
                {colorProblem ? PROBLEMS[colorProblem] : "Va en la cabecera y en el total. Si no eliges uno, usamos el verde de MeowLab."}
              </p>
            </section>

            <section className="space-y-3 rounded-3xl border border-line bg-white p-6 shadow-card" aria-labelledby="brand-contact">
              <h2 id="brand-contact" className="text-lg font-bold text-ink">Datos de contacto</h2>
              {text("contactAddress", "Dirección comercial", { max: 200, placeholder: "Si la dejas vacía, va la de SUNAT" })}
              <div className="grid gap-3 sm:grid-cols-2">
                {text("contactPhone", "Teléfono", { max: 40, type: "tel", inputMode: "tel", placeholder: "987 654 321" })}
                {text("contactEmail", "Correo", { max: 120, type: "email", inputMode: "email", placeholder: "ventas@tuempresa.pe" })}
              </div>
              {text("contactWeb", "Web", { max: 120, inputMode: "url", placeholder: "tuempresa.pe" })}
            </section>

            <section className="space-y-3 rounded-3xl border border-line bg-white p-6 shadow-card" aria-labelledby="brand-payments">
              <h2 id="brand-payments" className="text-lg font-bold text-ink">Formas de pago</h2>
              {form.paymentMethods.length === 0 && <p className="text-sm text-ink-muted">Agrega tus cuentas, CCI, Yape o Plin para que tus clientes sepan cómo pagarte.</p>}
              <ul className="space-y-3">
                {form.paymentMethods.map((method, index) => (
                  <li key={index} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 rounded-2xl bg-surface-subtle p-3">
                    <select className="field bg-white py-2 text-sm" aria-label="Tipo" value={method.kind}
                      onChange={(event) => setMethod(index, { kind: event.target.value as PaymentEntry["kind"] })}>
                      {(Object.keys(PAYMENT_KIND_LABEL) as PaymentEntry["kind"][]).map((kind) => <option key={kind} value={kind}>{PAYMENT_KIND_LABEL[kind]}</option>)}
                    </select>
                    <input className="field bg-white py-2 text-sm" aria-label="Número" placeholder={method.kind === "yape" || method.kind === "plin" ? "987 654 321" : "191-1234567-0-12"}
                      maxLength={60} value={method.value} onChange={(event) => setMethod(index, { value: event.target.value })} />
                    <input className="field bg-white py-2 text-sm" aria-label="Nombre que se muestra" placeholder={method.kind === "bank" ? "BCP soles" : "Opcional"}
                      maxLength={60} value={method.label} onChange={(event) => setMethod(index, { label: event.target.value })} />
                    <button type="button" className="min-h-11 justify-self-start px-2 text-sm font-semibold text-red-700" aria-label={`Quitar ${PAYMENT_KIND_LABEL[method.kind]} ${method.value}`}
                      onClick={() => setMethods((methods) => methods.filter((_, at) => at !== index))}>Quitar</button>
                  </li>
                ))}
              </ul>
              {form.paymentMethods.length < 6 && (
                <button type="button" className="btn-secondary" onClick={() => setMethods((methods) => [...methods, { kind: "yape", label: "", value: "" }])}>
                  Agregar forma de pago
                </button>
              )}
            </section>

            <section className="space-y-3 rounded-3xl border border-line bg-white p-6 shadow-card" aria-labelledby="brand-quotes">
              <h2 id="brand-quotes" className="text-lg font-bold text-ink">Cotizaciones</h2>
              <label className="block space-y-1.5">
                <span className="block text-sm font-semibold text-ink-2">Validez (días)</span>
                <input className="field w-28 bg-white" type="number" min={1} max={90} inputMode="numeric" placeholder="7"
                  value={form.quoteValidDays} onChange={(event) => set("quoteValidDays", event.target.value.replace(/\D/g, "").slice(0, 2))} />
              </label>
              {text("quotePaymentTerms", "Condiciones de pago", { max: 300, placeholder: "50% al confirmar, 50% contra entrega" })}
              {text("quoteDeliveryTerms", "Plazo de entrega", { max: 300, placeholder: "3 días hábiles desde el pago" })}
              {text("footerText", "Texto al pie", { max: 300, placeholder: "Gracias por tu preferencia" })}
            </section>
          </fieldset>

          {message && (
            <p role={message.tone === "error" ? "alert" : "status"}
              className={`rounded-xl px-4 py-3 text-sm ${message.tone === "ok" ? "bg-mint-light text-ink-2" : "border border-red-200 bg-red-50 text-red-800"}`}>
              {message.text}
            </p>
          )}
          {canEdit && (
            <button type="submit" className="btn-primary w-full sm:w-auto" disabled={saving || Boolean(colorProblem)}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          )}
        </form>

        <section className="space-y-3 xl:sticky xl:top-8" aria-labelledby="brand-preview">
          <h2 id="brand-preview" className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Vista previa · cotización de ejemplo</h2>
          <div className="rounded-3xl bg-mint-light p-3 sm:p-5">
            <QuoteDocument quote={preview} brand={{ ...toKit(form), primaryColor: color && !colorProblem ? color : null }} logoUrl={logoUrl} />
          </div>
        </section>
      </div>
    </div>
  );
}
