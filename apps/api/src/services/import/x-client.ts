/**
 * Unofficial X (Twitter) web client using auth_token + ct0.
 * Endpoints and GraphQL query IDs change without notice — keep delays conservative.
 * Outbound requests use project HTTP proxy when configured.
 */

import { outboundFetch } from "../../lib/http.js";

export interface XCredentials {
  authToken: string;
  ct0: string;
}

export interface XBookmarkItem {
  tweetId: string;
  url: string;
  text: string | null;
  authorName: string | null;
  authorScreenName: string | null;
  raw: unknown;
}

/** Public web client bearer (not a user secret). */
const WEB_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

/**
 * GraphQL query IDs rotate without notice.
 * Defaults synced from public web client dumps (2026-08); override via settings:
 *   x_bookmarks_query_id / x_delete_bookmark_query_id / x_tweet_result_query_id
 */
export const DEFAULT_BOOKMARKS_QUERY_ID = "aqjes8lRHRFG0HUglVTfNg";
export const DEFAULT_DELETE_BOOKMARK_QUERY_ID = "Wlmlj2-xzyS1GN3a6cj-mQ";
export const DEFAULT_VIEWER_QUERY_ID = "5XShkXk2oO2J7SYmTu6pvw";
export const DEFAULT_TWEET_RESULT_QUERY_ID = "LkId5Akr61BS6BmOIcffRg";

/** Feature flags for Bookmarks timeline (must match current web client roughly). */
const BOOKMARKS_FEATURES: Record<string, boolean> = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const VIEWER_FEATURES: Record<string, boolean> = {
  subscriptions_upsells_api_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildCookie(creds: XCredentials): string {
  return `auth_token=${creds.authToken}; ct0=${creds.ct0}`;
}

export async function xRequest(
  pathOrUrl: string,
  creds: XCredentials,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `https://x.com${pathOrUrl}`;
  const timeoutMs = init?.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await outboundFetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: WEB_BEARER,
        cookie: buildCookie(creds),
        "x-csrf-token": creds.ct0,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "en",
        "content-type": "application/json",
        accept: "*/*",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        ...(init?.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractScreenNameFromViewer(json: unknown): string | null {
  let found: string | null = null;
  function walk(node: unknown) {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const obj = node as Record<string, unknown>;
    const legacy = obj.legacy as Record<string, unknown> | undefined;
    if (typeof legacy?.screen_name === "string" && legacy.screen_name) {
      found = legacy.screen_name;
      return;
    }
    if (typeof obj.screen_name === "string" && obj.screen_name && !found) {
      // only accept if looks like a handle context (core/user)
      if (obj.__typename === "User" || obj.rest_id) found = obj.screen_name as string;
    }
    for (const v of Object.values(obj)) walk(v);
  }
  walk(json);
  return found;
}

/**
 * Cookie-auth verify via GraphQL Viewer (web client), then Bookmarks functional check.
 * Legacy 1.1 verify_credentials often 404s with cookie auth — not used as primary.
 */
export async function verifyXCredentials(creds: XCredentials): Promise<{ ok: boolean; message: string }> {
  let lastDetail = "";

  // 1) Viewer — confirms cookie session without depending on Bookmarks query id
  try {
    const params = new URLSearchParams({
      variables: JSON.stringify({ withCommunitiesMemberships: true }),
      features: JSON.stringify(VIEWER_FEATURES),
    });
    const url = `https://x.com/i/api/graphql/${DEFAULT_VIEWER_QUERY_ID}/Viewer?${params}`;
    const res = await xRequest(url, creds, { method: "GET" });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "凭证无效或已过期，请更新 auth_token / ct0" };
    }
    if (res.ok) {
      const json = await res.json();
      const screen = extractScreenNameFromViewer(json);
      // Still probe bookmarks so import path is validated
      try {
        const { getXQueryIds } = await import("./x-credentials.js");
        const qids = await getXQueryIds();
        const page = await fetchBookmarksPage(creds, {
          count: 5,
          queryId: qids.bookmarks || undefined,
        });
        return {
          ok: true,
          message: screen
            ? `已连接 @${screen}（书签本页 ${page.items.length} 条）`
            : `凭证有效（书签本页 ${page.items.length} 条）`,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "AUTH_FAILED") {
          return { ok: false, message: "凭证无效或已过期，请更新 auth_token / ct0" };
        }
        if (msg.includes("Query not found") || msg.includes("BOOKMARKS_HTTP_404")) {
          return {
            ok: true,
            message: screen
              ? `已连接 @${screen}（登录有效，但书签 Query ID 可能过期：${msg.slice(0, 100)}）`
              : `登录有效，但书签接口失败：${msg.slice(0, 120)}`,
          };
        }
        lastDetail = msg;
      }
      return {
        ok: true,
        message: screen ? `已连接 @${screen}` : "凭证有效（Viewer OK）",
      };
    }
    lastDetail = `Viewer HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`;
  } catch (e) {
    lastDetail = e instanceof Error ? e.message : String(e);
  }

  // 2) Bookmarks-only functional check
  try {
    const { getXQueryIds } = await import("./x-credentials.js");
    const qids = await getXQueryIds();
    const page = await fetchBookmarksPage(creds, {
      count: 5,
      queryId: qids.bookmarks || undefined,
    });
    return {
      ok: true,
      message: `凭证可用（书签接口 OK，本页 ${page.items.length} 条）`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "AUTH_FAILED") {
      return { ok: false, message: "凭证无效或已过期，请更新 auth_token / ct0" };
    }
    if (msg === "RATE_LIMITED") {
      return { ok: false, message: "X 限流，请稍后再试" };
    }
    if (msg.includes("Query not found") || msg.includes("BOOKMARKS_HTTP_404")) {
      return {
        ok: false,
        message:
          `书签 GraphQL Query ID 失效（Query not found）。请到设置写入最新 x_bookmarks_query_id，或更新应用默认值。详情：${msg.slice(0, 160)}` +
          (lastDetail ? ` / ${lastDetail.slice(0, 80)}` : ""),
      };
    }
    return {
      ok: false,
      message: `校验失败：${msg}${lastDetail ? ` / ${lastDetail.slice(0, 80)}` : ""}`,
    };
  }
}

function extractTweetsFromTimeline(json: unknown): XBookmarkItem[] {
  const items: XBookmarkItem[] = [];
  const seen = new Set<string>();

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const obj = node as Record<string, unknown>;

    // Tweet results shapes
    const result = obj.tweet_results as { result?: Record<string, unknown> } | undefined;
    const tweetResult = result?.result;
    if (tweetResult) {
      const legacy =
        (tweetResult.legacy as Record<string, unknown> | undefined) ||
        ((tweetResult.tweet as Record<string, unknown> | undefined)?.legacy as
          | Record<string, unknown>
          | undefined);
      const restId =
        (tweetResult.rest_id as string | undefined) ||
        (legacy?.id_str as string | undefined) ||
        ((tweetResult.tweet as Record<string, unknown> | undefined)?.rest_id as string | undefined);
      if (restId && legacy && !seen.has(restId)) {
        seen.add(restId);
        const { screen, name } = extractUserFromTweetResult(tweetResult);
        const text =
          (legacy.full_text as string) || (legacy.text as string) || null;
        const thumbnailUrl = extractThumbnailFromLegacy(legacy);
        items.push({
          tweetId: restId,
          url: screen
            ? `https://x.com/${screen}/status/${restId}`
            : `https://x.com/i/web/status/${restId}`,
          text,
          authorName: name,
          authorScreenName: screen,
          raw: { id: restId, text, user: screen, thumbnailUrl },
        });
      }
    }

    for (const v of Object.values(obj)) walk(v);
  }

  walk(json);
  return items;
}

function extractBottomCursor(json: unknown): string | null {
  let cursor: string | null = null;
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (
      obj.cursorType === "Bottom" &&
      typeof obj.value === "string" &&
      obj.value.length > 0
    ) {
      cursor = obj.value;
    }
    // entry content cursor
    if (
      obj.entryType === "TimelineTimelineCursor" &&
      (obj.cursorType === "Bottom" || obj.cursorType === "bottom") &&
      typeof obj.value === "string"
    ) {
      cursor = obj.value;
    }
    for (const v of Object.values(obj)) walk(v);
  }
  walk(json);
  return cursor;
}

export async function fetchBookmarksPage(
  creds: XCredentials,
  opts: {
    cursor?: string | null;
    count?: number;
    queryId?: string;
  } = {}
): Promise<{ items: XBookmarkItem[]; nextCursor: string | null; rawStatus: number }> {
  const queryId = opts.queryId || DEFAULT_BOOKMARKS_QUERY_ID;
  const variables: Record<string, unknown> = {
    count: opts.count ?? 20,
    includePromotedContent: false,
  };
  if (opts.cursor) variables.cursor = opts.cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(BOOKMARKS_FEATURES),
  });
  const url = `https://x.com/i/api/graphql/${queryId}/Bookmarks?${params}`;
  const res = await xRequest(url, creds, { method: "GET" });
  if (res.status === 429) {
    const err = new Error("RATE_LIMITED");
    (err as Error & { status: number }).status = 429;
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    const err = new Error("AUTH_FAILED");
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `BOOKMARKS_HTTP_${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`
    );
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  const json = await res.json();
  const items = extractTweetsFromTimeline(json);
  const nextCursor = extractBottomCursor(json);
  // If we got a cursor equal to request cursor, stop
  const next =
    nextCursor && nextCursor !== opts.cursor && items.length > 0 ? nextCursor : null;
  return { items, nextCursor: next, rawStatus: res.status };
}

export async function deleteBookmark(
  creds: XCredentials,
  tweetId: string,
  queryId?: string
): Promise<void> {
  const qid = queryId || DEFAULT_DELETE_BOOKMARK_QUERY_ID;
  const url = `https://x.com/i/api/graphql/${qid}/DeleteBookmark`;
  const res = await xRequest(url, creds, {
    method: "POST",
    body: JSON.stringify({
      variables: { tweet_id: tweetId },
      queryId: qid,
    }),
  });
  if (res.status === 429) throw new Error("RATE_LIMITED");
  if (res.status === 401 || res.status === 403) throw new Error("AUTH_FAILED");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DELETE_BOOKMARK_HTTP_${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseMs?: number }
): Promise<T> {
  const retries = opts?.retries ?? 4;
  const baseMs = opts?.baseMs ?? 2000;
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "RATE_LIMITED" && !msg.includes("429")) throw e;
      await sleep(baseMs * Math.pow(2, i) + Math.random() * 500);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const TWEET_RESULT_FEATURES: Record<string, boolean> = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  rweb_cashtags_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

export function parseTweetIdFromUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const m = u.pathname.match(/\/status(?:es)?\/(\d+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Pull screen_name / name from nested User / user_results shapes (X GQL changes often). */
function extractUserFromTweetResult(tweetResult: Record<string, unknown>): {
  screen: string | null;
  name: string | null;
} {
  const tryUser = (u: Record<string, unknown> | null | undefined) => {
    if (!u) return { screen: null as string | null, name: null as string | null };
    const legacy = u.legacy as Record<string, unknown> | undefined;
    const core = u.core as Record<string, unknown> | undefined;
    const screen =
      (legacy?.screen_name as string | undefined) ||
      (core?.screen_name as string | undefined) ||
      (u.screen_name as string | undefined) ||
      null;
    const name =
      (legacy?.name as string | undefined) ||
      (core?.name as string | undefined) ||
      (u.name as string | undefined) ||
      null;
    return { screen, name };
  };

  const paths: Array<Record<string, unknown> | null | undefined> = [
    (tweetResult.core as { user_results?: { result?: Record<string, unknown> } } | undefined)
      ?.user_results?.result,
    (
      (tweetResult.tweet as { core?: { user_results?: { result?: Record<string, unknown> } } })
        ?.core
    )?.user_results?.result,
    tweetResult.user as Record<string, unknown> | undefined,
  ];
  for (const p of paths) {
    const r = tryUser(p);
    if (r.screen) return r;
  }

  // Deep walk limited to user-like nodes
  let found: { screen: string | null; name: string | null } = { screen: null, name: null };
  const walk = (node: unknown, depth: number) => {
    if (found.screen || !node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.__typename === "User" || obj.__typename === "UserUnavailable") {
      const r = tryUser(obj);
      if (r.screen) {
        found = r;
        return;
      }
    }
    if (obj.user_results && typeof obj.user_results === "object") {
      const res = (obj.user_results as { result?: Record<string, unknown> }).result;
      const r = tryUser(res);
      if (r.screen) {
        found = r;
        return;
      }
    }
    for (const v of Object.values(obj)) walk(v, depth + 1);
  };
  walk(tweetResult, 0);
  return found;
}

function extractThumbnailFromLegacy(legacy: Record<string, unknown>): string | null {
  const media = (
    legacy.extended_entities as
      | { media?: { media_url_https?: string; media_url?: string }[] }
      | undefined
  )?.media;
  if (media?.[0]) {
    return media[0].media_url_https || media[0].media_url || null;
  }
  const entitiesMedia = (
    legacy.entities as { media?: { media_url_https?: string; media_url?: string }[] } | undefined
  )?.media;
  if (entitiesMedia?.[0]) {
    return entitiesMedia[0].media_url_https || entitiesMedia[0].media_url || null;
  }
  return null;
}

function parseTweetResult(tweetResult: Record<string, unknown>): XBookmarkItem | null {
  const legacy =
    (tweetResult.legacy as Record<string, unknown> | undefined) ||
    ((tweetResult.tweet as Record<string, unknown> | undefined)?.legacy as
      | Record<string, unknown>
      | undefined);
  const restId =
    (tweetResult.rest_id as string | undefined) ||
    (legacy?.id_str as string | undefined) ||
    ((tweetResult.tweet as Record<string, unknown> | undefined)?.rest_id as string | undefined);
  if (!restId || !legacy) return null;

  const { screen, name } = extractUserFromTweetResult(tweetResult);
  const text = (legacy.full_text as string) || (legacy.text as string) || null;
  const thumbnailUrl = extractThumbnailFromLegacy(legacy);

  return {
    tweetId: restId,
    url: screen
      ? `https://x.com/${screen}/status/${restId}`
      : `https://x.com/i/web/status/${restId}`,
    text,
    authorName: name,
    authorScreenName: screen,
    raw: { id: restId, text, user: screen, thumbnailUrl },
  };
}

export async function fetchTweetById(
  creds: XCredentials,
  tweetId: string,
  opts?: { queryId?: string }
): Promise<XBookmarkItem & { thumbnailUrl?: string | null }> {
  const queryId = opts?.queryId || DEFAULT_TWEET_RESULT_QUERY_ID;
  const variables = {
    tweetId,
    withCommunity: false,
    includePromotedContent: false,
    withVoice: false,
  };
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(TWEET_RESULT_FEATURES),
  });
  const url = `https://x.com/i/api/graphql/${queryId}/TweetResultByRestId?${params}`;
  const res = await xRequest(url, creds, { method: "GET" });
  if (res.status === 429) {
    const err = new Error("RATE_LIMITED");
    (err as Error & { status: number }).status = 429;
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    const err = new Error("AUTH_FAILED");
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `TWEET_HTTP_${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`
    );
  }
  const json = (await res.json()) as {
    data?: { tweetResult?: { result?: Record<string, unknown> } };
  };
  let result = json?.data?.tweetResult?.result;
  // Some payloads nest under tweet
  if (result?.__typename === "TweetWithVisibilityResults" && result.tweet) {
    result = result.tweet as Record<string, unknown>;
  }
  if (!result) {
    throw new Error("TWEET_NOT_FOUND");
  }
  const item = parseTweetResult(result);
  if (!item) throw new Error("TWEET_PARSE_FAILED");
  const thumb =
    (item.raw as { thumbnailUrl?: string | null } | undefined)?.thumbnailUrl ?? null;
  return { ...item, thumbnailUrl: thumb };
}
