"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { NavBar } from "@/components/ui/NavBar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

// Internal showcase/verification page for the design-system foundation
// (tokens + theme + primitives) — not a real product page, no i18n
// wiring, no gating (the app is pre-launch). Doubles as: a shareholder
// demo of the foundation ahead of the homepage slice, and the visual
// harness for the Cyrillic-rendering and theme-precedence checks in the
// implementation plan. Bulgarian sample text is a pangram (covers every
// Cyrillic letter, including the trickier ones: щ ъ ь ю я ж ц ч ш).
const PANGRAM_BG = "Ах, чудна българска земьо, полюшквай цъфтящи жита.";

const TYPE_SCALE: { token: string; cssVar: string }[] = [
  { token: "display-xl", cssVar: "--text-display-xl" },
  { token: "display-lg", cssVar: "--text-display-lg" },
  { token: "display-md", cssVar: "--text-display-md" },
  { token: "display-sm", cssVar: "--text-display-sm" },
  { token: "heading-lg", cssVar: "--text-heading-lg" },
  { token: "heading-md", cssVar: "--text-heading-md" },
  { token: "heading-sm", cssVar: "--text-heading-sm" },
  { token: "body-lg", cssVar: "--text-body-lg" },
  { token: "body-md", cssVar: "--text-body-md" },
  { token: "body-sm", cssVar: "--text-body-sm" },
  { token: "label", cssVar: "--text-label" },
  { token: "caption", cssVar: "--text-caption" },
  { token: "mono-sm", cssVar: "--text-mono-sm" },
];

const COLOR_SWATCHES: { label: string; cssVar: string }[] = [
  { label: "bg-page", cssVar: "--bg-page" },
  { label: "bg-surface", cssVar: "--bg-surface" },
  { label: "bg-surface-2", cssVar: "--bg-surface-2" },
  { label: "bg-sunken", cssVar: "--bg-sunken" },
  { label: "bg-inverse", cssVar: "--bg-inverse" },
  { label: "accent", cssVar: "--accent" },
  { label: "accent-subtle", cssVar: "--accent-subtle" },
];

export default function DesignSystemPage() {
  const [searchValue, setSearchValue] = useState("");
  const [chipSelected, setChipSelected] = useState(false);

  return (
    <div>
      <NavBar
        wordmark="Coaching Platform"
        links={["For clients", "For practitioners", "How it works"]}
        langToggle={<span style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>BG · EN</span>}
        actions={
          <>
            <Button variant="ghost" size="sm">Log in</Button>
            <Button variant="primary" size="sm">Sign up</Button>
          </>
        }
      />

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "var(--space-10) var(--space-6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-8)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>Design system foundation</h1>
          <ThemeToggle />
        </div>

        <section style={{ marginBottom: "var(--space-12)" }}>
          <h2 style={{ font: "var(--text-heading-md)" }}>Type scale (Cyrillic sample)</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {TYPE_SCALE.map(({ token, cssVar }) => (
              <div key={token} style={{ display: "flex", alignItems: "baseline", gap: "var(--space-4)" }}>
                <span
                  style={{
                    font: "var(--text-mono-sm)",
                    color: "var(--text-tertiary)",
                    width: 110,
                    flex: "none",
                  }}
                >
                  {token}
                </span>
                <span style={{ font: `var(${cssVar})` }}>{PANGRAM_BG}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: "var(--space-12)" }}>
          <h2 style={{ font: "var(--text-heading-md)" }}>Colors</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)" }}>
            {COLOR_SWATCHES.map(({ label, cssVar }) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <div
                  style={{
                    width: 96,
                    height: 64,
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-default)",
                    background: `var(${cssVar})`,
                  }}
                />
                <span style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: "var(--space-12)" }}>
          <h2 style={{ font: "var(--text-heading-md)" }}>Button</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {(["primary", "secondary", "ghost"] as const).map((variant) => (
              <div key={variant} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ font: "var(--text-caption)", color: "var(--text-tertiary)", width: 80 }}>{variant}</span>
                <Button variant={variant} size="sm">Small</Button>
                <Button variant={variant} size="md">Medium</Button>
                <Button variant={variant} size="lg">Large</Button>
                <Button variant={variant} disabled>Disabled</Button>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: "var(--space-12)" }}>
          <h2 style={{ font: "var(--text-heading-md)" }}>Input</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 480 }}>
            <Input placeholder="Имейл" helperText="Plain input, Bulgarian placeholder" />
            <Input
              search
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Търсете по име, направление или въпрос…"
              helperText="Search input variant"
              searchButtonLabel="Search"
            />
          </div>
        </section>

        <section style={{ marginBottom: "var(--space-12)" }}>
          <h2 style={{ font: "var(--text-heading-md)" }}>Card</h2>
          <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
            <div style={{ width: 320 }}>
              <Card
                eyebrow="For clients"
                title="Find clarity"
                description="Verified practitioners, real reviews."
                footer={<Button variant="secondary" size="sm">Learn more</Button>}
              />
            </div>
            <div style={{ width: 320 }}>
              <Card
                tone="inverse"
                eyebrow="For practitioners"
                title="Grow your practice"
                description="Reach more clients, manage bookings in one place."
                footer={<Button variant="primary" size="sm">Get started</Button>}
              />
            </div>
          </div>
        </section>

        <section style={{ marginBottom: "var(--space-12)" }}>
          <h2 style={{ font: "var(--text-heading-md)" }}>Chip</h2>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <Chip selected={chipSelected} onClick={() => setChipSelected((s) => !s)}>
              Toggle me
            </Chip>
            <Chip selected={false}>Unselected</Chip>
            <Chip selected>Selected</Chip>
          </div>
        </section>
      </main>
    </div>
  );
}
