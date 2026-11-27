// The handout pane beside the code on a 1280x800 screen, where the tutor folds to make room.
import handoutPdf, { options as pdfOptions } from './handout-pdf.mjs';

export const description = 'The handout pane at 1280x800';

export const options = pdfOptions;

export default async function (page) {
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await handoutPdf(page);
}
