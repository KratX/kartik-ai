import { AppError } from '@kartik/shared/errors';
import type { AgentExecuteRequest } from '@kartik/shared/contracts';
import type { AgentGraphExecutor } from '../graph/index.js';
import type {
  FileIngestionAndArtifactService,
  PdfPageText,
} from '../rag/index.js';
import type { AgentRepository } from '../repositories/index.js';

export interface AgentControllerDependencies {
  readonly repository: AgentRepository;
  readonly ingestionService: FileIngestionAndArtifactService;
  readonly graphExecutor: AgentGraphExecutor;
  readonly checkReadiness?: () => Promise<boolean>;
}

/**
 * HTTP Controller for the Agent Service (`@kartik/agent`, Micro-step 5.4.a).
 *
 * Handles:
 * - Health & readiness probes (`/healthz`, `/readyz`)
 * - Public file & artifact routes (`/files`, `/files/:fileId`, `/artifacts/:artifactId`)
 * - Internal Chat-to-Agent routes (`/internal/agent/execute`, `/internal/agent/purge`)
 */
export class AgentController {
  private readonly deps: AgentControllerDependencies;

  constructor(deps: AgentControllerDependencies) {
    this.deps = deps;
  }

  public getHealthz(): { readonly status: 'ok'; readonly service: 'agent' } {
    return { status: 'ok', service: 'agent' };
  }

  public async getReadyz(): Promise<{
    readonly status: 'ready' | 'degraded';
    readonly service: 'agent';
  }> {
    if (this.deps.checkReadiness) {
      const ok = await this.deps.checkReadiness();
      if (!ok) {
        throw new AppError('PROVIDER_UNAVAILABLE', 'Agent service dependencies are not ready');
      }
    }
    return { status: 'ready', service: 'agent' };
  }

  public async uploadFile(
    userId: string,
    body: unknown,
  ) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('VALIDATION_FAILED', 'Request body must be a JSON object');
    }

    const payload = body as Record<string, unknown>;
    if (
      typeof payload.conversationId !== 'string' ||
      payload.conversationId.trim().length === 0
    ) {
      throw new AppError('VALIDATION_FAILED', 'conversationId is required');
    }
    if (
      typeof payload.originalFilename !== 'string' ||
      payload.originalFilename.trim().length === 0
    ) {
      throw new AppError('VALIDATION_FAILED', 'originalFilename is required');
    }
    if (
      typeof payload.declaredMimeType !== 'string' ||
      payload.declaredMimeType.trim().length === 0
    ) {
      throw new AppError('VALIDATION_FAILED', 'declaredMimeType is required');
    }
    if (typeof payload.contentBase64 !== 'string' || payload.contentBase64.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'contentBase64 is required');
    }

    const contentBytes = new Uint8Array(Buffer.from(payload.contentBase64, 'base64'));
    const extractedPdfPages = Array.isArray(payload.extractedPdfPages)
      ? (payload.extractedPdfPages as PdfPageText[])
      : undefined;

    return this.deps.ingestionService.ingestUploadedFile({
      userId,
      conversationId: payload.conversationId.trim(),
      originalFilename: payload.originalFilename.trim(),
      declaredMimeType: payload.declaredMimeType.trim(),
      contentBytes,
      extractedPdfPages,
    });
  }

  public async listFiles(userId: string) {
    const files = await this.deps.repository.listFilesByUser(userId);
    return { items: files };
  }

  public async getFile(userId: string, fileId: string) {
    return this.deps.ingestionService.getFileWithSignedUrl({
      userId,
      fileId,
    });
  }

  public async getArtifact(userId: string, artifactId: string) {
    return this.deps.ingestionService.getArtifactWithSignedUrl({
      userId,
      artifactId,
    });
  }

  public async getArtifactContent(userId: string, artifactId: string) {
    return this.deps.ingestionService.getArtifactWithRawBytes({
      userId,
      artifactId,
    });
  }

  public async executeInternalTurn(body: unknown) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('VALIDATION_FAILED', 'Execute request body must be a JSON object');
    }
    return this.deps.graphExecutor.execute(body as AgentExecuteRequest);
  }

  public async purgeInternalResources(body: unknown) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('VALIDATION_FAILED', 'Purge request body must be a JSON object');
    }
    const payload = body as {
      readonly userId?: string;
      readonly conversationId?: string;
      readonly fileIds?: readonly string[];
      readonly artifactIds?: readonly string[];
    };
    if (typeof payload.userId !== 'string' || payload.userId.trim().length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Purge request requires a non-empty userId');
    }

    return this.deps.ingestionService.purgeResources({
      userId: payload.userId,
      conversationId: payload.conversationId,
      fileIds: payload.fileIds,
      artifactIds: payload.artifactIds,
    });
  }
}
