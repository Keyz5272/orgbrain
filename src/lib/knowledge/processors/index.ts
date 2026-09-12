export type KnowledgeSourceType =
  | "document"
  | "spreadsheet"
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "email"
  | "webpage"
  | "presentation"
  | "text"
  | "other";

export type ProcessorName =
  | "document"
  | "spreadsheet"
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "email"
  | "webpage"
  | "presentation"
  | "text"
  | "generic";

export type ProcessorDefinition = {
  name: ProcessorName;
  sourceTypes: KnowledgeSourceType[];
  mimeTypes: string[];
  extensions: string[];
};

export const PROCESSORS: ProcessorDefinition[] = [
  {
    name: "spreadsheet",
    sourceTypes: ["spreadsheet"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ],
    extensions: [".xlsx", ".xls", ".csv"],
  },

  {
    name: "document",
    sourceTypes: ["document"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ],
    extensions: [".docx", ".doc"],
  },

  {
    name: "pdf",
    sourceTypes: ["pdf"],
    mimeTypes: ["application/pdf"],
    extensions: [".pdf"],
  },

  {
    name: "image",
    sourceTypes: ["image"],
    mimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml",
    ],
    extensions: [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".gif",
      ".svg",
    ],
  },

  {
    name: "audio",
    sourceTypes: ["audio"],
    mimeTypes: [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/m4a",
      "audio/mp4",
      "audio/webm",
      "audio/ogg",
    ],
    extensions: [
      ".mp3",
      ".wav",
      ".m4a",
      ".mp4",
      ".webm",
      ".ogg",
    ],
  },

  {
    name: "video",
    sourceTypes: ["video"],
    mimeTypes: [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
    ],
    extensions: [
      ".mp4",
      ".webm",
      ".mov",
      ".avi",
      ".mkv",
    ],
  },

  {
    name: "presentation",
    sourceTypes: ["presentation"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
    ],
    extensions: [".pptx", ".ppt"],
  },

  {
    name: "text",
    sourceTypes: ["text"],
    mimeTypes: [
      "text/plain",
      "text/markdown",
      "text/csv",
    ],
    extensions: [".txt", ".md"],
  },

  {
    name: "email",
    sourceTypes: ["email"],
    mimeTypes: [
      "message/rfc822",
      "application/vnd.ms-outlook",
    ],
    extensions: [".eml", ".msg"],
  },

  {
    name: "webpage",
    sourceTypes: ["webpage"],
    mimeTypes: ["text/html"],
    extensions: [".html", ".htm"],
  },
];

function normalizeExtension(filename: string) {
  const lastDot = filename.lastIndexOf(".");

  if (lastDot === -1) {
    return "";
  }

  return filename
    .slice(lastDot)
    .toLowerCase();
}

export function detectProcessor(
  filename: string,
  mimeType?: string | null
): ProcessorName {
  const extension = normalizeExtension(filename);

  const normalizedMime =
    mimeType?.toLowerCase() || "";

  const processor = PROCESSORS.find((item) => {
    const mimeMatch =
      normalizedMime &&
      item.mimeTypes.includes(normalizedMime);

    const extensionMatch =
      extension &&
      item.extensions.includes(extension);

    return mimeMatch || extensionMatch;
  });

  return processor?.name || "generic";
}

export function detectSourceType(
  filename: string,
  mimeType?: string | null
): KnowledgeSourceType {
  const processorName = detectProcessor(
    filename,
    mimeType
  );

  switch (processorName) {
    case "spreadsheet":
      return "spreadsheet";

    case "document":
      return "document";

    case "pdf":
      return "pdf";

    case "image":
      return "image";

    case "audio":
      return "audio";

    case "video":
      return "video";

    case "presentation":
      return "presentation";

    case "email":
      return "email";

    case "webpage":
      return "webpage";

    case "text":
      return "text";

    default:
      return "other";
  }
}