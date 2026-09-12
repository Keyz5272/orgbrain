import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type OcrResult = {
  success: boolean;
  text: string;
  error?: string;
};

export async function extractTextFromImage(
  file: Buffer,
  mimeType: string
): Promise<OcrResult> {
  try {
    const base64 = file.toString("base64");

    const dataUrl =
      `data:${mimeType};base64,${base64}`;

    const response =
      await openai.responses.create({
        model: "gpt-5.6-luna",

        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Extract all readable text from this image exactly as it appears. Preserve useful line breaks. Do not explain, summarize, or add commentary. If no readable text exists, return an empty response.",
              },

              {
                type: "input_image",
                image_url: dataUrl,
                detail: "high",
              },
            ],
          },
        ],
      });

    const text =
      response.output_text?.trim() ?? "";

    return {
      success: true,
      text,
    };
  } catch (error: unknown) {
    console.error(
      "OPENAI OCR ERROR:",
      error
    );

    return {
      success: false,
      text: "",
      error:
        error instanceof Error
          ? error.message
          : "Image OCR failed.",
    };
  }
}