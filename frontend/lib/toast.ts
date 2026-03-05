export type ToastTone = "success" | "error" | "info";

export type ToastEventDetail = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

const TOAST_EVENT_NAME = "fsm:toast";

function emitToast(detail: ToastEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT_NAME, { detail }));
}

export function notifySuccess(message: string, durationMs = 2800): void {
  emitToast({ message, tone: "success", durationMs });
}

export function notifyError(message: string, durationMs = 3800): void {
  emitToast({ message, tone: "error", durationMs });
}

export function notifyInfo(message: string, durationMs = 2800): void {
  emitToast({ message, tone: "info", durationMs });
}

export function getToastEventName(): string {
  return TOAST_EVENT_NAME;
}
