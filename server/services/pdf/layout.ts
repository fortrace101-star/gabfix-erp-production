import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dirname, '..', '..', 'assets', 'fonts');

/**
 * PDF documents (Phase 2, plan §12).
 *
 * One generator, many consumers: the same renderDocument() Buffer is served
 * by the download route, mirrored into DOCUMENT_STORAGE_DIR for messaging,
 * and attached to email/WhatsApp later — byte-identical for a given
 * document (the plan's "one generator" rule). Inter TTF faces are embedded
 * from server/assets/fonts so the em dash, middle dot and tabular numerals
 * used across the UI render identically and no glyph is lost to WinAnsi;
 * every string still passes through sanitize() as a safety net.
 *
 * Layout kit: pageHeader (brand block + document title), metaGrid (label/
 * value pairs), itemsTable (two shading bands + money right-aligned) and a
 * totalsBlock. Document numbering comes from the DB, never the browser.
 */

// Embed Inter TTF faces when present (plan: server/assets/fonts/Inter-*.ttf).
// Falls back to standard PDF fonts if the files are missing so the server still
// boots in environments without the font bundle on disk.
const regularFont = join(fontsDir, 'Inter-Regular.ttf');
const boldFont = join(fontsDir, 'Inter-Bold.ttf');
const hasRegular = existsSync(regularFont);
const hasBold = existsSync(boldFont);
const FONT = hasRegular ? 'Inter' : 'Helvetica';
const FONT_BOLD = hasBold ? 'Inter-Bold' : 'Helvetica-Bold';

type Money = number | null | undefined;

export type MetaPair = { label: string; value: string };

export type ItemRow = {
  cells: string[];
  amount?: Money;
  /** Dim highlight for the subtotal/total rows. */
  emphasis?: boolean;
};

export type TotalsPair = { label: string; value: string; emphasis?: boolean };

export type DocumentInput = {
  title: string;
  reference: string;
  brand?: { name: string; tagline?: string; phone?: string; address?: string };
  meta?: MetaPair[];
  sections?: {
    heading?: string;
    columns?: string[];
    rows?: ItemRow[];
  }[];
  totals?: TotalsPair[];
  footerNote?: string;
};

const PAGE_MARGIN = 48;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2; // A4 portrait, pdfkit default

/** WinAnsi-safe text: pdfkit's standard fonts have no em dash or middle dot. */
const sanitize = (value: unknown): string =>
  String(value ?? '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00b7/g, '.')
    .replace(/[^\x20-\x7E\n]/g, '');

const money = (value: Money): string =>
  value === null || value === undefined ? '-' : Math.round(value).toLocaleString('en-US');

export async function renderDocument(input: DocumentInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, info: { Title: input.title } });
  // Register Inter TTF faces on this document instance (pdfkit 0.20.x instance method).
  if (hasRegular) doc.registerFont('Inter', regularFont);
  if (hasBold) doc.registerFont('Inter-Bold', boldFont);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  pageHeader(doc, input);
  if (input.meta?.length) metaGrid(doc, input.meta, 130);

  let y = (input.meta?.length ? Math.ceil(input.meta.length / 3) * 34 : 0) + 150;
  for (const section of input.sections ?? []) {
    if (section.heading) {
      doc.font(FONT_BOLD).fontSize(11).fillColor('#111827').text(section.heading, PAGE_MARGIN, y);
      y += 20;
    }
    y = itemsTable(doc, section, y) + 18;
  }

  if (input.totals?.length) y = totalsBlock(doc, input.totals, y);
  if (input.footerNote) {
    doc.font(FONT).fontSize(8.5).fillColor('#6b7280').text(sanitize(input.footerNote), PAGE_MARGIN, y + 8, {
      width: CONTENT_WIDTH,
    });
  }
  pageFooters(doc, input.reference);

  doc.end();
  return done;
}

/** Brand block + document title; returns nothing, advances nothing. */
function pageHeader(doc: PDFKit.PDFDocument, input: DocumentInput) {
  doc.font(FONT_BOLD).fontSize(16).fillColor('#111827').text(input.brand?.name ?? 'Gabfix', PAGE_MARGIN, PAGE_MARGIN);
  if (input.brand?.tagline) {
    doc.font(FONT).fontSize(8.5).fillColor('#6b7280').text(sanitize(input.brand.tagline), PAGE_MARGIN, PAGE_MARGIN + 22);
  }
  const contact = [input.brand?.phone, input.brand?.address].filter(Boolean).map(sanitize).join('  |  ');
  if (contact) {
    doc.font(FONT).fontSize(8.5).fillColor('#6b7280').text(contact, PAGE_MARGIN, PAGE_MARGIN + 34);
  }
  doc.font(FONT_BOLD).fontSize(13).fillColor('#111827').text(input.title, PAGE_MARGIN, PAGE_MARGIN + 58);
  doc.font(FONT).fontSize(9).fillColor('#374151').text(sanitize(input.reference), PAGE_MARGIN, PAGE_MARGIN + 76);
  doc.moveTo(PAGE_MARGIN, PAGE_MARGIN + 92).lineTo(595.28 - PAGE_MARGIN, PAGE_MARGIN + 92).lineWidth(1).strokeColor('#e5e7eb').stroke();
}

/** Three-per-row label/value grid under the header. */
function metaGrid(doc: PDFKit.PDFDocument, pairs: MetaPair[], top: number) {
  const colWidth = CONTENT_WIDTH / 3;
  pairs.forEach((pair, index) => {
    const x = PAGE_MARGIN + (index % 3) * colWidth;
    const y = top + Math.floor(index / 3) * 34;
    doc.font(FONT).fontSize(7.5).fillColor('#6b7280').text(sanitize(pair.label).toUpperCase(), x, y);
    doc.font(FONT_BOLD).fontSize(9.5).fillColor('#111827').text(sanitize(pair.value), x, y + 11, { width: colWidth - 8 });
  });
}

/** One table; returns the y after it. Rows shade in pairs; amounts right-align. */
function itemsTable(doc: PDFKit.PDFDocument, section: NonNullable<DocumentInput['sections']>[number], top: number): number {
  const columns = section.columns ?? [];
  const rows = section.rows ?? [];
  if (!rows.length) return top;

  const hasAmount = rows.some((row) => row.amount !== undefined);
  const amountWidth = hasAmount ? 90 : 0;
  const tableWidth = CONTENT_WIDTH - amountWidth;
  const colWidth = columns.length ? tableWidth / columns.length : tableWidth;

  let y = top;
  if (columns.length) {
    doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 20).fill('#111827');
    let x = PAGE_MARGIN;
    for (const column of columns) {
      doc.font(FONT_BOLD).fontSize(8).fillColor('#ffffff').text(sanitize(column).toUpperCase(), x + 6, y + 6, { width: colWidth - 12 });
      x += colWidth;
    }
    if (hasAmount) {
      doc.font(FONT_BOLD).fontSize(8).fillColor('#ffffff').text('AMOUNT', PAGE_MARGIN + tableWidth, y + 6, { width: amountWidth - 12, align: 'right' });
    }
    y += 20;
  }

  rows.forEach((row, index) => {
    const cells = row.cells;
    const rowHeight = Math.max(22, Math.ceil((Math.max(...cells.map((cell) => sanitize(cell).length)) * 4.6) / colWidth) * 14 + 8);
    if (row.emphasis || index % 2 === 1) {
      doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowHeight).fill(row.emphasis ? '#f3f4f6' : '#f9fafb');
    }
    let x = PAGE_MARGIN;
    cells.forEach((cell, cellIndex) => {
      doc
        .font(row.emphasis ? FONT_BOLD : FONT)
        .fontSize(9)
        .fillColor('#111827')
        .text(sanitize(cell), x + 6, y + 6, { width: colWidth - 12 });
      x += colWidth;
    });
    if (hasAmount) {
      doc
        .font(row.emphasis ? FONT_BOLD : FONT)
        .fontSize(9)
        .fillColor('#111827')
        .text(money(row.amount), PAGE_MARGIN + tableWidth, y + 6, { width: amountWidth - 12, align: 'right' });
    }
    y += rowHeight;
  });
  return y;
}

/** Right-aligned totals under the table. */
function totalsBlock(doc: PDFKit.PDFDocument, pairs: TotalsPair[], top: number): number {
  let y = top;
  const labelX = PAGE_MARGIN + CONTENT_WIDTH - 260;
  for (const pair of pairs) {
    doc.font(pair.emphasis ? FONT_BOLD : FONT).fontSize(pair.emphasis ? 11 : 9.5).fillColor('#111827');
    doc.text(sanitize(pair.label), labelX, y, { width: 130, align: 'right' });
    doc.text(sanitize(pair.value), labelX + 134, y, { width: 126, align: 'right' });
    y += pair.emphasis ? 22 : 17;
  }
  return y;
}

/** "Page 1 of N" footer on every page, plus the reference bottom-left. */
function pageFooters(doc: PDFKit.PDFDocument, reference: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font(FONT).fontSize(8).fillColor('#9ca3af').text(sanitize(reference), PAGE_MARGIN, 810, { lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE_MARGIN, 810, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });
  }
}
