import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { Clock, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  isDarkMode: boolean;
  formatCurrency: (amount: number) => string;
}

export const AccrualsModule: React.FC<Props> = ({ isDarkMode, formatCurrency }) => {
  const { user, handleFirestoreError, usdToLbpRate } = useFirebase();
  const [accruals, setAccruals] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    totalValue: '',
    months: '12',
    account: '613 - Facility Rent & Maintenance'
  });

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'accruals'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setAccruals(snap.docs.map(d => ({id: d.id, ...d.data()})));
    }, error => handleFirestoreError(error, OperationType.LIST, 'accruals'));
    return () => unsub();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'accruals'), {
        name: formData.name,
        totalValue: parseFloat(formData.totalValue),
        months: parseInt(formData.months),
        monthlyAmount: parseFloat(formData.totalValue) / parseInt(formData.months),
        expenseAccount: formData.account,
        createdAt: new Date(),
        status: 'active'
      });
      toast.success('Accrual/Prepayment schedule added');
      setIsAdding(false);
      setFormData({ name: '', totalValue: '', months: '12', account: '613 - Facility Rent & Maintenance' });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'accruals');
    }
  };

  const handlePostAccrual = async (accrual: any) => {
    try {
      const batch = writeBatch(db);
      const txnRef = doc(collection(db, 'transactions'));
      const advTxnRef = doc(db, 'advanced_transactions', txnRef.id);

      // Debit Expense (sourceAccount), Credit Prepaid Asset (destinationAccount)
      const entryData = {
        amount: accrual.monthlyAmount,
        subtotal: accrual.monthlyAmount,
        discount: 0,
        total: accrual.monthlyAmount,
        paymentMethod: 'system',
        transactionType: 'amortization',
        sourceAccount: accrual.expenseAccount || '613 - Facility Rent & Maintenance',
        destinationAccount: 'prepaid_expenses_asset',
        sourceModule: 'accruals',
        cashierId: user?.uid || 'system',
        referenceId: accrual.id,
        notes: `Monthly amortization for ${accrual.name}`,
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

      await batch.commit();
      toast.success(`Monthly amortization posted for ${accrual.name}`);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'advanced_transactions');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25 rounded-xl">
            <Clock size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Accruals & Prepayments</h2>
            <p className="text-sm text-zinc-500">Amortize large yearly expenses over 12 months</p>
          </div>
        </div>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${isAdding ? 'bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300' : 'bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 shadow-sm shadow-cyan-500/20'}`}
        >
          {isAdding ? 'Cancel' : <><Plus size={16} /> New Schedule</>}
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleSubmit} className={`p-6 rounded-3xl border shadow-xl ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} mb-8`}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
               <div className="lg:col-span-2">
                 <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Description</label>
                 <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2.5 px-4 rounded-xl text-sm border focus:border-[#00B8C8] outline-none`} placeholder="e.g. Yearly Rent 2026" />
               </div>
               <div>
                 <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Total Paid ($)</label>
                 <input type="number" required value={formData.totalValue} onChange={e => setFormData({...formData, totalValue: e.target.value})} className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2.5 px-4 rounded-xl text-sm border focus:border-[#00B8C8] outline-none`} placeholder="12000" />
               </div>
               <div>
                 <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Months to Amortize</label>
                 <input type="number" required value={formData.months} onChange={e => setFormData({...formData, months: e.target.value})} className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2.5 px-4 rounded-xl text-sm border focus:border-[#00B8C8] outline-none`} placeholder="12" />
               </div>
               <div className="flex items-end">
                 <button type="submit" className="w-full py-2.5 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-xl text-sm font-bold shadow-sm shadow-cyan-500/20 transition-colors">Add</button>
               </div>
            </div>
        </form>
      )}

      <div className={`rounded-3xl border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
        <table className="w-full text-left">
          <thead className={`border-b ${isDarkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-slate-100 bg-slate-50'}`}>
            <tr>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Item</th>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Total Value</th>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Duration</th>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Monthly Hit</th>
              <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {accruals.length === 0 ? (
               <tr><td colSpan={5} className="p-8 text-center text-zinc-500 font-medium">No accruals registered.</td></tr>
            ) : accruals.map(item => (
              <tr key={item.id} className={`border-b last:border-0 ${isDarkMode ? 'border-zinc-800 hover:bg-zinc-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                 <td className="p-4 font-bold">{item.name}</td>
                 <td className="p-4 font-mono font-black">{formatCurrency(item.totalValue)}</td>
                 <td className="p-4 text-zinc-500">{item.months} mos</td>
                 <td className="p-4 font-mono font-bold text-[#0099A8] dark:text-[#00B8C8]">{formatCurrency(item.monthlyAmount)}</td>
                 <td className="p-4 text-right">
                    <button onClick={() => handlePostAccrual(item)} className="px-3 py-1.5 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg text-xs font-bold transition-colors">
                      Post Monthly JV
                    </button>
                 </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
