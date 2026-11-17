import React, { useState, useEffect, useMemo } from 'react';
import { User, Download, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useFirebase } from '../../../contexts/FirebaseContext';
import { OperationType } from '../../../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const Statements: React.FC<{
  isDarkMode: boolean;
  type: 'Customer' | 'Supplier';
  formatCurrency: (v: number) => string;
  transactions?: any[];
}> = ({ isDarkMode, type, formatCurrency, transactions = [] }) => {
  const { user, handleFirestoreError, systemName } = useFirebase();
  const [members, setMembers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('all');

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

  const entityOptions = useMemo(() => {
    if (type === 'Customer') {
      const custList = members
        .filter(m => m.id !== 'walk_in' && m.id !== 'system_walk_in' && !m.isSystemWalkIn)
        .map(m => ({ id: m.id, name: `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.phone || m.id }));
      invoices
        .filter(inv => (inv.type || 'receivable') === 'receivable' && inv.client)
        .forEach(inv => {
          if (!custList.some(c => c.name.toLowerCase() === String(inv.client).toLowerCase())) {
            custList.push({ id: `inv_${inv.client}`, name: inv.client });
          }
        });
      return custList;
    } else {
      const suppSet = new Set<string>();
      expenses.forEach(e => {
        if (e.vendor || e.supplier || e.category) {
          suppSet.add(e.vendor || e.supplier || e.category);
        }
      });
      invoices
        .filter(inv => inv.type === 'payable' && inv.client)
        .forEach(inv => suppSet.add(inv.client));
      return Array.from(suppSet).map(name => ({ id: name, name }));
    }
  }, [type, members, invoices, expenses]);

  const statementRows = useMemo(() => {
    const entries: Array<{ id: string; date: Date; description: string; debit: number; credit: number; balance: number }> = [];

    if (type === 'Customer') {
      // 1. Member subscription charges & invoices
      const relevantMembers = selectedEntityId === 'all' ? members : members.filter(m => m.id === selectedEntityId);
      relevantMembers.forEach(m => {
        if ((m.totalDue || 0) > 0) {
          entries.push({
            id: `SUB-${m.id.slice(0, 6)}`,
            date: m.subscriptionStartDate ? new Date(m.subscriptionStartDate) : new Date(m.createdAt || Date.now()),
            description: `Membership / Package Charge (${m.firstName} ${m.lastName})`,
            debit: Number(m.totalDue || 0),
            credit: 0,
            balance: 0
          });
        }
      });

      invoices
        .filter(inv => (inv.type || 'receivable') === 'receivable')
        .filter(inv => selectedEntityId === 'all' || `inv_${inv.client}` === selectedEntityId)
        .forEach(inv => {
          entries.push({
            id: `INV-${inv.id.slice(0, 6)}`,
            date: inv.date ? new Date(inv.date) : new Date(inv.createdAt || Date.now()),
            description: `Invoice: ${inv.description || inv.client}`,
            debit: Number(inv.amount || 0),
            credit: inv.status === 'paid' ? Number(inv.amount || 0) : 0,
            balance: 0
          });
        });

      // 2. Payments recorded in transactions
      transactions
        .filter(t => (selectedEntityId === 'all' ? Boolean(t.memberId) : t.memberId === selectedEntityId) && t.direction === 'inflow')
        .forEach(t => {
          const d = t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000) : new Date();
          entries.push({
            id: t.id.slice(0, 8),
            date: d,
            description: t.notes || `${(t.transactionType || 'Payment').replace(/_/g, ' ')} (${t.sourceModule || 'system'})`,
            debit: 0,
            credit: Number(t.amount || 0),
            balance: 0
          });
        });
    } else {
      // Supplier Statement: Bills & Expenses (Credit = Payable Owed, Debit = Paid)
      expenses
        .filter(e => selectedEntityId === 'all' || (e.vendor || e.supplier || e.category) === selectedEntityId)
        .forEach(e => {
          const amt = Number(e.amount || 0);
          const d = e.date ? new Date(e.date) : new Date(e.createdAt || Date.now());
          entries.push({
            id: `EXP-${e.id.slice(0, 6)}`,
            date: d,
            description: `${e.description || e.category || 'Supplier Expense'}${e.vendor ? ` (${e.vendor})` : ''}`,
            debit: e.status === 'paid' ? amt : 0,
            credit: amt,
            balance: 0
          });
        });

      invoices
        .filter(inv => inv.type === 'payable')
        .filter(inv => selectedEntityId === 'all' || inv.client === selectedEntityId)
        .forEach(inv => {
          const amt = Number(inv.amount || 0);
          entries.push({
            id: `BILL-${inv.id.slice(0, 6)}`,
            date: inv.date ? new Date(inv.date) : new Date(inv.createdAt || Date.now()),
            description: `Supplier Bill: ${inv.description} (${inv.client})`,
            debit: inv.status === 'paid' ? amt : 0,
            credit: amt,
            balance: 0
          });
        });
    }

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    let running = 0;
    return entries.map(row => {
      if (type === 'Customer') {
        running += row.debit - row.credit;
      } else {
        running += row.credit - row.debit;
      }
      return { ...row, balance: running };
    });
  }, [type, members, invoices, expenses, transactions, selectedEntityId]);

  const currentBalance = statementRows.length > 0 ? statementRows[statementRows.length - 1].balance : 0;
  const selectedEntityLabel = selectedEntityId === 'all'
    ? `All ${type}s (Consolidated SOA)`
    : (entityOptions.find(e => e.id === selectedEntityId)?.name || selectedEntityId);

  const handleExportPDF = () => {
    const docPdf = new jsPDF();
    docPdf.setFontSize(16);
    docPdf.text(`${systemName || 'Up ERP'} - ${type} Statement of Account`, 14, 16);
    docPdf.setFontSize(10);
    docPdf.text(`Account: ${selectedEntityLabel} | Current Balance: ${formatCurrency(currentBalance)}`, 14, 24);
    autoTable(docPdf, {
      startY: 30,
      head: [['Date', 'Ref', 'Description', 'Debit', 'Credit', 'Running Balance']],
      body: statementRows.map(r => [
        isNaN(r.date.getTime()) ? '-' : format(r.date, 'yyyy-MM-dd'),
        r.id,
        r.description,
        r.debit > 0 ? formatCurrency(r.debit) : '-',
        r.credit > 0 ? formatCurrency(r.credit) : '-',
        formatCurrency(r.balance)
      ]),
      styles: { fontSize: 8 }
    });
    docPdf.save(`${type.toLowerCase()}_statement_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  return (
    <div className="p-8 h-full overflow-y-auto w-full max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h2 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'} mb-1`}>
            {type} Statement of Account (SOA)
          </h2>
          <p className={`${isDarkMode ? 'text-zinc-500' : 'text-slate-500'} text-sm font-medium`}>
            Live ledger activity and running balance from Firestore.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedEntityId}
            onChange={e => setSelectedEntityId(e.target.value)}
            className={`px-3 py-2 rounded-xl border text-xs font-bold ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-200' : 'bg-white border-slate-200 text-zinc-800'}`}
          >
            <option value="all">All {type}s (Consolidated)</option>
            {entityOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.name}</option>
            ))}
          </select>
          <button onClick={handleExportPDF} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors">
            <Download size={14} /> Export SOA PDF
          </button>
        </div>
      </div>

      <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm mb-6 flex items-center gap-4`}>
        <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center">
          {type === 'Customer' ? <User size={24} /> : <Building2 size={24} />}
        </div>
        <div>
          <div className="text-xl font-bold">{selectedEntityLabel}</div>
          <div className="text-zinc-500 text-xs font-mono">LCOA Control Account: {type === 'Customer' ? '411 - Clients & Members' : '401 - Suppliers Payable'}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Net Balance Due</div>
          <div className={`text-2xl font-black font-mono ${currentBalance > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
            {formatCurrency(currentBalance)}
          </div>
        </div>
      </div>

      <div className={`overflow-hidden rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
        <table className="w-full text-sm text-left border-collapse">
          <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-950/80 border-b border-zinc-800' : 'text-slate-500 bg-slate-50 border-b border-slate-200'}`}>
            <tr>
              <th className="p-4">Date</th>
              <th className="p-4">Ref</th>
              <th className="p-4">Description</th>
              <th className="p-4 text-right">Debit</th>
              <th className="p-4 text-right">Credit</th>
              <th className="p-4 text-right">Running Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono text-xs">
            {statementRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-12 text-center text-zinc-500 font-sans italic">
                  No statement movements recorded for the selected {type.toLowerCase()}.
                </td>
              </tr>
            ) : (
              statementRows.map((t, idx) => (
                <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20">
                  <td className="p-4 text-zinc-500">{isNaN(t.date.getTime()) ? '-' : format(t.date, 'yyyy-MM-dd')}</td>
                  <td className="p-4 text-zinc-400">{t.id}</td>
                  <td className="p-4 font-bold text-zinc-900 dark:text-zinc-100 font-sans">{t.description}</td>
                  <td className="p-4 text-right text-zinc-500">{t.debit > 0 ? formatCurrency(t.debit) : '-'}</td>
                  <td className="p-4 text-right text-emerald-500">{t.credit > 0 ? formatCurrency(t.credit) : '-'}</td>
                  <td className="p-4 text-right font-black text-zinc-900 dark:text-zinc-100">{formatCurrency(t.balance)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
