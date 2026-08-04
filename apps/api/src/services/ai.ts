import type { SummaryBasis } from "@shannian/shared";
import { getAiConfig } from "../lib/settings.js";
import { outboundFetch } from "../lib/http.js";
import { clampTitle, isShellTitle } from "./title.js";

export interface AiSuggestion {
  category: string | null;
  /** Short topic title (not platform shell / author name) */
  title: string | null;
  summary: string | null;
  summaryBasis: SummaryBasis;
}

function inferBasis(input: {
  contentExcerpt?: string | null;
  description?: string | null;
}): SummaryBasis {
  if (input.contentExcerpt?.trim()) return "content";
  if (input.description?.trim()) return "description";
  return "metadata";
}

export async function suggestForCard(input: {
  title?: string | null;
  author?: string | null;
  platform?: string | null;
  url?: string | null;
  note?: string | null;
  description?: string | null;
  contentExcerpt?: string | null;
  categories: string[];
}): Promise<AiSuggestion> {
  const config = await getAiConfig();
  if (!config) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const basisHint = inferBasis(input);

  const system = `你是「闪念」灵感库的整理助手。列表扫读靠「精炼短摘要」当标题；平台原标题（网页 og、推文壳层等）通常无意义，应忽略。
根据用户提供的收藏元数据与可选正文摘录，输出严格 JSON（不要 markdown）：
{"category":"从给定分类中选一个，无法判断则 null","title":"8到18字精炼短摘要作标题，证据不足则 null","summary":"一句稍完整的中文摘要（可与 title 同义延展），证据不足则 null"}
分类词表：${JSON.stringify(input.categories)}
规则：
1. category 必须是词表中的某一项或 null。不要输出标签；主题只靠分类。
2. title = 给列表用的精炼短摘要（不是原文截断、不是网站/帖子原标题）。像便签标题：点出「讲什么 / 关键结论或问题」。约 8–18 个汉字，尽量短；不要句号/问号结尾，不要「标题：」前缀。禁止：作者名、@handle、「某某 on X/Twitter」、纯 URL、网站名、把正文前几句原样粘贴。
3. summary = 一句完整摘要，便于确认去留；只能依据给定字段中确实存在的信息；禁止编造事实、数据或结论。可比 title 稍长，但不要写成段落。
4. 若仅有 URL/平台/残缺壳层标题、几乎没有 description 与正文摘录，且 note 也空，则 title 与 summary 必须为 null。
5. 有 contentExcerpt 时优先据此写 title/summary；否则用 description；再否则用 note。输入里的 title 字段多半是占位/原标题，仅作弱参考，不要照抄。
6. 当前输入证据等级约为：${basisHint}（content=有正文摘录，description=有页面描述，metadata=仅元数据）。`;

  const user = JSON.stringify({
    existingTitle: input.title && !isShellTitle(input.title) ? input.title : null,
    titleLooksLikeShell: isShellTitle(input.title),
    author: input.author,
    platform: input.platform,
    url: input.url,
    note: input.note,
    description: input.description,
    contentExcerpt: input.contentExcerpt
      ? input.contentExcerpt.slice(0, 6000)
      : null,
  });

  const endpoint = `${config.baseUrl}/chat/completions`;
  const res = await outboundFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI_HTTP_${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content || "{}";
  let parsed: {
    category?: string | null;
    title?: string | null;
    summary?: string | null;
  };
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  }

  const cat =
    parsed.category && input.categories.includes(parsed.category) ? parsed.category : null;

  const rawTitle = parsed.title ? String(parsed.title).trim() : null;
  const title =
    rawTitle && !isShellTitle(rawTitle) ? clampTitle(rawTitle) : null;
  const summary = parsed.summary ? String(parsed.summary).trim().slice(0, 500) : null;

  return {
    category: cat,
    title,
    summary: summary || null,
    summaryBasis: summary ? basisHint : "none",
  };
}

export async function testAiConnection(): Promise<{ ok: boolean; message: string }> {
  const config = await getAiConfig();
  if (!config) return { ok: false, message: "未配置 AI" };
  try {
    const endpoint = `${config.baseUrl}/chat/completions`;
    const res = await outboundFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "回复 ok" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    return { ok: true, message: "连接成功" };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
