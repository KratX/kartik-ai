import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO_SCRAMBLE_LINES,
  SLASH_COMMANDS,
  clampCanvasWidthPct,
  computeCreditCapacity,
  computeScrambleFrame,
  computeStreamStepChars,
  extractThreadArtifacts,
  filterCommandPaletteItems,
  filterCreditLedger,
  formatArtifactMetaSummary,
  formatPlanDisplayName,
  formatPlanUnitPrice,
  getTimeOfDayGreeting,
  groupConversationsByDate,
  inferConversationArtifactKind,
  matchSlashCommands,
  stripLeadingSlashCommand,
  summarizeCreditLedger,
} from '../src/components/workspace-ux-helpers.js';
import type {
  ArtifactRecord,
  CodingArtifactFile,
  PlatformConversation,
  PlatformMessage,
} from '../src/types/index.js';

function makeArtifactFile(path: string, content = ''): CodingArtifactFile {
  return {
    path,
    mimeType: 'text/plain',
    sizeBytes: content.length,
    sha256: '0'.repeat(64),
    content,
  };
}

function makeArtifact(
  overrides: Partial<ArtifactRecord> & Pick<ArtifactRecord, 'artifactId' | 'artifactType' | 'title'>,
): ArtifactRecord {
  return {
    userId: 'usr_1',
    requestId: 'req_1',
    conversationId: 'c1',
    entryFile: 'index.html',
    storageKey: `private/usr_1/${overrides.artifactId}`,
    mimeType: 'application/octet-stream',
    sizeBytes: 2048,
    filesManifest: [],
    createdAt: '2026-11-21T10:00:00.000Z',
    ...overrides,
  };
}

test('matchSlashCommands returns all commands on "/" and filters accurately while typing', () => {
  assert.equal(matchSlashCommands('/').length, SLASH_COMMANDS.length);
  assert.equal(matchSlashCommands('').length, 0);
  assert.equal(matchSlashCommands('hello /code').length, 0);
  assert.equal(matchSlashCommands('/code build app').length, 0);

  const deepMatches = matchSlashCommands('/de');
  assert.equal(deepMatches.length, 1);
  assert.equal(deepMatches[0]?.command, '/deep');
  assert.equal(deepMatches[0]?.depth, 'deep');

  const pdfMatches = matchSlashCommands('/pdf');
  assert.ok(pdfMatches.some((item) => item.command === '/pdf'));
});

test('stripLeadingSlashCommand removes the command token while preserving trailing prompt', () => {
  assert.equal(stripLeadingSlashCommand('/code'), '');
  assert.equal(stripLeadingSlashCommand('  /deep   '), '');
  assert.equal(
    stripLeadingSlashCommand('/pdf quarterly earnings report'),
    'quarterly earnings report',
  );
  assert.equal(stripLeadingSlashCommand('plain prompt'), 'plain prompt');
});

test('groupConversationsByDate sorts threads into Pinned, Today, Yesterday, Previous 7 Days, and Earlier with title overrides', () => {
  const now = new Date('2026-11-21T15:00:00.000Z').getTime();
  const makeConv = (
    id: string,
    title: string,
    updatedAt: string,
  ): PlatformConversation => ({
    conversationId: id,
    userId: 'usr_1',
    title,
    deletionState: 'active',
    createdAt: updatedAt,
    updatedAt,
  });

  const list: PlatformConversation[] = [
    makeConv('c_pin', 'Pinned Thread', '2026-10-01T10:00:00.000Z'),
    makeConv('c_today', 'Today Thread', '2026-11-21T11:30:00.000Z'),
    makeConv('c_yest', 'Yesterday Thread', '2026-11-20T14:00:00.000Z'),
    makeConv('c_week', 'Week Thread', '2026-11-17T10:00:00.000Z'),
    makeConv('c_old', 'Old Thread', '2026-10-10T10:00:00.000Z'),
  ];

  const groups = groupConversationsByDate(
    list,
    new Set(['c_pin']),
    { c_pin: 'Renamed Flagship Spec' },
    now,
  );

  assert.deepEqual(
    groups.map((g) => g.key),
    ['pinned', 'today', 'yesterday', 'previous_7_days', 'earlier'],
  );
  assert.equal(groups[0]?.items[0]?.displayTitle, 'Renamed Flagship Spec');
  assert.equal(groups[0]?.items[0]?.isPinned, true);
  assert.equal(groups[1]?.items[0]?.conversationId, 'c_today');
  assert.equal(groups[2]?.items[0]?.conversationId, 'c_yest');
  assert.equal(groups[3]?.items[0]?.conversationId, 'c_week');
  assert.equal(groups[4]?.items[0]?.conversationId, 'c_old');
});

test('extractThreadArtifacts deduplicates artifacts in chronological order across messages', () => {
  const artA = makeArtifact({
    artifactId: 'art_1',
    artifactType: 'code_bundle',
    title: 'Calculator',
    mimeType: 'application/json',
    filesManifest: [makeArtifactFile('index.html', '<h1>Hi</h1>')],
  });
  const artB = makeArtifact({
    artifactId: 'art_2',
    artifactType: 'pdf_document',
    title: 'Architecture Brief',
    mimeType: 'application/pdf',
    sizeBytes: 12288,
  });

  const messages: PlatformMessage[] = [
    {
      messageId: 'm1',
      conversationId: 'c1',
      role: 'assistant',
      content: 'Built app',
      agentUsed: 'coding',
      creditsCharged: 5,
      createdAt: '2026-11-21T10:00:00.000Z',
      artifacts: [artA],
    },
    {
      messageId: 'm2',
      conversationId: 'c1',
      role: 'assistant',
      content: 'Compiled PDF',
      agentUsed: 'pdf',
      creditsCharged: 5,
      createdAt: '2026-11-21T10:05:00.000Z',
      artifacts: [artA, artB],
    },
  ];

  const extracted = extractThreadArtifacts(messages);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0]?.artifactId, 'art_1');
  assert.equal(extracted[1]?.artifactId, 'art_2');
});

test('formatArtifactMetaSummary formats concise badges for Code, PDF, PPT, and Image artifacts', () => {
  const codeSummary = formatArtifactMetaSummary(
    makeArtifact({
      artifactId: 'a1',
      artifactType: 'code_bundle',
      title: 'App',
      mimeType: 'application/json',
      sizeBytes: 3000,
      filesManifest: [
        makeArtifactFile('index.html'),
        makeArtifactFile('styles.css'),
        makeArtifactFile('app.js'),
      ],
    }),
  );
  assert.equal(codeSummary.shortBadge, 'Code');
  assert.match(codeSummary.detailLabel, /3 files/);

  const pdfSummary = formatArtifactMetaSummary(
    makeArtifact({
      artifactId: 'a2',
      artifactType: 'pdf_document',
      title: 'Report',
      mimeType: 'application/pdf',
      sizeBytes: 24576,
    }),
  );
  assert.equal(pdfSummary.shortBadge, 'PDF');
  assert.match(pdfSummary.detailLabel, /24 KB/);

  const pptSummary = formatArtifactMetaSummary(
    makeArtifact({
      artifactId: 'a3',
      artifactType: 'ppt_presentation',
      title: 'Deck',
      mimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: 40000,
      filesManifest: [
        makeArtifactFile(
          'slides-spec.json',
          JSON.stringify({ slides: [{}, {}, {}, {}, {}, {}] }),
        ),
      ],
    }),
  );
  assert.equal(pptSummary.shortBadge, 'Deck');
  assert.match(pptSummary.detailLabel, /6 slides/);

  const imageSummary = formatArtifactMetaSummary(
    makeArtifact({
      artifactId: 'a4',
      artifactType: 'generated_image',
      title: 'Pavilion',
      mimeType: 'image/png',
      sizeBytes: 102400,
    }),
  );
  assert.equal(imageSummary.shortBadge, 'Image');
  assert.match(imageSummary.detailLabel, /PNG · 100 KB/);
});

test('filterCommandPaletteItems matches multi-token queries across label, subtitle, and keywords', () => {
  const items = [
    {
      id: '1',
      label: 'PDF Generator',
      subtitle: 'Compile editorial PDF reports',
      keywords: ['/pdf', 'document'],
    },
    {
      id: '2',
      label: 'Replay Last Idempotency-Key',
      subtitle: 'Verify 0-credit deduplication',
      keywords: ['dev', 'replay'],
    },
  ];

  assert.equal(filterCommandPaletteItems(items, '').length, 2);
  const res = filterCommandPaletteItems(items, 'pdf report');
  assert.equal(res.length, 1);
  assert.equal(res[0]?.id, '1');
});

test('clampCanvasWidthPct bounds split-pane widths between 34% and 66%', () => {
  assert.equal(clampCanvasWidthPct(10), 34);
  assert.equal(clampCanvasWidthPct(85), 66);
  assert.equal(clampCanvasWidthPct(50.24), 50.2);
  assert.equal(clampCanvasWidthPct(Number.NaN), 48);
});

test('getTimeOfDayGreeting adapts cleanly to morning, afternoon, evening, and first name', () => {
  assert.equal(getTimeOfDayGreeting(9), 'Good morning');
  assert.equal(
    getTimeOfDayGreeting(14, 'Kartik Sharma'),
    'Good afternoon, Kartik',
  );
  assert.equal(getTimeOfDayGreeting(20, '  Ada  '), 'Good evening, Ada');
});

test('summarizeCreditLedger aggregates added credits, spent credits, and event counts', () => {
  const summary = summarizeCreditLedger([
    { deltaCredits: 250 },
    { deltaCredits: -5 },
    { deltaCredits: -10 },
    { deltaCredits: 1500 },
  ]);
  assert.deepEqual(summary, {
    totalAdded: 1750,
    totalSpent: 15,
    topUpCount: 2,
    usageCount: 2,
    totalEntries: 4,
  });

  const empty = summarizeCreditLedger([]);
  assert.equal(empty.totalAdded, 0);
  assert.equal(empty.totalSpent, 0);
  assert.equal(empty.totalEntries, 0);
});

test('filterCreditLedger filters by direction and case-insensitive description or requestId', () => {
  const entries = [
    { description: 'Pro Plan top-up', requestId: 'req_topup_001', deltaCredits: 1500 },
    { description: 'PDF Report generation', requestId: 'req_pdf_002', deltaCredits: -5 },
    { description: 'Unified Chat turn', requestId: 'req_chat_003', deltaCredits: -1 },
  ];

  assert.equal(filterCreditLedger(entries, 'all', '').length, 3);
  assert.equal(filterCreditLedger(entries, 'credits', '').length, 1);
  assert.equal(filterCreditLedger(entries, 'debits', '').length, 2);

  const byDesc = filterCreditLedger(entries, 'debits', 'pdf');
  assert.equal(byDesc.length, 1);
  assert.equal(byDesc[0]?.requestId, 'req_pdf_002');

  const byReq = filterCreditLedger(entries, 'all', 'REQ_TOPUP');
  assert.equal(byReq.length, 1);
  assert.equal(byReq[0]?.deltaCredits, 1500);
});

test('formatPlanUnitPrice and formatPlanDisplayName format real Razorpay plan metadata cleanly', () => {
  assert.equal(formatPlanUnitPrice(19900, 500), '₹0.40 / cr');
  assert.equal(formatPlanUnitPrice(49900, 1500), '₹0.33 / cr');
  assert.equal(formatPlanUnitPrice(19900, 0), '—');

  assert.equal(formatPlanDisplayName('plan_free'), 'Free Workspace');
  assert.equal(formatPlanDisplayName('plan_starter_199'), 'Starter Plan');
  assert.equal(formatPlanDisplayName('plan_pro_499'), 'Pro Plan');
  assert.equal(formatPlanDisplayName('plan_enterprise_custom'), 'Enterprise Custom');
});

test('computeCreditCapacity calculates exact per-specialist run capacity from available credits', () => {
  const rows = computeCreditCapacity(250);
  assert.equal(rows.length, 8);
  assert.equal(rows.find((r) => r.id === 'chat')?.estimatedRuns, 250);
  assert.equal(rows.find((r) => r.id === 'pdf')?.estimatedRuns, 50);
  assert.equal(rows.find((r) => r.id === 'ppt')?.estimatedRuns, 31);
  assert.equal(rows.find((r) => r.id === 'image')?.estimatedRuns, 25);

  const zeroRows = computeCreditCapacity(-10);
  assert.equal(zeroRows.every((r) => r.estimatedRuns === 0), true);
});

test('HERO_SCRAMBLE_LINES provides 14 curated unique obscure fun facts for Hero MotionScrambleText', () => {
  assert.equal(HERO_SCRAMBLE_LINES.length, 14);
  assert.equal(new Set(HERO_SCRAMBLE_LINES).size, 14);
  for (const line of HERO_SCRAMBLE_LINES) {
    assert.ok(line.trim().length > 20);
  }
});

test('computeScrambleFrame preserves spaces and settles to exact target at progress 1', () => {
  const target = 'Eight specialists. One unified workspace.';
  const start = computeScrambleFrame(target, 0, 1);
  assert.equal(start.length, target.length);
  assert.notEqual(start, target);
  // Spaces preserved at identical indices
  for (let i = 0; i < target.length; i += 1) {
    if (target[i] === ' ') {
      assert.equal(start[i], ' ');
    }
  }
  const mid = computeScrambleFrame(target, 0.5, 4);
  assert.equal(mid.slice(0, 10), target.slice(0, 10));
  assert.equal(computeScrambleFrame(target, 1, 9), target);
});

test('computeStreamStepChars scales fluidly across short and long responses with zero guard', () => {
  assert.equal(computeStreamStepChars(120, 0), 0);
  const shortStep = computeStreamStepChars(120, 100);
  const longStep = computeStreamStepChars(3000, 1000);
  assert.equal(shortStep, 2);
  assert.ok(longStep > shortStep);
  assert.equal(computeStreamStepChars(3000, 5), 5);
});

test('inferConversationArtifactKind prioritizes recorded artifactType and falls back to title keywords', () => {
  assert.equal(inferConversationArtifactKind('Random chat', 'code_bundle'), 'code_bundle');
  assert.equal(inferConversationArtifactKind('Random chat', 'pdf_document'), 'pdf_document');
  assert.equal(inferConversationArtifactKind('Random chat', 'ppt_presentation'), 'ppt_presentation');
  assert.equal(inferConversationArtifactKind('Random chat', 'generated_image'), 'generated_image');

  assert.equal(inferConversationArtifactKind('Build an interactive calculator app'), 'code_bundle');
  assert.equal(inferConversationArtifactKind('Generate a PDF consensus report'), 'pdf_document');
  assert.equal(inferConversationArtifactKind('Create a 6-slide presentation deck'), 'ppt_presentation');
  assert.equal(inferConversationArtifactKind('Generate monochrome architectural artwork'), 'generated_image');
  assert.equal(inferConversationArtifactKind('Explain PostgreSQL MVCC locking'), null);
});


