const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const Tesseract = require('tesseract.js');

const SECTION_HEADINGS = /^(about me|summary|professional summary|objective|profile|professional experience|work experience|experience|education background|education|hard skill|soft skill|skills?|projects?|certifications?|achievements?|my contact|contact)$/i;
const CONTACT_FIELD = /^(phone|email|address|linkedin|github|portfolio|website)\s*:/i;
const BULLET = /^[*•▪‣◦«]\s*|^-\s+/;

// Groups items sharing a page into visual lines (by y position), sorted top-to-bottom.
function linesFromItems(items) {
  const byY = new Map();
  for (const item of items) {
    if (!byY.has(item.y)) byY.set(item.y, []);
    byY.get(item.y).push(item);
  }
  return Array.from(byY.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => {
      parts.sort((a, b) => a.x - b.x);
      return parts.map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();
    })
    .filter(text => text.length > 0);
}

// Finds the widest horizontal gap between item start-positions to locate a column gutter.
function detectColumnSplit(xValues, pageWidth) {
  const xs = [...new Set(xValues.map(x => Math.round(x)))].sort((a, b) => a - b);
  let bestGap = 0;
  let splitAt = null;
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    if (gap > bestGap) {
      bestGap = gap;
      splitAt = (xs[i] + xs[i - 1]) / 2;
    }
  }
  return bestGap > pageWidth * 0.03 ? splitAt : null;
}

// Falls back to OCR for pages with no real text layer (e.g. flattened/scanned PDFs).
// Note: decorative/script fonts (e.g. a stylized name banner) can still come out
// truncated or garbled — OCR reads pixels, not glyphs, so this is a hard limit.
async function ocrPage(buffer, pageNumber) {
  const parser = new PDFParse({ data: buffer });
  const screenshot = await parser.getScreenshot({ scale: 2, partial: [pageNumber] });
  await parser.destroy();
  const { data } = await Tesseract.recognize(screenshot.pages[0].data, 'eng');
  return data.text;
}

async function extractText(filePath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buffer = fs.readFileSync(filePath);
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;

  const pageTexts = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items = content.items
      .filter(item => item.str && item.str.trim())
      .map(item => ({
        x: item.transform[4],
        y: Math.round(item.transform[5]),
        text: item.str,
      }));

    if (items.length === 0) {
      console.log(`⚠️  Page ${pageNum} has no text layer, running OCR...`);
      pageTexts.push(await ocrPage(buffer, pageNum));
      continue;
    }

    // Partition into columns by x-position *before* grouping into lines, so that
    // left/right items sharing a y-coordinate never get merged into one line.
    const splitAt = detectColumnSplit(items.map(i => i.x), viewport.width);
    const ordered = splitAt == null
      ? linesFromItems(items)
      : [...linesFromItems(items.filter(i => i.x >= splitAt)), ...linesFromItems(items.filter(i => i.x < splitAt))];

    pageTexts.push(ordered.join('\n'));
  }

  return pageTexts.join('\n\n');
}

// Inserts a newline before each contact keyword so a combined line like
// "Phone: X Email: Y Address: Z" reads as one field per line.
function normalizeContactLine(line) {
  return line.replace(/\s+(Phone|Email|Address|LinkedIn|GitHub|Portfolio|Website)\s*:/gi, '\n$1:').trim();
}

// Pulls contact-field lines (Phone:/Email:/Address:/LinkedIn:/etc.) out of whichever
// sections they landed in, and gathers them into one standalone "Contact Info" section
// inserted where the first one was found.
function extractContactFields(sections) {
  const CONTACT_PLACEHOLDER = Symbol('contact');
  const contactLines = [];
  const result = [];
  let placed = false;

  for (const section of sections) {
    const idx = section.findIndex((line, i) => i > 0 && CONTACT_FIELD.test(line));
    if (idx === -1) {
      result.push(section);
      continue;
    }
    const before = section.slice(0, idx);
    const after = section.slice(idx);
    contactLines.push(...after);
    if (before.length) result.push(before);
    if (!placed) {
      result.push(CONTACT_PLACEHOLDER);
      placed = true;
    }
  }

  if (!placed) return sections;

  const flattenedContact = contactLines.flatMap(line => normalizeContactLine(line).split('\n'));
  return result.map(section =>
    section === CONTACT_PLACEHOLDER ? ['Contact Info', ...flattenedContact] : section
  );
}

// Splits a "Projects" section into one chunk per project, using each "Tools:" line
// as the anchor (the line right before it is taken as that project's title).
function splitProjectsSection(section) {
  if (!/^projects?$/i.test(section[0])) return [section];

  const body = section.slice(1);
  const toolsIdx = body.map((line, i) => (/^tools\s*:/i.test(line) ? i : -1)).filter(i => i >= 0);
  if (toolsIdx.length < 2) return [section];

  const titleIdx = toolsIdx.map(i => Math.max(0, i - 1));
  const blocks = [];
  for (let k = 0; k < titleIdx.length; k++) {
    const start = titleIdx[k];
    const end = k + 1 < titleIdx.length ? titleIdx[k + 1] : body.length;
    const block = body.slice(start, end);
    block[0] = `Project: ${block[0]}`;
    blocks.push(block);
  }
  return blocks;
}

// Splits a bullet-list section (e.g. Achievements, Certifications) into one chunk
// per bullet, so each independent fact is retrievable on its own. Wrapped
// continuation lines (no bullet marker) are folded into the preceding bullet.
function splitBulletSection(section, headingPattern, label) {
  if (!headingPattern.test(section[0])) return [section];

  const body = section.slice(1);
  const bulletIdx = body.map((line, i) => (BULLET.test(line) ? i : -1)).filter(i => i >= 0);
  if (bulletIdx.length < 2) return [section];

  const blocks = [];
  for (let k = 0; k < bulletIdx.length; k++) {
    const start = bulletIdx[k];
    const end = k + 1 < bulletIdx.length ? bulletIdx[k + 1] : body.length;
    const text = body.slice(start, end).map(line => line.replace(BULLET, '').trim()).join(' ');
    blocks.push([`${label}: ${text}`]);
  }
  return blocks;
}

function splitIntoChunks(rawText, linesPerChunk = 4) {
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);

  const sections = [];
  let current = [];
  for (const line of lines) {
    if (SECTION_HEADINGS.test(line) && current.length) {
      sections.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) sections.push(current);

  const sawHeadings = sections.length > 1;
  if (!sawHeadings) {
    // Fallback: no recognizable section headings, group by fixed line count.
    const chunks = [];
    for (let i = 0; i < lines.length; i += linesPerChunk) {
      chunks.push(lines.slice(i, i + linesPerChunk).join('\n'));
    }
    return chunks.filter(chunk => chunk.length > 20);
  }

  const withContact = extractContactFields(sections);
  const withProjects = withContact.flatMap(splitProjectsSection);
  const withAchievements = withProjects.flatMap(s => splitBulletSection(s, /^achievements?$/i, 'Achievement'));
  const withCertifications = withAchievements.flatMap(s => splitBulletSection(s, /^certifications?$/i, 'Certification'));

  // Keep even very short sections (e.g. a standalone name/title line) —
  // dropping them by length would silently discard real, retrievable content.
  return withCertifications
    .map(section => section.join('\n'))
    .filter(chunk => chunk.trim().length > 0);
}

function saveChunks(chunks) {
  fs.writeFileSync('resume.json', JSON.stringify({ chunks }, null, 2));
  console.log(`✅ Extracted ${chunks.length} chunks → resume.json`);
}

async function main() {
  const rawText = await extractText('../data/resume.pdf');
  const chunks = splitIntoChunks(rawText);
  saveChunks(chunks);
}

main();
