import type { ReactNode } from "react";
import { agentLogo, type AgentKey } from "./agents";

export type PageHeaderProps = {
  /** Top-row back link on agent detail pages. */
  onBack?: () => void;
  /** Label shown in the fixed-height top row on general pages (e.g. active company or today's date). */
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  agent?: AgentKey;
  /** Optional right-aligned actions (e.g. export button or date range). */
  actions?: ReactNode;
};

/**
 * Standard portal page header with a fixed-height top row so `h1` always sits at the
 * same vertical distance from the top edge across general and agent pages.
 */
export function PageHeader({ onBack, eyebrow, title, subtitle, agent, actions }: PageHeaderProps) {
  return (
    <header className="space-y-1.5">
      <div className="flex h-6 items-center">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 -my-2.5 items-center gap-1 text-sm font-semibold text-forest underline-offset-4 hover:underline"
          >
            <span aria-hidden="true">←</span> Tus agentes
          </button>
        ) : eyebrow ? (
          <p className="truncate text-sm font-semibold text-forest">{eyebrow}</p>
        ) : (
          <span aria-hidden="true" className="block h-6" />
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-ink">
            {agent && (
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-mint">
                <img
                  src={agentLogo(agent)}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 mix-blend-multiply"
                  decoding="async"
                />
              </span>
            )}
            <span>{title}</span>
          </h1>
          {subtitle && <p className="text-lg text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
