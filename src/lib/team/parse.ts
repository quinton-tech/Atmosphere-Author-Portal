/**
 * Pure parser for the atmospherepress.com "Our Team" page (Essential Addons filterable gallery).
 * Each member is a `.eael-filterable-gallery-item-wrap` with a photo, an <h2> name, a bold title,
 * and three labelled paragraphs. No DOM library: the markup is regular enough for careful regexes,
 * and a fixture test guards against drift.
 */

export type TeamMemberImport = {
  slug: string;
  name: string;
  title: string | null;
  departments: string[];
  photoUrl: string | null;
  whatIDo: string | null;
  background: string | null;
  whoIAm: string | null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#039": "'", "#39": "'", nbsp: " ", "#8217": "’", "#8216": "‘", "#8220": "“", "#8221": "”", "#8211": "–", "#8212": "—", hellip: "…" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e in ENTITIES) return ENTITIES[e];
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (/^#\d+$/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return m;
  });
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Largest image in a srcset, else the src. */
function bestImage(imgTag: string): string | null {
  const srcset = imgTag.match(/srcset="([^"]+)"/)?.[1];
  if (srcset) {
    const best = srcset
      .split(",")
      .map((c) => c.trim().split(/\s+/))
      .map(([url, w]) => ({ url, w: parseInt(w ?? "0", 10) || 0 }))
      .sort((a, b) => b.w - a.w)[0];
    if (best?.url) return best.url;
  }
  return imgTag.match(/\ssrc="([^"]+)"/)?.[1] ?? null;
}

function labelledParagraph(card: string, label: RegExp): string | null {
  const paras = card.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) ?? [];
  for (const p of paras) {
    const text = stripTags(p);
    if (label.test(text)) return text.replace(label, "").replace(/^[\s:]+/, "").trim() || null;
  }
  return null;
}

export function parseTeamPage(html: string): TeamMemberImport[] {
  const cards = html.split(/(?=<div class="eael-filterable-gallery-item-wrap)/).filter((c) => c.startsWith('<div class="eael-filterable-gallery-item-wrap'));
  const out: TeamMemberImport[] = [];
  for (const card of cards) {
    const name = stripTags(card.match(/<h2 class="fg-item-title">([\s\S]*?)<\/h2>/)?.[1] ?? "");
    if (!name) continue;
    const slug = card.match(/data-search-key="([^"]*)"/)?.[1] || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const departments = decodeEntities(card.match(/data-search-categories="([^"]*)"/)?.[1] ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const img = card.match(/<img\b[^>]*>/)?.[0];
    const content = card.match(/<div class="fg-item-content">([\s\S]*)$/)?.[1] ?? card;
    const title = stripTags(content.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? "") || null;
    out.push({
      slug,
      name,
      title,
      departments,
      photoUrl: img ? bestImage(img) : null,
      whatIDo: labelledParagraph(content, /^What I do for authors:?/i),
      background: labelledParagraph(content, /^What[’']s my background:?/i),
      whoIAm: labelledParagraph(content, /^Who I am:?/i),
    });
  }
  return out;
}

/** Normalise a person's name for matching against HubSpot owners: drop honorifics, punctuation, case. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|phd)\b\.?/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
