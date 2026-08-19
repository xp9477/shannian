export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503;

/** Error that is safe to expose through the JSON API. */
export class AppError extends Error {
  readonly code: string;
  readonly status: AppErrorStatus;

  constructor(code: string, status: AppErrorStatus, message?: string) {
    super(message || code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}
