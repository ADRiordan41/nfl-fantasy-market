export const CHICAGO_TIME_ZONE = "America/Chicago";

const CHICAGO_STAMP_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: CHICAGO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function chicagoNowStamp(): string {
  return CHICAGO_STAMP_FORMATTER.format(new Date()).replace(" ", "T");
}
