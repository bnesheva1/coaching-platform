"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

// attribute="data-theme" matches the design tokens' own CSS selector
// ([data-theme="dark"] in app/tokens/colors.css) exactly.
// defaultTheme="system" + enableSystem = OS preference until the user
// makes an explicit choice, tracked live (not just read once at load).
// disableTransitionOnChange avoids a global color-transition flash the
// instant the theme attribute flips.
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
