import { jsPDF } from 'jspdf';

const MARGIN = 48;
const WIDTH = 595;
const BOTTOM = 780;

// Plain-language names for each test. The internal mechanics — gate numbering,
// thresholds, decoy identifiers, scores, prompts — are deliberately absent: a brief
// meant for outside readers should not double as a map for evading the checks.
const PUBLIC_CASES = {
  grounded_pass: {
    name: 'A properly sourced answer is delivered',
    means: 'When every factual statement in an answer traces back to the supplied source material, the answer is released to the caller unchanged.',
  },
  hallucination_caught: {
    name: 'An invented detail is caught and held back',
    means: 'An answer that looked correct but contained a fabricated figure and a fabricated cause was identified and withheld from the caller, then queued for a person to review.',
  },
  true_but_uncited: {
    name: 'A true-but-unsourced statement is also held back',
    means: 'A statement that happens to be true, but which the supplied sources do not contain, is treated as unverified. The system cannot tell knowledge from invention, so it does not pretend to.',
  },
  drift_detected: {
    name: 'An agent following planted instructions is detected',
    means: 'A response that abandoned its assigned task to follow instructions hidden in its input was detected, its output quarantined, and the agent restricted automatically.',
  },
  no_false_positive: {
    name: 'A well-behaved agent is not punished',
    means: 'An answer that stayed on task and openly admitted what it did not know was passed without penalty. A control that flags good behavior gets switched off, so this case matters as much as the one above.',
  },
  audit_chain: {
    name: 'The activity record is intact',
    means: 'The tamper-evidence check over the recorded history found no altered, missing or forged entries.',
  },
  signing_live: {
    name: 'Certification is active',
    means: 'Records are certified with a key held only on the server, so a record can be shown to have come from this system.',
  },
};

export function buildPublicBriefPdf(report) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = MARGIN;

  const page = () => { doc.addPage(); y = MARGIN; };

  const text = (str, { size = 10, style = 'normal', color = [40, 44, 52], indent = 0, gap = 5 } = {}) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    for (const line of doc.splitTextToSize(String(str), WIDTH - MARGIN * 2 - indent)) {
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

  const heading = (str) => text(str, { size: 12.5, style: 'bold', color: [15, 23, 42], gap: 6 });
  const bullets = (items, color) => items.forEach((b) => text(`•  ${b}`, { size: 9.5, color, gap: 6, indent: 4 }));

  // --- Cover ---------------------------------------------------------------
  text('Agent Governance Brief', { size: 18, style: 'bold', color: [15, 23, 42], gap: 2 });
  text('Independent-reader summary — outcomes only, mechanics withheld', { size: 10, color: [110, 118, 129], gap: 8 });
  text(`Test run ${report.finishedAt} · ${report.summary.passed} of ${report.summary.total} checks passed`, { size: 10, style: 'bold', gap: 4 });
  text(
    'This brief reports what the system was observed to do. It deliberately omits how the checks are constructed — thresholds, detection patterns and internal wording are all left out, because publishing them is publishing the way around them. The signed technical report holds those details for anyone entitled to audit them.',
    { size: 9, color: [110, 118, 129], gap: 8 },
  );
  rule();

  // --- What it claims, and whether it did it -------------------------------
  heading('The claim under test');
  text(
    'The claim is narrow and worth stating exactly: this system reduces wasted spend on AI calls, refuses to pass on answers it cannot source, and stops a misbehaving agent from getting anything further out of it — all decided before money is spent, and all recorded in a way that shows tampering.',
    { size: 10 },
  );
  text(
    `Against that claim the run above passed ${report.summary.passed} of ${report.summary.total} live checks` +
    `${report.summary.failed ? `, failed ${report.summary.failed}` : ''}` +
    `${report.summary.errored ? `, and could not run ${report.summary.errored}` : ''}. ` +
    'A check that could not run is reported as an error, never as a pass.',
    { size: 10, gap: 8 },
  );
  rule();

  // --- Observed results ----------------------------------------------------
  heading('What was observed');
  for (const c of report.cases || []) {
    const pub = PUBLIC_CASES[c.id] || { name: c.name, means: '' };
    const mark = c.passed === true ? 'CONFIRMED' : c.passed === false ? 'NOT CONFIRMED' : 'COULD NOT RUN';
    const color = c.passed === true ? [5, 122, 85] : c.passed === false ? [190, 30, 45] : [180, 120, 10];
    text(`${mark} — ${pub.name}`, { size: 10.5, style: 'bold', color, gap: 2 });
    if (pub.means) text(pub.means, { size: 9, color: [70, 78, 90], indent: 14, gap: 8 });
  }
  rule();

  // --- Benefits ------------------------------------------------------------
  heading('Benefits');
  bullets([
    'Spend is capped per agent before a call is made, in the unit that actually runs out, so a single oversized request cannot drain a budget that a simple request limit would have let through.',
    'The system counts the cost of its own checking against the same budget and reports it. On this run that overhead was ' + report.tokens.harnessOverheadPct + '% of the total — a saving claim that hides its own cost is not a saving.',
    'Work already done is not paid for twice: identical requests are answered from memory at no model cost, and requests that merely reword an earlier one are stopped before the expensive call.',
    'Answers must be sourced. Anything the supplied material does not support is held back from the caller and sent to a person, rather than delivered with the confident tone that makes an invented fact dangerous.',
    'An agent that abandons its task to follow instructions planted in its input is detected and restricted automatically, with the restriction escalating on repetition and reversible only by a named operator.',
    'Every permission decision happens before spend and on the server, so a modified or malicious client cannot skip it.',
    'An agent must prove who it is with a secret, and an unrecognised identity is refused rather than quietly created — so an agent cannot escape a restriction by renaming itself.',
    'Every released answer is certified to the agent, session and task that produced it, so an output can be traced back to its origin rather than merely recognised.',
    'The activity record is tamper-evident: an altered, deleted or forged entry shows up whenever the check is run, and anyone can run it.',
    'Outbound calls made through the system are denied by default and permitted only to named destinations, with every attempt logged against the agent that tried it.',
    'Detection accuracy is measured on labelled examples and both its hit rate and its false-alarm rate are published, rather than asserted.',
  ]);
  rule();

  // --- What still needs confirming ----------------------------------------
  heading('What still needs to be confirmed');
  text(
    'These are the things a reader should NOT take on this document\'s word. Each is a real gap, not a formality.',
    { size: 9, color: [110, 118, 129], gap: 6 },
  );
  bullets([
    'Containment. This system governs what an agent can obtain and what answers are released. It cannot stop an action an agent takes by a route that does not pass through it. Confirming containment requires isolation beneath the application — separate infrastructure, separately audited.',
    'Cost figures. All spend numbers are estimates derived from message size, because the underlying provider does not report usage back. They are sound for capping runaway spend and unsuitable as a bill. Confirmation means reconciling against provider invoices.',
    'Judgement quality at scale. The sourcing and misbehaviour checks are themselves AI judgements. They miss things and they misfire. Confirming them means a sustained sample of human review against live traffic, not a passing test run.',
    'Detection breadth. The labelled evaluation set is small and written by one author. Confirming it means an independent, adversarial set built by someone trying to defeat the detector.',
    'Multiple identities. Limits and budgets are enforced per identity, so an adversary holding several valid credentials holds several budgets. Confirming this bound requires a policy on credential issuance, which is an organisational control rather than a technical one.',
    'Credential handling. A leaked secret is, to this system, the agent itself. Nothing here detects a valid credential used correctly by the wrong party.',
    'Record permanence. Tampering is detectable, not prevented — the history is not write-once storage. Confirming permanence needs storage that physically refuses deletion.',
    'Model provenance. The technical report names the AI model this system requested for its checks. That is an attestation of what was asked for, not proof of what the provider ran.',
  ]);
  rule();

  // --- Landscape -----------------------------------------------------------
  heading('Why this matters in the current AI landscape');
  text(
    'Two failures dominate deployed AI systems today, and neither is a model-quality problem. The first is cost: agents that loop, re-ask and re-generate turn an affordable capability into an unpredictable bill, and most guardrails count requests rather than the consumption that actually runs out. The second is confident wrongness: a system that answers fluently when it has no basis to answer at all, which is precisely the failure that survives a demo and surfaces in production.',
    { size: 10 },
  );
  text(
    'This system attacks both at the same point — before the spend and before the release. Requiring an answer to be sourced converts an invented answer into a visible refusal, which is a far cheaper failure to operate than a plausible fabrication. Capping consumption rather than requests turns an open-ended risk into a bounded one. Neither is novel research; both are routinely missing from deployments, which is why they are worth building deliberately.',
    { size: 10, gap: 8 },
  );
  rule();

  // --- Rogue agents --------------------------------------------------------
  heading('The rogue-agent question, answered precisely');
  text(
    'A useful distinction: an agent that goes wrong through drift, a poisoned input or a hijacked instruction is a different problem from an agent deliberately built to cause harm. This system addresses the first, and only partly the second.',
    { size: 10 },
  );
  text('It does help with:', { size: 10, style: 'bold', gap: 4 });
  bullets([
    'An agent whose behaviour has been redirected by instructions hidden in the data it reads — detected, its output quarantined, its access restricted.',
    'An agent stuck in a loop, or draining budget by repetition — stopped before spend, by consumption rather than count.',
    'An agent attempting an action outside its permitted role, or continuing after being restricted — refused on the server, before anything is spent.',
    'Attribution after the fact — which agent, which session, which task produced a given output, on a record that shows tampering.',
  ], [40, 44, 52]);
  text('It does not help with:', { size: 10, style: 'bold', color: [153, 27, 27], gap: 4 });
  bullets([
    'An agent with its own network access. Every control here sits on the path through this system; an agent that does not use that path is not governed by it.',
    'A determined adversary who holds valid credentials. They are treated as the legitimate agent, within that agent\'s limits.',
    'Harm done before the output is released. The release check stops the answer, not an action already taken.',
    'Anything that requires knowing intent. Detection here observes behaviour against an assigned task; it does not read motive.',
  ], [110, 60, 60]);
  rule();

  // --- Verdict -------------------------------------------------------------
  heading('Will it help?');
  text(
    'Yes, within a boundary worth stating plainly. For an organisation running AI agents over its own data and tools, this reduces two costs that are being paid today: money burnt on repeated and runaway calls, and the downstream damage of answers that were never sourced. It also makes agent behaviour attributable, which is the precondition for every other control an auditor will eventually ask for.',
    { size: 10 },
  );
  text(
    'It is not a safety guarantee and should not be presented as one. Without isolation beneath the application it is governance without containment: it decides what an agent obtains and what is released, while an action taken outside its path remains outside its reach. Read as a cost-and-accuracy control with real attribution, it delivers. Read as a defence against a capable adversary, it is one layer of several, and the layer beneath it is missing.',
    { size: 10, gap: 8 },
  );

  // --- Certification -------------------------------------------------------
  rule();
  text('Certification', { size: 10, style: 'bold', color: [15, 23, 42], gap: 3 });
  text(
    'The underlying technical report is certified with a key held only on this system\'s server, so the results above cannot be edited after the fact without the certification failing. Certification proves origin. It says nothing about whether the content is correct.',
    { size: 9, color: [110, 118, 129], gap: 4 },
  );
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90, 98, 110);
  for (const line of doc.splitTextToSize(`certificate reference: ${String(report.signature).slice(0, 32)}…`, WIDTH - MARGIN * 2)) {
    if (y > BOTTOM) page();
    doc.text(line, MARGIN, y);
    y += 11;
  }

  return doc;
}