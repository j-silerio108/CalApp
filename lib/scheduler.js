// Pure scheduling logic: given fixed weekly commitments (class/work), a commute
// buffer, and a gym target, compute commute blocks and auto-place gym sessions
// into open gaps. No I/O here — server.js wires this to Google Calendar.

const MIN_IN_DAY = 24 * 60;

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function toHHMM(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];
  for (const cur of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push({ ...cur });
  }
  return merged;
}

function freeGaps(busy, windowStart, windowEnd) {
  const merged = mergeIntervals(busy.filter((b) => b.end > windowStart && b.start < windowEnd));
  const gaps = [];
  let cursor = windowStart;
  for (const b of merged) {
    const s = Math.max(b.start, windowStart);
    const e = Math.min(b.end, windowEnd);
    if (s > cursor) gaps.push({ start: cursor, end: s });
    cursor = Math.max(cursor, e);
  }
  if (cursor < windowEnd) gaps.push({ start: cursor, end: windowEnd });
  return gaps;
}

/**
 * @param {Object} input
 * @param {Array<{label:string, type:string, days:number[], start:string, end:string}>} input.commitments
 *   days use JS convention: 0=Sunday..6=Saturday
 * @param {number} input.commuteMinutes - travel time added before/after each commitment
 * @param {{sessionsPerWeek:number, durationMinutes:number, preferredStart?:string, preferredEnd?:string, preferredDays?:number[]}} [input.gym]
 * @returns {{commuteBlocks: Array, gymSessions: Array, warnings: string[]}}
 */
export function buildSchedule({ commitments = [], commuteMinutes = 0, gym = null }) {
  const warnings = [];
  const busyByDay = Array.from({ length: 7 }, () => []);
  const commuteBlocks = [];

  for (const c of commitments) {
    const startM = toMinutes(c.start);
    const endM = toMinutes(c.end);
    if (!(endM > startM)) {
      warnings.push(`"${c.label}" has an end time at or before its start time — skipped.`);
      continue;
    }
    for (const day of c.days) {
      busyByDay[day].push({ start: startM, end: endM });
      if (commuteMinutes > 0) {
        const beforeStart = Math.max(0, startM - commuteMinutes);
        const afterEnd = Math.min(MIN_IN_DAY, endM + commuteMinutes);
        if (beforeStart < startM) {
          commuteBlocks.push({ label: `Commute to ${c.label}`, day, start: beforeStart, end: startM });
          busyByDay[day].push({ start: beforeStart, end: startM });
        }
        if (afterEnd > endM) {
          commuteBlocks.push({ label: `Commute from ${c.label}`, day, start: endM, end: afterEnd });
          busyByDay[day].push({ start: endM, end: afterEnd });
        }
      }
    }
  }

  const gymSessions = [];
  if (gym && gym.sessionsPerWeek > 0 && gym.durationMinutes > 0) {
    const prefStart = toMinutes(gym.preferredStart || "06:00");
    const prefEnd = toMinutes(gym.preferredEnd || "22:00");
    const dayOrder = gym.preferredDays && gym.preferredDays.length ? gym.preferredDays : [1, 2, 3, 4, 5, 6, 0];
    const usedDays = new Set();
    let placed = 0;

    // Pass 0 spreads sessions across distinct days first; later passes allow
    // doubling up on a day if the weekly target still isn't met.
    for (let round = 0; placed < gym.sessionsPerWeek && round < 3; round++) {
      for (const day of dayOrder) {
        if (placed >= gym.sessionsPerWeek) break;
        if (round === 0 && usedDays.has(day)) continue;
        const gaps = freeGaps(busyByDay[day], prefStart, prefEnd);
        const fit = gaps.find((g) => g.end - g.start >= gym.durationMinutes);
        if (fit) {
          const start = fit.start;
          const end = start + gym.durationMinutes;
          gymSessions.push({ day, start, end });
          busyByDay[day].push({ start, end });
          usedDays.add(day);
          placed++;
        }
      }
    }

    if (placed < gym.sessionsPerWeek) {
      warnings.push(
        `Could only fit ${placed} of ${gym.sessionsPerWeek} requested gym session(s) into your open time.`
      );
    }
  }

  return { commuteBlocks, gymSessions, warnings };
}
