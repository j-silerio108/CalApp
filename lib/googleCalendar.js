import fs from "fs";
import path from "path";
import { google } from "googleapis";

const TOKEN_PATH = path.resolve("token.json");
const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

function getRedirectUri(port) {
  return `http://localhost:${port}/api/auth/google/callback`;
}

function getOAuthClient(port) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Copy .env.example to .env and fill them in."
    );
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, getRedirectUri(port));
}

export function isConnected() {
  return fs.existsSync(TOKEN_PATH);
}

export function getAuthUrl(port) {
  const client = getOAuthClient(port);
  return client.generateAuthUrl({
    access_type: "offline", // so we get a refresh_token
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function handleOAuthCallback(code, port) {
  const client = getOAuthClient(port);
  const { tokens } = await client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

export function disconnect() {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

async function getAuthorizedClient(port) {
  if (!isConnected()) {
    throw new Error("Not connected to Google Calendar yet. Visit /api/auth/google/start first.");
  }
  const client = getOAuthClient(port);
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  client.setCredentials(tokens);

  // Persist refreshed access tokens automatically.
  client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });

  return client;
}

// Key used to recognize "the same event" already on the calendar: same title,
// same calendar day. Good enough to catch re-submitting the same syllabus/schedule
// without false-positiving on two different items that happen to share a title.
function eventKey(summary, isoDateOrDateTime) {
  return `${(summary || "").trim().toLowerCase()}|${(isoDateOrDateTime || "").slice(0, 10)}`;
}

async function fetchExistingKeys(calendar, timeMin, timeMax) {
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    maxResults: 2500,
  });
  return new Set((res.data.items || []).map((e) => eventKey(e.summary, e.start.dateTime || e.start.date)));
}

/**
 * Create one Google Calendar event per due-date item. Items that already have a
 * same-title event on the same day are skipped instead of creating a duplicate.
 * @param {Array<{title:string, date:string, time:string|null, type:string, description:string|null}>} items
 * @param {string} courseName
 * @param {number} port
 * @returns {Promise<Array<{title:string, ok:boolean, skipped?:boolean, error?:string, htmlLink?:string}>>}
 */
export async function createEvents(items, courseName, port) {
  const auth = await getAuthorizedClient(port);
  const calendar = google.calendar({ version: "v3", auth });

  const dates = items.map((i) => i.date).filter(Boolean).sort();
  const existingKeys = dates.length
    ? await fetchExistingKeys(
        calendar,
        new Date(`${dates[0]}T00:00:00`).toISOString(),
        new Date(`${dates[dates.length - 1]}T23:59:59`).toISOString()
      )
    : new Set();

  const results = [];
  for (const item of items) {
    const summary = courseName ? `${courseName}: ${item.title}` : item.title;
    const key = eventKey(summary, item.date);
    if (existingKeys.has(key)) {
      results.push({ title: item.title, ok: true, skipped: true });
      continue;
    }
    const descriptionParts = [item.type, item.description].filter(Boolean);
    try {
      let eventBody;
      if (item.time) {
        const start = new Date(`${item.date}T${item.time}:00`);
        const end = new Date(start.getTime() + 60 * 60 * 1000); // default 1hr block
        eventBody = {
          summary,
          description: descriptionParts.join(" — "),
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
        };
      } else {
        // All-day event
        const end = new Date(`${item.date}T00:00:00`);
        end.setDate(end.getDate() + 1);
        eventBody = {
          summary,
          description: descriptionParts.join(" — "),
          start: { date: item.date },
          end: { date: end.toISOString().slice(0, 10) },
        };
      }

      const res = await calendar.events.insert({
        calendarId: "primary",
        requestBody: eventBody,
      });
      results.push({ title: item.title, ok: true, htmlLink: res.data.htmlLink });
      existingKeys.add(key); // guard against duplicate rows within this same batch
    } catch (err) {
      results.push({ title: item.title, ok: false, error: err.message });
    }
  }
  return results;
}

/**
 * List real Google Calendar events for the 7-day week starting at the given date
 * (recurring events are expanded to their individual instances for that week).
 * @param {number} port
 * @param {string} weekStartDate - "YYYY-MM-DD"
 * @returns {Promise<Array<{id:string, summary:string, start:string, end:string, allDay:boolean}>>}
 */
export async function listWeekEvents(port, weekStartDate) {
  const auth = await getAuthorizedClient(port);
  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date(`${weekStartDate}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });

  return (res.data.items || []).map((e) => ({
    id: e.id,
    summary: e.summary || "(no title)",
    description: e.description || "",
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    allDay: !e.start.dateTime,
    recurringEventId: e.recurringEventId || null,
  }));
}

/**
 * Delete a single event by id (for a recurring event's expanded instance id,
 * this deletes only that one occurrence; pass the master's recurringEventId
 * instead to delete the entire weekly series).
 * @param {string} eventId
 * @param {number} port
 */
export async function deleteEvent(eventId, port) {
  const auth = await getAuthorizedClient(port);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId: "primary", eventId });
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// Local wall-clock date for the next occurrence of the given weekday/time,
// pushed a week out if that moment has already passed today.
function nextOccurrence(dayOfWeek, hh, mm) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
  const diff = (dayOfWeek - now.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  if (diff === 0 && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 7);
  return d;
}

// A recurring block is "the same" as an already-scheduled one if it has the same
// title, recurs on the same weekday, and starts at the same time of day.
async function recurringEventExists(calendar, label, dayOfWeek, startMinutes) {
  const res = await calendar.events.list({
    calendarId: "primary",
    q: label,
    singleEvents: false,
    maxResults: 50,
  });
  const dayCode = DAY_CODES[dayOfWeek];
  return (res.data.items || []).some((e) => {
    if ((e.summary || "").trim().toLowerCase() !== label.trim().toLowerCase()) return false;
    if (!e.recurrence || !e.recurrence.some((r) => r.includes(`BYDAY=${dayCode}`))) return false;
    if (!e.start?.dateTime) return false;
    const d = new Date(e.start.dateTime);
    return d.getHours() * 60 + d.getMinutes() === startMinutes;
  });
}

/**
 * Create weekly-recurring Google Calendar events (class/work/commute/gym blocks).
 * Blocks that already have a matching recurring event (same title, weekday, and
 * start time) are skipped instead of creating a duplicate.
 * @param {Array<{label:string, day:number, start:number, end:number, description?:string}>} blocks
 *   day is 0=Sunday..6=Saturday; start/end are minutes since midnight.
 * @param {number} port
 * @returns {Promise<Array<{label:string, ok:boolean, skipped?:boolean, error?:string, htmlLink?:string}>>}
 */
export async function createRecurringEvents(blocks, port) {
  const auth = await getAuthorizedClient(port);
  const calendar = google.calendar({ version: "v3", auth });

  const results = [];
  for (const block of blocks) {
    try {
      if (await recurringEventExists(calendar, block.label, block.day, block.start)) {
        results.push({ label: block.label, ok: true, skipped: true });
        continue;
      }
      const startDate = nextOccurrence(block.day, Math.floor(block.start / 60), block.start % 60);
      const endDate = new Date(startDate);
      endDate.setHours(Math.floor(block.end / 60), block.end % 60, 0, 0);

      const res = await calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary: block.label,
          description: block.description || undefined,
          start: { dateTime: startDate.toISOString() },
          end: { dateTime: endDate.toISOString() },
          recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${DAY_CODES[block.day]}`],
        },
      });
      results.push({ label: block.label, ok: true, htmlLink: res.data.htmlLink });
    } catch (err) {
      results.push({ label: block.label, ok: false, error: err.message });
    }
  }
  return results;
}
