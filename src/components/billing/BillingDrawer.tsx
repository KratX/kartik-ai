import React, { useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  History,
  Lock,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type {
  PlatformCreditPlan,
  PlatformLedgerEntry,
} from '../../server/platform-api-runtime.js';

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
    readonly planName: string;
    readonly amountPaise: number;
    readonly amountInrLabel: string;
    readonly creditsGranted: number;
  }>;
  readonly onVerifyPayment: (orderId: string) => Promise<void>;
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
  const [pendingCheckoutOrder, setPendingCheckoutOrder] = useState<{
    readonly orderId: string;
    readonly planName: string;
    readonly amountPaise: number;
    readonly amountInrLabel: string;
    readonly creditsGranted: number;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleStartOrder = async (planId: string) => {
    setErrorMessage(null);
    setIsProcessing(true);
    try {
      const order = await onCreateOrder(planId);
      setPendingCheckoutOrder(order);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to create Razorpay order',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmRazorpayPayment = async () => {
    if (!pendingCheckoutOrder) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      await onVerifyPayment(pendingCheckoutOrder.orderId);
      setPendingCheckoutOrder(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Payment signature verification failed',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-end">
      <div className="max-w-xl w-full h-full bg-[#090d18] border-l border-slate-800 flex flex-col justify-between overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                Credits, Plans &amp; Razorpay Billing
              </h2>
              <p className="text-[11px] font-mono text-slate-400">
                Server-Priced Integer Paise · SELECT ... FOR UPDATE Ledger
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Current Balance Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/60 via-slate-900 to-indigo-950/60 border border-emerald-500/30 flex items-center justify-between">
            <div>
              <div className="text-xs font-mono uppercase text-emerald-300">
                Current Available Balance
              </div>
              <div className="text-2xl font-bold text-white font-mono flex items-center gap-2 mt-1">
                <Zap className="w-5 h-5 text-emerald-400" />
                {availableCredits} Credits
              </div>
            </div>
            <div className="text-right">
              <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono text-sky-300">
                Plan: {activePlanId}
              </span>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
              {errorMessage}
            </div>
          )}

          {/* Razorpay Interactive Test Checkout Modal (when order created) */}
          {pendingCheckoutOrder && (
            <div className="p-5 rounded-xl bg-indigo-950/40 border-2 border-indigo-500/50 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-400" />
                  <span className="text-sm font-bold text-white">
                    Razorpay Test Checkout — {pendingCheckoutOrder.planName}
                  </span>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                  TEST MODE
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono bg-slate-950/80 p-3.5 rounded-lg border border-slate-800">
                <div>
                  <div className="text-slate-500">Order ID</div>
                  <div className="text-slate-200 truncate">
                    {pendingCheckoutOrder.orderId}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Server-Priced Amount</div>
                  <div className="text-emerald-400 font-bold">
                    {pendingCheckoutOrder.amountInrLabel} ({pendingCheckoutOrder.amountPaise} paise)
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingCheckoutOrder(null)}
                  className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleConfirmRazorpayPayment}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Complete Payment &amp; Credit +{pendingCheckoutOrder.creditsGranted} cr
                </button>
              </div>
            </div>
          )}

          {/* Starter ₹199 & Pro ₹499 Upgrade Cards */}
          <div>
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold mb-3">
              Upgrade Plans (Browser Sends planId Only — Invariant #5)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {plans.map((plan) => (
                <div
                  key={plan.planId}
                  className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-sky-500/40 flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                        {plan.badge}
                      </span>
                      <span className="text-xs font-mono text-emerald-400 font-semibold">
                        +{plan.creditsGranted} cr
                      </span>
                    </div>
                    <h4 className="text-base font-bold text-white mt-2.5">
                      {plan.name}
                    </h4>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-2xl font-extrabold text-white">
                        {plan.amountInrLabel}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        ({plan.amountPaise} paise)
                      </span>
                    </div>

                    <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
                      {plan.features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    disabled={isProcessing || demoReadOnly}
                    onClick={() => handleStartOrder(plan.planId)}
                    className="w-full py-2.5 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Upgrade with Razorpay ({plan.amountInrLabel})
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Immutable Credit Ledger Table */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <History className="w-3.5 h-3.5 text-sky-400" />
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
                Immutable Credit Ledger ({ledger.length} entries)
              </h3>
            </div>
            <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/70">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-mono text-[11px]">
                    <th className="py-2 px-3">Operation / Event</th>
                    <th className="py-2 px-3 text-right">Delta</th>
                    <th className="py-2 px-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono">
                  {ledger.map((entry) => (
                    <tr key={entry.entryId} className="hover:bg-slate-900/40">
                      <td className="py-2 px-3 text-slate-200 font-sans">
                        <div>{entry.description}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {entry.requestId}
                        </div>
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-bold ${
                          entry.deltaCredits >= 0
                            ? 'text-emerald-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {entry.deltaCredits >= 0
                          ? `+${entry.deltaCredits}`
                          : entry.deltaCredits}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-200">
                        {entry.balanceAfter}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
