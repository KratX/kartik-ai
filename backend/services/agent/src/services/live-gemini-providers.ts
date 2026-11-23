/**
 * @kartik/agent/services/live-gemini-providers — Pure Google Gemini Server-Side AI Adapters
 * (Blueprint §2.4, §10, ADR 0005 & Gemini API Guidelines).
 *
 * Implements Gemini-only server-side AI adapters for all 8 specialist agents:
 * - Chat, Search Synthesis, Coding, PDF, PPT & Vision: `gemini-3.1-flash-lite`
 *   (cheapest, highest-throughput Gemini model with optional `GEMINI_MODEL` override)
 * - Web Search: Gemini `googleSearch` grounding (`tools: [{ googleSearch: {} }]`) with live public web fallback
 * - RAG Embeddings: `gemini-embedding-2` (with `gemini-embedding-001` / `text-embedding-004` fallback)
 * - Image Generation: `gemini-3.1-flash-lite-image` (with optional `GEMINI_IMAGE_MODEL` override)
 * - Always sends `'User-Agent': 'aistudio-build'` and respects `PROVIDER_TIMEOUT_MS` (default 45s).
 */

import crypto from 'node:crypto';
import type {
  ChatResponseDepth,
  ConversationHistoryTurn,
  ConversationThreadContext,
} from '@kartik/shared/contracts';
import type {
  ChatModelProvider,
  CodingModelProvider,
  EmbeddingProvider,
  ImageGenerationProvider,
  SearchExecutionBundle,
  SearchImageGalleryItem,
  SearchProvider,
  SearchResultItem,
  VisionProvider,
} from '../models/index.js';
import {
  buildMultiTurnGeminiContents,
  buildOfflineChatReply,
  classifyChatMode,
  normalizeChatResponseDepth,
  type ChatReasoningMode,
} from '../agents/chat/index.js';
import {
  buildDeterministicFollowUps,
  cleanPublicSearchQuery,
  collectRealSearchImages,
  extractCleanDomain,
  fetchMultiSourceLiveWebResults,
  fetchWikipediaExtractResults,
  injectGroundingSupportCitations,
  isSafePublicHttpUrl,
  normalizeInlineCitations,
  parseAnswerAndFollowUps,
  readPublicPageSnippet,
  type GeminiGroundingSupport,
} from './web-search-engine.js';
import {
  buildPdfBinaryBuffer,
  buildPdfSystemInstruction,
  classifyPdfDocumentType,
  formatPdfSummaryMarkdown,
  MockPdfDocumentProvider,
  type PdfDocumentGenerationResult,
  type PdfDocumentProvider,
} from '../agents/pdf/index.js';
import {
  buildPptSystemInstruction,
  buildPptxBinaryBuffer,
  classifyPptDeckTheme,
  classifyPptSurfaceMode,
  extractRequestedSlideCount,
  formatPptSummaryMarkdown,
  MockPptPresentationProvider,
  type PptPresentationGenerationResult,
  type PptPresentationProvider,
} from '../agents/ppt/index.js';
import {
  buildRichCodingTemplateBundle,
  sanitizeGeneratedCodeBundle,
} from '../agents/coding/index.js';
import {
  buildVisionSystemInstruction,
  buildVisionUserPrompt,
  classifyVisionIntent,
  formatOfflineVisionFallback,
  parseImageDimensions,
} from '../agents/vision/index.js';
import {
  buildEnhancedImagePrompt,
  buildOfflineStudioPreviewPng,
  classifyImageStyle,
  detectImageAspectRatio,
  formatImageCaption,
  type ImageAspectRatio,
  type ImageStyleArchetype,
} from '../agents/image/index.js';
import { computeDeterministicEmbedding } from './mock-providers.js';
import {
  stripMarkdownJsonFences,
  validatePdfDocumentSpec,
  validatePptPresentationSpec,
} from '../schemas/index.js';

export type { SearchImageGalleryItem };

const SchemaValueType = {
  OBJECT: 'OBJECT',
  STRING: 'STRING',
  ARRAY: 'ARRAY',
  NUMBER: 'NUMBER',
} as const;

interface GeminiGroundingChunk {
  readonly web?: {
    readonly uri?: string;
    readonly title?: string;
  };
}

interface GeminiInlineDataPart {
  readonly mimeType?: string;
  readonly data?: string;
}

interface GeminiResponsePart {
  readonly text?: string;
  readonly thought?: boolean;
  readonly inlineData?: GeminiInlineDataPart;
}

interface GeminiGenerateContentResult {
  readonly text?: string;
  readonly parts?: readonly GeminiResponsePart[];
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: readonly GeminiResponsePart[];
    };
    readonly groundingMetadata?: {
      readonly groundingChunks?: ReadonlyArray<GeminiGroundingChunk>;
      readonly groundingSupports?: ReadonlyArray<GeminiGroundingSupport>;
      readonly webSearchQueries?: readonly string[];
    };
  }>;
}

interface GeminiEmbeddingItem {
  readonly values?: readonly number[];
}

interface GeminiEmbedContentResult {
  readonly embeddings?: ReadonlyArray<GeminiEmbeddingItem>;
}

interface GeminiClientAdapter {
  generateContent(params: {
    readonly model: string;
    readonly fallbackModels?: readonly string[];
    readonly contents: unknown;
    readonly config?: Record<string, unknown>;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<GeminiGenerateContentResult>;
  generateContentStream?(params: {
    readonly model: string;
    readonly fallbackModels?: readonly string[];
    readonly contents: unknown;
    readonly config?: Record<string, unknown>;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly onTextDelta: (delta: string) => void;
  }): Promise<GeminiGenerateContentResult>;
  embedContent(params: {
    readonly model: string;
    readonly contents: readonly string[];
    readonly timeoutMs?: number;
  }): Promise<GeminiEmbedContentResult>;
  predictImagen?(params: {
    readonly model: string;
    readonly prompt: string;
    readonly timeoutMs?: number;
  }): Promise<{ readonly mimeType: 'image/png' | 'image/jpeg'; readonly data: Uint8Array } | null>;
}

const DEFAULT_TEXT_MODEL = 'gemini-3.1-flash-lite';
const TEXT_MODEL_FALLBACKS: readonly string[] = [];
const DEFAULT_IMAGE_MODELS = ['gemini-3.1-flash-lite-image'] as const;

const unavailableModelsUntilMs = new Map<string, number>();
const MODEL_404_COOLDOWN_MS = 5 * 60_000;
let groundingRateLimitedUntilMs = 0;
const GROUNDING_429_COOLDOWN_MS = 2 * 60_000;

function isRunningInTestRunner(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.execArgv.includes('--test')
  );
}

function extractConciseGeminiError(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { status?: string; message?: string };
    };
    const status = parsed.error?.status ? `${parsed.error.status}: ` : '';
    const msg = (parsed.error?.message ?? '').replace(/\s+/g, ' ').trim();
    if (status || msg) {
      return `${status}${msg}`.slice(0, 140);
    }
  } catch {
    // Non-JSON error body
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, 140);
}

function stripEnvQuotes(val: string | undefined): string {
  if (!val) {
    return '';
  }
  return val.trim().replace(/^["']|["']$/g, '');
}

function isUsableSecretKey(raw: string | undefined): boolean {
  const key = stripEnvQuotes(raw);
  if (!key || key.length < 8) {
    return false;
  }
  const lower = key.toLowerCase();
  return (
    !lower.includes('placeholder') &&
    !lower.startsWith('test-') &&
    !lower.startsWith('your_') &&
    !lower.startsWith('paste_your_') &&
    !lower.includes('replace_me') &&
    !lower.includes('0123456789abcdef')
  );
}

function resolveProviderTimeoutMs(defaultMs = 45_000): number {
  const parsed = Number(process.env.PROVIDER_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 5_000 && parsed <= 180_000) {
    return parsed;
  }
  return defaultMs;
}

function extractJsonObjectString(rawText: string): string {
  const unfenced = stripMarkdownJsonFences(rawText);
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return unfenced.slice(firstBrace, lastBrace + 1);
  }
  return unfenced;
}

function uniqueNonEmpty(items: ReadonlyArray<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const cleaned = stripEnvQuotes(item);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

async function createServerGeminiClient(
  explicitApiKey?: string,
): Promise<GeminiClientAdapter | null> {
  const key = stripEnvQuotes(
    explicitApiKey ??
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_AI_API_KEY ??
      '',
  );
  if (!isUsableSecretKey(key)) {
    return null;
  }

  const defaultTimeout = resolveProviderTimeoutMs(45_000);

  return {
    async generateContent(params): Promise<GeminiGenerateContentResult> {
      const configuredModel = stripEnvQuotes(process.env.GEMINI_MODEL);
      const candidates = uniqueNonEmpty([
        configuredModel && params.model === DEFAULT_TEXT_MODEL ? configuredModel : undefined,
        params.model,
        ...(params.fallbackModels ??
          (params.model === DEFAULT_TEXT_MODEL ? TEXT_MODEL_FALLBACKS : [])),
      ]);

      const bodyPayload: Record<string, unknown> = {
        contents:
          typeof params.contents === 'string'
            ? [{ role: 'user', parts: [{ text: params.contents }] }]
            : params.contents,
      };
      if (params.config) {
        if (params.config.systemInstruction) {
          bodyPayload.systemInstruction = {
            parts: [{ text: String(params.config.systemInstruction) }],
          };
        }
        if (params.config.tools) {
          bodyPayload.tools = params.config.tools;
        }
        const genConfig: Record<string, unknown> = {};
        if (params.config.responseMimeType) {
          genConfig.responseMimeType = params.config.responseMimeType;
        }
        if (params.config.responseSchema) {
          genConfig.responseSchema = params.config.responseSchema;
        }
        if (params.config.responseModalities) {
          genConfig.responseModalities = params.config.responseModalities;
        }
        if (params.config.imageConfig) {
          genConfig.imageConfig = params.config.imageConfig;
        }
        if (
          typeof params.config.maxOutputTokens === 'number' &&
          Number.isFinite(params.config.maxOutputTokens) &&
          params.config.maxOutputTokens > 0
        ) {
          genConfig.maxOutputTokens = Math.min(65_536, Math.round(params.config.maxOutputTokens));
        }
        if (Object.keys(genConfig).length > 0) {
          bodyPayload.generationConfig = genConfig;
        }
      }

      let lastErr: Error | null = null;
      const inTest = isRunningInTestRunner();
      for (const targetModel of candidates) {
        const skipUntil = unavailableModelsUntilMs.get(targetModel) ?? 0;
        if (!inTest && Date.now() < skipUntil) {
          continue;
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent`;
        const timeoutSignal = AbortSignal.timeout(params.timeoutMs ?? defaultTimeout);
        const combinedSignal = params.signal
          ? AbortSignal.any([params.signal, timeoutSignal])
          : timeoutSignal;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
            'User-Agent': 'aistudio-build',
          },
          body: JSON.stringify(bodyPayload),
          signal: combinedSignal,
        });
        if (!res.ok) {
          let errSnippet = '';
          try {
            errSnippet = extractConciseGeminiError(await res.text());
          } catch {
            // ignore
          }
          lastErr = new Error(`Gemini HTTP ${res.status} (${targetModel}): ${errSnippet}`);
          if (res.status === 404 && !inTest) {
            unavailableModelsUntilMs.set(targetModel, Date.now() + MODEL_404_COOLDOWN_MS);
          }
          if (!inTest) {
            const detail = errSnippet ? ` (${errSnippet})` : '';
            console.warn(`[kartik-gemini] ${targetModel} HTTP ${res.status}${detail} — trying next candidate`);
          }
          // Retry next model candidate on 400/403/404 (tier/feature mismatch) or 429/5xx
          if (
            res.status === 400 ||
            res.status === 403 ||
            res.status === 404 ||
            res.status === 429 ||
            res.status >= 500
          ) {
            continue;
          }
          throw lastErr;
        }
        const data = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: GeminiResponsePart[] };
            groundingMetadata?: {
              groundingChunks?: GeminiGroundingChunk[];
              groundingSupports?: GeminiGroundingSupport[];
              webSearchQueries?: string[];
            };
          }>;
        };
        const firstCandidate = data.candidates?.[0];
        const parts = firstCandidate?.content?.parts ?? [];
        const nonThoughtParts = parts.filter((p) => !p.thought);
        const effectiveParts = nonThoughtParts.length > 0 ? nonThoughtParts : parts;
        const text = effectiveParts.map((p) => p.text ?? '').join('');
        return {
          text,
          parts,
          candidates: data.candidates,
        };
      }

      throw lastErr ?? new Error('Gemini generateContent failed across all model candidates');
    },

    async generateContentStream(params): Promise<GeminiGenerateContentResult> {
      const configuredModel = stripEnvQuotes(process.env.GEMINI_MODEL);
      const candidates = uniqueNonEmpty([
        configuredModel && params.model === DEFAULT_TEXT_MODEL ? configuredModel : undefined,
        params.model,
        ...(params.fallbackModels ??
          (params.model === DEFAULT_TEXT_MODEL ? TEXT_MODEL_FALLBACKS : [])),
      ]);

      const bodyPayload: Record<string, unknown> = {
        contents:
          typeof params.contents === 'string'
            ? [{ role: 'user', parts: [{ text: params.contents }] }]
            : params.contents,
      };
      if (params.config) {
        if (params.config.systemInstruction) {
          bodyPayload.systemInstruction = {
            parts: [{ text: String(params.config.systemInstruction) }],
          };
        }
        if (params.config.tools) {
          bodyPayload.tools = params.config.tools;
        }
        const genConfig: Record<string, unknown> = {};
        if (
          typeof params.config.maxOutputTokens === 'number' &&
          Number.isFinite(params.config.maxOutputTokens) &&
          params.config.maxOutputTokens > 0
        ) {
          genConfig.maxOutputTokens = Math.min(65_536, Math.round(params.config.maxOutputTokens));
        }
        if (Object.keys(genConfig).length > 0) {
          bodyPayload.generationConfig = genConfig;
        }
      }

      let lastErr: Error | null = null;
      const inTest = isRunningInTestRunner();
      for (const targetModel of candidates) {
        const skipUntil = unavailableModelsUntilMs.get(targetModel) ?? 0;
        if (!inTest && Date.now() < skipUntil) {
          continue;
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:streamGenerateContent?alt=sse`;
        const timeoutSignal = AbortSignal.timeout(params.timeoutMs ?? defaultTimeout);
        const combinedSignal = params.signal
          ? AbortSignal.any([params.signal, timeoutSignal])
          : timeoutSignal;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
            'User-Agent': 'aistudio-build',
          },
          body: JSON.stringify(bodyPayload),
          signal: combinedSignal,
        });
        if (!res.ok || !res.body) {
          let errSnippet = '';
          try {
            errSnippet = extractConciseGeminiError(await res.text());
          } catch {
            // ignore
          }
          lastErr = new Error(`Gemini Stream HTTP ${res.status} (${targetModel}): ${errSnippet}`);
          if (res.status === 404 && !inTest) {
            unavailableModelsUntilMs.set(targetModel, Date.now() + MODEL_404_COOLDOWN_MS);
          }
          if (
            res.status === 400 ||
            res.status === 403 ||
            res.status === 404 ||
            res.status === 429 ||
            res.status >= 500
          ) {
            continue;
          }
          throw lastErr;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        const collectedParts: GeminiResponsePart[] = [];

        while (true) {
          if (params.signal?.aborted) {
            await reader.cancel().catch(() => undefined);
            throw params.signal.reason instanceof Error
              ? params.signal.reason
              : new Error('Aborted');
          }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const dataLines = frame
              .split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim());
            if (dataLines.length === 0) continue;
            const jsonStr = dataLines.join('\n');
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr) as {
                candidates?: Array<{
                  content?: { parts?: GeminiResponsePart[] };
                }>;
              };
              const parts = parsed.candidates?.[0]?.content?.parts ?? [];
              for (const part of parts) {
                if (!part.thought && typeof part.text === 'string' && part.text.length > 0) {
                  collectedParts.push(part);
                  fullText += part.text;
                  params.onTextDelta(part.text);
                }
              }
            } catch {
              // Ignore partial non-JSON keepalive frames
            }
          }
        }

        return {
          text: fullText,
          parts: collectedParts,
        };
      }

      throw lastErr ?? new Error('Gemini streamGenerateContent failed across all model candidates');
    },

    async embedContent(params): Promise<GeminiEmbedContentResult> {
      const embedCandidates = uniqueNonEmpty([
        params.model,
        'gemini-embedding-001',
        'text-embedding-004',
      ]);

      let lastErr: Error | null = null;
      for (const targetModel of embedCandidates) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:batchEmbedContents`;
        const requests = params.contents.map((t) => ({
          model: `models/${targetModel}`,
          content: { parts: [{ text: t }] },
          outputDimensionality: 768,
        }));
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
            'User-Agent': 'aistudio-build',
          },
          body: JSON.stringify({ requests }),
          signal: AbortSignal.timeout(params.timeoutMs ?? defaultTimeout),
        });
        if (!res.ok) {
          lastErr = new Error(`Gemini Embed HTTP ${res.status} (${targetModel})`);
          if (
            res.status === 400 ||
            res.status === 403 ||
            res.status === 404 ||
            res.status === 429 ||
            res.status >= 500
          ) {
            continue;
          }
          throw lastErr;
        }
        const data = (await res.json()) as {
          embeddings?: GeminiEmbeddingItem[];
        };
        return { embeddings: data.embeddings ?? [] };
      }

      throw lastErr ?? new Error('Gemini embedContent failed');
    },

    async predictImagen(params): Promise<{
      readonly mimeType: 'image/png' | 'image/jpeg';
      readonly data: Uint8Array;
    } | null> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:predict`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
          'User-Agent': 'aistudio-build',
        },
        body: JSON.stringify({
          instances: [{ prompt: params.prompt }],
          parameters: { sampleCount: 1 },
        }),
        signal: AbortSignal.timeout(params.timeoutMs ?? defaultTimeout),
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as {
        predictions?: Array<{
          bytesBase64Encoded?: string;
          mimeType?: string;
        }>;
      };
      const b64 = data.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) {
        return null;
      }
      const mime =
        data.predictions?.[0]?.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      return {
        mimeType: mime,
        data: new Uint8Array(Buffer.from(b64, 'base64')),
      };
    },
  };
}

export class LiveGeminiChatModelProvider implements ChatModelProvider {
  public readonly providerName = 'gemini-live-chat';
  private readonly apiKey?: string;

  constructor(options?: { readonly apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  public async generateReply(input: {
    readonly prompt: string;
    readonly systemInstruction?: string;
    readonly maxOutputTokens: number;
    readonly conversationHistory?: readonly ConversationHistoryTurn[];
    readonly threadContext?: ConversationThreadContext;
    readonly responseDepth?: ChatResponseDepth;
    readonly chatMode?: string;
    readonly onDelta?: (delta: string) => void;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly content: string; readonly tokensUsed: number }> {
    const sysInstruction =
      input.systemInstruction ??
      'You are Kartik.ai, a senior multi-agent engineering assistant. Provide clear, well-structured Markdown answers with tables, bullet points, and code blocks when helpful.';

    const ai = await createServerGeminiClient(this.apiKey);
    if (ai) {
      try {
        const contents =
          input.conversationHistory && input.conversationHistory.length > 0
            ? buildMultiTurnGeminiContents(input.prompt, input.conversationHistory)
            : input.prompt;
        const response =
          input.onDelta && ai.generateContentStream
            ? await ai.generateContentStream({
                model: DEFAULT_TEXT_MODEL,
                contents,
                config: {
                  systemInstruction: sysInstruction,
                  maxOutputTokens: Math.max(input.maxOutputTokens || 8_192, 256),
                },
                signal: input.signal,
                onTextDelta: input.onDelta,
              })
            : await ai.generateContent({
                model: DEFAULT_TEXT_MODEL,
                contents,
                config: {
                  systemInstruction: sysInstruction,
                  maxOutputTokens: Math.max(input.maxOutputTokens || 8_192, 256),
                },
                signal: input.signal,
              });
        const text = (response.text ?? '').trim();
        if (text.length > 0) {
          return {
            content: text,
            tokensUsed: Math.max(16, Math.ceil(text.length / 4)),
          };
        }
      } catch (err) {
        if (input.signal?.aborted) {
          throw err;
        }
        // Fall back to deterministic offline reply when Gemini is unreachable
      }
    }

    const mode = (input.chatMode as ChatReasoningMode | undefined) ?? classifyChatMode(input.prompt);
    const responseDepth = normalizeChatResponseDepth(input.responseDepth);
    const synthesized = buildOfflineChatReply({
      prompt: input.prompt,
      mode,
      responseDepth,
      history: input.conversationHistory,
      threadContext: input.threadContext,
    });
    if (input.onDelta) {
      input.onDelta(synthesized);
    }

    return {
      content: synthesized,
      tokensUsed: Math.ceil(synthesized.length / 4),
    };
  }
}

export class LiveGeminiCodingModelProvider implements CodingModelProvider {
  public readonly providerName = 'gemini-live-coding';
  private readonly apiKey?: string;

  constructor(options?: { readonly apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  private buildValidatedBundleFromJson(rawText: string): {
    readonly summary: string;
    readonly rawManifestJson: string;
    readonly tokensUsed: number;
  } | null {
    try {
      const parsed = JSON.parse(extractJsonObjectString(rawText)) as {
        title?: string;
        summary?: string;
        html?: string;
        css?: string;
        js?: string;
      };

      const sanitized = sanitizeGeneratedCodeBundle({
        title: typeof parsed.title === 'string' ? parsed.title : '',
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        html: typeof parsed.html === 'string' ? parsed.html : '',
        css: typeof parsed.css === 'string' ? parsed.css : '',
        js: typeof parsed.js === 'string' ? parsed.js : '',
      });

      if (sanitized) {
        return {
          summary: sanitized.summary,
          rawManifestJson: sanitized.rawManifestJson,
          tokensUsed: Math.max(120, Math.ceil(sanitized.rawManifestJson.length / 4)),
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  public async generateCodeBundle(input: {
    readonly prompt: string;
    readonly maxOutputTokens: number;
    readonly existingArtifactContext?: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly summary: string;
    readonly rawManifestJson: string;
    readonly tokensUsed: number;
  }> {
    const codingSystemInstruction = [
      'You are Kartik.ai Senior Frontend & UI Systems Engineer.',
      'Build complete, production-quality, interactive vanilla HTML5 + CSS3 + ES2022 JavaScript web apps that run inside a strict zero-network browser sandbox (`sandbox="allow-scripts"`, `connect-src \'none\'`).',
      'HARD CONSTRAINTS:',
      '1. Zero external CDNs, fonts, icons, images, or fetch() calls — everything must be 100% self-contained (use inline SVG icons if needed).',
      '2. Wire every visible button, filter, form, keyboard shortcut, and counter to real working state with meaningful initial seed data.',
      '3. Never use window.alert(), window.prompt(), or window.confirm(). Always guard any localStorage access with try/catch or keep state in memory.',
      '4. Use a refined dark-mode visual hierarchy (#090d16 canvas, #111827 cards, crisp 1px borders, readable contrast, responsive layout from 390px mobile to desktop, accessible semantic HTML).',
      '5. Do NOT include <link rel="stylesheet" href="styles.css"> or <script src="app.js"> — styles.css and app.js are injected automatically.',
    ].join(' ');

    const refinementBlock = input.existingArtifactContext
      ? `\n\nEXISTING ACTIVE SANDBOX APP IN THIS THREAD (if the user is requesting edits, additions, bug fixes, or styling updates to this app, refine and preserve its existing working features rather than starting from scratch):\n${input.existingArtifactContext.slice(0, 7000)}\n`
      : '';

    const codingPrompt = `Build or refine a complete, self-contained, interactive web application for: "${input.prompt}".${refinementBlock}
Return ONLY a valid JSON object with exact keys:
- title: short crisp project title (max 60 chars)
- summary: concise 2–3 sentence Markdown overview of features and interactive controls built
- html: complete semantic index.html markup (no external scripts/stylesheets)
- css: complete responsive dark-mode CSS3 styles
- js: clean, bug-free vanilla JavaScript wiring all controls, state updates, and keyboard interactions`;

    const ai = await createServerGeminiClient(this.apiKey);
    if (ai) {
      try {
        const response = await ai.generateContent({
          model: DEFAULT_TEXT_MODEL,
          contents: codingPrompt,
          signal: input.signal,
          config: {
            systemInstruction: codingSystemInstruction,
            maxOutputTokens: Math.max(input.maxOutputTokens || 8_192, 2_048),
            responseMimeType: 'application/json',
            responseSchema: {
              type: SchemaValueType.OBJECT,
              properties: {
                title: { type: SchemaValueType.STRING },
                summary: { type: SchemaValueType.STRING },
                html: { type: SchemaValueType.STRING },
                css: { type: SchemaValueType.STRING },
                js: { type: SchemaValueType.STRING },
              },
              required: ['title', 'summary', 'html', 'css', 'js'],
            },
          },
        });
        const built = this.buildValidatedBundleFromJson(response.text ?? '');
        if (built) {
          return built;
        }
      } catch (err) {
        if (input.signal?.aborted) {
          throw err;
        }
        // Fall back to structured offline coding bundle when Gemini is unavailable
      }
    }

    const bundle = buildRichCodingTemplateBundle(input.prompt);
    return {
      summary: bundle.summary,
      rawManifestJson: bundle.rawManifestJson,
      tokensUsed: Math.ceil(bundle.rawManifestJson.length / 4),
    };
  }
}

export class LiveGeminiSearchProvider implements SearchProvider {
  public readonly providerName = 'gemini-google-search';
  private readonly apiKey?: string;
  /**
   * Deprecated legacy accessors retained only for backward compatibility with
   * older tests/callers. All runtime paths use stateless `executeSearch()`.
   */
  public lastSynthesizedAnswer: string | null = null;
  public lastSearchImages: readonly SearchImageGalleryItem[] = [];

  constructor(options?: { readonly apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  public async executeSearch(input: {
    readonly query: string;
    readonly maxResults?: number;
    readonly maxOutputTokens?: number;
  }): Promise<SearchExecutionBundle> {
    const maxItems = Math.max(1, Math.min(8, input.maxResults ?? 6));
    const maxOutputTokens = Math.max(input.maxOutputTokens || 8_192, 2_048);
    const todayIso = new Date().toISOString().slice(0, 10);

    const ai = await createServerGeminiClient(this.apiKey);
    const inTest = isRunningInTestRunner();
    const groundingOnCooldown = !inTest && Date.now() < groundingRateLimitedUntilMs;

    // 1. Primary path: Gemini native Google Search grounding (`gemini-3.1-flash-lite`)
    if (ai && !groundingOnCooldown) {
      try {
        const groundingSystemInstruction = [
          `You are Kartik.ai Web Research Specialist. Today's UTC date is ${todayIso}.`,
          'Answer the user directly using verified live Google Search results in clean, scannable Markdown (use concise headings, bullet points, or a comparison table when helpful).',
          'Never paste a raw bibliography or list of bare URLs at the end—citations are rendered separately as interactive source cards.',
          'At the very end of your response, add a section titled exactly `FOLLOW_UP_QUESTIONS:` containing 3 concise, high-value follow-up search questions as `- ` bullet lines.',
        ].join(' ');

        const response = await ai.generateContent({
          model: DEFAULT_TEXT_MODEL,
          contents: input.query,
          config: {
            systemInstruction: groundingSystemInstruction,
            maxOutputTokens,
            tools: [{ googleSearch: {} }],
          },
        });

        const rawText = (response.text ?? '').trim();
        const groundingMeta = response.candidates?.[0]?.groundingMetadata;
        const chunks = groundingMeta?.groundingChunks ?? [];
        const supports = groundingMeta?.groundingSupports ?? [];
        const webSearchQueries = groundingMeta?.webSearchQueries ?? [];

        const items: SearchResultItem[] = [];
        const seenUrls = new Set<string>();
        for (let idx = 0; idx < chunks.length; idx += 1) {
          const web = chunks[idx]?.web;
          if (!web?.uri || !isSafePublicHttpUrl(web.uri) || seenUrls.has(web.uri)) {
            continue;
          }
          seenUrls.add(web.uri);
          const supportText = supports
            .find((s) => s.groundingChunkIndices?.includes(idx))
            ?.segment?.text?.trim();
          const title = (web.title ?? '').trim() || extractCleanDomain(web.uri);
          items.push({
            title: title.slice(0, 140),
            url: web.uri,
            domain: extractCleanDomain(web.uri, title),
            snippet:
              supportText && supportText.length > 20
                ? supportText.slice(0, 320)
                : `Verified Google Search source covering ${cleanPublicSearchQuery(input.query).slice(0, 90)}.`,
            sourceType: 'web',
          });
          if (items.length >= maxItems) {
            break;
          }
        }

        if (items.length > 0 || rawText.length > 0) {
          const finalItems: SearchResultItem[] =
            items.length > 0
              ? [...items]
              : [
                  {
                    title: `${cleanPublicSearchQuery(input.query).slice(0, 64)} — Live Search Summary`,
                    url: `https://www.google.com/search?q=${encodeURIComponent(input.query.trim())}`,
                    domain: 'google.com',
                    snippet: rawText.slice(0, 280),
                    sourceType: 'web',
                  },
                ];

          // Outside strict unit-test runners, enrich with genuine Wikimedia/OG thumbnails & page excerpts
          let enrichedImages: readonly SearchImageGalleryItem[] = [];
          if (!inTest) {
            const [wikiThumbsSettled, pageReadSettled] = await Promise.allSettled([
              fetchWikipediaExtractResults(cleanPublicSearchQuery(input.query), 3, 2_200),
              Promise.allSettled(
                finalItems.slice(0, 2).map((it) => readPublicPageSnippet(it.url, 2_200)),
              ),
            ]);

            if (pageReadSettled.status === 'fulfilled') {
              pageReadSettled.value.forEach((res, idx) => {
                if (res.status === 'fulfilled' && res.value && finalItems[idx]) {
                  finalItems[idx] = {
                    ...finalItems[idx]!,
                    snippet:
                      res.value.excerpt && res.value.excerpt.length > finalItems[idx]!.snippet.length
                        ? res.value.excerpt
                        : finalItems[idx]!.snippet,
                    imageUrl: finalItems[idx]!.imageUrl ?? res.value.imageUrl,
                  };
                }
              });
            }

            const wikiItems =
              wikiThumbsSettled.status === 'fulfilled' ? wikiThumbsSettled.value : [];
            enrichedImages = collectRealSearchImages([...finalItems, ...wikiItems], 4);
          }

          const { answer: parsedAnswer, followUpQueries } = parseAnswerAndFollowUps(
            rawText,
            input.query,
            finalItems,
          );
          const citedAnswer = injectGroundingSupportCitations(
            parsedAnswer,
            supports,
            finalItems.length,
          );

          return Object.freeze({
            results: Object.freeze(finalItems),
            synthesizedAnswer: citedAnswer || null,
            searchImages: enrichedImages,
            followUpQueries,
            searchQueries: webSearchQueries,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('HTTP 429') && !inTest) {
          groundingRateLimitedUntilMs = Date.now() + GROUNDING_429_COOLDOWN_MS;
          console.warn(
            '[kartik-search] Gemini Google Search grounding hit HTTP 429 — switching to hybrid multi-source live web reader + Gemini synthesis for 2m.',
          );
        }
      }
    }

    // 2. Hybrid Multi-Source Live Web Reader (Google News RSS + Wikipedia + DuckDuckGo + HN + SSRF-safe page reader)
    // Preserves offline determinism in unit tests when GEMINI_API_KEY is unset.
    if (ai || !inTest) {
      try {
        const liveItems = await fetchMultiSourceLiveWebResults(input.query, maxItems, {
          readTopPages: !inTest || process.env.ENABLE_PAGE_READER_IN_TEST === 'true',
        });
        if (liveItems.length > 0) {
          const searchImages = collectRealSearchImages(liveItems, 4);
          const sourceContext = liveItems
            .map((item, idx) => {
              const meta = [item.domain, item.publishedAt].filter(Boolean).join(' · ');
              return `[${idx + 1}] ${item.title}${meta ? ` (${meta})` : ''}\nURL: ${item.url}\nExcerpt: ${item.snippet}`;
            })
            .join('\n\n');

          // 2a. Synthesize via plain Gemini `gemini-3.1-flash-lite` (no googleSearch tool -> avoids grounding quota)
          if (ai) {
            try {
              const synthRes = await ai.generateContent({
                model: DEFAULT_TEXT_MODEL,
                contents: `Today's UTC date is ${todayIso}.\nUser query: "${input.query}"\n\nRetrieved live web sources:\n${sourceContext}\n\nWrite a clear, accurate, well-structured Markdown answer grounded strictly in these sources. Cite sources inline using [1], [2], etc. Do NOT append a raw URL list at the end.\n\nEnd with:\nFOLLOW_UP_QUESTIONS:\n- <follow-up 1>\n- <follow-up 2>\n- <follow-up 3>`,
                config: {
                  systemInstruction:
                    'You are Kartik.ai Web Search Synthesis Agent. Answer directly and accurately using ONLY the provided live web excerpts and cite [1], [2] inline. Never invent URLs, dates, or facts outside the sources.',
                  maxOutputTokens,
                },
              });
              const synthRaw = (synthRes.text ?? '').trim();
              if (synthRaw.length > 0) {
                const { answer, followUpQueries } = parseAnswerAndFollowUps(
                  synthRaw,
                  input.query,
                  liveItems,
                );
                const normalizedAnswer = normalizeInlineCitations(answer, liveItems.length);
                return Object.freeze({
                  results: Object.freeze(liveItems),
                  synthesizedAnswer: normalizedAnswer,
                  searchImages,
                  followUpQueries,
                });
              }
            } catch {
              // Plain Gemini text generation was also rate-limited; build factual briefing below
            }
          }

          // 2b. Direct factual briefing from the live retrieved web snippets (never generic boilerplate)
          const bulletSummary = liveItems
            .map((item, idx) => `- **${item.title}** [${idx + 1}]: ${item.snippet}`)
            .join('\n');
          return Object.freeze({
            results: Object.freeze(liveItems),
            synthesizedAnswer: `Live web results retrieved for **"${input.query.trim()}"**:\n\n${bulletSummary}`,
            searchImages,
            followUpQueries: buildDeterministicFollowUps(input.query, liveItems),
          });
        }
      } catch {
        // Network completely unreachable — fall through to offline reference fallback
      }
    }

    const q = encodeURIComponent(input.query.trim());
    const offlineResults: SearchResultItem[] = [
      {
        title: `${input.query.slice(0, 60)} — Technical Documentation & Reference`,
        url: `https://developer.mozilla.org/en-US/search?q=${q}`,
        domain: 'developer.mozilla.org',
        snippet: `Comprehensive specification, architectural patterns, and real-world benchmarks for ${input.query}.`,
        sourceType: 'technical',
      },
      {
        title: `${input.query.slice(0, 60)} — Encyclopedia & Overview`,
        url: `https://en.wikipedia.org/wiki/Special:Search?search=${q}`,
        domain: 'en.wikipedia.org',
        snippet: `Foundational principles, historical evolution, and background context covering ${input.query}.`,
        sourceType: 'encyclopedia',
      },
      {
        title: `${input.query.slice(0, 60)} — Open-Source Reference Implementations`,
        url: `https://github.com/search?q=${q}`,
        domain: 'github.com',
        snippet: `Open-source reference implementations, benchmarks, and deployment patterns for ${input.query}.`,
        sourceType: 'technical',
      },
    ];

    return Object.freeze({
      results: Object.freeze(offlineResults),
      synthesizedAnswer: null,
      searchImages: Object.freeze([]),
      followUpQueries: buildDeterministicFollowUps(input.query, offlineResults),
    });
  }

  public async searchWeb(input: {
    readonly query: string;
    readonly maxResults?: number;
  }): Promise<readonly SearchResultItem[]> {
    const bundle = await this.executeSearch(input);
    this.lastSynthesizedAnswer = bundle.synthesizedAnswer;
    this.lastSearchImages = bundle.searchImages;
    return bundle.results;
  }
}

export class LiveGeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly providerName = 'gemini-embedding-2';
  public readonly dimensions = 768;
  private readonly apiKey?: string;

  constructor(options?: { readonly apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  public async embedTexts(
    texts: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    const ai = await createServerGeminiClient(this.apiKey);
    if (ai && texts.length > 0) {
      try {
        const result = await ai.embedContent({
          model: 'gemini-embedding-2',
          contents: [...texts],
        });
        if (result.embeddings && result.embeddings.length === texts.length) {
          return result.embeddings.map((emb: GeminiEmbeddingItem) => {
            const vals = emb.values ?? [];
            if (vals.length === 768) {
              return Object.freeze(vals);
            }
            const padded = Array.from(
              { length: 768 },
              (_, i) => vals[i % Math.max(1, vals.length)] ?? 0,
            );
            return Object.freeze(padded);
          });
        }
      } catch {
        // Fall back to deterministic 768-dim unit vectors
      }
    }

    return texts.map((t) => computeDeterministicEmbedding(t, this.dimensions));
  }
}

export class LiveGeminiVisionProvider implements VisionProvider {
  public readonly providerName = 'gemini-live-vision';
  private readonly apiKey?: string;

  constructor(options?: { readonly apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  public async analyzeImage(input: {
    readonly prompt: string;
    readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    readonly imageBytes: Uint8Array;
    readonly filename?: string;
    readonly systemInstruction?: string;
  }): Promise<{ readonly analysis: string; readonly tokensUsed: number }> {
    const base64Data = Buffer.from(input.imageBytes).toString('base64');
    const intent = classifyVisionIntent(input.prompt);
    const dimensions = parseImageDimensions(input.mimeType, input.imageBytes);
    const meta = {
      mimeType: input.mimeType,
      sizeBytes: input.imageBytes.byteLength,
      filename: input.filename,
      dimensions,
    };
    const systemInstruction =
      input.systemInstruction ?? buildVisionSystemInstruction(intent);
    const userPrompt = buildVisionUserPrompt(input.prompt, meta);

    const ai = await createServerGeminiClient(this.apiKey);
    if (ai) {
      try {
        const response = await ai.generateContent({
          model: DEFAULT_TEXT_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: input.mimeType,
                    data: base64Data,
                  },
                },
                {
                  text: userPrompt,
                },
              ],
            },
          ],
          config: {
            systemInstruction,
            maxOutputTokens: 4_096,
          },
        });
        const text = (response.text ?? '').trim();
        if (text.length > 0) {
          return {
            analysis: text,
            tokensUsed: Math.max(32, Math.ceil(text.length / 4)),
          };
        }
      } catch {
        // Fall back to offline structural inspection when Gemini is unavailable
      }
    }

    const analysis = formatOfflineVisionFallback({
      prompt: input.prompt,
      intent,
      meta,
    });

    return {
      analysis,
      tokensUsed: Math.ceil(analysis.length / 4),
    };
  }
}

export class LiveGeminiPdfDocumentProvider implements PdfDocumentProvider {
  public readonly providerName = 'gemini-live-pdf';
  private readonly apiKey?: string;
  private readonly fallback = new MockPdfDocumentProvider();

  constructor(options?: { readonly apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  private compilePdfFromJson(
    rawJson: string,
    defaults?: {
      readonly documentType: ReturnType<typeof classifyPdfDocumentType>;
      readonly generatedDate: string;
    },
  ): PdfDocumentGenerationResult | null {
    try {
      const parsedObj = JSON.parse(extractJsonObjectString(rawJson)) as Record<
        string,
        unknown
      >;
      const merged = {
        ...parsedObj,
        documentType: parsedObj.documentType ?? defaults?.documentType,
        generatedDate: parsedObj.generatedDate ?? defaults?.generatedDate,
        author: parsedObj.author ?? 'Kartik.ai Editorial Engine',
      };
      const spec = validatePdfDocumentSpec(merged);
      const compiled = buildPdfBinaryBuffer(spec);
      return {
        spec: compiled.spec,
        pdfBytes: compiled.pdfBytes,
        pageCount: compiled.pageCount,
        summaryMarkdown: formatPdfSummaryMarkdown(compiled.spec, compiled.pageCount),
        tokensUsed: Math.max(180, Math.ceil(rawJson.length / 4)),
      };
    } catch {
      return null;
    }
  }

  public async generatePdfDocument(input: {
    readonly prompt: string;
    readonly maxOutputTokens: number;
    readonly existingArtifactContext?: string;
    readonly signal?: AbortSignal;
  }): Promise<PdfDocumentGenerationResult> {
    const documentType = classifyPdfDocumentType(input.prompt);
    const todayIso = new Date().toISOString().slice(0, 10);
    const refinementBlock = input.existingArtifactContext
      ? `\n\nEXISTING PDF SPECIFICATION IN THIS THREAD (if the user asks to revise, expand, condense, or update the document, refine this existing spec directly):\n${input.existingArtifactContext.slice(0, 6000)}\n`
      : '';
    const pdfPrompt = `Generate a publication-grade multi-section PDF document (archetype: ${documentType}) strictly about: "${input.prompt}".
Stay 100% faithful to the topic's natural domain and tone — do NOT inject software engineering, cloud infrastructure, or corporate jargon unless the prompt is actually about technology or business.${refinementBlock}

Return ONLY a valid JSON object with keys:
- title (string, concise compelling title matching the subject)
- subtitle (string, descriptive subtitle matching the tone of the topic)
- executiveSummary (string, 2-4 crisp sentences serving as an overview, synopsis, or abstract of the document)
- keyMetrics (OPTIONAL array of 3 to 4 quick-fact, date, figure, or KPI objects { label, value, delta } — include ONLY when concrete numbers, dates, or stats genuinely enrich the topic; omit or pass [] for purely narrative/essay topics)
- sections (array of 4 to 6 objects, each with:
    heading (string),
    content (rich, concrete, topic-authentic paragraph string),
    bullets (array of 3 to 4 sharp, informative bullet strings),
    callout (optional concise takeaway, quote, or highlight string on key sections),
    table (OPTIONAL structured table — e.g. comparison, timeline, itinerary, glossary, milestones, or specifications — with caption, headers (2-4 strings), and rows (3-5 string arrays matching header count) on 1-2 sections ONLY where tabular data adds clarity),
    chart (OPTIONAL horizontal bar chart { title, unit, bars: [{ label, value (number), displayValue }] } with 3-5 bars on 1 section ONLY when quantitative visual comparison genuinely elevates the document)
  )`;

    const ai = await createServerGeminiClient(this.apiKey);
    if (ai) {
      try {
        const response = await ai.generateContent({
          model: DEFAULT_TEXT_MODEL,
          contents: pdfPrompt,
          signal: input.signal,
          config: {
            systemInstruction: buildPdfSystemInstruction(documentType, todayIso),
            maxOutputTokens: Math.max(input.maxOutputTokens || 8_192, 4_096),
            responseMimeType: 'application/json',
            responseSchema: {
              type: SchemaValueType.OBJECT,
              properties: {
                title: { type: SchemaValueType.STRING },
                subtitle: { type: SchemaValueType.STRING },
                executiveSummary: { type: SchemaValueType.STRING },
                keyMetrics: {
                  type: SchemaValueType.ARRAY,
                  items: {
                    type: SchemaValueType.OBJECT,
                    properties: {
                      label: { type: SchemaValueType.STRING },
                      value: { type: SchemaValueType.STRING },
                      delta: { type: SchemaValueType.STRING },
                    },
                    required: ['label', 'value'],
                  },
                },
                sections: {
                  type: SchemaValueType.ARRAY,
                  items: {
                    type: SchemaValueType.OBJECT,
                    properties: {
                      heading: { type: SchemaValueType.STRING },
                      content: { type: SchemaValueType.STRING },
                      bullets: {
                        type: SchemaValueType.ARRAY,
                        items: { type: SchemaValueType.STRING },
                      },
                      callout: { type: SchemaValueType.STRING },
                      table: {
                        type: SchemaValueType.OBJECT,
                        properties: {
                          caption: { type: SchemaValueType.STRING },
                          headers: {
                            type: SchemaValueType.ARRAY,
                            items: { type: SchemaValueType.STRING },
                          },
                          rows: {
                            type: SchemaValueType.ARRAY,
                            items: {
                              type: SchemaValueType.ARRAY,
                              items: { type: SchemaValueType.STRING },
                            },
                          },
                        },
                        required: ['headers', 'rows'],
                      },
                      chart: {
                        type: SchemaValueType.OBJECT,
                        properties: {
                          title: { type: SchemaValueType.STRING },
                          unit: { type: SchemaValueType.STRING },
                          bars: {
                            type: SchemaValueType.ARRAY,
                            items: {
                              type: SchemaValueType.OBJECT,
                              properties: {
                                label: { type: SchemaValueType.STRING },
                                value: { type: SchemaValueType.NUMBER },
                                displayValue: { type: SchemaValueType.STRING },
                              },
                              required: ['label', 'value'],
                            },
                          },
                        },
                        required: ['bars'],
                      },
                    },
                    required: ['heading', 'content', 'bullets'],
                  },
                },
              },
              required: ['title', 'subtitle', 'executiveSummary', 'sections'],
            },
          },
        });
        const compiled = this.compilePdfFromJson(response.text ?? '', {
          documentType,
          generatedDate: todayIso,
        });
        if (compiled) {
          return compiled;
        }
      } catch (err) {
        if (input.signal?.aborted) {
          throw err;
        }
        if (process.env.NODE_ENV !== 'test') {
          console.warn(
            '[kartik-pdf] Live Gemini PDF generation fell back to offline template:',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    return this.fallback.generatePdfDocument(input);
  }
}

export class LiveGeminiPptPresentationProvider implements PptPresentationProvider {
  public readonly providerName = 'gemini-live-ppt';
  private readonly apiKey?: string;
  private readonly fallback = new MockPptPresentationProvider();

  constructor(options?: { readonly apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  private compilePptFromJson(
    rawJson: string,
    defaults?: {
      readonly theme: ReturnType<typeof classifyPptDeckTheme>;
      readonly surfaceMode: ReturnType<typeof classifyPptSurfaceMode>;
      readonly generatedDate: string;
    },
  ): PptPresentationGenerationResult | null {
    try {
      const parsedObj = JSON.parse(extractJsonObjectString(rawJson)) as Record<
        string,
        unknown
      >;
      const merged = {
        ...parsedObj,
        theme: parsedObj.theme ?? defaults?.theme,
        surfaceMode: parsedObj.surfaceMode ?? defaults?.surfaceMode,
        generatedDate: parsedObj.generatedDate ?? defaults?.generatedDate,
        author: parsedObj.author ?? 'Kartik.ai Presentation Engine',
        footer: parsedObj.footer ?? 'Generated by Kartik.ai',
      };
      const spec = validatePptPresentationSpec(merged);
      const compiled = buildPptxBinaryBuffer(spec);
      return {
        spec: compiled.spec,
        pptxBytes: compiled.pptxBytes,
        slideCount: compiled.slideCount,
        summaryMarkdown: formatPptSummaryMarkdown(compiled.spec),
        tokensUsed: Math.max(260, Math.ceil(rawJson.length / 4)),
      };
    } catch {
      return null;
    }
  }

  public async generatePptPresentation(input: {
    readonly prompt: string;
    readonly maxOutputTokens: number;
    readonly existingArtifactContext?: string;
    readonly signal?: AbortSignal;
  }): Promise<PptPresentationGenerationResult> {
    const theme = classifyPptDeckTheme(input.prompt);
    const surfaceMode = classifyPptSurfaceMode(input.prompt);
    const targetContentSlides = extractRequestedSlideCount(input.prompt);
    const minDistinctLayouts = Math.min(4, Math.max(2, targetContentSlides - 1));
    const todayIso = new Date().toISOString().slice(0, 10);
    const refinementBlock = input.existingArtifactContext
      ? `\n\nEXISTING SLIDE DECK IN THIS THREAD (if the user asks to revise specific slides, add/remove slides, or switch tone/theme, refine this existing deck rather than discarding it):\n${input.existingArtifactContext.slice(0, 6000)}\n`
      : '';
    const pptPrompt = `Create a compelling ${targetContentSlides}-content-slide presentation deck (archetype: ${theme}, surfaceMode: ${surfaceMode}) strictly about: "${input.prompt}".
Stay 100% faithful to the subject's real domain, tone, and vocabulary — NEVER inject software architecture, "Legacy vs Modern", SaaS KPIs, or corporate rollout phases unless the user's prompt is actually about technology or business.${refinementBlock}

Return ONLY a valid JSON object with keys: title, subtitle, slides (array of EXACTLY ${targetContentSlides} content slide objects — Cover and Closing slides are added automatically).

Choose the most natural sequence of layouts for this specific topic, using at least ${minDistinctLayouts} distinct layouts across the ${targetContentSlides} slides from:
- layout="spotlight": include "callout" (a sharp 1-sentence core thesis, insight, or quote) AND "bullets" (3 supporting points).
- layout="metrics": include "metrics" (3 to 4 authentic facts, dates, measurements, figures, or KPIs matching the topic: { "label": "...", "value": "...", "delta": "..." }) AND "bullets" (2 concise synthesis bullets).
- layout="two_column": include "columns" (EXACTLY 2 natural contrasting columns for this topic — e.g., two eras, myths vs reality, two schools of thought, pros vs cons, or two methods: [{ "heading": "...", "points": [3 concise bullets] }, { "heading": "...", "points": [3 concise bullets] }]), optional "callout" (1 takeaway), AND "bullets" (2 summary bullets).
- layout="process": include "steps" (3 to 4 ordered stages, chronological eras, steps, or milestones fitting the topic: { "step": "01", "title": "...", "detail": "..." }), optional "callout" (1 synthesis takeaway), AND "bullets" (2 summary bullets).
- layout="bullets": include "bullets" (4 crisp scannable bullets, max 14 words each), optional "chart" ({ title, unit, bars: [{ label, value (number), displayValue }] } with 3-5 bars when numeric comparison clarifies the slide), AND optional "callout" (1 key takeaway).

Every slide MUST also include: kicker (2-4 words), title, subtitle, and speakerNotes (2-3 natural presenter sentences).`;

    const ai = await createServerGeminiClient(this.apiKey);
    if (ai) {
      try {
        const response = await ai.generateContent({
          model: DEFAULT_TEXT_MODEL,
          contents: pptPrompt,
          signal: input.signal,
          config: {
            systemInstruction: buildPptSystemInstruction(theme, todayIso, targetContentSlides),
            maxOutputTokens: Math.max(input.maxOutputTokens || 8_192, 4_096),
            responseMimeType: 'application/json',
            responseSchema: {
              type: SchemaValueType.OBJECT,
              properties: {
                title: { type: SchemaValueType.STRING },
                subtitle: { type: SchemaValueType.STRING },
                slides: {
                  type: SchemaValueType.ARRAY,
                  items: {
                    type: SchemaValueType.OBJECT,
                    properties: {
                      layout: {
                        type: SchemaValueType.STRING,
                        enum: ['bullets', 'metrics', 'two_column', 'process', 'spotlight'],
                      },
                      kicker: { type: SchemaValueType.STRING },
                      title: { type: SchemaValueType.STRING },
                      subtitle: { type: SchemaValueType.STRING },
                      bullets: {
                        type: SchemaValueType.ARRAY,
                        items: { type: SchemaValueType.STRING },
                      },
                      metrics: {
                        type: SchemaValueType.ARRAY,
                        items: {
                          type: SchemaValueType.OBJECT,
                          properties: {
                            label: { type: SchemaValueType.STRING },
                            value: { type: SchemaValueType.STRING },
                            delta: { type: SchemaValueType.STRING },
                          },
                          required: ['label', 'value'],
                        },
                      },
                      columns: {
                        type: SchemaValueType.ARRAY,
                        items: {
                          type: SchemaValueType.OBJECT,
                          properties: {
                            heading: { type: SchemaValueType.STRING },
                            points: {
                              type: SchemaValueType.ARRAY,
                              items: { type: SchemaValueType.STRING },
                            },
                          },
                          required: ['heading', 'points'],
                        },
                      },
                      steps: {
                        type: SchemaValueType.ARRAY,
                        items: {
                          type: SchemaValueType.OBJECT,
                          properties: {
                            step: { type: SchemaValueType.STRING },
                            title: { type: SchemaValueType.STRING },
                            detail: { type: SchemaValueType.STRING },
                          },
                          required: ['step', 'title', 'detail'],
                        },
                      },
                      chart: {
                        type: SchemaValueType.OBJECT,
                        properties: {
                          title: { type: SchemaValueType.STRING },
                          unit: { type: SchemaValueType.STRING },
                          bars: {
                            type: SchemaValueType.ARRAY,
                            items: {
                              type: SchemaValueType.OBJECT,
                              properties: {
                                label: { type: SchemaValueType.STRING },
                                value: { type: SchemaValueType.NUMBER },
                                displayValue: { type: SchemaValueType.STRING },
                              },
                              required: ['label', 'value'],
                            },
                          },
                        },
                        required: ['bars'],
                      },
                      callout: { type: SchemaValueType.STRING },
                      speakerNotes: { type: SchemaValueType.STRING },
                    },
                    required: ['layout', 'kicker', 'title', 'subtitle', 'bullets', 'speakerNotes'],
                  },
                },
              },
              required: ['title', 'subtitle', 'slides'],
            },
          },
        });
        const compiled = this.compilePptFromJson(response.text ?? '', {
          theme,
          surfaceMode,
          generatedDate: todayIso,
        });
        if (compiled) {
          return compiled;
        }
      } catch (err) {
        if (input.signal?.aborted) {
          throw err;
        }
        if (process.env.NODE_ENV !== 'test') {
          console.warn(
            '[kartik-ppt] Live Gemini PPT generation fell back to offline template:',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    return this.fallback.generatePptPresentation(input);
  }
}

export class LiveGeminiImageGenerationProvider implements ImageGenerationProvider {
  public readonly providerName = 'gemini-live-image';
  private readonly apiKey?: string;

  constructor(options?: { readonly apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  public async generateImage(input: {
    readonly prompt: string;
    readonly enhancedPrompt?: string;
    readonly aspectRatio?: ImageAspectRatio;
    readonly style?: string;
    readonly referenceImage?: {
      readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
      readonly data: Uint8Array;
      readonly filename?: string;
    };
  }): Promise<{
    readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    readonly data: Uint8Array;
    readonly caption: string;
    readonly enhancedPrompt: string;
    readonly aspectRatio: ImageAspectRatio;
    readonly style: ImageStyleArchetype;
    readonly modelUsed: string;
    readonly liveGenerated: boolean;
  }> {
    const rawPrompt = input.prompt.trim();
    const style = (input.style as ImageStyleArchetype | undefined) ?? classifyImageStyle(rawPrompt);
    const aspectRatio: ImageAspectRatio = input.aspectRatio ?? detectImageAspectRatio(rawPrompt);
    const isEdit = Boolean(input.referenceImage);
    const enhancedPrompt =
      input.enhancedPrompt?.trim() ||
      buildEnhancedImagePrompt({
        prompt: rawPrompt,
        style,
        aspectRatio,
        isEdit,
      });

    const caption = formatImageCaption({
      originalPrompt: rawPrompt,
      enhancedPrompt,
      style,
      aspectRatio,
      isEdit,
      referenceFilename: input.referenceImage?.filename,
    });

    const ai = await createServerGeminiClient(this.apiKey);

    // Direct multimodal image generation / editing via Gemini lite image model
    if (ai) {
      const imageModels = uniqueNonEmpty([
        process.env.GEMINI_IMAGE_MODEL,
        ...DEFAULT_IMAGE_MODELS,
      ]);
      const userParts: Array<
        | { readonly text: string }
        | { readonly inlineData: { readonly mimeType: string; readonly data: string } }
      > = [];
      if (input.referenceImage) {
        userParts.push({
          inlineData: {
            mimeType: input.referenceImage.mimeType,
            data: Buffer.from(input.referenceImage.data).toString('base64'),
          },
        });
      }
      userParts.push({ text: enhancedPrompt });

      for (const imageModel of imageModels) {
        try {
          const imgRes = await ai.generateContent({
            model: imageModel,
            fallbackModels: [],
            contents: [
              {
                role: 'user',
                parts: userParts,
              },
            ],
            config: {
              responseModalities: ['IMAGE', 'TEXT'],
              imageConfig: {
                aspectRatio,
              },
            },
            timeoutMs: resolveProviderTimeoutMs(60_000),
          });
          const parts =
            imgRes.parts ?? imgRes.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              const rawMime = (part.inlineData.mimeType ?? 'image/png').toLowerCase();
              const mimeType: 'image/png' | 'image/jpeg' | 'image/webp' =
                rawMime === 'image/jpeg' || rawMime === 'image/jpg'
                  ? 'image/jpeg'
                  : rawMime === 'image/webp'
                    ? 'image/webp'
                    : 'image/png';
              const bytes = new Uint8Array(
                Buffer.from(part.inlineData.data, 'base64'),
              );
              if (bytes.byteLength > 64) {
                return {
                  mimeType,
                  data: bytes,
                  caption,
                  enhancedPrompt,
                  aspectRatio,
                  style,
                  modelUsed: imageModel,
                  liveGenerated: true,
                };
              }
            }
          }
        } catch {
          // Try next Gemini image model
        }
      }

      // Secondary real image generation: Google Imagen 3 :predict endpoint (text-to-image)
      if (!isEdit && ai.predictImagen) {
        try {
          const imagen = await ai.predictImagen({
            model: 'imagen-3.0-generate-002',
            prompt: enhancedPrompt,
            timeoutMs: resolveProviderTimeoutMs(60_000),
          });
          if (imagen && imagen.data.byteLength > 64) {
            return {
              mimeType: imagen.mimeType,
              data: imagen.data,
              caption,
              enhancedPrompt,
              aspectRatio,
              style,
              modelUsed: 'imagen-3.0-generate-002',
              liveGenerated: true,
            };
          }
        } catch {
          // Fall through to offline test PNG fallback
        }
      }
    }

    // Offline/demo aspect-ratio-matched raster PNG fallback when GEMINI_API_KEY is not configured
    const pngBytes = buildOfflineStudioPreviewPng({
      style,
      aspectRatio,
      prompt: rawPrompt,
    });

    return {
      mimeType: 'image/png',
      data: pngBytes,
      caption,
      enhancedPrompt,
      aspectRatio,
      style,
      modelUsed: 'studio-offline-preview',
      liveGenerated: false,
    };
  }
}
