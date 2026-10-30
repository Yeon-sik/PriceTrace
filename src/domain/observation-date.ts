const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DISPLAY_TIME_ZONE = "Asia/Seoul";
const DAY_MS = 86_400_000;

const timestampParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type DisplayParts = { year: string; month: string; day: string; time: string | null };

function displayParts(value: string): DisplayParts | null {
  const dateOnly = DATE_ONLY.exec(value.trim());
  // A published date-only fact is not reinterpreted in any time zone.
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null;
    return { year, month, day, time: null };
  }
  const parsed = new Date(value);
  if (!value.includes("T") || Number.isNaN(parsed.getTime())) return null;
  const parts = Object.fromEntries(timestampParts.formatToParts(parsed).map((part) => [part.type, part.value]));
  return { year: parts.year, month: parts.month, day: parts.day, time: `${parts.hour}:${parts.minute}` };
}

/** `YYYY.MM.DD`. Timestamps are shown in Asia/Seoul; invalid values stay missing. */
export function formatObservationDate(value: string): string | null {
  const parts = displayParts(value);
  return parts ? `${parts.year}.${parts.month}.${parts.day}` : null;
}

/** `YYYY.MM.DD HH:mm` only when the source value carries a time. */
export function formatObservationDateTime(value: string): string | null {
  const parts = displayParts(value);
  if (!parts) return null;
  const date = `${parts.year}.${parts.month}.${parts.day}`;
  return parts.time ? `${date} ${parts.time}` : date;
}

function observationDayIndex(value: string): number | null {
  const parts = displayParts(value);
  if (!parts) return null;
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS;
}

/**
 * Horizontal positions in [0, 1] proportional to observation dates.
 * Same-day observations share a position; a single distinct date sits at 0.5.
 * Invalid dates return null instead of an invented position.
 */
export function observationTimePositions(observedAts: readonly string[]): (number | null)[] {
  const days = observedAts.map(observationDayIndex);
  const known = days.filter((day): day is number => day !== null);
  if (known.length === 0) return days.map(() => null);
  const first = Math.min(...known);
  const span = Math.max(...known) - first;
  return days.map((day) => day === null ? null : span === 0 ? 0.5 : (day - first) / span);
}
