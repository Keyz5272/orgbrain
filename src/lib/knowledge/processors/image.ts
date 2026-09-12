import {
  extractTextFromImage,
} from "../ocr";

import type {
  KnowledgeProcessor,
  ProcessorContext,
  ProcessorResult,
  ProcessorContent,
} from "./types";

/**
 * Image Processor
 *
 * Responsibilities:
 * - Validate image input
 * - Detect basic image dimensions
 * - Preserve image metadata
 * - Extract readable text using OCR
 * - Store image metadata and OCR text
 *
 * Visual understanding will be added later.
 */

function getImageDimensions(
  file: Buffer
): {
  width: number | null;
  height: number | null;
} {
  // PNG
  if (
    file.length >= 24 &&
    file.toString("ascii", 1, 4) === "PNG"
  ) {
    return {
      width: file.readUInt32BE(16),
      height: file.readUInt32BE(20),
    };
  }

  // JPEG
  if (
    file.length >= 24 &&
    file[0] === 0xff &&
    file[1] === 0xd8
  ) {
    let offset = 2;

    while (offset < file.length) {
      if (file[offset] !== 0xff) {
        offset++;
        continue;
      }

      const marker = file[offset + 1];

      // Start Of Frame markers
      if (
        marker >= 0xc0 &&
        marker <= 0xc3
      ) {
        const height =
          file.readUInt16BE(offset + 5);

        const width =
          file.readUInt16BE(offset + 7);

        return {
          width,
          height,
        };
      }

      const segmentLength =
        file.readUInt16BE(offset + 2);

      if (!segmentLength) {
        break;
      }

      offset += 2 + segmentLength;
    }
  }

  return {
    width: null,
    height: null,
  };
}

async function processImage(
  context: ProcessorContext,
  file: Buffer
): Promise<ProcessorResult> {
  try {
    if (!file || file.length === 0) {
      return {
        success: false,
        source_type: "image",
        contents: [],
        memories: [],
        error: "Image file is empty.",
      };
    }

    const {
      width,
      height,
    } = getImageDimensions(file);

    /*
     * OCR
     */
    const ocrResult =
      await extractTextFromImage(
        file,
        context.mimeType || "image/jpeg"
      );

    /*
     * Image metadata content
     */
    const imageContent: ProcessorContent = {
      content_type: "image_region",

      content:
        `Image: ${context.filename}`,

      content_index: 0,

      metadata: {
        source_id:
          context.sourceId,

        filename:
          context.filename,

        mime_type:
          context.mimeType ?? null,

        processor:
          "image",

        width,

        height,

        file_size:
          file.length,
      },

      structured_data: {
        image: {
          width,
          height,
        },

        filename:
          context.filename,

        mime_type:
          context.mimeType ?? null,
      },
    };

    /*
     * Start with the image metadata content.
     */
    const contents: ProcessorContent[] = [
      imageContent,
    ];

    /*
     * Add OCR text when OCR succeeds
     * and readable text was found.
     */
    if (
      ocrResult.success &&
      ocrResult.text
    ) {
      contents.push({
        content_type: "image_text",

        content:
          ocrResult.text,

        content_index: 1,

        metadata: {
          source_id:
            context.sourceId,

          filename:
            context.filename,

          mime_type:
            context.mimeType ?? null,

          processor:
            "image",

          ocr: true,
        },

        structured_data: {
          text:
            ocrResult.text,

          extraction_method:
            "openai_ocr",
        },
      });
    }

    /*
     * Return processed knowledge.
     */
    return {
      success: true,

      source_type: "image",

      contents,

      memories: [],

      metadata: {
        processor: "image",

        filename:
          context.filename,

        mime_type:
          context.mimeType ?? null,

        width,

        height,

        file_size:
          file.length,

        content_count:
          contents.length,

        ocr_status:
          ocrResult.success
            ? "completed"
            : "failed",

        ocr_error:
          ocrResult.error ?? null,

        ocr_text_length:
          ocrResult.text.length,

        visual_analysis_status:
          "not_implemented",
      },
    };
  } catch (error: unknown) {
    console.error(
      "IMAGE PROCESSOR ERROR:",
      error
    );

    return {
      success: false,

      source_type: "image",

      contents: [],

      memories: [],

      error:
        error instanceof Error
          ? error.message
          : "Image processing failed.",
    };
  }
}

export const imageProcessor:
  KnowledgeProcessor = {
  name: "image",

  supportedSourceTypes: [
    "image",
  ],

  process:
    processImage,
};