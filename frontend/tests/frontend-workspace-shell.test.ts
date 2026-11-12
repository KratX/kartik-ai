import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRONTEND_PLAN_CATALOGUE_DISPLAY,
  KartikGatewayClient,
  KartikWorkspaceShellController,
  formatPaiseToInrLabel,
  validateClientUploadCandidate,
  type HttpTransportRequest,
} from '../src/index.js';

describe('@kartik/frontend Workspace Shell, Server-Priced Billing & Phase 7 Exit Gate (7.3.a)', () => {
  it('completes the full Kartik.ai workspace flow: Google Sign-In -> Create Conversation -> Upload PDF -> RAG/Coding Turn -> Sandbox Preview -> Cascade Delete (Phase 7 Exit Gate)', async () => {
    const requests: HttpTransportRequest[] = [];

    const client = new KartikGatewayClient({
      transport: async (req) => {
        requests.push(req);

        if (req.url === '/api/v1/auth/google') {
          return {
            status: 200,
            json: async () => ({
              traceId: 'trace_auth_73a',
              data: {
                user: {
                  userId: 'usr_kartik_73a',
                  email: 'kartik@example.com',
                  displayName: 'Kartik',
                  avatarUrl: null,
                },
              },
              meta: { nextCursor: null },
              error: null,
            }),
          };
        }

        if (req.url === '/api/v1/conversations' && req.method === 'POST') {
          return {
            status: 201,
            json: async () => ({
              traceId: 'trace_conv_73a',
              data: {
                conversationId: 'conv_73a_1',
                userId: 'usr_kartik_73a',
                title: 'Full Stack Architecture Review',
                deletionState: 'active',
                messageCount: 0,
                lastMessageAt: '2026-11-12T10:00:00.000Z',
                createdAt: '2026-11-12T10:00:00.000Z',
                updatedAt: '2026-11-12T10:00:00.000Z',
              },
              meta: { nextCursor: null },
              error: null,
            }),
          };
        }

        if (req.url === '/api/v1/files' && req.method === 'POST') {
          return {
            status: 201,
            json: async () => ({
              traceId: 'trace_file_73a',
              data: {
                fileId: 'file_pdf_73a_1',
                userId: 'usr_kartik_73a',
                conversationId: 'conv_73a_1',
                originalFilename: 'blueprint.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 2048,
              },
              meta: { nextCursor: null },
              error: null,
            }),
          };
        }

        if (
          req.url === '/api/v1/conversations/conv_73a_1/messages' &&
          req.method === 'POST'
        ) {
          const key = req.headers['Idempotency-Key'] ?? 'req_missing';
          return {
            status: 201,
            json: async () => ({
              requestId: key,
              traceId: 'trace_turn_73a',
              data: {
                conversationId: 'conv_73a_1',
                requestId: key,
                traceId: 'trace_turn_73a',
                remainingCredits: 80,
                idempotentReplay: false,
                userMessage: {
                  messageId: 'msg_u_73a',
                  conversationId: 'conv_73a_1',
                  userId: 'usr_kartik_73a',
                  requestId: key,
                  role: 'user',
                  content: 'Summarize the architecture and generate a widget',
                  agentUsed: null,
                  attachmentFileIds: ['file_pdf_73a_1'],
                  artifactIds: [],
                  citations: [],
                  createdAt: '2026-11-12T10:01:00.000Z',
                },
                assistantMessage: {
                  messageId: 'msg_a_73a',
                  conversationId: 'conv_73a_1',
                  userId: 'usr_kartik_73a',
                  requestId: key,
                  role: 'assistant',
                  content: 'Grounded summary and widget ready.',
                  agentUsed: 'rag',
                  attachmentFileIds: [],
                  artifactIds: ['art_widget_73a'],
                  citations: [
                    {
                      sourceId: 'chunk_73a_1',
                      title: 'blueprint.pdf',
                      urlOrPage: 'p. 7',
                    },
                  ],
                  createdAt: '2026-11-12T10:01:01.000Z',
                },
              },
              meta: { nextCursor: null },
              error: null,
            }),
          };
        }

        if (
          req.url === '/api/v1/conversations/conv_73a_1' &&
          req.method === 'DELETE'
        ) {
          return {
            status: 200,
            json: async () => ({
              traceId: 'trace_del_73a',
              data: { purged: true },
              meta: { nextCursor: null },
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected request: ${req.method} ${req.url}`);
      },
    });

    const shell = new KartikWorkspaceShellController({
      client,
      initialCredits: 100,
    });

    // 1. Sign in via Google
    const authedState = await shell.bootstrapAndSignIn('mock_google_id_token');
    assert.equal(authedState.authStatus, 'authenticated');
    assert.equal(authedState.user?.userId, 'usr_kartik_73a');

    // 2. Create conversation
    const conv = await shell.startNewConversation(
      'Full Stack Architecture Review',
    );
    assert.equal(conv.conversationId, 'conv_73a_1');

    // 3. Upload PDF attachment (strips directory path prefix before sending)
    const uploaded = await shell.uploadAttachmentForConversation('conv_73a_1', {
      originalFilename: 'C:\\Users\\karti\\Documents\\blueprint.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: 2048,
      contentBase64: 'JVBERi0xLjcK',
    });
    assert.equal(uploaded.fileId, 'file_pdf_73a_1');
    const uploadBody = JSON.parse(requests[2]?.body ?? '{}') as {
      originalFilename: string;
    };
    assert.equal(uploadBody.originalFilename, 'blueprint.pdf');

    // 4. Submit turn with RAG citations and sandboxed code preview
    shell.store.setSelectedSpecialist('rag');
    const turnOutcome = await shell.submitSpecialistTurn({
      conversationId: 'conv_73a_1',
      prompt: 'Summarize the architecture and generate a widget',
      attachmentFileIds: [uploaded.fileId],
      artifactBundleForPreview: {
        artifactId: 'art_widget_73a',
        title: 'Status Widget',
        entryFile: 'src/Widget.tsx',
        files: [
          {
            path: 'src/Widget.tsx',
            content: 'console.log("Sandboxed widget");',
          },
        ],
      },
    });

    assert.equal(turnOutcome.state.availableCredits, 80);
    assert.equal(turnOutcome.groundedPresentation.groundingMode, 'rag_document');
    assert.equal(
      turnOutcome.groundedPresentation.badges[0]?.safeLocationLabel,
      'p. 7',
    );
    assert.ok(turnOutcome.sandboxPreview);
    assert.equal(
      turnOutcome.sandboxPreview.iframeSandboxAttribute,
      'allow-scripts',
    );

    // 5. Cascade delete conversation
    await shell.deleteConversationCascade('conv_73a_1');
    assert.equal(shell.getUploadedAttachments('conv_73a_1').length, 0);
  });

  it('sends ONLY planId (never a client-calculated price) on POST /billing/orders and formats integer paise without floating-point drift (§11 & Invariant #5)', async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];

    const client = new KartikGatewayClient({
      transport: async (req) => {
        if (req.body) {
          capturedBodies.push(JSON.parse(req.body) as Record<string, unknown>);
        }
        if (req.url === '/api/v1/billing/orders') {
          return {
            status: 201,
            json: async () => ({
              traceId: 'trace_order_73a',
              data: {
                orderId: 'ord_internal_73a',
                razorpayOrderId: 'order_rzp_73a_500',
                planId: 'pro_500',
                amountPaise: 39900,
                creditsGranted: 500,
                currency: 'INR',
                status: 'CREATED',
              },
              meta: { nextCursor: null },
              error: null,
            }),
          };
        }
        return {
          status: 200,
          json: async () => ({
            traceId: 'trace_verify_73a',
            data: {
              orderId: 'ord_internal_73a',
              razorpayOrderId: 'order_rzp_73a_500',
              status: 'PAID',
              creditsAdded: 500,
              availableCreditsAfter: 580,
              alreadyCredited: false,
            },
            meta: { nextCursor: null },
            error: null,
          }),
        };
      },
    });

    const shell = new KartikWorkspaceShellController({ client });
    const topUp = await shell.topUpCreditsWithPlan({
      planId: 'pro_500',
      razorpayPaymentId: 'pay_rzp_73a_01',
      razorpaySignature: 'hmac_checkout_signature_73a',
    });

    // Order request body MUST contain strictly { planId: "pro_500" } — never amount or credits
    assert.deepEqual(capturedBodies[0], { planId: 'pro_500' });
    assert.equal(topUp.formattedOrderAmount, '₹399.00');
    assert.equal(topUp.verification.availableCreditsAfter, 580);
  });

  it('formats integer paise accurately and rejects floating-point or negative values in formatPaiseToInrLabel (§11)', () => {
    assert.equal(formatPaiseToInrLabel(0), '₹0.00');
    assert.equal(formatPaiseToInrLabel(9900), '₹99.00');
    assert.equal(formatPaiseToInrLabel(39905), '₹399.05');
    assert.equal(FRONTEND_PLAN_CATALOGUE_DISPLAY.length, 3);

    assert.throws(
      () => formatPaiseToInrLabel(99.5),
      /non-negative safe integer/,
    );
    assert.throws(
      () => formatPaiseToInrLabel(-100),
      /non-negative safe integer/,
    );
  });

  it('rejects unsupported file extensions, MIME mismatches, oversized files (>10 MB), and >5 attachments per turn in validateClientUploadCandidate (§10 & §11)', () => {
    // MIME / extension mismatch (.exe disguised as application/pdf)
    assert.throws(
      () =>
        validateClientUploadCandidate({
          originalFilename: 'malware.exe',
          declaredMimeType: 'application/pdf',
          sizeBytes: 1024,
          contentBase64: 'YWJj',
        }),
      /does not match declared MIME type/,
    );

    // Oversized upload (>10 MB)
    assert.throws(
      () =>
        validateClientUploadCandidate({
          originalFilename: 'huge.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: 11 * 1024 * 1024,
          contentBase64: 'YWJj',
        }),
      /must be between 1 and/,
    );

    // Attachment count ceiling (5 per turn)
    assert.throws(
      () =>
        validateClientUploadCandidate(
          {
            originalFilename: 'sixth.pdf',
            declaredMimeType: 'application/pdf',
            sizeBytes: 512,
            contentBase64: 'YWJj',
          },
          5,
        ),
      /Attachment limit reached/,
    );
  });
});
