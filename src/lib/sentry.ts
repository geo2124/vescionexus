import * as Sentry from '@sentry/react';

export interface DiagnosticUserContext {
  uid?: string | null;
  email?: string | null;
  role?: string | null;
  branchId?: string | null;
}

export interface DiagnosticErrorEntry {
  id: string;
  timestamp: string;
  message: string;
  name: string;
  stack?: string;
  code?: string;
  source: string;
  isFirestoreError: boolean;
  userState: DiagnosticUserContext;
  extra?: Record<string, any>;
}

declare global {
  interface Window {
    __APP_DIAGNOSTICS__: DiagnosticErrorEntry[];
  }
}

if (typeof window !== 'undefined' && !Array.isArray(window.__APP_DIAGNOSTICS__)) {
  window.__APP_DIAGNOSTICS__ = [];
}

export const SENTRY_DSN =
  (import.meta as any).env?.VITE_SENTRY_DSN ||
  'https://749ffc525d4ff5de2287efe480b00b11@o4512449553956864.ingest.us.sentry.io/4512449569619968';

let currentDiagnosticUser: DiagnosticUserContext = {
  uid: null,
  email: null,
  role: 'guest',
  branchId: 'main',
};

let globalHandlersRegistered = false;

export function setDiagnosticUserContext(userCtx: DiagnosticUserContext | null) {
  if (!userCtx) {
    currentDiagnosticUser = {
      uid: null,
      email: null,
      role: 'guest',
      branchId: 'main',
    };
    Sentry.setUser(null);
    return;
  }

  currentDiagnosticUser = {
    uid: userCtx.uid || null,
    email: userCtx.email || null,
    role: userCtx.role || 'staff',
    branchId: userCtx.branchId || 'main',
  };

  Sentry.setUser({
    id: currentDiagnosticUser.uid || undefined,
    email: currentDiagnosticUser.email || undefined,
    role: currentDiagnosticUser.role || undefined,
    branchId: currentDiagnosticUser.branchId || undefined,
  } as any);
}

export function getDiagnosticUserContext(): DiagnosticUserContext {
  return { ...currentDiagnosticUser };
}

function isFirestoreRelatedError(err: any, message: string): boolean {
  const code = String(err?.code || '').toLowerCase();
  const msg = message.toLowerCase();
  return (
    code.includes('permission-denied') ||
    code.includes('invalid-argument') ||
    code.includes('failed-precondition') ||
    code.includes('unavailable') ||
    msg.includes('firestore') ||
    msg.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions') ||
    msg.includes('invalid-argument') ||
    msg.includes('unsupported field value: undefined') ||
    msg.includes('transaction')
  );
}

export function captureDiagnosticError(
  rawError: unknown,
  context: Record<string, any> = {},
  source = 'runtime'
): DiagnosticErrorEntry {
  const errObj =
    rawError instanceof Error
      ? rawError
      : new Error(typeof rawError === 'string' ? rawError : JSON.stringify(rawError));

  const message = errObj.message || String(rawError);
  const code = (rawError as any)?.code || context?.code;
  const firestoreFlag = isFirestoreRelatedError(rawError, message) || source === 'firestore';

  const enrichedContext = {
    ...context,
    source,
    isFirestoreError: firestoreFlag,
    role: currentDiagnosticUser.role || 'guest',
    branchId: currentDiagnosticUser.branchId || 'main',
    userId: currentDiagnosticUser.uid || null,
    userEmail: currentDiagnosticUser.email || null,
    url: typeof window !== 'undefined' ? window.location.href : '',
  };

  Sentry.captureException(errObj, {
    extra: enrichedContext,
    tags: {
      role: String(currentDiagnosticUser.role || 'guest'),
      branchId: String(currentDiagnosticUser.branchId || 'main'),
      source,
      firestore_error: String(firestoreFlag),
    },
  });

  const entry: DiagnosticErrorEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    message,
    name: errObj.name || 'Error',
    stack: errObj.stack,
    code: code ? String(code) : undefined,
    source,
    isFirestoreError: firestoreFlag,
    userState: { ...currentDiagnosticUser },
    extra: enrichedContext,
  };

  if (typeof window !== 'undefined') {
    const existing = Array.isArray(window.__APP_DIAGNOSTICS__) ? window.__APP_DIAGNOSTICS__ : [];
    window.__APP_DIAGNOSTICS__ = [entry, ...existing].slice(0, 10);
    window.dispatchEvent(new CustomEvent('vescio-diagnostics-updated', { detail: window.__APP_DIAGNOSTICS__ }));
  }

  return entry;
}

export function triggerSentryTestError(): DiagnosticErrorEntry {
  const testErr = new Error('Vescio Nexus Sentry Connection Verified');
  return captureDiagnosticError(
    testErr,
    { verificationTest: true, triggeredFrom: 'DevDiagnosticsModal' },
    'manual_test'
  );
}

export function clearDiagnostics() {
  if (typeof window !== 'undefined') {
    window.__APP_DIAGNOSTICS__ = [];
    window.dispatchEvent(new CustomEvent('vescio-diagnostics-updated', { detail: [] }));
  }
}

export function initSentry() {
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
    environment: (import.meta as any).env?.MODE || 'production',
  });

  if (typeof window !== 'undefined' && !globalHandlersRegistered) {
    globalHandlersRegistered = true;

    const prevOnError = window.onerror;
    window.onerror = function (message, sourceUrl, lineno, colno, error) {
      captureDiagnosticError(
        error || new Error(String(message)),
        {
          sourceUrl,
          lineno,
          colno,
        },
        'window.onerror'
      );
      if (typeof prevOnError === 'function') {
        return prevOnError.apply(this, arguments as any);
      }
      return false;
    };

    const prevOnUnhandledRejection = window.onunhandledrejection;
    window.onunhandledrejection = function (event: PromiseRejectionEvent) {
      const reason = event?.reason;
      captureDiagnosticError(
        reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : JSON.stringify(reason || 'Unhandled Promise Rejection')),
        {
          rejectionReason: typeof reason === 'object' && reason !== null ? (reason.message || String(reason)) : String(reason),
          code: reason?.code,
        },
        'window.onunhandledrejection'
      );
      if (typeof prevOnUnhandledRejection === 'function') {
        return prevOnUnhandledRejection.apply(this, [event]);
      }
    };
  }
}

export { Sentry };
