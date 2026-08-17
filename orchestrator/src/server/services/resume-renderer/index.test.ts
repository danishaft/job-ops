import { beforeEach, describe, expect, it, vi } from "vitest";

const rendererMocks = vi.hoisted(() => ({
  latex: vi.fn(),
  typst: vi.fn(),
}));

vi.mock("./document", () => ({
  buildResumeRenderDocument: vi.fn(() => ({ name: "Ada" })),
}));

vi.mock("./latex", () => ({
  renderLatexPdf: rendererMocks.latex,
  getLatexTemplatePath: vi.fn(),
  getTectonicBinary: vi.fn(),
  readLatexTemplate: vi.fn(),
}));

vi.mock("./typst", () => ({
  renderTypstPdf: rendererMocks.typst,
  getTypstBinary: vi.fn(),
  getTypstTemplatePath: vi.fn(),
  readTypstTemplate: vi.fn(),
}));

import { renderResumePdf } from "./index";

const args = {
  resumeJson: {},
  outputPath: "/tmp/resume.pdf",
  jobId: "job-1",
} as const;

describe("renderResumePdf fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses Typst when Tectonic is unavailable", async () => {
    rendererMocks.latex.mockRejectedValueOnce(
      new Error("Tectonic binary not found. Install tectonic."),
    );
    rendererMocks.typst.mockResolvedValueOnce(undefined);

    await renderResumePdf({ ...args, renderer: "latex" });

    expect(rendererMocks.latex).toHaveBeenCalledTimes(1);
    expect(rendererMocks.typst).toHaveBeenCalledTimes(1);
  });

  it("uses LaTeX when Typst is unavailable", async () => {
    rendererMocks.typst.mockRejectedValueOnce(
      new Error("Typst binary not found. Install typst."),
    );
    rendererMocks.latex.mockResolvedValueOnce(undefined);

    await renderResumePdf({ ...args, renderer: "typst" });

    expect(rendererMocks.typst).toHaveBeenCalledTimes(1);
    expect(rendererMocks.latex).toHaveBeenCalledTimes(1);
  });

  it("does not hide compiler or template failures behind another renderer", async () => {
    rendererMocks.latex.mockRejectedValueOnce(
      new Error("Tectonic failed with exit code 1"),
    );

    await expect(
      renderResumePdf({ ...args, renderer: "latex" }),
    ).rejects.toThrow("Tectonic failed with exit code 1");
    expect(rendererMocks.typst).not.toHaveBeenCalled();
  });
});
