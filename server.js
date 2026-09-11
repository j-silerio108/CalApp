import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

import { extractText } from "./lib/extractText.js";
import { extractDueDates } from "./lib/claude.js";
import * as googleCalendar from "./lib/googleCalendar.js";

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

app.listen(PORT, () => {
  console.log(`CalApp running at http://localhost:${PORT}`);
});
