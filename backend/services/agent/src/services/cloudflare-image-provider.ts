/**
 * @kartik/agent/services/cloudflare-image-provider — Cloudflare Workers AI Image Generation Provider
 *
 * Uses Cloudflare Workers AI REST API (`@cf/black-forest-labs/flux-1-schnell` by default —
 * 10,000 free Neurons/day, ~150+ FLUX images/day with no credit card required).
 *
 * Security & Reliability:
 * - Server-side only; reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and optional
 *   `CLOUDFLARE_IMAGE_MODEL` from environment variables (never exposed to browser bundles).
 * - If `CLOUDFLARE_ACCOUNT_ID` is omitted, attempts one cached auto-discovery lookup via
 *   `GET /client/v4/accounts?per_page=1`; if the token is Workers-AI-scoped only and cannot
 *   list accounts, throws an actionable `AppError('PROVIDER_UNAVAILABLE')` instructing the user
 *   to set `CLOUDFLARE_ACCOUNT_ID` (0 credits deducted).
 * - Retries transient HTTP 429 / 5xx responses with bounded exponential backoff.
 */

import { AppError } from '@kartik/shared/errors';
import type { ImageGenerationProvider } from '../models/index.js';
import {
  CLOUDFLARE_IMAGE_DEFAULT_MODEL,
  buildCloudflareImageRequestBody,
  buildEnhancedImagePrompt,
  classifyImageStyle,
  decodeCloudflareImageResponse,
  detectImageAspectRatio,
  formatImageCaption,
  parseGeminiRetryDelayMs,
  type ImageAspectRatio,
  type ImageStyleArchetype,
} from '../agents/image/index.js';

function stripQuotes(val: string | undefined): string {
  return (val ?? '').trim().replace(/^["']|["']$/g, '');
}

function isUsableCloudflareToken(raw: string | undefined): boolean {
  const val = stripQuotes(raw);
  if (!val || val.length < 16) return false;
  const lower = val.toLowerCase();
  return (
    !lower.includes('placeholder') &&
    !lower.startsWith('test-') &&
    !lower.startsWith('your_') &&
    !lower.startsWith('paste_your_') &&
    !lower.includes('should_never_be_called')
  );
}

function isUsableCloudflareAccountId(raw: string | undefined): boolean {
  const val = stripQuotes(raw);
  return /^[a-f0-9]{32}$/i.test(val);
}

function resolveTimeoutMs(defaultMs = 60_000): number {
  const parsed = Number(process.env.PROVIDER_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 5_000 && parsed <= 180_000) {
    return parsed;
  }
  return defaultMs;
}

/**
 * Returns true when usable `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` credentials
 * are available for Cloudflare Workers AI image generation.
 */
export function hasCloudflareImageCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (
    isUsableCloudflareToken(env.CLOUDFLARE_API_TOKEN) &&
    isUsableCloudflareAccountId(env.CLOUDFLARE_ACCOUNT_ID)
  );
}

const discoveredAccountCache = new Map<string, string>();

async function discoverCloudflareAccountId(
  apiToken: string,
  timeoutMs: number,
): Promise<string | null> {
  const cached = discoveredAccountCache.get(apiToken);
  if (cached) {
    return cached;
  }
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=1', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(Math.min(15_000, timeoutMs)),
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as {
      readonly result?: ReadonlyArray<{ readonly id?: string }>;
    };
    const id = stripQuotes(json.result?.[0]?.id);
    if (isUsableCloudflareAccountId(id)) {
      discoveredAccountCache.set(apiToken, id);
      return id;
    }
    return null;
  } catch {
    return null;
  }
}

export class CloudflareWorkersAiImageProvider implements ImageGenerationProvider {
  public readonly providerName = 'cloudflare-workers-ai-image';
  private readonly explicitToken?: string;
  private readonly explicitAccountId?: string;
  private readonly explicitModel?: string;
  private readonly maxTransientRetries: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options?: {
    readonly apiToken?: string;
    readonly accountId?: string;
    readonly model?: string;
    readonly maxTransientRetries?: number;
    readonly sleepFn?: (ms: number) => Promise<void>;
  }) {
    this.explicitToken = options?.apiToken;
    this.explicitAccountId = options?.accountId;
    this.explicitModel = options?.model;
    this.maxTransientRetries = Math.max(0, Math.min(3, options?.maxTransientRetries ?? 2));
    this.sleepFn =
      options?.sleepFn ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
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
    const style =
      (input.style as ImageStyleArchetype | undefined) ?? classifyImageStyle(rawPrompt);
    const aspectRatio: ImageAspectRatio =
      input.aspectRatio ?? detectImageAspectRatio(rawPrompt);
    const isEdit = Boolean(input.referenceImage);
    const enhancedPrompt =
      input.enhancedPrompt?.trim() ||
      buildEnhancedImagePrompt({
        prompt: rawPrompt,
        style,
        aspectRatio,
        isEdit: false,
      });

    const caption = formatImageCaption({
      originalPrompt: rawPrompt,
      enhancedPrompt,
      style,
      aspectRatio,
      isEdit,
      referenceFilename: input.referenceImage?.filename,
    });

    const apiToken = stripQuotes(this.explicitToken ?? process.env.CLOUDFLARE_API_TOKEN);
    if (!isUsableCloudflareToken(apiToken)) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        'Cloudflare Workers AI image generation requires CLOUDFLARE_API_TOKEN in .env. No credits were charged.',
        { details: { reason: ['missing_cloudflare_token'] } },
      );
    }

    const timeoutMs = resolveTimeoutMs(60_000);
    let accountId = stripQuotes(this.explicitAccountId ?? process.env.CLOUDFLARE_ACCOUNT_ID);
    if (!isUsableCloudflareAccountId(accountId)) {
      const discovered = await discoverCloudflareAccountId(apiToken, timeoutMs);
      if (discovered) {
        accountId = discovered;
      } else {
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          'Cloudflare Workers AI API token is active, but CLOUDFLARE_ACCOUNT_ID is missing. Copy your 32-character Account ID from your Cloudflare dashboard URL (dash.cloudflare.com/<ACCOUNT_ID>/ai/workers-ai) and add CLOUDFLARE_ACCOUNT_ID to .env. No credits were charged.',
          { details: { reason: ['missing_cloudflare_account_id'] } },
        );
      }
    }

    const model =
      stripQuotes(this.explicitModel ?? process.env.CLOUDFLARE_IMAGE_MODEL) ||
      CLOUDFLARE_IMAGE_DEFAULT_MODEL;
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
    const requestBody = buildCloudflareImageRequestBody({
      model,
      prompt: enhancedPrompt,
      aspectRatio,
    });

    let lastError: AppError | null = null;

    for (let attempt = 0; attempt <= this.maxTransientRetries; attempt += 1) {
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = new AppError(
          'PROVIDER_UNAVAILABLE',
          `Cloudflare Workers AI (${model}) request failed: ${err instanceof Error ? err.message : 'network error'}. Please retry shortly. No credits were charged.`,
          {
            details: { reason: ['cloudflare_network_error'], model: [model] },
            cause: err,
          },
        );
        if (attempt < this.maxTransientRetries) {
          await this.sleepFn(Math.min(3_000, 600 * Math.pow(2, attempt)));
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        let rawErr = '';
        try {
          rawErr = await res.text();
        } catch {
          // ignore
        }
        const conciseErr = extractCloudflareErrorMessage(rawErr);

        if (res.status === 429) {
          const retryDelayMs =
            parseGeminiRetryDelayMs(rawErr, res.headers?.get?.('retry-after')) ??
            Math.min(4_000, 800 * Math.pow(2, attempt));
          lastError = new AppError(
            'RATE_LIMITED',
            `Cloudflare Workers AI (${model}) returned HTTP 429${conciseErr ? `: ${conciseErr}` : ' (daily free Neuron quota or rate limit reached)'}. No credits were charged.`,
            {
              retryAfterSeconds: Math.max(1, Math.ceil(retryDelayMs / 1000)),
              details: {
                reason: ['cloudflare_rate_limited'],
                model: [model],
                upstreamStatus: ['429'],
              },
            },
          );
          if (attempt < this.maxTransientRetries) {
            await this.sleepFn(retryDelayMs);
            continue;
          }
          throw lastError;
        }

        if (res.status === 401 || res.status === 403) {
          throw new AppError(
            'FORBIDDEN',
            `Cloudflare Workers AI rejected the token or Account ID (HTTP ${res.status})${conciseErr ? `: ${conciseErr}` : ''}. Ensure your token has "Workers AI: Read" / "Workers AI: Edit" permission and CLOUDFLARE_ACCOUNT_ID matches your account. No credits were charged.`,
            {
              details: {
                reason: ['cloudflare_auth_error'],
                model: [model],
                upstreamStatus: [String(res.status)],
              },
            },
          );
        }

        lastError = new AppError(
          'PROVIDER_UNAVAILABLE',
          `Cloudflare Workers AI (${model}) failed with HTTP ${res.status}${conciseErr ? `: ${conciseErr}` : ''}. No credits were charged.`,
          {
            details: {
              reason: ['cloudflare_upstream_error'],
              model: [model],
              upstreamStatus: [String(res.status)],
            },
          },
        );
        if (res.status >= 500 && attempt < this.maxTransientRetries) {
          await this.sleepFn(Math.min(3_000, 600 * Math.pow(2, attempt)));
          continue;
        }
        throw lastError;
      }

      const contentType = res.headers?.get?.('content-type') ?? 'application/json';
      const bodyBytes = new Uint8Array(await res.arrayBuffer());
      const decoded = decodeCloudflareImageResponse({ contentType, bodyBytes });
      if (!decoded || decoded.data.byteLength <= 64) {
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          `Cloudflare Workers AI (${model}) returned an empty or unreadable image response. No credits were charged.`,
          { details: { reason: ['cloudflare_empty_image'], model: [model] } },
        );
      }

      return {
        mimeType: decoded.mimeType,
        data: decoded.data,
        caption,
        enhancedPrompt,
        aspectRatio,
        style,
        modelUsed: model,
        liveGenerated: true,
      };
    }

    throw (
      lastError ??
      new AppError(
        'PROVIDER_UNAVAILABLE',
        `Cloudflare Workers AI (${model}) could not generate an image. No credits were charged.`,
      )
    );
  }
}

function extractCloudflareErrorMessage(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as {
      readonly errors?: ReadonlyArray<{ readonly code?: number; readonly message?: string }>;
      readonly message?: string;
    };
    const firstMsg = parsed.errors?.[0]?.message ?? parsed.message ?? '';
    if (firstMsg) {
      return firstMsg.replace(/\s+/g, ' ').trim().slice(0, 180);
    }
  } catch {
    // Non-JSON response
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, 180);
}
