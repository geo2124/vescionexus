import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, addDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { Plus, Calculator, Sparkles, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  isDarkMode: boolean;
  globalCurrency: 'USD' | 'LBP';
  formatCurrency: (amount: number) => string;
}

export const DepreciationModule: React.FC<Props> = ({ isDarkMode, formatCurrency }) => {
  const { user, handleFirestoreError, usdToLbpRate } = useFirebase();
  const [assets, setAssets] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isRunningBatch, setIsRunningBatch] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    purchaseValue: '',
    lifespanMonths: '60',
    purchaseDate: new Date().toISOString().substring(0, 10),
    salvageValue: '0'
  });

  const currentMonth = new Date().toISOString().substring(0, 7);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'fixed_assets'), orderBy('purchaseDate', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setAssets(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, error => handleFirestoreError(error, OperationType.LIST, 'fixed_assets'));
    return () => unsub();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const purchaseVal = parseFloat(formData.purchaseValue) || 0;
      const salvageVal = parseFloat(formData.salvageValue) || 0;
      const lifespan = Math.max(1, parseInt(formData.lifespanMonths) || 60);
      const assetRef = await addDoc(collection(db, 'fixed_assets'), {
        name: formData.name,
        purchaseValue: purchaseVal,
        lifespanMonths: lifespan,
        purchaseDate: formData.purchaseDate,
        salvageValue: salvageVal,
        monthlyDepreciation: (purchaseVal - salvageVal) / lifespan,
        accumulatedDepreciation: 0,
        lastDepreciatedMonth: '',
        createdAt: new Date(),
        status: 'active'
      });

      // Also record Fixed Asset Acquisition on the ledger (Dr 215 Equipment, Cr 512 Bank/Capital)
      const batch = writeBatch(db);
      const txnRef = doc(collection(db, 'transactions'));
      const advTxnRef = doc(db, 'advanced_transactions', txnRef.id);
      const acqData = {
        amount: purchaseVal,
        subtotal: purchaseVal,
        discount: 0,
        total: purchaseVal,
        paymentMethod: 'bank_transfer',
        transactionType: 'asset_acquisition',
        sourceAccount: '215 - Sports & Gym Equipment',
        destinationAccount: '512 - Bank Accounts (Fresh USD / LBP)',
        sourceModule: 'fixed_assets',
        cashierId: user?.uid || 'system',
        referenceId: assetRef.id,
        notes: `Fixed Asset Acquisition: ${formData.name}`,
        createdAt: serverTimestamp(),
        direction: 'neutral',
        fxRateAtTimeOfTransaction: usdToLbpRate
      };
      batch.set(txnRef, acqData);
      batch.set(advTxnRef, {
        ...acqData,
        accountingStatus: 'posted',
        postedAt: new Date().toISOString(),
        postedBy: user?.uid
      });
      await batch.commit();

      toast.success('Fixed Asset registered and capitalized to LCOA Class 2 (215)');
      setIsAdding(false);
      setFormData({
        name: '',
        purchaseValue: '',
        lifespanMonths: '60',
        purchaseDate: new Date().toISOString().substring(0, 10),
        salvageValue: '0'
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'fixed_assets');
    }
  };

  const handlePostDepreciation = async (asset: any) => {
    try {
      const batch = writeBatch(db);
      const txnRef = doc(collection(db, 'transactions'));
      const advTxnRef = doc(db, 'advanced_transactions', txnRef.id);
      const monthlyDepr = Number(asset.monthlyDepreciation || 0);
      const newAccum = Math.min(Number(asset.purchaseValue || 0), Number(asset.accumulatedDepreciation || 0) + monthlyDepr);

      // Dr 681 Depreciation Expense (sourceAccount), Cr 281 Accumulated Depreciation (destinationAccount)
      const entryData = {
        amount: monthlyDepr,
        subtotal: monthlyDepr,
        discount: 0,
        total: monthlyDepr,
        paymentMethod: 'system',
        transactionType: 'depreciation',
        sourceAccount: '681 - Depreciation & Amortization Expense',
        destinationAccount: '281 - Accumulated Depreciation',
        sourceModule: 'fixed_assets',
        cashierId: user?.uid || 'system',
        referenceId: asset.id,
        notes: `Monthly depreciation (${currentMonth}) for ${asset.name}`,
        createdAt: serverTimestamp(),
        direction: 'outflow',
        fxRateAtTimeOfTransaction: usdToLbpRate
      };

      batch.set(txnRef, entryData);
      batch.set(advTxnRef, {
        ...entryData,
        accountingStatus: 'posted',
        postedAt: new Date().toISOString(),
        postedBy: user?.uid
      });
      batch.update(doc(db, 'fixed_assets', asset.id), {
        lastDepreciatedMonth: currentMonth,
        accumulatedDepreciation: newAccum
      });

      await batch.commit();
      toast.success(`Monthly Depreciation JV posted for ${asset.name}`);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'advanced_transactions');
    }
  };

  const handleBatchMonthlyDepreciationRun = async () => {
    const dueAssets = assets.filter(
      a => a.status !== 'disposed' && a.lastDepreciatedMonth !== currentMonth && Number(a.monthlyDepreciation || 0) > 0
    );
    if (dueAssets.length === 0) {
      toast.info(`All active fixed assets have already been depreciated for ${currentMonth}!`);
      return;
    }

    setIsRunningBatch(true);
    try {
      const batch = writeBatch(db);
      let totalRunDepr = 0;

      dueAssets.forEach(asset => {
        const monthlyDepr = Number(asset.monthlyDepreciation || 0);
        const newAccum = Math.min(Number(asset.purchaseValue || 0), Number(asset.accumulatedDepreciation || 0) + monthlyDepr);
        totalRunDepr += monthlyDepr;

        const txnRef = doc(collection(db, 'transactions'));
        const advTxnRef = doc(db, 'advanced_transactions', txnRef.id);

        const entryData = {
          amount: monthlyDepr,
          subtotal: monthlyDepr,
          discount: 0,
          total: monthlyDepr,
          paymentMethod: 'system',
          transactionType: 'depreciation',
          sourceAccount: '681 - Depreciation & Amortization Expense',
          destinationAccount: '281 - Accumulated Depreciation',
          sourceModule: 'fixed_assets',
          cashierId: user?.uid || 'system',
          referenceId: asset.id,
          notes: `Monthly Batch Depreciation (${currentMonth}) — ${asset.name}`,
          createdAt: serverTimestamp(),
          direction: 'outflow',
          fxRateAtTimeOfTransaction: usdToLbpRate
        };

        batch.set(txnRef, entryData);
        batch.set(advTxnRef, {
          ...entryData,
          accountingStatus: 'posted',
          postedAt: new Date().toISOString(),
          postedBy: user?.uid
        });
        batch.update(doc(db, 'fixed_assets', asset.id), {
          lastDepreciatedMonth: currentMonth,
          accumulatedDepreciation: newAccum
        });
      });

      await batch.commit();
      toast.success(
        `1-Click Monthly Depreciation Run (${currentMonth}) complete: ${dueAssets.length} asset(s), Total ${formatCurrency(totalRunDepr)} posted to LCOA 681 / 281!`
      );
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'advanced_transactions');
    } finally {
      setIsRunningBatch(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25 rounded-xl">
            <Calculator size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Assets & Depreciation (LCOA Class 2 & 681)</h2>
            <p className="text-sm text-zinc-500">Fixed asset register, Net Book Value (NBV), and 1-click monthly depreciation runs</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleBatchMonthlyDepreciationRun}
            disabled={isRunningBatch}
            className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white shadow-sm shadow-amber-500/20 disabled:opacity-50"
          >
            <Sparkles size={15} /> 1-Click Monthly Depr. Run ({currentMonth})
          </button>
          <button 
            onClick={() => setIsAdding(!isAdding)}
            className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${isAdding ? 'bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300' : 'bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 shadow-sm shadow-cyan-500/20'}`}
          >
            {isAdding ? 'Cancel' : <><Plus size={16} /> Register Asset</>}
          </button>
        </div>
      </div>

      {isAdding && (
        <form onSubmit={handleSubmit} className={`p-6 rounded-3xl border shadow-xl ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} mb-8`}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
               <div className="lg:col-span-2">
                 <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Asset Name</label>
                 <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2.5 px-4 rounded-xl text-sm border focus:border-[#00B8C8] outline-none`} placeholder="e.g. Commercial Treadmill" />
               </div>
               <div>
                 <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Purchase Value ($)</label>
                 <input type="number" required value={formData.purchaseValue} onChange={e => setFormData({...formData, purchaseValue: e.target.value})} className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2.5 px-4 rounded-xl text-sm border focus:border-[#00B8C8] outline-none`} placeholder="10000" />
               </div>
               <div>
                 <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Lifespan (Months)</label>
                 <input type="number" required value={formData.lifespanMonths} onChange={e => setFormData({...formData, lifespanMonths: e.target.value})} className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2.5 px-4 rounded-xl text-sm border focus:border-[#00B8C8] outline-none`} placeholder="60" />
               </div>
               <div className="flex items-end">
                 <button type="submit" className="w-full py-2.5 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-xl text-sm font-bold shadow-sm shadow-cyan-500/20 transition-colors">Add Asset</button>
               </div>
            </div>
        </form>
      )}

      <div className={`rounded-3xl border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
        <table className="w-full text-left">
          <thead className={`border-b ${isDarkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-slate-100 bg-slate-50'}`}>
            <tr>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Asset</th>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Cost Basis (215)</th>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Accum. Depr. (281)</th>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Net Book Value</th>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Monthly Depr. (681)</th>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {assets.length === 0 ? (
               <tr><td colSpan={6} className="p-8 text-center text-zinc-500 font-medium">No assets registered yet.</td></tr>
            ) : assets.map(asset => {
              const cost = Number(asset.purchaseValue || 0);
              const accum = Number(asset.accumulatedDepreciation || 0);
              const nbv = Math.max(0, cost - accum);
              const isRunThisMonth = asset.lastDepreciatedMonth === currentMonth;
              return (
              <tr key={asset.id} className={`border-b last:border-0 ${isDarkMode ? 'border-zinc-800 hover:bg-zinc-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                 <td className="p-4">
                   <div className="font-bold">{asset.name}</div>
                   <div className="text-xs text-zinc-500">{asset.lifespanMonths} mos • Acq: {asset.purchaseDate}</div>
                 </td>
                 <td className="p-4 font-mono font-black">{formatCurrency(cost)}</td>
                 <td className="p-4 font-mono text-rose-500">{formatCurrency(accum)}</td>
                 <td className="p-4 font-mono font-bold text-emerald-500">{formatCurrency(nbv)}</td>
                 <td className="p-4 font-mono font-bold text-[#0099A8] dark:text-[#00B8C8]">{formatCurrency(asset.monthlyDepreciation)}</td>
                 <td className="p-4 text-right">
                    {isRunThisMonth ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-500 text-xs font-bold">
                        <CheckCircle2 size={13} /> Posted ({currentMonth})
                      </span>
                    ) : (
                      <button onClick={() => handlePostDepreciation(asset)} className="px-3 py-1.5 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg text-xs font-bold transition-colors">
                        Post Monthly Depr. JV
                      </button>
                    )}
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
