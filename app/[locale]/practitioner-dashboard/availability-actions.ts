"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

// Plain async functions, not (prevState, formData) actions bound to a
// <form> — every write here carries a structured array (one day's
// ranges, or a list of target days), which has no clean FormData
// encoding. Called directly from the client (`await setDayAvailability(...)`),
// same as any other Server Action; the calling component manages its
// own pending/error state locally instead of via useActionState.
export type AvailabilityActionResult = { error: string } | { success: true };

export type TimeRange = { start: string; end: string };

const MIN_DURATION_MINUTES = 15;

// Validated independently of the <select> elements' own constrained
// option lists — those make an off-grid choice unreachable through the
// UI, but a direct call bypassing the browser entirely still has to be
// rejected here, and the DB's own sane-range constraint is the final
// backstop either way.
const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

function timeToMinutes(value: string): number | null {
  const match = TIME_FORMAT.exec(value);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function rangeErrorCode(range: TimeRange): "invalidTime" | "invalidGrid" | "endBeforeStart" | "rangeTooShort" | null {
  const startMinutes = timeToMinutes(range.start);
  const endMinutes = timeToMinutes(range.end);
  if (startMinutes === null || endMinutes === null) return "invalidTime";
  if (startMinutes % MIN_DURATION_MINUTES !== 0 || endMinutes % MIN_DURATION_MINUTES !== 0) return "invalidGrid";
  if (endMinutes <= startMinutes) return "endBeforeStart";
  if (endMinutes - startMinutes < MIN_DURATION_MINUTES) return "rangeTooShort";
  return null;
}

function isValidDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 7;
}

// The single write primitive behind per-row save AND both copy actions
// — replaces ALL of the given days' ranges with exactly `ranges` (delete
// then insert per day; see the module comment on why this isn't a real
// cross-statement DB transaction). An empty `ranges` array is a
// legitimate call: it clears every day in `days`.
//
// `ranges` always comes from the caller's own in-progress edit-form
// state, never re-read from the DB first — unlike a bulk write that
// might touch another user's data, this only ever writes rows the
// authenticated caller already owns (every day in `days`, scoped by
// practitioner_id below), so there's no bigger trust boundary being
// crossed by trusting the same already-validated ranges for one day
// vs. several. It's also the only correct choice semantically: "apply
// to weekdays" means "use exactly what's in the form right now," not
// "re-fetch whatever this day's last save happened to be."
export async function applyRangesToDays(ranges: TimeRange[], days: number[]): Promise<AvailabilityActionResult> {
  const t = await getTranslations("Availability");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("notLoggedIn") };

  const validDays = [...new Set(days.filter(isValidDay))];
  if (validDays.length === 0) return { error: t("invalidDay") };

  for (const range of ranges) {
    const code = rangeErrorCode(range);
    if (code === "invalidGrid" || code === "rangeTooShort") {
      return { error: t(code, { min: MIN_DURATION_MINUTES }) };
    }
    if (code) return { error: t(code) };
  }

  const { error: deleteError } = await supabase
    .from("practitioner_availability")
    .delete()
    .eq("practitioner_id", user.id)
    .in("day_of_week", validDays);
  if (deleteError) {
    console.error("applyRangesToDays: delete failed:", deleteError);
    return { error: t("saveFailed") };
  }

  if (ranges.length > 0) {
    const newRows = validDays.flatMap((day) =>
      ranges.map((r) => ({
        practitioner_id: user.id,
        day_of_week: day,
        start_time: r.start,
        end_time: r.end,
      })),
    );
    const { error: insertError } = await supabase.from("practitioner_availability").insert(newRows);
    if (insertError) {
      console.error("applyRangesToDays: insert failed:", insertError);
      return { error: t("saveFailed") };
    }
  }

  // "layout" — see the identical note elsewhere in this dashboard;
  // Начало's isBookable gate depends on this same table.
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

export type AvailabilityPresetKey = "weekdayDaytime" | "weekdayEvenings" | "weekends";

// The actual hours behind each preset live here, server-side, as fixed
// constants — never sent from the client. The client only names which
// preset it wants; this is what makes the write trustworthy regardless
// of what the button that triggered it happened to render. A day
// missing from a preset's map is deliberately cleared (see below) —
// "fills the whole week" means every day ends up in a known state, not
// just the days the pattern actually mentions.
const PRESETS: Record<AvailabilityPresetKey, Partial<Record<number, TimeRange[]>>> = {
  weekdayDaytime: {
    1: [{ start: "09:00", end: "17:00" }],
    2: [{ start: "09:00", end: "17:00" }],
    3: [{ start: "09:00", end: "17:00" }],
    4: [{ start: "09:00", end: "17:00" }],
    5: [{ start: "09:00", end: "17:00" }],
  },
  weekdayEvenings: {
    1: [{ start: "18:00", end: "21:00" }],
    2: [{ start: "18:00", end: "21:00" }],
    3: [{ start: "18:00", end: "21:00" }],
    4: [{ start: "18:00", end: "21:00" }],
    5: [{ start: "18:00", end: "21:00" }],
  },
  weekends: {
    6: [{ start: "10:00", end: "16:00" }],
    7: [{ start: "10:00", end: "16:00" }],
  },
};

export async function applyAvailabilityPreset(preset: AvailabilityPresetKey): Promise<AvailabilityActionResult> {
  const t = await getTranslations("Availability");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("notLoggedIn") };

  const pattern = PRESETS[preset];
  if (!pattern) return { error: t("invalidDay") };

  // Fills the whole week: every existing row for this practitioner is
  // replaced, not merged — a day the pattern doesn't mention ends up
  // cleared, same as one it does mention ends up with exactly that
  // pattern's hours. The confirmation dialog client-side is what guards
  // against calling this destructively; this function itself always
  // does the full replace once called.
  const { error: deleteError } = await supabase
    .from("practitioner_availability")
    .delete()
    .eq("practitioner_id", user.id);
  if (deleteError) {
    console.error("applyAvailabilityPreset: delete failed:", deleteError);
    return { error: t("saveFailed") };
  }

  const newRows = Object.entries(pattern).flatMap(([day, ranges]) =>
    (ranges ?? []).map((r) => ({
      practitioner_id: user.id,
      day_of_week: Number(day),
      start_time: r.start,
      end_time: r.end,
    })),
  );
  if (newRows.length > 0) {
    const { error: insertError } = await supabase.from("practitioner_availability").insert(newRows);
    if (insertError) {
      console.error("applyAvailabilityPreset: insert failed:", insertError);
      return { error: t("saveFailed") };
    }
  }

  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}
