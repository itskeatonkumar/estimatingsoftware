import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const COMPANY_INFO = {
  fcg: { name: 'Foundation Construction Group LLC', address: '1234 Construction Way', city: 'Charlotte, NC 28202', phone: '(704) 555-0100', email: 'estimates@fcgllc.com' },
  brc: { name: 'BR Concrete Inc.', address: '5678 Concrete Blvd', city: 'Charlotte, NC 28205', phone: '(704) 555-0200', email: 'estimates@brconcrete.com' },
  p4s: { name: 'P4S Corp', address: '9012 Industrial Dr', city: 'Charlotte, NC 28210', phone: '(704) 555-0300', email: 'estimates@p4scorp.com' },
  default: { name: 'My Company', address: '', city: '', phone: '', email: '' },
};

const UNIT_MAP = { SF: 'ft\u00B2', LF: 'lf', EA: 'ea', CY: 'cy', LS: 'ls', TN: 'tn', LB: 'lb', HR: 'hr' };

const DEFAULT_TERMS = [
  'We are insured and bondable (Bond not included).',
  'This bid is good for thirty (30) days from the bid date.',
  'We comply with Davis-Bacon and Related Acts for wages and reporting if required. Otherwise, Nonunion.',
  'We exclude rock demolition.',
  'We exclude detectable warning mats.',
  'We exclude any waterproofing or drainage.',
  'Standard curing methods will be applied.',
  'Clear and safe access to the work area is required.',
  'Assumes that the subgrade is at proper elevation and compacted.',
  'No concrete or soil testing. No termite treatment.',
  'Traffic Control \u2013 Not included, available upon request.',
];

const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
const addDays = (d, n) => { const dt = new Date(d + 'T00:00:00'); dt.setDate(dt.getDate() + n); return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); };

export function generateProposalPdf({ project, items, plans, categories, overheadPct, profitPct, companyId, clientInfo, companyProfile, proposalScope, proposalTerms }) {
  try {
  const co = companyProfile?.name ? companyProfile : (COMPANY_INFO[companyId] || COMPANY_INFO[project.company] || COMPANY_INFO.default);
  const client = clientInfo?.name ? clientInfo : { name: project.gc_name || '', company: '', address: project.address || '', email: '', phone: '' };

  const doc = new jsPDF('p', 'pt', 'letter'); // 612 x 792
  const W = 612, H = 792;
  const M = 54; // 0.75" margins
  const contentW = W - M * 2;
  const leftColW = contentW * 0.38;
  const rightColW = contentW * 0.58;
  const rightColX = M + leftColW + contentW * 0.04;
  const gray = [136, 136, 136];
  const dark = [51, 51, 51];
  const lineGray = [200, 200, 200];
  let y = M;

  const planMap = new Map(plans.map(p => [p.id, p]));

  // ═══════════════════════════════════════════════════════
  // HEADER ZONE
  // ═══════════════════════════════════════════════════════

  // Project name — left
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...dark);
  const projLines = doc.splitTextToSize(project.name || 'Project Proposal', leftColW + 120);
  doc.text(projLines, M, y + 14);
  const projH = projLines.length * 22;

  // "JOB ESTIMATE" — right
  doc.setFontSize(16);
  doc.setTextColor(...gray);
  doc.text('JOB ESTIMATE', W - M, y + 14, { align: 'right' });

  // Quote details — right, below JOB ESTIMATE
  let qy = y + 34;
  doc.setFontSize(9);
  const today = new Date().toISOString().slice(0, 10);
  const qLabelX = W - M - 140;
  const qValX = W - M;
  const quoteLines = [
    ['DATE OF QUOTE:', fmtDate(today)],
    ['VALID UNTIL:', addDays(today, 30)],
    ['QUOTE NO.:', '\u2014'],
  ];
  for (const [lbl, val] of quoteLines) {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...gray);
    doc.text(lbl, qLabelX, qy);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...dark);
    doc.text(val, qValX, qy, { align: 'right' });
    qy += 14;
  }

  // Company info — left, below project name
  y += Math.max(projH, 10) + 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...dark);
  doc.text(co.name, M, y);
  y += 13;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...gray);
  doc.setFontSize(9);
  if (co.address) { doc.text(co.address, M, y); y += 11; }
  if (co.city) { doc.text(co.city, M, y); y += 11; }
  if (co.phone) { doc.text(co.phone, M, y); y += 11; }
  if (co.email) { doc.text(co.email, M, y); y += 11; }

  // Horizontal divider
  y += 6;
  doc.setDrawColor(...lineGray);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 14;

  // ═══════════════════════════════════════════════════════
  // TWO-COLUMN BODY
  // ═══════════════════════════════════════════════════════

  const bodyStartY = y;

  // ── LEFT COLUMN: Client info ──
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray);
  doc.text('CLIENT', M, y);
  y += 14;

  doc.setFontSize(9);
  doc.setTextColor(...dark);
  doc.setFont('helvetica', 'bold');
  doc.text('ATTN: ' + (client.name || '\u2014'), M, y);
  y += 12;
  doc.setFont('helvetica', 'normal');
  if (client.company) { doc.text(client.company, M, y); y += 12; }
  if (client.address) { doc.text(client.address, M, y); y += 12; }
  if (client.email) { doc.text(client.email, M, y); y += 12; }
  if (client.phone) { doc.text(client.phone, M, y); y += 12; }

  // ── RIGHT COLUMN: Scope of work table ──
  // Group items by category
  const catGroups = [];
  const catMap = new Map();
  for (const it of items.filter(i => i.plan_id != null)) {
    const catId = it.category || 'other';
    if (!catMap.has(catId)) {
      const catDef = categories.find(c => c.id === catId) || { id: catId, label: catId };
      catMap.set(catId, { ...catDef, items: [] });
      catGroups.push(catMap.get(catId));
    }
    catMap.get(catId).items.push(it);
  }

  // Build table rows
  const tableBody = [];
  for (const cg of catGroups) {
    const catTotal = cg.items.reduce((s, i) => s + (i.total_cost || 0), 0);
    // Category header row
    tableBody.push([
      { content: cg.label, colSpan: 3, styles: { fontStyle: 'bold', fontSize: 9, fillColor: [240, 240, 240], textColor: dark } },
      { content: '$' + fmtNum(catTotal), styles: { fontStyle: 'bold', halign: 'right', fontSize: 9, fillColor: [240, 240, 240], textColor: dark } },
    ]);
    // Line items
    for (const it of cg.items) {
      const planName = planMap.get(it.plan_id)?.name;
      const desc = '   ' + (it.description || 'Unnamed') + (planName ? ` (${planName})` : '');
      const h = it.height || 0;
      const rawQty = (it.quantity || 0) * (it.multiplier || 1);
      const effectiveUnit = (it.measurement_type === 'linear' && h > 0) ? 'SF' : (it.unit || '');
      const qty = rawQty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const unit = UNIT_MAP[effectiveUnit] || effectiveUnit || '';
      const amt = '$' + fmtNum(it.total_cost || 0);
      tableBody.push([
        { content: desc, styles: { fontSize: 8.5 } },
        { content: qty, styles: { halign: 'right', fontSize: 8.5 } },
        { content: unit, styles: { halign: 'center', fontSize: 8.5 } },
        { content: amt, styles: { halign: 'right', fontSize: 8.5 } },
      ]);
    }
  }
  // Empty spacer rows
  for (let i = 0; i < 2; i++) tableBody.push([{ content: '', colSpan: 4, styles: { minCellHeight: 16 } }]);

  autoTable(doc, {
    startY: bodyStartY,
    margin: { left: rightColX, right: M },
    head: [['SCOPE OF WORK', 'AMOUNT', 'UNIT', 'AMOUNT']],
    body: tableBody,
    theme: 'grid',
    tableWidth: rightColW,
    headStyles: {
      fillColor: [220, 220, 220], textColor: dark, fontStyle: 'bold', fontSize: 8,
      cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
    },
    bodyStyles: {
      fontSize: 8.5, textColor: dark,
      cellPadding: { top: 4, bottom: 4, left: 6, right: 6 },
      lineColor: [220, 220, 220], lineWidth: 0.3,
    },
    columnStyles: {
      0: { cellWidth: rightColW - 150 },
      1: { halign: 'right', cellWidth: 48 },
      2: { halign: 'center', cellWidth: 32 },
      3: { halign: 'right', cellWidth: 70 },
    },
    styles: { overflow: 'linebreak' },
  });

  const tableEndY = doc.lastAutoTable.finalY;

  // ── TOTALS — right-aligned below table ──
  const subtotal = items.filter(i => i.plan_id != null).reduce((s, i) => s + (i.total_cost || 0), 0);
  const OH = overheadPct / 100, PR = profitPct / 100;
  const grandTotal = subtotal * (1 + OH + PR);

  let ty = tableEndY + 8;
  const totLabelX = W - M - 100;
  const totValX = W - M;

  doc.setDrawColor(...lineGray);
  doc.setLineWidth(0.3);

  const totalsRows = [
    ['SUBTOTAL', '$' + fmtNum(subtotal)],
    ['DISCOUNT', '\u2014'],
    ['SUBTOTAL LESS DISCOUNT', '$' + fmtNum(subtotal)],
  ];
  if (OH > 0) totalsRows.push([`OVERHEAD (${overheadPct}%)`, '$' + fmtNum(subtotal * OH)]);
  if (PR > 0) totalsRows.push([`PROFIT (${profitPct}%)`, '$' + fmtNum(subtotal * PR)]);

  doc.setFontSize(8.5);
  for (const [lbl, val] of totalsRows) {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray);
    doc.text(lbl, totLabelX, ty, { align: 'right' });
    doc.setTextColor(...dark);
    doc.text(val, totValX, ty, { align: 'right' });
    ty += 14;
    doc.line(totLabelX - 10, ty - 6, totValX, ty - 6);
  }

  ty += 4;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...dark);
  doc.text('TOTAL', totLabelX, ty, { align: 'right' });
  doc.text('$' + fmtNum(grandTotal), totValX, ty, { align: 'right' });
  doc.setLineWidth(1);
  doc.line(totLabelX - 10, ty + 4, totValX, ty + 4);

  // ═══════════════════════════════════════════════════════
  // LEFT COLUMN CONTINUED: Description + Terms (below client)
  // These go in the left column area, starting below client info
  // ═══════════════════════════════════════════════════════

  let ly = Math.max(y + 20, bodyStartY + 100); // below client info with some spacing
  const leftTextW = leftColW - 4;

  // DESCRIPTION OF WORK
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...dark);
  doc.text('DESCRIPTION OF WORK', M, ly);
  ly += 2;
  doc.setDrawColor(...dark);
  doc.setLineWidth(0.5);
  doc.line(M, ly, M + 138, ly);
  ly += 12;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...dark);
  const bidDateStr = project.bid_date ? fmtDate(project.bid_date) : 'the bid date';
  const defaultScope = `${co.name} proposes to provide all materials and labor as required to perform the concrete work in accordance with the plans and specifications dated ${bidDateStr}, attached quantities, and following:`;
  const scopeText = proposalScope || defaultScope;
  const scopeLines = doc.splitTextToSize(scopeText, leftTextW);
  doc.text(scopeLines, M, ly);
  ly += scopeLines.length * 10 + 16;

  // TERMS AND CONDITIONS
  if (ly > H - 160) { doc.addPage(); ly = M; }
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...dark);
  doc.text('TERMS AND CONDITIONS', M, ly);
  ly += 2;
  doc.line(M, ly, M + 148, ly);
  ly += 12;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  const terms = proposalTerms ? proposalTerms.split('\n').filter(t => t.trim()) : DEFAULT_TERMS;
  for (const term of terms) {
    if (ly > H - 80) { doc.addPage(); ly = M; }
    const tLines = doc.splitTextToSize('\u2022  ' + term, leftTextW - 8);
    doc.text(tLines, M + 4, ly);
    ly += tLines.length * 9 + 2;
  }

  // ═══════════════════════════════════════════════════════
  // FOOTER — THANK YOU
  // ═══════════════════════════════════════════════════════

  const footerY = Math.max(ly + 30, ty + 40, H - 90);
  // If it won't fit on current page, add new page
  if (footerY > H - 30) { doc.addPage(); }
  const fy = footerY > H - 30 ? H - 90 : footerY;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...dark);
  doc.text('THANK YOU', W / 2, fy, { align: 'center' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...gray);
  let ffy = fy + 18;
  doc.text(co.name, W / 2, ffy, { align: 'center' });
  if (co.phone) { ffy += 12; doc.text(co.phone, W / 2, ffy, { align: 'center' }); }
  if (co.email) { ffy += 12; doc.text(co.email, W / 2, ffy, { align: 'center' }); }

  // Save
  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`${(project.name || 'Proposal').replace(/[^a-zA-Z0-9]/g, '_')}_Proposal_${dateStr}.pdf`);
  } catch (err) {
    console.error('[proposalPdf] generation failed:', err);
    alert('PDF generation failed: ' + err.message);
  }
}

function fmtNum(v) {
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
