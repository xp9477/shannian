import type { XCredentialsPublic } from "@shannian/shared";
import {
  deleteSettings,
  getSettings,
  setSettings,
} from "../../lib/settings.js";
import { maskSecret } from "../../lib/crypto.js";
import type { XCredentials } from "./x-client.js";

const KEY_AUTH = "x_auth_token";
const KEY_CT0 = "x_ct0";
const KEY_BOOKMARKS_QID = "x_bookmarks_query_id";
const KEY_DELETE_QID = "x_delete_bookmark_query_id";
const KEY_TWEET_QID = "x_tweet_result_query_id";

export async function getXCredentials(): Promise<XCredentials | null> {
  const values = await getSettings([KEY_AUTH, KEY_CT0]);
  const authToken = values[KEY_AUTH];
  const ct0 = values[KEY_CT0];
  if (!authToken || !ct0) return null;
  return { authToken, ct0 };
}

export async function getXCredentialsPublic(): Promise<XCredentialsPublic> {
  const values = await getSettings([KEY_AUTH, KEY_CT0]);
  const authToken = values[KEY_AUTH];
  const ct0 = values[KEY_CT0];
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
  await setSettings({
    [KEY_AUTH]: input.authToken?.trim() || undefined,
    [KEY_CT0]: input.ct0?.trim() || undefined,
  });
  return getXCredentialsPublic();
}

export async function clearXCredentials(): Promise<void> {
  await deleteSettings([KEY_AUTH, KEY_CT0]);
}

export async function getXQueryIds(): Promise<{
  bookmarks: string | null;
  delete: string | null;
  tweet: string | null;
}> {
  const values = await getSettings([
    KEY_BOOKMARKS_QID,
    KEY_DELETE_QID,
    KEY_TWEET_QID,
  ]);
  return {
    bookmarks: values[KEY_BOOKMARKS_QID],
    delete: values[KEY_DELETE_QID],
    tweet: values[KEY_TWEET_QID],
  };
}
