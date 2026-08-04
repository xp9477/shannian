import type { XCredentialsPublic } from "@shannian/shared";
import { deleteSetting, getSetting, setSetting } from "../../lib/settings.js";
import { maskSecret } from "../../lib/crypto.js";
import type { XCredentials } from "./x-client.js";

const KEY_AUTH = "x_auth_token";
const KEY_CT0 = "x_ct0";
const KEY_BOOKMARKS_QID = "x_bookmarks_query_id";
const KEY_DELETE_QID = "x_delete_bookmark_query_id";
const KEY_TWEET_QID = "x_tweet_result_query_id";

export async function getXCredentials(): Promise<XCredentials | null> {
  const authToken = await getSetting(KEY_AUTH);
  const ct0 = await getSetting(KEY_CT0);
  if (!authToken || !ct0) return null;
  return { authToken, ct0 };
}

export async function getXCredentialsPublic(): Promise<XCredentialsPublic> {
  const authToken = await getSetting(KEY_AUTH);
  const ct0 = await getSetting(KEY_CT0);
  return {
    hasAuthToken: Boolean(authToken),
    hasCt0: Boolean(ct0),
    authTokenHint: maskSecret(authToken),
    ct0Hint: maskSecret(ct0),
  };
}

export async function saveXCredentials(input: {
  authToken?: string;
  ct0?: string;
}): Promise<XCredentialsPublic> {
  if (input.authToken?.trim()) {
    await setSetting(KEY_AUTH, input.authToken.trim());
  }
  if (input.ct0?.trim()) {
    await setSetting(KEY_CT0, input.ct0.trim());
  }
  return getXCredentialsPublic();
}

export async function clearXCredentials(): Promise<void> {
  await deleteSetting(KEY_AUTH);
  await deleteSetting(KEY_CT0);
}

export async function getXQueryIds(): Promise<{
  bookmarks: string | null;
  delete: string | null;
  tweet: string | null;
}> {
  return {
    bookmarks: await getSetting(KEY_BOOKMARKS_QID),
    delete: await getSetting(KEY_DELETE_QID),
    tweet: await getSetting(KEY_TWEET_QID),
  };
}
