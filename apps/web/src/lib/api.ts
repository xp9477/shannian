import type {
  FlashCard,
  SetupStatus,
  AiSettingsPublic,
  MinioSettingsPublic,
  HttpProxySettingsPublic,
  ImportJob,
  PlatformImportPublic,
  XCredentialsPublic,
} from "@shannian/shared";

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.message || body.error || `HTTP_${status}`));
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let body: Record<string, unknown> = { error: `HTTP_${res.status}` };
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  setupStatus: () => request<SetupStatus>("/api/setup/status"),
  setupPassword: (password: string, setupToken?: string) =>
    request<{ ok: boolean }>("/api/setup/password", {
      method: "POST",
      body: JSON.stringify({
        password,
        ...(setupToken ? { setupToken } : {}),
      }),
    }),
  setupAi: (data: { baseUrl: string; apiKey: string; model: string }) =>
    request("/api/setup/ai", { method: "POST", body: JSON.stringify(data) }),
  setupMinio: (data: Record<string, string>) =>
    request("/api/setup/minio", { method: "POST", body: JSON.stringify(data) }),
  skipAi: () => request("/api/setup/skip-ai", { method: "POST", body: "{}" }),
  skipMinio: () => request("/api/setup/skip-minio", { method: "POST", body: "{}" }),

  login: (password: string) =>
    request<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request("/api/auth/logout", { method: "POST", body: "{}" }),
  me: () => request<{ ok: boolean }>("/api/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listCards: (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== "all") q.set(k, v);
    });
    return request<{ items: FlashCard[]; total: number }>(`/api/cards?${q}`);
  },
  bulkCards: (ids: string[], action: "organize" | "trash" | "retry") =>
    request<{ ok: number; failed: number }>("/api/cards/bulk", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    }),
  createCard: (body: { text?: string; url?: string; note?: string }) =>
    request<{ card: FlashCard; existing: boolean }>("/api/cards", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getCard: (id: string) => request<{ card: FlashCard }>(`/api/cards/${id}`),
  updateCard: (id: string, body: Record<string, unknown>) =>
    request<{ card: FlashCard }>(`/api/cards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  appendNote: (id: string, note: string) =>
    request<{ card: FlashCard }>(`/api/cards/${id}/append-note`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  retryEnrich: (id: string) =>
    request<{ card: FlashCard }>(`/api/cards/${id}/retry-enrich`, {
      method: "POST",
      body: "{}",
    }),
  exportObsidian: (id: string) =>
    request<{ card: FlashCard }>(`/api/cards/${id}/obsidian`, {
      method: "POST",
      body: "{}",
    }),
  deleteCard: (id: string, permanent = false, force = false) => {
    const q = new URLSearchParams();
    if (permanent) q.set("permanent", "1");
    if (force) q.set("force", "1");
    const qs = q.toString();
    return request<{ ok: boolean }>(`/api/cards/${id}${qs ? `?${qs}` : ""}`, {
      method: "DELETE",
    });
  },
  restoreCard: (id: string) =>
    request<{ card: FlashCard }>(`/api/cards/${id}/restore`, { method: "POST", body: "{}" }),

  importPlatforms: () =>
    request<{ items: PlatformImportPublic[]; riskNote: string }>("/api/import/platforms"),
  xCredentials: () =>
    request<{ credentials: XCredentialsPublic; riskNote: string }>("/api/import/x/credentials"),
  saveXCredentials: (data: { authToken?: string; ct0?: string }) =>
    request<{ credentials: XCredentialsPublic }>("/api/import/x/credentials", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  clearXCredentials: () =>
    request<{ ok: boolean; credentials: XCredentialsPublic }>("/api/import/x/credentials", {
      method: "DELETE",
    }),
  testX: () => request<{ ok: boolean; message: string }>("/api/import/x/test", {
    method: "POST",
    body: "{}",
  }),
  startXImport: (forceFull = false) =>
    request<{ job: ImportJob }>("/api/import/x/start", {
      method: "POST",
      body: JSON.stringify({ forceFull }),
    }),
  xImportJob: () => request<{ job: ImportJob | null }>("/api/import/x/job"),
  cancelXImport: () =>
    request<{ job: ImportJob | null }>("/api/import/x/cancel", {
      method: "POST",
      body: "{}",
    }),

  categories: () =>
    request<{ items: { id: string; name: string; sortOrder: number }[] }>("/api/categories"),
  createCategory: (name: string) =>
    request("/api/categories", { method: "POST", body: JSON.stringify({ name }) }),
  deleteCategory: (id: string) => request(`/api/categories/${id}`, { method: "DELETE" }),

  inboxCount: () => request<{ count: number }>("/api/review/inbox-count"),
  randomCard: () => request<{ card: FlashCard | null }>("/api/review/random"),

  settings: () =>
    request<{
      setup: SetupStatus;
      ai: AiSettingsPublic;
      minio: MinioSettingsPublic;
      proxy: HttpProxySettingsPublic;
    }>("/api/settings"),
  saveAi: (data: { baseUrl: string; apiKey?: string; model: string }) =>
    request<{ ai: AiSettingsPublic }>("/api/settings/ai", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  saveMinio: (data: Record<string, string | undefined>) =>
    request<{ minio: MinioSettingsPublic }>("/api/settings/minio", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  saveProxy: (proxyUrl: string) =>
    request<{ proxy: HttpProxySettingsPublic }>("/api/settings/proxy", {
      method: "PUT",
      body: JSON.stringify({ proxyUrl }),
    }),
  testAi: () => request<{ ok: boolean; message: string }>("/api/settings/ai/test", {
    method: "POST",
    body: "{}",
  }),
  testMinio: () =>
    request<{ ok: boolean; message: string }>("/api/settings/minio/test", {
      method: "POST",
      body: "{}",
    }),
  testProxy: () =>
    request<{ ok: boolean; message: string; proxy: string | null }>("/api/settings/proxy/test", {
      method: "POST",
      body: "{}",
    }),
  exportAll: () => request<unknown>("/api/export"),
};
