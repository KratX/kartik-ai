import { createPublicKey } from 'node:crypto';
import {
  loadConfig,
  ConfigValidationError,
  type ConfigSchema,
} from '@kartik/shared';

export const AGENT_CONFIG_SCHEMA: ConfigSchema = {
  NODE_ENV: {
    type: 'enum',
    enumValues: ['development', 'test', 'production'] as const,
    default: 'development',
  },
  PORT: {
    type: 'port',
    default: 4003,
  },
  DATABASE_URL: {
    type: 'url',
    required: true,
    secret: true,
  },
  REDIS_URL: {
    type: 'url',
    required: true,
    secret: true,
  },
  USER_CONTEXT_PUBLIC_KEY: {
    type: 'string',
    required: true,
    min: 32,
  },
  INTERNAL_CALLER_TOKEN_CHAT: {
    type: 'string',
    required: true,
    secret: true,
    min: 16,
  },
  MOCK_AI: {
    type: 'boolean',
    default: true,
  },
  IMAGE_PROVIDER: {
    type: 'enum',
    enumValues: ['mock', 'live'] as const,
    default: 'mock',
  },
  GEMINI_API_KEY: {
    type: 'string',
    required: false,
    secret: true,
    default: '',
  },
  TAVILY_API_KEY: {
    type: 'string',
    required: false,
    secret: true,
    default: '',
  },
  QDRANT_URL: {
    type: 'url',
    default: 'http://localhost:6333',
  },
  QDRANT_COLLECTION: {
    type: 'string',
    default: 'kartik_document_chunks',
  },
  ROUTER_MODEL_ID: {
    type: 'string',
    default: 'gemini-2.5-flash',
  },
  CHAT_MODEL_ID: {
    type: 'string',
    default: 'gemini-2.5-flash',
  },
  CODING_MODEL_ID: {
    type: 'string',
    default: 'gemini-2.5-pro',
  },
  EMBEDDING_MODEL_ID: {
    type: 'string',
    default: 'text-embedding-004',
  },
  MAX_PROMPT_CHARS: {
    type: 'int',
    default: 16_000,
    min: 1,
    max: 100_000,
  },
  MAX_OUTPUT_TOKENS: {
    type: 'int',
    default: 4_096,
    min: 1,
    max: 32_768,
  },
  MAX_ATTACHMENTS: {
    type: 'int',
    default: 5,
    min: 1,
    max: 20,
  },
  MAX_PDF_PAGES: {
    type: 'int',
    default: 25,
    min: 1,
    max: 100,
  },
  MAX_UPLOAD_BYTES: {
    type: 'int',
    default: 10 * 1024 * 1024,
    min: 1024,
    max: 50 * 1024 * 1024,
  },
  DAILY_LIVE_CALL_BUDGET: {
    type: 'int',
    default: 50,
    min: 1,
    max: 100_000,
  },
  SIGNED_URL_TTL_SECONDS: {
    type: 'int',
    default: 300,
    min: 30,
    max: 900,
  },
};

export interface AgentConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly userContextPublicKey: string;
  readonly internalCallerTokenChat: string;
  readonly mockAi: boolean;
  readonly imageProvider: 'mock' | 'live';
  readonly geminiApiKey?: string;
  readonly tavilyApiKey?: string;
  readonly qdrantUrl: string;
  readonly qdrantCollection: string;
  readonly routerModelId: string;
  readonly chatModelId: string;
  readonly codingModelId: string;
  readonly embeddingModelId: string;
  readonly maxPromptChars: number;
  readonly maxOutputTokens: number;
  readonly maxAttachments: number;
  readonly maxPdfPages: number;
  readonly maxUploadBytes: number;
  readonly dailyLiveCallBudget: number;
  readonly signedUrlTtlSeconds: number;
}

function normalizeEd25519PublicKeyPem(rawKey: string): string {
  const trimmed = rawKey.trim().replace(/\\n/g, '\n');
  if (trimmed.includes('-----BEGIN PUBLIC KEY-----')) {
    return trimmed;
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
    if (decoded.includes('-----BEGIN PUBLIC KEY-----')) {
      return decoded;
    }
  } catch {
    // Validated below via createPublicKey
  }
  return trimmed;
}

/**
 * Fail-fast environment loader for the Agent Service (@kartik/agent).
 *
 * Enforces Blueprint §6.2, §10, §12 & Invariant #19:
 * - MOCK_AI defaults to true and IMAGE_PROVIDER defaults to 'mock'.
 * - Live provider keys (GEMINI_API_KEY, TAVILY_API_KEY) are required only when MOCK_AI=false.
 */
export function loadAgentConfig(
  env: Record<string, string | undefined> = process.env,
): AgentConfig {
  const raw = loadConfig(AGENT_CONFIG_SCHEMA, env) as {
    NODE_ENV: 'development' | 'test' | 'production';
    PORT: number;
    DATABASE_URL: string;
    REDIS_URL: string;
    USER_CONTEXT_PUBLIC_KEY: string;
    INTERNAL_CALLER_TOKEN_CHAT: string;
    MOCK_AI: boolean;
    IMAGE_PROVIDER: 'mock' | 'live';
    GEMINI_API_KEY: string;
    TAVILY_API_KEY: string;
    QDRANT_URL: string;
    QDRANT_COLLECTION: string;
    ROUTER_MODEL_ID: string;
    CHAT_MODEL_ID: string;
    CODING_MODEL_ID: string;
    EMBEDDING_MODEL_ID: string;
    MAX_PROMPT_CHARS: number;
    MAX_OUTPUT_TOKENS: number;
    MAX_ATTACHMENTS: number;
    MAX_PDF_PAGES: number;
    MAX_UPLOAD_BYTES: number;
    DAILY_LIVE_CALL_BUDGET: number;
    SIGNED_URL_TTL_SECONDS: number;
  };

  const crossFieldErrors: Record<string, string> = {};
  const normalizedPublicKey = normalizeEd25519PublicKeyPem(raw.USER_CONTEXT_PUBLIC_KEY);

  try {
    const keyObj = createPublicKey(normalizedPublicKey);
    if (keyObj.type !== 'public' || keyObj.asymmetricKeyType !== 'ed25519') {
      crossFieldErrors.USER_CONTEXT_PUBLIC_KEY =
        'must be an Ed25519 public key in SPKI PEM format';
    }
  } catch {
    crossFieldErrors.USER_CONTEXT_PUBLIC_KEY =
      'invalid Ed25519 SPKI PEM public key format';
  }

  if (!raw.MOCK_AI) {
    if (!raw.GEMINI_API_KEY || raw.GEMINI_API_KEY.trim().length < 10) {
      crossFieldErrors.GEMINI_API_KEY = 'required when MOCK_AI=false';
    }
    if (!raw.TAVILY_API_KEY || raw.TAVILY_API_KEY.trim().length < 8) {
      crossFieldErrors.TAVILY_API_KEY = 'required when MOCK_AI=false';
    }
  }

  if (Object.keys(crossFieldErrors).length > 0) {
    throw new ConfigValidationError(crossFieldErrors);
  }

  return Object.freeze({
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    databaseUrl: raw.DATABASE_URL,
    redisUrl: raw.REDIS_URL,
    userContextPublicKey: normalizedPublicKey,
    internalCallerTokenChat: raw.INTERNAL_CALLER_TOKEN_CHAT,
    mockAi: raw.MOCK_AI,
    imageProvider: raw.IMAGE_PROVIDER,
    geminiApiKey: raw.GEMINI_API_KEY || undefined,
    tavilyApiKey: raw.TAVILY_API_KEY || undefined,
    qdrantUrl: raw.QDRANT_URL,
    qdrantCollection: raw.QDRANT_COLLECTION,
    routerModelId: raw.ROUTER_MODEL_ID,
    chatModelId: raw.CHAT_MODEL_ID,
    codingModelId: raw.CODING_MODEL_ID,
    embeddingModelId: raw.EMBEDDING_MODEL_ID,
    maxPromptChars: raw.MAX_PROMPT_CHARS,
    maxOutputTokens: raw.MAX_OUTPUT_TOKENS,
    maxAttachments: raw.MAX_ATTACHMENTS,
    maxPdfPages: raw.MAX_PDF_PAGES,
    maxUploadBytes: raw.MAX_UPLOAD_BYTES,
    dailyLiveCallBudget: raw.DAILY_LIVE_CALL_BUDGET,
    signedUrlTtlSeconds: raw.SIGNED_URL_TTL_SECONDS,
  });
}
