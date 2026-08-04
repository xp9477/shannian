/** Cross-page: side nav "快速添加" focuses the home hairline capture input. */
export const CAPTURE_FOCUS_EVENT = "shannian:focus-capture";

export function requestCaptureFocus() {
  window.dispatchEvent(new CustomEvent(CAPTURE_FOCUS_EVENT));
}
