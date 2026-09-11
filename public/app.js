const connectStatus = document.getElementById("connect-status");
const connectBtn = document.getElementById("connect-btn");
const disconnectBtn = document.getElementById("disconnect-btn");

const fileInput = document.getElementById("file-input");
const parseBtn = document.getElementById("parse-btn");
const parseStatus = document.getElementById("parse-status");

const reviewSection = document.getElementById("review-section");
const courseNameInput = document.getElementById("course-name-input");
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

    const okCount = data.results.filter((r) => r.ok).length;
    submitStatus.textContent = `Added ${okCount} of ${data.results.length} event(s).`;
    submitStatus.className = okCount === data.results.length ? "status ok" : "status err";

    data.results.forEach((r) => {
      const li = document.createElement("li");
      li.className = r.ok ? "ok" : "err";
      li.textContent = r.ok ? `✓ ${r.title}` : `✗ ${r.title}: ${r.error}`;
      resultsList.appendChild(li);
    });
  } catch (err) {
    submitStatus.textContent = `Error: ${err.message}`;
    submitStatus.className = "status err";
  } finally {
    submitBtn.disabled = false;
  }
});
