import {
  detectProcessor,
  detectSourceType,
  type ProcessorName,
  type KnowledgeSourceType,
} from "./index";

import type {
  KnowledgeProcessor,
  ProcessorContext,
  ProcessorResult,
} from "./types";

const processorRegistry = new Map<
  ProcessorName,
  KnowledgeProcessor
>();

/**
 * Register a knowledge processor.
 */
export function registerProcessor(
  processor: KnowledgeProcessor
) {
  processorRegistry.set(
    processor.name as ProcessorName,
    processor
  );
}

/**
 * Get a registered processor.
 */
export function getProcessor(
  name: ProcessorName
) {
  return processorRegistry.get(name);
}

/**
 * Detect the appropriate processor for a source.
 */
export function resolveProcessor(
  filename: string,
  mimeType?: string | null
): {
  processorName: ProcessorName;
  sourceType: KnowledgeSourceType;
} {
  const processorName = detectProcessor(
    filename,
    mimeType
  );

  const sourceType = detectSourceType(
    filename,
    mimeType
  );

  return {
    processorName,
    sourceType,
  };
}

/**
 * Process a source using its registered processor.
 */
export async function processKnowledgeSource(
  context: ProcessorContext,
  file: Buffer
): Promise<ProcessorResult> {
  const {
    processorName,
    sourceType,
  } = resolveProcessor(
    context.filename,
    context.mimeType
  );

  const processor =
    getProcessor(processorName);

  if (!processor) {
    return {
      success: false,
      source_type: sourceType,
      contents: [],
      memories: [],
      error:
        `No processor registered for "${processorName}".`,
    };
  }

  try {
    return await processor.process(
      context,
      file
    );
  } catch (error: unknown) {
    console.error(
      `PROCESSOR ERROR [${processorName}]:`,
      error
    );

    return {
      success: false,
      source_type: sourceType,
      contents: [],
      memories: [],
      error:
        error instanceof Error
          ? error.message
          : "Source processing failed.",
    };
  }
}

/**
 * List all currently registered processors.
 */
export function listProcessors() {
  return Array.from(
    processorRegistry.keys()
  );
}