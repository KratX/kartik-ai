/**
 * @kartik/frontend/app/workspace-shell — Kartik.ai Workspace Shell Controller (Micro-step 7.3.a — Phase 7 Exit Gate).
 *
 * Coordinates the complete browser workspace lifecycle through the API Gateway (`/api/v1/*`):
 * 1. Authentication (`signInWithGoogle`, `logout`)
 * 2. Conversation creation, listing, selection, and cascade deletion (`DELETE /conversations/:id`)
 * 3. Pre-flight validated file uploads (`POST /files`)
 * 4. Specialist prompt turns (`POST /conversations/:id/messages`) with grounded citation formatting
 *    and isolated browser code sandbox previews (`sandbox="allow-scripts"`)
 * 5. Server-priced credit top-ups (`POST /billing/orders` -> `POST /billing/verify`)
 */

import { BillingCheckoutController } from '../features/billing/index.js';
import {
  formatGroundedCitations,
  type GroundedMessagePresentation,
} from '../features/citations/index.js';
import {
  buildSandboxedPreviewDocument,
  type FrontendArtifactBundle,
  type SandboxedPreviewDescriptor,
} from '../features/sandbox/index.js';
import {
  validateClientUploadCandidate,
  type ClientUploadCandidate,
} from '../features/uploads/index.js';
import type { KartikGatewayClient } from '../lib/api-client.js';
import { WorkspaceStore, type WorkspaceState } from '../store/index.js';
import type {
  BillingPlanId,
  ConversationSummary,
  PaymentVerificationResult,
  UploadedFileSummary,
} from '../types/index.js';

export class KartikWorkspaceShellController {
  public readonly client: KartikGatewayClient;
  public readonly store: WorkspaceStore;
  public readonly billing: BillingCheckoutController;

  private readonly uploadedFilesByConversation = new Map<
    string,
    UploadedFileSummary[]
  >();

  constructor(options: {
    readonly client: KartikGatewayClient;
    readonly initialCredits?: number;
  }) {
    this.client = options.client;
    this.store = new WorkspaceStore(
      options.client,
      options.initialCredits ?? 100,
    );
    this.billing = new BillingCheckoutController(options.client);
  }

  public getState(): WorkspaceState {
    return this.store.getState();
  }

  public async bootstrapAndSignIn(
    mockOrFirebaseIdToken: string,
  ): Promise<WorkspaceState> {
    await this.store.signInWithGoogle(mockOrFirebaseIdToken);
    return this.store.getState();
  }

  public async startNewConversation(title: string): Promise<ConversationSummary> {
    return this.client.createConversation(title);
  }

  public async uploadAttachmentForConversation(
    conversationId: string,
    candidate: ClientUploadCandidate,
  ): Promise<UploadedFileSummary> {
    const existing =
      this.uploadedFilesByConversation.get(conversationId) ?? [];
    const validated = validateClientUploadCandidate(candidate, existing.length);

    const uploaded = await this.client.uploadFile({
      conversationId,
      originalFilename: validated.originalFilename,
      declaredMimeType: validated.declaredMimeType,
      contentBase64: validated.contentBase64,
    });

    this.uploadedFilesByConversation.set(conversationId, [
      ...existing,
      uploaded,
    ]);
    return uploaded;
  }

  public getUploadedAttachments(
    conversationId: string,
  ): readonly UploadedFileSummary[] {
    return Object.freeze([
      ...(this.uploadedFilesByConversation.get(conversationId) ?? []),
    ]);
  }

  public async submitSpecialistTurn(input: {
    readonly conversationId: string;
    readonly prompt: string;
    readonly attachmentFileIds?: readonly string[];
    readonly artifactBundleForPreview?: FrontendArtifactBundle;
  }): Promise<{
    readonly state: WorkspaceState;
    readonly groundedPresentation: GroundedMessagePresentation;
    readonly sandboxPreview: SandboxedPreviewDescriptor | null;
  }> {
    const state = await this.store.sendTurn({
      conversationId: input.conversationId,
      prompt: input.prompt,
      attachmentFileIds: input.attachmentFileIds,
    });

    const messages = state.messagesByConversation[input.conversationId] ?? [];
    const latestAssistant = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant');

    const groundedPresentation = formatGroundedCitations({
      agentUsed: latestAssistant?.agentUsed ?? state.selectedSpecialist,
      citations: latestAssistant?.citations ?? [],
    });

    const sandboxPreview = input.artifactBundleForPreview
      ? buildSandboxedPreviewDocument(input.artifactBundleForPreview)
      : null;

    return Object.freeze({
      state,
      groundedPresentation,
      sandboxPreview,
    });
  }

  public async topUpCreditsWithPlan(input: {
    readonly planId: BillingPlanId;
    readonly razorpayPaymentId: string;
    readonly razorpaySignature: string;
  }): Promise<{
    readonly formattedOrderAmount: string;
    readonly verification: PaymentVerificationResult;
  }> {
    const { order, formattedAmount } = await this.billing.initiatePlanTopUp(
      input.planId,
    );
    const verification = await this.billing.completeCheckoutVerification({
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      razorpaySignature: input.razorpaySignature,
    });

    return Object.freeze({
      formattedOrderAmount: formattedAmount,
      verification,
    });
  }

  public async deleteConversationCascade(conversationId: string): Promise<void> {
    await this.client.deleteConversation(conversationId);
    this.uploadedFilesByConversation.delete(conversationId);
  }
}
