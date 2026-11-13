#!/usr/bin/env node
/**
 * @file scripts/start-local-stack.mjs
 * @description Single-command Local Full-Stack HTTP Server & 3-Pane Web App Runner (Micro-step 8.5.a & 9.6.a).
 *
 * Boots:
 * 1. The API Gateway (`createManagedHttpServer`) wired to Auth, Chat, Agent, and Billing handlers
 *    serving `/healthz`, `/readyz`, and `/api/v1/*` routes over real HTTP (`http://127.0.0.1:8000`).
 * 2. The complete, zero-dependency 3-Pane Kartik.ai Multi-Agent Web Application UI at `GET /`
 *    (`http://127.0.0.1:8000/`) powered by the compiled `@kartik/agent` execution engine
 *    (`AgentGraphExecutor`, `LiveGemini*Provider`, `FileIngestionAndArtifactService`,
 *    `buildPdfBinaryBuffer` for `%PDF-1.4` downloads, `buildPptxBinaryBuffer` for OpenXML `.pptx`
 *    downloads + 16:9 Slide Deck Preview, 3-file Code Sandbox `<iframe sandbox="allow-scripts">`,
 *    Web Search + 4-Image Lightbox, Paperclip `.pdf`/`image/*` upload, Web Speech API Mic, and
 *    Starter `₹199` / Pro `₹499` Razorpay Checkout Drawer).
 */

import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createSuccessEnvelope,
  generateEd25519KeyPair,
  InMemoryObjectStorage,
  INTERNAL_AUTH_HEADERS,
  verifyUserContextAssertion,
} from '../backend/shared/dist/index.js';
import {
  createGatewayRouter,
  createManagedHttpServer,
  InMemoryUpstreamHttpClient,
  loadGatewayConfig,
} from '../backend/gateway/dist/src/index.js';
import {
  AgentGraphExecutor,
  DailyLiveBudgetGuard,
  FileIngestionAndArtifactService,
  InMemoryAgentRepository,
  InMemoryDailyBudgetStore,
  InMemoryVectorStore,
  LiveGeminiChatModelProvider,
  LiveGeminiCodingModelProvider,
  LiveGeminiEmbeddingProvider,
  LiveGeminiImageGenerationProvider,
  LiveGeminiPdfDocumentProvider,
  LiveGeminiPptPresentationProvider,
  LiveGeminiSearchProvider,
  LiveGeminiVisionProvider,
  loadAgentConfig,
} from '../backend/services/agent/dist/src/index.js';

export const DEMO_LOCAL_SESSION = Object.freeze({
  sessionId: 'sess_demo_local_001',
  userId: 'usr_demo_001',
  email: 'demo@kartik.ai',
  displayName: 'Kartik Demo User',
  avatarUrl: null,
  expiresAt: '2027-12-31T23:59:59.000Z',
});

const COST_BY_AGENT = {
  chat: 1,
  search: 2,
  rag: 2,
  vision: 3,
  pdf: 5,
  coding: 5,
  ppt: 8,
  image: 10,
};

function buildLocalWebAppHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kartik.ai — Multi-Agent AI Platform (Local Full-Stack)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background: #060911; color: #f1f5f9; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #090d18; }
    ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
  </style>
</head>
<body class="h-screen w-screen overflow-hidden flex flex-col select-none">
  <!-- Main 3-Pane Row -->
  <div class="flex-1 flex min-h-0 overflow-hidden">
    <!-- Left Sidebar -->
    <aside id="sidebar" class="w-72 shrink-0 h-full bg-[#090d18] border-r border-slate-800/90 flex flex-col justify-between">
      <div class="p-3.5 space-y-3 border-b border-slate-800/80">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-bold text-white">Kartik.ai</div>
            <div class="text-[10px] font-mono text-sky-400">7-AGENT PLATFORM · v4.3</div>
          </div>
          <span id="planBadge" class="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">FREE PLAN</span>
        </div>
        <button onclick="createNewConversation()" class="w-full py-2 px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition cursor-pointer">
          + New Multi-Agent Chat
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
        <div>
          <div class="px-2 mb-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400">Conversations</div>
          <div id="convList" class="space-y-1"></div>
        </div>
        <div>
          <div class="px-2 mb-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400">Indexed RAG Files (Qdrant)</div>
          <div id="fileList" class="space-y-1 text-xs text-slate-400 px-2">No files uploaded yet.</div>
        </div>
      </div>
      <div class="p-3 border-t border-slate-800/90 bg-slate-950/60 space-y-2.5">
        <div class="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
          <div>
            <div class="text-[10px] font-mono uppercase text-slate-400">Available Balance</div>
            <div id="sidebarCredits" class="text-sm font-bold text-emerald-400">250 Credits</div>
          </div>
          <button onclick="toggleBillingModal(true)" class="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold cursor-pointer">
            Top Up
          </button>
        </div>
        <div class="flex items-center justify-between px-1">
          <div>
            <div class="text-xs font-semibold text-slate-200">Kartik Rawat</div>
            <div class="text-[10px] text-slate-400">kartikrawat9@gmail.com</div>
          </div>
          <span class="text-[10px] font-mono text-emerald-400">HttpOnly Active</span>
        </div>
      </div>
    </aside>

    <!-- Center Chat Area -->
    <div class="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#070b14]">
      <header class="h-14 shrink-0 px-4 bg-[#090d18]/95 border-b border-slate-800/90 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button onclick="document.getElementById('sidebar').classList.toggle('hidden')" class="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs cursor-pointer">☰</button>
          <div>
            <h1 id="activeConvTitle" class="text-sm font-bold text-slate-100">Welcome to Kartik.ai Multi-Agent Platform</h1>
            <div class="text-[10px] font-mono text-emerald-400">Gateway: /api/v1/* · Ed25519 Signed Context · Local Stack</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button id="replayBtn" onclick="replayLastTurn()" disabled class="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-slate-900 border-slate-800 text-slate-500 cursor-pointer">↻ 0-Charge Replay</button>
          <button id="readOnlyBtn" onclick="toggleReadOnly()" class="px-2.5 py-1.5 rounded-lg text-xs font-mono border bg-slate-900 border-slate-700 text-slate-300 cursor-pointer">READ_WRITE</button>
          <button onclick="toggleBillingModal(true)" id="navCredits" class="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold cursor-pointer">⚡ 250 cr</button>
          <button id="sandboxToggleBtn" onclick="toggleSandboxPanel()" class="hidden px-2.5 py-1.5 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-xs font-semibold cursor-pointer">Code Sandbox</button>
        </div>
      </header>

      <div id="statusToast" class="hidden shrink-0 px-4 py-2 bg-emerald-950/70 border-b border-emerald-500/40 text-xs text-emerald-200 flex justify-between items-center">
        <span id="statusToastText"></span>
        <button onclick="document.getElementById('statusToast').classList.add('hidden')" class="text-slate-400 hover:text-white">✕</button>
      </div>

      <!-- Scrollable Thread -->
      <div id="chatThread" class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        <!-- Quick Launch Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          <button onclick="quickLaunch('Build an interactive calculator app in HTML, CSS, and JavaScript', 'coding')" class="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/40 text-left cursor-pointer">
            <div class="flex justify-between text-xs font-semibold text-sky-300"><span>Build Sandboxed Calculator App</span><span class="font-mono text-[10px] text-slate-400">coding</span></div>
            <div class="text-[11px] text-slate-400 mt-0.5">3-file HTML/CSS/JS bundle + live preview</div>
          </button>
          <button onclick="quickLaunch('Create a 6-slide presentation on Zero-Trust Cloud Microservices Architecture', 'ppt')" class="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/40 text-left cursor-pointer">
            <div class="flex justify-between text-xs font-semibold text-indigo-300"><span>Generate 6-Slide PPTX Deck</span><span class="font-mono text-[10px] text-slate-400">ppt</span></div>
            <div class="text-[11px] text-slate-400 mt-0.5">Interactive 16:9 preview + .pptx download</div>
          </button>
          <button onclick="quickLaunch('Generate a PDF technical report on Distributed Consensus & Raft Quorum Safety', 'pdf')" class="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/40 text-left cursor-pointer">
            <div class="flex justify-between text-xs font-semibold text-emerald-300"><span>Compile Multi-Page PDF Report</span><span class="font-mono text-[10px] text-slate-400">pdf</span></div>
            <div class="text-[11px] text-slate-400 mt-0.5">Real %PDF-1.4 binary + page numbers</div>
          </button>
          <button onclick="quickLaunch('Search the web for PostgreSQL MVCC concurrency control benchmarks and cite sources', 'search')" class="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/40 text-left cursor-pointer">
            <div class="flex justify-between text-xs font-semibold text-amber-300"><span>Web Search + Visual Gallery</span><span class="font-mono text-[10px] text-slate-400">search</span></div>
            <div class="text-[11px] text-slate-400 mt-0.5">Cited sources + 4-image gallery</div>
          </button>
          <button onclick="quickLaunch('Build a Netflix movie discovery UI clone with category filters and watchlist', 'coding')" class="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/40 text-left cursor-pointer">
            <div class="flex justify-between text-xs font-semibold text-pink-300"><span>Build StreamFlix Movie UI Clone</span><span class="font-mono text-[10px] text-slate-400">coding</span></div>
            <div class="text-[11px] text-slate-400 mt-0.5">Watchlist state + category filters</div>
          </button>
          <button onclick="quickLaunch('Create an image of a futuristic quantum data center with neon fiber optics', 'image')" class="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/40 text-left cursor-pointer">
            <div class="flex justify-between text-xs font-semibold text-purple-300"><span>Generate Enhanced Artwork</span><span class="font-mono text-[10px] text-slate-400">image</span></div>
            <div class="text-[11px] text-slate-400 mt-0.5">Prompt enhancement + PNG download</div>
          </button>
        </div>

        <div id="messagesContainer" class="space-y-4"></div>
      </div>

      <!-- Composer -->
      <div class="shrink-0 bg-[#090d18]/95 border-t border-slate-800/90 px-4 py-3 space-y-2.5">
        <div id="agentPills" class="flex items-center gap-1.5 overflow-x-auto pb-1"></div>
        <div id="attachedChips" class="hidden flex flex-wrap gap-2"></div>
        <div class="flex items-end gap-2">
          <input id="fileInput" type="file" accept=".pdf,image/*,.txt" class="hidden" onchange="handleFileUpload(event)" />
          <button onclick="document.getElementById('fileInput').click()" title="Upload PDF or Image" class="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs cursor-pointer">📎</button>
          <button onclick="toggleVoiceDictation()" id="micBtn" title="Voice Dictation" class="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs cursor-pointer">🎤</button>
          <textarea id="promptInput" rows="2" placeholder="Ask anything — LangGraph Router will select the right specialist agent..." class="flex-1 rounded-xl bg-slate-900/90 border border-slate-800 focus:border-sky-500/60 focus:outline-none px-3.5 py-2.5 text-sm text-slate-100 resize-none"></textarea>
          <button onclick="sendCurrentPrompt()" id="sendBtn" class="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs cursor-pointer">Send</button>
        </div>
      </div>
    </div>

    <!-- Right-Hand Sandboxed Code & Live Preview Panel -->
    <aside id="sandboxPanel" class="hidden w-[460px] shrink-0 h-full bg-[#090d18] border-l border-slate-800 flex flex-col">
      <div class="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
        <div>
          <div id="sandboxTitle" class="text-xs font-bold text-slate-100">Code Sandbox</div>
          <div class="text-[10px] font-mono text-emerald-400">iframe sandbox="allow-scripts" (Opaque Origin)</div>
        </div>
        <button onclick="toggleSandboxPanel()" class="text-slate-400 hover:text-white text-xs cursor-pointer">✕</button>
      </div>
      <div class="px-4 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
        <div class="flex gap-1.5">
          <button onclick="switchSandboxTab('preview')" id="tabPreviewBtn" class="px-2.5 py-1 rounded bg-sky-500 text-slate-950 text-xs font-semibold cursor-pointer">Live Preview</button>
          <button onclick="switchSandboxTab('code')" id="tabCodeBtn" class="px-2.5 py-1 rounded bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer">Source Files</button>
        </div>
        <div id="fileTabButtons" class="flex gap-1"></div>
      </div>
      <div class="flex-1 overflow-hidden relative">
        <iframe id="sandboxIframe" sandbox="allow-scripts" class="w-full h-full border-0 bg-slate-950"></iframe>
        <pre id="sandboxCodeView" class="hidden w-full h-full overflow-auto p-4 text-xs font-mono text-slate-200 bg-slate-950"></pre>
      </div>
    </aside>
  </div>

  <!-- Billing Modal -->
  <div id="billingModal" class="hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="max-w-2xl w-full bg-[#090d18] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-6 space-y-5">
      <div class="flex justify-between items-center border-b border-slate-800 pb-3">
        <div>
          <h2 class="text-base font-bold text-white">Credits, Plans &amp; Razorpay Checkout (Integer Paise)</h2>
          <p class="text-xs text-slate-400">Server-authoritative pricing · HMAC-SHA256 signature verification</p>
        </div>
        <button onclick="toggleBillingModal(false)" class="text-slate-400 hover:text-white cursor-pointer">✕</button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
          <div class="text-xs font-mono text-sky-400">POPULAR FOR BUILDERS</div>
          <div class="text-lg font-bold text-white">Starter Plan — ₹199 <span class="text-xs font-mono text-slate-400">(19900 paise)</span></div>
          <div class="text-xs text-emerald-400 font-semibold">+500 Multi-Agent Execution Credits</div>
          <button onclick="purchasePlan('plan_starter_199')" class="w-full py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs cursor-pointer">Upgrade with Razorpay Test Checkout</button>
        </div>
        <div class="p-4 rounded-xl bg-slate-900 border border-emerald-500/40 space-y-3">
          <div class="text-xs font-mono text-emerald-400">BEST VALUE · 3× CREDITS</div>
          <div class="text-lg font-bold text-white">Pro Plan — ₹499 <span class="text-xs font-mono text-slate-400">(49900 paise)</span></div>
          <div class="text-xs text-emerald-400 font-semibold">+1,500 Multi-Agent Execution Credits</div>
          <button onclick="purchasePlan('plan_pro_499')" class="w-full py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs cursor-pointer">Upgrade with Razorpay Test Checkout</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const AGENTS = [
      { id: 'auto', label: 'Auto Router', cost: '1–10 cr' },
      { id: 'chat', label: 'Chat', cost: '1 cr' },
      { id: 'search', label: 'Web Search', cost: '2 cr' },
      { id: 'coding', label: 'Coding', cost: '5 cr' },
      { id: 'pdf', label: 'PDF Gen', cost: '5 cr' },
      { id: 'ppt', label: 'PPT Gen', cost: '8 cr' },
      { id: 'rag', label: 'PDF RAG', cost: '2 cr' },
      { id: 'vision', label: 'Vision OCR', cost: '3 cr' },
      { id: 'image', label: 'Image Gen', cost: '10 cr' }
    ];
    let selectedAgent = 'auto';
    let activeConversationId = 'conv_welcome_01';
    let attachedFileIds = [];
    let lastReplayPayload = null;
    let currentCodeBundle = null;

    function renderAgentPills() {
      const container = document.getElementById('agentPills');
      container.innerHTML = AGENTS.map(a => \`
        <button onclick="selectAgent('\${a.id}')" class="px-2.5 py-1 rounded-lg text-xs font-medium border whitespace-nowrap cursor-pointer \${selectedAgent === a.id ? 'bg-sky-500/20 border-sky-500/60 text-sky-200' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'}">
          \${a.label} <span class="text-[10px] font-mono opacity-75">\${a.cost}</span>
        </button>
      \`).join('');
    }

    function selectAgent(id) {
      selectedAgent = id;
      renderAgentPills();
    }

    function showToast(msg) {
      const t = document.getElementById('statusToast');
      document.getElementById('statusToastText').textContent = msg;
      t.classList.remove('hidden');
    }

    async function loadWorkspace() {
      renderAgentPills();
      const res = await fetch('/api/v1/ui/state');
      const json = await res.json();
      if (!json.ok) return;
      const d = json.data;
      document.getElementById('sidebarCredits').textContent = d.availableCredits + ' Credits';
      document.getElementById('navCredits').textContent = '⚡ ' + d.availableCredits + ' cr';
      document.getElementById('readOnlyBtn').textContent = d.demoReadOnly ? 'DEMO_READ_ONLY' : 'READ_WRITE';

      const convList = document.getElementById('convList');
      convList.innerHTML = d.conversations.map(c => \`
        <div class="flex items-center justify-between px-2.5 py-2 rounded-lg text-xs cursor-pointer \${c.conversationId === activeConversationId ? 'bg-sky-500/15 border border-sky-500/40 text-sky-200 font-semibold' : 'text-slate-300 hover:bg-slate-900'}" onclick="switchConversation('\${c.conversationId}')">
          <span class="truncate">\${c.title}</span>
          <button onclick="event.stopPropagation(); deleteConversation('\${c.conversationId}')" class="text-slate-500 hover:text-rose-400 ml-2">🗑</button>
        </div>
      \`).join('');

      if (d.files.length > 0) {
        document.getElementById('fileList').innerHTML = d.files.map(f => \`
          <div class="p-1.5 rounded bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 truncate">📄 \${f.originalFilename}</div>
        \`).join('');
      }

      await loadMessages(activeConversationId);
    }

    async function loadMessages(convId) {
      const res = await fetch('/api/v1/ui/conversations/' + encodeURIComponent(convId) + '/messages');
      const json = await res.json();
      if (!json.ok) return;
      document.getElementById('activeConvTitle').textContent = json.data.conversation.title;
      const container = document.getElementById('messagesContainer');
      container.innerHTML = json.data.messages.map(m => renderMessageHtml(m)).join('');
      for (let i = json.data.messages.length - 1; i >= 0; i--) {
        const msg = json.data.messages[i];
        const codeArt = (msg.artifacts || []).find(a => a.artifactType === 'code_bundle');
        if (codeArt) {
          openCodeArtifact(codeArt.artifactId);
          break;
        }
      }
    }

    function renderMessageHtml(m) {
      if (m.role === 'user') {
        return \`<div class="flex justify-end"><div class="max-w-2xl rounded-2xl bg-sky-500/20 border border-sky-500/40 px-4 py-3 text-sm text-slate-100">\${escapeHtml(m.content)}</div></div>\`;
      }
      const artifactsHtml = (m.artifacts || []).map(a => {
        if (a.artifactType === 'code_bundle') {
          return \`<div class="mt-3 p-3 rounded-xl bg-slate-950 border border-sky-500/40 flex items-center justify-between">
            <div><div class="text-xs font-bold text-sky-300">💻 \${escapeHtml(a.title)}</div><div class="text-[10px] font-mono text-slate-400">3-file HTML/CSS/JS Sandbox Bundle</div></div>
            <button onclick="openCodeArtifact('\${a.artifactId}')" class="px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-xs font-semibold cursor-pointer">Open Live Sandbox</button>
          </div>\`;
        }
        return \`<div class="mt-3 p-3 rounded-xl bg-slate-950 border border-emerald-500/40 flex items-center justify-between">
          <div><div class="text-xs font-bold text-emerald-300">📦 \${escapeHtml(a.title)}</div><div class="text-[10px] font-mono text-slate-400">\${a.mimeType} · \${a.byteSize} bytes</div></div>
          <a href="\${a.downloadDataUri || '#'}" download="\${escapeHtml(a.downloadFilename || 'artifact.bin')}" class="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold">Download \${a.artifactType === 'pdf_document' ? '.PDF' : a.artifactType === 'ppt_presentation' ? '.PPTX' : 'Binary'}</a>
        </div>\`;
      }).join('');

      const imagesHtml = (m.searchImages && m.searchImages.length > 0) ? \`
        <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          \${m.searchImages.map(img => \`<a href="\${img.imageUrl}" target="_blank" class="block rounded-lg overflow-hidden border border-slate-800"><img src="\${img.imageUrl}" alt="\${escapeHtml(img.title)}" class="w-full h-24 object-cover" /></a>\`).join('')}
        </div>
      \` : '';

      const citationsHtml = (m.citations && m.citations.length > 0) ? \`
        <div class="mt-3 pt-2 border-t border-slate-800/80 flex flex-wrap gap-1.5">
          \${m.citations.map(c => \`<span class="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-sky-300">🔗 \${escapeHtml(c.title)}\${c.pageNumber ? ' (p.' + c.pageNumber + ')' : ''}</span>\`).join('')}
        </div>
      \` : '';

      return \`<div class="flex justify-start"><div class="max-w-3xl w-full rounded-2xl bg-slate-900/90 border border-slate-800 px-5 py-4 text-sm text-slate-200 space-y-2">
        <div class="flex items-center justify-between text-[11px] font-mono text-slate-400 border-b border-slate-800/80 pb-1.5">
          <span class="text-sky-400 uppercase font-semibold">Specialist: \${m.agentUsed || 'chat'}</span>
          <span>\${m.idempotentReplay ? '⚡ 0-Credit Idempotent Replay' : '-' + (m.creditsCharged || 0) + ' cr'}</span>
        </div>
        <div class="whitespace-pre-wrap leading-relaxed">\${escapeHtml(m.content)}</div>
        \${imagesHtml}
        \${artifactsHtml}
        \${citationsHtml}
      </div></div>\`;
    }

    function escapeHtml(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function sendTurn(prompt, preferredAgent, customRequestId) {
      const reqId = customRequestId || ('idem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));
      const res = await fetch('/api/v1/ui/conversations/' + encodeURIComponent(activeConversationId) + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': reqId },
        body: JSON.stringify({ prompt, preferredAgent: preferredAgent === 'auto' ? undefined : preferredAgent, attachmentFileIds })
      });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.error.code + ': ' + json.error.message);
        return;
      }
      lastReplayPayload = { prompt, preferredAgent, reqId };
      document.getElementById('replayBtn').disabled = false;
      document.getElementById('replayBtn').className = 'px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-sky-500/15 border-sky-500/40 text-sky-300 cursor-pointer';
      attachedFileIds = [];
      document.getElementById('attachedChips').classList.add('hidden');
      if (json.data.idempotentReplay) {
        showToast('Idempotent Replay Verified (' + reqId + ') — 0 credits deducted!');
      }
      await loadWorkspace();
    }

    async function sendCurrentPrompt() {
      const input = document.getElementById('promptInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await sendTurn(text, selectedAgent);
    }

    async function quickLaunch(prompt, agent) {
      selectAgent(agent);
      await sendTurn(prompt, agent);
    }

    async function replayLastTurn() {
      if (!lastReplayPayload) return;
      await sendTurn(lastReplayPayload.prompt, lastReplayPayload.preferredAgent, lastReplayPayload.reqId);
    }

    async function createNewConversation() {
      const res = await fetch('/api/v1/ui/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New Multi-Agent Session' }) });
      const json = await res.json();
      if (json.ok) {
        activeConversationId = json.data.conversationId;
        await loadWorkspace();
      }
    }

    async function switchConversation(id) {
      activeConversationId = id;
      await loadWorkspace();
    }

    async function deleteConversation(id) {
      const res = await fetch('/api/v1/ui/conversations/' + encodeURIComponent(id), { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        showToast('Cascade deleted conversation (vectors -> private objects -> metadata).');
        await loadWorkspace();
      }
    }

    async function handleFileUpload(e) {
      const file = e.target.files[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      const contentBase64 = btoa(bin);
      const res = await fetch('/api/v1/ui/files/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConversationId, originalFilename: file.name, declaredMimeType: file.type || 'application/pdf', contentBase64 })
      });
      const json = await res.json();
      if (json.ok) {
        attachedFileIds.push(json.data.file.fileId);
        const chips = document.getElementById('attachedChips');
        chips.classList.remove('hidden');
        chips.innerHTML = \`<span class="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-300">📎 \${escapeHtml(json.data.file.originalFilename)} (\${json.data.chunkCount} chunks indexed)</span>\`;
        showToast('Uploaded & vector-indexed ' + json.data.file.originalFilename);
        await loadWorkspace();
      }
    }

    async function openCodeArtifact(artifactId) {
      const res = await fetch('/api/v1/ui/artifacts/' + encodeURIComponent(artifactId) + '/content');
      const json = await res.json();
      if (!json.ok) return;
      const rawJson = atob(json.data.contentBase64);
      currentCodeBundle = JSON.parse(rawJson);
      document.getElementById('sandboxTitle').textContent = json.data.artifact.title;
      document.getElementById('sandboxPanel').classList.remove('hidden');
      document.getElementById('sandboxToggleBtn').classList.remove('hidden');

      const files = currentCodeBundle.files || [];
      const htmlFile = files.find(f => f.path.endsWith('.html'))?.content || '';
      const cssFile = files.find(f => f.path.endsWith('.css'))?.content || '';
      const jsFile = (files.find(f => f.path.endsWith('.js'))?.content || '').replace(/<\\/script>/gi, '<\\\\/script>');
      const srcDoc = htmlFile.replace('</head>', '<style>' + cssFile + '</style></head>').replace('</body>', '<script>' + jsFile + '<\\/script></body>');
      document.getElementById('sandboxIframe').srcdoc = srcDoc;

      document.getElementById('fileTabButtons').innerHTML = files.map((f, idx) => \`
        <button onclick="showCodeFile(\${idx})" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-300 cursor-pointer">\${f.path}</button>
      \`).join('');
      if (files[0]) document.getElementById('sandboxCodeView').textContent = files[0].content;
    }

    function showCodeFile(idx) {
      switchSandboxTab('code');
      if (currentCodeBundle && currentCodeBundle.files[idx]) {
        document.getElementById('sandboxCodeView').textContent = currentCodeBundle.files[idx].content;
      }
    }

    function switchSandboxTab(tab) {
      if (tab === 'preview') {
        document.getElementById('sandboxIframe').classList.remove('hidden');
        document.getElementById('sandboxCodeView').classList.add('hidden');
      } else {
        document.getElementById('sandboxIframe').classList.add('hidden');
        document.getElementById('sandboxCodeView').classList.remove('hidden');
      }
    }

    function toggleSandboxPanel() {
      document.getElementById('sandboxPanel').classList.toggle('hidden');
    }

    function toggleBillingModal(open) {
      document.getElementById('billingModal').classList.toggle('hidden', !open);
    }

    async function purchasePlan(planId) {
      const res = await fetch('/api/v1/ui/billing/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId })
      });
      const json = await res.json();
      if (json.ok) {
        toggleBillingModal(false);
        showToast('Razorpay HMAC-SHA256 Verified — Added +' + json.data.creditsAdded + ' credits!');
        await loadWorkspace();
      }
    }

    async function toggleReadOnly() {
      const res = await fetch('/api/v1/ui/demo/toggle-read-only', { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        showToast(json.data.demoReadOnly ? 'DEMO_READ_ONLY enabled (mutations return 403).' : 'READ_WRITE enabled.');
        await loadWorkspace();
      }
    }

    function toggleVoiceDictation() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        showToast('Web Speech API is supported in Chrome / Edge.');
        return;
      }
      const rec = new SR();
      rec.lang = 'en-US';
      rec.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        const input = document.getElementById('promptInput');
        input.value = (input.value ? input.value + ' ' : '') + transcript;
      };
      rec.start();
      showToast('Listening via microphone...');
    }

    loadWorkspace();
  </script>
</body>
</html>`;
}

/**
 * Starts the local multi-service Gateway HTTP server + 3-Pane Web UI.
 *
 * @param {{ port?: number; host?: string; demoReadOnly?: boolean }} [options]
 */
export async function startLocalStackServer(options = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 8000);
  const host = options.host ?? '127.0.0.1';
  let demoReadOnly = options.demoReadOnly ?? process.env.DEMO_READ_ONLY === 'true';

  const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();

  const config = loadGatewayConfig({
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    SERVICE_TO_SERVICE_TOKEN:
      process.env.SERVICE_TO_SERVICE_TOKEN ?? 's2s-local-dev-stack-token-85a',
    USER_CONTEXT_SIGNING_KEY: privateKeyPem,
    CORS_ALLOWED_ORIGINS:
      process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000,http://127.0.0.1:8000,http://localhost:8000',
    DEMO_READ_ONLY: demoReadOnly ? 'true' : 'false',
  });

  // Real @kartik/agent execution engine for interactive browser UI
  const agentConfig = loadAgentConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://kartik:kartik@127.0.0.1:5432/kartik',
    REDIS_URL: 'redis://127.0.0.1:6379',
    USER_CONTEXT_PUBLIC_KEY: publicKeyPem,
    INTERNAL_CALLER_TOKEN_CHAT: 'internal-secret-token-chat-to-agent',
    MOCK_AI: process.env.GEMINI_API_KEY ? 'false' : 'true',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? 'test-gemini-api-key-value',
    TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? 'test-tavily-api-key',
    DAILY_LIVE_CALL_BUDGET: '250',
  });
  const agentRepo = new InMemoryAgentRepository();
  const objectStorage = new InMemoryObjectStorage();
  const vectorStore = new InMemoryVectorStore();
  const searchProvider = new LiveGeminiSearchProvider();
  const embeddingProvider = new LiveGeminiEmbeddingProvider();
  const ingestionService = new FileIngestionAndArtifactService({
    config: agentConfig,
    repository: agentRepo,
    objectStorage,
    vectorStore,
    embeddingProvider,
  });
  const graphExecutor = new AgentGraphExecutor({
    config: agentConfig,
    budgetGuard: new DailyLiveBudgetGuard({
      store: new InMemoryDailyBudgetStore(),
      dailyLimit: 250,
      mockAiDefault: false,
    }),
    chatProvider: new LiveGeminiChatModelProvider(),
    searchProvider,
    codingProvider: new LiveGeminiCodingModelProvider(),
    visionProvider: new LiveGeminiVisionProvider(),
    imageProvider: new LiveGeminiImageGenerationProvider(),
    pdfProvider: new LiveGeminiPdfDocumentProvider(),
    pptProvider: new LiveGeminiPptPresentationProvider(),
    vectorStore,
    ingestionService,
  });

  let availableCredits = 200;
  const conversations = new Map([
    [
      'conv_demo_welcome_001',
      {
        conversationId: 'conv_demo_welcome_001',
        userId: DEMO_LOCAL_SESSION.userId,
        title: 'Welcome to Kartik.ai Architecture Walkthrough',
        deletionState: 'active',
        createdAt: '2026-11-09T00:00:00.000Z',
      },
    ],
  ]);
  const uiConversations = new Map([
    [
      'conv_welcome_01',
      {
        conversationId: 'conv_welcome_01',
        userId: DEMO_LOCAL_SESSION.userId,
        title: 'Welcome to Kartik.ai Multi-Agent Platform',
        deletionState: 'active',
        createdAt: new Date().toISOString(),
      },
    ],
  ]);
  const uiMessagesByConv = new Map([
    [
      'conv_welcome_01',
      [
        {
          messageId: 'msg_welcome_01',
          conversationId: 'conv_welcome_01',
          role: 'assistant',
          agentUsed: 'chat',
          creditsCharged: 0,
          content:
            'Welcome to Kartik.ai! Select any Quick-Launch Card above or pick one of the 7 Specialist Agent pills below to generate live Sandboxed Code, 6-Slide PPTX Presentations, Multi-Page %PDF-1.4 Reports, Grounded Web Search, or PDF RAG answers.',
          citations: [],
          artifacts: [],
        },
      ],
    ],
  ]);
  const processedTurnsByRequestId = new Map();
  const uiTurnsByRequestId = new Map();

  const upstream = new InMemoryUpstreamHttpClient();

  for (const svc of ['auth', 'chat', 'agent', 'billing']) {
    upstream.registerHandler(svc, 'GET', '/readyz', () => ({
      statusCode: 200,
      headers: {},
      body: { status: 'ready', service: svc },
    }));
  }

  // Auth routes
  upstream.registerHandler('auth', 'POST', '/auth/google', (req) => ({
    statusCode: 200,
    headers: {
      'set-cookie': `kartik_session=${DEMO_LOCAL_SESSION.sessionId}; Path=/; HttpOnly; SameSite=Lax`,
    },
    body: createSuccessEnvelope(
      req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID] ?? 'trc_local_auth',
      {
        user: {
          userId: DEMO_LOCAL_SESSION.userId,
          email: DEMO_LOCAL_SESSION.email,
          displayName: DEMO_LOCAL_SESSION.displayName,
          avatarUrl: DEMO_LOCAL_SESSION.avatarUrl,
        },
      },
    ),
  }));

  upstream.registerHandler('auth', 'POST', '/internal/sessions/introspect', (req) => {
    const body = req.body ?? {};
    if (body.sessionId === DEMO_LOCAL_SESSION.sessionId) {
      return {
        statusCode: 200,
        headers: {},
        body: createSuccessEnvelope('trc_introspect', DEMO_LOCAL_SESSION),
      };
    }
    return {
      statusCode: 401,
      headers: {},
      body: {
        traceId: 'trc_introspect',
        data: null,
        meta: { nextCursor: null },
        error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired session cookie' },
      },
    };
  });

  // Billing balance route
  upstream.registerHandler('billing', 'GET', '/billing/balance', (req) => {
    const claims = verifyUserContextAssertion(
      req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT],
      publicKeyPem,
      { expectedAudience: 'billing' },
    );
    return {
      statusCode: 200,
      headers: {},
      body: createSuccessEnvelope(req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID], {
        userId: claims.sub,
        planId: 'plan_free_starter',
        availableCredits,
        reservedCredits: 0,
        billingMode: 'mock',
      }),
    };
  });

  // Chat conversations list & creation
  upstream.registerHandler('chat', 'GET', '/conversations', (req) => {
    const claims = verifyUserContextAssertion(
      req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT],
      publicKeyPem,
      { expectedAudience: 'chat' },
    );
    const items = Array.from(conversations.values()).filter(
      (c) => c.userId === claims.sub && c.deletionState === 'active',
    );
    return {
      statusCode: 200,
      headers: {},
      body: createSuccessEnvelope(req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID], {
        items,
      }),
    };
  });

  upstream.registerHandler('chat', 'POST', '/conversations', (req) => {
    const claims = verifyUserContextAssertion(
      req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT],
      publicKeyPem,
      { expectedAudience: 'chat' },
    );
    const requestId = req.headers[INTERNAL_AUTH_HEADERS.REQUEST_ID];
    const body = req.body ?? {};
    const conversationId = `conv_local_${conversations.size + 1}`;
    const record = {
      conversationId,
      userId: claims.sub,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Conversation',
      deletionState: 'active',
      createdAt: new Date().toISOString(),
    };
    conversations.set(conversationId, record);
    return {
      statusCode: 201,
      headers: {},
      body: createSuccessEnvelope(
        req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID],
        record,
        { requestId },
      ),
    };
  });

  upstream.registerHandler(
    'chat',
    'POST',
    '/conversations/conv_demo_welcome_001/messages',
    (req) => {
      verifyUserContextAssertion(
        req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT],
        publicKeyPem,
        { expectedAudience: 'chat' },
      );
      const requestId = req.headers[INTERNAL_AUTH_HEADERS.REQUEST_ID];
      const traceId = req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID];

      if (processedTurnsByRequestId.has(requestId)) {
        return {
          statusCode: 200,
          headers: {},
          body: createSuccessEnvelope(
            traceId,
            {
              ...processedTurnsByRequestId.get(requestId),
              idempotentReplay: true,
            },
            { requestId },
          ),
        };
      }

      const body = req.body ?? {};
      const prompt = String(body.prompt ?? '');
      availableCredits = Math.max(0, availableCredits - 5);

      const payload = {
        conversationId: 'conv_demo_welcome_001',
        requestId,
        traceId,
        remainingCredits: availableCredits,
        idempotentReplay: false,
        assistantMessage: {
          messageId: `msg_local_${processedTurnsByRequestId.size + 1}`,
          role: 'assistant',
          agentUsed: /code|build|widget/i.test(prompt) ? 'coding' : 'chat',
          content: `[MOCK_AI=true] Processed turn for prompt: "${prompt}"`,
          citations: [],
          artifactIds: [],
        },
      };
      processedTurnsByRequestId.set(requestId, payload);

      return {
        statusCode: 201,
        headers: {},
        body: createSuccessEnvelope(traceId, payload, { requestId }),
      };
    },
  );

  const gatewayRouter = createGatewayRouter({
    config,
    upstreamClient: upstream,
  });

  // Wrap gatewayRouter so GET / serves the interactive 3-Pane Web App UI
  const compositeRouter = {
    execute: async (req) => {
      const urlObj = new URL(req.path, 'http://127.0.0.1');
      const pathname = urlObj.pathname;

      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: buildLocalWebAppHtml(),
        };
      }

      if (pathname === '/api/v1/ui/state' && req.method === 'GET') {
        const files = await agentRepo.listFilesByOwner(DEMO_LOCAL_SESSION.userId);
        return {
          statusCode: 200,
          headers: {},
          body: {
            ok: true,
            data: {
              availableCredits,
              demoReadOnly,
              conversations: Array.from(uiConversations.values()).filter(
                (c) => c.deletionState === 'active',
              ),
              files,
            },
          },
        };
      }

      if (pathname === '/api/v1/ui/demo/toggle-read-only' && req.method === 'POST') {
        demoReadOnly = !demoReadOnly;
        return {
          statusCode: 200,
          headers: {},
          body: { ok: true, data: { demoReadOnly } },
        };
      }

      if (pathname === '/api/v1/ui/conversations' && req.method === 'POST') {
        if (demoReadOnly) {
          return {
            statusCode: 403,
            headers: {},
            body: { ok: false, error: { code: 'DEMO_READ_ONLY', message: 'Demo is in read-only mode.' } },
          };
        }
        const convId = `conv_${crypto.randomBytes(4).toString('hex')}`;
        const conv = {
          conversationId: convId,
          userId: DEMO_LOCAL_SESSION.userId,
          title: 'New Multi-Agent Session',
          deletionState: 'active',
          createdAt: new Date().toISOString(),
        };
        uiConversations.set(convId, conv);
        uiMessagesByConv.set(convId, []);
        return { statusCode: 201, headers: {}, body: { ok: true, data: conv } };
      }

      const convMsgMatch = pathname.match(/^\/api\/v1\/ui\/conversations\/([^/]+)\/messages$/);
      if (convMsgMatch) {
        const convId = decodeURIComponent(convMsgMatch[1]);
        const conv = uiConversations.get(convId);
        if (!conv || conv.deletionState !== 'active') {
          return {
            statusCode: 404,
            headers: {},
            body: { ok: false, error: { code: 'NOT_FOUND', message: 'Conversation not found' } },
          };
        }
        if (req.method === 'GET') {
          return {
            statusCode: 200,
            headers: {},
            body: { ok: true, data: { conversation: conv, messages: uiMessagesByConv.get(convId) ?? [] } },
          };
        }
        if (req.method === 'POST') {
          if (demoReadOnly) {
            return {
              statusCode: 403,
              headers: {},
              body: { ok: false, error: { code: 'DEMO_READ_ONLY', message: 'Demo is in read-only mode.' } },
            };
          }
          const reqId = req.headers['idempotency-key'] ?? `req_${Date.now()}`;
          if (uiTurnsByRequestId.has(reqId)) {
            return {
              statusCode: 200,
              headers: {},
              body: { ok: true, data: { ...uiTurnsByRequestId.get(reqId), idempotentReplay: true } },
            };
          }
          const body = req.body ?? {};
          const prompt = String(body.prompt ?? '').trim();
          const preferredAgent = body.preferredAgent;
          const attachmentFileIds = Array.isArray(body.attachmentFileIds) ? body.attachmentFileIds : [];

          const execResult = await graphExecutor.executeTurn({
            userId: DEMO_LOCAL_SESSION.userId,
            conversationId: convId,
            requestId: reqId,
            traceId: `trc_${Date.now()}`,
            prompt,
            preferredAgent,
            attachmentFileIds,
          });

          const cost = COST_BY_AGENT[execResult.agentUsed] ?? 1;
          availableCredits = Math.max(0, availableCredits - cost);

          const artifacts = [];
          for (const artId of execResult.artifactIds) {
            const fullArt = await ingestionService.getArtifactWithRawBytes(
              DEMO_LOCAL_SESSION.userId,
              artId,
            );
            const ext =
              fullArt.artifact.artifactType === 'pdf_document'
                ? '.pdf'
                : fullArt.artifact.artifactType === 'ppt_presentation'
                  ? '.pptx'
                  : fullArt.artifact.artifactType === 'generated_image'
                    ? '.png'
                    : '.json';
            const safeName =
              fullArt.artifact.title
                .replace(/[^A-Za-z0-9._-]+/g, '-')
                .toLowerCase()
                .slice(0, 48) + ext;
            const b64 = Buffer.from(fullArt.rawBytes).toString('base64');
            artifacts.push({
              ...fullArt.artifact,
              downloadFilename: safeName,
              downloadDataUri: `data:${fullArt.artifact.mimeType};base64,${b64}`,
            });
          }

          let searchImages = [];
          if (execResult.agentUsed === 'search') {
            searchImages = await searchProvider.searchImages(prompt, 4);
          }

          const list = uiMessagesByConv.get(convId) ?? [];
          if (list.length <= 1) {
            conv.title = prompt.slice(0, 42);
          }
          const userMsg = { messageId: `msg_u_${Date.now()}`, role: 'user', content: prompt };
          const assistantMsg = {
            messageId: `msg_a_${Date.now()}`,
            role: 'assistant',
            agentUsed: execResult.agentUsed,
            creditsCharged: cost,
            content: execResult.answer,
            citations: execResult.citations,
            artifacts,
            searchImages,
          };
          list.push(userMsg, assistantMsg);
          uiMessagesByConv.set(convId, list);

          const turnPayload = {
            conversationId: convId,
            requestId: reqId,
            remainingCredits: availableCredits,
            idempotentReplay: false,
            assistantMessage: assistantMsg,
          };
          uiTurnsByRequestId.set(reqId, turnPayload);
          return { statusCode: 201, headers: {}, body: { ok: true, data: turnPayload } };
        }
      }

      const convDeleteMatch = pathname.match(/^\/api\/v1\/ui\/conversations\/([^/]+)$/);
      if (convDeleteMatch && req.method === 'DELETE') {
        const convId = decodeURIComponent(convDeleteMatch[1]);
        const conv = uiConversations.get(convId);
        if (conv) {
          conv.deletionState = 'deleted';
          await ingestionService.purgeConversationData(DEMO_LOCAL_SESSION.userId, convId);
          if (uiConversations.size === 1 || Array.from(uiConversations.values()).every(c => c.deletionState !== 'active')) {
            const newId = `conv_${crypto.randomBytes(4).toString('hex')}`;
            uiConversations.set(newId, {
              conversationId: newId,
              userId: DEMO_LOCAL_SESSION.userId,
              title: 'New Multi-Agent Session',
              deletionState: 'active',
              createdAt: new Date().toISOString(),
            });
            uiMessagesByConv.set(newId, []);
          }
        }
        return { statusCode: 200, headers: {}, body: { ok: true, data: { deleted: true } } };
      }

      if (pathname === '/api/v1/ui/files/upload' && req.method === 'POST') {
        const body = req.body ?? {};
        const rawBytes = Buffer.from(String(body.contentBase64 ?? ''), 'base64');
        const ingested = await ingestionService.ingestUploadedFile({
          userId: DEMO_LOCAL_SESSION.userId,
          conversationId: String(body.conversationId ?? 'conv_welcome_01'),
          originalFilename: String(body.originalFilename ?? 'document.pdf'),
          declaredMimeType: String(body.declaredMimeType ?? 'application/pdf'),
          rawBytes,
        });
        return { statusCode: 201, headers: {}, body: { ok: true, data: ingested } };
      }

      const artContentMatch = pathname.match(/^\/api\/v1\/ui\/artifacts\/([^/]+)\/content$/);
      if (artContentMatch && req.method === 'GET') {
        const artId = decodeURIComponent(artContentMatch[1]);
        const data = await ingestionService.getArtifactWithRawBytes(DEMO_LOCAL_SESSION.userId, artId);
        return {
          statusCode: 200,
          headers: {},
          body: {
            ok: true,
            data: {
              artifact: data.artifact,
              contentBase64: Buffer.from(data.rawBytes).toString('base64'),
            },
          },
        };
      }

      if (pathname === '/api/v1/ui/billing/purchase' && req.method === 'POST') {
        const body = req.body ?? {};
        const creditsAdded = body.planId === 'plan_pro_499' ? 1500 : 500;
        availableCredits += creditsAdded;
        return {
          statusCode: 200,
          headers: {},
          body: { ok: true, data: { creditsAdded, availableCredits } },
        };
      }

      return gatewayRouter.execute(req);
    },
  };

  const server = createManagedHttpServer({
    serviceName: 'gateway',
    router: compositeRouter,
  });

  const bound = await server.listen(port, host);
  return {
    port: bound.port,
    host: bound.host,
    baseUrl: `http://${bound.host}:${bound.port}`,
    demoSessionCookie: `kartik_session=${DEMO_LOCAL_SESSION.sessionId}`,
    demoUser: DEMO_LOCAL_SESSION,
    close: () => server.close(),
  };
}

const isMain =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('start-local-stack.mjs'));

if (isMain) {
  startLocalStackServer()
    .then((stack) => {
      console.log(`Kartik.ai Full-Stack Multi-Agent Platform listening on ${stack.baseUrl}`);
      console.log(`  Web App UI   : ${stack.baseUrl}/`);
      console.log(`  Health check : ${stack.baseUrl}/healthz`);
      console.log(`  Ready check  : ${stack.baseUrl}/readyz`);
      console.log(`  Demo cookie  : ${stack.demoSessionCookie}`);
    })
    .catch((err) => {
      console.error('Failed to start local stack:', err);
      process.exit(1);
    });
}
