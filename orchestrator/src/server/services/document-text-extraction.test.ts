import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfDocument = vi.hoisted(() => ({
  destroy: vi.fn(),
  getAnnotations: vi.fn(),
  getDocument: vi.fn(),
  getPage: vi.fn(),
}));

vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: pdfDocument.getDocument,
}));

import pdfParse from "pdf-parse";
import {
  DocxTextExtractionError,
  extractDocxText,
  extractPdfDocument,
  extractPdfLinks,
  extractPdfText,
} from "./document-text-extraction";

function makePdfParseResult(text: string) {
  return {
    numpages: 1,
    numrender: 1,
    info: {},
    metadata: null,
    version: "default" as const,
    text,
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function makeDocxBuffer(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${escapeXml(text)}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("document text extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfDocument.destroy.mockResolvedValue(undefined);
    pdfDocument.getAnnotations.mockResolvedValue([]);
    pdfDocument.getPage.mockResolvedValue({
      getAnnotations: pdfDocument.getAnnotations,
    });
    pdfDocument.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: pdfDocument.getPage,
        destroy: pdfDocument.destroy,
      }),
    });
  });

  it("extracts readable PDF text", async () => {
    vi.mocked(pdfParse).mockResolvedValueOnce(
      makePdfParseResult("  Taylor Quinn\nSenior Engineer  "),
    );

    await expect(extractPdfText(Buffer.from("%PDF-1.4"))).resolves.toBe(
      "Taylor Quinn\nSenior Engineer",
    );
  });

  it("rejects PDFs with no readable text", async () => {
    vi.mocked(pdfParse).mockResolvedValueOnce(makePdfParseResult("   "));

    await expect(extractPdfText(Buffer.from("%PDF-1.4"))).rejects.toMatchObject(
      {
        name: "PdfTextExtractionError",
        code: "EMPTY_TEXT",
      },
    );
  });

  it("rejects unreadable or encrypted PDFs", async () => {
    vi.mocked(pdfParse).mockRejectedValueOnce(new Error("invalid pdf"));

    await expect(
      extractPdfText(Buffer.from("not a pdf")),
    ).rejects.toMatchObject({
      name: "PdfTextExtractionError",
      code: "INVALID_PDF",
    });
  });

  it("extracts and deduplicates safe PDF link annotations", async () => {
    pdfDocument.getAnnotations.mockResolvedValue([
      { subtype: "Link", url: "https://example.com/project" },
      { subtype: "Link", unsafeUrl: "mailto:person@example.com" },
      { subtype: "Link", url: "https://example.com/project" },
      { subtype: "Link", url: "javascript:alert(1)" },
      { subtype: "Text", url: "https://example.com/ignored" },
    ]);

    await expect(extractPdfLinks(Buffer.from("%PDF-1.4"))).resolves.toEqual([
      "https://example.com/project",
      "mailto:person@example.com",
    ]);
  });

  it("keeps PDF text extraction usable when annotations cannot be read", async () => {
    vi.mocked(pdfParse).mockResolvedValueOnce(
      makePdfParseResult("Taylor Quinn\nSenior Engineer"),
    );
    pdfDocument.getDocument.mockImplementationOnce(() => {
      throw new Error("unsupported annotation table");
    });

    await expect(extractPdfDocument(Buffer.from("%PDF-1.4"))).resolves.toEqual({
      text: "Taylor Quinn\nSenior Engineer",
      links: [],
    });
  });

  it("extracts readable DOCX text", async () => {
    const buffer = await makeDocxBuffer("Taylor & Quinn\nSenior Engineer");

    await expect(extractDocxText(buffer)).resolves.toBe(
      "Taylor & Quinn\nSenior Engineer",
    );
  });

  it("rejects invalid DOCX files", async () => {
    await expect(
      extractDocxText(Buffer.from("not a docx")),
    ).rejects.toBeInstanceOf(DocxTextExtractionError);
    await expect(
      extractDocxText(Buffer.from("not a docx")),
    ).rejects.toMatchObject({
      code: "INVALID_DOCX",
    });
  });

  it("rejects DOCX files missing document XML", async () => {
    const zip = new JSZip();
    zip.file("word/styles.xml", "<xml />");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    await expect(extractDocxText(buffer)).rejects.toMatchObject({
      code: "MISSING_DOCUMENT",
    });
  });
});
