import React, { useState } from 'react';
import { addDoc, collection, updateDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, BookOpen, Sparkles } from 'lucide-react';

export interface LCOAAccount {
  code: string;
  name: string;
  type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
  className: string;
  currency: 'USD' | 'LBP';
}

export const STANDARD_LEBANESE_COA: LCOAAccount[] = [
  // Class 1 — Equity & Long-Term Capital (Capitaux Permanents)
  { code: '101', name: 'Capital Social (Owner Equity)', type: 'Equity', className: 'Class 1 - Equity & Capital', currency: 'USD' },
  { code: '110', name: 'Legal & Statutory Reserves', type: 'Equity', className: 'Class 1 - Equity & Capital', currency: 'USD' },
  { code: '120', name: 'Retained Earnings (Report à Nouveau)', type: 'Equity', className: 'Class 1 - Equity & Capital', currency: 'USD' },

  // Class 2 — Fixed Assets (Actif Immobilisé)
  { code: '215', name: 'Sports & Gym Equipment', type: 'Asset', className: 'Class 2 - Fixed Assets', currency: 'USD' },
  { code: '218', name: 'Office & IT Equipment', type: 'Asset', className: 'Class 2 - Fixed Assets', currency: 'USD' },
  { code: '281', name: 'Accumulated Depreciation', type: 'Asset', className: 'Class 2 - Fixed Assets', currency: 'USD' },

  // Class 3 — Inventory (Stocks)
  { code: '301', name: 'Kiosk Merchandise Inventory', type: 'Asset', className: 'Class 3 - Inventory', currency: 'USD' },
  { code: '302', name: 'Retail Shop & Supplements Inventory', type: 'Asset', className: 'Class 3 - Inventory', currency: 'USD' },

  // Class 4 — Third-Party Accounts (Comptes de Tiers — AP / AR / Taxes / Payroll)
  { code: '401', name: 'Accounts Payable — Suppliers', type: 'Liability', className: 'Class 4 - Third-Party Accounts', currency: 'USD' },
  { code: '411', name: 'Accounts Receivable — Clients & Members', type: 'Asset', className: 'Class 4 - Third-Party Accounts', currency: 'USD' },
  { code: '419', name: 'Member Wallet & Deferred Deposits', type: 'Liability', className: 'Class 4 - Third-Party Accounts', currency: 'USD' },
  { code: '421', name: 'Salaries & Wages Payable', type: 'Liability', className: 'Class 4 - Third-Party Accounts', currency: 'USD' },
  { code: '425', name: 'Staff Advances & Loans Receivable', type: 'Asset', className: 'Class 4 - Third-Party Accounts', currency: 'USD' },
  { code: '431', name: 'NSSF (CNSS) Payable', type: 'Liability', className: 'Class 4 - Third-Party Accounts', currency: 'LBP' },
  { code: '442', name: 'VAT Collected (TVA Facturée — Output Tax 11%)', type: 'Liability', className: 'Class 4 - Third-Party Accounts', currency: 'LBP' },
  { code: '443', name: 'VAT Deductible (TVA Récupérable — Input Tax)', type: 'Asset', className: 'Class 4 - Third-Party Accounts', currency: 'LBP' },

  // Class 5 — Financial Accounts (Comptes Financiers)
  { code: '512', name: 'Bank Accounts (Fresh USD / LBP)', type: 'Asset', className: 'Class 5 - Financial Accounts', currency: 'USD' },
  { code: '531', name: 'Cash Drawer / Register (Caisse)', type: 'Asset', className: 'Class 5 - Financial Accounts', currency: 'USD' },

  // Class 6 — Operating Expenses (Charges)
  { code: '601', name: 'Cost of Goods Sold (COGS / Achats Revendus)', type: 'Expense', className: 'Class 6 - Operating Expenses', currency: 'USD' },
  { code: '605', name: 'Utilities, Generator & Electricity', type: 'Expense', className: 'Class 6 - Operating Expenses', currency: 'USD' },
  { code: '613', name: 'Facility Rent & Maintenance', type: 'Expense', className: 'Class 6 - Operating Expenses', currency: 'USD' },
  { code: '622', name: 'Freelance & Trainer Commissions', type: 'Expense', className: 'Class 6 - Operating Expenses', currency: 'USD' },
  { code: '641', name: 'Staff Salaries & Overtime', type: 'Expense', className: 'Class 6 - Operating Expenses', currency: 'USD' },
  { code: '645', name: 'Employer NSSF Contributions', type: 'Expense', className: 'Class 6 - Operating Expenses', currency: 'LBP' },
  { code: '676', name: 'Foreign Exchange Losses (Différences de Change Négatives)', type: 'Expense', className: 'Class 6 - Operating Expenses', currency: 'USD' },
  { code: '681', name: 'Depreciation & Amortization Expense', type: 'Expense', className: 'Class 6 - Operating Expenses', currency: 'USD' },

  // Class 7 — Operating Revenue (Produits)
  { code: '701', name: 'Kiosk POS Sales Revenue', type: 'Income', className: 'Class 7 - Operating Revenue', currency: 'USD' },
  { code: '702', name: 'Retail Shop POS Sales Revenue', type: 'Income', className: 'Class 7 - Operating Revenue', currency: 'USD' },
  { code: '7061', name: 'Gym Membership & Package Revenue', type: 'Income', className: 'Class 7 - Operating Revenue', currency: 'USD' },
  { code: '7062', name: 'Court Reservation & Academy Session Revenue', type: 'Income', className: 'Class 7 - Operating Revenue', currency: 'USD' },
  { code: '70621', name: 'Court Individual Access Revenue (Half / Full Court)', type: 'Income', className: 'Class 7 - Operating Revenue', currency: 'USD' },
  { code: '7063', name: 'Physiotherapy Clinical Revenue', type: 'Income', className: 'Class 7 - Operating Revenue', currency: 'USD' },
  { code: '776', name: 'Foreign Exchange Gains (Différences de Change Positives)', type: 'Income', className: 'Class 7 - Operating Revenue', currency: 'USD' },
];

export const COAModule: React.FC<{ isDarkMode: boolean; coa: any[]; formatCurrency: (amount: number) => string }> = ({ isDarkMode, coa }) => {
  const { handleFirestoreError } = useFirebase();
  const [isAdding, setIsAdding] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('ALL');

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    type: 'Asset',
    className: 'Class 5 - Financial Accounts',
    currency: 'USD'
  });

  const handleSeedLCOA = async () => {
    setIsSeeding(true);
    try {
      const existingCodes = new Set(coa.map(a => String(a.code).trim()));
      const missingAccounts = STANDARD_LEBANESE_COA.filter(a => !existingCodes.has(a.code));

      if (missingAccounts.length === 0) {
        toast.info('All 30 Official Lebanese Chart of Accounts (LCOA Class 1–7) are already seeded.');
        setIsSeeding(false);
        return;
      }

      const batch = writeBatch(db);
      missingAccounts.forEach((acc) => {
        const ref = doc(collection(db, 'chartOfAccounts'));
        batch.set(ref, {
          code: acc.code,
          name: acc.name,
          type: acc.type,
          className: acc.className,
          currency: acc.currency,
          createdAt: new Date().toISOString()
        });
      });

      await batch.commit();
      toast.success(`Seeded ${missingAccounts.length} Official Lebanese COA (LCOA Class 1–7) accounts.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chartOfAccounts');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateDoc(doc(db, 'chartOfAccounts', editingId), formData);
        toast.success('Account updated');
      } else {
        await addDoc(collection(db, 'chartOfAccounts'), {
          ...formData,
          createdAt: new Date().toISOString()
        });
        toast.success('Account added');
      }
      setEditingId(null);
      setIsAdding(false);
      setFormData({ code: '', name: '', type: 'Asset', className: 'Class 5 - Financial Accounts', currency: 'USD' });
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'chartOfAccounts');
    }
  };

  const handleEdit = (account: any) => {
    setFormData({
      code: account.code,
      name: account.name,
      type: account.type,
      className: account.className || `Class ${String(account.code || '1').charAt(0)}`,
      currency: account.currency || 'USD'
    });
    setEditingId(account.id);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this account?')) return;
    try {
      await deleteDoc(doc(db, 'chartOfAccounts', id));
      toast.success('Account deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'chartOfAccounts');
    }
  };

  const getTypeColor = (type: string) => {
    if (type === 'Asset') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
    if (type === 'Liability') return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
    if (type === 'Equity') return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';
    if (type === 'Income') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
    if (type === 'Expense') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
  };

  const displayAccounts = (coa.length > 0 ? coa : STANDARD_LEBANESE_COA.map((a, idx) => ({ id: `std_${idx}`, ...a, isDefaultPreview: true })))
    .filter(acc => {
      if (selectedClassFilter === 'ALL') return true;
      return String(acc.code || '').startsWith(selectedClassFilter);
    })
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }));

  return (
    <div className={`p-6 rounded-2xl border shadow-sm max-w-6xl mx-auto ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25">
            <BookOpen size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Lebanese Chart of Accounts (LCOA Class 1–7)</h2>
            <p className="text-xs text-zinc-500">Plan Comptable Général Libanais • Classes 1 to 7</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSeedLCOA}
            disabled={isSeeding}
            className="px-4 py-2 bg-[#00B8C8]/15 hover:bg-[#00B8C8]/25 border border-[#00B8C8]/30 disabled:opacity-50 text-[#0099A8] dark:text-[#00B8C8] rounded-lg font-bold text-xs flex items-center gap-2 transition-colors shadow-sm"
          >
            <Sparkles size={15} />
            {isSeeding ? 'Seeding LCOA...' : 'Seed Standard Lebanese COA (LCOA)'}
          </button>
          <button
            onClick={() => {
              setIsAdding(!isAdding);
              setEditingId(null);
              setFormData({ code: '', name: '', type: 'Asset', className: 'Class 5 - Financial Accounts', currency: 'USD' });
            }}
            className="px-4 py-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg font-bold text-xs flex items-center gap-2 transition-colors shadow-sm"
          >
            {isAdding ? 'Cancel' : <><Plus size={15} /> New Account</>}
          </button>
        </div>
      </div>

      {/* Class Filter Tabs */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        {[
          { id: 'ALL', label: 'All Classes (1–7)' },
          { id: '1', label: 'Class 1: Equity' },
          { id: '2', label: 'Class 2: Fixed Assets' },
          { id: '3', label: 'Class 3: Inventory' },
          { id: '4', label: 'Class 4: Third-Party (AR/AP/VAT)' },
          { id: '5', label: 'Class 5: Financial (Cash/Bank)' },
          { id: '6', label: 'Class 6: Expenses' },
          { id: '7', label: 'Class 7: Revenue' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setSelectedClassFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              selectedClassFilter === tab.id
                ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                : isDarkMode
                  ? 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {coa.length === 0 && (
        <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium flex items-center justify-between">
          <span>Showing standard Lebanese Chart of Accounts (LCOA Class 1–7) template. Click "Seed Standard Lebanese COA (LCOA)" to persist and customize in Firestore.</span>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit} className="mb-8 p-4 border border-slate-200 dark:border-zinc-800 rounded-xl bg-slate-50 dark:bg-zinc-900/40">
          <h3 className="text-sm font-bold mb-4">{editingId ? 'Edit Account' : 'Add New LCOA Account'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-xs font-bold uppercase mb-1">LCOA Code</label>
              <input required value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none" placeholder="e.g. 7061" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase mb-1">Account Name</label>
              <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none" placeholder="Account Name" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase mb-1">Classification</label>
              <select value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none">
                <option value="Asset">Asset</option>
                <option value="Liability">Liability</option>
                <option value="Equity">Equity</option>
                <option value="Income">Income (Revenue)</option>
                <option value="Expense">Expense</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase mb-1">Base Currency</label>
              <select value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none">
                <option value="USD">USD</option>
                <option value="LBP">LBP</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="px-6 py-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg text-sm font-bold transition-colors">{editingId ? 'Save Changes' : 'Create Account'}</button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 dark:border-zinc-800">
              <th className="pb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">LCOA Code</th>
              <th className="pb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">Account Name</th>
              <th className="pb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">LCOA Class</th>
              <th className="pb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">Type</th>
              <th className="pb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">Currency</th>
              <th className="pb-3 text-xs font-bold uppercase tracking-wider text-zinc-500 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {displayAccounts.map(account => {
              const codeStr = String(account.code || '');
              const classDigit = codeStr.charAt(0);
              const defaultClassLabel =
                classDigit === '1' ? 'Class 1 - Equity & Capital' :
                classDigit === '2' ? 'Class 2 - Fixed Assets' :
                classDigit === '3' ? 'Class 3 - Inventory' :
                classDigit === '4' ? 'Class 4 - Third-Party Accounts' :
                classDigit === '5' ? 'Class 5 - Financial Accounts' :
                classDigit === '6' ? 'Class 6 - Operating Expenses' :
                classDigit === '7' ? 'Class 7 - Operating Revenue' : 'Standard Account';

              return (
                <tr key={account.id} className="border-b border-slate-100 dark:border-zinc-800/50 hover:bg-slate-50 dark:hover:bg-zinc-800/20">
                  <td className="py-3 font-mono font-bold text-[#0099A8] dark:text-[#00B8C8]">{account.code}</td>
                  <td className="py-3 font-bold">{account.name}</td>
                  <td className="py-3 text-xs text-zinc-500 font-medium">{account.className || defaultClassLabel}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${getTypeColor(account.type)}`}>
                      {account.type}
                    </span>
                  </td>
                  <td className="py-3 text-zinc-500 font-mono text-xs">{account.currency || 'USD'}</td>
                  <td className="py-3 text-right">
                    {!account.isDefaultPreview ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleEdit(account)} className="p-1.5 text-[#00B8C8] hover:bg-[#00B8C8]/10 rounded"><Edit2 size={16} /></button>
                        <button onClick={() => handleDelete(account.id)} className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded"><Trash2 size={16} /></button>
                      </div>
                    ) : (
                      <span className="text-[10px] font-bold uppercase text-zinc-400">Standard LCOA</span>
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
