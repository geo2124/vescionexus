import React, { useState, useMemo } from 'react';
import { DollarSign, RefreshCcw, Lock, Sparkles } from 'lucide-react';
import { useFirebase } from '../../../contexts/FirebaseContext';
import { processLedgerTransaction } from '../../../lib/transaction-engine';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { toast } from 'sonner';

interface FXTrackingProps {
  isDarkMode: boolean;
  formatCurrency: (val: number, currency?: string) => string;
  transactions: any[];
}

export const FXTracking: React.FC<FXTrackingProps> = ({ isDarkMode, formatCurrency, transactions }) => {
  const { user, usdToLbpRate } = useFirebase();
  const [currency, setCurrency] = useState<'USD' | 'LBP'>('USD');
  const [dateGroup, setDateGroup] = useState<'month' | 'day'>('month');
  const [isPostingReval, setIsPostingReval] = useState(false);

  const { historicalLBP, totalCashUSD, historicalRatesMap, realizedGainUSD, realizedLossUSD } = useMemo(() => {
    let cashUsd = 0;
    let histLbp = 0;
    let realGain = 0;
    let realLoss = 0;
    const ratesMap: Record<string, { totalCashUSD: number; historicalLBP: number; rate: number; txCount: number }> = {};

    transactions.forEach(t => {
      if (t.voidedAt || t.isReversal) return;

      const srcLower = (t.sourceAccount || '').toLowerCase();
      const destLower = (t.destinationAccount || '').toLowerCase();

      if (srcLower.includes('676') || destLower.includes('676') || t.transactionType === 'fx_loss') {
        realLoss += Number(t.amount || 0);
      }
      if (srcLower.includes('776') || destLower.includes('776') || t.transactionType === 'fx_gain') {
        realGain += Number(t.amount || 0);
      }

      const isDestCash =
        destLower.includes('cash') ||
        destLower.includes('bank') ||
        destLower.includes('531') ||
        destLower.includes('512') ||
        (t.direction === 'inflow' && !destLower.includes('411'));
      const isSrcCash =
        srcLower.includes('cash') ||
        srcLower.includes('bank') ||
        srcLower.includes('531') ||
        srcLower.includes('512') ||
        (t.direction === 'outflow' && !srcLower.includes('681'));

      let impact = 0;
      const amt = Number(t.total ?? t.amount ?? 0);
      if (t.direction === 'inflow' || (t.direction !== 'outflow' && isDestCash)) {
        impact += amt;
      } else if (t.direction === 'outflow' || isSrcCash) {
        impact -= amt;
      }

      if (impact !== 0) {
        const tDate = t.createdAt?.seconds
          ? new Date(t.createdAt.seconds * 1000)
          : typeof t.date === 'string'
          ? new Date(t.date)
          : new Date();
        const isoStr = isNaN(tDate.getTime()) ? new Date().toISOString() : tDate.toISOString();
        const periodStr = dateGroup === 'month' ? isoStr.substring(0, 7) : isoStr.split('T')[0];

        const lockedRate = Number(t.fxRateAtTimeOfTransaction || t.exchangeRateAtPosting || t.historicalFxRate || usdToLbpRate || 89500);

        cashUsd += impact;
        histLbp += impact * lockedRate;

        if (!ratesMap[periodStr]) {
          ratesMap[periodStr] = { totalCashUSD: 0, historicalLBP: 0, rate: lockedRate, txCount: 0 };
        }
        ratesMap[periodStr].totalCashUSD += impact;
        ratesMap[periodStr].historicalLBP += impact * lockedRate;
        ratesMap[periodStr].rate = lockedRate;
        ratesMap[periodStr].txCount += 1;
      }
    });

    return {
      totalCashUSD: cashUsd,
      historicalLBP: histLbp,
      historicalRatesMap: ratesMap,
      realizedGainUSD: realGain,
      realizedLossUSD: realLoss
    };
  }, [transactions, usdToLbpRate, dateGroup]);

  const effectiveRate = usdToLbpRate || 89500;
  const currentMarketValueLBP = totalCashUSD * effectiveRate;
  const totalGainLossLBP = currentMarketValueLBP - historicalLBP;
  const totalGainLossUSD = totalGainLossLBP / effectiveRate;

  const displayGainLoss = currency === 'LBP' ? totalGainLossLBP : totalGainLossUSD;
  const netRealizedFXUSD = realizedGainUSD - realizedLossUSD;

  const periods = Object.keys(historicalRatesMap).sort((a, b) => a.localeCompare(b)).reverse();

  const handlePostFXRevaluation = async () => {
    const absDiffUSD = Math.abs(totalGainLossUSD);
    if (absDiffUSD < 0.01) {
      toast.info('No material FX difference to post — Historical LBP matches Current Market LBP.');
      return;
    }

    setIsPostingReval(true);
    try {
      const isGain = totalGainLossUSD > 0;
      const res = await processLedgerTransaction({
        amount: Number(absDiffUSD.toFixed(2)),
        paymentMethod: 'system',
        sourceModule: 'accounting_fx',
        cashierId: user?.uid || 'system',
        transactionType: isGain ? 'fx_gain' : 'fx_loss',
        direction: isGain ? 'inflow' : 'outflow',
        sourceAccount: isGain
          ? '531 - Cash Drawer / Register (Caisse)'
          : '676 - Foreign Exchange Losses (Différences de Change Négatives)',
        destinationAccount: isGain
          ? '776 - Foreign Exchange Gains (Différences de Change Positives)'
          : '531 - Cash Drawer / Register (Caisse)',
        notes: `FX Revaluation (Différence de Change ${isGain ? 'Positive - 776' : 'Négative - 676'}) @ ${effectiveRate.toLocaleString()} LBP/USD`
      });

      if (res?.transactionId) {
        await updateDoc(doc(db, 'advanced_transactions', res.transactionId), {
          accountingStatus: 'posted',
          postedAt: new Date().toISOString(),
          postedBy: user?.uid || 'system',
          exchangeRateAtPosting: effectiveRate
        });
      }

      toast.success(
        `Posted FX ${isGain ? 'Gain (LCOA 776)' : 'Loss (LCOA 676)'} of $${absDiffUSD.toFixed(2)} (${Math.round(Math.abs(totalGainLossLBP)).toLocaleString()} LBP)`
      );
    } catch (e: any) {
      toast.error('Failed to post FX revaluation: ' + e.message);
    } finally {
      setIsPostingReval(false);
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto w-full">
      <div className="mb-8 flex flex-col md:flex-row md:justify-between md:items-end gap-4 w-full">
        <div>
           <h2 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'} mb-2`}>Multi-Currency & FX Ledger (LCOA 676 / 776)</h2>
           <p className={`${isDarkMode ? 'text-zinc-500' : 'text-slate-500'} font-medium`}>
             Historical FX Rate Immutability (`fxRateAtTimeOfTransaction`) & Automated `Différence de Change` Tracking.
           </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-zinc-200 dark:bg-zinc-800 p-1 rounded-xl">
            <button
              onClick={() => setDateGroup('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${dateGroup === 'month' ? 'bg-white dark:bg-zinc-700 text-black dark:text-white shadow-sm' : 'text-zinc-500'}`}
            >
              By Month
            </button>
            <button
              onClick={() => setDateGroup('day')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${dateGroup === 'day' ? 'bg-white dark:bg-zinc-700 text-black dark:text-white shadow-sm' : 'text-zinc-500'}`}
            >
              By Day
            </button>
          </div>
          <div className="flex bg-zinc-200 dark:bg-zinc-800 p-1 rounded-xl w-fit">
             <button 
               onClick={() => setCurrency('USD')}
               className={`px-4 py-2 flex items-center gap-2 rounded-lg text-sm font-bold transition-all ${currency === 'USD' ? 'bg-white dark:bg-zinc-700 text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
             >
               <DollarSign size={16} /> USD
             </button>
             <button 
               onClick={() => setCurrency('LBP')}
               className={`px-4 py-2 flex items-center gap-2 rounded-lg text-sm font-bold transition-all ${currency === 'LBP' ? 'bg-white dark:bg-zinc-700 text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
             >
               <RefreshCcw size={16} /> LBP
             </button>
          </div>
          <button
            onClick={handlePostFXRevaluation}
            disabled={isPostingReval}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-blue-500/20 disabled:opacity-50"
          >
            <Sparkles size={14} /> Post FX Revaluation (676 / 776)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 w-full">
        <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
           <div className={`text-xs font-black uppercase tracking-widest mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Current Market Rate</div>
           <div className={`text-3xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>{effectiveRate.toLocaleString()} LBP</div>
           <div className="mt-2 text-xs font-medium text-amber-500 bg-amber-500/10 w-fit px-2 py-1 rounded-md flex items-center gap-1">
             <Lock size={12} /> Past entries retain locked FX rate
           </div>
        </div>

        <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
           <div className={`text-xs font-black uppercase tracking-widest mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
             Unrealized FX Revaluation
           </div>
           <div className={`text-3xl font-black tracking-tight ${displayGainLoss >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
             {displayGainLoss >= 0 ? '+' : ''}{currency === 'LBP' ? `ل.ل ${Math.round(displayGainLoss).toLocaleString()}` : `$${displayGainLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
           </div>
           <div className="mt-2 text-xs font-medium text-zinc-500">Current LBP vs Locked Historical LBP</div>
        </div>

        <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
           <div className={`text-xs font-black uppercase tracking-widest mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
             Realized FX (LCOA 776 / 676)
           </div>
           <div className={`text-3xl font-black tracking-tight ${netRealizedFXUSD >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
             {netRealizedFXUSD >= 0 ? '+' : ''}{currency === 'LBP' ? `ل.ل ${Math.round(netRealizedFXUSD * effectiveRate).toLocaleString()}` : `$${netRealizedFXUSD.toFixed(2)}`}
           </div>
           <div className="mt-2 text-xs font-mono text-zinc-500">
             776 Gain: ${realizedGainUSD.toFixed(2)} | 676 Loss: ${realizedLossUSD.toFixed(2)}
           </div>
        </div>
      </div>

      <div className={`overflow-x-auto rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm w-full`}>
         <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
            <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-950/80 border-b border-zinc-800' : 'text-slate-500 bg-slate-50 border-b border-slate-200'}`}>
              <tr>
                 <th className="p-4 px-6">Period</th>
                 <th className="p-4">Transactions</th>
                 <th className="p-4">Weighted Locked FX Rate</th>
                 <th className="p-4">Net Flow (USD Base)</th>
                 <th className="p-4">Locked Historical Value (LBP)</th>
                 <th className="p-4 text-right px-6">FX Différence de Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono text-xs">
               {periods.length === 0 && (
                 <tr><td colSpan={6} className="p-8 text-center text-zinc-500 font-bold">No verified cash transactions found affecting multiple currencies.</td></tr>
               )}
               {periods.map((p, idx) => {
                 const data = historicalRatesMap[p];
                 const currentVal = data.totalCashUSD * effectiveRate;
                 const gainLoss = currentVal - data.historicalLBP;
                 const dispGainLoss = currency === 'LBP' ? gainLoss : gainLoss / effectiveRate;
                 const avgLockedRate = data.totalCashUSD !== 0 ? Math.abs(data.historicalLBP / data.totalCashUSD) : data.rate;
                 
                 return (
                 <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20">
                    <td className="p-4 px-6 font-black">{p}</td>
                    <td className="p-4 text-zinc-500">{data.txCount} entries</td>
                    <td className="p-4 text-zinc-600 dark:text-zinc-300">1 USD = {Math.round(avgLockedRate).toLocaleString()} LBP</td>
                    <td className="p-4 font-bold text-zinc-800 dark:text-zinc-200">
                      ${data.totalCashUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                    <td className="p-4 font-bold text-zinc-800 dark:text-zinc-200">
                      ل.ل {Math.round(data.historicalLBP).toLocaleString()}
                    </td>
                    <td className={`p-4 px-6 text-right font-black ${dispGainLoss >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {dispGainLoss >= 0 ? '+' : ''}{currency === 'LBP' ? `ل.ل ${Math.round(dispGainLoss).toLocaleString()}` : `$${dispGainLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
                    </td>
                 </tr>
                 );
               })}
            </tbody>
         </table>
      </div>
    </div>
  );
};
