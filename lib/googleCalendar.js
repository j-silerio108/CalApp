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

/**
 * Create one Google Calendar event per due-date item.
 * @param {Array<{title:string, date:string, time:string|null, type:string, description:string|null}>} items
 * @param {string} courseName
 * @param {number} port
 * @returns {Promise<Array<{title:string, ok:boolean, error?:string, htmlLink?:string}>>}
 */
export async function createEvents(items, courseName, port) {
  const auth = await getAuthorizedClient(port);
  const calendar = google.calendar({ version: "v3", auth });

  const results = [];
  for (const item of items) {
    const summary = courseName ? `${courseName}: ${item.title}` : item.title;
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
    } catch (err) {
      results.push({ title: item.title, ok: false, error: err.message });
    }
  }
  return results;
}
