const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Weekday of a local calendar date string (YYYY-MM-DD).
 * Sunday = 0 … Saturday = 6, matching JavaScript Date#getDay and
 * NutriTrace `goal.days[]` indexing.
 *
 * Parses year/month/day components explicitly. Do not use
 * `new Date('YYYY-MM-DD')` — that is UTC midnight and can land on the
 * previous local weekday west of UTC.
 */
export function weekdayFromLocalDate(localDate) {
  const match = LOCAL_DATE_RE.exec(String(localDate ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getDay();
}

function isPresentGoalValue(value) {
  return value != null && value > 0;
}

function aggregateGoalValue(goal, fallback) {
  const value = goal?.max ?? goal?.min;
  return isPresentGoalValue(value) ? value : fallback;
}

/**
 * Resolve a stored NutriTrace goal for a viewed local calendar date.
 *
 * Shared goals (`sharedGoal !== false`, including legacy entries that omit
 * the flag) use max/min. Per-weekday goals use `days[weekday]` for the
 * selected date, falling back to max/min only when that day is absent.
 *
 * Does not compute Math.max(days). Validity matches Goals.saveGoal:
 * null/undefined/0 are not usable day values.
 */
export function resolveGoalForLocalDate(goal, localDate, fallback = 2000) {
  if (!goal) return fallback;
  if (goal.sharedGoal === false) {
    const weekday = weekdayFromLocalDate(localDate);
    if (weekday != null) {
      const dayValue = goal.days?.[weekday];
      if (isPresentGoalValue(dayValue)) return dayValue;
    }
  }
  return aggregateGoalValue(goal, fallback);
}

export function remainingCaloriesForLocalDate(goal, localDate, consumed, fallback = 2000) {
  return resolveGoalForLocalDate(goal, localDate, fallback) - consumed;
}
