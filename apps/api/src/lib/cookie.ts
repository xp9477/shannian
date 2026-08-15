/** Session cookie Secure flag. COOKIE_SECURE=false wins even in production (plain HTTP). */
export function sessionCookieSecure(): boolean {
  const flag = process.env.COOKIE_SECURE;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
}
