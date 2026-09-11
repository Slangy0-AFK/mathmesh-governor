import { jsPDF } from 'jspdf';

const MARGIN = 48;
const WIDTH = 595; // A4 portrait, points
const BOTTOM = 780;

/**
 * Render a signed self-test report to a PDF.
 * The signature block is printed in full so the file can be re-verified later —
 * a report that certifies itself without showing what was signed is decoration.
 */
export function buildSelfTestPdf(report) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = MARGIN;

  const page = () => {
    doc.addPage();
    y = MARGIN;
  };

  const space = (n) => {
    if (y + n > BOTTOM) page();
    else y += n;
  };

  const text = (str, { size = 10, style = 'normal', color = [40, 44, 52], indent = 0, gap = 4 } = {}) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(str), WIDTH - MARGIN * 2 - indent);
    for (const line of lines) {
      if (y > BOTTOM) page();
      doc.text(line, MARGIN + indent, y);
      y += size + 3;
    }
    y += gap;
  };

  const rule = () => {
    if (y + 12 > BOTTOM) page();
    doc.setDrawColor(215);
    doc.line(MARGIN, y, WIDTH - MARGIN, y);
    y += 14;
  };

  // Header
  text('MathMesh Governor — Signed Self-Test Report', { size: 17, style: 'bold', color: [15, 23, 42], gap: 2 });
  text(
    `Run ${report.finishedAt} by ${report.runBy} · report ${report.reportVersion}`,
    { size: 9, color: [110, 118, 129], gap: 10 },
  );
  rule();

  // Attestation
  text('Tester attestation', { size: 12, style: 'bold', color: [15, 23, 42], gap: 3 });
  text(`Model requested for all judging calls: ${report.testerModelRequested}`, { size: 10, style: 'bold' });
  text(
    'This states the model id this harness asked for. It is not independent proof of which weights the provider ran. The signature below protects this report from being edited after the fact — that is all it claims.',
    { size: 9, color: [110, 118, 129] },
  );

  const s = report.summary || {};
  text(
    `Result: ${s.passed} of ${s.total} cases passed · ${s.failed} failed · ${s.errored} could not run (an unrunnable case is never counted as a pass).`,
    { size: 10 },
  );
  const t = report.tokens || {};
  text(
    `Token cost of this run: ~${t.generationEstimate} generating, ~${t.judgeEstimate} judging — the harness's own overhead was ${t.harnessOverheadPct}% of the total. All figures are chars/4 estimates, not provider usage.`,
    { size: 10, gap: 8 },
  );
  rule();

  // Cases
  text('Live test cases', { size: 12, style: 'bold', color: [15, 23, 42], gap: 6 });
  for (const c of report.cases || []) {
    const mark = c.passed === true ? 'PASS' : c.passed === false ? 'FAIL' : 'ERROR';
    const color = c.passed === true ? [5, 122, 85] : c.passed === false ? [190, 30, 45] : [180, 120, 10];
    text(`[${mark}]  ${c.name}`, { size: 10.5, style: 'bold', color, gap: 2 });
    text(`Expected: ${c.expectation}`, { size: 9, color: [90, 98, 110], indent: 14, gap: 2 });
    text(`Observed: ${c.observed}`, { size: 9, color: [40, 44, 52], indent: 14, gap: 8 });
  }

  if (report.auditChain) {
    text(
      `Audit chain at time of run: head sequence ${report.auditChain.headSeq}, tampering detected: ${report.auditChain.tamperingDetected}. Head hash ${report.auditChain.headHash}`,
      { size: 9, color: [90, 98, 110], gap: 8 },
    );
  }
  rule();

  // Benefits
  text('What this harness actually gives you', { size: 12, style: 'bold', color: [15, 23, 42], gap: 6 });
  (report.benefits || []).forEach((b, i) => text(`${i + 1}. ${b}`, { size: 9.5, gap: 6 }));
  rule();

  // Honest takeaways
  text('Honest takeaways — the limits, stated plainly', { size: 12, style: 'bold', color: [153, 27, 27], gap: 6 });
  (report.honestTakeaways || []).forEach((h, i) => text(`${i + 1}. ${h}`, { size: 9.5, color: [70, 40, 40], gap: 6 }));
  rule();

  // Signature block
  space(4);
  text('Signature', { size: 12, style: 'bold', color: [15, 23, 42], gap: 3 });
  text(`Signed over: ${report.signedOver}`, { size: 9, color: [110, 118, 129], gap: 4 });
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(40, 44, 52);
  for (const [label, value] of [['report SHA-256', report.reportHash], ['HMAC-SHA256', report.signature]]) {
    const lines = doc.splitTextToSize(`${label}: ${value}`, WIDTH - MARGIN * 2);
    for (const line of lines) {
      if (y > BOTTOM) page();
      doc.text(line, MARGIN, y);
      y += 11;
    }
    y += 4;
  }
  text(
    'Signing proves this report came from this harness. It says nothing about whether the content it certifies is correct.',
    { size: 8.5, color: [110, 118, 129] },
  );

  return doc;
}