import { fail } from "./errors.js";
export type DateTime = string;
export type DateTimeInput = string | Date | number;
export function timezoneOffset(timezone: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezone);
  if (!match) {
    return fail("timezone must be a fixed offset such as +08:00");
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    return fail("timezone offset must be within -14:00..+14:00");
  }
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}
export function validateDateTime(value: unknown): DateTime {
  if (typeof value !== "string") {
    return fail("Expected local datetime string");
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (!m) {
    return fail("Expected YYYY-MM-DD HH:mm:ss[.SSS] without timezone offset");
  }
  const [, year, month, day, hour, minute, second, fraction = ""] = m;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > days[mo - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    fail("Invalid local datetime");
  }
  return year + "-" + month + "-" + day + " " + hour + ":" + minute + ":" + second + "." + fraction.padEnd(3, "0");
}
export function localDateTime(value: DateTimeInput, timezone = "+08:00"): DateTime {
  const offset = timezoneOffset(timezone);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      return fail("Timestamp requires safe integer milliseconds");
    }
    value = new Date(value);
  }
  if (!(value instanceof Date)) {
    return validateDateTime(value);
  }
  if (Number.isNaN(value.getTime())) {
    return fail("Invalid Date");
  }
  const shifted = new Date(value.getTime() + offset * 60_000);
  if (Number.isNaN(shifted.getTime())) {
    return fail("Datetime exceeds supported range");
  }
  return validateDateTime(shifted.toISOString().replace("T", " ").slice(0, -1));
}

export type DateTimeFormat = "local" | "utc";
/** Decode stored local time using the client's fixed offset. */
export function utcDateTime(value: string, timezone: string): DateTime {
  const local = validateDateTime(value);
  timezoneOffset(timezone);
  const result = new Date(local.replace(" ", "T") + timezone).toISOString();
  if (!/^\d{4}-/.test(result) || result.startsWith("0000-")) {
    fail("UTC datetime exceeds supported range");
  }
  return result;
}
/** UTC mode accepts its own output as a query or write input. */
export function dateTimeInput(value: DateTimeInput, timezone: string, format: DateTimeFormat): DateTime {
  if (format === "utc" && typeof value === "string" && value.endsWith("Z")) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
      return fail("Expected ISO UTC datetime");
    }
    validateDateTime(value.slice(0, -1));
    return localDateTime(new Date(value), timezone);
  }
  return localDateTime(value, timezone);
}
