/**
 * @file backend/services/agent/src/agents/chat/index.ts
 * @description Fix #21 — Flagship Unified Chat Intelligence Engine.
 * Provides:
 *  - 5-mode adaptive reasoning classification (`direct_concise`, `technical_architecture`,
 *    `writing_editorial`, `strategy_brainstorm`, `step_by_step_mentor`)
 *  - Calibrated Response Depth normalization (`concise`, `balanced`, `deep`)
 *  - Bounded sliding-window multi-turn conversation history sanitizer + thread artifact/file context builder
 *  - Gemini multi-turn `contents` assembler (`user` / `model` role alternation)
 *  - `FOLLOW_UP_QUESTIONS:` parser + word-boundary-safe 3-chip contextual follow-up generator
 *  - Topic-, depth-, and memory-aware offline preview synthesizer when `GEMINI_API_KEY` is unset
 */

import type {
  ChatResponseDepth,
  ConversationHistoryTurn,
  ConversationThreadContext,
} from '@kartik/shared/contracts';

export const CHAT_REASONING_MODES = [
  'direct_concise',
  'technical_architecture',
  'writing_editorial',
  'strategy_brainstorm',
  'step_by_step_mentor',
] as const;

export type ChatReasoningMode = (typeof CHAT_REASONING_MODES)[number];

export const CHAT_RESPONSE_DEPTHS: readonly ChatResponseDepth[] = Object.freeze([
  'concise',
  'balanced',
  'deep',
]);

const CHAT_MODE_LABELS: Readonly<Record<ChatReasoningMode, string>> = Object.freeze({
  direct_concise: 'Direct Answer',
  technical_architecture: 'Technical & Architecture',
  writing_editorial: 'Writing & Editorial',
  strategy_brainstorm: 'Strategy & Trade-Offs',
  step_by_step_mentor: 'Guided Mentor',
});

export function getChatModeDisplayLabel(mode: ChatReasoningMode): string {
  return CHAT_MODE_LABELS[mode];
}

export function normalizeChatResponseDepth(raw: unknown): ChatResponseDepth {
  if (raw === 'concise' || raw === 'balanced' || raw === 'deep') {
    return raw;
  }
  return 'balanced';
}

/**
 * Classifies a conversational prompt into 1 of 5 adaptive reasoning & formatting modes.
 */
export function classifyChatMode(prompt: string): ChatReasoningMode {
  const cleaned = prompt.trim();
  const lower = cleaned.toLowerCase();

  // 1. Writing & Editorial Studio (drafting, rewriting, emails, PRDs, summaries, tone edits)
  if (
    /\b((?:write|draft|compose)\s+(?:an?|the)\s+(?:\w+\s+){0,2}(?:email|memo|essay|blog|post|letter|prd|spec|announcement|proposal|summary|cover letter|bio|readme|message|update|newsletter|release notes)|rewrite|proofread|paraphrase|polish this|make this sound|change the tone|summarize this text)\b/i.test(
      lower,
    )
  ) {
    return 'writing_editorial';
  }

  // 2. Step-by-Step Mentor / Teaching (tutorials, analogies, ELI5, walkthroughs)
  if (
    /\b(teach me|explain like|eli5|for beginners|step[- ]by[- ]step|walk me through|help me understand|how does .+ work|beginner(?:'s)? guide|intuition behind|mental model)\b/i.test(
      lower,
    )
  ) {
    return 'step_by_step_mentor';
  }

  // 3. Technical & Systems Architecture (engineering concepts, databases, distributed systems, APIs, languages)
  if (
    /\b(architecture|microservices|distributed|kubernetes|docker|postgres|postgresql|sql|nosql|redis|kafka|grpc|graphql|rest api|oauth|jwt|ed25519|zero[- ]trust|latency|throughput|concurrency|mvcc|optimistic locking|consensus|raft|typescript|javascript|python|rust|golang|react|next\.js|node\.js|algorithm|complexity|big[- ]o|system design|schema|indexing|caching|security|encryption)\b/i.test(
      lower,
    )
  ) {
    return 'technical_architecture';
  }

  // 4. Strategy, Brainstorming & Decision Analysis (trade-offs, pros/cons, roadmaps, comparisons)
  if (
    /\b(pros and cons|trade-?offs?|compare|versus|\bvs\.?\b|brainstorm|ideas for|roadmap|strategy|should i choose|which is better|decision matrix|go-to-market|prioritize|evaluate options)\b/i.test(
      lower,
    )
  ) {
    return 'strategy_brainstorm';
  }

  // 5. Direct & Concise for short factual questions, definitions, or quick follow-ups
  if (cleaned.length <= 85) {
    return 'direct_concise';
  }

  return 'strategy_brainstorm';
}

/**
 * Bounds and sanitizes conversation history to a clean sliding window (`<= maxTurns`)
 * with per-turn character limits so multi-turn Gemini calls remain fast and predictable.
 */
export function sanitizeConversationHistory(
  history: readonly ConversationHistoryTurn[] | undefined,
  maxTurns = 12,
  maxCharsPerTurn = 1_400,
): readonly ConversationHistoryTurn[] {
  if (!history || history.length === 0) {
    return Object.freeze([]);
  }

  const cleaned: ConversationHistoryTurn[] = [];
  for (const turn of history) {
    if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) {
      continue;
    }
    const text = (turn.content ?? '').trim();
    if (!text) {
      continue;
    }
    const truncated =
      text.length > maxCharsPerTurn
        ? `${text.slice(0, maxCharsPerTurn - 1).trimEnd()}…`
        : text;
    cleaned.push({
      role: turn.role,
      content: truncated,
      ...(turn.agentUsed ? { agentUsed: turn.agentUsed } : {}),
    });
  }

  return Object.freeze(cleaned.slice(-Math.max(1, maxTurns)));
}

/**
 * Formats uploaded files and generated artifacts from the active conversation into
 * a compact, prompt-injection-safe context summary for multi-turn thread awareness.
 */
export function formatThreadContextBlock(
  threadContext: ConversationThreadContext | undefined,
): string {
  if (!threadContext) {
    return '';
  }

  const files = (threadContext.files ?? []).slice(-6);
  const artifacts = (threadContext.artifacts ?? []).slice(-6);
  if (files.length === 0 && artifacts.length === 0) {
    return '';
  }

  const lines: string[] = [
    'ACTIVE THREAD WORKSPACE CONTEXT (read-only metadata for reference):',
  ];
  if (files.length > 0) {
    lines.push(
      `- Uploaded files in this thread: ${files
        .map((f) => {
          const pages = f.pageCount ? `, ${f.pageCount} pages` : '';
          return `"${f.filename.slice(0, 80)}" (${f.mimeType}${pages})`;
        })
        .join('; ')}.`,
    );
  }
  if (artifacts.length > 0) {
    lines.push(
      `- Generated artifacts in this thread: ${artifacts
        .map((a) => `"${a.title.slice(0, 80)}" [${a.artifactType}]`)
        .join('; ')}.`,
    );
  }
  return lines.join('\n');
}

/**
 * Builds a tailored, depth-calibrated system instruction for Gemini Chat turns.
 */
export function buildChatSystemInstruction(input: {
  readonly mode: ChatReasoningMode;
  readonly responseDepth: ChatResponseDepth;
  readonly threadContext?: ConversationThreadContext;
}): string {
  const modeGuidance: Record<ChatReasoningMode, string> = {
    direct_concise:
      'MODE: Direct Answer. Lead immediately with the exact answer in the first sentence. Avoid unnecessary preamble, filler, or repetition.',
    technical_architecture:
      'MODE: Technical & Architecture Specialist. Provide rigorous engineering clarity: lead with the direct answer, include crisp comparison tables or idiomatic fenced code examples with explicit language tags when illuminating, and call out real production edge cases and failure modes.',
    writing_editorial:
      'MODE: Writing & Editorial Studio. Deliver publication-ready prose directly matching the user’s requested audience and tone. Keep formatting crisp and ready to copy-paste without meta-chatter.',
    strategy_brainstorm:
      'MODE: Strategy & Trade-Off Analyst. Structure options cleanly with explicit criteria, Markdown comparison tables or pros/cons where useful, and conclude with a concrete recommendation.',
    step_by_step_mentor:
      'MODE: Guided Step-by-Step Mentor. Build understanding progressively from intuition and a clear mental model to a worked example and practical next step.',
  };

  const depthGuidance: Record<ChatResponseDepth, string> = {
    concise:
      'DEPTH: Concise. Keep the response tight and high-signal (short paragraphs or 3–5 compact bullets, target ~120–220 words unless code/tables require slightly more).',
    balanced:
      'DEPTH: Balanced. Give a thorough, well-structured answer with scannable headings, concrete examples, and crisp takeaways (target ~250–500 words).',
    deep:
      'DEPTH: Deep Dive. Provide an exhaustive, senior-level analysis covering underlying mechanisms, trade-off matrices, concrete examples/code, failure modes, and actionable checklists.',
  };

  const threadBlock = formatThreadContextBlock(input.threadContext);

  return [
    'You are Kartik.ai Chat, the flagship multi-turn reasoning partner inside the Kartik.ai Multi-Agent Workspace.',
    modeGuidance[input.mode],
    depthGuidance[input.responseDepth],
    'Use clean GitHub-Flavored Markdown (headings, tables, lists, and fenced code blocks with language identifiers when helpful). Use prior conversation turns faithfully when the user references earlier points, pronouns, or artifacts.',
    threadBlock,
    'At the very end of your response, append a section titled exactly `FOLLOW_UP_QUESTIONS:` containing 3 concise, high-value next questions as `- ` bullet lines tailored specifically to this conversation.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface GeminiConversationContent {
  readonly role: 'user' | 'model';
  readonly parts: ReadonlyArray<{ readonly text: string }>;
}

/**
 * Builds a well-formed Gemini multi-turn `contents` array (`user` / `model` alternation)
 * from sanitized conversation history plus the current user prompt.
 */
export function buildMultiTurnGeminiContents(
  currentPrompt: string,
  history: readonly ConversationHistoryTurn[] | undefined,
): readonly GeminiConversationContent[] {
  const sanitized = sanitizeConversationHistory(history);
  const turns: Array<{ role: 'user' | 'model'; text: string }> = [];

  for (const item of sanitized) {
    const mappedRole: 'user' | 'model' = item.role === 'assistant' ? 'model' : 'user';
    const prev = turns[turns.length - 1];
    if (prev && prev.role === mappedRole) {
      prev.text = `${prev.text}\n\n${item.content}`;
    } else {
      turns.push({ role: mappedRole, text: item.content });
    }
  }

  // Gemini multi-turn conversations should begin with a user turn when history starts with an assistant greeting
  while (turns.length > 0 && turns[0]?.role === 'model') {
    turns.shift();
  }

  const trimmedCurrent = currentPrompt.trim();
  const last = turns[turns.length - 1];
  if (last && last.role === 'user') {
    last.text = `${last.text}\n\n${trimmedCurrent}`;
  } else {
    turns.push({ role: 'user', text: trimmedCurrent });
  }

  return Object.freeze(
    turns.map((t) =>
      Object.freeze({
        role: t.role,
        parts: Object.freeze([Object.freeze({ text: t.text })]),
      }),
    ),
  );
}

function extractCleanChatTopic(prompt: string): string {
  const stripped = prompt
    .trim()
    .replace(/\s+/g, ' ')
    .replace(
      /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:explain|describe|compare|summarize|help me understand|walk me through|teach me|write|draft|brainstorm|list|give me|tell me|what is|what are|how does|how do|why does|why is)\s+(?:about\s+|the\s+|an?\s+)?/i,
      '',
    )
    .replace(/[?!.]+$/, '')
    .trim();

  if (stripped.length <= 44) {
    return stripped || 'this topic';
  }
  const slice = stripped.slice(0, 44);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = (lastSpace > 16 ? slice.slice(0, lastSpace) : slice).trim();
  return trimmed.replace(/[\s,.;:!?-]+$/, '') || 'this topic';
}

/**
 * Builds 3 contextual, word-boundary-safe follow-up questions tailored to the Chat mode & topic.
 */
export function buildChatFollowUps(
  prompt: string,
  mode: ChatReasoningMode,
): readonly string[] {
  const topic = extractCleanChatTopic(prompt);

  if (mode === 'technical_architecture') {
    return Object.freeze([
      `Show a concrete production code example for ${topic}`,
      `What are the failure modes and bottlenecks of ${topic}?`,
      `Compare the top architectural alternatives to ${topic}`,
    ]);
  }

  if (mode === 'writing_editorial') {
    return Object.freeze([
      `Make this version shorter and more executive-ready`,
      `Rewrite this with a warmer, more conversational tone`,
      `Turn the key points into a 5-bullet summary checklist`,
    ]);
  }

  if (mode === 'step_by_step_mentor') {
    return Object.freeze([
      `Walk through a concrete real-world example of ${topic}`,
      `What common mistakes do beginners make with ${topic}?`,
      `Quiz me with 3 practical questions on ${topic}`,
    ]);
  }

  if (mode === 'strategy_brainstorm') {
    return Object.freeze([
      `Rank these options by effort vs. impact in a table`,
      `Outline a 30-day execution plan for the top option`,
      `What hidden risks could derail ${topic}?`,
    ]);
  }

  return Object.freeze([
    `Go deeper on ${topic} with a concrete example`,
    `Compare the key trade-offs involved in ${topic}`,
    `Turn this into an actionable step-by-step checklist`,
  ]);
}

/**
 * Extracts trailing `FOLLOW_UP_QUESTIONS:` bullets cleanly from a model Chat reply
 * and fills in deterministic mode-aware follow-ups if fewer than 3 are present.
 */
export function parseChatReplyAndFollowUps(
  rawText: string,
  prompt: string,
  mode: ChatReasoningMode,
): {
  readonly answer: string;
  readonly followUpQueries: readonly string[];
} {
  const trimmed = rawText.trim();
  const markerMatch = /(?:^|\n)\s*(?:#{1,4}\s*)?(?:\*\*)?FOLLOW_UP_QUESTIONS:?(?:\*\*)?\s*\n([\s\S]*)$/i.exec(
    trimmed,
  );

  if (!markerMatch || markerMatch.index === undefined) {
    return {
      answer: trimmed,
      followUpQueries: buildChatFollowUps(prompt, mode),
    };
  }

  const answer = trimmed.slice(0, markerMatch.index).trim();
  const block = markerMatch[1] ?? '';
  const extracted = block
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^["']|["']$/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line.length >= 8 && line.length <= 160);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of [...extracted, ...buildChatFollowUps(prompt, mode)]) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
    if (unique.length >= 3) {
      break;
    }
  }

  return {
    answer: answer || trimmed,
    followUpQueries: Object.freeze(unique),
  };
}

/**
 * Generates a topic-, depth-, and history-aware offline Markdown reply when `GEMINI_API_KEY`
 * is unset so every Chat mode, depth setting, and multi-turn follow-up remains genuinely verifiable.
 */
export function buildOfflineChatReply(input: {
  readonly prompt: string;
  readonly mode: ChatReasoningMode;
  readonly responseDepth: ChatResponseDepth;
  readonly history?: readonly ConversationHistoryTurn[];
  readonly threadContext?: ConversationThreadContext;
}): string {
  const cleanPrompt = input.prompt.trim();
  const topic = extractCleanChatTopic(cleanPrompt);
  const sanitizedHistory = sanitizeConversationHistory(input.history);
  const priorUserTurns = sanitizedHistory.filter((t) => t.role === 'user');
  const lastPriorUser = priorUserTurns[priorUserTurns.length - 1];

  const memoryLine = lastPriorUser
    ? `> Continuing from your earlier question (*"${lastPriorUser.content.slice(0, 72)}"* — ${sanitizedHistory.length} prior turns in context).`
    : '';

  const contextFiles = input.threadContext?.files ?? [];
  const contextArtifacts = input.threadContext?.artifacts ?? [];
  const threadAwareLine =
    contextFiles.length > 0 || contextArtifacts.length > 0
      ? `**Thread Context Active:** ${[
          ...contextFiles.map((f) => `\`${f.filename}\``),
          ...contextArtifacts.map((a) => `*${a.title}* (${a.artifactType})`),
        ]
          .slice(0, 4)
          .join(' · ')}`
      : '';

  const introLines = [memoryLine, threadAwareLine].filter(Boolean);

  if (input.responseDepth === 'concise') {
    return [
      `### ${topic.charAt(0).toUpperCase()}${topic.slice(1)}`,
      ...introLines,
      '',
      `Here is the concise takeaway on **${topic}**:`,
      '',
      `- **Core Principle:** Focus on clear boundaries, predictable state transitions, and measurable outcomes for ${topic}.`,
      `- **Key Trade-Off:** Balance simplicity and speed of iteration against long-term operational rigor.`,
      `- **Immediate Next Step:** Validate assumptions with a small, scoped prototype before scaling.`,
    ].join('\n');
  }

  if (input.mode === 'technical_architecture') {
    const sections: string[] = [
      `### ${topic.charAt(0).toUpperCase()}${topic.slice(1)} — Engineering Breakdown`,
      ...introLines,
      '',
      `A clean production design for **${topic}** separates decision logic, state boundaries, and verification checks so each layer evolves independently:`,
      '',
      '| Dimension | Recommended Pattern | Key Production Guardrail |',
      '| :--- | :--- | :--- |',
      '| **Core Model** | Explicit typed contracts & pure deterministic rules | Validate inputs at system boundaries before side effects |',
      '| **Latency & Scale** | Bounded sliding windows & idempotent execution keys | Avoid unbounded fan-out; enforce per-operation budgets |',
      '| **Observability** | Structured trace IDs & clear failure categorization | Fail closed on auth/ownership checks; degrade cleanly on upstream outages |',
      '',
      '```typescript',
      `// Reference pattern for ${topic}`,
      'export interface DecisionInput {',
      '  readonly requestId: string;',
      '  readonly topic: string;',
      '  readonly depth: "concise" | "balanced" | "deep";',
      '}',
      '',
      'export function evaluateStrategy(input: DecisionInput): string {',
      '  if (!input.requestId.trim()) throw new Error("requestId is required");',
      '  return `${input.topic} [${input.depth}]`;',
      '}',
      '```',
    ];

    if (input.responseDepth === 'deep') {
      sections.push(
        '',
        '#### Failure Modes & Verification Checklist',
        '1. **Contract Drift:** Keep gateway pre-validation and downstream execution derived from a single shared classifier.',
        '2. **Context Bloat:** Bound multi-turn memory windows and summarize artifact metadata rather than replaying raw payloads.',
        '3. **Retry Safety:** Pair every mutating or paid operation with a client-owned `Idempotency-Key` and payload fingerprint.',
      );
    }
    return sections.join('\n');
  }

  if (input.mode === 'writing_editorial') {
    return [
      `### Editorial Draft — ${topic.charAt(0).toUpperCase()}${topic.slice(1)}`,
      ...introLines,
      '',
      `**Subject:** Clear Update & Next Steps on ${topic}`,
      '',
      `We have aligned on the core direction for **${topic}** and prioritized the highest-leverage improvements first. Our focus is delivering clear, measurable quality with minimal friction for readers and stakeholders.`,
      '',
      '- **What Changed:** Streamlined the primary workflow and clarified key decision points.',
      '- **Why It Matters:** Reduces back-and-forth while improving consistency and speed.',
      '- **Next Step:** Review the draft above and adjust tone, length, or target audience as needed.',
    ].join('\n');
  }

  if (input.mode === 'step_by_step_mentor') {
    return [
      `### Step-by-Step Guide: ${topic.charAt(0).toUpperCase()}${topic.slice(1)}`,
      ...introLines,
      '',
      `1. **Mental Model:** Think of **${topic}** as a clear pipeline with an explicit input, a well-defined transformation, and a verifiable output.`,
      `2. **Core Mechanism:** Break the problem into small composable steps so you can reason about each rule independently.`,
      `3. **Worked Example:** Start with the simplest baseline case, verify the expected result, and then introduce edge cases one by one.`,
      ...(input.responseDepth === 'deep'
        ? [
            `4. **Common Pitfalls:** Watch for hidden state coupling, silent fallbacks, and untested boundary conditions.`,
            `5. **Practice Checkpoint:** Try explaining ${topic} in two sentences without jargon, then test your understanding on a realistic scenario.`,
          ]
        : []),
    ].join('\n');
  }

  return [
    `### ${topic.charAt(0).toUpperCase()}${topic.slice(1)} — Strategy & Options`,
    ...introLines,
    '',
    '| Option | Primary Strength | Key Trade-Off | Best Fit |',
    '| :--- | :--- | :--- | :--- |',
    '| **Option A: Lean Baseline** | Fast to ship, minimal surface area | Requires follow-up iteration for edge cases | Early validation & quick wins |',
    '| **Option B: Modular Architecture** | Clean separation, easy to test & extend | Slightly higher upfront design effort | Production multi-user workflows |',
    '| **Option C: Full Automation** | Maximum leverage & throughput | Needs strict guardrails and observability | High-volume repeatable operations |',
    '',
    '#### Recommendation',
    `Start with **Option B (Modular Architecture)** for **${topic}**: it captures immediate value while keeping clean seams for future specialists or deeper automation.`,
    ...(input.responseDepth === 'deep'
      ? [
          '',
          '#### Implementation Sequence',
          '- **Phase 1:** Define strict contracts and unit-test pure decision logic.',
          '- **Phase 2:** Wire end-to-end persistence, error states, and user feedback controls.',
          '- **Phase 3:** Verify real user journeys and tighten edge-case polish.',
        ]
      : []),
  ].join('\n');
}
