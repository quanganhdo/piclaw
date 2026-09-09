export type CalendarWindowKind = "daily" | "monthly";

export interface CalendarWindow {
  id: string;
  kind: CalendarWindowKind;
  timezone: string;
  startsAt: string;
  endsAt: string;
}

type DateParts = { year: number; month: number; day: number };

function validateTimezone(timezone: string): string {
  const value = timezone.trim();
  if (!value) throw new Error("A non-empty IANA timezone is required");
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format(new Date(0));
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
  return value;
}

function dateParts(date: Date, timezone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function zonedFields(date: Date, timezone: string): DateParts & { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function localMidnightUtc(parts: DateParts, timezone: string): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day);
  let candidate = target;
  for (let pass = 0; pass < 4; pass += 1) {
    const actual = zonedFields(new Date(candidate), timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const adjustment = target - represented;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
}

function addLocalDays(parts: DateParts, days: number): DateParts {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

export function resolveCalendarWindow(kind: CalendarWindowKind, timezoneInput: string, nowInput: Date = new Date()): CalendarWindow {
  const timezone = validateTimezone(timezoneInput);
  if (Number.isNaN(nowInput.getTime())) throw new Error("Invalid calendar window date");
  const current = dateParts(nowInput, timezone);
  const startParts = kind === "monthly" ? { year: current.year, month: current.month, day: 1 } : current;
  const endParts = kind === "monthly"
    ? current.month === 12
      ? { year: current.year + 1, month: 1, day: 1 }
      : { year: current.year, month: current.month + 1, day: 1 }
    : addLocalDays(current, 1);
  const dateId = kind === "monthly"
    ? `${startParts.year}-${String(startParts.month).padStart(2, "0")}`
    : `${startParts.year}-${String(startParts.month).padStart(2, "0")}-${String(startParts.day).padStart(2, "0")}`;
  return {
    id: `${kind}:${timezone}:${dateId}`,
    kind,
    timezone,
    startsAt: localMidnightUtc(startParts, timezone).toISOString(),
    endsAt: localMidnightUtc(endParts, timezone).toISOString(),
  };
}
