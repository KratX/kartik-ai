/**
 * @kartik/agent/agents/ppt — Structured 6-Slide PPTX Generator & OpenXML Archive Builder
 * (Blueprint §4.1, §7.2 Phase 10 & Tutorial Part 2).
 *
 * Generates:
 * 1. A validated 16:9 slide deck (`Cover Slide` + `6 Content Slides` + `Thank You Slide`).
 * 2. A standards-compliant OpenXML `.pptx` ZIP archive (`PK\x03\x04`) containing
 *    `[Content_Types].xml`, `_rels/.rels`, `ppt/presentation.xml`, `ppt/_rels/presentation.xml.rels`,
 *    and `ppt/slides/slide1.xml`..`slideN.xml` with DrawingML shapes and bullet runs.
 * 3. Structured JSON slide metadata so the chat UI can both download the `.pptx` file AND render
 *    an interactive 16:9 Slide Deck Previewer inline inside the chat bubble.
 */

import {
  validatePptPresentationSpec,
  type PptPresentationSpec,
  type PptSlideSpec,
} from '../../schemas/index.js';

export interface PptPresentationGenerationResult {
  readonly spec: PptPresentationSpec;
  readonly pptxBytes: Uint8Array;
  readonly slideCount: number;
  readonly summaryMarkdown: string;
  readonly tokensUsed: number;
}

export interface PptPresentationProvider {
  readonly providerName: string;
  generatePptPresentation(input: {
    readonly prompt: string;
    readonly maxOutputTokens: number;
  }): Promise<PptPresentationGenerationResult>;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Standard CRC-32 calculation for ZIP local and central directory headers.
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntryInput {
  readonly path: string;
  readonly content: Buffer;
}

/**
 * Packs a list of files into a standards-compliant uncompressed ZIP archive (`PK\x03\x04`)
 * used by OpenXML `.pptx` containers.
 */
function buildUncompressedZipArchive(entries: readonly ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const dataBuf = entry.content;
    const crc = crc32(dataBuf);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature PK\x03\x04
    localHeader.writeUInt16LE(20, 4); // version needed (2.0)
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression method: 0 (STORED)
    localHeader.writeUInt16LE(0x5800, 10); // mod time
    localHeader.writeUInt16LE(0x5d6c, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18); // compressed size
    localHeader.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localParts.push(localHeader, nameBuf, dataBuf);

    // Central directory file header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature PK\x01\x02
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10); // STORED
    centralHeader.writeUInt16LE(0x5800, 12);
    centralHeader.writeUInt16LE(0x5d6c, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature PK\x05\x06
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function buildSlideXml(slide: PptSlideSpec): string {
  const paragraphsXml: string[] = [];

  // Title paragraph
  paragraphsXml.push(
    `<a:p><a:r><a:rPr lang="en-US" sz="${slide.kind === 'cover' || slide.kind === 'thank_you' ? '3600' : '2800'}" b="1"/><a:t>${escapeXml(slide.title)}</a:t></a:r></a:p>`,
  );

  if (slide.subtitle) {
    paragraphsXml.push(
      `<a:p><a:r><a:rPr lang="en-US" sz="1800" i="1"/><a:t>${escapeXml(slide.subtitle)}</a:t></a:r></a:p>`,
    );
  }

  for (const bullet of slide.bullets) {
    paragraphsXml.push(
      `<a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>• ${escapeXml(bullet)}</a:t></a:r></a:p>`,
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '  <p:cSld>',
    '    <p:spTree>',
    '      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
    '      <p:sp>',
    '        <p:nvSpPr><p:cNvPr id="2" name="SlideContentBox"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>',
    '        <p:spPr><a:xfrm><a:off x="609600" y="457200"/><a:ext cx="10972800" cy="5943600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>',
    '        <p:txBody>',
    '          <a:bodyPr wrap="square"/>',
    '          <a:lstStyle/>',
    `          ${paragraphsXml.join('\n          ')}`,
    '        </p:txBody>',
    '      </p:sp>',
    '    </p:spTree>',
    '  </p:cSld>',
    '</p:sld>',
  ].join('\n');
}

/**
 * Compiles a validated `PptPresentationSpec` into a real OpenXML `.pptx` binary buffer (`PK\x03\x04`).
 */
export function buildPptxBinaryBuffer(rawSpec: PptPresentationSpec): {
  readonly pptxBytes: Buffer;
  readonly slideCount: number;
  readonly spec: PptPresentationSpec;
} {
  const spec = validatePptPresentationSpec(rawSpec);
  const slides = spec.slides;

  const slideOverrrides = slides
    .map(
      (_, idx) =>
        `  <Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join('\n');

  const contentTypesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    slideOverrrides,
    '</Types>',
  ].join('\n');

  const rootRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>',
    '</Relationships>',
  ].join('\n');

  const sldIdLstXml = slides
    .map((_, idx) => `    <p:sldId id="${256 + idx}" r:id="rId${idx + 1}"/>`)
    .join('\n');

  const presentationXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '  <p:sldIdLst>',
    sldIdLstXml,
    '  </p:sldIdLst>',
    '  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>',
    '  <p:notesSz cx="6858000" cy="9144000"/>',
    '</p:presentation>',
  ].join('\n');

  const presRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    slides
      .map(
        (_, idx) =>
          `  <Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${idx + 1}.xml"/>`,
      )
      .join('\n'),
    '</Relationships>',
  ].join('\n');

  const zipEntries: ZipEntryInput[] = [
    { path: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
    { path: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf8') },
    { path: 'ppt/presentation.xml', content: Buffer.from(presentationXml, 'utf8') },
    { path: 'ppt/_rels/presentation.xml.rels', content: Buffer.from(presRelsXml, 'utf8') },
  ];

  slides.forEach((slide, idx) => {
    zipEntries.push({
      path: `ppt/slides/slide${idx + 1}.xml`,
      content: Buffer.from(buildSlideXml(slide), 'utf8'),
    });
  });

  const pptxBytes = buildUncompressedZipArchive(zipEntries);

  return Object.freeze({
    pptxBytes,
    slideCount: slides.length,
    spec,
  });
}

/**
 * Formats a concise Markdown summary of the generated slide deck for the assistant chat bubble.
 */
export function formatPptSummaryMarkdown(spec: PptPresentationSpec): string {
  const slideLines = spec.slides
    .map((s) => `- **Slide ${s.slideNumber} (${s.kind === 'cover' ? 'Cover' : s.kind === 'thank_you' ? 'Closing' : 'Content'}):** ${s.title}`)
    .join('\n');

  return [
    `### ${spec.title}`,
    `*${spec.subtitle}*`,
    '',
    `Your **${spec.slides.length}-slide widescreen (16:9) presentation** has been generated. You can step through the interactive slide preview below or download the \`.pptx\` deck directly:`,
    '',
    slideLines,
  ].join('\n');
}

/**
 * Deterministic 6-Slide PPT Presentation Provider for offline unit tests and `MOCK_AI=true` environments.
 */
export class MockPptPresentationProvider implements PptPresentationProvider {
  public readonly providerName = 'mock-ppt';

  public async generatePptPresentation(input: {
    readonly prompt: string;
    readonly maxOutputTokens: number;
  }): Promise<PptPresentationGenerationResult> {
    const cleanTopic = input.prompt
      .replace(/^(generate|create|write|build|make)\s+(a\s+)?(ppt|pptx|presentation|slide deck|slides|powerpoint)\s*(on|about|for)?\s*/i, '')
      .trim() || 'Modern Cloud & Multi-Agent Architecture';

    const titleTopic =
      cleanTopic.charAt(0).toUpperCase() + cleanTopic.slice(1).slice(0, 75);

    const rawSlides = [
      {
        title: `Introduction to ${titleTopic}`,
        subtitle: 'Vision, Context & Core Objectives',
        bullets: [
          `Why ${titleTopic} matters for modern engineering teams`,
          'Key architectural drivers: reliability, latency, and cost control',
          'High-level system boundaries and user experience goals',
        ],
      },
      {
        title: 'System Architecture & Service Ownership',
        subtitle: 'Decoupled Microservices Behind a Single Gateway',
        bullets: [
          'Single public API Gateway enforcing authentication and rate limits',
          'Strict schema isolation across Auth, Chat, Agent, and Billing',
          'Private service-to-service contracts with cryptographic user assertions',
        ],
      },
      {
        title: 'Request Lifecycle & Idempotency',
        subtitle: 'Zero Double-Charges Across Retries',
        bullets: [
          'Client-generated Idempotency-Key preserved end-to-end as requestId',
          'Gateway generates ULID traceId for cross-service log correlation',
          'Five deterministic replay outcomes prevent duplicate execution',
        ],
      },
      {
        title: 'Multi-Agent Orchestration & Grounding',
        subtitle: 'LangGraph Routing Across 7 Specialist Capabilities',
        bullets: [
          'Router node dispatches to Chat, Search, Coding, PDF, PPT, Vision, or Image',
          'RAG vector retrieval strictly filtered by authenticated userId and fileId',
          'All model JSON outputs validated against strict schemas before persistence',
        ],
      },
      {
        title: 'Transactional Billing & Credit Ledger',
        subtitle: 'Append-Only Financial Integrity in PostgreSQL',
        bullets: [
          'Row-level SELECT ... FOR UPDATE locks prevent concurrent overdraws',
          'Reserve before execution, settle after durable write, release on failure',
          'Server-side Razorpay checkout and raw-body webhook HMAC verification',
        ],
      },
      {
        title: 'Deployment, Observability & Key Takeaways',
        subtitle: 'Production Readiness at Zero Recurring Cost',
        bullets: [
          'Containerized workspace deployment with automated health and readiness probes',
          'Layered Redis rate limiters and daily provider budget protection',
          'Complete test evidence across unit, contract, and end-to-end suites',
        ],
      },
    ];

    const spec = validatePptPresentationSpec({
      title: titleTopic,
      subtitle: 'Executive Architecture & Engineering Presentation',
      slides: rawSlides,
    });

    const compiled = buildPptxBinaryBuffer(spec);

    return Object.freeze({
      spec: compiled.spec,
      pptxBytes: compiled.pptxBytes,
      slideCount: compiled.slideCount,
      summaryMarkdown: formatPptSummaryMarkdown(compiled.spec),
      tokensUsed: 220,
    });
  }
}
