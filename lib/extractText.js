import path from "path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

/**
 * Extract plain text from an uploaded syllabus file.
 * @param {Buffer} buffer
 * @param {string} originalName
 * @returns {Promise<string>}
 */
export async function extractText(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  if (ext === ".txt" || ext === ".md") {
    return buffer.toString("utf-8");
  }
  throw new Error(`Unsupported file type "${ext}". Please upload a PDF, DOCX, or TXT file.`);
}
