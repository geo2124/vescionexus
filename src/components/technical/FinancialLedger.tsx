import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, doc, addDoc, updateDoc, serverTimestamp, deleteDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { format, subDays, startOfMonth, startOfYear, endOfYear, subYears } from 'date-fns';
import { FileText, Table, DollarSign, List, BarChart3, Download, Filter, FileSpreadsheet, Receipt, Calendar, Plus, Save, Trash2, ArrowUp, ArrowDown, Settings, Edit2, Play, Eye, EyeOff, Scale } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

import { ExecutiveDashboard } from './reports/ExecutiveDashboard';
import { GrowthMetrics } from './reports/GrowthMetrics';
import { CohortAnalysis } from './reports/CohortAnalysis';
import { FXTracking } from './reports/FXTracking';
import { AgingReport } from './reports/AgingReport';
import { OperationalFinance } from './reports/OperationalFinance';
import { Statements } from './reports/Statements';
import { InventoryLedger } from './reports/InventoryLedger';
import { BudgetVariance } from './reports/BudgetVariance';
import { BankReconciliation } from './reports/BankReconciliation';
import { RecurringAccruals } from './reports/RecurringAccruals';

interface FinancialLedgerProps {
  isDarkMode: boolean;
  isAdvancedMode?: boolean;
  globalCurrency?: 'USD' | 'LBP';
  formatCurrency?: (amount: number) => string;
  selectedModules?: string[];
}

type ReportType = 'trial_balance' | 'general_ledger' | 'pnl' | 'journal' | 'module_summary' | 'custom_builder' | 'custom_manager' | string;
type DatePreset = 'today' | '30d' | 'mtd' | 'ytd' | 'last_year' | 'all' | 'custom';

// Custom Report Typings
export interface CustomReportRow {
  id: string; 
  label: string; 
  type: 'account' | 'category' | 'formula';
  matchCriteria: string[]; 
  formula: string; 
}

export interface CustomReportDef {
  id?: string;
  name: string;
  description: string;
  baseMode: 'movement' | 'balance';
  rows: CustomReportRow[];
  createdAt?: any;
}

// Accounting Core Definitions
type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
type NormalBalance = 'debit' | 'credit';

const getAccountCategory = (accStr: string): AccountCategory => {
  const acc = accStr.toLowerCase().trim();
  // LCOA Class 1-7 Code Prefix Recognition
  if (/^1(01|10|20|\d\d)/.test(acc)) return 'equity';
  if (/^281/.test(acc) || acc.includes('accumulated_depreciation') || acc.includes('accumulated depreciation')) return 'liability';
  if (/^(2|3|5)\d\d/.test(acc) || /^4(11|25|43)/.test(acc)) return 'asset';
  if (/^4(01|19|21|31|42|\d\d)/.test(acc)) return 'liability';
  if (/^6\d\d/.test(acc)) return 'expense';
  if (/^7\d\d/.test(acc)) return 'revenue';

  if (acc.includes('revenue') || acc.includes('income') || acc.includes('sales')) return 'revenue';
  if (acc.includes('expense') || acc.includes('cost') || acc.includes('payout') || acc.includes('audit') || acc.includes('salary') || acc.includes('depreciation') || acc.includes('amortization')) return 'expense';
  if (acc.includes('balance') || acc.includes('liability') || acc.includes('deposit') || acc.includes('payable') || acc.includes('vat collected')) return 'liability';
  if (acc.includes('equity') || acc.includes('capital') || acc.includes('retained')) return 'equity';
  // Default remaining (external_cash, stripe, terminal, receivable, inventory, etc.) to Asset
  return 'asset'; 
};

const isEligibleForModeBCashAdjustment = (t: any, isAdvancedMode: boolean, adjustmentPercentage: number): boolean => {
  if (!isAdvancedMode || !adjustmentPercentage || adjustmentPercentage === 0) return false;
  if (!t || t.isReversal || t.isB2BInvoice) return false;
  if (t.transactionType === 'b2b_invoice' || t.transactionType === 'supplier_bill' || t.transactionType === 'manual_journal') return false;
  const isCash = t.paymentMethod === 'cash' || (t.sourceAccount && String(t.sourceAccount).toLowerCase().includes('cash'));
  const isInflow = t.direction === 'inflow' || (!t.direction && (t.amount || 0) > 0);
  const eligibleModules = ['gym', 'gym_checkin', 'reservation', 'reservations', 'court', 'courts', 'pos_retail', 'pos_cafe', 'pos_cafeteria', 'physio'];
  return Boolean(isCash && isInflow && eligibleModules.includes(t.sourceModule || ''));
};

const getNormalBalance = (category: AccountCategory): NormalBalance => {
  switch(category) {
    case 'asset':
    case 'expense':
      return 'debit';
    case 'liability':
    case 'equity':
    case 'revenue':
      return 'credit';
    default:
      return 'credit';
  }
};

interface ReportConfigItem {
  id: string; // Report ID or custom run ID (`custom_run_xxx`)
  visible: boolean;
  order: number;
}

const DEFAULT_OPERATING_MODULES = ['gym', 'physio', 'retail_pos', 'cafeteria_pos', 'reservations'];

type ReportCategory = 'Accounting Foundations' | 'Sub-Ledgers & Liquidity' | 'Taxes & Compliance' | 'Revenue & Operations' | 'Executive & Growth';

interface BuiltInReport {
  id: string;
  label: string;
  icon: any;
  category: ReportCategory;
  isBuiltIn: boolean;
}

const DEPARTMENT_MODULE_ACCOUNTS = [
  { key: 'court_basketball', label: 'Basketball Court Reservation Account', shortLabel: 'Basketball Court', code: 'DEPT-01' },
  { key: 'court_padel_tennis', label: 'Padel & Tennis Court Account', shortLabel: 'Padel & Tennis', code: 'DEPT-02' },
  { key: 'gym', label: 'Gym Management Account', shortLabel: 'Gym Management', code: 'DEPT-03' },
  { key: 'physio', label: 'Physiotherapy Account', shortLabel: 'Physiotherapy', code: 'DEPT-04' },
  { key: 'pos_cafeteria', label: 'Kiosk POS Account', shortLabel: 'Kiosk POS', code: 'DEPT-05' },
  { key: 'pos_retail', label: 'Retail Shop POS Account', shortLabel: 'Retail Shop POS', code: 'DEPT-06' },
  { key: 'general_facility', label: 'General Facility / HQ Account', shortLabel: 'General Facility / HQ', code: 'DEPT-07' },
] as const;

const BUILT_IN_REPORTS: BuiltInReport[] = [
  // General
  { id: 'general_ledger', label: 'General Ledger', category: 'Accounting Foundations', icon: FileText, isBuiltIn: true },
  { id: 'journal', label: 'System Journal Entries', category: 'Accounting Foundations', icon: List, isBuiltIn: true },
  { id: 'module_summary', label: 'Module Accounts IN & OUT (Analytique)', category: 'Accounting Foundations', icon: BarChart3, isBuiltIn: true },
  { id: 'trial_balance', label: 'Trial Balance', category: 'Accounting Foundations', icon: Table, isBuiltIn: true },
  { id: 'pnl', label: 'Profit & Loss Statement', category: 'Accounting Foundations', icon: DollarSign, isBuiltIn: true },
  { id: 'balance_sheet', label: 'Balance Sheet (Statement of Position)', category: 'Accounting Foundations', icon: Table, isBuiltIn: true },
  { id: 'coa_overview', label: 'Chart of Accounts Overview', category: 'Accounting Foundations', icon: List, isBuiltIn: true },

  // Sub-Ledgers
  { id: 'ar_aging', label: 'AR Aging Report (0-90+)', category: 'Sub-Ledgers & Liquidity', icon: FileText, isBuiltIn: true },
  { id: 'ap_aging', label: 'AP Aging Report', category: 'Sub-Ledgers & Liquidity', icon: FileText, isBuiltIn: true },
  { id: 'bank_reconciliation', label: 'AI Bank Reconciliation', category: 'Sub-Ledgers & Liquidity', icon: FileText, isBuiltIn: true },
  { id: 'recurring_accruals', label: 'Recurring Accruals & Prepayments', category: 'Sub-Ledgers & Liquidity', icon: FileText, isBuiltIn: true },
  { id: 'customer_statements', label: 'Customer Statements', category: 'Sub-Ledgers & Liquidity', icon: FileText, isBuiltIn: true },
  { id: 'supplier_statements', label: 'Supplier Statements', category: 'Sub-Ledgers & Liquidity', icon: FileText, isBuiltIn: true },
  { id: 'inventory_ledger', label: 'Inventory Ledger Valuation', category: 'Sub-Ledgers & Liquidity', icon: FileText, isBuiltIn: true },

  // Taxes
  { id: 'vat_report', label: 'VAT Report (Input vs Output)', category: 'Taxes & Compliance', icon: FileText, isBuiltIn: true },
  { id: 'audit_logs', label: 'Immutable Audit Trail', category: 'Taxes & Compliance', icon: FileText, isBuiltIn: true },

  // Revenue & Operations
  { id: 'revenue_breakdown', label: 'Revenue Breakdown', category: 'Revenue & Operations', icon: BarChart3, isBuiltIn: true },
  { id: 'pos_finance', label: 'Retail & POS Gross Margins', category: 'Revenue & Operations', icon: BarChart3, isBuiltIn: true },
  { id: 'facility_finance', label: 'Facility Reservations Yield', category: 'Revenue & Operations', icon: BarChart3, isBuiltIn: true },
  
  // Executive & Growth
  { id: 'executive_dashboard', label: 'Executive Dashboard (EBITDA/Runway)', category: 'Executive & Growth', icon: BarChart3, isBuiltIn: true },
  { id: 'variance_analysis', label: 'Budget vs Actuals (Variance)', category: 'Executive & Growth', icon: BarChart3, isBuiltIn: true },
  { id: 'growth_metrics', label: 'Growth Metrics (MRR/ARR)', category: 'Executive & Growth', icon: BarChart3, isBuiltIn: true },
  { id: 'cohort_analysis', label: 'Cohort & Retention Analysis', category: 'Executive & Growth', icon: BarChart3, isBuiltIn: true },
  { id: 'fx_tracking', label: 'Multi-Currency & FX Ledger', category: 'Executive & Growth', icon: FileText, isBuiltIn: true },
];

export const FinancialLedger: React.FC<FinancialLedgerProps> = ({ isDarkMode, isAdvancedMode = false, globalCurrency, formatCurrency: externalFormatCurrency, selectedModules: externalSelectedModules }) => {
  const { user, currency: systemCurrency, usdToLbpRate, taxRules, adjustmentPercentage, handleFirestoreError, systemName } = useFirebase();
  const [internalDisplayCurrency, setInternalDisplayCurrency] = useState<'USD' | 'LBP'>('USD');
  const [internalSelectedModules, setInternalSelectedModules] = useState<string[]>(['all']);

  const displayCurrency = isAdvancedMode && globalCurrency ? globalCurrency : internalDisplayCurrency;
  const setDisplayCurrency = setInternalDisplayCurrency;
  const selectedModules = isAdvancedMode && externalSelectedModules ? externalSelectedModules : internalSelectedModules;
  const setSelectedModules = setInternalSelectedModules;
  
  useEffect(() => {
    setInternalDisplayCurrency(systemCurrency);
  }, [systemCurrency]);

  const convertReportValue = (amountInUSD: number) => {
    return displayCurrency === 'LBP' ? amountInUSD * usdToLbpRate : amountInUSD;
  };

  const formatReportCurrency = (amountInUSD: number) => {
    if (isAdvancedMode && externalFormatCurrency) {
      return externalFormatCurrency(amountInUSD);
    }
    const amount = convertReportValue(amountInUSD);
    if (displayCurrency === 'LBP') {
      return `ل.ل ${Math.round(amount).toLocaleString()}`;
    }
    return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [liveInventory, setLiveInventory] = useState<any[]>([]);
  const [liveMembers, setLiveMembers] = useState<any[]>([]);
  const [liveExpenses, setLiveExpenses] = useState<any[]>([]);
  const [liveBookings, setLiveBookings] = useState<any[]>([]);
  const [liveInvoices, setLiveInvoices] = useState<any[]>([]);
  const [liveSystemAudits, setLiveSystemAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeReport, setActiveReport] = useState<ReportType>('journal');
  const [datePreset, setDatePreset] = useState<DatePreset>('mtd');
  const [customDateFrom, setCustomDateFrom] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customDateTo, setCustomDateTo] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [selectedFilterCostCenter, setSelectedFilterCostCenter] = useState<string>('all');
  const [selectedDepartmentAccount, setSelectedDepartmentAccount] = useState<string>('all');
  const [showDepartmentInOutStrip, setShowDepartmentInOutStrip] = useState<boolean>(true);
  const [selectedGlAccount, setSelectedGlAccount] = useState<string>('all');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('all');
  const [inspectedTransaction, setInspectedTransaction] = useState<any | null>(null);
  
  // Custom Reports State
  const [customReports, setCustomReports] = useState<CustomReportDef[]>([]);
  const [editingReport, setEditingReport] = useState<CustomReportDef | null>(null);
  
  // Report Config State
  const [reportConfig, setReportConfig] = useState<Record<string, ReportConfigItem>>({});
  
  // Fetch Live Ledger & Sub-Ledger Collections
  useEffect(() => {
    if (!user) return;
    setLoading(true);

    const collectionName = isAdvancedMode ? 'advanced_transactions' : 'transactions';
    const q = query(collection(db, collectionName), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txns = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      setAllTransactions(txns);
      setLoading(false);
    }, (error) => {
      try { handleFirestoreError(error, OperationType.LIST, collectionName); } catch (e) { console.error(e); }
      setLoading(false);
    });
    
    const crQ = query(collection(db, 'custom_reports'), orderBy('createdAt', 'desc'));
    const crUnsub = onSnapshot(crQ, (snap) => {
       const reports = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CustomReportDef));
       setCustomReports(reports);
    }, (error) => {
       try { handleFirestoreError(error, OperationType.LIST, 'custom_reports'); } catch (e) { console.error('Custom Reports Error', e); }
    });

    const rcUnsub = onSnapshot(doc(db, 'settings', 'report_config'), (snap) => {
       if (snap.exists()) {
          setReportConfig(snap.data().config || {});
       } else {
          setReportConfig({});
       }
    }, (error) => {
       try { handleFirestoreError(error, OperationType.GET, 'settings/report_config'); } catch (e) { console.error('Report Config Error', e); }
    });

    const invUnsub = onSnapshot(collection(db, 'inventory'), snap => {
      setLiveInventory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const memUnsub = onSnapshot(collection(db, 'members'), snap => {
      setLiveMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const expUnsub = onSnapshot(collection(db, 'expenses'), snap => {
      setLiveExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const bookUnsub = onSnapshot(collection(db, 'bookings'), snap => {
      setLiveBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
    const billsUnsub = onSnapshot(collection(db, 'invoices'), snap => {
      setLiveInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const auditUnsub = onSnapshot(collection(db, 'system_audit'), snap => {
      setLiveSystemAudits(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});

    return () => {
      unsubscribe();
      crUnsub();
      rcUnsub();
      invUnsub();
      memUnsub();
      expUnsub();
      bookUnsub();
      billsUnsub();
      auditUnsub();
    };
  }, [user, isAdvancedMode]);

  const bookingsById = useMemo(() => {
    const map: Record<string, any> = {};
    liveBookings.forEach(b => {
      if (b.id) map[b.id] = b;
    });
    return map;
  }, [liveBookings]);

  const expensesById = useMemo(() => {
    const map: Record<string, any> = {};
    liveExpenses.forEach(e => {
      if (e.id) map[e.id] = e;
    });
    return map;
  }, [liveExpenses]);

  const resolveDepartmentAccount = (t: any): string => {
    const validKeys = new Set<string>(DEPARTMENT_MODULE_ACCOUNTS.map(d => d.key));
    if (t.paidFromModule && validKeys.has(t.paidFromModule)) {
      return t.paidFromModule;
    }
    const rawMod = (t.sourceModule || '').trim();
    if (validKeys.has(rawMod)) {
      return rawMod;
    }
    if (rawMod === 'pos_cafe' || rawMod === 'cafeteria_pos') return 'pos_cafeteria';
    if (rawMod === 'retail_pos') return 'pos_retail';
    if (rawMod === 'gym_checkin') return 'gym';

    const destAcc = String(t.destinationAccount || '').toLowerCase();
    const srcAcc = String(t.sourceAccount || '').toLowerCase();
    const notesStr = String(t.notes || '').toLowerCase();
    const refId = String(t.referenceId || '');

    if (
      rawMod === 'reservation' ||
      rawMod === 'reservations' ||
      rawMod === 'courts' ||
      rawMod === 'court' ||
      destAcc.includes('7062') ||
      srcAcc.includes('7062') ||
      destAcc.includes('court')
    ) {
      const courtVal = String(t.court || bookingsById[refId]?.court || '').toLowerCase();
      if (
        courtVal.includes('padel') ||
        courtVal.includes('tennis') ||
        notesStr.includes('padel') ||
        notesStr.includes('tennis')
      ) {
        return 'court_padel_tennis';
      }
      return 'court_basketball';
    }

    if (rawMod === 'expenses' || expensesById[refId]) {
      const expMod = expensesById[refId]?.paidFromModule;
      if (expMod && validKeys.has(expMod)) return expMod;
      return 'general_facility';
    }

    return 'general_facility';
  };

  const pendingPostingCount = useMemo(() => {
    if (!isAdvancedMode) return 0;
    return allTransactions.filter(t => {
      const s = t.accountingStatus || 'pending';
      return (s === 'pending' || s === 'unposted') && t.sourceModule !== 'academy';
    }).length;
  }, [allTransactions, isAdvancedMode]);

  const { filteredTransactions, openingTransactions, periodDepartmentTransactions } = useMemo(() => {
    const getDateRange = () => {
      const now = new Date();
      switch (datePreset) {
        case 'today': return { startStr: format(now, 'yyyy-MM-dd'), endStr: format(now, 'yyyy-MM-dd') };
        case '30d': return { startStr: format(subDays(now, 30), 'yyyy-MM-dd'), endStr: format(now, 'yyyy-MM-dd') };
        case 'mtd': return { startStr: format(startOfMonth(now), 'yyyy-MM-dd'), endStr: format(now, 'yyyy-MM-dd') };
        case 'ytd': return { startStr: format(startOfYear(now), 'yyyy-MM-dd'), endStr: format(now, 'yyyy-MM-dd') };
        case 'last_year': {
            const lastYear = subYears(now, 1);
            return { 
                startStr: format(startOfYear(lastYear), 'yyyy-MM-dd'), 
                endStr: format(endOfYear(lastYear), 'yyyy-MM-dd') 
            };
        }
        case 'all': return { startStr: '1900-01-01', endStr: '2100-01-01' };
        case 'custom': return { startStr: customDateFrom, endStr: customDateTo };
        default: return { startStr: format(startOfMonth(now), 'yyyy-MM-dd'), endStr: format(now, 'yyyy-MM-dd') };
      }
    };

    const { startStr, endStr } = getDateRange();
    const opening: any[] = [];
    const filtered: any[] = [];
    const deptPeriodAll: any[] = [];
    const factor = (isAdvancedMode && adjustmentPercentage !== 0)
      ? Math.max(0, 1 + (adjustmentPercentage / 100))
      : 1;

    allTransactions.forEach(rawTxn => {
      if (!rawTxn.createdAt) return;
      
      const tDate = rawTxn.createdAt?.seconds ? new Date(rawTxn.createdAt.seconds * 1000) : new Date(rawTxn.createdAt);
      if (isNaN(tDate.getTime())) return;
      const tDateStr = format(tDate, 'yyyy-MM-dd');
      
      const isBeforePeriod = tDateStr < startStr;
      const isAfterPeriod = tDateStr > endStr;
      
      let isModuleMatch = false;
      const normalizedMod = rawTxn.sourceModule === 'pos_cafeteria' ? 'pos_cafe' : rawTxn.sourceModule;
      const deptKey = resolveDepartmentAccount(rawTxn);
      if (selectedModules.includes('all')) {
         isModuleMatch = rawTxn.sourceModule !== 'academy';
      } else {
         const matchSystem = selectedModules.includes('system') && !rawTxn.sourceModule;
         isModuleMatch = matchSystem || !!(rawTxn.sourceModule && (selectedModules.includes(rawTxn.sourceModule) || selectedModules.includes(normalizedMod) || selectedModules.includes(deptKey)) && rawTxn.sourceModule !== 'academy');
      }
      
      const isPostedMatch = isAdvancedMode ? rawTxn.accountingStatus === 'posted' : true;
      let isCostCenterMatch = true;
      if (selectedFilterCostCenter !== 'all') {
         isCostCenterMatch = rawTxn.costCenter === selectedFilterCostCenter;
      }
      
      if (isModuleMatch && isPostedMatch && isCostCenterMatch && !isAfterPeriod) {
         // Mode B Audit-Proof Custom % Deficit / Adjustment Engine
         const isEligible = isEligibleForModeBCashAdjustment(rawTxn, isAdvancedMode, adjustmentPercentage);
         const scaledTxn = isEligible
           ? {
               ...rawTxn,
               originalAmount: rawTxn.amount,
               amount: Number(((rawTxn.amount || 0) * factor).toFixed(2)),
               subtotal: Number(((rawTxn.subtotal ?? rawTxn.amount ?? 0) * factor).toFixed(2)),
               total: Number(((rawTxn.total ?? rawTxn.amount ?? 0) * factor).toFixed(2)),
               vatAmount: rawTxn.vatAmount ? Number((rawTxn.vatAmount * factor).toFixed(2)) : 0,
               isAdjustedByModeB: true,
               resolvedDepartmentAccount: deptKey
             }
           : {
               ...rawTxn,
               resolvedDepartmentAccount: deptKey
             };

         if (!isBeforePeriod || datePreset === 'all') {
           deptPeriodAll.push(scaledTxn);
         }

         if (selectedDepartmentAccount !== 'all' && deptKey !== selectedDepartmentAccount) {
           return;
         }

         if (isBeforePeriod && datePreset !== 'all') {
           opening.push(scaledTxn);
         } else {
           filtered.push(scaledTxn);
         }
      }
    });

    return { filteredTransactions: filtered, openingTransactions: opening, periodDepartmentTransactions: deptPeriodAll };
  }, [allTransactions, datePreset, selectedModules, customDateFrom, customDateTo, isAdvancedMode, selectedFilterCostCenter, adjustmentPercentage, selectedDepartmentAccount, bookingsById, expensesById]);

  const availableModules = useMemo(() => {
    const modules = new Set<string>([
      'gym',
      'reservation',
      'pos_cafe',
      'pos_retail',
      'physio',
      'payroll',
      'expenses',
      'invoicing',
      'system'
    ]);
    allTransactions.forEach(t => {
      if (t.sourceModule && t.sourceModule !== 'academy') {
        modules.add(t.sourceModule === 'pos_cafeteria' ? 'pos_cafe' : t.sourceModule);
      } else if (!t.sourceModule) {
        modules.add('system');
      }
    });
    return Array.from(modules).sort();
  }, [allTransactions]);

  // --- Reports Calculations ---

  // 1. Transaction Journal
  const journalData = useMemo(() => {
    return filteredTransactions.map(t => ({
      date: t.createdAt ? format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd HH:mm') : 'N/A',
      timestamp: t.createdAt ? t.createdAt.seconds : 0,
      id: t.id.slice(0,8),
      fullId: t.id,
      rawTxn: t,
      type: (t.transactionType || 'unknown').replace(/_/g, ' '),
      sourceAccount: (t.sourceAccount || 'unknown').replace(/_/g, ' '),
      destinationAccount: (t.destinationAccount || 'unknown').replace(/_/g, ' '),
      module: t.sourceModule === 'pos_cafe' || t.sourceModule === 'pos_cafeteria' ? 'kiosk pos' : t.sourceModule === 'pos_retail' ? 'retail shop pos' : (t.sourceModule || 'unknown').replace(/_/g, ' '),
      amount: t.amount,
      isReversal: t.isReversal ? 'YES' : 'NO'
    }));
  }, [filteredTransactions]);

  // General Account Aggregation (Strict Double-Entry with Opening, Period, and Closing columns)
  const accountBalances = useMemo(() => {
    const accs: Record<string, {
      openDebit: number;
      openCredit: number;
      periodDebit: number;
      periodCredit: number;
      debit: number;
      credit: number;
      net: number;
      category: AccountCategory;
      normal: NormalBalance;
    }> = {};

    const ensureAcc = (accName: string) => {
      if (!accs[accName]) {
        const cat = getAccountCategory(accName);
        accs[accName] = {
          openDebit: 0,
          openCredit: 0,
          periodDebit: 0,
          periodCredit: 0,
          debit: 0,
          credit: 0,
          net: 0,
          category: cat,
          normal: getNormalBalance(cat)
        };
      }
    };

    openingTransactions.forEach(t => {
      const src = t.sourceAccount || 'unknown';
      const dest = t.destinationAccount || 'unknown';
      const amt = Number(t.amount) || 0;
      ensureAcc(src);
      ensureAcc(dest);
      accs[src].openDebit += amt;
      accs[dest].openCredit += amt;
      accs[src].debit += amt;
      accs[dest].credit += amt;
    });

    filteredTransactions.forEach(t => {
      const src = t.sourceAccount || 'unknown';
      const dest = t.destinationAccount || 'unknown';
      const amt = Number(t.amount) || 0;
      ensureAcc(src);
      ensureAcc(dest);
      accs[src].periodDebit += amt;
      accs[dest].periodCredit += amt;
      accs[src].debit += amt;
      accs[dest].credit += amt;
    });

    Object.keys(accs).forEach(key => {
      const acc = accs[key];
      acc.net = acc.normal === 'debit'
        ? (acc.debit - acc.credit)
        : (acc.credit - acc.debit);
    });

    return accs;
  }, [openingTransactions, filteredTransactions]);

  // 2. 6-Column Lebanese Trial Balance (Balance Générale à 6 Colonnes)
  const trialBalanceData = useMemo(() => {
    const data = Object.keys(accountBalances).map(acc => {
      const b = accountBalances[acc];
      const closeDr = b.openDebit + b.periodDebit;
      const closeCr = b.openCredit + b.periodCredit;
      return {
        rawKey: acc,
        account: acc.replace(/_/g, ' ').toUpperCase(),
        category: b.category.toUpperCase(),
        normal: b.normal.toUpperCase(),
        openDebit: b.openDebit,
        openCredit: b.openCredit,
        periodDebit: b.periodDebit,
        periodCredit: b.periodCredit,
        closeDebit: closeDr,
        closeCredit: closeCr,
        debit: b.debit,
        credit: b.credit,
        net: b.net,
      };
    }).sort((a, b) => {
      const order: Record<string, number> = { 'EQUITY': 1, 'ASSET': 2, 'LIABILITY': 3, 'EXPENSE': 4, 'REVENUE': 5 };
      const aOrder = order[a.category] || 9;
      const bOrder = order[b.category] || 9;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.account.localeCompare(b.account);
    });

    const totals = data.reduce((acc, curr) => ({
      openDebit: acc.openDebit + curr.openDebit,
      openCredit: acc.openCredit + curr.openCredit,
      periodDebit: acc.periodDebit + curr.periodDebit,
      periodCredit: acc.periodCredit + curr.periodCredit,
      closeDebit: acc.closeDebit + curr.closeDebit,
      closeCredit: acc.closeCredit + curr.closeCredit,
      debit: acc.debit + curr.debit,
      credit: acc.credit + curr.credit,
      net: acc.net + curr.net
    }), {
      openDebit: 0,
      openCredit: 0,
      periodDebit: 0,
      periodCredit: 0,
      closeDebit: 0,
      closeCredit: 0,
      debit: 0,
      credit: 0,
      net: 0
    });

    const isBalanced =
      Math.abs(totals.openDebit - totals.openCredit) < 0.05 &&
      Math.abs(totals.periodDebit - totals.periodCredit) < 0.05 &&
      Math.abs(totals.closeDebit - totals.closeCredit) < 0.05;

    return { rows: data, totals, isBalanced };
  }, [accountBalances]);

  // 3. Profit & Loss
  const pnlData = useMemo(() => {
    let revenue = 0;
    let expense = 0;
    const revDetails: Record<string, number> = {};
    const expDetails: Record<string, number> = {};

    filteredTransactions.forEach(t => {
      const src = t.sourceAccount || 'unknown';
      const dest = t.destinationAccount || 'unknown';
      const amt = t.amount || 0;

      const srcCat = getAccountCategory(src);
      const destCat = getAccountCategory(dest);
      const srcNorm = getNormalBalance(srcCat);
      const destNorm = getNormalBalance(destCat);

      if (srcCat === 'revenue') {
        const movement = srcNorm === 'debit' ? amt : -amt; 
        revenue += movement;
        revDetails[src] = (revDetails[src] || 0) + movement;
      } else if (srcCat === 'expense') {
        const movement = srcNorm === 'debit' ? amt : -amt;
        expense += movement;
        expDetails[src] = (expDetails[src] || 0) + movement;
      }

      if (destCat === 'revenue') {
        const movement = destNorm === 'credit' ? amt : -amt; 
        revenue += movement;
        revDetails[dest] = (revDetails[dest] || 0) + movement;
      } else if (destCat === 'expense') {
        const movement = destNorm === 'credit' ? amt : -amt;
        expense += movement;
        expDetails[dest] = (expDetails[dest] || 0) + movement;
      }
    });

    const rule = taxRules[displayCurrency];
    let taxLiability = 0;
    let netRevenue = revenue;
    
    const rateDecimal = (rule.rate || 0) / 100;
    
    if (rule.enabled && rateDecimal > 0) {
      if (rule.inclusive) {
        netRevenue = revenue / (1 + rateDecimal);
        taxLiability = revenue - netRevenue;
      } else {
        taxLiability = revenue * rateDecimal;
      }
    }

    const netProfit = netRevenue - expense;

    return { revenue, expense, revDetails, expDetails, netProfit, taxLiability, netRevenue, activeRule: rule };
  }, [filteredTransactions, displayCurrency, taxRules]);

  // 4. General Ledger (Grand Livre with Source Document Drill-Down)
  const generalLedgerData = useMemo(() => {
    const gl: Record<string, { openingBalance: number; closingBalance: number; movements: any[] }> = {};
    
    openingTransactions.forEach(t => {
      const src = t.sourceAccount || 'unknown';
      const dest = t.destinationAccount || 'unknown';
      const amt = Number(t.amount) || 0;
      
      const srcCat = getAccountCategory(src);
      const destCat = getAccountCategory(dest);
      const srcNorm = getNormalBalance(srcCat);
      const destNorm = getNormalBalance(destCat);

      if (!gl[src]) { gl[src] = { openingBalance: 0, closingBalance: 0, movements: [] }; }
      if (!gl[dest]) { gl[dest] = { openingBalance: 0, closingBalance: 0, movements: [] }; }

      gl[src].openingBalance += (srcNorm === 'debit' ? amt : -amt);
      gl[dest].openingBalance += (destNorm === 'credit' ? amt : -amt);
      
      gl[src].closingBalance = gl[src].openingBalance;
      gl[dest].closingBalance = gl[dest].openingBalance;
    });
    
    const sortedPeriodTxns = [...filteredTransactions].sort((a,b) => {
      const tA = a.createdAt ? a.createdAt.seconds : 0;
      const tB = b.createdAt ? b.createdAt.seconds : 0;
      return tA - tB;
    });

    sortedPeriodTxns.forEach(t => {
      const dt = t.createdAt ? format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd HH:mm') : 'N/A';
      const src = t.sourceAccount || 'unknown';
      const dest = t.destinationAccount || 'unknown';
      const amt = Number(t.amount) || 0;
      
      const srcCat = getAccountCategory(src);
      const destCat = getAccountCategory(dest);
      const srcNorm = getNormalBalance(srcCat);
      const destNorm = getNormalBalance(destCat);

      if (!gl[src]) { gl[src] = { openingBalance: 0, closingBalance: 0, movements: [] }; }
      if (!gl[dest]) { gl[dest] = { openingBalance: 0, closingBalance: 0, movements: [] }; }

      // Source is Debited
      gl[src].closingBalance += srcNorm === 'debit' ? amt : -amt;
      gl[src].movements.unshift({ 
        date: dt, 
        desc: `To ${dest.replace(/_/g, ' ')} (${t.transactionType || 'entry'})`,
        notes: t.notes || '',
        refId: t.referenceId || t.id,
        rawTxn: t,
        debit: amt, 
        credit: null, 
        balance: gl[src].closingBalance,
        isReversal: t.isReversal ? 'YES' : 'NO'
      });

      // Destination is Credited
      gl[dest].closingBalance += destNorm === 'credit' ? amt : -amt;
      gl[dest].movements.unshift({ 
        date: dt, 
        desc: `From ${src.replace(/_/g, ' ')} (${t.transactionType || 'entry'})`,
        notes: t.notes || '',
        refId: t.referenceId || t.id,
        rawTxn: t,
        debit: null, 
        credit: amt, 
        balance: gl[dest].closingBalance,
        isReversal: t.isReversal ? 'YES' : 'NO'
      });
    });
    
    return Object.keys(gl).sort().reduce((acc, key) => {
       acc[key] = gl[key];
       return acc;
    }, {} as Record<string, { openingBalance: number; closingBalance: number; movements: any[] }>);
  }, [openingTransactions, filteredTransactions]);

  // 5. Analytical Cost-Center & Module Profitability Report (Comptabilité Analytique)
  const moduleSummaryData = useMemo(() => {
    const coreModules = ['gym', 'reservation', 'pos_cafe', 'pos_retail', 'physio'];
    const stats: Record<string, {
      grossRevenue: number;
      discounts: number;
      netRevenue: number;
      cogsAndWastage: number;
      commissionsAndSplits: number;
    }> = {};

    const ensureMod = (modKey: string) => {
      if (!stats[modKey]) {
        stats[modKey] = {
          grossRevenue: 0,
          discounts: 0,
          netRevenue: 0,
          cogsAndWastage: 0,
          commissionsAndSplits: 0
        };
      }
    };

    coreModules.forEach(m => ensureMod(m));

    filteredTransactions.forEach(t => {
      const rawMod = t.sourceModule || 'system';
      const mod = rawMod === 'pos_cafeteria' ? 'pos_cafe' : (rawMod === 'courts' || rawMod === 'court' ? 'reservation' : rawMod);
      ensureMod(mod);

      const amt = Number(t.amount) || 0;
      const sub = Number(t.subtotal ?? amt) || amt;
      const disc = Number(t.discount) || 0;
      const txType = (t.transactionType || '').toLowerCase();
      const srcAcc = (t.sourceAccount || '').toLowerCase();
      const destAcc = (t.destinationAccount || '').toLowerCase();
      const destCat = getAccountCategory(t.destinationAccount || '');
      const srcCat = getAccountCategory(t.sourceAccount || '');

      // Check COGS & Inventory Wastage first
      if (txType.includes('cogs') || txType.includes('wastage') || srcAcc.startsWith('601') || srcAcc.startsWith('605') || destAcc.includes('cost_of_goods_sold')) {
        if (t.isReversal || txType.includes('reversal')) {
          stats[mod].cogsAndWastage -= amt;
        } else {
          stats[mod].cogsAndWastage += amt;
        }
        return;
      }

      // Check Direct Commissions / Coach Payouts / Payroll
      if (txType.includes('commission') || txType.includes('coach_payout') || txType.includes('payroll') || srcAcc.startsWith('641') || srcAcc.startsWith('622')) {
        stats[mod].commissionsAndSplits += amt;
        return;
      }

      // Standard Revenue Inflows
      if (destCat === 'revenue') {
        stats[mod].grossRevenue += Math.max(amt, sub);
        stats[mod].discounts += disc;
        stats[mod].netRevenue += amt;
      }
      // Refunds / Reversals Debit Revenue
      if (srcCat === 'revenue') {
        stats[mod].netRevenue -= amt;
        stats[mod].grossRevenue = Math.max(0, stats[mod].grossRevenue - amt);
      }
    });

    const formatModuleLabel = (m: string) => {
      if (m === 'gym') return 'GYM & PERSONAL TRAINING';
      if (m === 'reservation') return 'COURT RESERVATIONS';
      if (m === 'pos_cafe') return 'KIOSK POS (CAFETERIA)';
      if (m === 'pos_retail') return 'RETAIL SHOP POS';
      if (m === 'physio') return 'PHYSIOTHERAPY CLINIC';
      return m.replace(/_/g, ' ').toUpperCase();
    };

    const rows = Object.keys(stats)
      .filter(m => coreModules.includes(m) || stats[m].netRevenue !== 0 || stats[m].cogsAndWastage !== 0)
      .map(m => {
        const s = stats[m];
        const contributionMargin = s.netRevenue - s.cogsAndWastage - s.commissionsAndSplits;
        const marginPct = s.netRevenue > 0 ? (contributionMargin / s.netRevenue) * 100 : 0;
        return {
          key: m,
          module: formatModuleLabel(m),
          grossRevenue: s.grossRevenue,
          discounts: s.discounts,
          netRevenue: s.netRevenue,
          revenue: s.netRevenue, // backward compatibility
          cogsAndWastage: s.cogsAndWastage,
          commissionsAndSplits: s.commissionsAndSplits,
          contributionMargin,
          marginPct
        };
      })
      .sort((a, b) => b.contributionMargin - a.contributionMargin);

    const totals = rows.reduce((acc, r) => ({
      grossRevenue: acc.grossRevenue + r.grossRevenue,
      discounts: acc.discounts + r.discounts,
      netRevenue: acc.netRevenue + r.netRevenue,
      cogsAndWastage: acc.cogsAndWastage + r.cogsAndWastage,
      commissionsAndSplits: acc.commissionsAndSplits + r.commissionsAndSplits,
      contributionMargin: acc.contributionMargin + r.contributionMargin
    }), {
      grossRevenue: 0,
      discounts: 0,
      netRevenue: 0,
      cogsAndWastage: 0,
      commissionsAndSplits: 0,
      contributionMargin: 0
    });

    return {
      rows,
      totals,
      totalRevenue: totals.netRevenue
    };
  }, [filteredTransactions]);

  // 5a. Departmental Module Accounts IN / OUT / Net Balance Statement (Comptabilité Analytique par Département)
  const departmentAccountsData = useMemo(() => {
    const map: Record<string, {
      key: string;
      label: string;
      shortLabel: string;
      code: string;
      totalIn: number;
      totalOut: number;
      netBalance: number;
      standardCourtIn: number;
      individualAccessIn: number;
      txCountIn: number;
      txCountOut: number;
      transactions: Array<{
        id: string;
        dateStr: string;
        timestamp: number;
        flow: 'IN' | 'OUT';
        amount: number;
        type: string;
        account: string;
        notes: string;
        rawTxn: any;
      }>;
    }> = {};

    DEPARTMENT_MODULE_ACCOUNTS.forEach(d => {
      map[d.key] = {
        key: d.key,
        label: d.label,
        shortLabel: d.shortLabel,
        code: d.code,
        totalIn: 0,
        totalOut: 0,
        netBalance: 0,
        standardCourtIn: 0,
        individualAccessIn: 0,
        txCountIn: 0,
        txCountOut: 0,
        transactions: []
      };
    });

    periodDepartmentTransactions.forEach(t => {
      const deptKey = t.resolvedDepartmentAccount || resolveDepartmentAccount(t);
      const bucket = map[deptKey] || map['general_facility'];
      const amt = Math.abs(Number(t.amount) || 0);
      if (amt === 0) return;

      const srcAcc = String(t.sourceAccount || '');
      const destAcc = String(t.destinationAccount || '');
      const srcCat = getAccountCategory(srcAcc);
      const destCat = getAccountCategory(destAcc);
      const txType = String(t.transactionType || '').toLowerCase();
      const dtStr = t.createdAt?.seconds ? format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd HH:mm') : (t.date || 'N/A');
      const ts = t.createdAt?.seconds || 0;

      // Determine if transaction is an INFLOW or OUTFLOW for this module account
      const isExpenseOrOutflow =
        t.direction === 'outflow' ||
        srcCat === 'expense' ||
        txType.includes('expense') ||
        txType.includes('cogs') ||
        txType.includes('wastage') ||
        txType.includes('commission') ||
        txType.includes('payout') ||
        txType.includes('payroll') ||
        txType.includes('supplier_bill');

      const isRevenueRefund = srcCat === 'revenue' && (t.isReversal || txType.includes('reversal') || txType.includes('refund'));
      const isExpenseReversal = destCat === 'expense' && (t.isReversal || txType.includes('reversal'));

      if (isExpenseReversal) {
        bucket.totalOut = Math.max(0, bucket.totalOut - amt);
        bucket.transactions.push({
          id: t.id,
          dateStr: dtStr,
          timestamp: ts,
          flow: 'IN',
          amount: amt,
          type: 'Expense Reversal',
          account: destAcc,
          notes: t.notes || '',
          rawTxn: t
        });
      } else if (isRevenueRefund) {
        bucket.totalIn = Math.max(0, bucket.totalIn - amt);
        bucket.transactions.push({
          id: t.id,
          dateStr: dtStr,
          timestamp: ts,
          flow: 'OUT',
          amount: amt,
          type: 'Revenue Reversal / Refund',
          account: srcAcc,
          notes: t.notes || '',
          rawTxn: t
        });
      } else if (isExpenseOrOutflow) {
        bucket.totalOut += amt;
        bucket.txCountOut += 1;
        bucket.transactions.push({
          id: t.id,
          dateStr: dtStr,
          timestamp: ts,
          flow: 'OUT',
          amount: amt,
          type: (t.transactionType || 'Expense / Outflow').replace(/_/g, ' '),
          account: srcAcc || destAcc,
          notes: t.notes || '',
          rawTxn: t
        });
      } else if (destCat === 'revenue' || t.direction === 'inflow') {
        bucket.totalIn += amt;
        bucket.txCountIn += 1;
        if (
          destAcc.startsWith('70621') ||
          t.bookingSubType === 'individual_access' ||
          String(t.notes || '').toLowerCase().includes('individual access')
        ) {
          bucket.individualAccessIn += amt;
        } else if (destAcc.startsWith('7062')) {
          bucket.standardCourtIn += amt;
        }
        bucket.transactions.push({
          id: t.id,
          dateStr: dtStr,
          timestamp: ts,
          flow: 'IN',
          amount: amt,
          type: (t.transactionType || 'Revenue Inflow').replace(/_/g, ' '),
          account: destAcc || srcAcc,
          notes: t.notes || '',
          rawTxn: t
        });
      }
    });

    const rows = DEPARTMENT_MODULE_ACCOUNTS.map(d => {
      const b = map[d.key];
      b.netBalance = b.totalIn - b.totalOut;
      b.transactions.sort((a, c) => c.timestamp - a.timestamp);
      return b;
    });

    const totals = rows.reduce(
      (acc, r) => ({
        totalIn: acc.totalIn + r.totalIn,
        totalOut: acc.totalOut + r.totalOut,
        netBalance: acc.netBalance + r.netBalance,
        txCountIn: acc.txCountIn + r.txCountIn,
        txCountOut: acc.txCountOut + r.txCountOut
      }),
      { totalIn: 0, totalOut: 0, netBalance: 0, txCountIn: 0, txCountOut: 0 }
    );

    return { rows, totals, byKey: map };
  }, [periodDepartmentTransactions, bookingsById, expensesById]);

  // 5b. Balance Sheet (Statement of Financial Position: Assets = Liabilities + Equity + Net Income)
  const balanceSheetData = useMemo(() => {
    const assets: Array<{ account: string; amount: number }> = [];
    const liabilities: Array<{ account: string; amount: number }> = [];
    const equity: Array<{ account: string; amount: number }> = [];
    let cumulativeRevenue = 0;
    let cumulativeExpense = 0;

    Object.keys(accountBalances).forEach(accKey => {
      const item = accountBalances[accKey];
      const displayAcc = accKey.replace(/_/g, ' ').toUpperCase();
      if (item.category === 'asset') {
        assets.push({ account: displayAcc, amount: item.net });
      } else if (item.category === 'liability') {
        liabilities.push({ account: displayAcc, amount: item.net });
      } else if (item.category === 'equity') {
        equity.push({ account: displayAcc, amount: item.net });
      } else if (item.category === 'revenue') {
        cumulativeRevenue += item.net;
      } else if (item.category === 'expense') {
        cumulativeExpense += item.net;
      }
    });

    const retainedPeriodEarnings = cumulativeRevenue - cumulativeExpense;
    const totalAssets = assets.reduce((s, a) => s + a.amount, 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + l.amount, 0);
    const totalExplicitEquity = equity.reduce((s, e) => s + e.amount, 0);
    const totalEquity = totalExplicitEquity + retainedPeriodEarnings;
    const equities = [
      ...equity,
      { account: '120 - CURRENT PERIOD NET PROFIT / RETAINED EARNINGS', amount: retainedPeriodEarnings }
    ];
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.05;

    return {
      assets,
      liabilities,
      equity,
      equities,
      retainedPeriodEarnings,
      totalAssets,
      totalLiabilities,
      totalExplicitEquity,
      totalEquity,
      totalLiabilitiesAndEquity,
      isBalanced
    };
  }, [accountBalances]);

  // 5c. Official Lebanese VAT (TVA 11%) Declaration & Audit Report (4427 Output VAT vs 4426 Input VAT)
  const vatReportData = useMemo(() => {
    const vatRate = ((pnlData.activeRule?.rate || 11) / 100);
    const outputItems: Array<{
      id: string;
      date: string;
      module: string;
      desc: string;
      baseUSD: number;
      vatUSD: number;
      lockedRate: number;
      baseLBP: number;
      vatLBP: number;
    }> = [];
    const inputItems: Array<{
      id: string;
      date: string;
      vendorOrModule: string;
      desc: string;
      baseUSD: number;
      vatUSD: number;
      lockedRate: number;
      baseLBP: number;
      vatLBP: number;
    }> = [];

    filteredTransactions.forEach(t => {
      if (t.isReversal) return;
      const dt = t.createdAt?.seconds ? format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd') : (t.date || '-');
      const lockedRate = Number(t.exchangeRateAtPosting || t.fxRateAtTimeOfTransaction || usdToLbpRate || 89500);
      const amt = Number(t.amount) || 0;
      const src = (t.sourceAccount || '').toLowerCase();
      const dest = (t.destinationAccount || '').toLowerCase();
      const txType = (t.transactionType || '').toLowerCase();

      // Explicit Input VAT (4426 - TVA Déductible)
      if (src.startsWith('4426') || txType === 'vat_input_deductible') {
        const baseUSD = Number((amt / vatRate).toFixed(2));
        inputItems.push({
          id: t.id,
          date: dt,
          vendorOrModule: (t.sourceModule || 'expenses').toUpperCase(),
          desc: t.notes || '11% Deductible Input VAT (4426)',
          baseUSD,
          vatUSD: amt,
          lockedRate,
          baseLBP: Math.round(baseUSD * lockedRate),
          vatLBP: Math.round(amt * lockedRate)
        });
        return;
      }

      // Explicit Output VAT (4427 - TVA Collectée) or Taxable Revenue Inflow
      if (dest.startsWith('4427') || Number(t.vatAmount) > 0) {
        const vatUSD = dest.startsWith('4427') ? amt : Number(t.vatAmount);
        const baseUSD = dest.startsWith('4427') ? Number((amt / vatRate).toFixed(2)) : amt;
        outputItems.push({
          id: t.id,
          date: dt,
          module: (t.sourceModule || 'invoicing').toUpperCase(),
          desc: t.notes || `${t.transactionType || 'Sale'} (4427 - TVA Collectée)`,
          baseUSD,
          vatUSD,
          lockedRate,
          baseLBP: Math.round(baseUSD * lockedRate),
          vatLBP: Math.round(vatUSD * lockedRate)
        });
        return;
      }

      // Standard Revenue Sales (compute 11% VAT component for Lebanese MOF declaration)
      if (getAccountCategory(t.destinationAccount || '') === 'revenue' && amt > 0) {
        const baseUSD = pnlData.activeRule?.inclusive
          ? Number((amt / (1 + vatRate)).toFixed(2))
          : amt;
        const vatUSD = pnlData.activeRule?.inclusive
          ? Number((amt - baseUSD).toFixed(2))
          : Number((amt * vatRate).toFixed(2));
        outputItems.push({
          id: t.id,
          date: dt,
          module: (t.sourceModule || 'sales').toUpperCase(),
          desc: t.notes || `${t.transactionType || 'Operational Sale'}`,
          baseUSD,
          vatUSD,
          lockedRate,
          baseLBP: Math.round(baseUSD * lockedRate),
          vatLBP: Math.round(vatUSD * lockedRate)
        });
      }
    });

    const totalOutputBaseUSD = outputItems.reduce((s, i) => s + i.baseUSD, 0);
    const totalOutputVatUSD = outputItems.reduce((s, i) => s + i.vatUSD, 0);
    const totalOutputBaseLBP = outputItems.reduce((s, i) => s + i.baseLBP, 0);
    const totalOutputVatLBP = outputItems.reduce((s, i) => s + i.vatLBP, 0);

    const totalInputBaseUSD = inputItems.reduce((s, i) => s + i.baseUSD, 0);
    const totalInputVatUSD = inputItems.reduce((s, i) => s + i.vatUSD, 0);
    const totalInputBaseLBP = inputItems.reduce((s, i) => s + i.baseLBP, 0);
    const totalInputVatLBP = inputItems.reduce((s, i) => s + i.vatLBP, 0);

    const netVatUSD = totalOutputVatUSD - totalInputVatUSD;
    const netVatLBP = totalOutputVatLBP - totalInputVatLBP;

    return {
      vatRatePct: Math.round(vatRate * 100),
      outputItems,
      inputItems,
      totalOutputBaseUSD,
      totalOutputVatUSD,
      totalOutputBaseLBP,
      totalOutputVatLBP,
      totalInputBaseUSD,
      totalInputVatUSD,
      totalInputBaseLBP,
      totalInputVatLBP,
      netVatUSD,
      netVatLBP
    };
  }, [filteredTransactions, pnlData.activeRule, usdToLbpRate]);

  // 5d. Combined Immutable Financial & System Audit Trail (system_audit + Ledger Reversals/Voids)
  const combinedAuditLogs = useMemo(() => {
    const entries: Array<{
      id: string;
      timestampStr: string;
      sortEpoch: number;
      staffId: string;
      actionType: string;
      moduleOrCollection: string;
      referenceId: string;
      detailsText: string;
      amountUSD?: number;
    }> = [];

    liveSystemAudits.forEach(a => {
      const tsStr = typeof a.timestamp === 'string'
        ? a.timestamp.replace('T', ' ').substring(0, 19)
        : (a.timestamp?.seconds ? format(new Date(a.timestamp.seconds * 1000), 'yyyy-MM-dd HH:mm:ss') : 'Recent');
      const epoch = typeof a.timestamp === 'string'
        ? (new Date(a.timestamp).getTime() || 0)
        : ((a.timestamp?.seconds || 0) * 1000);
      const detObj = a.details || {};
      const detText = typeof detObj === 'string'
        ? detObj
        : Object.entries(detObj)
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join(' | ');
      entries.push({
        id: `AUD-${a.id}`,
        timestampStr: tsStr,
        sortEpoch: epoch,
        staffId: a.staffId || 'system',
        actionType: (a.action || 'AUDIT_EVENT').toUpperCase(),
        moduleOrCollection: a.collectionName || 'system',
        referenceId: a.documentId || a.id,
        detailsText: detText || 'System audit log entry',
        amountUSD: Number(detObj.amountUSD ?? detObj.amount ?? 0) || undefined
      });
    });

    filteredTransactions.forEach(t => {
      if (t.isReversal || t.accountingStatus === 'voided' || (t.discount && Number(t.discount) > 0 && Number(t.amount) === 0)) {
        const tsStr = t.createdAt?.seconds ? format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd HH:mm:ss') : 'N/A';
        const epoch = (t.createdAt?.seconds || 0) * 1000;
        const actionType = t.accountingStatus === 'voided'
          ? 'VOID'
          : t.isReversal
          ? 'REVERSAL'
          : 'DISCOUNT_100';
        entries.push({
          id: `TXN-${t.id}`,
          timestampStr: tsStr,
          sortEpoch: epoch,
          staffId: t.cashierId || t.voidedBy || 'system',
          actionType,
          moduleOrCollection: t.sourceModule || 'ledger',
          referenceId: t.referenceId || t.id,
          detailsText: `Dr: ${t.sourceAccount || '-'} → Cr: ${t.destinationAccount || '-'}${t.notes ? ` | ${t.notes}` : ''}`,
          amountUSD: Number(t.amount) || 0
        });
      }
    });

    return entries
      .filter(e => auditActionFilter === 'all' || e.actionType.includes(auditActionFilter))
      .sort((a, b) => b.sortEpoch - a.sortEpoch);
  }, [liveSystemAudits, filteredTransactions, auditActionFilter]);


  // 6. Custom Report Engine
  const customReportData = useMemo(() => {
    if (!activeReport.startsWith('custom_run_')) return null;
    const reportId = activeReport.split('custom_run_')[1];
    const report = customReports.find(r => r.id === reportId);
    if (!report) return null;

    const txns = report.baseMode === 'balance' ? [...openingTransactions, ...filteredTransactions] : filteredTransactions;
    
    const values: Record<string, number> = {};
    const rowResults: Array<{ id: string, label: string, value: number, isFormula: boolean }> = [];

    report.rows.forEach(row => {
      let val = 0;
      if (row.type === 'account' || row.type === 'category') {
        txns.forEach(t => {
          const src = t.sourceAccount || '';
          const dest = t.destinationAccount || '';
          const amt = t.amount || 0;

          // Double entry matching
          const srcMatch = row.type === 'account' ? row.matchCriteria.includes(src) : row.matchCriteria.includes(getAccountCategory(src));
          const destMatch = row.type === 'account' ? row.matchCriteria.includes(dest) : row.matchCriteria.includes(getAccountCategory(dest));

          if (srcMatch) {
             const norm = getNormalBalance(getAccountCategory(src));
             val += norm === 'debit' ? amt : -amt;
          }
          
          if (destMatch) {
             const norm = getNormalBalance(getAccountCategory(dest));
             val += norm === 'credit' ? amt : -amt;
          }
        });
      }
      else if (row.type === 'formula') {
         let formulaStr = (row.formula || '').toUpperCase();
         Object.keys(values).forEach(k => {
           // Safe replacement with parentheses to preserve sign correctly
           formulaStr = formulaStr.replace(new RegExp(`\\{${k}\\}`, 'g'), `(${values[k].toString()})`);
         });
         
         if (/[^0-9\+\-\*\/\.\(\)\s]/.test(formulaStr)) {
           val = 0; 
         } else {
           try {
             // eslint-disable-next-line
             const out = new Function(`return ${formulaStr || '0'}`)();
             val = (typeof out === 'number' && isFinite(out)) ? out : 0;
           } catch(e) { val = 0; }
         }
      }
      
      values[row.id] = val;
      rowResults.push({ id: row.id, label: row.label, value: val, isFormula: row.type === 'formula' });
    });

    return { report, rows: rowResults, totals: values };
  }, [activeReport, customReports, openingTransactions, filteredTransactions]);

  const combinedReports = useMemo(() => {
    const list = [
      ...BUILT_IN_REPORTS,
      ...customReports.map(r => ({ id: `custom_run_${r.id}`, label: r.name, icon: FileSpreadsheet, isBuiltIn: false, ref: r, baseMode: r.baseMode, desc: r.description }))
    ];
    
    return list.map((item, idx) => {
       const conf = reportConfig[item.id] || { visible: true, order: idx };
       return { ...item, visible: conf.visible !== false, order: conf.order ?? idx };
    }).sort((a, b) => a.order - b.order);
  }, [customReports, reportConfig]);

  const updateReportConfig = async (id: string, updates: Partial<ReportConfigItem>) => {
    const newConfig = { ...reportConfig };
    if (!newConfig[id]) {
      const idx = combinedReports.findIndex(r => r.id === id);
      newConfig[id] = { id, visible: true, order: idx };
    }
    newConfig[id] = { ...newConfig[id], ...updates };
    setReportConfig(newConfig);
    try {
       await setDoc(doc(db, 'settings', 'report_config'), { config: newConfig }, { merge: true });
    } catch(e) { console.error('Save config failed', e); }
  };

  const moveReport = async (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === combinedReports.length - 1)) return;
    
    const newConfig = { ...reportConfig };
    const items = [...combinedReports];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    
    const temp = items[index];
    items[index] = items[targetIdx];
    items[targetIdx] = temp;
    
    items.forEach((item, idx) => {
       if (!newConfig[item.id]) newConfig[item.id] = { id: item.id, visible: true, order: idx };
       newConfig[item.id].order = idx;
    });
    
    setReportConfig(newConfig);
    try {
       await setDoc(doc(db, 'settings', 'report_config'), { config: newConfig }, { merge: true });
    } catch(e) { console.error('Move config failed', e); }
  };

  // --- Unified Export System ---
  const getExportTitle = () => {
    if (activeReport.startsWith('custom_run_') && customReportData) {
      return `${systemName} - ${customReportData.report.name.toUpperCase()}`;
    }
    if (activeReport === 'custom_builder') return 'Custom Report Engineering Suite';
    if (activeReport === 'custom_manager') return 'Custom Report Registry';
    return `${systemName} ${activeReport.replace(/_/g, ' ').toUpperCase()}`;
  };
  
  const getExportContext = () => {
    const isCustom = datePreset === 'custom';
    const dateStr = isCustom ? `CUSTOM: ${customDateFrom} TO ${customDateTo}` : datePreset.toUpperCase();
    return [
      `Date Filter: ${dateStr}`,
      `Modules: ${selectedModules.includes('all') ? 'ALL' : selectedModules.map(m => m.replace(/_/g, ' ')).join(', ').toUpperCase()}`,
      `Currency: ${displayCurrency}`,
      `Rate: ${displayCurrency === 'LBP' ? usdToLbpRate.toLocaleString() : '1'}`,
      `Tax Rule: ${pnlData.activeRule.enabled ? `${pnlData.activeRule.name} (${pnlData.activeRule.rate}%)` : 'Disabled'}`
    ];
  };

  const getReportPayload = () => {
    // Shared data mapper for all export types
    if (activeReport === 'journal') {
      return {
        head: [['Date', 'Ref ID', 'Module', 'Debit Acct', 'Credit Acct', `Amount (${displayCurrency})`]],
        body: journalData.map(r => [r.date, r.id.slice(-8), r.module, r.sourceAccount, r.destinationAccount, formatReportCurrency(r.amount)])
      };
    }
    if (activeReport === 'trial_balance') {
      const body: any[] = [];
      trialBalanceData.rows.forEach((row, i, arr) => {
        const prev = arr[i - 1];
        if (!prev || prev.category !== row.category) {
          body.push([{ content: `${row.category.toUpperCase()} ACCOUNTS`, colSpan: 8, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }]);
        }
        body.push([
          row.account,
          formatReportCurrency(row.openDebit),
          formatReportCurrency(row.openCredit),
          formatReportCurrency(row.periodDebit),
          formatReportCurrency(row.periodCredit),
          formatReportCurrency(row.closeDebit),
          formatReportCurrency(row.closeCredit),
          formatReportCurrency(row.net)
        ]);
      });
      body.push([
        { content: `AGGREGATE TOTALS (${trialBalanceData.isBalanced ? 'BALANCED / ÉQUILIBRÉ' : 'OUT OF BALANCE'})`, styles: { fontStyle: 'bold' } },
        formatReportCurrency(trialBalanceData.totals.openDebit),
        formatReportCurrency(trialBalanceData.totals.openCredit),
        formatReportCurrency(trialBalanceData.totals.periodDebit),
        formatReportCurrency(trialBalanceData.totals.periodCredit),
        formatReportCurrency(trialBalanceData.totals.closeDebit),
        formatReportCurrency(trialBalanceData.totals.closeCredit),
        formatReportCurrency(trialBalanceData.totals.net)
      ]);
      return {
        head: [[
          'Account Code & Name (LCOA)',
          'Opening Dr (Solde Initial)',
          'Opening Cr (Solde Initial)',
          'Period Dr (Mouvements)',
          'Period Cr (Mouvements)',
          'Closing Dr (Solde Final)',
          'Closing Cr (Solde Final)',
          'Net Position'
        ]],
        body
      };
    }
    if (activeReport === 'module_summary') {
      const body: any[] = moduleSummaryData.rows.map(r => [
        r.module,
        formatReportCurrency(r.grossRevenue),
        formatReportCurrency(r.discounts),
        formatReportCurrency(r.netRevenue),
        formatReportCurrency(r.cogsAndWastage),
        formatReportCurrency(r.commissionsAndSplits),
        `${formatReportCurrency(r.contributionMargin)} (${r.marginPct.toFixed(1)}%)`
      ]);
      body.push([
        { content: 'ECOSYSTEM TOTALS', styles: { fontStyle: 'bold' } },
        formatReportCurrency(moduleSummaryData.totals.grossRevenue),
        formatReportCurrency(moduleSummaryData.totals.discounts),
        formatReportCurrency(moduleSummaryData.totals.netRevenue),
        formatReportCurrency(moduleSummaryData.totals.cogsAndWastage),
        formatReportCurrency(moduleSummaryData.totals.commissionsAndSplits),
        formatReportCurrency(moduleSummaryData.totals.contributionMargin)
      ]);
      return {
        head: [[
          'Profit Center / Module',
          'Gross Revenue',
          'Discounts / Coupons',
          'Net Revenue',
          'Direct COGS & Wastage',
          'Commissions & Partner Splits',
          'Net Contribution Margin'
        ]],
        body
      };
    }
    if (activeReport === 'pnl') {
      const body: any[] = [
        [{ content: 'REVENUE CHANNELS', colSpan: 2, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }],
        ...Object.keys(pnlData.revDetails).map(acc => [acc.replace(/_/g, ' ').toUpperCase(), formatReportCurrency(pnlData.revDetails[acc])]),
        [{ content: 'TOTAL GROSS REVENUE', styles: { fontStyle: 'bold' } }, formatReportCurrency(pnlData.revenue)],
        ['', ''],
        [{ content: 'OPERATING EXPENDITURES', colSpan: 2, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }],
        ...Object.keys(pnlData.expDetails).map(acc => [acc.replace(/_/g, ' ').toUpperCase(), formatReportCurrency(pnlData.expDetails[acc])]),
        [{ content: 'TOTAL OPERATING EXPENSES', styles: { fontStyle: 'bold' } }, formatReportCurrency(pnlData.expense)],
        ['', ''],
      ];
      if (pnlData.activeRule.enabled && pnlData.taxLiability > 0) {
        body.push([{ content: 'TAXATION & COMPLIANCE', colSpan: 2, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }]);
        body.push([pnlData.activeRule.name, formatReportCurrency(pnlData.taxLiability)]);
        body.push(['', '']);
      }
      body.push([{ content: 'NET INCOME (BOTTOM LINE)', styles: { fontStyle: 'bold', fillColor: [230, 245, 255] } }, formatReportCurrency(pnlData.netProfit)]);
      return { head: [['Account Description', 'Balance']], body };
    }
    
    if (activeReport === 'coa_overview') {
      const body: any[] = trialBalanceData.rows.map(row => [
        row.account,
        row.category.toUpperCase(),
        row.category === 'revenue' || row.category === 'equity' || row.category === 'liabilities' ? 'CREDIT' : 'DEBIT',
        formatReportCurrency(row.net)
      ]);
      return { head: [['Account Nomenclature', 'Classification', 'Normal Balance', 'Current Ledger Balance']], body };
    }

    if (activeReport === 'audit_logs') {
      const body: any[] = combinedAuditLogs.map(entry => [
        entry.timestampStr,
        entry.staffId,
        entry.actionType,
        entry.moduleOrCollection,
        entry.referenceId,
        entry.detailsText,
        entry.amountUSD !== undefined ? formatReportCurrency(entry.amountUSD) : '-'
      ]);
      return {
        head: [['Timestamp', 'Staff / User', 'Action Type', 'Module / Collection', 'Ref ID', 'Audit Details', 'Value']],
        body
      };
    }

    if (activeReport === 'balance_sheet') {
      const body: any[] = [
        [{ content: 'ASSETS (LCOA CLASSES 2, 3, 411, 5)', colSpan: 2, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }],
        ...balanceSheetData.assets.map(a => [a.account, formatReportCurrency(a.amount)]),
        [{ content: 'TOTAL ASSETS', styles: { fontStyle: 'bold' } }, formatReportCurrency(balanceSheetData.totalAssets)],
        ['', ''],
        [{ content: 'LIABILITIES (LCOA CLASS 4)', colSpan: 2, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }],
        ...balanceSheetData.liabilities.map(l => [l.account, formatReportCurrency(l.amount)]),
        [{ content: 'TOTAL LIABILITIES', styles: { fontStyle: 'bold' } }, formatReportCurrency(balanceSheetData.totalLiabilities)],
        ['', ''],
        [{ content: 'EQUITY & RETAINED EARNINGS (LCOA CLASS 1)', colSpan: 2, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }],
        ...balanceSheetData.equity.map(e => [e.account, formatReportCurrency(e.amount)]),
        ['CURRENT PERIOD NET PROFIT / RETAINED EARNINGS (120)', formatReportCurrency(balanceSheetData.retainedPeriodEarnings)],
        [{ content: 'TOTAL LIABILITIES & EQUITY', styles: { fontStyle: 'bold' } }, formatReportCurrency(balanceSheetData.totalLiabilitiesAndEquity)],
      ];
      return { head: [['Balance Sheet Account', 'Balance']], body };
    }

    if (['ar_aging', 'ap_aging'].includes(activeReport)) {
      const isAR = activeReport === 'ar_aging';
      const rows = isAR
        ? liveMembers
            .filter(m => m.billingStatus === 'unpaid' && (m.totalDue || 0) > (m.totalPaid || 0))
            .map(m => {
              const due = Math.max(0, (m.totalDue || 0) - (m.totalPaid || 0));
              return [`${m.firstName || ''} ${m.lastName || ''}`.trim() || m.phone, formatReportCurrency(due), '$0.00', '$0.00', '$0.00', '$0.00', formatReportCurrency(due)];
            })
        : liveExpenses
            .filter(e => e.status === 'pending')
            .map(e => {
              const amt = Number(e.amount || 0);
              return [e.vendor || e.category || e.description || 'Supplier', formatReportCurrency(amt), '$0.00', '$0.00', '$0.00', '$0.00', formatReportCurrency(amt)];
            });
      return {
        head: [[isAR ? 'Client / Member' : 'Supplier / Expense', 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days', 'Total']],
        body: rows
      };
    }

    if (['customer_statements', 'supplier_statements'].includes(activeReport)) {
      const isCust = activeReport === 'customer_statements';
      const body = isCust
        ? filteredTransactions.filter(t => t.memberId && t.direction === 'inflow').map(t => [
            t.createdAt?.seconds ? format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd') : '-',
            t.notes || t.transactionType || 'Member Payment',
            '$0.00',
            formatReportCurrency(Number(t.amount || 0)),
            formatReportCurrency(Number(t.amount || 0))
          ])
        : liveExpenses.map(e => [
            e.date || '-',
            e.description || e.category || 'Supplier Expense',
            e.status === 'paid' ? formatReportCurrency(Number(e.amount || 0)) : '$0.00',
            formatReportCurrency(Number(e.amount || 0)),
            e.status === 'paid' ? '$0.00' : formatReportCurrency(Number(e.amount || 0))
          ]);
      return {
        head: [['Date', 'Description', 'Debit', 'Credit', 'Balance']],
        body
      };
    }

    if (activeReport === 'inventory_ledger') {
      return {
        head: [['SKU / Item', 'Stock On Hand', 'Unit Cost', 'Ledger Value']],
        body: liveInventory.map(i => {
          const stock = Number(i.stock ?? i.quantity ?? 0);
          const cost = Number(i.cost ?? i.price ?? 0);
          return [
            `${i.sku || i.id.slice(0, 6).toUpperCase()} - ${i.name}`,
            String(stock),
            formatReportCurrency(cost),
            formatReportCurrency(stock * cost)
          ];
        })
      };
    }

    if (activeReport === 'vat_report') {
      return {
        head: [['Lebanese MOF VAT Declaration Line (LCOA)', 'Taxable Base (USD)', 'VAT Amount (USD)', 'Taxable Base (Locked LBP)', 'VAT Amount (Locked LBP)']],
        body: [
          [
            `4427 - Output VAT on Sales (TVA Collectée @ ${vatReportData.vatRatePct}%)`,
            `$${vatReportData.totalOutputBaseUSD.toFixed(2)}`,
            `$${vatReportData.totalOutputVatUSD.toFixed(2)}`,
            `${Math.round(vatReportData.totalOutputBaseLBP).toLocaleString()} LBP`,
            `${Math.round(vatReportData.totalOutputVatLBP).toLocaleString()} LBP`
          ],
          [
            `4426 - Deductible Input VAT on Purchases (TVA Déductible @ ${vatReportData.vatRatePct}%)`,
            `$${vatReportData.totalInputBaseUSD.toFixed(2)}`,
            `($${vatReportData.totalInputVatUSD.toFixed(2)})`,
            `${Math.round(vatReportData.totalInputBaseLBP).toLocaleString()} LBP`,
            `(${Math.round(vatReportData.totalInputVatLBP).toLocaleString()} LBP)`
          ],
          [
            vatReportData.netVatUSD >= 0 ? '4425 - NET VAT PAYABLE TO MOF (TVA À PAYER)' : '4426 - NET VAT CREDIT CARRY-FORWARD (CRÉDIT DE TVA)',
            '-',
            `$${Math.abs(vatReportData.netVatUSD).toFixed(2)}`,
            '-',
            `${Math.round(Math.abs(vatReportData.netVatLBP)).toLocaleString()} LBP`
          ]
        ]
      };
    }

    if (['revenue_breakdown', 'pos_finance', 'facility_finance'].includes(activeReport)) {
      const body = moduleSummaryData.rows.map(r => [r.module, formatReportCurrency(r.revenue)]);
      return { head: [['Category / Metric', 'Value']], body };
    }

    if (activeReport === 'executive_dashboard') {
      let totalRev = 0, totalExp = 0, opExp = 0, liqAssets = 0;
      Object.keys(accountBalances).forEach(acc => {
        const d = accountBalances[acc];
        const accLower = acc.toLowerCase();
        if (d.category === 'revenue') totalRev += d.net;
        else if (d.category === 'expense') {
          totalExp += d.net;
          if (!accLower.includes('tax') && !accLower.includes('interest') && !accLower.includes('depreciation') && !accLower.includes('amortization')) {
            opExp += d.net;
          }
        } else if (d.category === 'asset' && (accLower.includes('cash') || accLower.includes('bank') || accLower.startsWith('5'))) {
          liqAssets += d.net;
        }
      });
      const netProf = totalRev - totalExp;
      const mBurn = opExp || 1;
      return {
         head: [['Executive Metric', 'Amount / Value']],
         body: [
           ['Total Revenue', formatReportCurrency(totalRev)],
           ['Net Profit', formatReportCurrency(netProf)],
           ['EBITDA', formatReportCurrency(totalRev - opExp)],
           ['Operating Expenses', formatReportCurrency(opExp)],
           ['Liquid Cash & Bank Reserves', formatReportCurrency(liqAssets)],
           ['Cash Runway (Months)', opExp > 0 ? (liqAssets / mBurn).toFixed(1) : 'N/A'],
           ['Net Margin', totalRev > 0 ? ((netProf / totalRev) * 100).toFixed(1) + '%' : '0.0%']
         ]
      };
    }

    if (activeReport === 'growth_metrics') {
      let mrr = 0;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth();
      filteredTransactions.forEach(txn => {
        if (txn.direction === 'inflow' && !txn.isReversal) {
          const d = txn.createdAt?.seconds ? new Date(txn.createdAt.seconds * 1000) : new Date();
          if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
             mrr += Number(txn.amount || 0);
          }
        }
      });
      return {
         head: [['Growth Metric', 'Value']],
         body: [
           ['Monthly Recurring Revenue (MRR)', formatReportCurrency(mrr)],
           ['Annualized Run Rate (ARR)', formatReportCurrency(mrr * 12)],
           ['Active Member Count', String(liveMembers.filter(m => m.status !== 'inactive').length)]
         ]
      };
    }

    if (activeReport === 'cohort_analysis') {
      const sortedMembers = [...liveMembers].sort((a, b) => (b.totalPaid || 0) - (a.totalPaid || 0));
      return {
         head: [['Member', 'Total Lifetime Paid', 'Status']],
         body: sortedMembers.slice(0, 25).map(m => [
           `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.phone,
           formatReportCurrency(Number(m.totalPaid || 0)),
           (m.status || 'active').toUpperCase()
         ])
      };
    }

    if (activeReport === 'fx_tracking') {
      return {
         head: [['Date', 'Type', 'USD Amount', 'FX Rate (LBP)', 'LBP Equivalent']],
         body: filteredTransactions.slice(0, 50).map(t => {
           const rate = t.exchangeRateAtPosting || t.fxRateAtTimeOfTransaction || usdToLbpRate;
           const amt = Number(t.amount || 0);
           return [
             t.createdAt?.seconds ? format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd') : '-',
             t.transactionType || 'entry',
             `$${amt.toFixed(2)}`,
             rate.toLocaleString(),
             `ل.ل ${Math.round(amt * rate).toLocaleString()}`
           ];
         })
      };
    }

    if (activeReport.startsWith('custom_run_') && customReportData) {
      return {
        head: [['Report Line Item', 'Data Key', `Value (${displayCurrency})`]],
        body: customReportData.rows.map(r => [r.label, `{${r.id}}`, formatReportCurrency(r.value)])
      };
    }
    return null;
  };

  const exportPDF = (action: 'download' | 'print' = 'download') => {
    const doc = new jsPDF();
    const title = getExportTitle();
    const ctx = getExportContext();
    
    doc.setFillColor(11, 15, 23);
    doc.rect(0, 0, 210, 32, 'F');
    doc.setFillColor(0, 184, 200);
    doc.rect(0, 32, 210, 1.5, 'F');

    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text(`${systemName || 'Vescio Nexus'} Financial Intelligence`, 14, 14);
    doc.setFontSize(10);
    doc.setTextColor(0, 184, 200);
    doc.text(title, 14, 22);
    
    // Header Meta Block - Right Aligned with Wrapping
    doc.setFontSize(7);
    doc.setTextColor(200, 200, 210);
    
    const rightColX = doc.internal.pageSize.width - 14;
    let currentMetaY = 10;

    doc.text(`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`, rightColX, currentMetaY, { align: 'right' });
    currentMetaY += 4;

    ctx.forEach((line) => {
        const splitLine = doc.splitTextToSize(line, 60);
        doc.text(splitLine, rightColX, currentMetaY, { align: 'right' });
        currentMetaY += (splitLine.length * 3.5);
    });

    const tableStartY = Math.max(38, currentMetaY + 5);

    if (activeReport === 'general_ledger') {
      let finalY = tableStartY;
      Object.keys(generalLedgerData).forEach((acc, idx) => {
        const data = generalLedgerData[acc];
        if (idx > 0 && finalY > 200) { doc.addPage(); finalY = 20; }
        doc.setFontSize(10); doc.setTextColor(11, 15, 23);
        doc.text(`Ledger: ${acc.replace(/_/g, ' ').toUpperCase()}`, 14, finalY);
        doc.setFontSize(8); doc.setTextColor(100, 100, 110);
        doc.text(`Closing: ${formatReportCurrency(data.closingBalance)}`, 14, finalY + 5);
        
        const body = data.movements.map((r: any) => [r.date, r.desc, r.debit ? formatReportCurrency(r.debit) : '-', r.credit ? formatReportCurrency(r.credit) : '-', formatReportCurrency(r.balance)]);
        body.push(['-', 'OPENING BALANCE', '-', '-', formatReportCurrency(data.openingBalance)]);
        body.reverse();
 
        autoTable(doc, {
          head: [['Date', 'Description', 'Dr', 'Cr', 'Balance']],
          body: body,
          startY: finalY + 8,
          theme: 'grid',
          headStyles: { fillColor: [11, 15, 23], textColor: [255, 255, 255] },
          styles: { fontSize: 7 }
        });
        finalY = (doc as any).lastAutoTable.finalY + 15;
      });
    } else {
      const payload = getReportPayload();
      if (payload) {
        autoTable(doc, {
          head: payload.head,
          body: payload.body,
          startY: tableStartY,
          theme: 'grid',
          headStyles: { fillColor: [0, 184, 200], textColor: [11, 15, 23], fontStyle: 'bold' },
          styles: { fontSize: 8 }
        });
      }
    }

    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 130);
      doc.text('Generated by Vescio Nexus ERP', 14, 288);
    }

    if (action === 'print') {
      const blobUrl = URL.createObjectURL(doc.output('blob'));
      window.open(blobUrl, '_blank');
    } else {
      doc.save(`vescio_nexus_${activeReport}_${displayCurrency}_${format(new Date(), 'yyyyMMdd')}.pdf`);
    }
  };

  const exportExcel = (isCSV = false) => {
    let wsData: any[][] = [
        ['VESCIO NEXUS FINANCIAL REPORTING ENGINE'],
        [`REPORT: ${getExportTitle()}`],
        [`GENERATED: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`],
        ...getExportContext().map(c => [c]),
        []
    ];

    if (activeReport === 'general_ledger') {
       Object.keys(generalLedgerData).forEach(acc => {
         const data = generalLedgerData[acc];
         wsData.push([`LEDGER: ${acc.toUpperCase()}`, `Closing: ${convertReportValue(data.closingBalance)}`]);
         wsData.push(['Date', 'Description', 'Dr', 'Cr', 'Balance']);
         wsData.push(['-', 'OPENING BALANCE', 0, 0, convertReportValue(data.openingBalance)]);
         [...data.movements].reverse().forEach((r: any) => wsData.push([r.date, r.desc, convertReportValue(r.debit || 0), convertReportValue(r.credit || 0), convertReportValue(r.balance)]));
         wsData.push([]);
       });
    } else {
       const payload = getReportPayload();
       if (payload) {
         wsData.push(payload.head[0]);
         payload.body.forEach(row => {
           if (Array.isArray(row)) {
             const cleanRow = row.map(cell => (cell && typeof cell === 'object' && 'content' in cell) ? cell.content : cell);
             wsData.push(cleanRow);
           }
         });
       }
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Financial Data');
    
    const fileName = `vescio_nexus_${activeReport}_${displayCurrency}_${format(new Date(), 'yyyyMMdd')}`;
    if (isCSV) {
      const csv = XLSX.utils.sheet_to_csv(ws);
      saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
    } else {
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileName}.xlsx`);
    }
  };

  useEffect(() => {
    const handleGlobalExport = (e: any) => {
      const { type } = e.detail;
      e.preventDefault();
      if (type === 'print') {
        exportPDF('print');
      } else if (type === 'pdf') {
        exportPDF('download');
      } else if (type === 'xls') {
        exportExcel(false);
      } else if (type === 'csv') {
        exportExcel(true);
      }
    };
    window.addEventListener('GLOBAL_EXPORT', handleGlobalExport);
    return () => window.removeEventListener('GLOBAL_EXPORT', handleGlobalExport);
  }, [activeReport, displayCurrency, generalLedgerData, journalData, pnlData, trialBalanceData, moduleSummaryData, customReportData]);

  if (loading) {
    return <div className="h-[600px] flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600"></div></div>;
  }

  return (
    <div className={`max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in ${isDarkMode ? 'dark' : ''}`}>
      {/* Header & Advanced Controls */}
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-1.5">
                <div className="p-2 bg-[#00B8C8] rounded-lg text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]">
                  <BarChart3 size={22} />
                </div>
                <h2 className="text-2xl font-black tracking-tight">Financial Engine</h2>
              </div>
              <p className={`text-sm font-medium ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                Enterprise Ledger • Live Double-Entry Processing • Audit-Ready Controls
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className={`p-3 rounded-2xl border flex flex-wrap items-center justify-between gap-4 transition-colors ${
            isDarkMode ? 'bg-[#0B0F17]/90 border-zinc-800/80' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="flex flex-wrap items-center gap-4">
              {/* Module Filter Group */}
              <div className="flex items-center gap-2 relative group">
                <span className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'} ml-2`}>Scope</span>
                <div className="relative">
                  <button 
                    className={`text-xs font-bold px-3 py-2 rounded-lg border flex items-center gap-3 transition-all min-w-[200px] ${
                      isDarkMode ? 'bg-[#05070A] border-zinc-800 hover:border-cyan-500/40' : 'bg-zinc-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Filter size={14} className="text-[#00B8C8]" />
                    <span className="truncate flex-1 text-left">
                      {selectedModules.includes('all') 
                          ? 'All Modules' 
                          : selectedModules.length === 1 
                            ? selectedModules[0].replace(/_/g, ' ').toUpperCase()
                            : `${selectedModules.length} Modules Selected`}
                    </span>
                    <ArrowDown size={12} className="text-zinc-400 group-hover:rotate-180 transition-transform" />
                  </button>
                  
                  {/* Dropdown Menu */}
                  <div className={`absolute top-full left-0 mt-1.5 w-64 rounded-xl border shadow-2xl z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ${
                      isDarkMode ? 'bg-[#101622] border-zinc-800 shadow-black' : 'bg-white border-slate-200'
                  }`}>
                    <div className="p-2 space-y-0.5 max-h-[300px] overflow-y-auto">
                        <label className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                          isDarkMode ? 'hover:bg-zinc-900' : 'hover:bg-slate-50'
                        }`}>
                          <input 
                            type="checkbox" 
                            checked={selectedModules.includes('all')}
                            onChange={() => selectedModules.includes('all') ? setSelectedModules([]) : setSelectedModules(['all'])}
                            className="rounded border-zinc-400 text-[#00B8C8] focus:ring-cyan-500 w-4 h-4 cursor-pointer"
                          />
                          <span className="text-xs font-bold uppercase tracking-tight">All Syncronized Modules</span>
                        </label>
                        <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-1.5"></div>
                        {availableModules.map(m => (
                          <label key={m} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                            isDarkMode ? 'hover:bg-zinc-900' : 'hover:bg-slate-50'
                          }`}>
                            <input 
                              type="checkbox" 
                              checked={!selectedModules.includes('all') && selectedModules.includes(m)}
                              onChange={() => {
                                let newArr = [...selectedModules].filter(x => x !== 'all');
                                if (newArr.includes(m)) {
                                  newArr = newArr.filter(x => x !== m);
                                } else {
                                  newArr.push(m);
                                }
                                if (newArr.length === 0) newArr = ['all'];
                                setSelectedModules(newArr);
                              }}
                              className="rounded border-zinc-400 text-[#00B8C8] focus:ring-cyan-500 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-medium uppercase">{m.replace(/_/g, ' ')}</span>
                          </label>
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`h-6 w-px ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'} hidden sm:block`} />

              {/* Cost Center Filter */}
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'} ml-2`}>Cost Center</span>
                <select 
                  value={selectedFilterCostCenter} 
                  onChange={e => setSelectedFilterCostCenter(e.target.value)}
                  className={`text-xs font-bold px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all ${
                    isDarkMode ? 'bg-[#05070A] border-zinc-800 hover:border-cyan-500/40' : 'bg-zinc-50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <option value="all">Company Wide</option>
                  <option value="none">No Cost Center (Unassigned)</option>
                  <option value="cc_gym">Gym Floor</option>
                  <option value="cc_cafe">Kiosk POS</option>
                  <option value="cc_hq">Headquarters / Admin</option>
                </select>
              </div>

              <div className={`h-6 w-px ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'} hidden sm:block`} />

              {/* Date Filter Group */}
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'} ml-2`}>Period</span>
                <div className="flex items-center gap-2">
                  <select 
                    value={datePreset} 
                    onChange={e => setDatePreset(e.target.value as DatePreset)}
                    className={`text-xs font-bold px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all ${
                      isDarkMode ? 'bg-[#05070A] border-zinc-800 hover:border-cyan-500/40' : 'bg-zinc-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <option value="today">Today Only</option>
                    <option value="30d">Last 30 Days</option>
                    <option value="mtd">Month to Date</option>
                    <option value="ytd">Year to Date (YTD)</option>
                    <option value="last_year">Prior Financial Year</option>
                    <option value="all">Complete History</option>
                    <option value="custom">Range Selection</option>
                  </select>
                  
                  {datePreset === 'custom' && (
                    <div className="flex items-center gap-2 animate-in slide-in-from-left-2 duration-300">
                      <input 
                        type="date"
                        value={customDateFrom}
                        onChange={e => setCustomDateFrom(e.target.value)}
                        className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all ${
                          isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      />
                      <span className="text-zinc-400 font-bold text-xs">→</span>
                      <input 
                        type="date"
                        value={customDateTo}
                        onChange={e => setCustomDateTo(e.target.value)}
                        className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all ${
                          isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-2 flex-wrap">
               {isAdvancedMode && pendingPostingCount > 0 && (
                 <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                   {pendingPostingCount} Pending in Queue
                 </div>
               )}
               {isAdvancedMode && Number(adjustmentPercentage || 0) !== 0 && (
                 <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#00B8C8] bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-1 rounded-lg">
                   Cash-In Adj: {Number(adjustmentPercentage) > 0 ? `+${adjustmentPercentage}%` : `${adjustmentPercentage}%`}
                 </div>
               )}
               <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-zinc-500 bg-zinc-100 dark:bg-zinc-900/80 px-2 py-1 rounded">
                  <Receipt size={12} />
                  {isAdvancedMode ? 'Mode B (Posted GL)' : 'Mode A (Real-Time)'}: <span className="text-emerald-500">Synced</span>
               </div>
            </div>
          </div>
        </div>

        {/* Module Accounts IN & OUT Statement (Comptabilité Analytique par Département) */}
        <div className={`rounded-3xl border overflow-hidden transition-all ${isDarkMode ? 'bg-[#0B0F17]/95 border-zinc-800/80' : 'bg-white border-slate-200 shadow-sm'}`}>
          <div className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 ${isDarkMode ? 'bg-zinc-950/60 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25">
                <BarChart3 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-[#00B8C8]">
                  Module Accounts IN &amp; OUT Statement (Comptabilité Analytique par Département)
                </h3>
                <p className="text-[11px] font-bold text-zinc-500">
                  Click any module account to filter the ledger below and inspect every IN (+$) and OUT (-$) transaction for that department
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedDepartmentAccount !== 'all' && (
                <button
                  type="button"
                  onClick={() => setSelectedDepartmentAccount('all')}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 text-xs font-black uppercase tracking-wider transition-colors"
                >
                  Clear Filter: {DEPARTMENT_MODULE_ACCOUNTS.find(d => d.key === selectedDepartmentAccount)?.shortLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowDepartmentInOutStrip(!showDepartmentInOutStrip)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors flex items-center gap-1.5 ${
                  isDarkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {showDepartmentInOutStrip ? <EyeOff size={13} /> : <Eye size={13} />}
                {showDepartmentInOutStrip ? 'Compact View' : 'Expand 7 Module Accounts'}
              </button>
            </div>
          </div>

          {showDepartmentInOutStrip && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-400 bg-zinc-900/80 border-b border-zinc-800' : 'text-slate-600 bg-slate-100 border-b border-slate-200'}`}>
                  <tr>
                    <th className="p-3.5">Department / Module Account</th>
                    <th className="p-3.5 text-right text-emerald-500">Total IN (Revenue / Inflows +$)</th>
                    <th className="p-3.5 text-right text-rose-500">Total OUT (Expenses / COGS / Payouts -$)</th>
                    <th className="p-3.5 text-right text-[#00B8C8]">Net Account Balance (IN - OUT =$)</th>
                    <th className="p-3.5 text-center">Activity</th>
                    <th className="p-3.5 text-right">Ledger Filter</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/60 font-mono">
                  {departmentAccountsData.rows.map(dept => {
                    const isSelected = selectedDepartmentAccount === dept.key;
                    return (
                      <tr
                        key={dept.key}
                        onClick={() => setSelectedDepartmentAccount(isSelected ? 'all' : dept.key)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#00B8C8]/15 dark:bg-[#00B8C8]/15'
                            : 'hover:bg-slate-50 dark:hover:bg-zinc-800/40'
                        }`}
                      >
                        <td className="p-3.5 font-sans">
                          <div className="flex items-center gap-2.5">
                            <span className="px-2 py-0.5 rounded text-[9px] font-mono font-black bg-zinc-500/10 text-zinc-400">
                              {dept.code}
                            </span>
                            <div>
                              <div className="font-black text-xs text-zinc-900 dark:text-white flex items-center gap-2">
                                {dept.label}
                                {isSelected && (
                                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-[#00B8C8] text-slate-950">
                                    Active Filter
                                  </span>
                                )}
                              </div>
                              {dept.key === 'court_basketball' && (dept.standardCourtIn > 0 || dept.individualAccessIn > 0) && (
                                <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                                  7062 Standard: {formatReportCurrency(dept.standardCourtIn)} • <span className="text-amber-500 font-bold">70621 Individual Access: {formatReportCurrency(dept.individualAccessIn)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-3.5 text-right font-black text-emerald-500">
                          +{formatReportCurrency(dept.totalIn)}
                        </td>
                        <td className="p-3.5 text-right font-black text-rose-500">
                          -{formatReportCurrency(dept.totalOut)}
                        </td>
                        <td className={`p-3.5 text-right font-black text-sm ${dept.netBalance >= 0 ? 'text-[#00B8C8]' : 'text-rose-500'}`}>
                          ={dept.netBalance >= 0 ? '+' : '-'}{formatReportCurrency(Math.abs(dept.netBalance))}
                        </td>
                        <td className="p-3.5 text-center text-[10px] text-zinc-500 font-sans font-bold">
                          <span className="text-emerald-500">{dept.txCountIn} IN</span> • <span className="text-rose-500">{dept.txCountOut} OUT</span>
                        </td>
                        <td className="p-3.5 text-right font-sans">
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                            isSelected
                              ? 'bg-[#00B8C8] text-slate-950'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                          }`}>
                            {isSelected ? 'Showing IN/OUT' : 'Inspect IN/OUT'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className={`font-black font-mono text-xs border-t-2 ${isDarkMode ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-slate-900 text-white'}`}>
                  <tr>
                    <td className="p-3.5 uppercase tracking-widest font-sans">Total Across All 7 Module Accounts</td>
                    <td className="p-3.5 text-right text-emerald-400">+{formatReportCurrency(departmentAccountsData.totals.totalIn)}</td>
                    <td className="p-3.5 text-right text-rose-400">-{formatReportCurrency(departmentAccountsData.totals.totalOut)}</td>
                    <td className={`p-3.5 text-right text-sm ${departmentAccountsData.totals.netBalance >= 0 ? 'text-[#00B8C8]' : 'text-rose-400'}`}>
                      ={departmentAccountsData.totals.netBalance >= 0 ? '+' : '-'}{formatReportCurrency(Math.abs(departmentAccountsData.totals.netBalance))}
                    </td>
                    <td className="p-3.5 text-center text-[10px] font-sans text-zinc-400">
                      {departmentAccountsData.totals.txCountIn} IN • {departmentAccountsData.totals.txCountOut} OUT
                    </td>
                    <td className="p-3.5 text-right"></td>
                  </tr>
                </tfoot>
              </table>

              {/* Selected Department Account IN & OUT Drill-Down Ledger */}
              {selectedDepartmentAccount !== 'all' && departmentAccountsData.byKey[selectedDepartmentAccount] && (
                <div className={`p-4 border-t ${isDarkMode ? 'bg-zinc-950/80 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-[#00B8C8]">
                        {departmentAccountsData.byKey[selectedDepartmentAccount].label} — Complete IN &amp; OUT Ledger ({departmentAccountsData.byKey[selectedDepartmentAccount].transactions.length} Entries)
                      </h4>
                      <p className="text-[10px] text-zinc-500 font-bold">
                        Showing all revenue inflows (+$) and module-charged expenses, COGS, and payouts (-$) for this module account
                      </p>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-800">
                    <table className="w-full text-xs text-left border-collapse font-mono">
                      <thead className={`text-[9px] font-black uppercase ${isDarkMode ? 'bg-zinc-900 text-zinc-400' : 'bg-white text-slate-600'} sticky top-0`}>
                        <tr>
                          <th className="p-2.5">Date</th>
                          <th className="p-2.5">Flow</th>
                          <th className="p-2.5">Transaction Type</th>
                          <th className="p-2.5">LCOA Account</th>
                          <th className="p-2.5">Description / Notes</th>
                          <th className="p-2.5 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-zinc-800/50">
                        {departmentAccountsData.byKey[selectedDepartmentAccount].transactions.map((tx, idx) => (
                          <tr
                            key={`${tx.id}-${idx}`}
                            onClick={() => tx.rawTxn && setInspectedTransaction(tx.rawTxn)}
                            className="cursor-pointer hover:bg-cyan-500/5 transition-colors"
                          >
                            <td className="p-2.5 text-zinc-400">{tx.dateStr}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                tx.flow === 'IN'
                                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                              }`}>
                                {tx.flow === 'IN' ? 'IN (+$)' : 'OUT (-$)'}
                              </span>
                            </td>
                            <td className="p-2.5 uppercase font-bold text-zinc-600 dark:text-zinc-300">{tx.type}</td>
                            <td className="p-2.5 text-zinc-500">{tx.account}</td>
                            <td className="p-2.5 font-sans text-zinc-700 dark:text-zinc-300 max-w-md truncate">{tx.notes || '-'}</td>
                            <td className={`p-2.5 text-right font-black ${tx.flow === 'IN' ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {tx.flow === 'IN' ? '+' : '-'}{formatReportCurrency(tx.amount)}
                            </td>
                          </tr>
                        ))}
                        {departmentAccountsData.byKey[selectedDepartmentAccount].transactions.length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-6 text-center text-zinc-500 italic font-sans">
                              No IN or OUT transactions recorded for this module account in the selected period.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Sidebar Nav */}
          <div className="lg:col-span-3 space-y-6">
            <div className={`p-4 rounded-3xl border flex flex-col gap-4 ${isDarkMode ? 'bg-[#0B0F17]/90 border-zinc-800/80' : 'bg-white border-slate-200 shadow-sm'}`}>
              
              {['Executive & Growth', 'Accounting Foundations', 'Sub-Ledgers & Liquidity', 'Taxes & Compliance', 'Revenue & Operations'].map((cat) => {
                const categoryReports = combinedReports.filter(r => r.visible && r.isBuiltIn && (r as any).category === cat);
                if (categoryReports.length === 0) return null;
                
                return (
                  <div key={cat} className="flex flex-col gap-1">
                    <div className={`text-[10px] font-black tracking-widest uppercase px-3 mb-1 mt-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                      {cat}
                    </div>
                    {categoryReports.map(report => (
                      <button
                        key={report.id}
                        onClick={() => setActiveReport(report.id as ReportType)}
                        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all text-left group ${
                          activeReport === report.id
                            ? 'bg-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]'
                            : isDarkMode ? 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-black'
                        }`}
                      >
                        <report.icon size={14} className={activeReport === report.id ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'} />
                        <span className="truncate">{report.label}</span>
                      </button>
                    ))}
                  </div>
                );
              })}

            {combinedReports.filter(r => r.visible && !r.isBuiltIn).length > 0 && (
              <div className="flex flex-col gap-1">
                <div className={`text-[10px] font-black tracking-widest uppercase px-3 mb-1 mt-1 text-emerald-500`}>
                  Custom Reports
                </div>
                {combinedReports.filter(r => r.visible && !r.isBuiltIn).map(rep => (
                  <button
                    key={rep.id}
                    onClick={() => setActiveReport(rep.id as ReportType)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all text-left group ${
                      activeReport === rep.id
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                        : isDarkMode ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-black'
                    }`}
                  >
                    <rep.icon size={14} className={activeReport === rep.id ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'} />
                    <span className="truncate">{rep.label}</span>
                  </button>
                ))}
              </div>
            )}

            <div className={`mt-2 pt-4 border-t ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'} flex flex-col gap-1`}>
              <button
                onClick={() => setActiveReport('custom_manager')}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                  activeReport === 'custom_manager'
                    ? 'bg-zinc-800 text-white'
                    : isDarkMode ? 'text-zinc-500 hover:bg-zinc-800' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Settings size={14} /> Manage Forms
              </button>
              
              <button
                onClick={() => {
                   setEditingReport({ name: 'New Custom Report', description: '', baseMode: 'movement', rows: [] });
                   setActiveReport('custom_builder');
                }}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                    activeReport === 'custom_builder'
                      ? 'bg-blue-600 text-white'
                      : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20'
                }`}
              >
                <Plus size={14} /> Custom Builder
              </button>
            </div>
          </div>

          {/* Precision Dashboard Stats */}
          <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'}`}>
             <h4 className="text-xs font-black uppercase tracking-tight text-zinc-500 mb-4">Metric Aggregates</h4>
             <div className="space-y-4">
               <div>
                 <p className="text-[10px] font-bold text-zinc-400 uppercase leading-tight">Gross Operating Revenue<br/>(System Total)</p>
                 <p className="text-xl font-black font-mono text-emerald-500">{formatReportCurrency(pnlData.revenue)}</p>
               </div>
               {pnlData.activeRule.enabled && typeof pnlData.taxLiability === 'number' && pnlData.taxLiability > 0 && (
                 <div>
                   <p className="text-[10px] font-bold text-orange-400 uppercase leading-tight">Tax Liabilities<br/>({pnlData.activeRule.name})</p>
                   <p className="text-xl font-black font-mono text-orange-500">({formatReportCurrency(pnlData.taxLiability)})</p>
                 </div>
               )}
               <div>
                 <p className="text-[10px] font-bold text-zinc-400 uppercase leading-tight">Operating Expenses<br/>(Debits)</p>
                 <p className="text-xl font-black font-mono text-rose-500">{formatReportCurrency(pnlData.expense)}</p>
               </div>
               <div className="pt-2 border-t dark:border-zinc-800 border-slate-100">
                 <p className="text-[10px] font-bold text-zinc-400 uppercase mb-2">Net Income Position</p>
                 <p className={`text-2xl font-black font-mono ${pnlData.netProfit >= 0 ? 'text-blue-500' : 'text-rose-500'}`}>{formatReportCurrency(pnlData.netProfit)}</p>
               </div>
             </div>
          </div>
        </div>

        {/* Report Content Panel */}
        <div className={`lg:col-span-9 rounded-3xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'}`}>
          <div className="flex-1 overflow-auto max-h-[800px]">
            
            {/* Journal View */}
            {activeReport === 'journal' && (
              <table className="w-full text-sm text-left border-collapse">
                <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-900 border-b border-zinc-800' : 'text-slate-500 bg-slate-100 border-b border-slate-200'} sticky top-0 z-10 shadow-sm`}>
                  <tr>
                    <th className="p-4 font-black">Post Date & Ref</th>
                    <th className="p-4 font-black">Module Source</th>
                    <th className="p-4 font-black">Debit Account (Dr)</th>
                    <th className="p-4 font-black">Credit Account (Cr)</th>
                    <th className="p-4 font-black text-right">Transaction Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono">
                  {journalData.map((row, i) => (
                    <tr
                      key={i}
                      onClick={() => row.rawTxn && setInspectedTransaction(row.rawTxn)}
                      className={`cursor-pointer hover:bg-cyan-500/5 dark:hover:bg-cyan-500/10 transition-colors ${row.isReversal === 'YES' ? 'opacity-40 italic' : ''}`}
                      title="Click to inspect source document & double-entry voucher"
                    >
                      <td className="p-4 align-top">
                        <div className="text-[11px] font-black italic text-zinc-400 group-hover:text-cyan-400 transition-colors">{row.date}</div>
                        <div className="text-[9px] mt-1 font-black px-2 py-0.5 rounded bg-zinc-500/10 inline-block">#{row.id.slice(-8)}</div>
                      </td>
                      <td className="p-4 align-top">
                         <div className="text-[10px] font-black text-zinc-500 uppercase tracking-tighter">{row.module}</div>
                         <div className="text-[9px] text-zinc-400 mt-1">{row.type}</div>
                      </td>
                      <td className="p-4 align-top">
                         <div className="text-emerald-600 font-black text-[11px] leading-tight mb-1">DEBIT</div>
                         <div className="text-zinc-900 dark:text-zinc-300 font-bold text-[10px] uppercase truncate max-w-[160px]">{row.sourceAccount}</div>
                      </td>
                      <td className="p-4 align-top">
                         <div className="text-rose-600 font-black text-[11px] leading-tight mb-1">CREDIT</div>
                         <div className="text-zinc-900 dark:text-zinc-300 font-bold text-[10px] uppercase truncate max-w-[160px]">{row.destinationAccount}</div>
                      </td>
                      <td className={`p-4 align-top font-black text-lg text-right ${row.isReversal === 'YES' ? 'text-rose-500' : 'text-zinc-900 dark:text-white'}`}>
                        {row.isReversal === 'YES' ? '-' : ''}{formatReportCurrency(row.amount)}
                      </td>
                    </tr>
                  ))}
                  {journalData.length === 0 && (
                    <tr><td colSpan={5} className="p-12 text-center text-zinc-500 font-bold italic">No ledger entries detected for the selected boundaries.</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {/* 6-Column Lebanese Trial Balance (Balance Générale à 6 Colonnes) */}
            {activeReport === 'trial_balance' && (
              <div className="p-0 overflow-x-auto">
                <div className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 ${isDarkMode ? 'bg-zinc-950/60 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-cyan-500">
                      6-Column Lebanese Trial Balance (Balance Générale à 6 Colonnes)
                    </h3>
                    <p className="text-[11px] font-bold text-zinc-500">
                      LCOA Classes 1–7 • Opening (Solde Initial), Period Movements (Mouvements), and Closing (Solde Final)
                    </p>
                  </div>
                  <div className={`px-3.5 py-1.5 rounded-xl border text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${
                    trialBalanceData.isBalanced
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-500'
                  }`}>
                    <Scale size={14} />
                    {trialBalanceData.isBalanced ? 'BALANCED (ÉQUILIBRÉ) • DR === CR' : 'OUT OF BALANCE'}
                  </div>
                </div>
                <table className="w-full text-xs text-left border-collapse">
                  <thead className={`text-[9px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-400 bg-zinc-950/90 border-b-2 border-zinc-800' : 'text-slate-600 bg-slate-100 border-b-2 border-slate-200'} sticky top-0 z-10 shadow-sm`}>
                    <tr>
                      <th rowSpan={2} className="p-3 font-black border-r dark:border-zinc-800 min-w-[200px]">Account Code & Name (LCOA)</th>
                      <th colSpan={2} className="p-2 font-black text-center border-b border-r dark:border-zinc-800 bg-zinc-500/5">Opening Balance (Solde Initial)</th>
                      <th colSpan={2} className="p-2 font-black text-center border-b border-r dark:border-zinc-800 bg-cyan-500/5 text-cyan-500">Period Movements (Mouvements)</th>
                      <th colSpan={2} className="p-2 font-black text-center border-b border-r dark:border-zinc-800 bg-emerald-500/5 text-emerald-500">Closing Balance (Solde Final)</th>
                      <th rowSpan={2} className="p-3 font-black text-right bg-blue-50/30 dark:bg-blue-900/10">Net Position</th>
                    </tr>
                    <tr>
                      <th className="p-2.5 font-black text-right bg-zinc-500/5">Debit (Dr)</th>
                      <th className="p-2.5 font-black text-right border-r dark:border-zinc-800 bg-zinc-500/5">Credit (Cr)</th>
                      <th className="p-2.5 font-black text-right bg-cyan-500/5 text-emerald-500">Debit (Dr)</th>
                      <th className="p-2.5 font-black text-right border-r dark:border-zinc-800 bg-cyan-500/5 text-rose-500">Credit (Cr)</th>
                      <th className="p-2.5 font-black text-right bg-emerald-500/5 text-emerald-500">Debit (Dr)</th>
                      <th className="p-2.5 font-black text-right border-r dark:border-zinc-800 bg-emerald-500/5 text-rose-500">Credit (Cr)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                    {trialBalanceData.rows.reduce((acc: any[], row, i, arr) => {
                      const prev = arr[i - 1];
                      if (!prev || prev.category !== row.category) {
                        acc.push(
                          <tr key={`cat-${row.category}`} className={`${isDarkMode ? 'bg-zinc-800/40' : 'bg-slate-50'} border-y dark:border-zinc-800`}>
                            <td colSpan={8} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cyan-500">
                              {row.category} Accounts
                            </td>
                          </tr>
                        );
                      }
                      
                      acc.push(
                        <tr
                          key={i}
                          onClick={() => {
                            setSelectedGlAccount(row.rawKey);
                            setActiveReport('general_ledger');
                          }}
                          className="cursor-pointer hover:bg-cyan-500/5 dark:hover:bg-cyan-500/10 transition-colors font-mono group"
                          title="Click to drill down into General Ledger (Grand Livre) for this account"
                        >
                          <td className="p-3 border-r dark:border-zinc-800">
                            <div className="font-black text-zinc-700 dark:text-zinc-200 group-hover:text-cyan-400 transition-colors">{row.account}</div>
                            <div className="text-[9px] uppercase tracking-tighter text-zinc-400 mt-0.5">Normal: {row.normal}</div>
                          </td>
                          <td className="p-3 text-right text-zinc-500 font-bold">{row.openDebit > 0 ? formatReportCurrency(row.openDebit) : '-'}</td>
                          <td className="p-3 text-right text-zinc-500 font-bold border-r dark:border-zinc-800">{row.openCredit > 0 ? formatReportCurrency(row.openCredit) : '-'}</td>
                          <td className="p-3 text-right text-emerald-600 font-bold">{row.periodDebit > 0 ? formatReportCurrency(row.periodDebit) : '-'}</td>
                          <td className="p-3 text-right text-rose-500 font-bold border-r dark:border-zinc-800">{row.periodCredit > 0 ? formatReportCurrency(row.periodCredit) : '-'}</td>
                          <td className="p-3 text-right text-emerald-500 font-black">{row.closeDebit > 0 ? formatReportCurrency(row.closeDebit) : '-'}</td>
                          <td className="p-3 text-right text-rose-500 font-black border-r dark:border-zinc-800">{row.closeCredit > 0 ? formatReportCurrency(row.closeCredit) : '-'}</td>
                          <td className={`p-3 font-black text-right bg-blue-50/20 dark:bg-blue-900/5 ${row.net >= 0 ? 'text-cyan-500' : 'text-rose-500'}`}>
                            {formatReportCurrency(row.net)}
                          </td>
                        </tr>
                      );
                      return acc;
                    }, [])}
                  </tbody>
                  <tfoot className={`font-black font-mono border-t-4 text-xs ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-slate-100 border-slate-300 text-zinc-900'}`}>
                    <tr>
                      <td className="p-4 uppercase tracking-widest text-[10px] border-r dark:border-zinc-800">Total 6-Column Trial Balance</td>
                      <td className="p-4 text-right text-zinc-400">{formatReportCurrency(trialBalanceData.totals.openDebit)}</td>
                      <td className="p-4 text-right text-zinc-400 border-r dark:border-zinc-800">{formatReportCurrency(trialBalanceData.totals.openCredit)}</td>
                      <td className="p-4 text-right text-emerald-500">{formatReportCurrency(trialBalanceData.totals.periodDebit)}</td>
                      <td className="p-4 text-right text-rose-500 border-r dark:border-zinc-800">{formatReportCurrency(trialBalanceData.totals.periodCredit)}</td>
                      <td className="p-4 text-right text-emerald-500 underline decoration-double underline-offset-4">{formatReportCurrency(trialBalanceData.totals.closeDebit)}</td>
                      <td className="p-4 text-right text-rose-500 underline decoration-double underline-offset-4 border-r dark:border-zinc-800">{formatReportCurrency(trialBalanceData.totals.closeCredit)}</td>
                      <td className={`p-4 text-right text-xs bg-blue-500/5 ${trialBalanceData.isBalanced ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {trialBalanceData.isBalanced ? 'BALANCED (ÉQUILIBRÉ)' : 'OUT OF BALANCE'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Profit & Loss Statement */}
            {activeReport === 'pnl' && (
              <div className="max-w-4xl mx-auto space-y-12 p-8 md:p-12 font-sans w-full">
                {/* Header Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pb-8 border-b dark:border-zinc-800">
                  <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[10px] font-black text-emerald-600 uppercase mb-1">Gross Revenue</p>
                    <p className="text-xl font-black font-mono text-emerald-500">{formatReportCurrency(pnlData.revenue)}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20">
                    <p className="text-[10px] font-black text-rose-600 uppercase mb-1">Expenses</p>
                    <p className="text-xl font-black font-mono text-rose-500">{formatReportCurrency(pnlData.expense)}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-orange-500/5 border border-orange-500/20">
                    <p className="text-[10px] font-black text-orange-600 uppercase mb-1">Tax Provision</p>
                    <p className="text-xl font-black font-mono text-orange-500">{formatReportCurrency(pnlData.taxLiability)}</p>
                  </div>
                  <div className={`p-4 rounded-2xl border ${pnlData.netProfit >= 0 ? 'bg-blue-500/5 border-blue-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                    <p className={`text-[10px] font-black uppercase mb-1 ${pnlData.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>Net Bottom Line</p>
                    <p className={`text-xl font-black font-mono ${pnlData.netProfit >= 0 ? 'text-blue-500' : 'text-red-500'}`}>{formatReportCurrency(pnlData.netProfit)}</p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-3 mb-8 border-b dark:border-zinc-800 pb-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                      <DollarSign size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-black tracking-tighter uppercase">Income Details</h3>
                      <p className="text-[10px] font-bold text-zinc-500">Breakdown of system-wide revenue segments</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {Object.keys(pnlData.revDetails).length === 0 && <p className="text-zinc-400 italic text-sm font-bold py-6 px-4">No income recorded in this period.</p>}
                    {Object.keys(pnlData.revDetails).map(acc => (
                      <div key={acc} className="flex justify-between items-center px-4 py-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-all border-b dark:border-zinc-800/50 last:border-0">
                        <span className="font-bold text-zinc-600 dark:text-zinc-400 uppercase text-xs tracking-wide">{acc.replace(/_/g, ' ')}</span>
                        <span className="font-black font-mono text-emerald-600 dark:text-emerald-400 text-lg">{formatReportCurrency(pnlData.revDetails[acc])}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center py-6 px-4 mt-4 bg-emerald-500 text-white rounded-2xl shadow-xl shadow-emerald-500/10">
                      <span className="font-black uppercase tracking-widest text-sm">Gross Operating Income</span>
                      <span className="text-2xl font-black font-mono tracking-tighter">{formatReportCurrency(pnlData.revenue)}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-3 mb-8 border-b dark:border-zinc-800 pb-3">
                    <div className="w-10 h-10 rounded-full bg-rose-500 flex items-center justify-center text-white shadow-lg shadow-rose-500/20">
                      <Filter size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-black tracking-tighter uppercase">Cost Center Analysis</h3>
                      <p className="text-[10px] font-bold text-zinc-500">Overhead and transactional operational costs</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {Object.keys(pnlData.expDetails).length === 0 ? (
                      <p className="text-zinc-400 italic text-sm font-bold py-6 px-4">No operative expenses document in this window.</p>
                    ) : (
                      Object.keys(pnlData.expDetails).map(acc => (
                        <div key={acc} className="flex justify-between items-center px-4 py-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-all border-b dark:border-zinc-800/50 last:border-0">
                          <span className="font-bold text-zinc-600 dark:text-zinc-400 uppercase text-xs tracking-wide">{acc.replace(/_/g, ' ')}</span>
                          <span className="font-mono text-rose-600 dark:text-rose-400 text-lg">({formatReportCurrency(pnlData.expDetails[acc])})</span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between items-center py-6 px-4 mt-4 bg-rose-500 text-white rounded-2xl shadow-xl shadow-rose-500/10">
                      <span className="font-black uppercase tracking-widest text-sm">Aggregate Liabilities Total</span>
                      <span className="text-2xl font-black font-mono tracking-tighter">({formatReportCurrency(pnlData.expense)})</span>
                    </div>
                  </div>
                </div>

                {pnlData.activeRule.enabled && typeof pnlData.taxLiability === 'number' && pnlData.taxLiability > 0 && (
                  <div>
                    <div className="flex items-center gap-3 mb-8 border-b dark:border-zinc-800 pb-3">
                      <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
                        <Receipt size={20} />
                      </div>
                      <div>
                        <h3 className="text-lg font-black tracking-tighter uppercase">Compliance & VAT</h3>
                        <p className="text-[10px] font-bold text-zinc-500">Governmental and regulatory tax withholdings</p>
                      </div>
                    </div>
                    <div className="space-y-4 px-4">
                       <div className="flex justify-between items-center py-4 border-b dark:border-zinc-800/50">
                         <div className="flex flex-col">
                           <span className="font-bold text-zinc-700 dark:text-zinc-300 uppercase text-xs">{pnlData.activeRule.name} (Calculated @ {pnlData.activeRule.rate}%)</span>
                           <span className="text-[9px] uppercase font-black text-orange-500 mt-1">{pnlData.activeRule.inclusive ? 'INCLUSIVE SEGMENT' : 'EXCLUSIVE APPLIED'}</span>
                         </div>
                         <span className="font-mono text-orange-600 dark:text-orange-400 text-2xl font-black">({formatReportCurrency(pnlData.taxLiability)})</span>
                       </div>
                    </div>
                  </div>
                )}

                <div className={`p-10 rounded-[2.5rem] flex flex-col md:flex-row justify-between items-start md:items-center gap-8 border-8 ${pnlData.netProfit >= 0 ? 'bg-blue-600 border-blue-500 shadow-3xl shadow-blue-600/30 text-white' : 'bg-red-600 border-red-500 text-white shadow-3xl shadow-red-600/30'}`}>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 opacity-70 mb-2">
                       <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                       <span className="text-xs font-black uppercase tracking-[0.3em]">Operational Result</span>
                    </div>
                    <span className="text-5xl font-black uppercase tracking-tighter">Net Income Position</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-7xl font-black font-mono tracking-tighter tabular-nums drop-shadow-lg">
                      {formatReportCurrency(pnlData.netProfit)}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-2">Adjusted for Tax Provisions</span>
                  </div>
                </div>
              </div>
            )}

            {/* Statement of Financial Position (Balance Sheet) */}
            {activeReport === 'balance_sheet' && (
              <div className="max-w-5xl mx-auto space-y-10 p-8 md:p-12 font-sans w-full">
                {/* Summary Banner */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b dark:border-zinc-800">
                  <div>
                    <h3 className="text-2xl font-black uppercase tracking-tight">Statement of Financial Position (Balance Sheet)</h3>
                    <p className="text-xs font-bold text-zinc-500 mt-1">
                      Lebanese General Chart of Accounts (LCOA Classes 1–5) • Cumulative Position
                    </p>
                  </div>
                  <div className={`px-4 py-2 rounded-xl border text-xs font-black uppercase tracking-widest flex items-center gap-2 ${
                    balanceSheetData.isBalanced
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-500'
                  }`}>
                    <Scale size={14} />
                    {balanceSheetData.isBalanced
                      ? 'BALANCED (ASSETS = LIABILITIES + EQUITY)'
                      : 'OUT OF BALANCE'}
                  </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Total Assets (Dr)</p>
                    <p className="text-2xl font-black font-mono text-emerald-500">{formatReportCurrency(balanceSheetData.totalAssets)}</p>
                  </div>
                  <div className="p-5 rounded-2xl bg-rose-500/5 border border-rose-500/20">
                    <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest mb-1">Total Liabilities (Cr)</p>
                    <p className="text-2xl font-black font-mono text-rose-500">{formatReportCurrency(balanceSheetData.totalLiabilities)}</p>
                  </div>
                  <div className="p-5 rounded-2xl bg-blue-500/5 border border-blue-500/20">
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">Total Equity & Retained Earnings (Cr)</p>
                    <p className="text-2xl font-black font-mono text-blue-500">{formatReportCurrency(balanceSheetData.totalEquity)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column: Assets */}
                  <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-zinc-950/60 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex justify-between items-center pb-4 mb-4 border-b dark:border-zinc-800">
                      <h4 className="text-sm font-black uppercase tracking-widest text-emerald-500">Assets (Classes 2, 3, 4, 5)</h4>
                      <span className="text-xs font-mono font-bold text-zinc-400">Normal: DEBIT</span>
                    </div>
                    <div className="space-y-2">
                      {balanceSheetData.assets.length === 0 ? (
                        <p className="text-xs italic text-zinc-500 py-4">No asset balances recorded.</p>
                      ) : (
                        balanceSheetData.assets.map((item) => (
                          <div key={item.account} className="flex justify-between items-center py-2.5 px-3 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
                            <span className="text-xs font-bold uppercase text-zinc-700 dark:text-zinc-300">{item.account.replace(/_/g, ' ')}</span>
                            <span className="font-mono font-black text-sm text-emerald-500">{formatReportCurrency(item.amount)}</span>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="mt-6 pt-4 border-t-2 border-emerald-500/30 flex justify-between items-center">
                      <span className="text-xs font-black uppercase tracking-widest">Total Assets</span>
                      <span className="text-xl font-black font-mono text-emerald-500">{formatReportCurrency(balanceSheetData.totalAssets)}</span>
                    </div>
                  </div>

                  {/* Right Column: Liabilities & Equity */}
                  <div className="space-y-6">
                    <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-zinc-950/60 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex justify-between items-center pb-4 mb-4 border-b dark:border-zinc-800">
                        <h4 className="text-sm font-black uppercase tracking-widest text-rose-500">Liabilities (Class 1 & 4)</h4>
                        <span className="text-xs font-mono font-bold text-zinc-400">Normal: CREDIT</span>
                      </div>
                      <div className="space-y-2">
                        {balanceSheetData.liabilities.length === 0 ? (
                          <p className="text-xs italic text-zinc-500 py-4">No liability balances recorded.</p>
                        ) : (
                          balanceSheetData.liabilities.map((item) => (
                            <div key={item.account} className="flex justify-between items-center py-2.5 px-3 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
                              <span className="text-xs font-bold uppercase text-zinc-700 dark:text-zinc-300">{item.account.replace(/_/g, ' ')}</span>
                              <span className="font-mono font-black text-sm text-rose-500">{formatReportCurrency(item.amount)}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="mt-6 pt-4 border-t-2 border-rose-500/30 flex justify-between items-center">
                        <span className="text-xs font-black uppercase tracking-widest">Total Liabilities</span>
                        <span className="text-xl font-black font-mono text-rose-500">{formatReportCurrency(balanceSheetData.totalLiabilities)}</span>
                      </div>
                    </div>

                    <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-zinc-950/60 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex justify-between items-center pb-4 mb-4 border-b dark:border-zinc-800">
                        <h4 className="text-sm font-black uppercase tracking-widest text-blue-500">Equity & Period Result (Class 1)</h4>
                        <span className="text-xs font-mono font-bold text-zinc-400">Normal: CREDIT</span>
                      </div>
                      <div className="space-y-2">
                        {balanceSheetData.equities.map((item) => (
                          <div key={item.account} className="flex justify-between items-center py-2.5 px-3 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
                            <span className="text-xs font-bold uppercase text-zinc-700 dark:text-zinc-300">{item.account.replace(/_/g, ' ')}</span>
                            <span className={`font-mono font-black text-sm ${item.amount >= 0 ? 'text-blue-500' : 'text-rose-500'}`}>
                              {formatReportCurrency(item.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-6 pt-4 border-t-2 border-blue-500/30 flex justify-between items-center">
                        <span className="text-xs font-black uppercase tracking-widest">Total Liabilities + Equity</span>
                        <span className="text-xl font-black font-mono text-blue-500">{formatReportCurrency(balanceSheetData.totalLiabilitiesAndEquity)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* General Ledger (Grand Livre) with Account Drill-Down */}
            {activeReport === 'general_ledger' && (
              <div>
                <div className={`p-4 border-b flex flex-wrap items-center justify-between gap-4 sticky top-0 z-20 ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-slate-100 border-slate-200'}`}>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-widest text-cyan-500">General Ledger Drill-Down (Grand Livre)</h3>
                    <p className="text-[10px] font-bold text-zinc-500">Select an LCOA account or click any row to inspect the source voucher</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Filter Account:</span>
                    <select
                      value={selectedGlAccount}
                      onChange={e => setSelectedGlAccount(e.target.value)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-bold outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`}
                    >
                      <option value="all">All LCOA Accounts ({Object.keys(generalLedgerData).length})</option>
                      {Object.keys(generalLedgerData).map(accKey => (
                        <option key={accKey} value={accKey}>{accKey.replace(/_/g, ' ').toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {Object.keys(generalLedgerData)
                    .filter(acc => selectedGlAccount === 'all' || acc === selectedGlAccount)
                    .map(acc => {
                    const data = generalLedgerData[acc];
                    const movements = data.movements;
                    const totalDebit = movements.reduce((sum: number, m: any) => sum + (m.debit || 0), 0);
                    const totalCredit = movements.reduce((sum: number, m: any) => sum + (m.credit || 0), 0);
                    const closingBal = data.closingBalance;
                    const openingBal = data.openingBalance;
                    
                    return (
                      <div key={acc} className="p-0">
                        <div className={`p-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 border-b ${isDarkMode ? 'bg-zinc-950/50 border-zinc-900' : 'bg-slate-50 border-slate-200'}`}>
                           <div className="flex gap-4 items-center">
                              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg ${isDarkMode ? 'bg-zinc-800 text-cyan-400' : 'bg-white text-cyan-600 shadow-sm'}`}>
                                 {acc.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                 <h3 className="font-black text-xl tracking-tighter uppercase">{acc.replace(/_/g, ' ')}</h3>
                                 <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none mt-1">General Ledger Control Account (Grand Livre)</p>
                              </div>
                           </div>
                           
                           <div className="flex items-center gap-2 overflow-x-auto w-full lg:w-auto">
                              <div className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-right min-w-[120px]">
                                 <p className="text-[8px] font-black text-emerald-600 uppercase mb-0.5">Total Dr</p>
                                 <p className="font-mono font-black text-emerald-500 text-sm">{formatReportCurrency(totalDebit)}</p>
                              </div>
                              <div className="px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-right min-w-[120px]">
                                 <p className="text-[8px] font-black text-rose-600 uppercase mb-0.5">Total Cr</p>
                                 <p className="font-mono font-black text-rose-500 text-sm">{formatReportCurrency(totalCredit)}</p>
                              </div>
                              <div className={`px-4 py-3 rounded-xl border text-right min-w-[150px] shadow-lg ${closingBal >= 0 ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-rose-600 border-rose-500 text-white'}`}>
                                 <p className="text-[8px] font-black uppercase mb-0.5 opacity-70">Closing Balance</p>
                                 <p className="font-mono font-black text-lg leading-none">{formatReportCurrency(closingBal)}</p>
                              </div>
                           </div>
                        </div>
                        
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead className={`text-[9px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-900 border-b border-zinc-800' : 'text-slate-500 bg-slate-100 border-b border-slate-200'}`}>
                              <tr>
                                <th className="p-4 font-black w-36">Post Date & Ref</th>
                                <th className="p-4 font-black">Transaction Journal Narration</th>
                                <th className="p-4 font-black text-right w-32">Debit (Dr)</th>
                                <th className="p-4 font-black text-right w-32">Credit (Cr)</th>
                                <th className="p-4 font-black text-right w-40 bg-zinc-500/5">Running Balance</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono">
                              {movements.map((row: any, i: number) => (
                                <tr
                                  key={i}
                                  onClick={() => row.rawTxn && setInspectedTransaction(row.rawTxn)}
                                  className={`cursor-pointer hover:bg-cyan-500/5 dark:hover:bg-cyan-500/10 transition-colors ${row.isReversal === 'YES' ? 'opacity-40 italic' : ''}`}
                                  title="Click to inspect source document & voucher"
                                >
                                  <td className="p-4 text-zinc-400 font-bold">
                                    <div>{row.date}</div>
                                    {row.refId && <div className="text-[9px] text-cyan-500 mt-0.5">#{String(row.refId).slice(-8)}</div>}
                                  </td>
                                  <td className="p-4">
                                     <div className="font-bold text-zinc-700 dark:text-zinc-300">{row.desc}</div>
                                     {row.notes && <div className="text-[10px] text-zinc-500 mt-0.5">{row.notes}</div>}
                                  </td>
                                  <td className="p-4 text-right text-emerald-600 font-black">{row.debit ? formatReportCurrency(row.debit) : '-'}</td>
                                  <td className="p-4 text-right text-rose-600 font-black">{row.credit ? formatReportCurrency(row.credit) : '-'}</td>
                                  <td className={`p-4 text-right pr-6 font-black text-[12px] bg-blue-50/30 dark:bg-blue-900/5 ${row.balance < 0 ? 'text-rose-500' : 'text-cyan-500'}`}>{formatReportCurrency(row.balance)}</td>
                                </tr>
                              ))}
                              <tr className="bg-slate-50 dark:bg-zinc-900/50">
                                  <td className="p-4 text-zinc-400 font-bold">-</td>
                                  <td className="p-4">
                                     <div className="font-black text-zinc-700 dark:text-zinc-300 uppercase tracking-widest text-[10px]">Opening Balance Brought Forward (Solde Initial)</div>
                                  </td>
                                  <td className="p-4 text-right">-</td>
                                  <td className="p-4 text-right">-</td>
                                  <td className={`p-4 text-right pr-6 font-black text-[12px] ${openingBal < 0 ? 'text-rose-500' : 'text-cyan-500'}`}>{formatReportCurrency(openingBal)}</td>
                              </tr>
                              {movements.length === 0 && openingBal === 0 && (
                                <tr><td colSpan={5} className="p-6 text-center text-zinc-400 italic font-bold">No entries or opening balance.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Analytical Cost-Center & Module Profitability Report (Comptabilité Analytique) */}
            {activeReport === 'module_summary' && (
              <div className="p-0 h-full flex flex-col justify-between overflow-x-auto">
                <div className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 ${isDarkMode ? 'bg-zinc-950/60 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-cyan-500">
                      Analytical Cost-Center & Module Profitability (Comptabilité Analytique)
                    </h3>
                    <p className="text-[11px] font-bold text-zinc-500">
                      Gross Revenue → Discounts/Coupons → Net Revenue → Direct COGS & Wastage → Direct Staff Commissions & 3rd-Party Splits → Net Contribution Margin
                    </p>
                  </div>
                </div>
                <table className="w-full text-xs text-left border-collapse flex-1">
                  <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-400 bg-zinc-900 border-b border-zinc-800' : 'text-slate-600 bg-slate-50 border-b border-slate-200'} sticky top-0`}>
                    <tr>
                      <th className="p-4 font-black text-left">Profit Center / Module</th>
                      <th className="p-4 font-black text-right">Gross Revenue</th>
                      <th className="p-4 font-black text-right text-amber-500">- Discounts / Coupons</th>
                      <th className="p-4 font-black text-right text-emerald-500">= Net Revenue</th>
                      <th className="p-4 font-black text-right text-rose-500">- Direct COGS & Wastage</th>
                      <th className="p-4 font-black text-right text-orange-500">- Commissions & 3P Splits</th>
                      <th className="p-4 font-black text-right bg-cyan-500/5 text-cyan-500">= Net Contribution Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono">
                    {moduleSummaryData.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-all group">
                        <td className="p-4 font-sans">
                           <div className="flex items-center gap-3">
                             <div className={`p-2.5 rounded-xl transition-all ${isDarkMode ? 'bg-cyan-500/10 text-cyan-400' : 'bg-cyan-50 text-cyan-600'}`}>
                               <BarChart3 size={18} />
                             </div>
                             <div>
                               <span className="font-black text-sm tracking-tight block text-zinc-900 dark:text-white">{row.module}</span>
                               <span className="text-[9px] uppercase font-bold text-zinc-400 tracking-widest block">Analytical Cost Center</span>
                             </div>
                           </div>
                        </td>
                        <td className="p-4 font-bold text-right text-zinc-700 dark:text-zinc-300">
                          {formatReportCurrency(row.grossRevenue)}
                        </td>
                        <td className="p-4 font-bold text-right text-amber-500">
                          {row.discounts > 0 ? `(${formatReportCurrency(row.discounts)})` : '-'}
                        </td>
                        <td className="p-4 font-black text-right text-emerald-500">
                          {formatReportCurrency(row.netRevenue)}
                        </td>
                        <td className="p-4 font-bold text-right text-rose-500">
                          {row.cogsAndWastage > 0 ? `(${formatReportCurrency(row.cogsAndWastage)})` : '-'}
                        </td>
                        <td className="p-4 font-bold text-right text-orange-500">
                          {row.commissionsAndSplits > 0 ? `(${formatReportCurrency(row.commissionsAndSplits)})` : '-'}
                        </td>
                        <td className={`p-4 font-black text-right bg-cyan-500/5 ${row.contributionMargin >= 0 ? 'text-cyan-500' : 'text-rose-500'}`}>
                          <div className="text-base">{formatReportCurrency(row.contributionMargin)}</div>
                          <div className="text-[10px] opacity-80">{row.marginPct.toFixed(1)}% Margin</div>
                        </td>
                      </tr>
                    ))}
                    {moduleSummaryData.rows.length === 0 && (
                      <tr><td colSpan={7} className="p-12 text-center text-zinc-500 font-bold italic">No module data found to aggregate.</td></tr>
                    )}
                  </tbody>
                  <tfoot className={`font-black font-mono border-t-4 text-xs ${isDarkMode ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-slate-900 text-white'}`}>
                    <tr>
                      <td className="p-5 uppercase tracking-widest">Total Ecosystem Profitability</td>
                      <td className="p-5 text-right">{formatReportCurrency(moduleSummaryData.totals.grossRevenue)}</td>
                      <td className="p-5 text-right text-amber-400">({formatReportCurrency(moduleSummaryData.totals.discounts)})</td>
                      <td className="p-5 text-right text-emerald-400">{formatReportCurrency(moduleSummaryData.totals.netRevenue)}</td>
                      <td className="p-5 text-right text-rose-400">({formatReportCurrency(moduleSummaryData.totals.cogsAndWastage)})</td>
                      <td className="p-5 text-right text-orange-400">({formatReportCurrency(moduleSummaryData.totals.commissionsAndSplits)})</td>
                      <td className="p-5 text-right text-cyan-400 text-base">
                        {formatReportCurrency(moduleSummaryData.totals.contributionMargin)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Chart of Accounts Overview */}
            {activeReport === 'coa_overview' && (
              <div className="p-0 overflow-x-auto h-full flex flex-col">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-900 border-b border-zinc-800' : 'text-slate-500 bg-slate-50 border-b border-slate-200'} sticky top-0`}>
                    <tr>
                      <th className="p-6 font-black w-1/3">Account Nomenclature</th>
                      <th className="p-6 font-black">Classification</th>
                      <th className="p-6 font-black">Normal Balance</th>
                      <th className="p-6 font-black text-right">Current Ledger Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                    {Object.keys(accountBalances).map((acc) => {
                      const data = accountBalances[acc];
                      return (
                        <tr key={acc} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-colors">
                          <td className="p-6">
                            <span className="font-bold text-zinc-900 dark:text-white block">{acc.replace(/_/g, ' ')}</span>
                          </td>
                          <td className="p-6">
                            <span className={`px-2 py-1 text-[10px] uppercase font-black tracking-widest rounded-md ${
                              data.category === 'revenue' || data.category === 'asset' ? 'bg-emerald-500/10 text-emerald-500' :
                              data.category === 'expense' || data.category === 'liability' ? 'bg-rose-500/10 text-rose-500' :
                              'bg-blue-500/10 text-blue-500'
                            }`}>
                              {data.category}
                            </span>
                          </td>
                          <td className="p-6 text-zinc-500 uppercase text-xs font-bold tracking-wider">
                            {data.normal}
                          </td>
                          <td className="p-6 text-right font-mono font-black text-base text-zinc-700 dark:text-zinc-300">
                            {formatReportCurrency(data.net)}
                          </td>
                        </tr>
                      );
                    })}
                    {Object.keys(accountBalances).length === 0 && (
                      <tr><td colSpan={4} className="p-12 text-center text-zinc-500 italic">No accounts populated in current ledger scope.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Immutable Financial & System Audit Trail Viewer */}
            {activeReport === 'audit_logs' && (
              <div className="p-0 overflow-x-auto h-full flex flex-col">
                <div className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 ${isDarkMode ? 'bg-zinc-950/80 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-cyan-500">
                      Immutable Financial & System Audit Trail
                    </h3>
                    <p className="text-[11px] font-bold text-zinc-500">
                      Live stream from system_audit, ledger reversals, voided entries, 100% discounts, stock adjustments & period locks
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Action Filter:</span>
                    <select
                      value={auditActionFilter}
                      onChange={e => setAuditActionFilter(e.target.value)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-bold outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`}
                    >
                      <option value="all">All Audit Events ({combinedAuditLogs.length})</option>
                      <option value="REVERSAL">REVERSAL</option>
                      <option value="VOID">VOID / REJECT</option>
                      <option value="UNPOST">UNPOST_ENTRY</option>
                      <option value="DISCOUNT">DISCOUNT_100</option>
                      <option value="STOCK">STOCK_ADJUST</option>
                      <option value="PERIOD">PERIOD_CLOSE / REOPEN</option>
                      <option value="MANUAL_JOURNAL">MANUAL_JOURNAL</option>
                    </select>
                  </div>
                </div>
                <table className="w-full text-sm text-left border-collapse">
                  <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-950/80 border-b border-zinc-800' : 'text-slate-500 bg-slate-100 border-b border-slate-200'} sticky top-0`}>
                     <tr>
                       <th className="p-4 w-36">Timestamp</th>
                       <th className="p-4 w-28">User / Staff</th>
                       <th className="p-4 w-36">Action Type</th>
                       <th className="p-4 w-28">Module</th>
                       <th className="p-4 w-28">Reference ID</th>
                       <th className="p-4">Audit Event Details</th>
                       <th className="p-4 text-right w-28">Value</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono text-[11px]">
                    {combinedAuditLogs.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/40">
                         <td className="p-4 text-zinc-500">{entry.timestampStr}</td>
                         <td className="p-4 text-zinc-400 font-bold">{entry.staffId}</td>
                         <td className="p-4">
                           <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${
                             entry.actionType.includes('VOID') || entry.actionType.includes('REVERSAL') || entry.actionType.includes('REJECT')
                               ? 'text-rose-500 border border-rose-500/20 bg-rose-500/10'
                               : entry.actionType.includes('PERIOD')
                               ? 'text-amber-500 border border-amber-500/20 bg-amber-500/10'
                               : 'text-cyan-500 border border-cyan-500/20 bg-cyan-500/10'
                           }`}>
                             {entry.actionType}
                           </span>
                         </td>
                         <td className="p-4 text-zinc-500 uppercase font-bold">{entry.moduleOrCollection}</td>
                         <td className="p-4 text-zinc-400 font-bold">#{String(entry.referenceId).slice(-10)}</td>
                         <td className="p-4 text-zinc-600 dark:text-zinc-300">{entry.detailsText}</td>
                         <td className="p-4 text-right font-black text-xs text-zinc-700 dark:text-zinc-300">
                           {entry.amountUSD !== undefined ? formatReportCurrency(entry.amountUSD) : '-'}
                         </td>
                      </tr>
                    ))}
                    {combinedAuditLogs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-12 text-center text-zinc-500 italic font-bold">
                          No audit events matching the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Official Lebanese VAT (TVA 11%) Declaration & Audit Report */}
            {activeReport === 'vat_report' && (
              <div className="p-6 md:p-10 space-y-8 font-sans">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b dark:border-zinc-800">
                  <div>
                    <h3 className="text-2xl font-black uppercase tracking-tight">
                      Official Lebanese VAT (TVA {vatReportData.vatRatePct}%) Declaration & Audit Report
                    </h3>
                    <p className="text-xs font-bold text-zinc-500 mt-1">
                      Ministry of Finance (MOF) Compliance • LCOA 4427 (TVA Collectée) vs LCOA 4426 (TVA Déductible) in USD & Historical Locked LBP
                    </p>
                  </div>
                  <div className={`px-4 py-2 rounded-xl border text-xs font-black uppercase tracking-widest ${
                    vatReportData.netVatUSD >= 0
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                  }`}>
                    {vatReportData.netVatUSD >= 0 ? '4425 - TVA À PAYER (NET PAYABLE)' : '4426 - CRÉDIT DE TVA (CARRY-FORWARD)'}
                  </div>
                </div>

                {/* Top Dual-Currency MOF Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-5 rounded-2xl bg-rose-500/5 border border-rose-500/20">
                    <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">
                      Output VAT Collected (4427 - TVA Collectée)
                    </p>
                    <p className="text-2xl font-black font-mono text-rose-500">
                      ${vatReportData.totalOutputVatUSD.toFixed(2)}
                    </p>
                    <p className="text-xs font-mono font-bold text-zinc-400 mt-1">
                      {Math.round(vatReportData.totalOutputVatLBP).toLocaleString()} LBP (Locked Historical)
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-2">
                      Taxable Sales Base: ${vatReportData.totalOutputBaseUSD.toFixed(2)} ({Math.round(vatReportData.totalOutputBaseLBP).toLocaleString()} LBP)
                    </p>
                  </div>

                  <div className="p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">
                      Deductible Input VAT (4426 - TVA Déductible)
                    </p>
                    <p className="text-2xl font-black font-mono text-emerald-500">
                      ${vatReportData.totalInputVatUSD.toFixed(2)}
                    </p>
                    <p className="text-xs font-mono font-bold text-zinc-400 mt-1">
                      {Math.round(vatReportData.totalInputVatLBP).toLocaleString()} LBP (Locked Historical)
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-2">
                      Deductible Purchases Base: ${vatReportData.totalInputBaseUSD.toFixed(2)} ({Math.round(vatReportData.totalInputBaseLBP).toLocaleString()} LBP)
                    </p>
                  </div>

                  <div className={`p-5 rounded-2xl border ${
                    vatReportData.netVatUSD >= 0
                      ? 'bg-cyan-500/10 border-cyan-500/30'
                      : 'bg-emerald-500/10 border-emerald-500/30'
                  }`}>
                    <p className="text-[10px] font-black text-cyan-500 uppercase tracking-widest mb-1">
                      {vatReportData.netVatUSD >= 0 ? 'Net VAT Payable (4425 - TVA à Payer)' : 'Net VAT Credit (Crédit de TVA)'}
                    </p>
                    <p className="text-2xl font-black font-mono text-cyan-400">
                      ${Math.abs(vatReportData.netVatUSD).toFixed(2)}
                    </p>
                    <p className="text-xs font-mono font-bold text-zinc-300 mt-1">
                      {Math.round(Math.abs(vatReportData.netVatLBP)).toLocaleString()} LBP (MOF Declaration Value)
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-2">
                      Computed at Immutable Transaction-Date Exchange Rates
                    </p>
                  </div>
                </div>

                {/* Output VAT Schedule (4427) */}
                <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-zinc-950/60 border-zinc-800' : 'bg-white border-slate-200'}`}>
                  <div className="px-5 py-3.5 border-b dark:border-zinc-800 flex justify-between items-center">
                    <h4 className="text-xs font-black uppercase tracking-widest text-rose-500">
                      Schedule A: Taxable Sales & Output VAT (4427 - TVA Collectée)
                    </h4>
                    <span className="text-[10px] font-mono font-bold text-zinc-400">
                      {vatReportData.outputItems.length} Taxable Entries
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-64">
                    <table className="w-full text-xs text-left border-collapse font-mono">
                      <thead className={`text-[9px] font-black uppercase ${isDarkMode ? 'bg-zinc-900 text-zinc-400' : 'bg-slate-100 text-slate-600'}`}>
                        <tr>
                          <th className="p-3">Date</th>
                          <th className="p-3">Module</th>
                          <th className="p-3">Description</th>
                          <th className="p-3 text-right">Taxable Base (USD)</th>
                          <th className="p-3 text-right">Output VAT (USD)</th>
                          <th className="p-3 text-right">Locked FX</th>
                          <th className="p-3 text-right">Output VAT (LBP)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                        {vatReportData.outputItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                            <td className="p-3 text-zinc-400">{item.date}</td>
                            <td className="p-3 uppercase font-bold text-zinc-500">{item.module}</td>
                            <td className="p-3 text-zinc-700 dark:text-zinc-300">{item.desc}</td>
                            <td className="p-3 text-right">${item.baseUSD.toFixed(2)}</td>
                            <td className="p-3 text-right font-black text-rose-500">${item.vatUSD.toFixed(2)}</td>
                            <td className="p-3 text-right text-zinc-400">{Math.round(item.lockedRate).toLocaleString()}</td>
                            <td className="p-3 text-right font-bold text-rose-400">{Math.round(item.vatLBP).toLocaleString()} LBP</td>
                          </tr>
                        ))}
                        {vatReportData.outputItems.length === 0 && (
                          <tr><td colSpan={7} className="p-6 text-center text-zinc-500 italic">No Output VAT entries in selected period.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Input VAT Schedule (4426) */}
                <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-zinc-950/60 border-zinc-800' : 'bg-white border-slate-200'}`}>
                  <div className="px-5 py-3.5 border-b dark:border-zinc-800 flex justify-between items-center">
                    <h4 className="text-xs font-black uppercase tracking-widest text-emerald-500">
                      Schedule B: Deductible Purchases & Input VAT (4426 - TVA Déductible)
                    </h4>
                    <span className="text-[10px] font-mono font-bold text-zinc-400">
                      {vatReportData.inputItems.length} Deductible Entries
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-64">
                    <table className="w-full text-xs text-left border-collapse font-mono">
                      <thead className={`text-[9px] font-black uppercase ${isDarkMode ? 'bg-zinc-900 text-zinc-400' : 'bg-slate-100 text-slate-600'}`}>
                        <tr>
                          <th className="p-3">Date</th>
                          <th className="p-3">Source / Vendor</th>
                          <th className="p-3">Description</th>
                          <th className="p-3 text-right">Purchase Base (USD)</th>
                          <th className="p-3 text-right">Input VAT (USD)</th>
                          <th className="p-3 text-right">Locked FX</th>
                          <th className="p-3 text-right">Input VAT (LBP)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                        {vatReportData.inputItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                            <td className="p-3 text-zinc-400">{item.date}</td>
                            <td className="p-3 uppercase font-bold text-zinc-500">{item.vendorOrModule}</td>
                            <td className="p-3 text-zinc-700 dark:text-zinc-300">{item.desc}</td>
                            <td className="p-3 text-right">${item.baseUSD.toFixed(2)}</td>
                            <td className="p-3 text-right font-black text-emerald-500">${item.vatUSD.toFixed(2)}</td>
                            <td className="p-3 text-right text-zinc-400">{Math.round(item.lockedRate).toLocaleString()}</td>
                            <td className="p-3 text-right font-bold text-emerald-400">{Math.round(item.vatLBP).toLocaleString()} LBP</td>
                          </tr>
                        ))}
                        {vatReportData.inputItems.length === 0 && (
                          <tr><td colSpan={7} className="p-6 text-center text-zinc-500 italic">No Deductible Input VAT entries in selected period.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Executive Dashboard */}
            {activeReport === 'executive_dashboard' && (
              <ExecutiveDashboard 
                 isDarkMode={isDarkMode} 
                 accountBalances={accountBalances} 
                 formatCurrency={formatReportCurrency} 
              />
            )}

            {/* Budget Variance */}
            {activeReport === 'variance_analysis' && (
              <BudgetVariance 
                 isDarkMode={isDarkMode} 
                 formatCurrency={formatReportCurrency} 
                 transactions={filteredTransactions} 
              />
            )}

            {/* Growth Metrics */}
            {activeReport === 'growth_metrics' && (
              <GrowthMetrics 
                 isDarkMode={isDarkMode} 
                 transactions={filteredTransactions} 
                 formatCurrency={formatReportCurrency} 
              />
            )}

            {/* Cohort Analysis */}
            {activeReport === 'cohort_analysis' && (
              <CohortAnalysis 
                 isDarkMode={isDarkMode} 
                 formatCurrency={formatReportCurrency} 
              />
            )}

            {/* FX Tracking */}
            {activeReport === 'fx_tracking' && (
              <FXTracking 
                 isDarkMode={isDarkMode} 
                 formatCurrency={formatReportCurrency} 
                 transactions={filteredTransactions}
              />
            )}

            {activeReport === 'ar_aging' && <AgingReport isDarkMode={isDarkMode} type="AR" formatCurrency={formatReportCurrency} transactions={filteredTransactions} />}
            {activeReport === 'ap_aging' && <AgingReport isDarkMode={isDarkMode} type="AP" formatCurrency={formatReportCurrency} transactions={filteredTransactions} />}
            {activeReport === 'bank_reconciliation' && <BankReconciliation isDarkMode={isDarkMode} formatCurrency={formatReportCurrency} transactions={filteredTransactions} />}
            {activeReport === 'recurring_accruals' && <RecurringAccruals isDarkMode={isDarkMode} formatCurrency={formatReportCurrency} />}
            {activeReport === 'customer_statements' && <Statements isDarkMode={isDarkMode} type="Customer" formatCurrency={formatReportCurrency} transactions={filteredTransactions} />}
            {activeReport === 'supplier_statements' && <Statements isDarkMode={isDarkMode} type="Supplier" formatCurrency={formatReportCurrency} transactions={filteredTransactions} />}
            {activeReport === 'inventory_ledger' && <InventoryLedger isDarkMode={isDarkMode} formatCurrency={formatReportCurrency} />}
            {['revenue_breakdown', 'pos_finance', 'facility_finance'].includes(activeReport) && (
              <OperationalFinance isDarkMode={isDarkMode} formatCurrency={formatReportCurrency} specificType={activeReport} transactions={filteredTransactions} />
            )}

            {/* Source Document & Double-Entry Voucher Inspector Modal */}
            {inspectedTransaction && (
              <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setInspectedTransaction(null)}>
                <div
                  onClick={e => e.stopPropagation()}
                  className={`w-full max-w-xl rounded-2xl border p-6 shadow-2xl ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
                >
                  <div className="flex items-center justify-between pb-4 border-b dark:border-zinc-800">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-cyan-500 block">Double-Entry Voucher & Source Document</span>
                      <h4 className="text-lg font-black font-mono mt-0.5">Voucher #{String(inspectedTransaction.id).slice(0, 12)}</h4>
                    </div>
                    <button
                      onClick={() => setInspectedTransaction(null)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-500/10 hover:bg-zinc-500/20"
                    >
                      Close
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4 py-4 text-xs border-b dark:border-zinc-800">
                    <div>
                      <span className="text-[10px] font-bold uppercase text-zinc-500 block">Timestamp</span>
                      <span className="font-mono font-bold">
                        {inspectedTransaction.createdAt?.seconds
                          ? format(new Date(inspectedTransaction.createdAt.seconds * 1000), 'yyyy-MM-dd HH:mm:ss')
                          : inspectedTransaction.date || 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase text-zinc-500 block">Source Module & Ref ID</span>
                      <span className="font-mono font-bold uppercase">
                        {inspectedTransaction.sourceModule || 'system'} • #{inspectedTransaction.referenceId || inspectedTransaction.id}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-[9px] font-black uppercase text-emerald-500 block">Debit Account (Dr)</span>
                      <span className="font-mono font-black text-xs">{inspectedTransaction.sourceAccount || '-'}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                      <span className="text-[9px] font-black uppercase text-rose-500 block">Credit Account (Cr)</span>
                      <span className="font-mono font-black text-xs">{inspectedTransaction.destinationAccount || '-'}</span>
                    </div>
                  </div>
                  <div className="py-4 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-500 font-bold uppercase">Amount (USD):</span>
                      <span className="font-mono font-black text-base text-cyan-400">${Number(inspectedTransaction.amount || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500 font-bold uppercase">Locked Historical FX Rate:</span>
                      <span className="font-mono font-bold">
                        {Number(inspectedTransaction.exchangeRateAtPosting || inspectedTransaction.fxRateAtTimeOfTransaction || usdToLbpRate || 89500).toLocaleString()} LBP/USD
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500 font-bold uppercase">Payment Method / Status:</span>
                      <span className="font-mono font-bold uppercase">
                        {inspectedTransaction.paymentMethod || 'N/A'} • {inspectedTransaction.accountingStatus || 'posted'}
                      </span>
                    </div>
                    {inspectedTransaction.notes && (
                      <div className="pt-2">
                        <span className="text-zinc-500 font-bold uppercase block mb-1">Narration / Notes:</span>
                        <div className={`p-3 rounded-xl font-mono text-xs ${isDarkMode ? 'bg-zinc-950 border border-zinc-800' : 'bg-slate-50 border border-slate-200'}`}>
                          {inspectedTransaction.notes}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Custom Report Run View */}
            {activeReport.startsWith('custom_run_') && customReportData && (
              <div className="p-0 overflow-x-auto h-full flex flex-col">
                <div className="p-8 border-b dark:border-zinc-800 flex justify-between items-start">
                   <div>
                    <h3 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">{customReportData.report.name}</h3>
                    <p className="text-sm font-medium text-zinc-500 mt-2">{customReportData.report.description}</p>
                    {customReportData.report.baseMode === 'balance' && (
                      <span className="mt-4 inline-block px-2 py-1 text-[10px] font-black uppercase tracking-widest bg-yellow-500/20 text-yellow-600 rounded">Balance Sheet Mode (Cumulative)</span>
                    )}
                   </div>
                   <button 
                     onClick={() => {
                        setEditingReport(customReportData.report);
                        setActiveReport('custom_builder');
                     }}
                     className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                   >
                     <Edit2 size={14} /> Edit Config
                   </button>
                </div>
                <table className="w-full text-sm text-left border-collapse">
                  <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-950/80 border-b-2 border-zinc-800' : 'text-slate-500 bg-slate-100 border-b-2 border-slate-200'} sticky top-0 z-10`}>
                    <tr>
                      <th className="p-4 font-black">Line Item Definition</th>
                      <th className="p-4 font-black">Data Key</th>
                      <th className="p-4 font-black text-right">Computed Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                     {customReportData.rows.map((row, i) => (
                        <tr key={i} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${row.isFormula ? (isDarkMode ? 'bg-zinc-900' : 'bg-slate-50') : ''}`}>
                           <td className={`p-4 ${row.isFormula ? 'font-black uppercase' : 'font-bold'}`}>
                              {row.label}
                              {row.isFormula && <span className="ml-2 text-[10px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">FORMULA SUM</span>}
                           </td>
                           <td className="p-4 font-mono text-[10px] text-zinc-400">
                             {'{'+row.id+'}'}
                           </td>
                           <td className={`p-4 text-right font-black font-mono text-xl tracking-tight ${row.value < 0 ? 'text-rose-500' : (row.isFormula ? 'text-emerald-500' : 'text-zinc-900 dark:text-white')}`}>
                              {formatReportCurrency(row.value)}
                           </td>
                        </tr>
                     ))}
                     {customReportData.rows.length === 0 && (
                        <tr><td colSpan={3} className="p-12 text-center text-zinc-500 font-bold italic">This custom report has no row definitions.</td></tr>
                     )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Custom Report Manager View */}
            {activeReport === 'custom_manager' && (
              <div className="p-8 space-y-8 flex flex-col h-full bg-zinc-50 dark:bg-zinc-900/10">
                <div className="flex justify-between items-start">
                   <div>
                      <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white">Report Management Registry</h2>
                      <p className="text-sm text-zinc-500 font-medium">Manage visibility, ordering, and configuration of analytical deployments.</p>
                   </div>
                   <button
                      onClick={() => {
                        setEditingReport({ name: 'New Custom Report', description: '', baseMode: 'movement', rows: [] });
                        setActiveReport('custom_builder');
                      }}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-all"
                   >
                     <Plus size={16} /> New Custom Report
                   </button>
                </div>

                <div className="flex flex-col gap-3">
                   {combinedReports.map((rep, index) => (
                      <div key={rep.id} className={`p-4 rounded-3xl border flex items-center justify-between gap-4 transition-all ${!rep.visible ? 'opacity-50' : ''} ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
                         
                         <div className="flex items-center gap-4 flex-1">
                            <div className="flex flex-col gap-1">
                               <button 
                                 onClick={() => moveReport(index, 'up')}
                                 disabled={index === 0}
                                 className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 transition-colors bg-zinc-100 dark:bg-zinc-800 rounded"
                               >
                                  <ArrowUp size={14} />
                               </button>
                               <button 
                                 onClick={() => moveReport(index, 'down')}
                                 disabled={index === combinedReports.length - 1}
                                 className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 transition-colors bg-zinc-100 dark:bg-zinc-800 rounded"
                               >
                                  <ArrowDown size={14} />
                               </button>
                            </div>

                            <div className="flex items-center justify-center p-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                               <rep.icon size={20} />
                            </div>
                            
                            <div>
                               <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${rep.isBuiltIn ? 'bg-blue-500/10 text-blue-500' : (rep.baseMode === 'balance' ? 'bg-yellow-500/10 text-yellow-600' : 'bg-emerald-500/10 text-emerald-500')}`}>
                                     {rep.isBuiltIn ? 'Built-in Native' : (rep.baseMode === 'balance' ? 'Custom Balance' : 'Custom Movement')}
                                  </span>
                                  {!rep.visible && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-rose-500/10 text-rose-500">Hidden from sidebar</span>}
                               </div>
                               <h3 className="font-black text-lg text-zinc-900 dark:text-white">{rep.label}</h3>
                               {!rep.isBuiltIn && <p className="text-xs text-zinc-500 line-clamp-1 mt-1">{rep.desc || 'No description provided.'}</p>}
                            </div>
                         </div>

                         <div className="flex items-center gap-2">
                            <button 
                               onClick={() => updateReportConfig(rep.id, { visible: !rep.visible })}
                               className="px-3 py-2 text-zinc-500 hover:text-zinc-800 dark:hover:text-white bg-zinc-100 dark:bg-zinc-800 rounded-xl transition-all flex items-center gap-2 text-xs font-bold"
                               title="Toggle Visibility"
                            >
                               {rep.visible ? <EyeOff size={14} /> : <Eye size={14} />}
                               {rep.visible ? 'Hide' : 'Show'}
                            </button>

                            {rep.visible && (
                               <button 
                                  onClick={() => setActiveReport(rep.id as ReportType)}
                                  className="px-4 py-2 text-xs font-black uppercase tracking-widest bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all flex items-center gap-2"
                               >
                                  <Play size={10} strokeWidth={4} /> Run
                               </button>
                            )}

                            {!rep.isBuiltIn && (
                               <>
                                <button 
                                   onClick={() => {
                                      setEditingReport(rep.ref!);
                                      setActiveReport('custom_builder');
                                   }}
                                   className="px-3 py-2 text-zinc-500 hover:text-zinc-800 dark:hover:text-white bg-zinc-100 dark:bg-zinc-800 rounded-xl transition-all"
                                   title="Edit Configuration"
                                >
                                   <Edit2 size={14} />
                                </button>
                                <button 
                                   onClick={async () => {
                                      if(confirm(`Permanently delete "${rep.label}"?`)) {
                                         try {
                                            await deleteDoc(doc(db, 'custom_reports', rep.ref!.id!));
                                         } catch(e) { alert("Delete failed"); }
                                      }
                                   }}
                                   className="px-3 py-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 bg-zinc-100 dark:bg-zinc-800 rounded-xl transition-all"
                                   title="Delete Report"
                                >
                                   <Trash2 size={14} />
                                </button>
                               </>
                            )}
                         </div>
                      </div>
                   ))}
                </div>
              </div>
            )}

            {/* Custom Report Builder View */}
            {activeReport === 'custom_builder' && editingReport && (
               <div className="p-8 space-y-8 flex flex-col h-full bg-zinc-50 dark:bg-zinc-900/10">
                 <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white">Custom Engineering Suite</h2>
                      <p className="text-sm text-zinc-500 font-medium">Design programmatic financial reports via DB injection.</p>
                    </div>
                    <div className="flex gap-2">
                       <button 
                         onClick={() => {
                            setEditingReport(null);
                            setActiveReport('custom_manager');
                         }}
                         className="px-4 py-2 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 font-bold"
                       >
                         Discard
                       </button>
                       {editingReport.id && (
                         <button 
                           onClick={async () => {
                             if(confirm('Delete custom report?')) {
                               try {
                                  // @ts-ignore
                                  await deleteDoc(doc(db, 'custom_reports', editingReport.id));
                                  setActiveReport('journal');
                               } catch(e) {}
                             }
                           }}
                           className="px-4 py-2 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700"
                         >
                            <Trash2 size={16} />
                         </button>
                       )}
                       <button 
                         onClick={async () => {
                           try {
                             if (editingReport.id) {
                               await updateDoc(doc(db, 'custom_reports', editingReport.id), { ...editingReport, updatedAt: serverTimestamp() });
                             } else {
                               await addDoc(collection(db, 'custom_reports'), { ...editingReport, createdAt: serverTimestamp() });
                             }
                             setActiveReport('journal');
                             setEditingReport(null);
                           } catch(e) {
                             console.error(e);
                             alert("Failed to save report. Verify rules / session.");
                           }
                         }}
                         className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white font-black rounded-lg hover:bg-emerald-700 shadow-xl shadow-emerald-500/20"
                       >
                         <Save size={16} /> Deploy Architecture
                       </button>
                    </div>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                       <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Report Moniker</label>
                       <input 
                         type="text" 
                         value={editingReport.name} 
                         onChange={e => setEditingReport({...editingReport, name: e.target.value})}
                         className="w-full p-3 font-bold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-emerald-500"
                       />
                    </div>
                    <div className="space-y-2">
                       <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Telemetry Description</label>
                       <input 
                         type="text" 
                         value={editingReport.description} 
                         onChange={e => setEditingReport({...editingReport, description: e.target.value})}
                         className="w-full p-3 font-bold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-emerald-500"
                       />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                       <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Calculation Engine Mode</label>
                       <select 
                         value={editingReport.baseMode} 
                         onChange={e => setEditingReport({...editingReport, baseMode: e.target.value as any})}
                         className="w-full p-3 font-bold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-emerald-500"
                       >
                         <option value="movement">Profit & Loss Pattern (Range Movements Only)</option>
                         <option value="balance">Balance Sheet Pattern (Opening + Range Movements)</option>
                       </select>
                    </div>
                 </div>

                 <div className="space-y-4">
                    <div className="flex justify-between items-center">
                       <h3 className="font-black uppercase tracking-widest text-zinc-500">Execution Stack (Row Nodes)</h3>
                       <button 
                         onClick={() => {
                           const newId = `R${editingReport.rows.length + 1}`;
                           setEditingReport({
                             ...editingReport, 
                             rows: [...editingReport.rows, { id: newId, label: 'New Node', type: 'category', matchCriteria: [], formula: '' }]
                           });
                         }}
                         className="text-sm font-bold text-blue-600 hover:text-blue-700 bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-lg"
                       >
                         + INJECT DATA NODE
                       </button>
                    </div>

                    <div className="space-y-4">
                       {editingReport.rows.map((row, i) => (
                          <div key={i} className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col md:flex-row gap-4 items-start md:items-center">
                             <div className="flex gap-2 shrink-0">
                                <button
                                  disabled={i === 0}
                                  onClick={() => {
                                    const rows = [...editingReport.rows];
                                    [rows[i-1], rows[i]] = [rows[i], rows[i-1]];
                                    setEditingReport({...editingReport, rows});
                                  }}
                                  className="p-2 text-zinc-400 hover:text-zinc-800 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                ><ArrowUp size={16} /></button>
                                <button
                                  disabled={i === editingReport.rows.length - 1}
                                  onClick={() => {
                                    const rows = [...editingReport.rows];
                                    [rows[i+1], rows[i]] = [rows[i], rows[i+1]];
                                    setEditingReport({...editingReport, rows});
                                  }}
                                  className="p-2 text-zinc-400 hover:text-zinc-800 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                ><ArrowDown size={16} /></button>
                             </div>

                             <input 
                               value={row.id} 
                               onChange={e => {
                                  const rows = [...editingReport.rows];
                                  rows[i].id = e.target.value.replace(/[^A-Za-z0-9_]/g, '');
                                  setEditingReport({...editingReport, rows});
                               }}
                               placeholder="ID" className="w-20 p-2 font-mono text-sm bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700" 
                             />

                             <input 
                               value={row.label} 
                               onChange={e => {
                                  const rows = [...editingReport.rows];
                                  rows[i].label = e.target.value;
                                  setEditingReport({...editingReport, rows});
                               }}
                               placeholder="Node Label" className="flex-1 p-2 font-bold text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded" 
                             />

                             <select 
                               value={row.type}
                               onChange={e => {
                                  const rows = [...editingReport.rows];
                                  rows[i].type = e.target.value as any;
                                  setEditingReport({...editingReport, rows});
                               }}
                               className="p-2 font-bold text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded w-40"
                             >
                                <option value="category">Bind Category</option>
                                <option value="account">Bind Exact Account</option>
                                <option value="formula">Math Formula</option>
                             </select>

                             <div className="flex-1 flex gap-2">
                               {row.type === 'formula' ? (
                                  <input 
                                    value={row.formula}
                                    onChange={e => {
                                      const rows = [...editingReport.rows];
                                      rows[i].formula = e.target.value;
                                      setEditingReport({...editingReport, rows});
                                    }}
                                    placeholder="e.g. {R1} - {R2}" 
                                    className="w-full p-2 font-mono text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded"
                                  />
                               ) : (
                                  <input 
                                    value={row.matchCriteria.join(', ')}
                                    onChange={e => {
                                      const rows = [...editingReport.rows];
                                      rows[i].matchCriteria = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                      setEditingReport({...editingReport, rows});
                                    }}
                                    placeholder={row.type === 'category' ? "e.g. revenue, expense" : "e.g. external_cash, stripe"}
                                    title="Comma separated values"
                                    className="w-full p-2 font-mono text-[11px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded"
                                  />
                               )}
                             </div>

                             <button 
                               onClick={() => {
                                  const rows = [...editingReport.rows];
                                  rows.splice(i, 1);
                                  setEditingReport({...editingReport, rows});
                               }}
                               className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded"
                             >
                                <Trash2 size={16} />
                             </button>

                          </div>
                       ))}
                    </div>
                    {editingReport.rows.filter(r => r.type==='formula').length > 0 && (
                      <p className="text-xs text-zinc-500 italic mt-4">
                        * Formulas evaluate standard mathematical operators (+, -, *, /, ()). Reference fields wrapped in braces, e.g. `{'{R1}'}`.
                      </p>
                    )}
                 </div>
               </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};
