import { clsx, type ClassValue } from "clsx";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(
  value: string,
  withTime = true,
  timeZone?: string,
) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

export function toDateTimeLocal(value: string | Date, timeZone: string) {
  return formatInTimeZone(value, timeZone, "yyyy-MM-dd'T'HH:mm");
}

export function zonedDateTimeToIso(value: string, timeZone: string) {
  return fromZonedTime(value, timeZone).toISOString();
}

export const eventTimeZones = [
  "Europe/London",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Australia/Sydney",
] as const;

export function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}
