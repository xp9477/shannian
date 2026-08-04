/** Title helpers: shell detection, short topic placeholders, merge rules. */

/** Hard cap for list-friendly titles (精炼短摘要) */
export const TITLE_MAX_CHARS = 28;

const SHELL_TITLE_PATTERNS: RegExp[] = [
  /^https?:\/\//i,
  /\bon\s+X\s*$/i,
  /\bon\s+Twitter\s*$/i,
  /\(\s*@[^)]+\)\s*on\s+X\s*$/i,
  /^X\s*\(formerly\s+Twitter\)\s*$/i,
  /^Twitter\s*$/i,
  /^x\.com$/i,
  /^twitter\.com$/i,
  /^t\.co$/i,
];

/** Platform / og shell titles that must never stay as card titles. */
export function isShellTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const t = title.trim();
  if (!t) return true;
  if (SHELL_TITLE_PATTERNS.some((re) => re.test(t))) return true;
  // Bare "@handle" or "Display (@handle)" with almost no content words
  if (/^@[\w]+$/i.test(t)) return true;
  if (/^[^:]{1,40}\s\(@[\w]+\)\s*$/i.test(t) && t.length < 48) return true;
  return false;
}

/** Site names wrongly stored as author (og:site_name etc.). */
export function isShellAuthor(author: string | null | undefined): boolean {
  if (!author) return true;
  const a = author.trim();
  if (!a) return true;
  if (/^X\s*\(formerly\s+Twitter\)\s*$/i.test(a)) return true;
  if (/^(X|Twitter|x\.com|twitter\.com)$/i.test(a)) return true;
  return false;
}

/** Prefer @screen_name form. */
export function normalizeXHandle(screenName: string | null | undefined): string | null {
  if (!screenName) return null;
  const s = screenName.trim().replace(/^@+/, "");
  if (!s || !/^[\w]+$/.test(s)) return null;
  return `@${s}`;
}

/** Try `@handle` from og-style "Name (@handle) on X". */
export function handleFromShellTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = title.match(/@([A-Za-z0-9_]+)/);
  return m ? normalizeXHandle(m[1]) : null;
}

/**
 * Collapse whitespace, strip t.co / bare URLs, take a short head for placeholder titles.
 */
export function placeholderTitleFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  let t = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  // Drop leading @mentions / hashtag-only noise at start (keep content after)
  t = t.replace(/^(?:[@#][\w\u4e00-\u9fff]+\s+)+/u, "").trim() || t;
  if (t.length <= TITLE_MAX_CHARS) return t;
  // Prefer cut at punctuation / space near the limit
  const slice = t.slice(0, TITLE_MAX_CHARS);
  const breakAt = Math.max(
    slice.lastIndexOf("，"),
    slice.lastIndexOf("。"),
    slice.lastIndexOf("、"),
    slice.lastIndexOf(" "),
    slice.lastIndexOf("："),
    slice.lastIndexOf(":")
  );
  if (breakAt >= Math.floor(TITLE_MAX_CHARS * 0.5)) {
    return slice.slice(0, breakAt).trim();
  }
  return slice.trim();
}

/** Clamp AI or user-facing titles to the hard cap. */
export function clampTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= TITLE_MAX_CHARS) return t;
  return t.slice(0, TITLE_MAX_CHARS).trim();
}

/**
 * Merge fetch/AI title into existing.
 * - force: prefer incoming (non-shell) then rule placeholder
 * - preferIncoming: AI 精炼标题始终覆盖正文截断/原标题占位
 * - else: only replace empty/shell existing
 */
export function mergeTitle(opts: {
  existing: string | null | undefined;
  incoming: string | null | undefined;
  ruleFromBody?: string | null;
  force?: boolean;
  /** When true (AI path), non-shell incoming always wins over body dump / og title */
  preferIncoming?: boolean;
}): string | null {
  const rule =
    placeholderTitleFromText(opts.ruleFromBody) || clampTitle(opts.ruleFromBody);
  const incoming =
    opts.incoming && !isShellTitle(opts.incoming) ? clampTitle(opts.incoming) : null;
  const bestNew = incoming || rule || null;

  if (opts.force) {
    return bestNew || (opts.existing && !isShellTitle(opts.existing) ? opts.existing : bestNew);
  }
  if (opts.preferIncoming && incoming) {
    return incoming;
  }
  if (!opts.existing || isShellTitle(opts.existing)) {
    return bestNew || opts.existing || null;
  }
  return opts.existing;
}

/**
 * Pick list/detail headline after AI: 精炼 title，否则从 summary 截短，再否则正文占位。
 */
export function titleFromAi(opts: {
  existing: string | null | undefined;
  aiTitle: string | null | undefined;
  aiSummary: string | null | undefined;
  ruleFromBody?: string | null;
  force?: boolean;
}): string | null {
  const fromAi =
    (opts.aiTitle && !isShellTitle(opts.aiTitle) ? clampTitle(opts.aiTitle) : null) ||
    placeholderTitleFromText(opts.aiSummary) ||
    clampTitle(opts.aiSummary);
  if (fromAi) return fromAi;
  return mergeTitle({
    existing: opts.existing,
    incoming: null,
    ruleFromBody: opts.ruleFromBody,
    force: opts.force,
  });
}

export function mergeAuthor(opts: {
  existing: string | null | undefined;
  incoming: string | null | undefined;
  force?: boolean;
}): string | null {
  const incoming =
    opts.incoming && !isShellAuthor(opts.incoming) ? opts.incoming.trim() : null;
  if (opts.force) {
    return incoming || (opts.existing && !isShellAuthor(opts.existing) ? opts.existing : incoming);
  }
  if (!opts.existing || isShellAuthor(opts.existing)) {
    return incoming || opts.existing || null;
  }
  return opts.existing;
}
