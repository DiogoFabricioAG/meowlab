import { useEffect, useState } from "react";
import type { Weekly } from "./agents";
import { TenderList } from "./TenderList";
import { TenderCase, type TenderHighlight, type TenderWorkspaceStage } from "./TenderCase";

function selectedId() {
  return new URLSearchParams(window.location.hash.slice(1)).get("licitacion");
}

export function TenderPanel({ weekly, companyId, failed, onBack }: {
  weekly: Weekly | null;
  companyId: string;
  failed: boolean;
  onBack: () => void;
}) {
  const [id, setId] = useState(selectedId);
  // Earlier bridge versions supply a weekly summary without opportunity IDs.
  const [legacyItem, setLegacyItem] = useState<TenderHighlight | null>(null);
  useEffect(() => {
    const update = () => {
      setLegacyItem(null);
      setId(selectedId());
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  function open(item: TenderHighlight | null) {
    const url = new URL(window.location.href);
    url.hash = item?.ocid ? new URLSearchParams({ licitacion: item.ocid }).toString() : "";
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    setId(item?.ocid ?? null);
    setLegacyItem(item?.ocid ? null : item);
    window.scrollTo(0, 0);
  }

  if (failed) {
    return (
      <section role="alert" className="space-y-3">
        <h1 className="text-3xl text-ink">Tender Cat</h1>
        <p>No pudimos cargar las licitaciones de tu empresa.</p>
        <button className="btn-secondary" onClick={() => window.location.reload()}>Reintentar</button>
      </section>
    );
  }

  const item = weekly
    ? weekly.tender.highlights.find(row => id && row.ocid === id) ?? legacyItem
    : null;
  if (!item) {
    return (
      <>
        {id && weekly && <p role="status" className="mb-4 text-ink-muted">Esta convocatoria ya no figura entre las destacadas de tu empresa.</p>}
        <TenderList weekly={weekly} onSelect={open} onBack={onBack} />
      </>
    );
  }

  function workspaceUrl(stage: TenderWorkspaceStage) {
    if (!item?.ocid || !item.interesting) return "";
    const params = new URLSearchParams({ empresa: companyId, licitacion: item.ocid, vista: stage });
    return `https://radar.meowlab.tech/?${params}`;
  }
  return <TenderCase item={item} onBack={() => open(null)} workspaceUrl={workspaceUrl} />;
}
