import type { Alert, AlertAdapter } from "../types";

// Telegram push adapter. Returns null (and is dropped from the adapter list)
// when TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't both set — so a deployment
// without Telegram configured still records alerts to the dashboard and
// nothing throws.
export function telegramAdapter(): AlertAdapter | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;

  return {
    name: "telegram",
    async deliver(alert: Alert) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: formatAlert(alert), parse_mode: "HTML" }),
      });
      if (!res.ok) {
        // Thrown so the seam logs which adapter failed; one adapter failing
        // never blocks the others or the dashboard record.
        throw new Error(`Telegram sendMessage ${res.status}: ${await res.text()}`);
      }
    },
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatAlert(alert: Alert): string {
  const ctx = Object.entries(alert.context)
    .map(([k, v]) => `${esc(k)}: ${esc(String(v))}`)
    .join("\n");
  const header = `<b>[${alert.severity.toUpperCase()}] ${esc(alert.type)}</b>`;
  return ctx ? `${header}\n${esc(alert.message)}\n\n${ctx}` : `${header}\n${esc(alert.message)}`;
}
