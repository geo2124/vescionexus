import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bug, Check, Copy, Send, Trash2, X } from 'lucide-react';
import {
  DiagnosticErrorEntry,
  clearDiagnostics,
  getDiagnosticUserContext,
  triggerSentryTestError,
} from '../lib/sentry';
import { toast } from 'sonner';

export const DevDiagnosticsPill: React.FC = () => {
  const [errors, setErrors] = useState<DiagnosticErrorEntry[]>(() =>
    typeof window !== 'undefined' && Array.isArray(window.__APP_DIAGNOSTICS__)
      ? [...window.__APP_DIAGNOSTICS__]
      : []
  );
  const [isOpen, setIsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    const syncDiagnostics = () => {
      if (typeof window !== 'undefined' && Array.isArray(window.__APP_DIAGNOSTICS__)) {
        setErrors([...window.__APP_DIAGNOSTICS__]);
      }
    };

    window.addEventListener('vescio-diagnostics-updated', syncDiagnostics);
    return () => {
      window.removeEventListener('vescio-diagnostics-updated', syncDiagnostics);
    };
  }, []);

  const handleCopyPayload = async (entry?: DiagnosticErrorEntry) => {
    const payload = entry
      ? {
          message: entry.message,
          stack: entry.stack || null,
          code: entry.code || null,
          source: entry.source,
          isFirestoreError: entry.isFirestoreError,
          userState: entry.userState,
          timestamp: entry.timestamp,
          extra: entry.extra || {},
        }
      : {
          timestamp: new Date().toISOString(),
          userState: getDiagnosticUserContext(),
          diagnosticsCount: errors.length,
          errors: errors.map((e) => ({
            message: e.message,
            stack: e.stack || null,
            code: e.code || null,
            source: e.source,
            isFirestoreError: e.isFirestoreError,
            userState: e.userState,
            timestamp: e.timestamp,
            extra: e.extra || {},
          })),
        };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      const targetId = entry ? entry.id : 'all';
      setCopiedId(targetId);
      toast.success('AI Fix Payload copied to clipboard');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy payload to clipboard');
    }
  };

  const handleSendTestError = () => {
    triggerSentryTestError();
    setTestSent(true);
    toast.success('Test exception sent to Sentry ("Vescio Nexus Sentry Connection Verified")');
    setTimeout(() => setTestSent(false), 3000);
  };

  const hasErrors = errors.length > 0;

  return (
    <>
      {/* Bottom-left Floating Dev Diagnostics Badge */}
      <div className="fixed bottom-4 left-4 z-[9990] flex items-center gap-2">
        {hasErrors ? (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-950/50 border border-rose-400/40 transition-all cursor-pointer"
            title="Open Dev Diagnostics"
          >
            <AlertTriangle size={13} className="shrink-0" />
            <span>Diagnostics</span>
            <span className="px-1.5 py-0.5 rounded-full bg-white text-rose-700 text-[10px] font-black leading-none">
              {errors.length}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0B0F17]/80 hover:bg-[#0B0F17] text-zinc-400 hover:text-zinc-200 text-[10px] font-semibold border border-zinc-800/80 backdrop-blur-md transition-all opacity-60 hover:opacity-100 cursor-pointer"
            title="Sentry & Dev Diagnostics"
          >
            <Bug size={11} className="text-[#00B8C8]" />
            <span>Sentry</span>
          </button>
        )}
      </div>

      {/* Diagnostics Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-[#0B0F17] border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#05070A]">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${hasErrors ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-[#00B8C8]/10 border-[#00B8C8]/30 text-[#00B8C8]'}`}>
                  <Bug size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight flex items-center gap-2">
                    Dev Diagnostics & Sentry Telemetry
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${hasErrors ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'}`}>
                      {errors.length} / 10 Buffered
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Captures unhandled rejections, runtime exceptions, and Firestore permission/payload errors
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Action Toolbar */}
            <div className="px-5 py-3 bg-[#101622] border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyPayload(errors[0])}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-bold text-xs transition-all cursor-pointer"
                >
                  {copiedId ? <Check size={13} /> : <Copy size={13} />}
                  <span>Copy AI Fix Payload</span>
                </button>

                <button
                  type="button"
                  onClick={handleSendTestError}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 font-semibold text-xs transition-all cursor-pointer"
                >
                  {testSent ? <Check size={13} className="text-emerald-400" /> : <Send size={13} className="text-[#00B8C8]" />}
                  <span>Send Test Error to Sentry</span>
                </button>
              </div>

              {hasErrors && (
                <button
                  type="button"
                  onClick={() => {
                    clearDiagnostics();
                    toast.success('Diagnostics buffer cleared');
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 text-xs font-semibold transition-all cursor-pointer"
                >
                  <Trash2 size={13} />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {/* Error List */}
            <div className="p-5 overflow-y-auto space-y-3 flex-1">
              {!hasErrors ? (
                <div className="py-10 text-center space-y-2">
                  <div className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                    0 Errors Recorded in Current Session
                  </div>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto">
                    Click <span className="text-zinc-200 font-semibold">"Send Test Error to Sentry"</span> above to dispatch a test exception (<code className="text-[#00B8C8]">Vescio Nexus Sentry Connection Verified</code>) and verify your Sentry dashboard.
                  </p>
                </div>
              ) : (
                errors.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3.5 rounded-xl bg-[#05070A] border border-zinc-800/90 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${entry.isFirestoreError ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}`}>
                            {entry.isFirestoreError ? 'Firestore' : entry.source}
                          </span>
                          <span className="text-[11px] font-mono text-zinc-400">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500">
                            role: {entry.userState.role || 'guest'} | branch: {entry.userState.branchId || 'main'}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-zinc-100 break-words">
                          {entry.message}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopyPayload(entry)}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-semibold border border-zinc-700 transition-colors cursor-pointer"
                        title="Copy this error's AI Fix Payload"
                      >
                        {copiedId === entry.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        <span>Copy JSON</span>
                      </button>
                    </div>

                    {entry.stack && (
                      <pre className="text-[10px] font-mono text-zinc-400 bg-zinc-900/90 p-2.5 rounded-lg border border-zinc-800 overflow-x-auto max-h-36 whitespace-pre-wrap">
                        {entry.stack}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
