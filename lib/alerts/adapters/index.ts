import type { AlertAdapter } from "../types";
import { telegramAdapter } from "./telegram";

// THE list of delivery adapters. A future team setup could run several at once
// (Telegram + Slack); adding Slack is one line here — `slackAdapter()` — and
// no call site anywhere else changes. Unconfigured adapters return null and
// drop out; an empty list is fine (alerts still record to the dashboard).
export function getAdapters(): AlertAdapter[] {
  return [telegramAdapter()].filter((a): a is AlertAdapter => a !== null);
}
