import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { Users, AlertTriangle } from 'lucide-react';
import { differenceInDays } from 'date-fns';

interface Props {
  isDarkMode: boolean;
  formatCurrency: (amount: number) => string;
}

export const APARModule: React.FC<Props> = ({ isDarkMode, formatCurrency }) => {
  const { user, handleFirestoreError } = useFirebase();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsubInv = onSnapshot(query(collection(db, 'invoices')), snap => {
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, error => handleFirestoreError(error, OperationType.LIST, 'invoices'));

    const unsubExp = onSnapshot(query(collection(db, 'expenses')), snap => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, error => handleFirestoreError(error, OperationType.LIST, 'expenses'));

    const unsubMem = onSnapshot(query(collection(db, 'members')), snap => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, error => handleFirestoreError(error, OperationType.LIST, 'members'));

    return () => {
      unsubInv();
      unsubExp();
      unsubMem();
    };
  }, [user]);

  const calculateAging = (type: 'receivable' | 'payable') => {
    const buckets = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
      total: 0
    };

    const addBucket = (dateStr: string | undefined, amount: number) => {
      if (amount <= 0) return;
      const refDate = dateStr ? new Date(dateStr) : new Date();
      const daysOverdue = Math.max(0, isNaN(refDate.getTime()) ? 0 : differenceInDays(new Date(), refDate));
      if (daysOverdue <= 30) buckets['0-30'] += amount;
      else if (daysOverdue <= 60) buckets['31-60'] += amount;
      else if (daysOverdue <= 90) buckets['61-90'] += amount;
      else buckets['90+'] += amount;
      buckets.total += amount;
    };

    // 1. Formal Invoices
    invoices
      .filter(inv => (inv.type || 'receivable') === type && inv.status !== 'paid')
      .forEach(inv => {
        const amount = parseFloat(inv.totalAmount || inv.amount || 0);
        addBucket(inv.dueDate || inv.date, amount);
      });

    if (type === 'receivable') {
      // 2. Unpaid Member Subscriptions & Balances
      members
        .filter(m => m.billingStatus === 'unpaid' && (m.totalDue || 0) > (m.totalPaid || 0))
        .forEach(m => {
          const unpaid = Math.max(0, (m.totalDue || 0) - (m.totalPaid || 0));
          addBucket(m.subscriptionStartDate || m.createdAt, unpaid);
        });
    } else {
      // 3. Pending Supplier Expenses
      expenses
        .filter(e => e.status === 'pending')
        .forEach(e => {
          const amt = parseFloat(e.amount || 0);
          addBucket(e.dueDate || e.date, amt);
        });
    }

    return buckets;
  };

  const arAging = calculateAging('receivable');
  const apAging = calculateAging('payable');

  const AgingTable = ({ title, aging, type }: { title: string; aging: any; type: string }) => (
    <div className={`p-6 rounded-3xl border shadow-xl ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 shadow-black/50' : 'bg-white border-slate-200 shadow-slate-200/50'}`}>
      <div className="flex items-center gap-3 mb-6">
        <div className={`p-3 rounded-xl ${type === 'AR' ? 'bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25' : 'bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'}`}>
          {type === 'AR' ? <Users size={24} /> : <AlertTriangle size={24} />}
        </div>
        <div>
          <h3 className="font-bold text-lg">{title}</h3>
          <p className="text-sm opacity-80">{type === 'AR' ? 'Unpaid Client Invoices & Member Dues (LCOA 411)' : 'Unpaid Supplier Bills & Pending Expenses (LCOA 401)'}</p>
        </div>
      </div>

      <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
        <table className="w-full text-left text-sm">
          <thead className={isDarkMode ? 'bg-zinc-900/50' : 'bg-slate-50'}>
            <tr>
              <th className="p-4 font-black uppercase tracking-widest text-zinc-500 text-[10px]">Aging Bucket</th>
              <th className="p-4 font-black uppercase tracking-widest text-zinc-500 text-[10px] text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className={`border-b ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
              <td className="p-4 font-medium">0 - 30 Days</td>
              <td className="p-4 text-right font-mono">{formatCurrency(aging['0-30'])}</td>
            </tr>
            <tr className={`border-b ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
              <td className="p-4 font-medium">31 - 60 Days</td>
              <td className="p-4 text-right font-mono">{formatCurrency(aging['31-60'])}</td>
            </tr>
            <tr className={`border-b ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
              <td className="p-4 font-medium">61 - 90 Days</td>
              <td className="p-4 text-right font-mono">{formatCurrency(aging['61-90'])}</td>
            </tr>
            <tr className={`border-b ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
              <td className="p-4 font-medium text-rose-500">Over 90 Days</td>
              <td className="p-4 text-right font-mono text-rose-500">{formatCurrency(aging['90+'])}</td>
            </tr>
            <tr className={isDarkMode ? 'bg-zinc-900/40' : 'bg-slate-50'}>
              <td className="p-4 font-bold text-lg">Total Outstanding</td>
              <td className="p-4 text-right font-mono font-black text-lg">{formatCurrency(aging.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <AgingTable title="Accounts Receivable (AR)" aging={arAging} type="AR" />
      <AgingTable title="Accounts Payable (AP)" aging={apAging} type="AP" />
    </div>
  );
};
