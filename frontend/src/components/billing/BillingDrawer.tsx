import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  CreditCard,
  Eye,
  FileSearch,
  FileText,
  Globe,
  History,
  Image as ImageIcon,
  Layers,
  Lock,
  Presentation,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type {
  PlatformCreditPlan,
  PlatformLedgerEntry,
  SpecialistAgentName,
} from '../../types/index.js';
import {
  computeCreditCapacity,
  filterCreditLedger,
  formatPlanDisplayName,
  formatPlanUnitPrice,
  summarizeCreditLedger,
  type CreditLedgerFilter,
} from '../workspace-ux-helpers.js';
import { BorderBeam, SpotlightCard } from '../motion/primitives.js';

export interface BillingDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly availableCredits: number;
  readonly activePlanId: string;
  readonly plans: readonly PlatformCreditPlan[];
  readonly ledger: readonly PlatformLedgerEntry[];
  readonly demoReadOnly: boolean;
  readonly onCreateOrder: (planId: string) => Promise<{
    readonly orderId: string;
    readonly razorpayKeyId?: string;
    readonly liveRazorpayOrder?: boolean;
    readonly planName: string;
    readonly amountPaise: number;
    readonly amountInrLabel: string;
    readonly creditsGranted: number;
  }>;
  readonly onVerifyPayment: (
    orderId: string,
    paymentDetails?: {
      readonly paymentId?: string;
      readonly signature?: string;
    },
  ) => Promise<void>;
}

interface RazorpayCheckoutResponse {
  readonly razorpay_order_id?: string;
  readonly razorpay_payment_id?: string;
  readonly razorpay_signature?: string;
}

interface RazorpayInstance {
  open: () => void;
}

interface WindowWithRazorpay {
  Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
}

type BillingTabId = 'overview' | 'ledger' | 'rates';

function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is unavailable'));
  }
  const win = window as unknown as WindowWithRazorpay;
  if (typeof win.Razorpay === 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Failed to load Razorpay Checkout SDK'));
    document.head.appendChild(script);
  });
}

function formatLedgerTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function getSpecialistRateIcon(agent: SpecialistAgentName) {
  switch (agent) {
    case 'chat':
      return <Sparkles className="w-3.5 h-3.5" />;
    case 'search':
      return <Globe className="w-3.5 h-3.5" />;
    case 'rag':
      return <FileSearch className="w-3.5 h-3.5" />;
    case 'vision':
      return <Eye className="w-3.5 h-3.5" />;
    case 'coding':
      return <Code2 className="w-3.5 h-3.5" />;
    case 'pdf':
      return <FileText className="w-3.5 h-3.5" />;
    case 'ppt':
      return <Presentation className="w-3.5 h-3.5" />;
    case 'image':
      return <ImageIcon className="w-3.5 h-3.5" />;
  }
}

export function BillingDrawer({
  isOpen,
  onClose,
  availableCredits,
  activePlanId,
  plans,
  ledger,
  demoReadOnly,
  onCreateOrder,
  onVerifyPayment,
}: BillingDrawerProps) {
  const [activeTab, setActiveTab] = useState<BillingTabId>('overview');
  const [ledgerFilter, setLedgerFilter] = useState<CreditLedgerFilter>('all');
  const [ledgerQuery, setLedgerQuery] = useState('');
  const [copiedRequestId, setCopiedRequestId] = useState<string | null>(null);
  const [pendingCheckoutOrder, setPendingCheckoutOrder] = useState<{
    readonly orderId: string;
    readonly razorpayKeyId?: string;
    readonly liveRazorpayOrder?: boolean;
    readonly planName: string;
    readonly amountPaise: number;
    readonly amountInrLabel: string;
    readonly creditsGranted: number;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const summary = useMemo(() => summarizeCreditLedger(ledger), [ledger]);
  const filteredLedger = useMemo(
    () => filterCreditLedger(ledger, ledgerFilter, ledgerQuery),
    [ledger, ledgerFilter, ledgerQuery],
  );
  const capacities = useMemo(
    () => computeCreditCapacity(availableCredits),
    [availableCredits],
  );

  const handleCopyRequestId = (requestId: string) => {
    const clip = navigator.clipboard?.writeText(requestId);
    if (clip && typeof clip.catch === 'function') clip.catch(() => {});
    setCopiedRequestId(requestId);
    window.setTimeout(() => {
      setCopiedRequestId((prev) => (prev === requestId ? null : prev));
    }, 1600);
  };

  const handleStartOrder = async (planId: string) => {
    setErrorMessage(null);
    setSuccessNotice(null);
    setIsProcessing(true);
    setProcessingPlanId(planId);
    try {
      const order = await onCreateOrder(planId);
      setPendingCheckoutOrder(order);

      if (
        order.liveRazorpayOrder &&
        order.razorpayKeyId &&
        order.razorpayKeyId !== 'rzp_test_kartik_ai_demo'
      ) {
        try {
          await loadRazorpayCheckoutScript();
          const win = window as unknown as WindowWithRazorpay;
          if (typeof win.Razorpay === 'function') {
            const rzp = new win.Razorpay({
              key: order.razorpayKeyId,
              amount: order.amountPaise,
              currency: 'INR',
              name: 'Kartik.ai',
              description: `${order.planName} (+${order.creditsGranted.toLocaleString()} Credits)`,
              order_id: order.orderId,
              theme: { color: '#09090b' },
              handler: (response: RazorpayCheckoutResponse) => {
                void (async () => {
                  setIsProcessing(true);
                  try {
                    await onVerifyPayment(
                      response.razorpay_order_id ?? order.orderId,
                      {
                        paymentId: response.razorpay_payment_id,
                        signature: response.razorpay_signature,
                      },
                    );
                    setPendingCheckoutOrder(null);
                    setSuccessNotice(
                      `+${order.creditsGranted.toLocaleString()} credits added to your workspace balance.`,
                    );
                  } catch (verifyErr) {
                    setErrorMessage(
                      verifyErr instanceof Error
                        ? verifyErr.message
                        : 'Payment verification failed',
                    );
                  } finally {
                    setIsProcessing(false);
                  }
                })();
              },
            });
            rzp.open();
          }
        } catch {
          // Keep interactive checkout card open if popup script is blocked
        }
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to create Razorpay order',
      );
    } finally {
      setIsProcessing(false);
      setProcessingPlanId(null);
    }
  };

  const handleConfirmRazorpayPayment = async () => {
    if (!pendingCheckoutOrder) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessNotice(null);
    try {
      const granted = pendingCheckoutOrder.creditsGranted;
      await onVerifyPayment(pendingCheckoutOrder.orderId);
      setPendingCheckoutOrder(null);
      setSuccessNotice(
        `Payment verified · +${granted.toLocaleString()} credits added to your workspace balance.`,
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Payment signature verification failed',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const tierLabel = formatPlanDisplayName(activePlanId);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="dialog"
          aria-modal="true"
          aria-label="Credits & Billing"
          data-billing-drawer="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex justify-end"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: 48, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 48, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            className="max-w-2xl w-full h-full bg-[#09090b] border-l border-white/[0.09] flex flex-col overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.9)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky Header + Spring Segmented Navigation */}
            <div className="shrink-0 bg-[#0c0c0f] border-b border-white/[0.08]">
              <div className="px-5 sm:px-6 pt-5 pb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white/[0.07] border border-white/[0.1] flex items-center justify-center text-white shrink-0">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold tracking-tight text-white truncate">
                      Credits &amp; Billing
                    </h2>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">
                      {tierLabel} · Razorpay verified top-ups &amp; usage ledger
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  aria-label="Close billing drawer"
                  data-close-billing="true"
                  onClick={onClose}
                  className="p-2 rounded-lg bg-[#16161b] hover:bg-white/[0.12] text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 21st.dev Spring Segmented Tab Strip */}
              <div className="px-5 sm:px-6 pb-3.5">
                <div
                  role="tablist"
                  aria-label="Billing sections"
                  className="inline-flex w-full sm:w-auto items-center p-1 rounded-xl bg-[#141418] border border-white/[0.07]"
                >
                  {(
                    [
                      {
                        id: 'overview',
                        label: 'Overview & Plans',
                        mobileLabel: 'Overview',
                        icon: Sparkles,
                      },
                      {
                        id: 'ledger',
                        label: `Ledger (${ledger.length})`,
                        mobileLabel: `Ledger (${ledger.length})`,
                        icon: History,
                      },
                      {
                        id: 'rates',
                        label: 'Rate Card',
                        mobileLabel: 'Rates',
                        icon: Layers,
                      },
                    ] as const
                  ).map((tab) => {
                    const active = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-billing-tab={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className="group relative isolate flex-1 sm:flex-initial inline-flex items-center justify-center px-2.5 sm:px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap cursor-pointer"
                      >
                        {active && (
                          <motion.span
                            layoutId="billing-drawer-active-tab"
                            transition={{
                              type: 'spring',
                              stiffness: 520,
                              damping: 38,
                            }}
                            className="absolute inset-0 z-0 rounded-lg bg-white shadow-sm"
                          />
                        )}
                        <span
                          className={`relative z-10 inline-flex items-center gap-1.5 ${
                            active
                              ? 'text-[#09090b] font-semibold'
                              : 'text-zinc-400 group-hover:text-zinc-100'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="sm:hidden">{tab.mobileLabel}</span>
                          <span className="hidden sm:inline">{tab.label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Scrollable Stage */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-6 space-y-6">
              {/* Persistent Alerts */}
              {demoReadOnly && (
                <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between gap-3">
                  <span>
                    <strong className="font-semibold">Read-Only Freeze:</strong>{' '}
                    New checkout orders are paused while <code className="font-mono">DEMO_READ_ONLY</code> is active.
                  </span>
                </div>
              )}

              {errorMessage && (
                <div className="px-4 py-3 rounded-xl bg-rose-500/12 border border-rose-500/30 text-xs text-rose-200 flex items-center justify-between gap-3">
                  <span>{errorMessage}</span>
                  <button
                    type="button"
                    aria-label="Dismiss error"
                    onClick={() => setErrorMessage(null)}
                    className="p-0.5 text-rose-300 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {successNotice && (
                <div
                  data-billing-success="true"
                  className="px-4 py-3 rounded-xl bg-emerald-500/12 border border-emerald-500/30 text-xs text-emerald-200 flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{successNotice}</span>
                  </span>
                  <button
                    type="button"
                    aria-label="Dismiss notice"
                    onClick={() => setSuccessNotice(null)}
                    className="p-0.5 text-emerald-300 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* ── TAB 1: OVERVIEW & PLANS ── */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* 21st.dev BorderBeam Hero Balance Card */}
                  <div
                    data-billing-hero-balance="true"
                    className="relative rounded-2xl bg-[#111114] border border-white/[0.1] overflow-hidden"
                  >
                    <BorderBeam
                      durationSec={8}
                      intensity={isProcessing ? 'thinking' : 'idle'}
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 kartik-hero-dot-grid opacity-30"
                    />

                    <div className="relative z-10 p-5 sm:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="text-xs text-zinc-400 flex items-center gap-2">
                            <span>Available Workspace Balance</span>
                            <span aria-hidden="true" className="text-zinc-600">
                              ·
                            </span>
                            <span className="text-zinc-300 font-medium">
                              {tierLabel}
                            </span>
                          </div>
                          <div className="mt-2 flex items-baseline gap-2.5">
                            <span className="inline-flex items-center gap-2 text-3xl sm:text-4xl font-semibold tracking-tight text-white font-mono tabular-nums">
                              <Zap className="w-6 h-6 text-emerald-400 shrink-0" />
                              {availableCredits.toLocaleString()}
                            </span>
                            <span className="text-sm text-zinc-400">
                              credits remaining
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setActiveTab('rates')}
                          className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-zinc-200 hover:text-white transition-colors whitespace-nowrap cursor-pointer"
                        >
                          View Rate Card
                        </button>
                      </div>

                      {/* Clean 3-Column Unboxed Metric Strip */}
                      <div className="mt-5 pt-4 border-t border-white/[0.07] grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-[11px] text-zinc-500">
                            Total Credited
                          </div>
                          <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-emerald-400">
                            +{summary.totalAdded.toLocaleString()} cr
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-zinc-500">
                            Total Used
                          </div>
                          <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-zinc-200">
                            {summary.totalSpent > 0
                              ? `-${summary.totalSpent.toLocaleString()} cr`
                              : '0 cr'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-zinc-500">
                            Ledger Events
                          </div>
                          <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-zinc-200">
                            {summary.totalEntries}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Razorpay Checkout Verification Panel */}
                  <AnimatePresence>
                    {pendingCheckoutOrder && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.99 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.99 }}
                        transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                        data-billing-checkout-card="true"
                        className="relative rounded-2xl bg-[#141418] border border-white/20 overflow-hidden"
                      >
                        <BorderBeam durationSec={5} intensity="focus" />
                        <div className="relative z-10 p-5 space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span className="text-sm font-semibold text-white">
                                Complete Checkout — {pendingCheckoutOrder.planName}
                              </span>
                            </div>
                            <span className="text-[11px] font-mono text-zinc-400">
                              Razorpay HMAC-SHA256 Verified
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-white/[0.07] text-xs">
                            <div>
                              <div className="text-[11px] text-zinc-500">
                                Order Reference
                              </div>
                              <div className="font-mono text-zinc-200 truncate mt-0.5">
                                {pendingCheckoutOrder.orderId}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-zinc-500">
                                Server-Priced Total
                              </div>
                              <div className="font-mono tabular-nums text-white font-semibold mt-0.5">
                                {pendingCheckoutOrder.amountInrLabel}{' '}
                                <span className="text-zinc-500 font-normal">
                                  ({pendingCheckoutOrder.amountPaise} paise)
                                </span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-zinc-500">
                                Credits Granted
                              </div>
                              <div className="font-mono tabular-nums text-emerald-400 font-semibold mt-0.5">
                                +{pendingCheckoutOrder.creditsGranted.toLocaleString()} cr
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setPendingCheckoutOrder(null)}
                              className="px-3.5 py-2 rounded-lg bg-[#1d1d22] hover:bg-white/[0.1] text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isProcessing}
                              data-billing-confirm-payment="true"
                              onClick={() => void handleConfirmRazorpayPayment()}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 disabled:opacity-50 text-zinc-950 text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>
                                Complete Payment &amp; Credit +
                                {pendingCheckoutOrder.creditsGranted.toLocaleString()} cr
                              </span>
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Credit Top-Up Packs (21st.dev SpotlightCards) */}
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white">
                        Credit Top-Up Packs
                      </h3>
                      <span className="text-xs text-zinc-500">
                        One-time packs · never expire
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
                      {plans.map((plan) => {
                        const isFeatured = plan.planId === 'plan_pro_499';
                        const isThisPlanPending = processingPlanId === plan.planId;
                        const unitPrice = formatPlanUnitPrice(
                          plan.amountPaise,
                          plan.creditsGranted,
                        );

                        return (
                          <SpotlightCard
                            key={plan.planId}
                            active={isFeatured}
                            className="h-full"
                          >
                            {isFeatured && (
                              <BorderBeam durationSec={9} intensity="idle" />
                            )}
                            <div
                              data-billing-plan-card={plan.planId}
                              className="relative z-10 p-5 h-full flex flex-col justify-between gap-5"
                            >
                              <div>
                                {/* Clean Unboxed Metadata Kicker (Zero-Pill Discipline) */}
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="text-zinc-400 font-medium">
                                    {isFeatured
                                      ? 'Best Value · 3× Credits'
                                      : 'For Everyday Builders'}
                                  </span>
                                  <span className="font-mono tabular-nums text-emerald-400 font-semibold">
                                    +{plan.creditsGranted.toLocaleString()} cr
                                  </span>
                                </div>

                                <h4 className="text-lg font-semibold tracking-tight text-white mt-2">
                                  {plan.name}
                                </h4>

                                <div className="mt-2 flex items-baseline gap-2">
                                  <span className="text-3xl font-semibold tracking-tight text-white font-mono tabular-nums">
                                    {plan.amountInrLabel}
                                  </span>
                                  <span className="text-xs font-mono tabular-nums text-zinc-500">
                                    {unitPrice}
                                  </span>
                                </div>

                                <ul className="mt-4 pt-4 border-t border-white/[0.07] space-y-2.5 text-xs text-zinc-300">
                                  {plan.features.map((feat, idx) => (
                                    <li
                                      key={idx}
                                      className="flex items-start gap-2 leading-relaxed"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                      <span>{feat}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <button
                                type="button"
                                disabled={isProcessing || demoReadOnly}
                                data-billing-buy-plan={plan.planId}
                                onClick={() => void handleStartOrder(plan.planId)}
                                className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                  isFeatured
                                    ? 'bg-white hover:bg-zinc-200 text-zinc-950'
                                    : 'bg-[#1c1c22] hover:bg-white hover:text-zinc-950 text-zinc-100 border border-white/[0.1]'
                                }`}
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>
                                  {isThisPlanPending
                                    ? 'Creating Order…'
                                    : `Upgrade to ${plan.name} (${plan.amountInrLabel})`}
                                </span>
                              </button>
                            </div>
                          </SpotlightCard>
                        );
                      })}
                    </div>
                  </div>

                  {/* Recent Activity Preview Footer Link */}
                  <div className="pt-2 border-t border-white/[0.07] flex items-center justify-between gap-3 text-xs">
                    <span className="text-zinc-400">
                      Every credit grant &amp; agent charge is recorded in your immutable audit ledger.
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('ledger')}
                      className="text-white hover:underline underline-offset-4 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Inspect Ledger →
                    </button>
                  </div>
                </div>
              )}

              {/* ── TAB 2: IMMUTABLE CREDIT LEDGER ── */}
              {activeTab === 'ledger' && (
                <div className="space-y-4">
                  {/* Filter Segmented Control + Search Input */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div
                      role="group"
                      aria-label="Filter ledger entries"
                      className="inline-flex items-center p-0.5 rounded-lg bg-[#141418] border border-white/[0.07] self-start"
                    >
                      {(
                        [
                          { id: 'all', label: `All (${summary.totalEntries})` },
                          { id: 'credits', label: `Top-Ups (${summary.topUpCount})` },
                          { id: 'debits', label: `Usage (${summary.usageCount})` },
                        ] as const
                      ).map((opt) => {
                        const active = ledgerFilter === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            data-ledger-filter={opt.id}
                            aria-pressed={active}
                            onClick={() => setLedgerFilter(opt.id)}
                            className="group relative isolate px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer"
                          >
                            {active && (
                              <motion.span
                                layoutId="billing-ledger-filter-pill"
                                transition={{
                                  type: 'spring',
                                  stiffness: 520,
                                  damping: 38,
                                }}
                                className="absolute inset-0 z-0 rounded-md bg-white"
                              />
                            )}
                            <span
                              className={`relative z-10 ${
                                active
                                  ? 'text-[#09090b] font-semibold'
                                  : 'text-zinc-400 group-hover:text-zinc-100'
                              }`}
                            >
                              {opt.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="relative sm:w-60">
                      <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={ledgerQuery}
                        onChange={(e) => setLedgerQuery(e.target.value)}
                        placeholder="Search event or request ID…"
                        data-ledger-search="true"
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#141418] border border-white/[0.08] rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/25 transition-colors"
                      />
                    </div>
                  </div>

                  {/* High-Density Tabular Ledger */}
                  <div className="rounded-xl border border-white/[0.08] overflow-hidden bg-[#111114]">
                    {filteredLedger.length === 0 ? (
                      <div className="px-4 py-10 text-center space-y-2">
                        <div className="text-xs font-medium text-zinc-300">
                          No matching ledger entries
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {ledger.length === 0
                            ? 'Run any specialist or purchase a credit pack to populate your audit log.'
                            : 'Try clearing your search or switching the event filter.'}
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-[#15151a] border-b border-white/[0.07] text-zinc-400 text-[11px] font-medium">
                              <th className="py-2.5 px-3.5">Event</th>
                              <th className="py-2.5 px-3 text-right whitespace-nowrap">
                                Change
                              </th>
                              <th className="py-2.5 px-3.5 text-right whitespace-nowrap">
                                Balance
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.06]">
                            {filteredLedger.map((entry) => {
                              const isCredit = entry.deltaCredits >= 0;
                              const isCopied = copiedRequestId === entry.requestId;
                              return (
                                <tr
                                  key={entry.entryId}
                                  data-ledger-row={entry.entryId}
                                  className="hover:bg-white/[0.025] transition-colors"
                                >
                                  <td className="py-2.5 px-3.5 min-w-0">
                                    <div className="text-zinc-100 font-medium leading-snug">
                                      {entry.description}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-zinc-500">
                                      {entry.timestamp && (
                                        <span>
                                          {formatLedgerTimestamp(entry.timestamp)}
                                        </span>
                                      )}
                                      <span aria-hidden="true">·</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleCopyRequestId(entry.requestId)
                                        }
                                        title="Copy Idempotency Request ID"
                                        className="inline-flex items-center gap-1 hover:text-zinc-200 transition-colors cursor-pointer"
                                      >
                                        <span className="truncate max-w-[160px]">
                                          {entry.requestId}
                                        </span>
                                        {isCopied ? (
                                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                                        ) : (
                                          <Copy className="w-2.5 h-2.5 opacity-60" />
                                        )}
                                      </button>
                                    </div>
                                  </td>
                                  <td
                                    className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                      isCredit
                                        ? 'text-emerald-400'
                                        : 'text-zinc-300'
                                    }`}
                                  >
                                    <span className="inline-flex items-center justify-end gap-1">
                                      {isCredit ? (
                                        <ArrowDownLeft className="w-3 h-3 text-emerald-400" />
                                      ) : (
                                        <ArrowUpRight className="w-3 h-3 text-zinc-500" />
                                      )}
                                      {isCredit
                                        ? `+${entry.deltaCredits}`
                                        : entry.deltaCredits}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-zinc-200 whitespace-nowrap">
                                    {entry.balanceAfter.toLocaleString()} cr
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── TAB 3: SPECIALIST RATE CARD & CAPACITY ESTIMATOR ── */}
              {activeTab === 'rates' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Specialist Execution Rates
                      </h3>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Transparent per-turn pricing with automatic 0-credit idempotent replay protection.
                      </p>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-emerald-400">
                      {availableCredits.toLocaleString()} cr available
                    </span>
                  </div>

                  <div
                    data-billing-rate-card="true"
                    className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                  >
                    {capacities.map((row) => (
                      <div
                        key={row.id}
                        data-rate-agent={row.id}
                        className="p-3.5 rounded-xl bg-[#111114] border border-white/[0.08] flex items-start justify-between gap-3"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-zinc-200 shrink-0 mt-0.5">
                            {getSpecialistRateIcon(row.id)}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-100">
                              {row.label}
                            </div>
                            <div className="text-[11px] text-zinc-400 leading-snug mt-0.5">
                              {row.summary}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-zinc-500 mt-1.5">
                              Up to{' '}
                              <span className="text-zinc-200 font-medium">
                                {row.estimatedRuns.toLocaleString()}
                              </span>{' '}
                              runs available
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono font-semibold tabular-nums text-white">
                            {row.costCredits} cr
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-4 rounded-xl bg-[#111114] border border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-zinc-400">
                      Need more execution headroom for builds, decks, or artwork?
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('overview')}
                      className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      View Credit Packs
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
