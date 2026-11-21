import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { fetchJson, postJson, type Membership } from "./auth-client";

type Member = { id: string; role: "owner" | "member"; joinedAt: string; name: string; email: string | null; you: boolean };
type Invitation = { id: string; createdAt: string; expiresAt: string; maskedPhone: string | null; access: "view" | "full" };
type Team = { status: "ok"; members: Member[]; invitations: Invitation[] };
type Created = { status: "invited"; invitation: Invitation & { url: string } } | { status: "invalid_phone" | "limit_reached" | "forbidden" };

const ACCESS = {
  view: { label: "Ver comprobantes", text: "Consulta facturas, boletas y descargas." },
  full: { label: "Emitir y ver", text: "Además emite facturas, boletas y notas de crédito con Invoice Cat." },
} as const;

const shortDate = (value: string) => new Date(value).toLocaleDateString("es-PE", { day: "numeric", month: "short" });

/** Same rule as the bridge: a bare 9-digit Peruvian mobile gets the 51 prefix. */
function whatsappDigits(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, "").replace(/^\+/, "").replace(/^00/, "");
  if (!/^\d+$/.test(digits)) return null;
  const full = /^9\d{8}$/.test(digits) ? `51${digits}` : digits;
  return /^[1-9]\d{7,14}$/.test(full) ? full : null;
}

/** The owner's team (ADR-0010, phase 2): members, open invitations and new links to send by WhatsApp. */
export function TeamPanel({ company, onChange = () => window.location.reload() }: { company: Membership; onChange?: () => void }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [phone, setPhone] = useState("");
  const [access, setAccess] = useState<"view" | "full">("view");
  const [created, setCreated] = useState<{ url: string; phone: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Member | "leave" | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogTitle = useId();
  const dialogDescription = useId();

  const base = `/api/companies/${encodeURIComponent(company.id)}`;
  const load = useCallback(() => {
    void fetchJson<Team>(`${base}/team`).then((value) => (value ? setTeam(value) : setLoadFailed(true))).catch(() => setLoadFailed(true));
  }, [base]);
  useEffect(() => { if (company.role === "owner") load(); }, [company.role, load]);

  function openConfirmation(target: Member | "leave") {
    setChangeError(null);
    setConfirm(target);
    dialog.current?.showModal();
  }

  async function changeMembership() {
    if (!confirm || changing) return;
    const leaving = confirm === "leave";
    const path = leaving ? "leave" : `members/${encodeURIComponent(confirm.id)}/transfer`;
    setChanging(true);
    setChangeError(null);
    const result = await postJson<{ status: string }>(`${base}/${path}`).catch(() => null);
    setChanging(false);
    if (result?.status === (leaving ? "left" : "transferred")) {
      dialog.current?.close();
      onChange();
      return;
    }
    setChangeError(result?.status === "owner_cannot_leave"
      ? "Transfiere la titularidad antes de salir."
      : result?.status === "limit_reached"
        ? "Esa persona ya administra el máximo de empresas."
        : result?.status === "not_found"
          ? "Esa persona ya no forma parte del equipo."
          : "No pudimos confirmar el cambio. Vuelve a intentarlo.");
  }

  const leaving = confirm === "leave";
  const changeDialog = (
    <dialog ref={dialog} aria-labelledby={dialogTitle} aria-describedby={dialogDescription}
      onCancel={(event) => { if (changing) event.preventDefault(); }}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg rounded-3xl border border-line bg-white p-5 shadow-elevated backdrop:bg-ink/40 sm:p-7">
      <div className="space-y-4">
        <h3 id={dialogTitle} className="text-2xl text-ink">{leaving ? "Salir de la empresa" : "Transferir titularidad"}</h3>
        <p id={dialogDescription} className="text-ink-2">{leaving
          ? `Perderás el acceso a ${company.name} y a sus gatos en WhatsApp. Para volver, necesitarás otra invitación.`
          : `${confirm?.name ?? ""} administrará Plan, cobros y Configuración, y podrá quitar miembros. Tú seguirás en ${company.name} como miembro sin esos permisos.`}</p>
        {changeError && <p role="alert" className="text-sm text-red-800">{changeError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus className="btn-secondary" disabled={changing} onClick={() => dialog.current?.close()}>Cancelar</button>
          <button type="button" className="btn-danger" disabled={changing} onClick={() => void changeMembership()}>
            {changing ? "Confirmando…" : leaving ? "Confirmar salida" : "Confirmar transferencia"}
          </button>
        </div>
      </div>
    </dialog>
  );

  async function invite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCopied(false);
    const digits = phone.trim() ? whatsappDigits(phone) : null;
    if (phone.trim() && !digits) return setError("Revisa el número: escribe los 9 dígitos del celular o el número con código de país.");
    setBusy(true);
    const result = await postJson<Created>(`${base}/invitations`, { access, ...(phone.trim() ? { phone } : {}) }).catch(() => null);
    setBusy(false);
    if (result?.status === "invited") {
      setCreated({ url: result.invitation.url, phone: digits });
      setPhone("");
      return load();
    }
    setError(result?.status === "invalid_phone"
      ? "Revisa el número de WhatsApp."
      : result?.status === "limit_reached"
        ? "Tienes 20 invitaciones abiertas. Anula alguna antes de crear otra."
        : "No pudimos crear la invitación. Inténtalo otra vez.");
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function revoke(id: string) {
    setConfirmRevoke(null);
    setListError(null);
    const result = await postJson<{ status: string }>(`${base}/invitations/${id}/revoke`).catch(() => null);
    if (result?.status !== "revoked") setListError("No pudimos anular la invitación. Inténtalo otra vez.");
    load();
  }

  async function remove(id: string) {
    setConfirmRemove(null);
    setListError(null);
    const result = await postJson<{ status: string }>(`${base}/members/${encodeURIComponent(id)}/remove`).catch(() => null);
    if (result?.status !== "removed") setListError("No pudimos quitar a esa persona del equipo. Inténtalo otra vez.");
    load();
  }

  const message = created
    ? `Hola, te invito a unirte a ${company.name} en MeowLab. Abre este enlace con tu cuenta (vence en 7 días): ${created.url}`
    : "";
  const whatsappUrl = created ? `https://wa.me/${created.phone ?? ""}?text=${encodeURIComponent(message)}` : "";

  if (company.role !== "owner") return (
    <section className="space-y-3" aria-labelledby={`team-${company.id}`}>
      <h3 id={`team-${company.id}`} className="text-xl text-ink">Tu membresía en {company.name}</h3>
      <button type="button" onClick={() => openConfirmation("leave")} className="btn-secondary text-red-800">Salir de la empresa</button>
      {changeDialog}
    </section>
  );

  return (
    <section className="space-y-6 rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8" aria-labelledby={`team-${company.id}`}>
      <div className="space-y-1">
        <h3 id={`team-${company.id}`} className="text-xl font-bold tracking-tight text-ink">Equipo de {company.name}</h3>
        <p className="text-ink-muted">Invita a tu equipo con un enlace que les mandas por WhatsApp. Cada enlace sirve para una persona.</p>
        <p className="text-sm text-ink-muted">Para salir de la empresa, primero transfiere la titularidad a un miembro.</p>
      </div>

      <form onSubmit={invite} className="space-y-4 rounded-2xl border border-line-mint bg-mint-light p-5">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-ink-2">Qué podrá hacer</legend>
          {(Object.keys(ACCESS) as Array<keyof typeof ACCESS>).map((key) => (
            <label
              key={key}
              className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-4 transition-colors ${
                access === key ? "border-forest" : "border-line hover:border-ink-muted"
              }`}
            >
              <input type="radio" name={`access-${company.id}`} value={key} checked={access === key} onChange={() => setAccess(key)}
                className="mt-1 accent-forest" />
              <span>
                <span className="block font-semibold text-ink">{ACCESS[key].label}</span>
                <span className="block text-sm text-ink-muted">{ACCESS[key].text}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1 space-y-1.5 sm:max-w-xs">
            <span className="text-sm font-semibold text-ink-2">WhatsApp de la persona (opcional)</span>
            <input className="field bg-white" type="tel" inputMode="tel" placeholder="987 654 321" value={phone}
              onChange={(e) => setPhone(e.target.value)} maxLength={32} aria-describedby={`phone-help-${company.id}`} />
          </label>
          <button type="submit" disabled={busy} className="btn-primary">{busy ? "Creando…" : "Crear enlace"}</button>
        </div>
        <p id={`phone-help-${company.id}`} className="text-sm text-ink-muted">
          Con número, solo una cuenta con ese WhatsApp vinculado podrá aceptarla.
        </p>
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      </form>

      {created && (
        <div className="space-y-3 rounded-2xl border border-line p-5" role="status">
          <p className="font-semibold text-ink">Enlace listo. Envíalo ahora: por seguridad no lo volveremos a mostrar.</p>
          <p className="break-all rounded-xl bg-surface-subtle px-4 py-3 font-mono text-sm text-ink-2">{created.url}</p>
          <div className="flex flex-wrap gap-3">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">Enviar por WhatsApp</a>
            <button type="button" onClick={copy} className="btn-secondary">{copied ? "Copiado" : "Copiar enlace"}</button>
          </div>
        </div>
      )}

      {loadFailed && <p className="text-sm text-ink-muted">No pudimos cargar tu equipo. Vuelve a intentarlo en unos minutos.</p>}
      {listError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{listError}</p>}
      {team && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h4 className="font-bold text-ink">Personas ({team.members.length})</h4>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {team.members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{member.name}{member.you ? " (tú)" : ""}</div>
                    <div className="truncate text-sm text-ink-muted">{member.email ?? "—"}</div>
                  </div>
                  {member.role === "owner" ? (
                    <span className="chip border border-line bg-surface-subtle text-ink-2">Titular</span>
                  ) : confirmRemove === member.id ? (
                    <span className="flex items-center gap-2">
                      <button type="button" onClick={() => void remove(member.id)} className="btn-danger min-h-11 px-3 py-2 text-sm"
                        aria-label={`Quitar a ${member.name} del equipo`}>Quitar</button>
                      <button type="button" onClick={() => setConfirmRemove(null)} className="btn-secondary min-h-11 px-3 py-2 text-sm">Cancelar</button>
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-x-3">
                      <button type="button" onClick={() => openConfirmation(member)} aria-label={`Transferir titularidad a ${member.name}`}
                        className="min-h-11 text-sm font-semibold text-forest underline-offset-4 hover:underline">Transferir titularidad</button>
                      <button type="button" onClick={() => setConfirmRemove(member.id)} aria-label={`Quitar a ${member.name} del equipo`}
                        className="min-h-11 text-sm font-semibold text-red-800 underline-offset-4 hover:underline">Quitar del equipo</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <h4 className="font-bold text-ink">Invitaciones abiertas ({team.invitations.length})</h4>
            {team.invitations.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-ink-muted">No hay invitaciones pendientes.</p>
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {team.invitations.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="font-semibold text-ink">{invitation.maskedPhone ?? "Cualquier cuenta"}</div>
                      <div className="text-sm text-ink-muted">
                        {ACCESS[invitation.access].label} · vence el {shortDate(invitation.expiresAt)}
                      </div>
                    </div>
                    {confirmRevoke === invitation.id ? (
                      <span className="flex items-center gap-2">
                        <button type="button" onClick={() => void revoke(invitation.id)} className="btn-danger min-h-11 px-3 py-2 text-sm">Anular enlace</button>
                        <button type="button" onClick={() => setConfirmRevoke(null)} className="btn-secondary min-h-11 px-3 py-2 text-sm">Cancelar</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmRevoke(invitation.id)}
                        aria-label={`Anular la invitación ${invitation.maskedPhone ? `para ${invitation.maskedPhone}` : "abierta"}`}
                        className="min-h-11 text-sm font-semibold text-red-800 underline-offset-4 hover:underline">Anular</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {changeDialog}
    </section>
  );
}
