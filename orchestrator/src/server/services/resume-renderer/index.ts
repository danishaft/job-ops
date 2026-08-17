import { logger } from "@infra/logger";
import type { PdfRenderer, TypstTheme } from "@shared/types";
import { buildResumeRenderDocument } from "./document";
import { renderLatexPdf } from "./latex";
import type { NormalizeResumeJsonOptions } from "./types";
import { renderTypstPdf } from "./typst";

export { buildResumeRenderDocument } from "./document";
export {
  getLatexTemplatePath,
  getTectonicBinary,
  readLatexTemplate,
} from "./latex";
export type * from "./types";
export {
  getTypstBinary,
  getTypstTemplatePath,
  readTypstTemplate,
} from "./typst";

type LocalPdfRenderer = Exclude<PdfRenderer, "rxresume">;
type RenderResumePdfInput = {
  resumeJson: Record<string, unknown>;
  outputPath: string;
  jobId: string;
  language?: NormalizeResumeJsonOptions["language"];
  renderer?: LocalPdfRenderer;
  typstTheme?: TypstTheme;
};

function isMissingRendererBinary(
  error: unknown,
  renderer: LocalPdfRenderer,
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return renderer === "latex"
    ? message.includes("Tectonic binary not found")
    : message.includes("Typst binary not found");
}

async function renderWithLocalRenderer(
  renderer: LocalPdfRenderer,
  args: RenderResumePdfInput,
  document: ReturnType<typeof buildResumeRenderDocument>,
): Promise<void> {
  if (renderer === "typst") {
    await renderTypstPdf({
      document,
      outputPath: args.outputPath,
      jobId: args.jobId,
      typstTheme: args.typstTheme,
    });
    return;
  }

  await renderLatexPdf({
    document,
    outputPath: args.outputPath,
    jobId: args.jobId,
  });
}

export async function renderResumePdf(
  args: RenderResumePdfInput,
): Promise<void> {
  const document = buildResumeRenderDocument(args.resumeJson, {
    language: args.language,
  });
  const primaryRenderer = args.renderer ?? "latex";
  try {
    await renderWithLocalRenderer(primaryRenderer, args, document);
  } catch (error) {
    if (!isMissingRendererBinary(error, primaryRenderer)) throw error;
    const fallbackRenderer: LocalPdfRenderer =
      primaryRenderer === "latex" ? "typst" : "latex";
    logger.warn("Primary resume renderer is unavailable; trying fallback", {
      jobId: args.jobId,
      primaryRenderer,
      fallbackRenderer,
    });
    try {
      await renderWithLocalRenderer(fallbackRenderer, args, document);
    } catch (fallbackError) {
      const primaryMessage =
        error instanceof Error ? error.message : String(error);
      const fallbackMessage =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      throw new Error(
        `${primaryMessage} Fallback ${fallbackRenderer} rendering also failed: ${fallbackMessage}`,
      );
    }
  }
}
