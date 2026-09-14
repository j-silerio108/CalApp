const connectStatus = document.getElementById("connect-status");
const connectBtn = document.getElementById("connect-btn");
const disconnectBtn = document.getElementById("disconnect-btn");

const fileInput = document.getElementById("file-input");
const parseBtn = document.getElementById("parse-btn");
const parseStatus = document.getElementById("parse-status");

const reviewSection = document.getElementById("review-section");
const courseNameInput = document.getElementById("course-name-input");
const courseInfo = document.getElementById("course-info");
const itemsBody = document.getElementById("items-body");
const addRowBtn = document.getElementById("add-row-btn");
const submitBtn = document.getElementById("submit-btn");
const submitStatus = document.getElementById("submit-status");
const resultsList = document.getElementById("results-list");

const TYPES = ["assignment", "quiz", "exam", "project", "paper", "presentation", "reading", "other"];

// ---- Google Calendar connection status ----

async function refreshConnectStatus() {
  const res = await fetch("/api/auth/google/status");
  const { connected } = await res.json();
  if (connected) {
    connectStatus.textContent = "✅ Connected to Google Calendar.";
    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
  } else {
    connectStatus.textContent = "Not connected yet.";
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");
  }
}

connectBtn.addEventListener("click", () => {
  window.location.href = "/api/auth/google/start";
});

disconnectBtn.addEventListener("click", async () => {
  await fetch("/api/auth/google/disconnect", { method: "POST" });
  refreshConnectStatus();
});

if (new URLSearchParams(window.location.search).get("connected")) {
  window.history.replaceState({}, "", "/");
}

refreshConnectStatus();

// ---- Parsing ----

function addRow(item = { title: "", date: "", time: "", type: "assignment", description: "" }) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="checkbox" class="row-include" checked /></td>
    <td><input type="text" class="row-title" value="${escapeHtml(item.title)}" /></td>
    <td><input type="date" class="row-date" value="${escapeHtml(item.date || "")}" /></td>
    <td><input type="time" class="row-time" value="${escapeHtml(item.time || "")}" /></td>
    <td>
      <select class="row-type">
        ${TYPES.map((t) => `<option value="${t}" ${t === item.type ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </td>
    <td><input type="text" class="row-desc" value="${escapeHtml(item.description || "")}" /></td>
    <td><button class="row-delete" title="Remove row">✕</button></td>
  `;
  tr.querySelector(".row-delete").addEventListener("click", () => tr.remove());
  itemsBody.appendChild(tr);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

addRowBtn.addEventListener("click", () => addRow());

parseBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    parseStatus.textContent = "Choose a file first.";
    parseStatus.className = "status err";
    return;
  }

  parseBtn.disabled = true;
  parseStatus.textContent = "Reading syllabus and asking Claude to find due dates… this can take a bit for long syllabi.";
  parseStatus.className = "status";
  resultsList.innerHTML = "";

  try {
    const formData = new FormData();
    formData.append("syllabus", file);
    const res = await fetch("/api/parse-syllabus", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to parse syllabus.");

    courseNameInput.value = data.course_name || "";
    itemsBody.innerHTML = "";
    if (!data.items || data.items.length === 0) {
      parseStatus.textContent = "Claude didn't find any due dates in that file. You can add rows manually below.";
      parseStatus.className = "status err";
    } else {
      data.items
        .slice()
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .forEach(addRow);
      parseStatus.textContent = `Found ${data.items.length} due date(s). Review and edit before adding them.`;
      parseStatus.className = "status ok";
    }
    renderCourseInfo(data);
    applyMeetingTimesToSchedule(data.course_name, data.meeting_times || []);
    reviewSection.classList.remove("hidden");
    reviewSection.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    parseStatus.textContent = `Error: ${err.message}`;
    parseStatus.className = "status err";
  } finally {
    parseBtn.disabled = false;
  }
});

// ---- Submitting to calendar ----

submitBtn.addEventListener("click", async () => {
  const rows = [...itemsBody.querySelectorAll("tr")];
  const items = rows
    .filter((tr) => tr.querySelector(".row-include").checked)
    .map((tr) => ({
      title: tr.querySelector(".row-title").value.trim(),
      date: tr.querySelector(".row-date").value,
      time: tr.querySelector(".row-time").value || null,
      type: tr.querySelector(".row-type").value,
      description: tr.querySelector(".row-desc").value.trim() || null,
    }))
    .filter((item) => item.title && item.date);

  if (items.length === 0) {
    submitStatus.textContent = "No checked items with a title and date to add.";
    submitStatus.className = "status err";
    return;
  }

  submitBtn.disabled = true;
  submitStatus.textContent = "Adding to Google Calendar…";
  submitStatus.className = "status";
  resultsList.innerHTML = "";

  try {
    const res = await fetch("/api/create-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, courseName: courseNameInput.value.trim() || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create events.");

    const addedCount = data.results.filter((r) => r.ok && !r.skipped).length;
    const skippedCount = data.results.filter((r) => r.skipped).length;
    const failCount = data.results.filter((r) => !r.ok).length;
    submitStatus.textContent = `Added ${addedCount}${skippedCount ? `, skipped ${skippedCount} already on calendar` : ""} of ${data.results.length} event(s).`;
    submitStatus.className = failCount === 0 ? "status ok" : "status err";

    data.results.forEach((r) => {
      const li = document.createElement("li");
      li.className = r.ok ? "ok" : "err";
      li.textContent = r.skipped
        ? `○ ${r.title}: already on calendar — skipped`
        : r.ok
        ? `✓ ${r.title}`
        : `✗ ${r.title}: ${r.error}`;
      resultsList.appendChild(li);
    });
  } catch (err) {
    submitStatus.textContent = `Error: ${err.message}`;
    submitStatus.className = "status err";
  } finally {
    submitBtn.disabled = false;
  }
});

// ---- Weekly schedule builder ----

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const commitmentsBody = document.getElementById("commitments-body");
const addCommitmentBtn = document.getElementById("add-commitment-btn");
const commuteMinutesInput = document.getElementById("commute-minutes-input");
const gymSessionsInput = document.getElementById("gym-sessions-input");
const gymDurationInput = document.getElementById("gym-duration-input");
const gymWindowStartInput = document.getElementById("gym-window-start-input");
const gymWindowEndInput = document.getElementById("gym-window-end-input");
const optimizeBtn = document.getElementById("optimize-btn");
const optimizeStatus = document.getElementById("optimize-status");
const schedulePreview = document.getElementById("schedule-preview");
const schedulePreviewList = document.getElementById("schedule-preview-list");
const addScheduleBtn = document.getElementById("add-schedule-btn");
const scheduleSubmitStatus = document.getElementById("schedule-submit-status");
const scheduleResultsList = document.getElementById("schedule-results-list");

let lastProposedBlocks = []; // flattened {label, day, start, end, description} for the "add to calendar" step

function addCommitmentRow(prefill = null) {
  const tr = document.createElement("tr");
  const days = prefill ? prefill.days : [];
  const dayCheckboxes = DAY_LABELS.map((d, i) => `
    <label style="display:inline-block; margin-right:6px; font-size:0.8rem;">
      <input type="checkbox" class="commitment-day" value="${i}" ${days.includes(i) ? "checked" : ""} /> ${d}
    </label>
  `).join("");
  tr.innerHTML = `
    <td><input type="text" class="commitment-label" placeholder="e.g. CS 301 Lecture" value="${escapeHtml(prefill?.label || "")}" /></td>
    <td>
      <select class="commitment-type">
        <option value="class" ${prefill?.type !== "work" ? "selected" : ""}>class</option>
        <option value="work" ${prefill?.type === "work" ? "selected" : ""}>work</option>
      </select>
    </td>
    <td style="white-space:nowrap;">${dayCheckboxes}</td>
    <td><input type="time" class="commitment-start" value="${escapeHtml(prefill?.start || "")}" /></td>
    <td><input type="time" class="commitment-end" value="${escapeHtml(prefill?.end || "")}" /></td>
    <td><button class="row-delete" title="Remove row">✕</button></td>
  `;
  tr.querySelector(".row-delete").addEventListener("click", () => tr.remove());
  commitmentsBody.appendChild(tr);
}

addCommitmentBtn.addEventListener("click", () => addCommitmentRow());
addCommitmentRow(); // start with one empty row

const DAY_NAME_TO_NUM = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

function renderCourseInfo(data) {
  const lines = [];
  const prof = data.professor;
  if (prof && (prof.name || prof.email || prof.office_hours)) {
    const bits = [prof.name || "—"];
    if (prof.email) bits.push(`<a href="mailto:${escapeHtml(prof.email)}">${escapeHtml(prof.email)}</a>`);
    if (prof.office_hours) bits.push(`Office hours: ${escapeHtml(prof.office_hours)}`);
    lines.push(`<div><strong>Professor:</strong> ${bits.join(" · ")}</div>`);
  }
  if (data.meeting_times && data.meeting_times.length > 0) {
    const meet = data.meeting_times
      .map((mt) => `${mt.type}: ${mt.days.join("/")} ${mt.start}–${mt.end}${mt.location ? " @ " + escapeHtml(mt.location) : ""}`)
      .join("; ");
    lines.push(`<div><strong>Meets:</strong> ${meet}</div>`);
  }
  if (lines.length === 0) {
    courseInfo.classList.add("hidden");
    courseInfo.innerHTML = "";
    return;
  }
  courseInfo.innerHTML = lines.join("");
  courseInfo.classList.remove("hidden");
}

// Auto-fill the weekly schedule builder (section 4) with the class meeting
// times pulled from the syllabus, so the user doesn't have to retype them.
function applyMeetingTimesToSchedule(courseName, meetingTimes) {
  if (!meetingTimes || meetingTimes.length === 0) return;

  // Clear out untouched empty starter rows before adding the real ones.
  [...commitmentsBody.querySelectorAll("tr")].forEach((tr) => {
    const label = tr.querySelector(".commitment-label").value.trim();
    const start = tr.querySelector(".commitment-start").value;
    if (!label && !start) tr.remove();
  });

  meetingTimes.forEach((mt) => {
    addCommitmentRow({
      label: `${courseName || "Class"} (${mt.type})`,
      type: "class",
      days: mt.days.map((d) => DAY_NAME_TO_NUM[d]).filter((d) => d !== undefined),
      start: mt.start,
      end: mt.end,
    });
  });
}

function collectCommitments() {
  return [...commitmentsBody.querySelectorAll("tr")]
    .map((tr) => ({
      label: tr.querySelector(".commitment-label").value.trim(),
      type: tr.querySelector(".commitment-type").value,
      days: [...tr.querySelectorAll(".commitment-day:checked")].map((cb) => Number(cb.value)),
      start: tr.querySelector(".commitment-start").value,
      end: tr.querySelector(".commitment-end").value,
    }))
    .filter((c) => c.label && c.start && c.end && c.days.length > 0);
}

optimizeBtn.addEventListener("click", async () => {
  const commitments = collectCommitments();
  if (commitments.length === 0) {
    optimizeStatus.textContent = "Add at least one class/work block with a label, days, and times.";
    optimizeStatus.className = "status err";
    return;
  }

  const gymSessionsPerWeek = Number(gymSessionsInput.value) || 0;
  const gym = gymSessionsPerWeek > 0
    ? {
        sessionsPerWeek: gymSessionsPerWeek,
        durationMinutes: Number(gymDurationInput.value) || 60,
        preferredStart: gymWindowStartInput.value || "06:00",
        preferredEnd: gymWindowEndInput.value || "22:00",
      }
    : null;

  optimizeBtn.disabled = true;
  optimizeStatus.textContent = "Optimizing…";
  optimizeStatus.className = "status";
  schedulePreview.classList.add("hidden");
  scheduleResultsList.innerHTML = "";
  scheduleSubmitStatus.textContent = "";

  try {
    const res = await fetch("/api/build-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commitments, commuteMinutes: Number(commuteMinutesInput.value) || 0, gym }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to build schedule.");

    // Flatten everything (original commitments + commute buffers + gym sessions)
    // into one list of calendar blocks, one entry per day each recurs on.
    lastProposedBlocks = [];
    for (const c of commitments) {
      for (const day of c.days) {
        lastProposedBlocks.push({ label: c.label, day, start: c.start, end: c.end, description: c.type });
      }
    }
    for (const b of data.commuteBlocks) {
      lastProposedBlocks.push({ label: b.label, day: b.day, start: b.start, end: b.end, description: "commute" });
    }
    for (const s of data.gymSessions) {
      lastProposedBlocks.push({ label: "Gym", day: s.day, start: s.start, end: s.end, description: "gym" });
    }

    schedulePreviewList.innerHTML = "";
    lastProposedBlocks
      .slice()
      .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
      .forEach((b) => {
        const li = document.createElement("li");
        li.textContent = `${DAY_LABELS[b.day]} ${b.start}–${b.end}: ${b.label}`;
        schedulePreviewList.appendChild(li);
      });

    if (data.warnings.length > 0) {
      optimizeStatus.textContent = data.warnings.join(" ");
      optimizeStatus.className = "status err";
    } else {
      optimizeStatus.textContent = `Built a schedule with ${lastProposedBlocks.length} weekly block(s).`;
      optimizeStatus.className = "status ok";
    }
    schedulePreview.classList.remove("hidden");
  } catch (err) {
    optimizeStatus.textContent = `Error: ${err.message}`;
    optimizeStatus.className = "status err";
  } finally {
    optimizeBtn.disabled = false;
  }
});

addScheduleBtn.addEventListener("click", async () => {
  if (lastProposedBlocks.length === 0) return;

  addScheduleBtn.disabled = true;
  scheduleSubmitStatus.textContent = "Adding weekly schedule to Google Calendar…";
  scheduleSubmitStatus.className = "status";
  scheduleResultsList.innerHTML = "";

  try {
    const res = await fetch("/api/create-recurring-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: lastProposedBlocks }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create events.");

    const addedCount = data.results.filter((r) => r.ok && !r.skipped).length;
    const skippedCount = data.results.filter((r) => r.skipped).length;
    const failCount = data.results.filter((r) => !r.ok).length;
    scheduleSubmitStatus.textContent = `Added ${addedCount}${skippedCount ? `, skipped ${skippedCount} already on calendar` : ""} of ${data.results.length} recurring event(s).`;
    scheduleSubmitStatus.className = failCount === 0 ? "status ok" : "status err";

    data.results.forEach((r) => {
      const li = document.createElement("li");
      li.className = r.ok ? "ok" : "err";
      li.textContent = r.skipped
        ? `○ ${r.label}: already on calendar — skipped`
        : r.ok
        ? `✓ ${r.label}`
        : `✗ ${r.label}: ${r.error}`;
      scheduleResultsList.appendChild(li);
    });
  } catch (err) {
    scheduleSubmitStatus.textContent = `Error: ${err.message}`;
    scheduleSubmitStatus.className = "status err";
  } finally {
    addScheduleBtn.disabled = false;
  }
});

// ---- Live weekly calendar view ----

const CAL_DAY_START_HOUR = 6; // 6am
const CAL_DAY_END_HOUR = 24; // midnight
const CAL_ROW_MINUTES = 15;
const CAL_ROW_HEIGHT = 16; // px, must match style.css's 64px-per-hour gridline spacing (4 rows/hour)
const CAL_ROWS = ((CAL_DAY_END_HOUR - CAL_DAY_START_HOUR) * 60) / CAL_ROW_MINUTES;

const calPrevBtn = document.getElementById("cal-prev-btn");
const calNextBtn = document.getElementById("cal-next-btn");
const calWeekLabel = document.getElementById("cal-week-label");
const calStatus = document.getElementById("cal-status");
const calAlldayRow = document.getElementById("cal-allday-row");
const calGrid = document.getElementById("cal-grid");

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // back up to Sunday
  return d;
}

let currentWeekStart = startOfWeek(new Date());

function toDateInputValue(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function calTypeClass(description) {
  const token = (description || "").split(" — ")[0].trim().toLowerCase();
  if (["class", "work", "commute", "gym"].includes(token)) return `cal-type-${token}`;
  if (["assignment", "quiz", "exam", "project", "paper", "presentation", "reading", "other"].includes(token)) {
    return "cal-type-due";
  }
  return "cal-type-default";
}

function minutesOfDay(dateObj) {
  return dateObj.getHours() * 60 + dateObj.getMinutes();
}

function rowForMinutes(mins) {
  const clamped = Math.min(Math.max(mins, CAL_DAY_START_HOUR * 60), CAL_DAY_END_HOUR * 60);
  return 3 + Math.round((clamped - CAL_DAY_START_HOUR * 60) / CAL_ROW_MINUTES);
}

function makeDeleteButton(ev) {
  const btn = document.createElement("button");
  btn.className = "cal-event-del";
  btn.type = "button";
  btn.title = "Delete";
  btn.textContent = "✕";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    let idToDelete = ev.id;
    if (ev.recurringEventId) {
      const deleteWholeSeries = confirm(
        `"${ev.summary}" repeats weekly.\n\nOK = delete the ENTIRE recurring series (every week).\nCancel = delete only this week's occurrence.`
      );
      idToDelete = deleteWholeSeries ? ev.recurringEventId : ev.id;
    } else if (!confirm(`Delete "${ev.summary}"?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/calendar/event/${encodeURIComponent(idToDelete)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete event.");
      refreshCalendar();
    } catch (err) {
      alert(`Couldn't delete "${ev.summary}": ${err.message}`);
    }
  });
  return btn;
}

async function refreshCalendar() {
  calWeekLabel.textContent = `Week of ${currentWeekStart.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  calStatus.textContent = "Loading…";
  calStatus.className = "status";
  calAlldayRow.innerHTML = "";
  calGrid.innerHTML = "";

  try {
    const res = await fetch(`/api/calendar/week?start=${toDateInputValue(currentWeekStart)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load calendar.");

    calStatus.textContent = data.events.length === 0 ? "No events this week." : "";
    calStatus.className = "status";

    // Grid skeleton: template columns are [hour-label, day0..day6] (see style.css).
    calGrid.style.gridTemplateRows = `auto repeat(${CAL_ROWS}, ${CAL_ROW_HEIGHT}px)`;

    // Corner + day headers (row 1).
    const corner = document.createElement("div");
    corner.className = "cal-header-cell";
    corner.style.gridColumn = "1";
    calGrid.appendChild(corner);

    const dayDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + i);
      dayDates.push(d);
      const header = document.createElement("div");
      header.className = "cal-header-cell";
      header.style.gridColumn = String(i + 2);
      header.innerHTML = `${DAY_LABELS[i]}<div class="cal-date">${d.getMonth() + 1}/${d.getDate()}</div>`;
      calGrid.appendChild(header);
    }

    // Hour labels + per-day background gridlines spanning all timed rows.
    for (let h = CAL_DAY_START_HOUR; h < CAL_DAY_END_HOUR; h++) {
      const label = document.createElement("div");
      label.className = "cal-hour-label";
      label.style.gridRow = String(rowForMinutes(h * 60));
      const displayHour = h % 12 === 0 ? 12 : h % 12;
      label.textContent = `${displayHour}${h < 12 ? "am" : "pm"}`;
      calGrid.appendChild(label);
    }
    for (let i = 0; i < 7; i++) {
      const bg = document.createElement("div");
      bg.className = "cal-day-bg";
      bg.style.gridColumn = String(i + 2);
      bg.style.gridRow = `3 / span ${CAL_ROWS}`;
      calGrid.appendChild(bg);
    }

    // All-day events (due dates with no time) in their own strip above the grid.
    const alldayCorner = document.createElement("div");
    calAlldayRow.appendChild(alldayCorner);
    const alldayCells = dayDates.map(() => {
      const cell = document.createElement("div");
      calAlldayRow.appendChild(cell);
      return cell;
    });

    data.events.forEach((ev) => {
      const startDate = new Date(ev.start);
      if (ev.allDay) {
        const dayIndex = Math.round((startDate - currentWeekStart) / 86400000);
        if (dayIndex < 0 || dayIndex > 6) return;
        const chip = document.createElement("div");
        chip.className = `cal-event ${calTypeClass(ev.description)}`;
        chip.title = ev.summary;
        chip.appendChild(document.createTextNode(ev.summary));
        chip.appendChild(makeDeleteButton(ev));
        alldayCells[dayIndex].appendChild(chip);
        return;
      }
      const endDate = new Date(ev.end);
      const dayIndex = startDate.getDay();
      const startRow = rowForMinutes(minutesOfDay(startDate));
      let endRow = rowForMinutes(minutesOfDay(endDate));
      if (endDate.toDateString() !== startDate.toDateString()) endRow = 3 + CAL_ROWS; // spans past midnight
      if (endRow <= startRow) endRow = startRow + 1;

      const chip = document.createElement("div");
      chip.className = `cal-event ${calTypeClass(ev.description)}`;
      chip.style.gridColumn = String(dayIndex + 2);
      chip.style.gridRow = `${startRow} / ${endRow}`;
      chip.title = `${ev.summary} (${startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`;
      chip.appendChild(document.createTextNode(ev.summary));
      chip.appendChild(makeDeleteButton(ev));
      calGrid.appendChild(chip);
    });
  } catch (err) {
    calStatus.textContent = `Error: ${err.message}`;
    calStatus.className = "status err";
  }
}

calPrevBtn.addEventListener("click", () => {
  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  refreshCalendar();
});
calNextBtn.addEventListener("click", () => {
  currentWeekStart.setDate(currentWeekStart.getDate() + 7);
  refreshCalendar();
});

refreshCalendar();
