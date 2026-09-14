import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

import { extractText } from "./lib/extractText.js";
import { extractDueDates } from "./lib/claude.js";
import * as googleCalendar from "./lib/googleCalendar.js";
import { buildSchedule, toHHMM, toMinutes } from "./lib/scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// ---- Syllabus parsing -------------------------------------------------

app.post("/api/parse-syllabus", upload.single("syllabus"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const text = await extractText(req.file.buffer, req.file.originalname);
    if (!text.trim()) {
      return res.status(400).json({ error: "Couldn't read any text from that file." });
    }
    const result = await extractDueDates(text);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Google Calendar OAuth ---------------------------------------------

app.get("/api/auth/google/status", (req, res) => {
  res.json({ connected: googleCalendar.isConnected() });
});

app.get("/api/auth/google/start", (req, res) => {
  try {
    const url = googleCalendar.getAuthUrl(PORT);
    res.redirect(url);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing authorization code.");
    await googleCalendar.handleOAuthCallback(code, PORT);
    res.redirect("/?connected=1");
  } catch (err) {
    console.error(err);
    res.status(500).send(`Failed to connect Google Calendar: ${err.message}`);
  }
});

app.post("/api/auth/google/disconnect", (req, res) => {
  googleCalendar.disconnect();
  res.json({ ok: true });
});

// ---- Creating events -----------------------------------------------------

app.post("/api/create-events", async (req, res) => {
  try {
    const { items, courseName } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items to add." });
    }
    const results = await googleCalendar.createEvents(items, courseName || null, PORT);
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Calendar view -------------------------------------------------------

app.get("/api/calendar/week", async (req, res) => {
  try {
    const { start } = req.query;
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return res.status(400).json({ error: "Missing/invalid start date (expected YYYY-MM-DD)." });
    }
    const events = await googleCalendar.listWeekEvents(PORT, start);
    res.json({ events });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/calendar/event/:id", async (req, res) => {
  try {
    await googleCalendar.deleteEvent(req.params.id, PORT);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Weekly schedule building -----------------------------------------

app.post("/api/build-schedule", (req, res) => {
  try {
    const { commitments, commuteMinutes, gym } = req.body;
    if (!Array.isArray(commitments)) {
      return res.status(400).json({ error: "commitments must be an array." });
    }
    const { commuteBlocks, gymSessions, warnings } = buildSchedule({
      commitments,
      commuteMinutes: Number(commuteMinutes) || 0,
      gym: gym && gym.sessionsPerWeek > 0 ? gym : null,
    });
    // Convert minute-of-day numbers back to HH:MM for the frontend to display.
    res.json({
      commuteBlocks: commuteBlocks.map((b) => ({ ...b, start: toHHMM(b.start), end: toHHMM(b.end) })),
      gymSessions: gymSessions.map((s) => ({ ...s, start: toHHMM(s.start), end: toHHMM(s.end) })),
      warnings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/create-recurring-events", async (req, res) => {
  try {
    const { blocks } = req.body;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ error: "No schedule blocks to add." });
    }
    // Frontend sends start/end as "HH:MM"; googleCalendar.js works in minutes-of-day.
    const minuteBlocks = blocks.map((b) => ({ ...b, start: toMinutes(b.start), end: toMinutes(b.end) }));
    const results = await googleCalendar.createRecurringEvents(minuteBlocks, PORT);
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`CalApp running at http://localhost:${PORT}`);
});
