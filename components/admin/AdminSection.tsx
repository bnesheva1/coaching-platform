"use client";

import { useState, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

// A collapsible admin section with URL-driven date filtering + pagination. The
// server owns the data (service-role) and renders the list into `children`; this
// only wraps it with the header toggle and the controls, navigating by patching
// query params (prefixed per section, so alerts and audit don't collide). Soft
// navigation preserves the collapse state across page/filter changes.
export function AdminSection({
  prefix,
  title,
  count,
  page,
  pageCount,
  children,
}: {
  prefix: string; // "alerts" | "audit" — namespaces this section's query params
  title: string;
  count: number;
  page: number;
  pageCount: number;
  children: ReactNode;
}) {
  const t = useTranslations("Admin");
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const from = searchParams.get(`${prefix}From`) ?? "";
  const to = searchParams.get(`${prefix}To`) ?? "";
  const hasFilter = from !== "" || to !== "";

  function navigate(patch: Record<string, string | null>) {
    const p = new URLSearchParams(Array.from(searchParams.entries()));
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function applyFilter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    navigate({
      [`${prefix}From`]: (fd.get("from") as string) || null,
      [`${prefix}To`]: (fd.get("to") as string) || null,
      [`${prefix}Page`]: null, // any filter change returns to page 1
    });
  }

  const headerBtn = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "var(--space-3)",
    width: "100%",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    color: "inherit",
    textAlign: "left" as const,
  };

  return (
    <section>
      <h2 style={{ margin: "0 0 var(--space-3)" }}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={headerBtn}>
          <span style={{ font: "var(--text-heading-sm)" }}>
            {title}
            {count > 0 && <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", marginLeft: "var(--space-2)" }}>({count})</span>}
          </span>
          <span aria-hidden="true" style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{open ? "▾" : "▸"}</span>
        </button>
      </h2>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <form onSubmit={applyFilter} style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "2px", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
              {t("filterFrom")}
              <input type="date" name="from" defaultValue={from} className="form-field" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "2px", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
              {t("filterTo")}
              <input type="date" name="to" defaultValue={to} className="form-field" />
            </label>
            <Button type="submit" variant="secondary" size="sm">{t("filterApply")}</Button>
            {hasFilter && (
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate({ [`${prefix}From`]: null, [`${prefix}To`]: null, [`${prefix}Page`]: null })}>
                {t("filterClear")}
              </Button>
            )}
          </form>

          {children}

          {pageCount > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", justifyContent: "flex-end" }}>
              <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => navigate({ [`${prefix}Page`]: String(page - 1) })}>
                {t("paginationPrev")}
              </Button>
              <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                {t("paginationPage", { page, total: pageCount })}
              </span>
              <Button type="button" variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => navigate({ [`${prefix}Page`]: String(page + 1) })}>
                {t("paginationNext")}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
