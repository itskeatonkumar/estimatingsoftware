/**
 * Construction-specific PDF text post-processing.
 * Runs on already-extracted text items from PDF.js — zero API cost.
 */

// ── TITLE BLOCK EXTRACTION ─────────────────────────────────────
const SHEET_NUM_RE = /^[A-Z]{1,3}\s?[-.]?\s?\d{1,3}(?:[.-]\d{1,3})?(?:\.\d{1,2})?$/;
const SCALE_RE = /(\d+)\s*\/\s*(\d+)\s*[""\u201D]?\s*=\s*(\d+)\s*['''\u2019]\s*-?\s*(\d*)\s*[""\u201D]?/;
const ENG_SCALE_RE = /(\d+)\s*[""\u201D]?\s*=\s*(\d+)\s*['''\u2019]/;
const DATE_RE = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/;

export function extractTitleBlock(textItems, pageWidth, pageHeight) {
  if (!textItems?.length || !pageWidth || !pageHeight) return null;

  // Filter to bottom-right region (title block area)
  const tbItems = textItems.filter(item =>
    item.x > pageWidth * 0.55 && item.y > pageHeight * 0.65 && item.str?.trim()
  );
  if (!tbItems.length) return null;

  // Find sheet number
  let sheetNumber = null;
  for (const item of tbItems) {
    const s = item.str.trim().replace(/\s+/g, '');
    if (SHEET_NUM_RE.test(s)) {
      sheetNumber = s;
      break;
    }
  }

  // Find scale string
  let scaleStr = null;
  const allTbText = tbItems.map(i => i.str).join(' ');
  const scaleMatch = allTbText.match(SCALE_RE) || allTbText.match(ENG_SCALE_RE);
  if (scaleMatch) scaleStr = scaleMatch[0].trim();

  // Also check for "SCALE: X" = Y" patterns
  if (!scaleStr) {
    for (const item of tbItems) {
      if (/scale/i.test(item.str)) {
        const nearby = tbItems.filter(n => Math.abs(n.y - item.y) < 30 && n.x > item.x);
        const combined = nearby.map(n => n.str).join(' ');
        const m = combined.match(SCALE_RE) || combined.match(ENG_SCALE_RE);
        if (m) { scaleStr = m[0].trim(); break; }
      }
    }
  }

  // Find sheet name — largest text near sheet number, or longest non-date/scale text
  let sheetName = null;
  const nameCandidate = tbItems
    .filter(item => {
      const s = item.str.trim();
      if (s.length < 3 || s.length > 60) return false;
      if (SHEET_NUM_RE.test(s.replace(/\s+/g, ''))) return false;
      if (SCALE_RE.test(s) || ENG_SCALE_RE.test(s)) return false;
      if (DATE_RE.test(s)) return false;
      if (/^\d+$/.test(s)) return false;
      if (/^(SCALE|DATE|DRAWN|CHECKED|APPROVED|REV|NO\.|JOB|PROJECT)/i.test(s)) return false;
      return true;
    })
    .sort((a, b) => (b.h || 0) - (a.h || 0)); // largest text first
  if (nameCandidate.length) sheetName = nameCandidate[0].str.trim();

  // Find date
  let date = null;
  const dateMatch = allTbText.match(DATE_RE);
  if (dateMatch) date = dateMatch[1];

  // Find project name — largest text in top portion of title block
  let projectName = null;
  const topTb = tbItems.filter(item => item.y < pageHeight * 0.82);
  if (topTb.length) {
    const largest = topTb.sort((a, b) => (b.h || 0) - (a.h || 0))[0];
    if (largest && largest.str.trim().length >= 4) projectName = largest.str.trim();
  }

  return { sheetNumber, sheetName, scale: scaleStr, date, projectName };
}

// ── SCALE STRING PARSING ────────────────────────────────────────
export function parseScaleString(scaleStr, dpi = 144) {
  if (!scaleStr) return null;

  // Architectural: "1/4" = 1'-0"", "3/16"=1'-0"", "1/8"=1'"
  const archMatch = scaleStr.match(/(\d+)\s*\/\s*(\d+)\s*[""\u201D]?\s*=\s*(\d+)\s*['''\u2019]\s*-?\s*(\d*)\s*[""\u201D]?/);
  if (archMatch) {
    const inchNum = parseInt(archMatch[1]);
    const inchDen = parseInt(archMatch[2]);
    const feet = parseInt(archMatch[3]);
    const inches = parseInt(archMatch[4]) || 0;
    const totalFeet = feet + inches / 12;
    const drawingInches = inchNum / inchDen;
    if (totalFeet > 0) return (drawingInches * dpi) / totalFeet;
  }

  // Engineering: "1" = 10'", "1"=20'"
  const engMatch = scaleStr.match(/(\d+)\s*[""\u201D]?\s*=\s*(\d+)\s*['''\u2019]/);
  if (engMatch) {
    const drawingInches = parseInt(engMatch[1]);
    const realFeet = parseInt(engMatch[2]);
    if (realFeet > 0) return (drawingInches * dpi) / realFeet;
  }

  return null;
}

// ── ROOM LABEL EXTRACTION ───────────────────────────────────────
const ROOM_WORDS = new Set([
  'OFFICE','CORRIDOR','HALLWAY','LOBBY','VESTIBULE','ENTRY','FOYER',
  'MECHANICAL','MECH','ELECTRICAL','ELEC','STORAGE','CLOSET','JANITOR',
  'RESTROOM','BATHROOM','WOMEN','MEN','UNISEX','TOILET',
  'CONFERENCE','MEETING','BREAK','KITCHEN','KITCHENETTE','CAFE',
  'CLASSROOM','LAB','LABORATORY','LIBRARY','STUDIO','WORKSHOP',
  'STAIRWELL','STAIR','ELEVATOR','ELEV','SHAFT',
  'LOADING','DOCK','GARAGE','PARKING','UTILITY','DATA','SERVER',
  'RECEPTION','WAITING','EXAM','NURSE','PHARMACY','CHAPEL',
  'LAUNDRY','LOCKER','GYM','FITNESS','POOL','COURTYARD',
]);
const ROOM_NUM_RE = /^(?:RM\.?|ROOM|SUITE|STE\.?|#)?\s*\d{2,4}[A-Z]?$/i;
const ROOM_LABEL_RE = /^\d{2,4}[A-Z]?$/;

export function extractRoomLabels(textItems, pageWidth, pageHeight) {
  if (!textItems?.length) return [];

  // Exclude title block area and edge dimensions
  const interior = textItems.filter(item => {
    if (!item.str?.trim()) return false;
    if (item.x > pageWidth * 0.55 && item.y > pageHeight * 0.65) return false; // title block
    if (item.x < pageWidth * 0.03 || item.x > pageWidth * 0.97) return false; // edges
    if (item.y < pageHeight * 0.03 || item.y > pageHeight * 0.97) return false;
    return true;
  });

  const labels = [];
  for (const item of interior) {
    const s = item.str.trim().toUpperCase();
    if (s.length < 2 || s.length > 30) continue;

    const isRoomWord = ROOM_WORDS.has(s) || ROOM_WORDS.has(s.replace(/[.\s]/g, ''));
    const isRoomNum = ROOM_NUM_RE.test(s) || ROOM_LABEL_RE.test(s);

    if (isRoomWord || isRoomNum) {
      // Check it's somewhat isolated — not too many items nearby (not a dense paragraph)
      const nearby = interior.filter(n =>
        n !== item && Math.abs(n.x - item.x) < 100 && Math.abs(n.y - item.y) < 20
      );
      if (nearby.length < 4) {
        labels.push({ label: item.str.trim(), x: item.x, y: item.y, w: item.w, h: item.h });
      }
    }
  }

  return labels;
}

// ── DIMENSION EXTRACTION ────────────────────────────────────────
const DIM_PATTERNS = [
  /\d+['''\u2019]\s*-?\s*\d+\s*[""\u201D]?/,    // 12'-6", 4'-0"
  /\d+['''\u2019]\s*-?\s*\d+\s*\d+\/\d+[""\u201D]?/, // 4'-6 1/2"
  /\d+\.\d+['''\u2019]/,                          // 10.5'
  /\d+['''\u2019](?:\s|$)/,                        // 12' (feet only)
];

export function extractDimensions(textItems, pageWidth, pageHeight) {
  if (!textItems?.length) return [];

  // Exclude title block
  const items = textItems.filter(item =>
    item.str?.trim() && !(item.x > pageWidth * 0.55 && item.y > pageHeight * 0.65)
  );

  const dims = [];
  for (const item of items) {
    const s = item.str.trim();
    if (s.length < 2 || s.length > 20) continue;
    for (const pat of DIM_PATTERNS) {
      const m = s.match(pat);
      if (m) {
        dims.push({ value: m[0].trim(), x: item.x, y: item.y, w: item.w, h: item.h });
        break;
      }
    }
  }

  return dims;
}

// ── SPECIFICATION NOTE EXTRACTION ───────────────────────────────
const SPEC_KEYWORDS = [
  'CONC','CONCRETE','CMU','REBAR','PSI','SLAB','FOOTING','FOUNDATION',
  'GRADE','BEAM','COLUMN','PIER','WALL','MASONRY','BRICK','BLOCK',
  'STEEL','STRUCTURAL','W\\d+','HSS','TUBE','ANGLE',
  'INSULATION','MEMBRANE','VAPOR BARRIER','WATERPROOF',
  'GYPSUM','DRYWALL','GWB','PLYWOOD','OSB','SHEATHING',
  'ASPHALT','HMA','BASE COURSE','SUBGRADE','COMPACTED',
  'PIPE','DUCT','CONDUIT','SLEEVE',
  'O\\.?C\\.?','SPACING','EMBED','ANCHOR','DOWEL',
  'FLASHING','CAULK','SEALANT','EXPANSION JOINT',
  'ROOF','PARAPET','CURB','GUTTER',
];
const SPEC_RE = new RegExp(`\\b(${SPEC_KEYWORDS.join('|')})\\b`, 'i');

export function extractSpecNotes(textItems, pageWidth, pageHeight) {
  if (!textItems?.length) return [];

  const notes = [];
  for (const item of textItems) {
    const s = item.str.trim();
    if (s.length < 8 || s.length > 120) continue;
    if (SPEC_RE.test(s)) {
      // Exclude pure dimension strings
      if (/^\d+[''"\s\-]+\d*[''"]?$/.test(s)) continue;
      notes.push({ text: s, x: item.x, y: item.y });
    }
  }

  return notes;
}

// ── COMBINED POST-PROCESSOR ─────────────────────────────────────
export function postProcessOcrItems(ocrItems, pageWidth, pageHeight) {
  const titleBlock = extractTitleBlock(ocrItems, pageWidth, pageHeight);
  const roomLabels = extractRoomLabels(ocrItems, pageWidth, pageHeight);
  const dimensions = extractDimensions(ocrItems, pageWidth, pageHeight);
  const specNotes = extractSpecNotes(ocrItems, pageWidth, pageHeight);
  const detectedScale = titleBlock?.scale || null;
  const parsedScale = parseScaleString(detectedScale);

  return { titleBlock, roomLabels, dimensions, specNotes, detectedScale, parsedScale };
}
