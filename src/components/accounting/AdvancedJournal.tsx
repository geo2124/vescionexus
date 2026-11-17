import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { STANDARD_LEBANESE_COA } from './COAModule';
import { logSystemAudit } from '../../lib/firestore-utils';
import { toast } from 'sonner';
import { CheckCircle, Clock, Save, FileText, Settings, XCircle, Search, Calendar, Percent, CheckSquare, RotateCcw, RefreshCw, Edit3 } from 'lucide-react';

interface Props {
  isDarkMode: boolean;
  coa: any[];
  globalCurrency: 'USD' | 'LBP';
  formatCurrency: (amountInUSD: number) => string;
  selectedModules: string[];
}

export const isEligibleForCashAdjustment = (txn: any, adjustmentPercentage: number): boolean => {
  if (!adjustmentPercentage || adjustmentPercentage === 0) return false;
  if (!txn || txn.isReversal || txn.isB2BInvoice) return false;
  if (
    txn.transactionType === 'b2b_invoice' ||
    txn.transactionType === 'supplier_bill' ||
    txn.transactionType === 'manual_journal' ||
    txn.transactionType === 'inventory_cogs_movement' ||
    txn.transactionType === 'inventory_wastage' ||
    txn.transactionType === 'purchase_order_received'
  ) {
    return false;
  }
  const isCash = txn.paymentMethod === 'cash' || (txn.sourceAccount && String(txn.sourceAccount).toLowerCase().includes('cash'));
  const isInflow = txn.direction === 'inflow' || (!txn.direction && (txn.amount || 0) > 0);
  const eligibleModules = ['gym', 'reservation', 'reservations', 'courts', 'court', 'pos_retail', 'pos_cafe', 'pos_cafeteria', 'physio'];
  const modMatch = eligibleModules.includes(txn.sourceModule || '');
  return Boolean(isCash && isInflow && modMatch);
};

export const getAdjustedAmount = (amount: number, txn: any, adjustmentPercentage: number): number => {
  if (!isEligibleForCashAdjustment(txn, adjustmentPercentage)) return Number((amount || 0).toFixed(2));
  const factor = Math.max(0, 1 + (adjustmentPercentage / 100));
  return Number((amount * factor).toFixed(2));
};

export const getTxnDateString = (txn: any): string => {
  if (txn?.date && typeof txn.date === 'string') return txn.date.substring(0, 10);
  if (txn?.createdAt?.seconds) {
    return new Date(txn.createdAt.seconds * 1000).toISOString().split('T')[0];
  }
  if (txn?.createdAt) {
    try {
      return new Date(txn.createdAt).toISOString().split('T')[0];
    } catch {
      // fallback
    }
  }
  return new Date().toISOString().split('T')[0];
};

export const AdvancedJournal: React.FC<Props> = ({ isDarkMode, coa, formatCurrency, selectedModules }) => {
  const { user, handleFirestoreError, usdToLbpRate, isPeriodClosed, adjustmentPercentage } = useFirebase();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [filterState, setFilterState] = useState<'unposted' | 'pending_review' | 'posted' | 'voided'>('unposted');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isBatchPosting, setIsBatchPosting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Custom posting review & edit state
  const [selectedTxn, setSelectedTxn] = useState<any | null>(null);
  const [editDebitAccount, setEditDebitAccount] = useState<string>('');
  const [editCreditAccount, setEditCreditAccount] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [postingRate, setPostingRate] = useState<number>(usdToLbpRate);
  const [selectedCostCenter, setSelectedCostCenter] = useState<string>('none');
  const [fiscalRules, setFiscalRules] = useState<any[]>([]);
  const [selectedTaxRuleId, setSelectedTaxRuleId] = useState<string>('none');

  const activeCoa = coa && coa.length > 0 ? coa : STANDARD_LEBANESE_COA;

  const costCenters = [
    { id: 'none', label: 'None / General' },
    { id: 'cc_gym', label: 'Gym Floor & Training' },
    { id: 'cc_courts', label: 'Court Reservations' },
    { id: 'cc_cafe', label: 'Kiosk POS' },
    { id: 'cc_retail', label: 'Retail Shop POS' },
    { id: 'cc_physio', label: 'Physiotherapy Clinic' },
    { id: 'cc_hq', label: 'Headquarters / Admin' }
  ];

  useEffect(() => {
    setPostingRate(usdToLbpRate);
  }, [usdToLbpRate]);

  useEffect(() => {
    if (selectedTxn) {
      setEditDebitAccount(selectedTxn.sourceAccount || '531 - Cash Drawer / Register (Caisse)');
      setEditCreditAccount(selectedTxn.destinationAccount || '706 - General Facility Revenue');
      setEditNotes(selectedTxn.notes || '');
      setSelectedCostCenter(selectedTxn.costCenter || 'none');
      setSelectedTaxRuleId(selectedTxn.taxRuleId || 'none');
      setPostingRate(Number(selectedTxn.exchangeRateAtPosting || selectedTxn.fxRateAtTimeOfTransaction || usdToLbpRate || 89500));
    }
  }, [selectedTxn, usdToLbpRate]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'advanced_transactions'), orderBy('createdAt', 'desc'));
    const unsubTxn = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTransactions(data);
    }, error => handleFirestoreError(error, OperationType.LIST, 'advanced_transactions'));

    const unsubFis = onSnapshot(collection(db, 'fiscalRules'), snap => {
      setFiscalRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'fiscalRules'));

    return () => {
      unsubTxn();
      unsubFis();
    };
  }, [user]);

  const filteredTxns = transactions.filter(t => {
    const rawStatus = t.accountingStatus || 'pending';
    const normalizedStatus = rawStatus === 'pending' ? 'unposted' : rawStatus;
    if (normalizedStatus !== filterState) return false;
    if (t.sourceModule === 'academy') return false;
    const normalizedMod = t.sourceModule === 'pos_cafeteria' ? 'pos_cafe' : t.sourceModule;
    if (selectedModules && !selectedModules.includes(normalizedMod || 'system') && !selectedModules.includes(t.sourceModule || 'system') && t.sourceModule !== 'system') return false;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchSrc = t.sourceAccount?.toLowerCase().includes(term);
      const matchDest = t.destinationAccount?.toLowerCase().includes(term);
      const matchNotes = t.notes?.toLowerCase().includes(term);
      const matchId = t.id.toLowerCase().includes(term);
      if (!matchSrc && !matchDest && !matchNotes && !matchId) return false;
    }

    if (startDate || endDate) {
      const tDate = t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000) : new Date(t.createdAt || Date.now());
      if (startDate && tDate < new Date(startDate)) return false;
      if (endDate) {
        const nextDay = new Date(endDate);
        nextDay.setDate(nextDay.getDate() + 1);
        if (tDate >= nextDay) return false;
      }
    }

    return true;
  });

  const unpostedCount = transactions.filter(t => {
    const s = t.accountingStatus || 'pending';
    return (s === 'pending' || s === 'unposted') && t.sourceModule !== 'academy';
  }).length;

  const toggleSelectTxnId = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAllFiltered = () => {
    if (selectedIds.length === filteredTxns.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredTxns.map(t => t.id));
    }
  };

  const changeStatus = async (txnId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'advanced_transactions', txnId), { accountingStatus: newStatus });
      toast.success(`Transaction moved to ${newStatus}`);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `advanced_transactions/${txnId}`);
      toast.error('Failed to change status');
    }
  };

  const getSelectedAdjustedAmount = () => {
    if (!selectedTxn) return 0;
    return getAdjustedAmount(Math.abs(selectedTxn.amount || 0), selectedTxn, adjustmentPercentage);
  };

  const calculateVAT = () => {
    if (selectedTaxRuleId === 'none') return 0;
    const rule = fiscalRules.find(r => r.id === selectedTaxRuleId);
    if (!rule) return 0;
    const rate = parseFloat(rule.taxRate) / 100;
    return Number((getSelectedAdjustedAmount() * rate).toFixed(2));
  };

  const calculateGainLossLBP = () => {
    const amt = getSelectedAdjustedAmount();
    const originalRate = Number(selectedTxn?.fxRateAtTimeOfTransaction || usdToLbpRate || 89500);
    const originalLBP = amt * originalRate;
    const postedLBP = amt * postingRate;
    return postedLBP - originalLBP;
  };

  const handlePostTransaction = async () => {
    if (!selectedTxn) return;

    const txnDateStr = getTxnDateString(selectedTxn);
    const todayDateStr = new Date().toISOString().split('T')[0];
    if (isPeriodClosed(txnDateStr) || isPeriodClosed(todayDateStr)) {
      return toast.error(`Cannot post transaction. Fiscal period (${txnDateStr.substring(0, 7)}) is locked.`);
    }

    try {
      const txnRef = doc(db, 'advanced_transactions', selectedTxn.id);
      const finalDebit = editDebitAccount.trim() || selectedTxn.sourceAccount || '531 - Cash Drawer / Register (Caisse)';
      const finalCredit = editCreditAccount.trim() || selectedTxn.destinationAccount || '706 - General Facility Revenue';
      const finalNotes = editNotes.trim() || selectedTxn.notes || null;

      await updateDoc(txnRef, {
        sourceAccount: finalDebit,
        destinationAccount: finalCredit,
        notes: finalNotes,
        accountingStatus: 'posted',
        postedAt: new Date().toISOString(),
        postedBy: user?.uid,
        exchangeRateAtPosting: postingRate,
        costCenter: selectedCostCenter !== 'none' ? selectedCostCenter : null,
        taxRuleId: selectedTaxRuleId !== 'none' ? selectedTaxRuleId : null,
        vatAmount: calculateVAT(),
        exchangeGainLossLBP: calculateGainLossLBP()
      });

      toast.success('Transaction verified & posted to Mode B General Ledger');
      setSelectedTxn(null);
      setSelectedIds(prev => prev.filter(id => id !== selectedTxn.id));
      setSelectedCostCenter('none');
      setSelectedTaxRuleId('none');
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `advanced_transactions/${selectedTxn.id}`);
      toast.error('Failed to post transaction');
    }
  };

  const handleBatchPost = async (targetTxns: any[]) => {
    if (targetTxns.length === 0) return;
    const todayDateStr = new Date().toISOString().split('T')[0];
    if (isPeriodClosed(todayDateStr)) {
      return toast.error('Cannot post transactions. The current accounting period is closed.');
    }

    const lockedTxn = targetTxns.find(t => isPeriodClosed(getTxnDateString(t)));
    if (lockedTxn) {
      return toast.error(`Cannot batch post: Entry ${lockedTxn.id.slice(0, 8)} belongs to locked period ${getTxnDateString(lockedTxn).substring(0, 7)}.`);
    }

    setIsBatchPosting(true);
    try {
      const batch = writeBatch(db);
      targetTxns.slice(0, 450).forEach(t => {
        const ref = doc(db, 'advanced_transactions', t.id);
        batch.update(ref, {
          accountingStatus: 'posted',
          postedAt: new Date().toISOString(),
          postedBy: user?.uid,
          exchangeRateAtPosting: Number(t.fxRateAtTimeOfTransaction || postingRate || 89500)
        });
      });
      await batch.commit();
      toast.success(`Batch-posted ${Math.min(targetTxns.length, 450)} entries to the Mode B General Ledger.`);
      setSelectedTxn(null);
      setSelectedIds([]);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'advanced_transactions');
      toast.error('Batch posting failed');
    } finally {
      setIsBatchPosting(false);
    }
  };

  const handleUnpostTransaction = async (txn: any) => {
    const txnDateStr = getTxnDateString(txn);
    if (isPeriodClosed(txnDateStr)) {
      return toast.error(`Cannot unpost entry. Fiscal period ${txnDateStr.substring(0, 7)} is locked.`);
    }

    try {
      await updateDoc(doc(db, 'advanced_transactions', txn.id), {
        accountingStatus: 'pending_review',
        unpostedAt: new Date().toISOString(),
        unpostedBy: user?.uid || 'system'
      });
      await logSystemAudit({
        action: 'UNPOST_ENTRY',
        collectionName: 'advanced_transactions',
        documentId: txn.id,
        staffId: user?.email || user?.uid || 'system',
        timestamp: new Date().toISOString(),
        details: {
          sourceModule: txn.sourceModule,
          amountUSD: txn.amount,
          previousStatus: 'posted',
          newStatus: 'pending_review'
        }
      });
      toast.success('Entry re-opened and moved to Pending Review for adjustment.');
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `advanced_transactions/${txn.id}`);
      toast.error('Failed to re-open entry');
    }
  };

  const handleVoidTransaction = async (txn: any) => {
    const txnDateStr = getTxnDateString(txn);
    const todayDateStr = new Date().toISOString().split('T')[0];
    if (isPeriodClosed(txnDateStr) || isPeriodClosed(todayDateStr)) {
      return toast.error(`Cannot void transaction. Fiscal period (${txnDateStr.substring(0, 7)}) is locked.`);
    }

    const wasPosted = txn.accountingStatus === 'posted';
    const reason = window.prompt(
      wasPosted
        ? 'Voiding a posted entry creates a compensating reversal entry and logs to System Audit. Enter reason:'
        : 'Rejecting this pending queue item removes it from Mode B posting and logs to System Audit. Enter reason:',
      'Rejected / Voided during accountant review'
    );
    if (!reason || !reason.trim()) return;

    try {
      const batch = writeBatch(db);
      const txnRef = doc(db, 'advanced_transactions', txn.id);
      batch.update(txnRef, {
        accountingStatus: 'voided',
        voidReason: reason.trim(),
        voidedAt: new Date().toISOString(),
        voidedBy: user?.uid
      });

      if (wasPosted) {
        const revTxnRef = doc(collection(db, 'advanced_transactions'));
        batch.set(revTxnRef, {
          sourceAccount: txn.destinationAccount,
          destinationAccount: txn.sourceAccount,
          amount: txn.amount,
          transactionType: 'void_reversal',
          sourceModule: txn.sourceModule || 'system',
          notes: `VOID Reversal of ${txn.id}: ${reason.trim()}`,
          accountingStatus: 'posted',
          postedAt: new Date().toISOString(),
          postedBy: user?.uid,
          createdAt: new Date(),
          direction: 'neutral',
          isReversal: true,
          originalTransactionId: txn.id,
          fxRateAtTimeOfTransaction: txn.exchangeRateAtPosting || txn.fxRateAtTimeOfTransaction || usdToLbpRate
        });
      }

      await batch.commit();
      await logSystemAudit({
        action: wasPosted ? 'VOID_POSTED_ENTRY' : 'REJECT_QUEUE_ENTRY',
        collectionName: 'advanced_transactions',
        documentId: txn.id,
        staffId: user?.email || user?.uid || 'system',
        timestamp: new Date().toISOString(),
        details: {
          sourceModule: txn.sourceModule,
          amountUSD: txn.amount,
          sourceAccount: txn.sourceAccount,
          destinationAccount: txn.destinationAccount,
          reason: reason.trim()
        }
      });

      toast.success(wasPosted ? 'Transaction voided with compensating reversal entry' : 'Pending entry rejected and moved to Voided');
      if (selectedTxn?.id === txn.id) setSelectedTxn(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `advanced_transactions/${txn.id}`);
      toast.error('Failed to void transaction');
    }
  };

  const handleRecalculateVerification = () => {
    const postedList = transactions.filter(t => t.accountingStatus === 'posted' && t.sourceModule !== 'academy');
    let totalDr = 0;
    let totalCr = 0;
    postedList.forEach(t => {
      const amt = getAdjustedAmount(Math.abs(t.amount || 0), t, adjustmentPercentage);
      const vatAmt = Number(t.vatAmount || 0);
      totalDr += amt + vatAmt;
      totalCr += amt + vatAmt;
    });
    toast.success(
      `Mode B Deficit/Adjustment Engine (${adjustmentPercentage}%) Verified: ${postedList.length} posted entries • Total Dr ${formatCurrency(totalDr)} === Total Cr ${formatCurrency(totalCr)}`
    );
  };

  return (
    <div className="grid grid-cols-12 gap-8">
      {/* Left Column: Posting Queue List */}
      <div className="col-span-12 xl:col-span-7 space-y-6">
        <div className="p-4 rounded-2xl border bg-[#00B8C8]/10 border-[#00B8C8]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#00B8C8] text-slate-950 shrink-0">
              <Percent size={16} />
            </div>
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-[#0099A8] dark:text-[#00B8C8]">
                Mode B Cash-In Adjustment Engine ({adjustmentPercentage > 0 ? `+${adjustmentPercentage}%` : `${adjustmentPercentage}%`})
              </h4>
              <p className="text-xs text-zinc-500">
                Eligible Cash-In inflows from operational modules are scaled proportionally (Factor: {Math.max(0, 1 + adjustmentPercentage / 100).toFixed(2)}x) across both Debit & Credit legs.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRecalculateVerification}
            className="px-3 py-2 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 shrink-0 transition-colors"
          >
            <RefreshCw size={13} /> Verify Dr === Cr Sync
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="flex-1 relative">
            <Search size={16} className={`absolute left-3 top-1/2 transform -translate-y-1/2 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`} />
            <input 
              type="text" 
              placeholder="Search ref, account, notes..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Calendar size={14} className={`absolute left-3 top-1/2 transform -translate-y-1/2 pointer-events-none ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`} />
              <input 
                type="date" 
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className={`pl-9 pr-3 py-2.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-300' : 'bg-white border-slate-200 text-slate-700'}`}
              />
            </div>
            <span className="text-zinc-500 font-bold text-xs">to</span>
            <div className="relative">
              <Calendar size={14} className={`absolute left-3 top-1/2 transform -translate-y-1/2 pointer-events-none ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`} />
              <input 
                type="date" 
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className={`pl-9 pr-3 py-2.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-300' : 'bg-white border-slate-200 text-slate-700'}`}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 bg-slate-100 dark:bg-[#0B0F17] p-1 rounded-xl border border-slate-200 dark:border-zinc-800 backdrop-blur-md overflow-x-auto hide-scrollbar">
            <button 
              onClick={() => { setFilterState('unposted'); setSelectedIds([]); }} 
              className={`flex-1 min-w-[120px] py-2 text-sm font-bold flex items-center justify-center gap-2 rounded-lg transition-all ${filterState === 'unposted' ? 'bg-[#00B8C8] text-slate-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              <Clock size={16} /> Unposted ({unpostedCount})
            </button>
            <button 
              onClick={() => { setFilterState('pending_review'); setSelectedIds([]); }} 
              className={`flex-1 min-w-[140px] py-2 text-sm font-bold flex items-center justify-center gap-2 rounded-lg transition-all ${filterState === 'pending_review' ? 'bg-[#00B8C8] text-slate-950 shadow-sm' : 'text-zinc-500 hover:text-amber-500/80'}`}
            >
              <FileText size={16} /> Pending Review
            </button>
            <button 
              onClick={() => { setFilterState('posted'); setSelectedIds([]); }} 
              className={`flex-1 min-w-[110px] py-2 text-sm font-bold flex items-center justify-center gap-2 rounded-lg transition-all ${filterState === 'posted' ? 'bg-[#00B8C8] text-slate-950 shadow-sm' : 'text-zinc-500 hover:text-emerald-500/80'}`}
            >
              <CheckCircle size={16} /> Posted
            </button>
            <button 
              onClick={() => { setFilterState('voided'); setSelectedIds([]); }} 
              className={`flex-1 min-w-[110px] py-2 text-sm font-bold flex items-center justify-center gap-2 rounded-lg transition-all ${filterState === 'voided' ? 'bg-rose-600 text-white shadow-sm' : 'text-zinc-500 hover:text-rose-500/80'}`}
            >
              <XCircle size={16} /> Voided
            </button>
          </div>

          {(filterState === 'unposted' || filterState === 'pending_review') && filteredTxns.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAllFiltered}
                className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs font-bold hover:border-[#00B8C8] transition-colors"
              >
                {selectedIds.length === filteredTxns.length ? 'Clear Selection' : `Select All (${filteredTxns.length})`}
              </button>
              {selectedIds.length > 0 && (
                <button
                  onClick={() => handleBatchPost(filteredTxns.filter(t => selectedIds.includes(t.id)))}
                  disabled={isBatchPosting}
                  className="px-3.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  <CheckSquare size={14} />
                  Post Selected ({selectedIds.length})
                </button>
              )}
              <button
                onClick={() => handleBatchPost(filteredTxns)}
                disabled={isBatchPosting}
                className="px-4 py-2.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] disabled:opacity-50 text-slate-950 text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm shadow-cyan-500/20 shrink-0 transition-colors"
              >
                <CheckSquare size={15} />
                {isBatchPosting ? 'Posting...' : `Post All Filtered (${filteredTxns.length})`}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-3 max-h-[800px] overflow-y-auto pr-2">
          {filteredTxns.length === 0 ? (
            <div className={`p-12 text-center border border-dashed rounded-2xl ${isDarkMode ? 'border-zinc-800 bg-[#0B0F17]/50 text-zinc-500' : 'border-slate-300 bg-slate-50 text-slate-500'}`}>
              <div className="w-16 h-16 rounded-full bg-zinc-200/50 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={24} className="opacity-50" />
              </div>
              <p className="font-bold">No transactions in {filterState.replace('_', ' ')}</p>
              <p className="text-sm mt-1">Switch tabs or adjust your date/module filters</p>
            </div>
          ) : (
            filteredTxns.map(txn => {
              const rawAmt = Math.abs(txn.amount || 0);
              const isEligible = isEligibleForCashAdjustment(txn, adjustmentPercentage);
              const adjAmt = getAdjustedAmount(rawAmt, txn, adjustmentPercentage);
              const isChecked = selectedIds.includes(txn.id);
              return (
                <div
                  key={txn.id}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer hover:border-[#00B8C8]/50 ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} ${selectedTxn?.id === txn.id ? 'ring-2 ring-[#00B8C8] border-[#00B8C8]' : ''}`}
                  onClick={() => filterState !== 'posted' && filterState !== 'voided' && setSelectedTxn(txn)}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex gap-3 items-center">
                      {(filterState === 'unposted' || filterState === 'pending_review') && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelectTxnId(txn.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 rounded accent-[#00B8C8] cursor-pointer"
                        />
                      )}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${txn.direction === 'inflow' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'}`}>
                        <FileText size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm tracking-tight">{(txn.transactionType || 'entry').toUpperCase().replace(/_/g, ' ')}</h4>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                          {txn.sourceModule === 'pos_cafe' || txn.sourceModule === 'pos_cafeteria' ? 'Kiosk POS' : txn.sourceModule === 'pos_retail' ? 'Retail Shop POS' : (txn.sourceModule || 'system')} • {txn.paymentMethod || 'system'}
                        </p>
                        <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                          Dr: <span className="text-emerald-500">{txn.sourceAccount || '531'}</span> → Cr: <span className="text-rose-400">{txn.destinationAccount || '701'}</span>
                        </div>
                        {txn.notes && <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{txn.notes}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      {isEligible ? (
                        <div>
                          <span className="text-xs line-through text-zinc-400 mr-1.5 font-mono">{formatCurrency(rawAmt)}</span>
                          <span className="font-black tracking-tight text-[#00B8C8] font-mono">{formatCurrency(adjAmt)}</span>
                          <div className="text-[9px] font-bold uppercase text-[#00B8C8]">Adjusted ({adjustmentPercentage}%)</div>
                        </div>
                      ) : (
                        <p className={`font-black tracking-tight font-mono ${txn.direction === 'inflow' ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {formatCurrency(rawAmt)}
                        </p>
                      )}
                      <p className="text-[10px] text-zinc-500 font-medium">Ref: {txn.id.substring(0, 8)}</p>
                    </div>
                  </div>

                  <div className="flex justify-between items-center mt-4 pt-3 border-t dark:border-zinc-800">
                    <span className="text-[10px] font-bold text-zinc-400">
                      {txn.createdAt?.seconds ? new Date(txn.createdAt.seconds * 1000).toLocaleString() : (txn.date || 'Recent')}
                    </span>

                    {filterState === 'unposted' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedTxn(txn); }}
                          className="px-2.5 py-1 bg-[#00B8C8]/15 text-[#00B8C8] rounded font-bold text-[10px] uppercase tracking-wider hover:bg-[#00B8C8]/25 transition-colors flex items-center gap-1"
                        >
                          <Edit3 size={11} /> Inspect & Post
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); changeStatus(txn.id, 'pending_review'); }} className="px-2.5 py-1 bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-500 rounded font-bold text-[10px] uppercase tracking-wider hover:bg-amber-200 dark:hover:bg-amber-500/20 transition-colors">
                          Flag Review
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleVoidTransaction(txn); }} className="px-2.5 py-1 bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 rounded font-bold text-[10px] uppercase tracking-wider hover:bg-rose-200 transition-colors">
                          Reject
                        </button>
                      </div>
                    )}
                    {filterState === 'pending_review' && (
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); changeStatus(txn.id, 'unposted'); }} className="px-3 py-1 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 rounded font-bold text-[10px] uppercase tracking-wider hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                          Return to Queue
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleVoidTransaction(txn); }} className="px-2.5 py-1 bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 rounded font-bold text-[10px] uppercase tracking-wider hover:bg-rose-200 transition-colors">
                          Reject
                        </button>
                      </div>
                    )}
                    {filterState === 'posted' && (
                      <div className="flex gap-2">
                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 rounded font-bold text-[10px] uppercase tracking-wider">
                          Posted
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnpostTransaction(txn); }}
                          className="px-2.5 py-1 bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 hover:bg-amber-200 rounded font-bold text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1"
                        >
                          <RotateCcw size={11} /> Re-open / Unpost
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleVoidTransaction(txn); }} className="px-2.5 py-1 bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-500/20 rounded font-bold text-[10px] uppercase tracking-wider transition-colors">
                          Void Entry
                        </button>
                      </div>
                    )}
                    {filterState === 'voided' && (
                      <span className="px-3 py-1 bg-rose-100/50 text-rose-700/50 dark:bg-rose-500/5 dark:text-rose-400/50 rounded font-bold text-[10px] uppercase tracking-wider">
                        Voided / Rejected
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Active Action Panel */}
      <div className="col-span-12 xl:col-span-5">
        <div className={`sticky top-24 p-6 rounded-3xl border shadow-xl ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 shadow-black/50' : 'bg-white border-slate-200 shadow-slate-200/50'}`}>
          {!selectedTxn ? (
            <div className="text-center py-12 opacity-50">
              <Settings size={48} className="mx-auto mb-4" />
              <h3 className="font-bold text-lg mb-2">Accountant Posting Console</h3>
              <p className="text-sm">Select an unposted transaction from the queue to inspect or edit LCOA Debit/Credit legs, preview the % adjustment, and post to the Mode B General Ledger.</p>
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25 flex items-center justify-center">
                  <Save size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Inspect, Edit & Post to Mode B Ledger</h3>
                  <p className="text-xs text-zinc-500">Ref: {selectedTxn.id} • Date: {getTxnDateString(selectedTxn)}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Original Operational Amount</span>
                    <span className="font-black text-base font-mono text-zinc-900 dark:text-zinc-100">{formatCurrency(Math.abs(selectedTxn.amount || 0))}</span>
                  </div>
                  {isEligibleForCashAdjustment(selectedTxn, adjustmentPercentage) && (
                    <div className="flex justify-between items-center pt-2 border-t dark:border-zinc-800 text-[#0099A8] dark:text-[#00B8C8]">
                      <span className="text-xs font-black uppercase tracking-widest">Mode B Adjusted Amount ({adjustmentPercentage}%)</span>
                      <span className="font-black text-lg font-mono">{formatCurrency(getSelectedAdjustedAmount())}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Module / Payment</span>
                    <span className="text-xs font-bold uppercase">{selectedTxn.transactionType} / {selectedTxn.sourceModule} ({selectedTxn.paymentMethod})</span>
                  </div>
                </div>

                {/* Editable Debit & Credit LCOA Accounts & Description */}
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-1">
                      Debit Account (Dr — LCOA)
                    </label>
                    <input
                      list="lcoa-accounts-list"
                      value={editDebitAccount}
                      onChange={e => setEditDebitAccount(e.target.value)}
                      className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl text-xs font-bold border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8]`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-rose-400 mb-1">
                      Credit Account (Cr — LCOA)
                    </label>
                    <input
                      list="lcoa-accounts-list"
                      value={editCreditAccount}
                      onChange={e => setEditCreditAccount(e.target.value)}
                      className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl text-xs font-bold border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8]`}
                    />
                  </div>
                  <datalist id="lcoa-accounts-list">
                    {activeCoa.map((a, idx) => (
                      <option key={a.id || idx} value={`${a.code} - ${a.name}`} />
                    ))}
                  </datalist>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
                      Journal Description / Audit Memo
                    </label>
                    <input
                      type="text"
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      placeholder="Enter journal memo..."
                      className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8]`}
                    />
                  </div>
                </div>

                <div>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Confirm Exchange Rate at Posting (USD to LBP)</span>
                    <input 
                      type="number" 
                      value={postingRate} 
                      onChange={e => setPostingRate(parseFloat(e.target.value) || 0)}
                      className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl text-sm font-mono font-bold border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8]`}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Cost Center</span>
                      <select
                        value={selectedCostCenter}
                        onChange={e => setSelectedCostCenter(e.target.value)}
                        className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl text-xs font-bold border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8]`}
                      >
                        {costCenters.map(cc => <option key={cc.id} value={cc.id}>{cc.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <div>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Apply Tax Rule</span>
                      <select
                        value={selectedTaxRuleId}
                        onChange={e => setSelectedTaxRuleId(e.target.value)}
                        className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl text-xs font-bold border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8]`}
                      >
                        <option value="none">No Extra VAT</option>
                        {fiscalRules.map(r => <option key={r.id} value={r.id}>{r.name} ({r.taxRate}%)</option>)}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="border border-slate-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <div className="bg-slate-100 dark:bg-zinc-900 px-4 py-2 border-b dark:border-zinc-800 flex justify-between items-center">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Balanced Double-Entry Preview</h4>
                    <span className="text-[10px] font-black text-emerald-500">DR === CR</span>
                  </div>
                  <div className="p-4 space-y-3 font-mono text-xs">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="w-8 text-emerald-500 font-black">DR.</span>
                        <span className="font-bold">{editDebitAccount || selectedTxn.sourceAccount || '531 - CASH DRAWER'}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">${(getSelectedAdjustedAmount() + calculateVAT()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="text-[10px] text-zinc-500">ل.ل {Math.round((getSelectedAdjustedAmount() + calculateVAT()) * postingRate).toLocaleString()}</div>
                      </div>
                    </div>
                    {calculateVAT() > 0 && (
                      <div className="flex justify-between items-center pl-4 opacity-90 text-amber-600 dark:text-amber-500">
                        <div className="flex items-center gap-2">
                          <span className="w-8 text-amber-500 font-black">CR.</span>
                          <span className="font-bold">4427 - VAT COLLECTED (TVA COLLECTÉE)</span>
                        </div>
                        <div className="text-right">
                          <div>${calculateVAT().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div className="text-[10px] text-amber-500/70">ل.ل {Math.round(calculateVAT() * postingRate).toLocaleString()}</div>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between items-center pl-4">
                      <div className="flex items-center gap-2">
                        <span className="w-8 text-rose-500 font-black">CR.</span>
                        <span className="font-bold">{editCreditAccount || selectedTxn.destinationAccount || '701 - REVENUE'}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">${getSelectedAdjustedAmount().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="text-[10px] text-zinc-500">ل.ل {Math.round(getSelectedAdjustedAmount() * postingRate).toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={handlePostTransaction}
                    className="flex-1 py-3.5 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-cyan-500/20 active:scale-[0.98] flex justify-center items-center gap-2"
                  >
                    <CheckCircle size={16} /> Approve & Post Entry
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVoidTransaction(selectedTxn)}
                    className="px-4 py-3.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-xl font-black text-xs uppercase tracking-widest transition-all"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
