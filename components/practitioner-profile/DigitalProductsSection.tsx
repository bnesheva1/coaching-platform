"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { MonitorPlay, FileText, Lock, Download } from "lucide-react";
import { MediaModal, type MediaItem } from "./MediaModal";
import { Button } from "@/components/ui/Button";
import { purchaseContentItem, type ContentActionState } from "@/app/[locale]/practitioner-dashboard/content-actions";
import styles from "./DigitalProductsSection.module.css";

// A purchased VIDEO item carries a server-built embedUrl (resolved via
// get_purchased_content_item on the server for the entitled buyer only) — never
// present for a non-purchaser, so the id/embed never reaches an unentitled page.
export type ProfileContentItem = {
  id: string;
  type: "video_youtube" | "pdf";
  title: string;
  description: string | null;
  priceCents: number;
  currency: string;
  purchased: boolean;
  embedUrl?: string | null;
};

function formatPrice(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === "bg" ? "bg-BG" : "en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}

function ProceedButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" disabled={disabled || pending}>
      {label}
    </Button>
  );
}

// The buy confirm-dialog: price + the required consent checkbox (14-day
// withdrawal waiver). Proceed is disabled until consent is checked; the server
// action hard-gates on it too. Submitting redirects to Stripe Checkout.
function BuyDialog({ item, username, price, onClose }: { item: ProfileContentItem; username: string; price: string; onClose: () => void }) {
  const t = useTranslations("DigitalProducts");
  const [consented, setConsented] = useState(false);
  const [state, formAction] = useActionState<ContentActionState, FormData>((prev, fd) => purchaseContentItem(prev, fd), null);

  return (
    <div className={styles.dialogScrim} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t("buyTitle")} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.dialogTitle}>{item.title}</h3>
        <p className={styles.dialogPrice}>{price}</p>
        <form action={formAction} className={styles.dialogForm}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="username" value={username} />
          <label className={styles.consentRow}>
            <input type="checkbox" name="consent" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
            <span className={styles.consentText}>{t("consentText")}</span>
          </label>
          {state?.error && <p className={styles.error}>{state.error}</p>}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              {t("cancel")}
            </button>
            <ProceedButton label={t("proceedToPayment", { price })} disabled={!consented} />
          </div>
        </form>
      </div>
    </div>
  );
}

export function DigitalProductsSection({ items, username }: { items: ProfileContentItem[]; username: string }) {
  const t = useTranslations("DigitalProducts");
  const locale = useLocale();
  const [watch, setWatch] = useState<ProfileContentItem | null>(null);
  const [buy, setBuy] = useState<ProfileContentItem | null>(null);

  if (!items || items.length === 0) return null;

  const modalItems: MediaItem[] = watch?.embedUrl ? [{ type: "iframe", src: watch.embedUrl, title: watch.title }] : [];

  return (
    <section id="digital-products">
      <h2 style={{ margin: "0 0 12px", font: "var(--text-heading-lg)", color: "var(--text-primary)" }}>{t("sectionTitle")}</h2>
      <div className={styles.grid}>
        {items.map((item) => {
          const Icon = item.type === "video_youtube" ? MonitorPlay : FileText;
          const price = formatPrice(item.priceCents, item.currency, locale);
          return (
            <div key={item.id} className={styles.tile}>
              <div className={styles.cover} aria-hidden="true">
                <Icon size={40} strokeWidth={1.5} />
                {!item.purchased && (
                  <span className={styles.lockBadge}>
                    <Lock size={13} />
                  </span>
                )}
              </div>
              <div className={styles.body}>
                <h3 className={styles.title}>{item.title}</h3>
                {item.description && <p className={styles.desc}>{item.description}</p>}
                <div className={styles.footer}>
                  {item.purchased ? (
                    item.type === "video_youtube" ? (
                      <Button variant="secondary" size="sm" onClick={() => setWatch(item)}>
                        {t("watch")}
                      </Button>
                    ) : (
                      <a className={styles.downloadLink} href={`/api/content/${item.id}/download`}>
                        <Download size={15} /> {t("download")}
                      </a>
                    )
                  ) : (
                    <Button variant="primary" size="sm" onClick={() => setBuy(item)}>
                      {t("buy", { price })}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <MediaModal items={modalItems} index={0} open={!!watch} onClose={() => setWatch(null)} onIndexChange={() => {}} />
      {buy && <BuyDialog item={buy} username={username} price={formatPrice(buy.priceCents, buy.currency, locale)} onClose={() => setBuy(null)} />}
    </section>
  );
}
