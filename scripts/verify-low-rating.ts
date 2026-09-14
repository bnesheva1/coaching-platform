// Low-rating alert — unit verification of the threshold decision (the
// app-specific logic behind the low_rating alert createReview raises). The alert
// plumbing itself is the proven raiseAlert + push gate. Run: node scripts/verify-low-rating.ts
import { isLowRating } from "../lib/reviews/lowRating.ts";

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

console.log(`\n=== ${failures === 0 ? "ALL PASSED" : failures + " FAILED"} ===`);
process.exit(failures === 0 ? 0 : 1);
