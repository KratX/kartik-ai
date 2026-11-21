import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import {
  classifySpecialistRoute,
  type ConversationHistoryTurn,
  type ConversationThreadContext,
} from '@kartik/shared/contracts';
import { InMemoryObjectStorage } from '@kartik/shared/storage';
import {
  AgentGraphExecutor,
  DailyLiveBudgetGuard,
  InMemoryAgentRepository,
  InMemoryDailyBudgetStore,
  InMemoryVectorStore,
  MockCodingModelProvider,
  MockEmbeddingProvider,
  MockImageGenerationProvider,
  MockSearchProvider,
  MockVisionProvider,
  buildChatFollowUps,
  buildChatSystemInstruction,
  buildMultiTurnGeminiContents,
  buildOfflineChatReply,
  classifyChatMode,
  formatThreadContextBlock,
  getChatModeDisplayLabel,
  loadAgentConfig,
  normalizeChatResponseDepth,
  parseChatReplyAndFollowUps,
  resolveSpecialistRoutingDecision,
  routePromptToSpecialist,
  sanitizeConversationHistory,
  type ChatModelProvider,
} from '../src/index.js';

function createTestAgentConfig() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  return loadAgentConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://kartik:kartik@127.0.0.1:5432/kartik_test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    USER_CONTEXT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    INTERNAL_CALLER_TOKEN_CHAT: 'test-internal-chat-caller-token-1234',
    MOCK_AI: 'true',
    IMAGE_PROVIDER: 'mock',
    DAILY_LIVE_CALL_BUDGET: '50',
  });
}

describe('@kartik/agent Fix #21 Flagship Unified Chat Orchestrator Engine', () => {
  it('classifies all 5 adaptive Chat reasoning & formatting modes deterministically', () => {
    assert.equal(
      classifyChatMode('Write an executive email announcing our Q4 API launch'),
      'writing_editorial',
    );
    assert.equal(
      classifyChatMode('Teach me how PostgreSQL MVCC works step-by-step for beginners'),
      'step_by_step_mentor',
    );
    assert.equal(
      classifyChatMode('Explain PostgreSQL MVCC vs optimistic locking in TypeScript services'),
      'technical_architecture',
    );
    assert.equal(
      classifyChatMode('Compare bootstrapping vs raising VC for an early-stage SaaS roadmap'),
      'strategy_brainstorm',
    );
    assert.equal(
      classifyChatMode('What is the capital of Japan?'),
      'direct_concise',
    );
    assert.equal(getChatModeDisplayLabel('technical_architecture'), 'Technical & Architecture');
    assert.equal(normalizeChatResponseDepth('deep'), 'deep');
    assert.equal(normalizeChatResponseDepth('concise'), 'concise');
    assert.equal(normalizeChatResponseDepth('unknown'), 'balanced');
  });

  it('keeps conceptual technical questions in Chat (1 cr) while smart-delegating explicit specialist intents with routing attribution', () => {
    const conceptualTs = classifySpecialistRoute({
      prompt: 'Explain PostgreSQL MVCC vs optimistic locking in TypeScript services',
    });
    assert.equal(conceptualTs.agent, 'chat');
    assert.equal(conceptualTs.routedFromChat, false);

    const conceptualReact = classifySpecialistRoute({
      prompt: 'Why does React reconciliation rely on stable keys?',
    });
    assert.equal(conceptualReact.agent, 'chat');
    assert.equal(conceptualReact.routedFromChat, false);

    const explicitBuild = classifySpecialistRoute({
      prompt: 'Build a Kanban task tracker app with drag and drop',
    });
    assert.equal(explicitBuild.agent, 'coding');
    assert.equal(explicitBuild.routedFromChat, true);
    assert.equal(explicitBuild.reason, 'Code & sandbox request');

    const webLookup = classifySpecialistRoute({
      prompt: 'Search the web for latest Node.js 24 benchmarks and cite sources',
    });
    assert.equal(webLookup.agent, 'search');
    assert.equal(webLookup.routedFromChat, true);
    assert.equal(webLookup.reason, 'Live web lookup');

    const pdfExport = classifySpecialistRoute({
      prompt: 'Generate a PDF report on zero-trust architecture',
    });
    assert.equal(pdfExport.agent, 'pdf');
    assert.equal(pdfExport.routedFromChat, true);
    assert.equal(pdfExport.reason, 'PDF document generation');

    const pptDeck = classifySpecialistRoute({
      prompt: 'Create a 6-slide presentation on Cloud FinOps',
    });
    assert.equal(pptDeck.agent, 'ppt');
    assert.equal(pptDeck.routedFromChat, true);
    assert.equal(pptDeck.reason, 'Slide deck generation');

    const artwork = classifySpecialistRoute({
      prompt: 'Generate an image of a glass lighthouse at dusk in 16:9',
    });
    assert.equal(artwork.agent, 'image');
    assert.equal(artwork.routedFromChat, true);
    assert.equal(artwork.reason, 'Visual artwork request');

    // Explicit preferredAgent suppresses routedFromChat attribution
    const explicitSearch = resolveSpecialistRoutingDecision({
      prompt: 'Hello world',
      preferredAgent: 'search',
    });
    assert.equal(explicitSearch.agent, 'search');
    assert.equal(explicitSearch.routedFromChat, false);

    assert.equal(
      routePromptToSpecialist({
        prompt: 'Explain how TypeScript discriminated unions improve type safety',
      }),
      'chat',
    );
  });

  it('enforces bounded sliding-window memory (<= 12 turns), alternating Gemini contents, and thread file/artifact context', () => {
    const longHistory: ConversationHistoryTurn[] = Array.from({ length: 16 }, (_, idx) => ({
      role: idx % 2 === 0 ? 'user' : 'assistant',
      content: `Turn ${idx + 1} content ${'x'.repeat(20)}`,
    }));

    const sanitized = sanitizeConversationHistory(longHistory, 12, 80);
    assert.equal(sanitized.length, 12);
    assert.ok(sanitized[0]?.content.startsWith('Turn 5'));
    assert.ok(sanitized[11]?.content.startsWith('Turn 16'));

    const contents = buildMultiTurnGeminiContents('Now summarize that as a checklist', [
      { role: 'assistant', content: 'Welcome greeting that should be stripped first' },
      { role: 'user', content: 'Explain MVCC in PostgreSQL' },
      { role: 'assistant', content: 'MVCC keeps multiple tuple versions per transaction.' },
    ]);
    assert.equal(contents.length, 3);
    assert.equal(contents[0]?.role, 'user');
    assert.equal(contents[1]?.role, 'model');
    assert.equal(contents[2]?.role, 'user');
    assert.equal(contents[2]?.parts[0]?.text, 'Now summarize that as a checklist');

    const threadContext: ConversationThreadContext = {
      files: [{ filename: 'architecture-q4.pdf', mimeType: 'application/pdf', pageCount: 12 }],
      artifacts: [{ title: 'Zero-Trust Briefing', artifactType: 'pdf_document' }],
    };
    const contextBlock = formatThreadContextBlock(threadContext);
    assert.ok(contextBlock.includes('architecture-q4.pdf'));
    assert.ok(contextBlock.includes('12 pages'));
    assert.ok(contextBlock.includes('Zero-Trust Briefing'));

    const sysInstruction = buildChatSystemInstruction({
      mode: 'technical_architecture',
      responseDepth: 'deep',
      threadContext,
    });
    assert.ok(sysInstruction.includes('MODE: Technical & Architecture Specialist'));
    assert.ok(sysInstruction.includes('DEPTH: Deep Dive'));
    assert.ok(sysInstruction.includes('FOLLOW_UP_QUESTIONS:'));
    assert.ok(sysInstruction.includes('architecture-q4.pdf'));
  });

  it('parses FOLLOW_UP_QUESTIONS cleanly and guarantees 3 contextual follow-up chips', () => {
    const rawReply = [
      '### MVCC Overview',
      'PostgreSQL uses transaction IDs to provide snapshot isolation.',
      '',
      'FOLLOW_UP_QUESTIONS:',
      '- How does autovacuum prevent transaction ID wraparound?',
      '- Compare Serializable Snapshot Isolation vs Repeatable Read',
      '- Show a TypeScript optimistic lock version-column pattern',
    ].join('\n');

    const parsed = parseChatReplyAndFollowUps(
      rawReply,
      'Explain PostgreSQL MVCC',
      'technical_architecture',
    );
    assert.ok(!parsed.answer.includes('FOLLOW_UP_QUESTIONS'));
    assert.equal(parsed.followUpQueries.length, 3);
    assert.equal(
      parsed.followUpQueries[0],
      'How does autovacuum prevent transaction ID wraparound?',
    );

    const fallbackFollowUps = buildChatFollowUps(
      'Explain Raft leader election',
      'technical_architecture',
    );
    assert.equal(fallbackFollowUps.length, 3);
    assert.ok(fallbackFollowUps.every((q) => q.length >= 12));

    const offlineDeep = buildOfflineChatReply({
      prompt: 'Explain PostgreSQL MVCC vs optimistic locking in TypeScript services',
      mode: 'technical_architecture',
      responseDepth: 'deep',
      history: [{ role: 'user', content: 'Earlier question about locking' }],
      threadContext: {
        files: [{ filename: 'db-playbook.pdf', mimeType: 'application/pdf', pageCount: 4 }],
      },
    });
    assert.ok(offlineDeep.includes('```typescript'));
    assert.ok(offlineDeep.includes('Failure Modes & Verification Checklist'));
    assert.ok(offlineDeep.includes('Earlier question about locking'));
    assert.ok(offlineDeep.includes('db-playbook.pdf'));
  });

  it('executes Chat end-to-end through AgentGraphExecutor with memory, depth, 3 follow-ups, and routing attribution on delegated specialists', async () => {
    const config = createTestAgentConfig();
    const capturedCalls: Array<{
      readonly prompt: string;
      readonly systemInstruction?: string;
      readonly historyCount: number;
      readonly depth?: string;
      readonly chatMode?: string;
    }> = [];

    const spyChatProvider: ChatModelProvider = {
      providerName: 'spy-chat-provider',
      async generateReply(input) {
        capturedCalls.push({
          prompt: input.prompt,
          systemInstruction: input.systemInstruction,
          historyCount: input.conversationHistory?.length ?? 0,
          depth: input.responseDepth,
          chatMode: input.chatMode,
        });
        return {
          content: [
            '### Direct Technical Synthesis',
            'Optimistic locking pairs a monotonically increasing `version` column with a conditional `UPDATE ... WHERE version = $1`.',
            '',
            'FOLLOW_UP_QUESTIONS:',
            '- How should retries handle optimistic lock conflicts?',
            '- Compare optimistic locking vs SELECT FOR UPDATE latency',
            '- Show a PostgreSQL + Drizzle version check query',
          ].join('\n'),
          tokensUsed: 96,
        };
      },
    };

    const executor = new AgentGraphExecutor({
      config,
      budgetGuard: new DailyLiveBudgetGuard({
        store: new InMemoryDailyBudgetStore(),
        dailyLimit: 50,
        mockAiDefault: true,
      }),
      chatProvider: spyChatProvider,
      codingProvider: new MockCodingModelProvider(),
      searchProvider: new MockSearchProvider(),
      embeddingProvider: new MockEmbeddingProvider(),
      imageProvider: new MockImageGenerationProvider(),
      visionProvider: new MockVisionProvider(),
      vectorStore: new InMemoryVectorStore(),
      objectStorage: new InMemoryObjectStorage(),
      metadataStore: new InMemoryAgentRepository(),
    });

    const chatResult = await executor.execute({
      requestId: 'req_fix21_chat_1',
      traceId: 'trc_fix21_chat_1',
      userId: 'usr_fix21',
      conversationId: 'conv_fix21',
      messageId: 'msg_fix21_1',
      prompt: 'Explain PostgreSQL MVCC vs optimistic locking in TypeScript services',
      responseDepth: 'deep',
      conversationHistory: [
        { role: 'user', content: 'We are scaling our billing ledger' },
        { role: 'assistant', content: 'Row-level locks or optimistic version columns help prevent lost updates.' },
      ],
      threadContext: {
        artifacts: [{ title: 'Billing Architecture Spec', artifactType: 'pdf_document' }],
      },
    });

    assert.equal(chatResult.agent, 'chat');
    assert.equal(chatResult.routedFromChat, false);
    assert.equal(chatResult.chatMode, 'technical_architecture');
    assert.equal(chatResult.responseDepth, 'deep');
    assert.equal(chatResult.followUpQueries?.length, 3);
    assert.ok(!chatResult.replyContent.includes('FOLLOW_UP_QUESTIONS'));
    assert.equal(capturedCalls.length, 1);
    assert.equal(capturedCalls[0]?.historyCount, 2);
    assert.equal(capturedCalls[0]?.depth, 'deep');
    assert.equal(capturedCalls[0]?.chatMode, 'technical_architecture');
    assert.ok(capturedCalls[0]?.systemInstruction?.includes('Billing Architecture Spec'));

    // Smart hybrid delegation from unified Chat (no preferredAgent) attaches subtle routing attribution
    const delegatedSearch = await executor.execute({
      requestId: 'req_fix21_search_1',
      traceId: 'trc_fix21_search_1',
      userId: 'usr_fix21',
      conversationId: 'conv_fix21',
      messageId: 'msg_fix21_2',
      prompt: 'Search the web for latest PostgreSQL 18 benchmarks and cite sources',
    });

    assert.equal(delegatedSearch.agent, 'search');
    assert.equal(delegatedSearch.routedFromChat, true);
    assert.equal(delegatedSearch.routingReason, 'Live web lookup');
  });
});
