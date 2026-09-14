// Low-rating alert — unit verification of the threshold decision (the
// app-specific logic behind the low_rating alert createReview raises). The alert
// plumbing itself is the proven raiseAlert + push gate. Run: node scripts/verify-low-rating.ts
import { isLowRating, notifyLowRating } from "../lib/reviews/lowRating.ts";

let failures = 0;
const check = (label: string, cond: boolean) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
};

// Default threshold = 1 (only 1★ pings).
check("1★ → alert (default threshold)", isLowRating(1) === true);
check("2★ → no alert (default threshold)", isLowRating(2) === false);
check("3★ → no alert", isLowRating(3) === false);
check("5★ → no alert", isLowRating(5) === false);

// Explicit threshold override (e.g. widen to <= 2).
check("threshold 2: 1★ → alert", isLowRating(1, 2) === true);
check("threshold 2: 2★ → alert (boundary inclusive)", isLowRating(2, 2) === true);
check("threshold 2: 3★ → no alert", isLowRating(3, 2) === false);

// Robustness.
check("NaN → no alert", isLowRating(Number.NaN) === false);

// notifyLowRating: the actual createReview wiring, with a mocked raise. Asserts
// it fires exactly once with the right booking/practitioner/rating on a low
// rating, and not at all otherwise.
await (async () => {
  type RaiseInput = { type: string; subject: string; context: Record<string, unknown> };
  let calls: RaiseInput[] = [];
  const mockRaise = async (input: RaiseInput) => { calls.push(input); };

  const raised = await notifyLowRating({ rating: 1, bookingId: "bk_1", practitionerId: "pr_1", hasText: true }, mockRaise);
  check("low rating: notifyLowRating returns true", raised === true);
  check("low rating: raise invoked exactly once", calls.length === 1);
  check("low rating: raise type = low_rating", calls[0]?.type === "low_rating");
  check("low rating: raise subject = bookingId", calls[0]?.subject === "bk_1");
  check("low rating: context carries practitionerId", calls[0]?.context?.practitionerId === "pr_1");
  check("low rating: context carries rating", calls[0]?.context?.rating === 1);

  calls = [];
  const raised2 = await notifyLowRating({ rating: 4, bookingId: "bk_2", practitionerId: "pr_2", hasText: false }, mockRaise);
  check("normal rating: notifyLowRating returns false", raised2 === false);
  check("normal rating: raise NOT invoked", calls.length === 0);
})();

console.log(`\n=== ${failures === 0 ? "ALL PASSED" : failures + " FAILED"} ===`);
process.exit(failures === 0 ? 0 : 1);
