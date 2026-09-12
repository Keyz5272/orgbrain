import { registerProcessor } from "./manager";

import { spreadsheetProcessor } from "./spreadsheet";
import { documentProcessor } from "./document";

import { pdfProcessor } from "./pdf";

import { imageProcessor } from "./image";


/**
 * Register all OrgBrain processors.
 *
 * New processors are added here as they are implemented.
 */
export function registerKnowledgeProcessors() {
  registerProcessor(
    spreadsheetProcessor
  );

  registerProcessor(
    documentProcessor
  );

    registerProcessor(pdfProcessor);

      registerProcessor(imageProcessor);

}