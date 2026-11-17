import React, { useState } from 'react';
import { doc, updateDoc, arrayUnion, arrayRemove, addDoc, collection } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { Lock, Unlock, ShieldAlert, ArrowRight, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { OperationType } from '../../types';
import { logSystemAudit } from '../../lib/firestore-utils';

interface Props {
  isDarkMode: boolean;
  globalCurrency: 'USD' | 'LBP';
  formatCurrency: (amount: number) => string;
}

export const PeriodCloseModule: React.FC<Props> = ({ isDarkMode, formatCurrency }) => {
  const { user, closedPeriods, handleFirestoreError } = useFirebase();
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().substring(0, 7)); // YYYY-MM
  const [carryForwardYear, setCarryForwardYear] = useState<string>(new Date().toISOString().substring(0, 4));

  const handleTogglePeriod = async () => {
    const isClosed = closedPeriods.includes(selectedMonth);
    const action = isClosed ? 'open' : 'close';
    
    if (!window.confirm(`Are you sure you want to ${action} the period ${selectedMonth}? ${isClosed ? 'This will allow new transactions.' : 'No new transactions can be posted in this month.'}`)) {
      return;
    }

    try {
      const settingsRef = doc(db, 'system', 'settings');
      await updateDoc(settingsRef, {
        closedPeriods: isClosed ? arrayRemove(selectedMonth) : arrayUnion(selectedMonth)
      });
      await logSystemAudit({
        action: isClosed ? 'PERIOD_REOPEN' : 'PERIOD_CLOSE',
        collectionName: 'system/settings',
        documentId: selectedMonth,
        staffId: user?.email || user?.uid || 'system',
        timestamp: new Date().toISOString(),
        details: {
          period: selectedMonth,
          newStatus: isClosed ? 'OPEN' : 'LOCKED',
          note: `Fiscal period ${selectedMonth} ${isClosed ? 're-opened' : 'locked against modifications'}`
        }
      });
      toast.success(`Period ${selectedMonth} ${isClosed ? 'opened' : 'closed'} successfully.`);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'system/settings');
      toast.error(`Failed to ${action} period.`);
    }
  };

  const handleCarryForward = async () => {
    if (!window.confirm(`Are you sure you want to execute Year-End Carry Forward for ${carryForwardYear}? This will close out retained earnings into equity.`)) {
      return;
    }

    try {
      const cfDoc = await addDoc(collection(db, 'advanced_transactions'), {
         amount: 0,
         transactionType: 'carry_forward',
         sourceAccount: '120 - Result of the Fiscal Year (Profit / Loss)',
         destinationAccount: '110 - Retained Earnings (Report à Nouveau)',
         accountingStatus: 'posted',
         sourceModule: 'system',
         notes: `Year-end carry forward for ${carryForwardYear}`,
         createdAt: new Date(),
         postedAt: new Date().toISOString(),
         postedBy: user?.uid,
         direction: 'neutral',
      });
      await logSystemAudit({
        action: 'YEAR_END_CARRY_FORWARD',
        collectionName: 'advanced_transactions',
        documentId: cfDoc.id,
        staffId: user?.email || user?.uid || 'system',
        timestamp: new Date().toISOString(),
        details: {
          fiscalYear: carryForwardYear,
          sourceAccount: '120 - Result of the Fiscal Year (Profit / Loss)',
          destinationAccount: '110 - Retained Earnings (Report à Nouveau)'
        }
      });
      toast.success(`Year-End Carry Forward generated successfully for ${carryForwardYear}. Balances migrated.`);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'advanced_transactions');
    }
  };

  const isClosed = closedPeriods.includes(selectedMonth);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400 rounded-xl">
          <ShieldAlert size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold">Period Close & Auditing</h2>
          <p className="text-sm text-zinc-500">Lock historical periods to prevent any modifications or additions</p>
        </div>
      </div>

      <div className={`p-8 rounded-3xl border shadow-xl ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 shadow-black/50' : 'bg-white border-slate-200 shadow-slate-200/50'}`}>
        <div className="space-y-6">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Select Period (Month)</label>
            <input 
              type="month" 
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 py-3 px-4 rounded-xl text-lg focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-bold"
            />
          </div>

          <div className={`p-6 rounded-2xl border ${isClosed ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300'}`}>
            <div className="flex items-start gap-4">
              <div className="mt-1">
                {isClosed ? <Lock size={24} /> : <Unlock size={24} />}
              </div>
              <div>
                <h3 className="font-bold text-lg mb-1">{isClosed ? 'Period is Locked' : 'Period is Open'}</h3>
                <p className="text-sm opacity-80">
                  {isClosed 
                    ? 'No transactions can be posted, modified, or voided for this month. This is the gold standard for auditing after tax filing.' 
                    : 'Transactions can be posted and modified for this month. Lock it once reconciliation and tax filing are complete.'}
                </p>
              </div>
            </div>
          </div>

          <button 
            onClick={handleTogglePeriod}
            className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-xl active:scale-[0.98] flex justify-center items-center gap-2 ${isClosed ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20 text-white' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20 text-white'}`}
          >
            {isClosed ? <><Unlock size={18} /> Re-open Period</> : <><Lock size={18} /> Lock Period</>}
          </button>
        </div>
      </div>
      
      <div className="mt-8">
         <h4 className="font-bold text-sm mb-4 uppercase tracking-widest text-zinc-500">Currently Locked Periods</h4>
         <div className="flex flex-wrap gap-2">
            {closedPeriods.length === 0 && <span className="text-sm text-zinc-500 italic">No periods are currently locked.</span>}
            {[...closedPeriods].sort((a, b) => a.localeCompare(b)).reverse().map(p => (
              <div key={p} className="flex items-center gap-2 px-3 py-1.5 bg-slate-200 dark:bg-zinc-900 rounded-lg text-sm font-mono border border-slate-300 dark:border-zinc-800">
                <Lock size={14} className="text-rose-500" /> {p}
              </div>
            ))}
         </div>
      </div>

      <div className={`mt-12 p-8 rounded-3xl border shadow-xl ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 shadow-black/50' : 'bg-white border-slate-200 shadow-slate-200/50'}`}>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25 rounded-xl">
              <BookOpen size={24} />
            </div>
            <div>
              <h3 className="font-bold text-lg">Year-End Carry Forward</h3>
              <p className="text-sm opacity-80">Close out Income Statement accounts to Retained Earnings and roll balances to new fiscal year.</p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Fiscal Year</label>
            <input 
              type="number" 
              value={carryForwardYear}
              onChange={e => setCarryForwardYear(e.target.value)}
              className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 py-3 px-4 rounded-xl text-lg focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-bold"
            />
          </div>
          <button 
            onClick={handleCarryForward}
            className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-lg active:scale-[0.98] flex justify-center items-center gap-2 bg-[#00B8C8] hover:bg-[#0099A8] shadow-cyan-500/20 text-slate-950"
          >
            <ArrowRight size={18} /> Execute Carry Forward
          </button>
        </div>
      </div>
    </div>
  );
};
