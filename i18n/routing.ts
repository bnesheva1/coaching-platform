import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["bg", "en"],
  defaultLocale: "bg",
  // Every URL always carries its locale explicitly (/bg/..., /en/...) —
  // no ambiguity about which locale an unprefixed URL means, and this
  // scales cleanly if a third locale is added later.
  localePrefix: "always",
});
