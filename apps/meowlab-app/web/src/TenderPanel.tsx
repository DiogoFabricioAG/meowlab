import { useCallback, useEffect, useState } from "react";
import type { Weekly } from "./agents";
import { TenderPreferences } from "./TenderPreferences";
import { tenderApi, TenderApiError, type TenderOpportunity } from "./tenderApi";
import { TenderList } from "./TenderList";
import { TenderCase, type TenderHighlight, type TenderWorkspaceStage } from "./TenderCase";

function readHashParams(): { id: string | null; stage: TenderWorkspaceStage } {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const rawStage = params.get("vista");
  const stage: TenderWorkspaceStage = rawStage === "quote" || rawStage === "documents" ? rawStage : "bases";
  return { id: params.get("licitacion"), stage };
}

function highlightFromOpportunity(op: TenderOpportunity): TenderHighlight {
  return {
    ocid: op.alert.ocid ?? op.id,
    description: op.alert.description,
    displayTitle: op.alert.displayTitle ?? undefined,
    buyer: op.alert.buyer,
    deadline: op.alert.deadline,
    amount: op.alert.amount,
    sourceUrl: op.alert.sourceUrl,
    interesting: op.selection === "interesting",
  };
}

export function TenderPanel({
  weekly,
  companyId,
  failed,
  onBack,
}: {
  weekly: Weekly | null;
  companyId: string;
  failed: boolean;
  onBack: () => void;
}) {
  const [{ id, stage }, setNav] = useState(readHashParams);
  // Earlier bridge versions supply a weekly summary without opportunity IDs.
  const [legacyItem, setLegacyItem] = useState<TenderHighlight | null>(null);
  const [opportunities, setOpportunities] = useState<TenderOpportunity[]>([]);
  const [loadingOpps, setLoadingOpps] = useState(true);
  const [oppsError, setOppsError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [hiddenBusyId, setHiddenBusyId] = useState<string | null>(null);
  const [hiddenError, setHiddenError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    const update = () => {
      setLegacyItem(null);
      setNav(readHashParams());
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingOpps(true);
    setOppsError("");
    void tenderApi<{ opportunities?: TenderOpportunity[] }>(companyId, "/opportunities", {
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted) return;
        setOpportunities(Array.isArray(res.opportunities) ? res.opportunities : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setOppsError("No pudimos cargar los expedientes guardados.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingOpps(false);
      });
    return () => controller.abort();
  }, [companyId, reloadTick]);

  const updateHash = useCallback((nextId: string | null, nextStage: TenderWorkspaceStage = "bases") => {
    const url = new URL(window.location.href);
    if (nextId) {
      const params = new URLSearchParams({ licitacion: nextId });
      if (nextStage !== "bases") params.set("vista", nextStage);
      url.hash = params.toString();
    } else {
      url.hash = "";
    }
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    setNav({ id: nextId, stage: nextStage });
  }, []);

  function openHighlight(item: TenderHighlight | null) {
    updateHash(item?.ocid ?? null, "bases");
    setLegacyItem(item?.ocid ? null : item);
    window.scrollTo(0, 0);
  }

  function openOpportunity(op: TenderOpportunity) {
    const key = op.alert.ocid ?? op.id;
    updateHash(key, "bases");
    setLegacyItem(null);
    window.scrollTo(0, 0);
  }

  function handleOpportunityUpdated(updated: TenderOpportunity) {
    setOpportunities((prev) => {
      const exists = prev.some((op) => op.id === updated.id);
      return exists ? prev.map((op) => (op.id === updated.id ? updated : op)) : [updated, ...prev];
    });
  }

  async function handleToggleHidden(op: TenderOpportunity) {
    setHiddenBusyId(op.id);
    setHiddenError("");
    try {
      const updated = await tenderApi<TenderOpportunity>(
        companyId,
        `/opportunities/${encodeURIComponent(op.id)}`,
        {
          method: "PUT",
          body: {
            notes: op.work?.notes ?? "",
            document: op.work?.document ?? "",
            quotes: op.work?.quotes ?? [],
            documentEdits: op.work?.documentEdits ?? {},
            checklist: op.work?.checklist ?? [],
            version: op.version,
            hidden: !op.hidden,
          },
        },
      );
      handleOpportunityUpdated(updated);
    } catch (e) {
      if (e instanceof TenderApiError && e.status === 409) {
        setHiddenError("Este expediente se actualizó en otro lugar. Recargamos los datos.");
        setReloadTick((n) => n + 1);
      } else {
        setHiddenError(e instanceof Error ? e.message : "No se pudo actualizar el estado del expediente.");
      }
    } finally {
      setHiddenBusyId(null);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError("");
    try {
      await tenderApi(companyId, "/sync", { method: "POST" });
      const res = await tenderApi<{ opportunities?: TenderOpportunity[] }>(companyId, "/opportunities");
      setOpportunities(Array.isArray(res.opportunities) ? res.opportunities : []);
      setOppsError("");
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "No se pudo sincronizar las convocatorias.");
    } finally {
      setSyncing(false);
    }
  }

  const matchedOpportunity = id
    ? opportunities.find((op) => op.alert.ocid === id || op.id === id) ?? null
    : null;

  const weeklyItem = weekly && id
    ? weekly.tender.highlights.find((row) => row.ocid === id) ?? null
    : null;

  const item: TenderHighlight | null =
    weeklyItem
    ?? legacyItem
    ?? (matchedOpportunity ? highlightFromOpportunity(matchedOpportunity) : null);

  if (!item) {
    const stillResolving = Boolean(id && ((!weekly && !failed) || loadingOpps));
    if (stillResolving) {
      return (
        <div className="space-y-4" aria-busy="true" aria-label="Cargando licitación">
          <div className="h-24 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
          <div className="h-48 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
        </div>
      );
    }
    return (
      <>
        {id && (weekly || failed) && (
          <p role="status" className="mb-4 text-ink-muted">
            Esta convocatoria ya no figura entre las destacadas ni guardadas de tu empresa.
          </p>
        )}
        <TenderList
          weekly={weekly}
          weeklyFailed={failed}
          savedOpportunities={opportunities}
          opportunitiesError={oppsError}
          onReloadOpportunities={() => setReloadTick((n) => n + 1)}
          onSelect={openHighlight}
          onSelectOpportunity={openOpportunity}
          onToggleHidden={handleToggleHidden}
          hiddenBusyId={hiddenBusyId}
          hiddenError={hiddenError}
          onBack={onBack}
        />
        {weekly?.tender.enabled && <TenderPreferences key={companyId} company={companyId} />}
      </>
    );
  }

  return (
    <TenderCase
      key={matchedOpportunity?.id ?? item.ocid ?? item.description}
      companyId={companyId}
      item={item}
      opportunity={matchedOpportunity}
      loadingOpportunity={loadingOpps}
      opportunityError={oppsError}
      stage={stage}
      onStageChange={(nextStage) => updateHash(id, nextStage)}
      onBack={() => openHighlight(null)}
      onOpportunityUpdated={handleOpportunityUpdated}
      onReloadOpportunity={() => setReloadTick((tick) => tick + 1)}
      onToggleHidden={handleToggleHidden}
      hiddenBusy={Boolean(matchedOpportunity && hiddenBusyId === matchedOpportunity.id)}
      hiddenError={hiddenError}
      onSync={handleSync}
      syncing={syncing}
      syncError={syncError}
    />
  );
}
