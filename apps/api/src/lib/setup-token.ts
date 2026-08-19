import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const configuredToken = process.env.SETUP_TOKEN?.trim() || null;
// Every fresh database is claim-protected, including `npm run dev/start`.
// A loopback listener is useful defence in depth, but is not an authentication
// boundary when port forwarding, containers or a reverse proxy are involved.
const mustGenerate = !configuredToken;
const generatedToken = mustGenerate ? randomBytes(32).toString("hex") : null;
const expectedToken = configuredToken || generatedToken;

let announced = false;

export function setupTokenRequired(): boolean {
  return Boolean(expectedToken);
}

export function announceSetupToken(): void {
  if (announced || !generatedToken) return;
  announced = true;
  console.warn("[security] 首次初始化令牌（仅本次启动有效）：", generatedToken);
  console.warn("[security] 在初始化页面输入该令牌；初始化完成后它将失效。");
}

export function verifySetupToken(candidate: string | null | undefined): boolean {
  if (!expectedToken) return true;
  if (!candidate) return false;
  const expected = createHash("sha256").update(expectedToken).digest();
  const actual = createHash("sha256").update(candidate.trim()).digest();
  return timingSafeEqual(expected, actual);
}
