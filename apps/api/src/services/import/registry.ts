import type { PlatformImportPublic } from "@shannian/shared";
import { getXCredentials } from "./x-credentials.js";
import { deleteBookmark, verifyXCredentials } from "./x-client.js";

export const X_RISK_NOTE =
  "使用非官方 Cookie（auth_token / ct0）访问 X。存在风控与封号残留风险，接口可能随时失效。仅限个人自用，风险自担。导入与取消收藏均已限速。";

export async function listPlatformsPublic(): Promise<PlatformImportPublic[]> {
  const creds = await getXCredentials();
  return [
    {
      id: "x",
      label: "X",
      importSource: "x_bookmark",
      supportsImport: true,
      supportsRevoke: true,
      available: true,
      connected: Boolean(creds?.authToken && creds?.ct0),
      riskNote: X_RISK_NOTE,
    },
    {
      id: "xiaohongshu",
      label: "小红书",
      importSource: "xiaohongshu_favorite",
      supportsImport: true,
      supportsRevoke: false,
      available: false,
      comingSoon: true,
      connected: false,
    },
    {
      id: "bilibili",
      label: "哔哩哔哩",
      importSource: "bilibili_favorite",
      supportsImport: true,
      supportsRevoke: false,
      available: false,
      comingSoon: true,
      connected: false,
    },
    {
      id: "youtube",
      label: "YouTube",
      importSource: "youtube_playlist",
      supportsImport: true,
      supportsRevoke: false,
      available: false,
      comingSoon: true,
      connected: false,
    },
  ];
}

export async function tryRevokeImport(
  importSource: string,
  externalId: string
): Promise<{ ok: boolean; message?: string }> {
  if (importSource !== "x_bookmark") {
    return { ok: true };
  }
  const creds = await getXCredentials();
  if (!creds?.authToken || !creds?.ct0) {
    return { ok: false, message: "未配置 X 凭证，无法取消书签。可强制永久删除仅清本地。" };
  }
  try {
    const { getXQueryIds } = await import("./x-credentials.js");
    const qids = await getXQueryIds();
    await deleteBookmark(creds, externalId, qids.delete || undefined);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "AUTH_FAILED") {
      return { ok: false, message: "X 凭证无效或已过期，请到导入页更新后重试。" };
    }
    if (msg === "RATE_LIMITED") {
      return { ok: false, message: "X 限流，请稍后重试或强制仅删除本地。" };
    }
    return { ok: false, message: `取消 X 书签失败：${msg}` };
  }
}

export async function testXConnection(): Promise<{ ok: boolean; message: string }> {
  const creds = await getXCredentials();
  if (!creds?.authToken || !creds?.ct0) {
    return { ok: false, message: "请先保存 auth_token 与 ct0" };
  }
  return verifyXCredentials(creds);
}
