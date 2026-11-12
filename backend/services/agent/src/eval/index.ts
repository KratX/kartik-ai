import type { SpecialistAgentName } from '@kartik/shared/contracts';
import { validateArtifactManifest } from '@kartik/shared/validation';
import type { AgentGraphExecutor, AgentMetadataStore } from '../graph/index.js';

export interface SpecialistEvaluationCase {
  readonly caseId: string;
  readonly description: string;
  readonly prompt: string;
  readonly preferredAgent?: SpecialistAgentName;
  readonly requiresPdfAttachment?: boolean;
  readonly requiresImageAttachment?: boolean;
  readonly expectedSpecialist: SpecialistAgentName;
  readonly requiresCitations: boolean;
  readonly requiresArtifact: boolean;
}

/**
 * Canonical 8-prompt evaluation dataset across all 6 specialists (`Blueprint §10`):
 * "Maintain a small evaluation set per agent (5–10 prompts to start).
 * Evaluate structure, routing, grounding and safety — not exact strings."
 */
export const SPECIALIST_EVALUATION_DATASET: readonly SpecialistEvaluationCase[] = Object.freeze([
  {
    caseId: 'eval_01_chat_architecture',
    description: 'General engineering explanation routed to chat specialist',
    prompt: 'Explain the trade-off between pessimistic locking and optimistic concurrency in PostgreSQL.',
    expectedSpecialist: 'chat',
    requiresCitations: false,
    requiresArtifact: false,
  },
  {
    caseId: 'eval_02_search_grounded_web',
    description: 'Live web lookup routed to search specialist with cited sources + synthesis',
    prompt: 'Search the web for the latest Node.js LTS release schedule and cite sources.',
    expectedSpecialist: 'search',
    requiresCitations: true,
    requiresArtifact: false,
  },
  {
    caseId: 'eval_03_coding_sandbox_app',
    description: 'Interactive web widget routed to coding specialist with validated artifact manifest',
    prompt: 'Build an app in HTML and TypeScript for a compound interest calculator widget.',
    expectedSpecialist: 'coding',
    requiresCitations: false,
    requiresArtifact: true,
  },
  {
    caseId: 'eval_04_rag_pdf_grounding',
    description: 'Document question with attached PDF routed to rag specialist with page citations',
    prompt: 'According to the uploaded PDF document, how are credit reservations locked before agent execution?',
    requiresPdfAttachment: true,
    expectedSpecialist: 'rag',
    requiresCitations: true,
    requiresArtifact: false,
  },
  {
    caseId: 'eval_05_vision_image_inspection',
    description: 'Uploaded PNG diagram routed to vision specialist for structural inspection',
    prompt: 'Inspect the attached architecture diagram and summarize its service boundaries.',
    requiresImageAttachment: true,
    expectedSpecialist: 'vision',
    requiresCitations: false,
    requiresArtifact: false,
  },
  {
    caseId: 'eval_06_image_generation',
    description: 'Visual asset request routed to image specialist producing private PNG artifact',
    prompt: 'Generate an image of a minimalist dark-mode cloud topology diagram.',
    expectedSpecialist: 'image',
    requiresCitations: false,
    requiresArtifact: true,
  },
  {
    caseId: 'eval_07_explicit_preferred_search',
    description: 'Explicit preferredAgent override routes to search even without search keywords',
    prompt: 'PostgreSQL 17 release notes overview.',
    preferredAgent: 'search',
    expectedSpecialist: 'search',
    requiresCitations: true,
    requiresArtifact: false,
  },
  {
    caseId: 'eval_08_coding_component_safety',
    description: 'Multi-file UI component routed to coding specialist enforcing safe relative paths',
    prompt: 'Write code to create a component for a status badge with CSS styling.',
    expectedSpecialist: 'coding',
    requiresCitations: false,
    requiresArtifact: true,
  },
]);

/**
 * Neutralizes prompt-injection control markers inside untrusted retrieved content
 * (`Blueprint §10`: "Keep system instructions separate from user prompts and from
 * retrieved content. Search results, uploads, PDFs and web pages are data, not instructions.")
 */
export function sanitizeUntrustedRetrievedData(rawContent: string): {
  readonly safeDataText: string;
  readonly injectionAttemptDetected: boolean;
} {
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior)\s+instructions/gi,
    /<\s*\/?\s*(system|instruction|tool_call|prompt)\s*>/gi,
    /\bsystem\s*override\s*:/gi,
    /\bexecute\s+shell\s*:/gi,
  ];

  let sanitized = rawContent;
  let injectionAttemptDetected = false;

  for (const pattern of injectionPatterns) {
    if (pattern.test(sanitized)) {
      injectionAttemptDetected = true;
      sanitized = sanitized.replace(pattern, '[UNTRUSTED_DATA_DIRECTIVE_NEUTRALIZED]');
    }
  }

  return Object.freeze({
    safeDataText: `[DATA_ONLY_BEGIN] ${sanitized.trim()} [DATA_ONLY_END]`,
    injectionAttemptDetected,
  });
}

export interface EvaluationCaseResult {
  readonly caseId: string;
  readonly passed: boolean;
  readonly expectedSpecialist: SpecialistAgentName;
  readonly actualSpecialist: SpecialistAgentName;
  readonly structureValid: boolean;
  readonly groundingValid: boolean;
  readonly safetyValid: boolean;
  readonly failureReasons: readonly string[];
}

export interface EvaluationSuiteReport {
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly passRate: number;
  readonly results: readonly EvaluationCaseResult[];
}

export interface SpecialistEvaluationRunnerInput {
  readonly executor: AgentGraphExecutor;
  readonly metadataStore: AgentMetadataStore;
  readonly userId: string;
  readonly conversationId: string;
  readonly samplePdfFileId: string;
  readonly sampleImageFileId: string;
  readonly cases?: readonly SpecialistEvaluationCase[];
}

/**
 * Executes the Specialist Evaluation Suite against `AgentGraphExecutor`,
 * verifying structure, routing, grounding, and artifact safety (`Blueprint §10`).
 */
export class SpecialistEvaluationRunner {
  public async runSuite(
    input: SpecialistEvaluationRunnerInput,
  ): Promise<EvaluationSuiteReport> {
    const cases = input.cases ?? SPECIALIST_EVALUATION_DATASET;
    const results: EvaluationCaseResult[] = [];

    for (const testCase of cases) {
      const failureReasons: string[] = [];
      const attachmentFileIds: string[] = [];

      if (testCase.requiresPdfAttachment) {
        attachmentFileIds.push(input.samplePdfFileId);
      }
      if (testCase.requiresImageAttachment) {
        attachmentFileIds.push(input.sampleImageFileId);
      }

      const requestId = `req_eval_${testCase.caseId}`;
      const response = await input.executor.execute({
        requestId,
        traceId: `trace_eval_${testCase.caseId}`,
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: `msg_eval_${testCase.caseId}`,
        prompt: testCase.prompt,
        preferredAgent: testCase.preferredAgent,
        attachmentFileIds: attachmentFileIds.length > 0 ? attachmentFileIds : undefined,
      });

      // 1. Routing check
      if (response.agent !== testCase.expectedSpecialist) {
        failureReasons.push(
          `Expected specialist "${testCase.expectedSpecialist}", got "${response.agent}"`,
        );
      }

      // 2. Structural check
      const structureValid =
        typeof response.executionId === 'string' &&
        response.executionId.startsWith('exec_') &&
        response.requestId === requestId &&
        typeof response.replyContent === 'string' &&
        response.replyContent.trim().length > 0 &&
        response.usage.totalTokens > 0;

      if (!structureValid) {
        failureReasons.push('Response failed structural contract validation');
      }

      // 3. Grounding check (Search & RAG must attach citations; Search separates sources from synthesis)
      let groundingValid = true;
      if (testCase.requiresCitations) {
        const citations = response.citations ?? [];
        if (citations.length === 0) {
          groundingValid = false;
          failureReasons.push(`Expected non-empty citations for "${response.agent}" specialist`);
        } else if (response.agent === 'search') {
          const hasSections =
            response.replyContent.includes('### Cited Source Material') &&
            response.replyContent.includes('### Synthesis');
          const allUrlsValid = citations.every((c) => /^https?:\/\//i.test(c.urlOrPage));
          if (!hasSections || !allUrlsValid) {
            groundingValid = false;
            failureReasons.push(
              'Search specialist must separate Cited Source Material from Synthesis and include valid http(s) URLs',
            );
          }
        } else if (response.agent === 'rag') {
          const allPagesValid = citations.every((c) => /^p\.\s*\d+$/i.test(c.urlOrPage));
          if (!allPagesValid) {
            groundingValid = false;
            failureReasons.push(
              'RAG specialist citations must include document title and page number (p. N)',
            );
          }
        }
      }

      // 4. Artifact & path safety check
      let safetyValid = true;
      if (testCase.requiresArtifact) {
        const artifactIds = response.artifactIds ?? [];
        if (artifactIds.length === 0) {
          safetyValid = false;
          failureReasons.push(`Expected persisted artifactIds for "${response.agent}" specialist`);
        } else if (response.agent === 'coding') {
          const record = await input.metadataStore.getArtifactByRequestId(
            input.userId,
            requestId,
          );
          if (!record) {
            safetyValid = false;
            failureReasons.push('Coding artifact record not found in metadataStore');
          } else {
            try {
              validateArtifactManifest({
                title: record.title,
                entryFile: record.entryFile,
                files: record.filesManifest,
              });
            } catch (err) {
              safetyValid = false;
              failureReasons.push(
                `Coding artifact manifest failed safety validation: ${(err as Error).message}`,
              );
            }
          }
        }
      }

      const passed =
        failureReasons.length === 0 && structureValid && groundingValid && safetyValid;

      results.push(
        Object.freeze({
          caseId: testCase.caseId,
          passed,
          expectedSpecialist: testCase.expectedSpecialist,
          actualSpecialist: response.agent,
          structureValid,
          groundingValid,
          safetyValid,
          failureReasons: Object.freeze(failureReasons),
        }),
      );
    }

    const passedCases = results.filter((r) => r.passed).length;
    const failedCases = results.length - passedCases;

    return Object.freeze({
      totalCases: results.length,
      passedCases,
      failedCases,
      passRate: results.length > 0 ? passedCases / results.length : 1,
      results: Object.freeze(results),
    });
  }
}
