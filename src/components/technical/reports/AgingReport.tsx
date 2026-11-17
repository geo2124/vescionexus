import React, { useMemo, useState, useEffect } from 'react';
import { DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { differenceInDays } from 'date-fns';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useFirebase } from '../../../contexts/FirebaseContext';
import { OperationType } from '../../../types';

interface AgingReportProps {
  isDarkMode: boolean;
  type: 'AR' | 'AP';
  formatCurrency: (val: number) => string;
  transactions: any[];
}

export const AgingReport: React.FC<AgingReportProps> = ({ isDarkMode, type, formatCurrency, transactions }) => {
  const { user, handleFirestoreError } = useFirebase();
  const [members, setMembers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsubM = onSnapshot(collection(db, 'members'), snap => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'members'));

    const unsubI = onSnapshot(collection(db, 'invoices'), snap => {
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'invoices'));

    const unsubE = onSnapshot(collection(db, 'expenses'), snap => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'expenses'));

    return () => {
      unsubM();
      unsubI();
      unsubE();
    };
  }, [user]);

  const agingData = useMemo(() => {
    const isAR = type === 'AR';
    const entities: Record<string, {
      current: number;
      '1-30': number;
      '31-60': number;
      '61-90': number;
      '90+': number;
      total: number;
    }> = {};

    const now = new Date();
    const addAmountToEntity = (entityName: string, amount: number, refDate: Date) => {
      if (amount <= 0.01) return;
      if (!entities[entityName]) {
        entities[entityName] = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 };
      }
      const daysOld = isNaN(refDate.getTime()) ? 0 : Math.max(0, differenceInDays(now, refDate));
      if (daysOld <= 0) entities[entityName].current += amount;
      else if (daysOld <= 30) entities[entityName]['1-30'] += amount;
      else if (daysOld <= 60) entities[entityName]['31-60'] += amount;
      else if (daysOld <= 90) entities[entityName]['61-90'] += amount;
      else entities[entityName]['90+'] += amount;
      entities[entityName].total += amount;
    };

    if (isAR) {
      // 1. Unpaid Members
      members
        .filter(m => m.billingStatus === 'unpaid' && (m.totalDue || 0) > (m.totalPaid || 0))
        .forEach(m => {
          const unpaid = Math.max(0, (m.totalDue || 0) - (m.totalPaid || 0));
          const name = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.phone || m.id;
          const d = m.subscriptionStartDate ? new Date(m.subscriptionStartDate) : new Date(m.createdAt || Date.now());
          addAmountToEntity(name, unpaid, d);
        });

      // 2. Unpaid Receivable Invoices
      invoices
        .filter(inv => (inv.type || 'receivable') === 'receivable' && inv.status !== 'paid')
        .forEach(inv => {
          const amt = Number(inv.totalAmount || inv.amount || 0);
          const d = inv.date ? new Date(inv.date) : new Date(inv.createdAt || Date.now());
          addAmountToEntity(inv.client || `Invoice #${inv.id.slice(0, 6)}`, amt, d);
        });
    } else {
      // 1. Pending Expenses
      expenses
        .filter(e => e.status === 'pending')
        .forEach(e => {
          const amt = Number(e.amount || 0);
          const d = e.date ? new Date(e.date) : new Date(e.createdAt || Date.now());
          const vendorName = e.vendor || e.supplier || e.category || e.description || 'Supplier';
          addAmountToEntity(vendorName, amt, d);
        });

      // 2. Unpaid Payable Bills
      invoices
        .filter(inv => inv.type === 'payable' && inv.status !== 'paid')
        .forEach(inv => {
          const amt = Number(inv.totalAmount || inv.amount || 0);
          const d = inv.date ? new Date(inv.date) : new Date(inv.createdAt || Date.now());
          addAmountToEntity(inv.client || `Bill #${inv.id.slice(0, 6)}`, amt, d);
        });
    }

    // 3. Also include any ledger receivables/payables from transactions not already covered
    const targetPattern = isAR ? /receivable|411/i : /payable|401/i;
    transactions.forEach(t => {
      const src = t.sourceAccount || '';
      const dest = t.destinationAccount || '';
      if (isAR && targetPattern.test(src) && t.sourceModule !== 'invoicing') {
        const d = t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000) : now;
        addAmountToEntity(src.replace(/_/g, ' '), Number(t.amount || 0), d);
      } else if (!isAR && targetPattern.test(dest) && t.sourceModule !== 'invoicing') {
        const d = t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000) : now;
        addAmountToEntity(dest.replace(/_/g, ' '), Number(t.amount || 0), d);
      }
    });

    const rows = Object.entries(entities)
      .map(([entity, buckets]) => ({
        entity: entity.toUpperCase(),
        ...buckets
      }))
      .sort((a, b) => b.total - a.total);

    const totals = rows.reduce((acc, curr) => ({
      current: acc.current + curr.current,
      '1-30': acc['1-30'] + curr['1-30'],
      '31-60': acc['31-60'] + curr['31-60'],
      '61-90': acc['61-90'] + curr['61-90'],
      '90+': acc['90+'] + curr['90+'],
      total: acc.total + curr.total
    }), { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 });

    const chartData = [
      { period: 'Current', amount: totals.current },
      { period: '1-30 Days', amount: totals['1-30'] },
      { period: '31-60 Days', amount: totals['31-60'] },
      { period: '61-90 Days', amount: totals['61-90'] },
      { period: '90+ Days', amount: totals['90+'] },
    ];

    return { rows, totals, chartData };
  }, [transactions, members, invoices, expenses, type]);

  const { rows, totals, chartData } = agingData;
  const totalOutstanding = totals.total;

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="mb-8">
        <h2 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'} mb-2`}>
          {type === 'AR' ? 'Accounts Receivable Aging (LCOA 411)' : 'Accounts Payable Aging (LCOA 401)'}
        </h2>
        <p className={`${isDarkMode ? 'text-zinc-500' : 'text-slate-500'} font-medium`}>
          Live aging buckets for outstanding {type === 'AR' ? 'member subscriptions & client invoices' : 'supplier bills & pending expenses'}.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm flex flex-col md:col-span-1`}>
          <div className="flex items-center gap-4 mb-4">
            <div className={`p-3 rounded-2xl ${type === 'AR' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
              <DollarSign size={24} />
            </div>
            <div className={`text-xs font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
              Total Outstanding
            </div>
          </div>
          <div className={`text-4xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
            {formatCurrency(totalOutstanding)}
          </div>
        </div>
        <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm md:col-span-2 h-48`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="period" type="category" stroke={isDarkMode ? '#52525b' : '#94a3b8'} fontSize={10} tickLine={false} axisLine={false} width={80} />
              <Tooltip
                formatter={(val: number) => formatCurrency(val)}
                contentStyle={{ backgroundColor: isDarkMode ? '#18181b' : '#ffffff', borderRadius: '8px', border: 'none', fontSize: '12px' }}
              />
              <Bar dataKey="amount" fill={type === 'AR' ? '#10b981' : '#f43f5e'} radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`overflow-hidden rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
        <table className="w-full text-sm text-left border-collapse">
          <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-950/80 border-b border-zinc-800' : 'text-slate-500 bg-slate-50 border-b border-slate-200'}`}>
            <tr>
              <th className="p-4">{type === 'AR' ? 'Client / Member' : 'Supplier / Expense'}</th>
              <th className="p-4 text-right">Current</th>
              <th className="p-4 text-right">1-30 Days</th>
              <th className="p-4 text-right">31-60 Days</th>
              <th className="p-4 text-right">61-90 Days</th>
              <th className="p-4 text-right text-rose-500 font-bold">90+ Days</th>
              <th className="p-4 text-right font-black">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono text-xs">
            {rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-colors">
                <td className="p-4 font-bold text-zinc-900 dark:text-zinc-100 font-sans">{row.entity}</td>
                <td className="p-4 text-right text-zinc-500">{row.current > 0 ? formatCurrency(row.current) : '-'}</td>
                <td className="p-4 text-right text-zinc-500">{row['1-30'] > 0 ? formatCurrency(row['1-30']) : '-'}</td>
                <td className="p-4 text-right text-zinc-500">{row['31-60'] > 0 ? formatCurrency(row['31-60']) : '-'}</td>
                <td className="p-4 text-right text-amber-500">{row['61-90'] > 0 ? formatCurrency(row['61-90']) : '-'}</td>
                <td className="p-4 text-right text-rose-500 font-bold">{row['90+'] > 0 ? formatCurrency(row['90+']) : '-'}</td>
                <td className="p-4 text-right font-black text-zinc-900 dark:text-zinc-100 bg-zinc-500/5">{formatCurrency(row.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-12 text-center text-zinc-400 italic font-medium">
                  No outstanding {type === 'AR' ? 'receivables' : 'payables'} detected in the current ledger state.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className={`font-black tracking-tight ${isDarkMode ? 'bg-zinc-950/50' : 'bg-slate-50'} border-t-2 dark:border-zinc-800`}>
              <tr>
                <td className="p-4 uppercase tracking-tighter text-[10px]">Consolidated Totals</td>
                <td className="p-4 text-right">{formatCurrency(totals.current)}</td>
                <td className="p-4 text-right">{formatCurrency(totals['1-30'])}</td>
                <td className="p-4 text-right">{formatCurrency(totals['31-60'])}</td>
                <td className="p-4 text-right text-amber-500">{formatCurrency(totals['61-90'])}</td>
                <td className="p-4 text-right text-rose-500">{formatCurrency(totals['90+'])}</td>
                <td className="p-4 text-right text-lg underline decoration-double underline-offset-4">{formatCurrency(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
