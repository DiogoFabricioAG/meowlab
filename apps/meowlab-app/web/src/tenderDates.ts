const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

export function formatWeekRange(start?: string | null, end?: string | null): string | null {
  const s = typeof start === "string" ? ISO_DAY_RE.exec(start.trim()) : null;
  const e = typeof end === "string" ? ISO_DAY_RE.exec(end.trim()) : null;
  if (!s || !e) return null;
  return `Semana del ${s[3]}/${s[2]} al ${e[3]}/${e[2]}`;
}

export function formatDeadline(raw?: string | null): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (ISO_DAY_RE.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("es-PE", { day: "numeric", month: "short", timeZone: "UTC" });
    }
  }
  if (ISO_DATETIME_RE.test(value)) {
    const parsed = new Date(value.replace(" ", "T"));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("es-PE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Lima",
      });
    }
  }
  return value;
}
