// Initials for a default (imageless) avatar. One word → its first letter; more
// than one word → the first letter plus the first letter of the second word (the
// character after the first whitespace). Empty name → "?".
//   "Ирина"        → "И"
//   "Ирина Колева" → "ИК"
//   "Мария Ана Петрова" → "МА"
export function initialsFromName(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}
