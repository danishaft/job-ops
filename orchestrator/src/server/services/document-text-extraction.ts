import JSZip from "jszip";

export type DocxTextExtractionErrorCode = "INVALID_DOCX" | "MISSING_DOCUMENT";
export type PdfTextExtractionErrorCode = "INVALID_PDF" | "EMPTY_TEXT";

export interface ExtractedPdfDocument {
  text: string;
  links: string[];
}

export class DocxTextExtractionError extends Error {
  code: DocxTextExtractionErrorCode;

  constructor(code: DocxTextExtractionErrorCode, message: string) {
    super(message);
    this.name = "DocxTextExtractionError";
    this.code = code;
  }
}

export class PdfTextExtractionError extends Error {
  code: PdfTextExtractionErrorCode;

  constructor(code: PdfTextExtractionErrorCode, message: string) {
    super(message);
    this.name = "PdfTextExtractionError";
    this.code = code;
  }
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|amp|lt|gt|quot|apos);/g,
    (match, hex, dec) => {
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
      switch (match) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default:
          return match;
      }
    },
  );
}

export function normalizeDocxXmlText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<w:cr\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<w:t\b[^>]*>/g, "")
      .replace(/<\/w:t>/g, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new DocxTextExtractionError(
      "INVALID_DOCX",
      "DOCX file could not be read.",
    );
  }

  const documentXml = zip.file("word/document.xml");
  if (!documentXml) {
    throw new DocxTextExtractionError(
      "MISSING_DOCUMENT",
      "DOCX file is missing document content.",
    );
  }

  const xml = await documentXml.async("string");
  return normalizeDocxXmlText(xml);
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const { default: pdfParse } = await import("pdf-parse");
    const data = (await pdfParse(buffer)) as { text?: string };
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) {
      throw new PdfTextExtractionError(
        "EMPTY_TEXT",
        "PDF file did not contain readable text.",
      );
    }
    return text;
  } catch (error) {
    if (error instanceof PdfTextExtractionError) {
      throw error;
    }
    throw new PdfTextExtractionError(
      "INVALID_PDF",
      "PDF file could not be read or is encrypted.",
    );
  }
}

function normalizePdfLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const link = value.trim();
  if (!link || link.length > 2_000) return null;

  try {
    const parsed = new URL(link);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
      ? link
      : null;
  } catch {
    return null;
  }
}

/**
 * Extract link annotation targets without making the PDF unreadable when an
 * otherwise valid document contains malformed or unsupported annotations.
 */
export async function extractPdfLinks(buffer: Buffer): Promise<string[]> {
  let document: { destroy(): Promise<void>; numPages: number } | null = null;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
    });
    const pdf = await loadingTask.promise;
    document = pdf;
    const links = new Set<string>();

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: "display" });
      for (const annotation of annotations) {
        if (annotation.subtype !== "Link") continue;
        const link =
          normalizePdfLink(annotation.url) ??
          normalizePdfLink(annotation.unsafeUrl);
        if (link) links.add(link);
      }
    }

    return [...links];
  } catch {
    return [];
  } finally {
    await document?.destroy().catch(() => undefined);
  }
}

export async function extractPdfDocument(
  buffer: Buffer,
): Promise<ExtractedPdfDocument> {
  const [text, links] = await Promise.all([
    extractPdfText(buffer),
    extractPdfLinks(buffer),
  ]);
  return { text, links };
}
