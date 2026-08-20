/**
 * PDF Generator — Sprint 67 P0.5.
 *
 * Deterministic PDF generation for Departify business documents.
 * Uses pdf-lib for reliable, dependency-free PDF creation.
 *
 * IMPORTANT: This module does NOT use the LLM to generate the PDF file.
 * The LLM may structure content, but the physical PDF bytes are produced
 * deterministically by pdf-lib.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface PdfGenerationInput {
  /** Document title */
  readonly title: string;
  /** Markdown-like content to render */
  readonly content: string;
  /** Optional filename (without .pdf extension) */
  readonly filename?: string;
  /** Optional metadata */
  readonly metadata?: {
    readonly author?: string;
    readonly subject?: string;
    readonly keywords?: readonly string[];
  };
}

export interface PdfGenerationResult {
  readonly success: boolean;
  readonly bytes?: Uint8Array;
  readonly filename: string;
  readonly mimeType: "application/pdf";
  readonly size?: number;
  readonly error?: string;
}

/**
 * Generate a clean business PDF from structured content.
 *
 * Supports:
 * - Title (large font)
 * - Headings (## Heading)
 * - Paragraphs
 * - Lists (- item or * item)
 * - Basic text formatting
 * - Spanish characters / Unicode
 * - Proper page breaks
 */
export async function generatePdf(input: PdfGenerationInput): Promise<PdfGenerationResult> {
  try {
    const pdfDoc = await PDFDocument.create();

    // Embed standard fonts (Helvetica supports basic Latin + common accented chars)
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Page settings
    const pageWidth = 595.28; // A4 width in points
    const pageHeight = 841.89; // A4 height in points
    const margin = 50;
    const contentWidth = pageWidth - 2 * margin;

    // Current page and position
    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin;

    // Helper to add a new page when needed
    const ensureSpace = (needed: number) => {
      if (yPosition - needed < margin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        yPosition = pageHeight - margin;
      }
    };

    // Helper to draw text with word wrapping
    const drawText = (
      text: string,
      fontSize: number,
      font: typeof helvetica,
      color = rgb(0, 0, 0),
      lineHeight?: number,
    ) => {
      const actualLineHeight = lineHeight ?? fontSize * 1.4;
      const words = text.split(/\s+/);
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > contentWidth && currentLine) {
          ensureSpace(actualLineHeight);
          page.drawText(currentLine, {
            x: margin,
            y: yPosition,
            size: fontSize,
            font,
            color,
          });
          yPosition -= actualLineHeight;
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        ensureSpace(actualLineHeight);
        page.drawText(currentLine, {
          x: margin,
          y: yPosition,
          size: fontSize,
          font,
          color,
        });
        yPosition -= actualLineHeight;
      }
    };

    // Draw title
    drawText(input.title, 24, helveticaBold, rgb(0.1, 0.1, 0.1));
    yPosition -= 10; // Extra spacing after title

    // Draw separator line
    ensureSpace(20);
    page.drawLine({
      start: { x: margin, y: yPosition },
      end: { x: pageWidth - margin, y: yPosition },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
    yPosition -= 20;

    // Parse and render content
    const lines = input.content.split("\n");
    let inList = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Empty line
      if (!trimmed) {
        yPosition -= 10;
        continue;
      }

      // Heading level 2
      if (trimmed.startsWith("## ")) {
        yPosition -= 10;
        const headingText = trimmed.slice(3);
        drawText(headingText, 16, helveticaBold, rgb(0.2, 0.2, 0.2));
        yPosition -= 5;
        continue;
      }

      // Heading level 3
      if (trimmed.startsWith("### ")) {
        yPosition -= 8;
        const headingText = trimmed.slice(4);
        drawText(headingText, 14, helveticaBold, rgb(0.3, 0.3, 0.3));
        yPosition -= 4;
        continue;
      }

      // List item
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        if (!inList) {
          yPosition -= 5;
          inList = true;
        }
        const itemText = trimmed.slice(2);
        ensureSpace(16);
        // Draw bullet
        page.drawText("•", {
          x: margin + 10,
          y: yPosition,
          size: 12,
          font: helvetica,
          color: rgb(0.4, 0.4, 0.4),
        });
        // Draw item text
        const words = itemText.split(/\s+/);
        let currentLine = "";
        const itemMargin = margin + 25;
        const itemContentWidth = pageWidth - itemMargin - margin;

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = helvetica.widthOfTextAtSize(testLine, 11);

          if (testWidth > itemContentWidth && currentLine) {
            page.drawText(currentLine, {
              x: itemMargin,
              y: yPosition,
              size: 11,
              font: helvetica,
              color: rgb(0.2, 0.2, 0.2),
            });
            yPosition -= 15;
            ensureSpace(15);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }

        if (currentLine) {
          page.drawText(currentLine, {
            x: itemMargin,
            y: yPosition,
            size: 11,
            font: helvetica,
            color: rgb(0.2, 0.2, 0.2),
          });
          yPosition -= 15;
        }
        continue;
      }

      // End of list
      if (inList) {
        yPosition -= 5;
        inList = false;
      }

      // Regular paragraph
      drawText(trimmed, 11, helvetica, rgb(0.15, 0.15, 0.15));
      yPosition -= 5;
    }

    // Add metadata
    pdfDoc.setTitle(input.title);
    pdfDoc.setAuthor(input.metadata?.author ?? "Departify");
    pdfDoc.setSubject(input.metadata?.subject ?? "Business Document");
    if (input.metadata?.keywords) {
      pdfDoc.setKeywords([...input.metadata.keywords]);
    }
    pdfDoc.setCreator("Departify PDF Generator");
    pdfDoc.setProducer("pdf-lib");

    // Serialize to bytes
    const bytes = await pdfDoc.save();

    // Generate filename
    const safeTitle = (input.filename ?? input.title)
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñü\s-]/gi, "")
      .replace(/\s+/g, "-")
      .slice(0, 50);
    const filename = `${safeTitle}.pdf`;

    return {
      success: true,
      bytes,
      filename,
      mimeType: "application/pdf",
      size: bytes.length,
    };
  } catch (error) {
    return {
      success: false,
      filename: "document.pdf",
      mimeType: "application/pdf",
      error: error instanceof Error ? error.message : "Unknown PDF generation error",
    };
  }
}
