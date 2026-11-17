import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initSentry, Sentry, captureDiagnosticError } from './lib/sentry';

initSentry();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      onError={(error, componentStack) => {
        captureDiagnosticError(error, { componentStack }, 'react.error_boundary');
      }}
      fallback={({ error, resetError }) => (
        <div className="min-h-screen flex items-center justify-center bg-[#05070A] text-zinc-100 p-6 font-sans">
          <div className="max-w-md w-full p-6 rounded-2xl bg-[#0B0F17] border border-zinc-800 space-y-4">
            <div className="text-xs font-bold uppercase tracking-widest text-rose-400">
              Application Error Captured
            </div>
            <h1 className="text-lg font-bold text-zinc-100">
              Something went wrong
            </h1>
            <p className="text-xs text-zinc-400 font-mono break-words bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <button
              type="button"
              onClick={resetError}
              className="w-full py-2.5 px-4 rounded-xl bg-[#00B8C8] text-slate-950 font-bold text-xs uppercase tracking-wider hover:bg-[#0099A8] transition-all cursor-pointer"
            >
              Reload Interface
            </button>
          </div>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);

