// The viewer's file reads (view_read in viewer.rs): the bytes of a PDF or a picture.
//
//   options.views: { path: spec }   files that exist only for the viewer, listed in the tree, as
//     { pdf: ['text of page 1', …], size? }  a real PDF with those pages, each a line of text;
//                                    size is [width, height] in points (a US Letter page if absent)
//     { png: true }                    a small red picture
//     { bytes: 'text' }                 exactly these bytes
//     { error: { code, message?, size? } }  what view_read refuses with
// A text file in the fixture (an SVG, say) is read as its own bytes. window.__viewReads counts
// reads per path, and window.__external the links opened in the browser.

const mock = window.__mock;
const files = mock.files;
const views = mock.options.views || {};
window.__viewReads = {};

// Every page starts with nothing remembered, so one test's handout does not reappear in the next.
for (const key of Object.keys(localStorage)) if (key.startsWith('longhand.viewer:')) localStorage.removeItem(key);

for (const path of Object.keys(views)) if (!(path in files)) files[path] = '';

/** A minimal PDF whose pages each show one line of Helvetica text, with a correct xref table. */
function makePdf(pages, [width, height] = [612, 792]) {
  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, i) => {
    const stream = `BT /F1 24 Tf 72 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    objects[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAAN0lEQVR4nO3OQQ0AMAgEMIShBMWTNRccjyYV0HrTp1R8ICQkJJQeCAkJCaUHQkJCQumBkJDQsg/1ojR5Db5bAAAAAABJRU5ErkJggg==';
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

mock.commands.view_read = ({ rel }) => {
  window.__viewReads[rel] = (window.__viewReads[rel] || 0) + 1;
  const spec = views[rel];
  if (spec?.error) throw spec.error;
  if (spec?.pdf) return makePdf(spec.pdf, spec.size);
  if (spec?.png) return fromBase64(PNG);
  if (spec?.bytes != null) return new TextEncoder().encode(spec.bytes);
  if (rel in files) return new TextEncoder().encode(files[rel]);
  throw { code: 'missing', message: `${rel} no longer exists` };
};

// Links the viewer opens in the browser; window.__external lists them.
mock.commands.open_external = ({ url }) => void (window.__external = [...(window.__external || []), url]);
