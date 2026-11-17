import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { Target, TrendingDown, TrendingUp, Plus } from 'lucide-react';

interface Props {
  isDarkMode: boolean;
  formatCurrency: (amount: number) => string;
}

export const BudgetModule: React.FC<Props> = ({ isDarkMode, formatCurrency }) => {
  const { user, handleFirestoreError } = useFirebase();
  const [budgets, setBudgets] = useState<any[]>([]);
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ category: '', amount: '0' });

  useEffect(() => {
    if (!user) return;
    const q1 = query(collection(db, 'budgets'));
    const unsub1 = onSnapshot(q1, snap => {
      setBudgets(snap.docs.map(d => ({id: d.id, ...d.data()})));
    }, error => handleFirestoreError(error, OperationType.LIST, 'budgets'));

    const q2 = query(collection(db, 'advanced_transactions'));
    const unsub2 = onSnapshot(q2, snap => {
      // Calculate actuals based on source/destination account
      // Note: In real app, this needs careful aggregation matching budget categories
      const totals: Record<string, number> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.accountingStatus === 'posted' && data.transactionType === 'expense') {
           const cat = data.destinationAccount || 'general'; // simplistic mapping
           totals[cat] = (totals[cat] || 0) + Math.abs(data.amount);
        }
      });
      setActuals(totals);
    }, error => handleFirestoreError(error, OperationType.LIST, 'advanced_transactions'));

    return () => { unsub1(); unsub2(); };
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'budgets'), {
        category: formData.category,
        targetAmount: parseFloat(formData.amount),
        createdAt: new Date(),
      });
      setIsAdding(false);
      setFormData({ category: '', amount: '0' });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'budgets');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25 rounded-xl">
            <Target size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Budgets vs Actuals</h2>
            <p className="text-sm text-zinc-500">Track spending variance</p>
          </div>
        </div>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${isAdding ? 'bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300' : 'bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 shadow-sm shadow-cyan-500/20'}`}
        >
          {isAdding ? 'Cancel' : <><Plus size={16} /> Set Budget</>}
        </button>
      </div>

      {isAdding && (
         <form onSubmit={handleSubmit} className={`p-6 rounded-3xl border shadow-xl ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} mb-8`}>
           <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Category / Account</label>
                <input required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl border focus:border-[#00B8C8] outline-none`} placeholder="e.g. Marketing" />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Budget Target (Yearly)</label>
                <input type="number" required value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className={`w-full ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl border focus:border-[#00B8C8] outline-none`} placeholder="5000" />
              </div>
              <button type="submit" className="py-2.5 px-6 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-xl text-sm font-bold shadow-sm shadow-cyan-500/20 transition-colors">Set Target</button>
           </div>
         </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {budgets.map(budget => {
          const act = actuals[budget.category] || 0;
          const variance = budget.targetAmount - act;
          const pct = Math.min(100, Math.round((act / budget.targetAmount) * 100));
          const isOver = pct > 100;

          return (
            <div key={budget.id} className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} relative overflow-hidden`}>
              <div className="absolute top-0 left-0 w-full h-1 bg-slate-200 dark:bg-zinc-800">
                <div className={`h-full ${isOver ? 'bg-rose-500' : 'bg-[#00B8C8]'}`} style={{ width: `${pct}%`}} />
              </div>
              <div className="mt-2">
                <h4 className="font-bold text-lg uppercase tracking-tight">{budget.category}</h4>
                <div className="mt-4 flex justify-between items-end">
                   <div>
                     <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Spent</p>
                     <p className={`font-mono text-xl font-black ${isOver ? 'text-rose-500' : ''}`}>{formatCurrency(act)}</p>
                   </div>
                   <div className="text-right">
                     <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Budget</p>
                     <p className="font-mono text-sm text-zinc-400">{formatCurrency(budget.targetAmount)}</p>
                   </div>
                </div>
                <div className={`mt-4 flex items-center justify-between text-xs font-bold px-3 py-2 rounded-lg ${
                  isOver 
                    ? (isDarkMode ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-600')
                    : (isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600')
                }`}>
                  <span className="flex items-center gap-1">
                    {isOver ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {Math.abs(variance).toLocaleString()} ({pct}%)
                  </span>
                  <span>{isOver ? 'Over Budget' : 'Remaining'}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  );
}
