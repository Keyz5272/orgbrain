import type { KnowledgeSourceType } from "./index";

export type KnowledgeContentType =
  | "text"
  | "heading"
  | "table"
  | "row"
  | "cell"
  | "image_text"
  | "image_region"
  | "transcript"
  | "scene"
  | "slide"
  | "email"
  | "web_content"
  | "other";

export type ProcessorContent = {
  content_type: KnowledgeContentType;

  content?: string | null;

  structured_data?: Record<string, unknown>;

  page_number?: number | null;

  sheet_name?: string | null;

  row_number?: number | null;

  start_timestamp?: number | null;

  end_timestamp?: number | null;

  section?: string | null;

  content_index?: number | null;

  metadata?: Record<string, unknown>;
};

export type ProcessorResult = {
  success: boolean;

  source_type: KnowledgeSourceType;

  contents: ProcessorContent[];

  memories?: ProcessorMemory[];

  metadata?: Record<string, unknown>;

  error?: string;
};

export type ProcessorMemory = {
  memory_type: string;

  title: string;

  content: string;

  subject?: string | null;

  object?: string | null;

  attributes?: Record<string, unknown>;

  confidence?: number | null;

  source_content_index?: number | null;
};

export type ProcessorContext = {
  sourceId: string;

  organizationId: string;

  filename: string;

  mimeType?: string | null;

  storagePath: string;
};

export interface KnowledgeProcessor {
  name: string;

  supportedSourceTypes: KnowledgeSourceType[];

  process(
    context: ProcessorContext,
    file: Buffer
  ): Promise<ProcessorResult>;
}