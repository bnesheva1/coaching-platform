// Pure text-splitting, no JSX — delivery info is free text that may or
// may not contain a URL ("Zoom: https://... or call +359..."), and the
// two places that render it (React Email templates, the client
// dashboard) use different link components (@react-email/components'
// Link vs a plain <a>), so this only produces the split, not the
// rendering. Each caller maps the segments into its own JSX.
export type TextSegment = { type: "text"; value: string } | { type: "url"; value: string };

// http(s):// only, deliberately — a bare "example.com" or an email
// address in the free text stays plain text rather than being guessed
// at; the practitioner can paste a full URL if they want it clickable.
const URL_PATTERN = /https?:\/\/[^\s]+/g;

export function splitTextAndUrls(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    segments.push({ type: "url", value: match[0] });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}
