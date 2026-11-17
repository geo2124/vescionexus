import React, { useState } from 'react';
import { collection, doc, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { STANDARD_LEBANESE_COA } from './COAModule';
import { logSystemAudit } from '../../lib/firestore-utils';
import { toast } from 'sonner';
import { PenTool, Save, Calendar } from 'lucide-react';

interface Props {
  isDarkMode: boolean;
  coa: any[];
  globalCurrency?: 'USD' | 'LBP';
  formatCurrency: (amount: number) => string;
}

export const ManualEntryModule: React.FC<Props> = ({ isDarkMode, coa, globalCurrency = 'USD' }) => {
  const { user, handleFirestoreError, usdToLbpRate, isPeriodClosed } = useFirebase();
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState<number>(0);
  const [debitAccount, setDebitAccount] = useState('');
  const [creditAccount, setCreditAccount] = useState('');

  const activeCoa = coa.length > 0 ? coa : STANDARD_LEBANESE_COA;

  const handlePost = async () => {
    if (!description) return toast.error('Description required');
    if (amount <= 0) return toast.error('Amount must be positive');
    if (!debitAccount || !creditAccount) return toast.error('Both Debit and Credit accounts are required');
    if (debitAccount === creditAccount) return toast.error('Debit and Credit accounts must be different');

    const checkDateStr = entryDate || new Date().toISOString().split('T')[0];
    if (isPeriodClosed(checkDateStr)) {
      return toast.error(`Cannot post journal entry. Fiscal period ${checkDateStr.substring(0, 7)} is locked.`);
    }

    let finalAmount = amount;
    if (globalCurrency === 'LBP' && usdToLbpRate > 0) {
      finalAmount = finalAmount / usdToLbpRate;
    }

    try {
      const batch = writeBatch(db);
      const txnRef = doc(collection(db, 'transactions'));
      const advTxnRef = doc(db, 'advanced_transactions', txnRef.id);
      const createdDateObj = entryDate ? new Date(`${entryDate}T12:00:00`) : new Date();

      // In FinancialLedger double-entry engine:
      // sourceAccount is Debited (accs[src].debit += amt)
      // destinationAccount is Credited (accs[dest].credit += amt)
      const entryData = {
        sourceAccount: debitAccount,
        destinationAccount: creditAccount,
        amount: finalAmount,
        subtotal: finalAmount,
        discount: 0,
        total: finalAmount,
        paymentMethod: 'manual_journal',
        transactionType: 'manual_journal',
        sourceModule: 'system',
        cashierId: user?.uid || 'system',
        notes: description,
        date: checkDateStr,
        createdAt: Timestamp.fromDate(createdDateObj),
        direction: 'neutral',
        fxRateAtTimeOfTransaction: usdToLbpRate,
        accountingStatus: 'posted'
      };

      batch.set(txnRef, entryData);
      batch.set(advTxnRef, {
        ...entryData,
        accountingStatus: 'posted',
        postedAt: new Date().toISOString(),
        postedBy: user?.uid
      });

      await batch.commit();

      await logSystemAudit({
        action: 'MANUAL_JOURNAL',
        collectionName: 'transactions',
        documentId: txnRef.id,
        staffId: user?.email || user?.uid || 'system',
        timestamp: new Date().toISOString(),
        details: {
          date: checkDateStr,
          debitAccount,
          creditAccount,
          amountUSD: Number(finalAmount.toFixed(2)),
          description
        }
      });

      toast.success('Manual journal entry posted to both Real-Time & Posting Ledgers');
      setDescription('');
      setAmount(0);
      setDebitAccount('');
      setCreditAccount('');
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'transactions');
      toast.error('Failed to post entry');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25 rounded-xl">
          <PenTool size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold">Manual Journal Entry</h2>
          <p className="text-sm text-zinc-500">Post double-entry journal vouchers directly to the General Ledger</p>
        </div>
      </div>

      <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Description / Memo</label>
              <input 
                type="text" 
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. Monthly Accrual Adjustment / Capital Injection"
                className="w-full bg-transparent border-b-2 border-slate-200 dark:border-zinc-800 focus:border-[#00B8C8] px-0 py-2 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1.5">
                <Calendar size={12} className="text-[#00B8C8]" /> Journal Date
              </label>
              <input
                type="date"
                value={entryDate}
                onChange={e => setEntryDate(e.target.value)}
                className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 py-2.5 px-3 rounded-xl text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-2">Debit Account (Dr)</label>
              <select 
                value={debitAccount}
                onChange={e => setDebitAccount(e.target.value)}
                className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 py-3 px-4 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-bold"
              >
                <option value="">Select Debit Account...</option>
                {activeCoa.map((a, idx) => (
                  <option key={a.id || idx} value={`${a.code} - ${a.name}`}>
                    {a.code} - {a.name} ({a.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-2">Credit Account (Cr)</label>
              <select 
                value={creditAccount}
                onChange={e => setCreditAccount(e.target.value)}
                className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 py-3 px-4 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-bold"
              >
                <option value="">Select Credit Account...</option>
                {activeCoa.map((a, idx) => (
                  <option key={a.id || idx} value={`${a.code} - ${a.name}`}>
                    {a.code} - {a.name} ({a.type})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Amount ({globalCurrency})</label>
            <div className="relative flex items-center">
              <span className="absolute left-4 font-black text-zinc-400">{globalCurrency === 'USD' ? '$' : 'ل.ل'}</span>
              <input 
                type="number" 
                value={amount || ''}
                onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                className={`w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 py-3 px-4 rounded-xl font-mono text-xl focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all ${globalCurrency === 'USD' ? 'pl-8' : 'pl-12'}`}
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t dark:border-zinc-800">
          <button 
            onClick={handlePost}
            disabled={!description || amount <= 0 || !debitAccount || !creditAccount}
            className="w-full flex justify-center items-center gap-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-8 py-4 rounded-xl font-bold shadow-sm shadow-cyan-500/20 transition-all disabled:opacity-50 disabled:shadow-none"
          >
            <Save size={18} /> Post Journal Entry
          </button>
        </div>
      </div>
    </div>
  );
};
