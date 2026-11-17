import React, { useState, useEffect, useMemo } from 'react';
import { addDoc, collection, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { processLedgerTransaction, processReversalTransaction, stripUndefined } from '../../lib/transaction-engine';
import { logSystemAudit } from '../../lib/firestore-utils';
import { toast } from 'sonner';
import { Edit2, Plus, Trash2, X, CheckCircle2, Clock, Search, Filter, DollarSign, Repeat, Sparkles, Building2 } from 'lucide-react';

export type PaidFromModuleAccount =
  | 'court_basketball'
  | 'court_padel_tennis'
  | 'gym'
  | 'physio'
  | 'pos_cafeteria'
  | 'pos_retail'
  | 'general_facility';

export const PAYING_MODULE_ACCOUNTS: { id: PaidFromModuleAccount; label: string; shortLabel: string }[] = [
  { id: 'court_basketball', label: 'Basketball Court Reservation Account', shortLabel: 'Basketball Court' },
  { id: 'court_padel_tennis', label: 'Padel & Tennis Court Account', shortLabel: 'Padel & Tennis' },
  { id: 'gym', label: 'Gym Management Account', shortLabel: 'Gym Account' },
  { id: 'physio', label: 'Physiotherapy Account', shortLabel: 'Physiotherapy' },
  { id: 'pos_cafeteria', label: 'Kiosk POS Account', shortLabel: 'Kiosk POS' },
  { id: 'pos_retail', label: 'Retail Shop POS Account', shortLabel: 'Retail Shop POS' },
  { id: 'general_facility', label: 'General Facility / HQ Account', shortLabel: 'General Facility / HQ' },
];

export const getPayingModuleLabel = (mod?: string | null): string => {
  const found = PAYING_MODULE_ACCOUNTS.find(m => m.id === mod);
  return found ? found.label : 'General Facility / HQ Account';
};

export const getPayingModuleShortLabel = (mod?: string | null): string => {
  const found = PAYING_MODULE_ACCOUNTS.find(m => m.id === mod);
  return found ? found.shortLabel : 'General Facility / HQ';
};

export interface ExpenseRecord {
  id: string;
  vendor: string;
  category: string;
  paidFromModule: PaidFromModuleAccount;
  date: string;
  currency: 'USD' | 'LBP';
  amount: number; // Base USD amount (Gross)
  netAmountUSD?: number;
  vatAmountUSD?: number;
  includesVat?: boolean;
  originalAmount?: number;
  lbpAmount?: string;
  description: string;
  status: 'paid' | 'pending';
  transactionId?: string | null;
  vatTransactionId?: string | null;
  paidAt?: string | null;
  historicalFxRate?: number;
  createdAt: string;
}

export const ExpensesModule: React.FC<{ isDarkMode: boolean; coa: any[]; formatCurrency?: (amount: number) => string }> = ({ isDarkMode, coa, formatCurrency: propFormatCurrency }) => {
  const { user, handleFirestoreError, isPeriodClosed, usdToLbpRate, formatCurrency: ctxFormatCurrency } = useFirebase();
  const formatCurrency = propFormatCurrency || ctxFormatCurrency;

  const [isManageMode, setIsManageMode] = useState(false);
  const [isRecurringMode, setIsRecurringMode] = useState(false);
  const [recurringTemplates, setRecurringTemplates] = useState<any[]>([]);
  const [recForm, setRecForm] = useState({
    vendor: '',
    category: '',
    paidFromModule: 'general_facility' as PaidFromModuleAccount,
    currency: 'USD' as 'USD' | 'LBP',
    amount: '',
    description: ''
  });
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [paidFromModuleFilter, setPaidFromModuleFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<'all' | 'USD' | 'LBP'>('all');
  const [dateFromFilter, setDateFromFilter] = useState<string>('');
  const [dateToFilter, setDateToFilter] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState<string>('');

  const [formData, setFormData] = useState({
    vendor: '',
    category: '',
    paidFromModule: 'general_facility' as PaidFromModuleAccount,
    date: new Date().toISOString().split('T')[0],
    currency: 'USD' as 'USD' | 'LBP',
    amount: '',
    lbpAmount: '',
    description: '',
    status: 'paid' as 'paid' | 'pending',
    includesVat: false,
  });

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            vendor: data.vendor || '',
            category: data.category || '',
            paidFromModule: (data.paidFromModule || data.sourceModule || 'general_facility') as PaidFromModuleAccount,
            date: data.date || '',
            currency: (data.currency === 'LBP' ? 'LBP' : 'USD') as 'USD' | 'LBP',
            amount: Number(data.amount) || 0,
            netAmountUSD: Number(data.netAmountUSD ?? data.amount) || 0,
            vatAmountUSD: Number(data.vatAmountUSD || 0),
            includesVat: Boolean(data.includesVat),
            originalAmount: Number(data.originalAmount ?? data.amount) || 0,
            lbpAmount: data.lbpAmount || '',
            description: data.description || '',
            status: (data.status === 'pending' ? 'pending' : 'paid') as 'paid' | 'pending',
            transactionId: data.transactionId || null,
            vatTransactionId: data.vatTransactionId || null,
            paidAt: data.paidAt || null,
            historicalFxRate: Number(data.historicalFxRate || usdToLbpRate || 89500),
            createdAt: data.createdAt || new Date().toISOString(),
          };
        });
        setExpenses(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'expenses')
    );

    const unsubRec = onSnapshot(
      collection(db, 'recurring_expenses'),
      (snap) => {
        setRecurringTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      () => {}
    );

    return () => {
      unsub();
      unsubRec();
    };
  }, [user]);

  const expenseAccounts = coa.filter((acc) => acc.type === 'Expense').sort((a, b) => a.name.localeCompare(b.name));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.category) return toast.error('Please select a category');
    if (!formData.paidFromModule) return toast.error('Please select the Paying Module Account');

    if (isPeriodClosed(formData.date)) {
      return toast.error('Cannot post expense. The reporting period is closed.');
    }

    const rawAmount = Number(formData.amount);
    if (isNaN(rawAmount) || rawAmount <= 0) {
      return toast.error('Please enter a valid positive amount.');
    }

    let amountInUSD = rawAmount;
    if (formData.currency === 'LBP' && usdToLbpRate > 0) {
      amountInUSD = rawAmount / usdToLbpRate;
    }

    const netAmountUSD = formData.includesVat
      ? Number((amountInUSD / 1.11).toFixed(2))
      : Number(amountInUSD.toFixed(2));
    const vatAmountUSD = formData.includesVat
      ? Number((amountInUSD - netAmountUSD).toFixed(2))
      : 0;

    try {
      if (editingExpenseId) {
        const existingExp = expenses.find(ex => ex.id === editingExpenseId);
        await updateDoc(doc(db, 'expenses', editingExpenseId), stripUndefined({
          vendor: formData.vendor.trim(),
          category: formData.category,
          paidFromModule: formData.paidFromModule,
          sourceModule: formData.paidFromModule,
          date: formData.date,
          currency: formData.currency,
          amount: amountInUSD,
          netAmountUSD,
          vatAmountUSD,
          includesVat: formData.includesVat,
          originalAmount: rawAmount,
          lbpAmount: formData.lbpAmount,
          description: formData.description.trim(),
          updatedAt: new Date().toISOString(),
        }));
        if (existingExp?.transactionId) {
          await updateDoc(doc(db, 'transactions', existingExp.transactionId), stripUndefined({
            sourceModule: formData.paidFromModule,
            paidFromModule: formData.paidFromModule,
            sourceAccount: formData.category,
            notes: `Expense [${getPayingModuleShortLabel(formData.paidFromModule)}]: ${formData.vendor} - ${formData.description}`
          })).catch(() => {});
          await updateDoc(doc(db, 'advanced_transactions', existingExp.transactionId), stripUndefined({
            sourceModule: formData.paidFromModule,
            paidFromModule: formData.paidFromModule,
            sourceAccount: formData.category,
            notes: `Expense [${getPayingModuleShortLabel(formData.paidFromModule)}]: ${formData.vendor} - ${formData.description}`
          })).catch(() => {});
        }
        toast.success('Expense updated successfully.');
        setEditingExpenseId(null);
      } else {
        const expenseRef = await addDoc(collection(db, 'expenses'), stripUndefined({
          vendor: formData.vendor.trim(),
          category: formData.category,
          paidFromModule: formData.paidFromModule,
          sourceModule: formData.paidFromModule,
          date: formData.date,
          currency: formData.currency,
          amount: amountInUSD,
          netAmountUSD,
          vatAmountUSD,
          includesVat: formData.includesVat,
          originalAmount: rawAmount,
          lbpAmount: formData.lbpAmount,
          description: formData.description.trim(),
          status: formData.status,
          transactionId: null,
          vatTransactionId: null,
          historicalFxRate: usdToLbpRate || 89500,
          paidAt: formData.status === 'paid' ? new Date().toISOString() : null,
          createdAt: new Date().toISOString(),
        }));

        if (formData.status === 'paid') {
          const res = await processLedgerTransaction({
            transactionType: 'expense',
            amount: netAmountUSD,
            paymentMethod: 'cash',
            sourceModule: formData.paidFromModule,
            paidFromModule: formData.paidFromModule,
            referenceId: expenseRef.id,
            cashierId: user?.uid || 'system',
            direction: 'outflow',
            notes: `Expense [${getPayingModuleShortLabel(formData.paidFromModule)}]: ${formData.vendor} - ${formData.description}${formData.includesVat ? ' (Net Excl. 11% VAT)' : ''}`,
            sourceAccount: formData.category,
            destinationAccount: '531 - Cash Drawer / Register (Caisse)',
          });

          let vatTxnId: string | null = null;
          if (formData.includesVat && vatAmountUSD > 0) {
            const vatRes = await processLedgerTransaction({
              transactionType: 'vat_input_deductible',
              amount: vatAmountUSD,
              paymentMethod: 'cash',
              sourceModule: formData.paidFromModule,
              paidFromModule: formData.paidFromModule,
              referenceId: expenseRef.id,
              cashierId: user?.uid || 'system',
              direction: 'outflow',
              notes: `11% Deductible Input VAT (4426 - TVA Déductible) on Expense: ${formData.vendor}`,
              sourceAccount: '4426 - VAT Deductible on Purchases (TVA Déductible)',
              destinationAccount: '531 - Cash Drawer / Register (Caisse)',
            });
            vatTxnId = vatRes.transactionId;
          }

          await updateDoc(doc(db, 'expenses', expenseRef.id), stripUndefined({
            transactionId: res.transactionId,
            vatTransactionId: vatTxnId,
          }));
          toast.success(formData.includesVat ? 'Expense + 11% Input VAT (4426) recorded in ledger.' : 'Expense recorded and paid in ledger.');
        } else {
          toast.success('Pending payable expense logged (awaiting payment execution).');
        }
      }

      setFormData({
        vendor: '',
        category: '',
        paidFromModule: 'general_facility',
        date: new Date().toISOString().split('T')[0],
        currency: 'USD',
        amount: '',
        lbpAmount: '',
        description: '',
        status: 'paid',
        includesVat: false,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'expenses');
    }
  };

  const handleAddRecurringTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recForm.vendor.trim() || !recForm.category || !recForm.amount) return;
    try {
      const rawAmt = Number(recForm.amount) || 0;
      const amtUSD = recForm.currency === 'LBP' && usdToLbpRate > 0 ? rawAmt / usdToLbpRate : rawAmt;
      await addDoc(collection(db, 'recurring_expenses'), stripUndefined({
        vendor: recForm.vendor.trim(),
        category: recForm.category,
        paidFromModule: recForm.paidFromModule || 'general_facility',
        currency: recForm.currency,
        amountUSD: amtUSD,
        originalAmount: rawAmt,
        description: recForm.description.trim() || `Monthly recurring ${recForm.category}`,
        lastPostedMonth: '',
        createdAt: new Date().toISOString()
      }));
      setRecForm({ vendor: '', category: '', paidFromModule: 'general_facility', currency: 'USD', amount: '', description: '' });
      toast.success('Recurring monthly expense template saved!');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'recurring_expenses');
    }
  };

  const handleRunMonthlyRecurringExpenses = async () => {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const todayStr = new Date().toISOString().split('T')[0];
    const dueTemplates = recurringTemplates.filter(t => t.lastPostedMonth !== currentMonth);
    if (dueTemplates.length === 0) {
      toast.info(`All recurring monthly expenses have already been posted for ${currentMonth}!`);
      return;
    }

    try {
      let count = 0;
      for (const tpl of dueTemplates) {
        const amtUSD = Number(tpl.amountUSD || 0);
        const modAccount = (tpl.paidFromModule || 'general_facility') as PaidFromModuleAccount;
        const expRef = await addDoc(collection(db, 'expenses'), stripUndefined({
          vendor: tpl.vendor,
          category: tpl.category,
          paidFromModule: modAccount,
          sourceModule: modAccount,
          date: todayStr,
          currency: tpl.currency || 'USD',
          amount: amtUSD,
          originalAmount: tpl.originalAmount ?? amtUSD,
          lbpAmount: '',
          description: `${tpl.description} (${currentMonth} Auto-Run)`,
          status: 'paid',
          historicalFxRate: usdToLbpRate || 89500,
          paidAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        }));

        const res = await processLedgerTransaction({
          transactionType: 'expense',
          amount: amtUSD,
          paymentMethod: 'cash',
          sourceModule: modAccount,
          paidFromModule: modAccount,
          referenceId: expRef.id,
          cashierId: user?.uid || 'system',
          direction: 'outflow',
          notes: `Recurring Monthly Expense (${currentMonth}) [${getPayingModuleShortLabel(modAccount)}]: ${tpl.vendor} - ${tpl.description}`,
          sourceAccount: tpl.category,
          destinationAccount: '531 - Cash Drawer / Register (Caisse)'
        });

        await updateDoc(doc(db, 'expenses', expRef.id), stripUndefined({
          transactionId: res.transactionId
        }));

        await updateDoc(doc(db, 'recurring_expenses', tpl.id), stripUndefined({
          lastPostedMonth: currentMonth
        }));
        count++;
      }

      toast.success(`Posted ${count} recurring monthly expense(s) for ${currentMonth} to Ledger!`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expenses');
    }
  };

  const handleMarkAsPaid = async (expense: ExpenseRecord) => {
    if (expense.status === 'paid') return;
    if (isPeriodClosed(expense.date)) {
      return toast.error('Cannot execute payment for an expense in a closed period.');
    }

    try {
      const currentRate = usdToLbpRate || 89500;
      const netExpAmt = expense.includesVat && expense.netAmountUSD ? expense.netAmountUSD : expense.amount;
      const vatExpAmt = expense.includesVat && expense.vatAmountUSD ? expense.vatAmountUSD : 0;
      const modAccount = expense.paidFromModule || 'general_facility';

      const res = await processLedgerTransaction({
        transactionType: 'expense',
        amount: netExpAmt,
        paymentMethod: 'cash',
        sourceModule: modAccount,
        paidFromModule: modAccount,
        referenceId: expense.id,
        cashierId: user?.uid || 'system',
        direction: 'outflow',
        notes: `Expense Payment Executed [${getPayingModuleShortLabel(modAccount)}]: ${expense.vendor} - ${expense.description}`,
        sourceAccount: expense.category,
        destinationAccount: '531 - Cash Drawer / Register (Caisse)',
      });

      let vatTxnId: string | null = null;
      if (vatExpAmt > 0) {
        const vatRes = await processLedgerTransaction({
          transactionType: 'vat_input_deductible',
          amount: vatExpAmt,
          paymentMethod: 'cash',
          sourceModule: modAccount,
          paidFromModule: modAccount,
          referenceId: expense.id,
          cashierId: user?.uid || 'system',
          direction: 'outflow',
          notes: `11% Deductible Input VAT (4426 - TVA Déductible) on Expense: ${expense.vendor}`,
          sourceAccount: '4426 - VAT Deductible on Purchases (TVA Déductible)',
          destinationAccount: '531 - Cash Drawer / Register (Caisse)',
        });
        vatTxnId = vatRes.transactionId;
      }

      // Check for Realized FX Gain / Loss (LCOA 676 / 776) if FX rate shifted between accrual and payment
      const lockedRate = Number(expense.historicalFxRate || currentRate);
      if (lockedRate > 0 && currentRate > 0 && Math.abs(currentRate - lockedRate) >= 100 && expense.amount > 0) {
        const lbpDiff = expense.amount * (currentRate - lockedRate);
        const fxDiffUSD = Number((Math.abs(lbpDiff) / currentRate).toFixed(2));
        if (fxDiffUSD >= 0.01) {
          const isGain = currentRate < lockedRate;
          await processLedgerTransaction({
            transactionType: isGain ? 'fx_gain' : 'fx_loss',
            amount: fxDiffUSD,
            paymentMethod: 'system',
            sourceModule: modAccount,
            paidFromModule: modAccount,
            referenceId: expense.id,
            cashierId: user?.uid || 'system',
            direction: isGain ? 'inflow' : 'outflow',
            sourceAccount: isGain
              ? '531 - Cash Drawer / Register (Caisse)'
              : '676 - Foreign Exchange Losses (Différences de Change Négatives)',
            destinationAccount: isGain
              ? '776 - Foreign Exchange Gains (Différences de Change Positives)'
              : '531 - Cash Drawer / Register (Caisse)',
            notes: `Realized FX ${isGain ? 'Gain (776)' : 'Loss (676)'} on Expense ${expense.vendor} (Logged @ ${lockedRate.toLocaleString()} vs Paid @ ${currentRate.toLocaleString()} LBP)`
          });
        }
      }

      await updateDoc(doc(db, 'expenses', expense.id), stripUndefined({
        status: 'paid',
        transactionId: res.transactionId,
        vatTransactionId: vatTxnId,
        paidAt: new Date().toISOString(),
        paidFxRate: currentRate
      }));

      await logSystemAudit({
        action: 'UPDATE',
        collectionName: 'expenses',
        documentId: expense.id,
        staffId: user?.uid || 'system',
        timestamp: new Date().toISOString(),
        details: { event: 'MARK_EXPENSE_PAID', vendor: expense.vendor, paidFromModule: modAccount, amountUSD: expense.amount, transactionId: res.transactionId },
      });

      toast.success(`Payment executed for ${expense.vendor}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `expenses/${expense.id}`);
    }
  };

  const handleDeleteExpense = async (expense: ExpenseRecord) => {
    if (isPeriodClosed(expense.date)) {
      return toast.error('Cannot delete or void an expense from a closed reporting period.');
    }

    const reason = window.prompt(
      `Confirm deleting/voiding expense for "${expense.vendor}" (${formatCurrency(expense.amount)}). Enter audit reason:`,
      'Duplicate or cancelled vendor bill'
    );
    if (!reason || !reason.trim()) return;

    try {
      if (expense.status === 'paid' && expense.transactionId) {
        await processReversalTransaction({
          originalTransactionId: expense.transactionId,
          amount: expense.amount,
          transactionType: 'expense_reversal',
          sourceModule: expense.paidFromModule || 'general_facility',
          cashierId: user?.uid || 'system',
          reason: reason.trim(),
          sourceAccount: '531 - Cash Drawer / Register (Caisse)',
          destinationAccount: (expense as any).expenseAccount || expense.category || '628 - General Operational Expenses',
        });
      }

      await deleteDoc(doc(db, 'expenses', expense.id));

      await logSystemAudit({
        action: 'DELETE',
        collectionName: 'expenses',
        documentId: expense.id,
        staffId: user?.uid || 'system',
        timestamp: new Date().toISOString(),
        details: {
          vendor: expense.vendor,
          category: expense.category,
          amountUSD: expense.amount,
          previousStatus: expense.status,
          reversedTransactionId: expense.transactionId || null,
          reason: reason.trim(),
        },
      });

      toast.success(
        expense.status === 'paid'
          ? 'Expense voided and ledger outflow reversed.'
          : 'Pending expense deleted.'
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `expenses/${expense.id}`);
    }
  };

  const handleEditExpense = (exp: ExpenseRecord) => {
    setEditingExpenseId(exp.id);
    setFormData({
      vendor: exp.vendor,
      category: exp.category,
      paidFromModule: exp.paidFromModule || 'general_facility',
      date: exp.date,
      currency: exp.currency,
      amount: String(exp.originalAmount ?? exp.amount),
      lbpAmount: exp.lbpAmount || '',
      description: exp.description,
      status: exp.status,
      includesVat: Boolean(exp.includesVat),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEditExpense = () => {
    setEditingExpenseId(null);
    setFormData({
      vendor: '',
      category: '',
      paidFromModule: 'general_facility',
      date: new Date().toISOString().split('T')[0],
      currency: 'USD',
      amount: '',
      lbpAmount: '',
      description: '',
      status: 'paid',
      includesVat: false,
    });
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      if (editingCatId) {
        await updateDoc(doc(db, 'chartOfAccounts', editingCatId), { name: newCatName.trim() });
        toast.success('Category updated');
      } else {
        await addDoc(collection(db, 'chartOfAccounts'), {
          code: `50${Math.floor(Math.random() * 1000)}`,
          name: newCatName.trim(),
          type: 'Expense',
          currency: 'USD',
        });
        toast.success('Category added');
      }
      setEditingCatId(null);
      setNewCatName('');
    } catch (error) {
      handleFirestoreError(error, editingCatId ? OperationType.UPDATE : OperationType.CREATE, 'chartOfAccounts');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!window.confirm('Delete this category?')) return;
    try {
      await deleteDoc(doc(db, 'chartOfAccounts', id));
      toast.success('Category deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'chartOfAccounts');
    }
  };

  const filteredExpenses = useMemo(() => {
    return expenses.filter((exp) => {
      if (statusFilter !== 'all' && exp.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && exp.category !== categoryFilter) return false;
      if (paidFromModuleFilter !== 'all' && (exp.paidFromModule || 'general_facility') !== paidFromModuleFilter) return false;
      if (currencyFilter !== 'all' && exp.currency !== currencyFilter) return false;
      if (dateFromFilter && exp.date < dateFromFilter) return false;
      if (dateToFilter && exp.date > dateToFilter) return false;
      if (vendorSearch.trim()) {
        const q = vendorSearch.toLowerCase();
        const matchVendor = exp.vendor.toLowerCase().includes(q);
        const matchDesc = exp.description.toLowerCase().includes(q);
        const matchCat = exp.category.toLowerCase().includes(q);
        const matchMod = getPayingModuleLabel(exp.paidFromModule).toLowerCase().includes(q);
        if (!matchVendor && !matchDesc && !matchCat && !matchMod) return false;
      }
      return true;
    });
  }, [expenses, statusFilter, categoryFilter, paidFromModuleFilter, currencyFilter, dateFromFilter, dateToFilter, vendorSearch]);

  const totalPaidUSD = useMemo(
    () => filteredExpenses.filter((e) => e.status === 'paid').reduce((sum, e) => sum + e.amount, 0),
    [filteredExpenses]
  );
  const totalPendingUSD = useMemo(
    () => filteredExpenses.filter((e) => e.status === 'pending').reduce((sum, e) => sum + e.amount, 0),
    [filteredExpenses]
  );

  return (
    <div className="space-y-8">
      {/* Top Form Card */}
      <div className="max-w-4xl bg-white dark:bg-[#0B0F17] p-6 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold">Advanced Expense Logging & Payables</h2>
            <p className="text-xs text-zinc-500">Record immediate cash outlays, recurring monthly templates, or pending vendor payables</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsRecurringMode(!isRecurringMode)}
              className="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold flex items-center gap-1.5 hover:bg-amber-500/20"
            >
              <Repeat size={14} /> Recurring Templates ({recurringTemplates.length})
            </button>
            <button onClick={() => setIsManageMode(!isManageMode)} className="text-sm font-bold text-[#0099A8] dark:text-[#00B8C8] hover:underline">
              {isManageMode ? 'Done Managing' : 'Manage Categories'}
            </button>
          </div>
        </div>

        {isRecurringMode && (
          <div className="mb-8 p-4 border border-amber-500/30 rounded-2xl bg-amber-500/5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <Repeat size={15} className="text-amber-500" /> Monthly Recurring Expense Templates (Rent, Generator, Internet, SaaS)
                </h3>
                <p className="text-xs text-zinc-500">Define fixed monthly operating expenses and execute them in 1 click each month</p>
              </div>
              <button
                type="button"
                onClick={handleRunMonthlyRecurringExpenses}
                className="px-4 py-2 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm shadow-cyan-500/20 transition-colors"
              >
                <Sparkles size={14} /> 1-Click Run Monthly Recurring ({new Date().toISOString().substring(0, 7)})
              </button>
            </div>

            <form onSubmit={handleAddRecurringTemplate} className="grid grid-cols-1 sm:grid-cols-6 gap-2">
              <input
                required
                placeholder="Vendor (e.g. Landlord)"
                value={recForm.vendor}
                onChange={e => setRecForm({ ...recForm, vendor: e.target.value })}
                className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-xs focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              />
              <select
                required
                value={recForm.category}
                onChange={e => setRecForm({ ...recForm, category: e.target.value })}
                className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-xs focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              >
                <option value="">Category...</option>
                {expenseAccounts.map(acc => (
                  <option key={acc.id} value={acc.name}>{acc.name}</option>
                ))}
              </select>
              <select
                required
                value={recForm.paidFromModule}
                onChange={e => setRecForm({ ...recForm, paidFromModule: e.target.value as PaidFromModuleAccount })}
                className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-xs font-bold focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              >
                {PAYING_MODULE_ACCOUNTS.map(mod => (
                  <option key={mod.id} value={mod.id}>{mod.shortLabel}</option>
                ))}
              </select>
              <input
                required
                type="number"
                step="0.01"
                placeholder="Amount ($ USD)"
                value={recForm.amount}
                onChange={e => setRecForm({ ...recForm, amount: e.target.value })}
                className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-xs font-mono focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              />
              <input
                placeholder="Description..."
                value={recForm.description}
                onChange={e => setRecForm({ ...recForm, description: e.target.value })}
                className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-xs focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              />
              <button type="submit" className="px-4 py-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg text-xs font-bold transition-colors">
                + Save Template
              </button>
            </form>

            {recurringTemplates.length > 0 && (
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {recurringTemplates.map(tpl => {
                  const isPostedThisMonth = tpl.lastPostedMonth === new Date().toISOString().substring(0, 7);
                  return (
                    <div key={tpl.id} className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">{tpl.vendor}</span> • <span className="text-zinc-500">{tpl.category}</span>
                        <span className="px-2 py-0.5 rounded bg-[#00B8C8]/10 text-[#00B8C8] font-bold text-[10px]">
                          {getPayingModuleShortLabel(tpl.paidFromModule)}
                        </span>
                        — <span className="font-mono font-black text-rose-500">{formatCurrency(Number(tpl.amountUSD || 0))}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isPostedThisMonth ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                          {isPostedThisMonth ? `Posted (${tpl.lastPostedMonth})` : 'Due This Month'}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteDoc(doc(db, 'recurring_expenses', tpl.id));
                            toast.success('Recurring template removed');
                          }}
                          className="text-rose-500 hover:bg-rose-500/10 p-1 rounded"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {isManageMode && (
          <div className="mb-8 p-4 border border-slate-200 dark:border-zinc-800 rounded-xl bg-slate-50 dark:bg-zinc-900/40">
            <h3 className="text-sm font-bold mb-4">Manage Expense Categories</h3>
            <form onSubmit={handleSaveCategory} className="flex gap-2 mb-4">
              <input
                required
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category Name"
                className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              />
              <button type="submit" className="px-4 py-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg text-sm font-bold transition-colors">
                {editingCatId ? 'Save' : 'Add'}
              </button>
              {editingCatId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCatId(null);
                    setNewCatName('');
                  }}
                  className="p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg"
                >
                  <X size={16} />
                </button>
              )}
            </form>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
              {expenseAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between p-2 bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-lg"
                >
                  <span className="text-sm font-medium">{acc.name}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingCatId(acc.id);
                        setNewCatName(acc.name);
                      }}
                      className="text-[#00B8C8] hover:bg-[#00B8C8]/10 p-1.5 rounded"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(acc.id)}
                      className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 p-1.5 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {expenseAccounts.length === 0 && (
                <p className="text-xs text-zinc-500">No expense categories found. Add one above.</p>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {editingExpenseId && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs">
              <span className="font-bold text-amber-500">
                Editing Expense Entry — Update fields or reassign the Paying Module Account below
              </span>
              <button
                type="button"
                onClick={handleCancelEditExpense}
                className="px-2.5 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold hover:bg-zinc-300 dark:hover:bg-zinc-700"
              >
                Cancel Edit
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Vendor / Supplier</label>
              <input
                required
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                type="text"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
                placeholder="Vendor name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Category Account</label>
              <select
                required
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-zinc-100 focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              >
                <option value="">Select Category...</option>
                {expenseAccounts.map((acc) => (
                  <option key={acc.id} value={acc.name}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold mb-1 text-[#0099A8] dark:text-[#00B8C8]">
                Paid From / Charged To Module Account *
              </label>
              <select
                required
                value={formData.paidFromModule}
                onChange={(e) => setFormData({ ...formData, paidFromModule: e.target.value as PaidFromModuleAccount })}
                className="w-full px-3 py-2 rounded-lg border border-[#00B8C8]/50 bg-[#00B8C8]/5 font-bold text-zinc-900 dark:text-zinc-100 focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              >
                {PAYING_MODULE_ACCOUNTS.map((mod) => (
                  <option key={mod.id} value={mod.id}>
                    {mod.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Payment Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as 'paid' | 'pending' })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent font-bold text-zinc-900 dark:text-zinc-100 focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              >
                <option value="paid">Paid Immediately (Post to Ledger)</option>
                <option value="pending">Pending / Payable (Pay Later)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Expense Date</label>
              <input
                required
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Description</label>
              <input
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                type="text"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
                placeholder="What was purchased or billed?"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Currency</label>
              <select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value as 'USD' | 'LBP' })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              >
                <option value="USD">USD ($)</option>
                <option value="LBP">LBP (ل.ل)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Amount ({formData.currency})</label>
              <input
                required
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                type="number"
                step="0.01"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent font-mono focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">LBP Reference Note (Optional)</label>
              <input
                value={formData.lbpAmount}
                onChange={(e) => setFormData({ ...formData, lbpAmount: e.target.value })}
                type="number"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent font-mono focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
                placeholder="LBP Amount"
              />
            </div>
            <div className="md:col-span-3 flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800">
              <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-700 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={formData.includesVat}
                  onChange={(e) => setFormData({ ...formData, includesVat: e.target.checked })}
                  className="w-4 h-4 rounded accent-[#00B8C8]"
                />
                <span>Includes Lebanese 11% Deductible Input VAT (<code className="text-[#00B8C8]">4426 - TVA Déductible</code>)</span>
              </label>
              {formData.includesVat && Number(formData.amount) > 0 && (
                <span className="text-[11px] font-mono text-[#00B8C8] font-bold">
                  Net: {(Number(formData.amount) / 1.11).toFixed(2)} {formData.currency} • Input VAT (11%): {(Number(formData.amount) - Number(formData.amount) / 1.11).toFixed(2)} {formData.currency}
                </span>
              )}
            </div>
          </div>
          <button
            type="submit"
            className={`w-full py-2.5 mt-4 rounded-xl font-bold transition-colors ${
              editingExpenseId
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                : formData.status === 'paid'
                ? 'bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 shadow-sm shadow-cyan-500/15'
                : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`}
          >
            {editingExpenseId
              ? 'Save Expense Changes & Sync Module Account'
              : formData.status === 'paid'
              ? `Record Expense & Deduct from ${getPayingModuleShortLabel(formData.paidFromModule)}`
              : `Log Pending Payable (${getPayingModuleShortLabel(formData.paidFromModule)})`}
          </button>
        </form>
      </div>

      {/* Expense Ledger & Payables Tracker Table */}
      <div className="bg-white dark:bg-[#0B0F17] p-6 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold">Expenses & Payables Registry</h3>
            <p className="text-xs text-zinc-500">Filter by module account, status, category, currency, date range, or vendor</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Paid Outflows</div>
              <div className="text-base font-black font-mono text-emerald-500">{formatCurrency(totalPaidUSD)}</div>
            </div>
            <div className="px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-600">Pending Payables</div>
              <div className="text-base font-black font-mono text-amber-500">{formatCurrency(totalPendingUSD)}</div>
            </div>
            <div className="px-4 py-2.5 rounded-xl bg-[#00B8C8]/10 border border-[#00B8C8]/25 col-span-2 sm:col-span-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#0099A8] dark:text-[#00B8C8]">Total Filtered</div>
              <div className="text-base font-black font-mono text-[#00B8C8]">{formatCurrency(totalPaidUSD + totalPendingUSD)}</div>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              placeholder="Search vendor or desc..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
            />
          </div>
          <select
            value={paidFromModuleFilter}
            onChange={(e) => setPaidFromModuleFilter(e.target.value as 'all' | PaidFromModuleAccount)}
            className="px-3 py-2 text-xs font-bold rounded-lg border border-[#00B8C8]/40 bg-[#00B8C8]/5 text-[#0099A8] dark:text-[#00B8C8] focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
          >
            <option value="all">All Module Accounts</option>
            {PAYING_MODULE_ACCOUNTS.map((mod) => (
              <option key={mod.id} value={mod.id}>
                {mod.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'paid' | 'pending')}
            className="px-3 py-2 text-xs font-bold rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="paid">Paid Only</option>
            <option value="pending">Pending / Payable</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs font-bold rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
          >
            <option value="all">All Categories</option>
            {expenseAccounts.map((acc) => (
              <option key={acc.id} value={acc.name}>
                {acc.name}
              </option>
            ))}
          </select>
          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value as 'all' | 'USD' | 'LBP')}
            className="px-3 py-2 text-xs font-bold rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
          >
            <option value="all">All Currencies</option>
            <option value="USD">USD ($)</option>
            <option value="LBP">LBP (ل.ل)</option>
          </select>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={dateFromFilter}
              onChange={(e) => setDateFromFilter(e.target.value)}
              className="w-1/2 px-2 py-2 text-[11px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] outline-none"
              title="From Date"
            />
            <input
              type="date"
              value={dateToFilter}
              onChange={(e) => setDateToFilter(e.target.value)}
              className="w-1/2 px-2 py-2 text-[11px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] outline-none"
              title="To Date"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="text-[10px] font-black uppercase tracking-widest text-zinc-500 bg-slate-50 dark:bg-zinc-950/60 border-y border-slate-200 dark:border-zinc-800">
              <tr>
                <th className="p-3.5">Date</th>
                <th className="p-3.5">Vendor</th>
                <th className="p-3.5">Paid From Module</th>
                <th className="p-3.5">Category</th>
                <th className="p-3.5">Description</th>
                <th className="p-3.5">Currency</th>
                <th className="p-3.5 text-right">Amount</th>
                <th className="p-3.5 text-center">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-zinc-800/60">
              {filteredExpenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-slate-50 dark:hover:bg-zinc-800/30 transition-colors">
                  <td className="p-3.5 font-mono text-xs text-zinc-500">{exp.date}</td>
                  <td className="p-3.5 font-bold">{exp.vendor}</td>
                  <td className="p-3.5">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/25">
                      {getPayingModuleShortLabel(exp.paidFromModule)}
                    </span>
                  </td>
                  <td className="p-3.5">
                    <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                      {exp.category}
                    </span>
                  </td>
                  <td className="p-3.5 text-xs text-zinc-600 dark:text-zinc-400 max-w-xs truncate">{exp.description}</td>
                  <td className="p-3.5 font-mono text-xs font-bold">{exp.currency}</td>
                  <td className="p-3.5 text-right font-mono font-black text-rose-500">
                    {formatCurrency(exp.amount)}
                  </td>
                  <td className="p-3.5 text-center">
                    {exp.status === 'paid' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-500">
                        <CheckCircle2 size={12} /> Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-500">
                        <Clock size={12} /> Pending
                      </span>
                    )}
                  </td>
                  <td className="p-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {exp.status === 'pending' && (
                        <button
                          onClick={() => handleMarkAsPaid(exp)}
                          className="px-3 py-1.5 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-bold transition-colors flex items-center gap-1 shadow-sm"
                          title="Execute Payment & Post to Ledger"
                        >
                          <DollarSign size={12} /> Mark as Paid
                        </button>
                      )}
                      <button
                        onClick={() => handleEditExpense(exp)}
                        className="p-1.5 rounded-lg text-[#00B8C8] hover:bg-[#00B8C8]/10 transition-colors"
                        title="Edit Expense / Change Paying Module Account"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteExpense(exp)}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors"
                        title={exp.status === 'paid' ? 'Void & Reverse Expense' : 'Delete Pending Expense'}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-zinc-500 italic text-xs">
                    No expenses match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

