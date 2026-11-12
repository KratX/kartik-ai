import {
  GatewayApiError,
  generateClientIdempotencyKey,
  type KartikGatewayClient,
} from '../lib/api-client.js';
import type {
  AuthenticatedUserProfile,
  ChatMessageItem,
  ConversationSummary,
  SpecialistAgentName,
} from '../types/index.js';

export interface WorkspaceState {
  readonly authStatus: 'anonymous' | 'authenticating' | 'authenticated';
  readonly user: AuthenticatedUserProfile | null;
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId: string | null;
  readonly messagesByConversation: Readonly<
    Record<string, readonly ChatMessageItem[]>
  >;
  readonly selectedSpecialist: SpecialistAgentName;
  readonly availableCredits: number;
  readonly demoReadOnlyBanner: boolean;
  readonly pendingTurnKey: string | null;
  readonly lastError: {
    readonly code: string;
    readonly message: string;
    readonly traceId: string;
    readonly recoveryAction: string;
  } | null;
}

/**
 * Framework-agnostic Workspace State Store (`@kartik/frontend/store`, Micro-step 7.1.a).
 *
 * Manages:
 * - Auth session state (`anonymous` | `authenticated`)
 * - Conversation list, active conversation, and messages per conversation
 * - Credit balance updates from `SendMessageTurnResponse.remainingCredits`
 * - `DEMO_READ_ONLY` banner detection when a mutating call returns `403 DEMO_READ_ONLY` (§12)
 * - Safe `Idempotency-Key` retention (`pendingTurnKey`) when a turn fails with `503 BILLING_UNAVAILABLE`
 *   so retrying the turn reuses the exact same `Idempotency-Key` (Invariant #15).
 */
export class WorkspaceStore {
  private state: WorkspaceState;
  private readonly client: KartikGatewayClient;
  private readonly listeners = new Set<(state: WorkspaceState) => void>();

  constructor(client: KartikGatewayClient, initialCredits = 100) {
    this.client = client;
    this.state = Object.freeze({
      authStatus: 'anonymous',
      user: null,
      conversations: Object.freeze([]),
      activeConversationId: null,
      messagesByConversation: Object.freeze({}),
      selectedSpecialist: 'chat',
      availableCredits: initialCredits,
      demoReadOnlyBanner: false,
      pendingTurnKey: null,
      lastError: null,
    });
  }

  public getState(): WorkspaceState {
    return this.state;
  }

  public subscribe(listener: (state: WorkspaceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<WorkspaceState>): WorkspaceState {
    this.state = Object.freeze({
      ...this.state,
      ...patch,
    });
    for (const listener of this.listeners) {
      listener(this.state);
    }
    return this.state;
  }

  public setSelectedSpecialist(specialist: SpecialistAgentName): WorkspaceState {
    return this.setState({ selectedSpecialist: specialist });
  }

  public async signInWithGoogle(idToken: string): Promise<WorkspaceState> {
    this.setState({ authStatus: 'authenticating', lastError: null });
    try {
      const user = await this.client.loginWithGoogle(idToken);
      return this.setState({
        authStatus: 'authenticated',
        user,
        lastError: null,
      });
    } catch (err) {
      this.recordError(err);
      this.setState({ authStatus: 'anonymous', user: null });
      throw err;
    }
  }

  public async sendTurn(input: {
    readonly conversationId: string;
    readonly prompt: string;
    readonly attachmentFileIds?: readonly string[];
  }): Promise<WorkspaceState> {
    // Reuse pendingTurnKey if retrying after BILLING_UNAVAILABLE; otherwise mint a fresh client key (Invariant #15)
    const idempotencyKey =
      this.state.pendingTurnKey ?? generateClientIdempotencyKey('req_turn');
    this.setState({ pendingTurnKey: idempotencyKey, lastError: null });

    try {
      const turn = await this.client.sendMessage({
        conversationId: input.conversationId,
        prompt: input.prompt,
        requestedAgent: this.state.selectedSpecialist,
        attachmentFileIds: input.attachmentFileIds,
        idempotencyKey,
      });

      const existing =
        this.state.messagesByConversation[input.conversationId] ?? [];
      const nextMessages = existing.some(
        (m) => m.messageId === turn.assistantMessage.messageId,
      )
        ? existing
        : Object.freeze([...existing, turn.userMessage, turn.assistantMessage]);

      return this.setState({
        messagesByConversation: Object.freeze({
          ...this.state.messagesByConversation,
          [input.conversationId]: nextMessages,
        }),
        availableCredits: turn.remainingCredits,
        pendingTurnKey: null,
        lastError: null,
      });
    } catch (err) {
      this.recordError(err);
      if (err instanceof GatewayApiError) {
        // Keep the same Idempotency-Key ONLY when recoveryAction === 'retry_same_key' (e.g. BILLING_UNAVAILABLE)
        const nextPendingKey =
          err.recoveryAction === 'retry_same_key' ? idempotencyKey : null;
        this.setState({
          pendingTurnKey: nextPendingKey,
          ...(err.code === 'DEMO_READ_ONLY'
            ? { demoReadOnlyBanner: true }
            : {}),
        });
      } else {
        this.setState({ pendingTurnKey: null });
      }
      throw err;
    }
  }

  private recordError(err: unknown): void {
    if (err instanceof GatewayApiError) {
      this.setState({
        lastError: Object.freeze({
          code: err.code,
          message: err.message,
          traceId: err.traceId,
          recoveryAction: err.recoveryAction,
        }),
      });
      return;
    }
    this.setState({
      lastError: Object.freeze({
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unexpected client error',
        traceId: 'trace_client',
        recoveryAction: 'do_not_retry',
      }),
    });
  }
}
