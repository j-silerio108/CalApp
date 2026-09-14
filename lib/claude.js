import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Claude Sonnet 5 — cheaper than Opus and plenty capable for structured extraction.
const MODEL = "claude-sonnet-5";

const EXTRACT_TOOL = {
  name: "record_due_dates",
  description:
    "Record every due date found in a course syllabus: assignments, homework, quizzes, exams, projects, papers, presentations, and any other graded or deadline-bound item.",
  input_schema: {
    type: "object",
    properties: {
      course_name: {
        type: ["string", "null"],
        description:
          "The course name/number if it appears in the syllabus (e.g. 'CS 301 - Algorithms'), else null.",
      },
      professor: {
        type: ["object", "null"],
        description: "Instructor contact info if the syllabus lists one, else null.",
        properties: {
          name: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          office_hours: {
            type: ["string", "null"],
            description: "Office hours as written in the syllabus, e.g. 'Tue/Thu 2-3pm, Room 410'.",
          },
        },
        required: ["name", "email", "office_hours"],
        additionalProperties: false,
      },
      meeting_times: {
        type: "array",
        description:
          "Every regular recurring class meeting block the syllabus describes (lecture, lab, discussion section, seminar, etc). Empty array if none is stated.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "e.g. 'lecture', 'lab', 'discussion', 'seminar'.",
            },
            days: {
              type: "array",
              description: "Days this meeting recurs on.",
              items: {
                type: "string",
                enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
              },
            },
            start: { type: "string", description: "24-hour HH:MM start time." },
            end: { type: "string", description: "24-hour HH:MM end time." },
            location: { type: ["string", "null"], description: "Room/building if stated, else null." },
          },
          required: ["type", "days", "start", "end", "location"],
          additionalProperties: false,
        },
      },
      items: {
        type: "array",
        description: "One entry per due date found in the syllabus.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short name of the item, e.g. 'Homework 3' or 'Midterm Exam'.",
            },
            date: {
              type: "string",
              description: "ISO 8601 date, YYYY-MM-DD. Infer the year from context (syllabus term/semester dates) when the syllabus only gives month/day.",
            },
            time: {
              type: ["string", "null"],
              description: "24-hour HH:MM time if the syllabus gives one (e.g. class time or exam time), else null.",
            },
            type: {
              type: "string",
              enum: ["assignment", "quiz", "exam", "project", "paper", "presentation", "reading", "other"],
            },
            description: {
              type: ["string", "null"],
              description: "Any short extra detail from the syllabus worth keeping, else null.",
            },
          },
          required: ["title", "date", "time", "type", "description"],
          additionalProperties: false,
        },
      },
    },
    required: ["course_name", "professor", "meeting_times", "items"],
    additionalProperties: false,
  },
  strict: true,
};

/**
 * Send raw syllabus text to Claude and get back structured due-date data,
 * professor contact info, and recurring class meeting times.
 * @param {string} syllabusText
 * @param {number} referenceYear - year to assume when the syllabus omits one
 * @returns {Promise<{course_name: string|null, professor: object|null, meeting_times: Array<object>, items: Array<object>}>}
 */
export async function extractDueDates(syllabusText, referenceYear = new Date().getFullYear()) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    system:
      `You read college course syllabi and extract every date something is due, the instructor's contact info, ` +
      `and the class's regular recurring meeting times (lecture/lab/discussion/seminar). ` +
      `Today's reference year is ${referenceYear} — use it (and any term/semester dates mentioned in the syllabus) ` +
      `to resolve dates that only include a month and day. If a syllabus date is genuinely ambiguous, make your best ` +
      `reasonable guess rather than skipping the item. Leave professor fields or meeting_times empty/null when the ` +
      `syllabus doesn't state them — never guess contact info or meeting times. Only call the tool once, with ` +
      `everything included.`,
    messages: [
      {
        role: "user",
        content: `Here is the syllabus text:\n\n${syllabusText}`,
      },
    ],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "record_due_dates" },
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Claude did not return structured due-date data.");
  }
  return toolUse.input;
}
