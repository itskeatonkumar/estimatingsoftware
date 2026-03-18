import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const COMPANY_INFO = {
  fcg: {
    name: 'Foundation Construction Group LLC',
    address: '1234 Construction Way',
    city: 'Charlotte, NC 28202',
    phone: '(704) 555-0100',
    email: 'estimates@fcgllc.com',
  },
  brc: {
    name: 'BR Concrete Inc.',
    address: '5678 Concrete Blvd',
    city: 'Charlotte, NC 28205',
    phone: '(704) 555-0200',
    email: 'estimates@brconcrete.com',
  },
  p4s: {
    name: 'P4S Corp',
    address: '9012 Industrial Dr',
    city: 'Charlotte, NC 28210',
    phone: '(704) 555-0300',
    email: 'estimates@p4scorp.com',
  },
  default: {
    name: 'My Company',
    address: '',
    city: '',
    phone: '',
    email: '',
  },
};

const UNIT_MAP = { SF: 'ft\u00B2', LF: 'lf', EA: 'ea', CY: 'cy', LS: 'ls', TN: 'tn', LB: 'lb', HR: 'hr' };

const TERMS = [
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

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function addDays(d, n) {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function generateProposalPdf({ project, items, plans, categories, overheadPct, profitPct, companyId }) {
  try {
  const co = COMPANY_INFO[companyId] || COMPANY_INFO[project.company] || COMPANY_INFO.default;
  const doc = new jsPDF('p', 'pt', 'letter'); // 612 x 792
  const W = 612, margin = 40;
  const contentW = W - margin * 2;
  let y = margin;

  // ── HEADER ──
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(project.name || 'Project Proposal', margin, y + 16);

  doc.setFontSize(14);
  doc.setTextColor(150, 150, 150);
  doc.text('JOB ESTIMATE', W - margin, y + 16, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += 32;

  // Company info — left
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(co.name, margin, y);
  doc.setFont('helvetica', 'normal');
  if (co.address) { y += 11; doc.text(co.address, margin, y); }
  if (co.city) { y += 11; doc.text(co.city, margin, y); }
  if (co.phone) { y += 11; doc.text(co.phone, margin, y); }
  if (co.email) { y += 11; doc.text(co.email, margin, y); }

  // Quote info — right
  const today = new Date().toISOString().slice(0, 10);
  const qx = W - margin;
  let qy = y - 44;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('DATE OF QUOTE:', qx - 120, qy); doc.setFont('helvetica', 'normal'); doc.text(fmtDate(today), qx, qy, { align: 'right' });
  qy += 14;
  doc.setFont('helvetica', 'bold');
  doc.text('VALID UNTIL:', qx - 120, qy); doc.setFont('helvetica', 'normal'); doc.text(addDays(today, 30), qx, qy, { align: 'right' });
  qy += 14;
  doc.setFont('helvetica', 'bold');
  doc.text('QUOTE NO.:', qx - 120, qy); doc.setFont('helvetica', 'normal'); doc.text('—', qx, qy, { align: 'right' });

  y += 24;

  // ── CLIENT + LINE ITEMS TABLE ──
  const planMap = new Map(plans.map(p => [p.id, p]));

  // Group items by category
  const catGroups = [];
  const catMap = new Map();
  for (const it of items.filter(i => i.plan_id != null)) {
    const catId = it.category || 'other';
    if (!catMap.has(catId)) {
      const catDef = categories.find(c => c.id === catId) || { id: catId, label: catId };
      const group = { ...catDef, items: [] };
      catMap.set(catId, group);
      catGroups.push(group);
    }
    catMap.get(catId).items.push(it);
  }

  // Build table rows
  const tableRows = [];

  // Client row
  tableRows.push([
    { content: `ATTN: ${project.gc_name || '—'}`, colSpan: 2, styles: { fontStyle: 'bold', fontSize: 9 } },
    '', '', ''
  ]);

  for (const cg of catGroups) {
    const catTotal = cg.items.reduce((s, i) => s + (i.total_cost || 0), 0);
    // Category header
    tableRows.push([
      { content: cg.label, colSpan: 4, styles: { fontStyle: 'bold', fontSize: 9, fillColor: [245, 245, 245] } },
      { content: `$${catTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, styles: { fontStyle: 'bold', halign: 'right', fontSize: 9, fillColor: [245, 245, 245] } },
    ]);
    // Items
    for (const it of cg.items) {
      const planName = planMap.get(it.plan_id)?.name;
      const desc = (it.description || 'Unnamed') + (planName ? ` (${planName})` : '');
      const qty = (it.quantity || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const unit = UNIT_MAP[it.unit] || it.unit || '';
      const amt = `$${(it.total_cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      tableRows.push(['', desc, qty, unit, { content: amt, styles: { halign: 'right' } }]);
    }
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['CLIENT', 'SCOPE OF WORK', 'QTY', 'UNIT', 'AMOUNT']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [200, 200, 200], textColor: [51, 51, 51], fontStyle: 'bold', fontSize: 9, cellPadding: 6 },
    bodyStyles: { fontSize: 8.5, cellPadding: 5, textColor: [51, 51, 51] },
    columnStyles: {
      0: { cellWidth: 80 },
      2: { halign: 'right', cellWidth: 55 },
      3: { halign: 'center', cellWidth: 35 },
      4: { halign: 'right', cellWidth: 70 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0 && !data.cell.raw) {
        data.cell.styles.cellWidth = 0.01;
      }
    },
  });

  y = doc.lastAutoTable.finalY + 16;

  // ── TOTALS (right-aligned) ──
  const subtotal = items.filter(i => i.plan_id != null).reduce((s, i) => s + (i.total_cost || 0), 0);
  const OH = overheadPct / 100, PR = profitPct / 100;
  const total = Math.round(subtotal * (1 + OH + PR));

  const totalsX = W - margin;
  const labelX = totalsX - 140;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('SUBTOTAL:', labelX, y, { align: 'right' });
  doc.text(`$${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, totalsX, y, { align: 'right' });
  y += 14;
  doc.text('DISCOUNT:', labelX, y, { align: 'right' });
  doc.text('—', totalsX, y, { align: 'right' });
  y += 14;
  doc.text('SUBTOTAL LESS DISCOUNT:', labelX, y, { align: 'right' });
  doc.text(`$${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, totalsX, y, { align: 'right' });
  y += 14;
  if (OH > 0) {
    doc.text(`OVERHEAD (${overheadPct}%):`, labelX, y, { align: 'right' });
    doc.text(`$${Math.round(subtotal * OH).toLocaleString()}`, totalsX, y, { align: 'right' });
    y += 14;
  }
  if (PR > 0) {
    doc.text(`PROFIT (${profitPct}%):`, labelX, y, { align: 'right' });
    doc.text(`$${Math.round(subtotal * PR).toLocaleString()}`, totalsX, y, { align: 'right' });
    y += 14;
  }
  y += 4;
  doc.setDrawColor(200, 200, 200);
  doc.line(labelX - 20, y - 6, totalsX, y - 6);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL:', labelX, y + 4, { align: 'right' });
  doc.text(`$${total.toLocaleString()}`, totalsX, y + 4, { align: 'right' });
  y += 24;

  // ── DESCRIPTION OF WORK ──
  // Check if we need a new page
  if (y > 580) { doc.addPage(); y = margin; }

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('DESCRIPTION OF WORK', margin, y);
  y += 3;
  doc.setDrawColor(51, 51, 51);
  doc.line(margin, y, margin + 140, y);
  y += 12;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  const bidDateStr = project.bid_date ? fmtDate(project.bid_date) : 'the bid date';
  const descText = `${co.name} proposes to provide all materials and labor as required to perform the concrete work in accordance with the plans and specifications dated ${bidDateStr}, attached quantities, and following:`;
  const descLines = doc.splitTextToSize(descText, contentW);
  doc.text(descLines, margin, y);
  y += descLines.length * 11 + 12;

  // ── TERMS AND CONDITIONS ──
  if (y > 640) { doc.addPage(); y = margin; }

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('TERMS AND CONDITIONS', margin, y);
  y += 3;
  doc.line(margin, y, margin + 150, y);
  y += 12;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  for (const term of TERMS) {
    if (y > 740) { doc.addPage(); y = margin; }
    const tLines = doc.splitTextToSize(`\u2022  ${term}`, contentW - 10);
    doc.text(tLines, margin + 6, y);
    y += tLines.length * 10 + 3;
  }

  // ── FOOTER ──
  y += 16;
  if (y > 720) { doc.addPage(); y = margin; }
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('THANK YOU', W / 2, y, { align: 'center' });
  y += 16;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(co.name, W / 2, y, { align: 'center' });
  if (co.phone) { y += 12; doc.text(co.phone, W / 2, y, { align: 'center' }); }
  if (co.email) { y += 12; doc.text(co.email, W / 2, y, { align: 'center' }); }

  // Save
  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`${(project.name || 'Proposal').replace(/[^a-zA-Z0-9]/g, '_')}_Proposal_${dateStr}.pdf`);
  } catch(err) {
    console.error('[proposalPdf] generation failed:', err);
    alert('PDF generation failed: ' + err.message);
  }
}
