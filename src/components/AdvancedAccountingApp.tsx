import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { OperationType } from '../types';
import { ArrowLeft, Filter, RefreshCw, DollarSign, ChevronDown, Check, Printer, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';

import { AdvancedJournal } from './accounting/AdvancedJournal';
import { FinancialLedger } from './technical/FinancialLedger';
import { ManualEntryModule } from './accounting/ManualEntryModule';
import { ExpensesModule } from './accounting/ExpensesModule';
import { InvoicingModule } from './accounting/InvoicingModule';
import { COAModule } from './accounting/COAModule';
import { PeriodCloseModule } from './accounting/PeriodCloseModule';
import { BankReconciliationModule } from './accounting/BankReconciliationModule';

import { DepreciationModule } from './accounting/DepreciationModule';
import { APARModule } from './accounting/APARModule';
import { PayrollModule } from './accounting/PayrollModule';
import { BudgetModule } from './accounting/BudgetModule';
import { AccrualsModule } from './accounting/AccrualsModule';
import { InventoryModule } from './accounting/InventoryModule';
import { TenantBrandLockup } from './VescioNexusLogo';

export const AdvancedAccountingApp: React.FC<{ canSwitchMode?: boolean; onSwitchMode?: () => void }> = ({ canSwitchMode, onSwitchMode }) => {
  const navigate = useNavigate();
  const { user, handleFirestoreError, usdToLbpRate, systemName, systemLogo } = useFirebase();
  const [activeTab, setActiveTab] = useState<'journal' | 'recon' | 'manual' | 'expenses' | 'invoicing' | 'coa' | 'reports' | 'closing' | 'depreciation' | 'apar' | 'payroll' | 'budget' | 'accruals' | 'inventory'>('journal');
  const { isDarkMode, toggleDarkMode } = useTheme();

  const [coa, setCoa] = useState<any[]>([]);
  const [globalCurrency, setGlobalCurrency] = useState<'USD' | 'LBP'>('USD');
  const [globalSelectedModules, setGlobalSelectedModules] = useState<string[]>(['gym', 'reservation', 'physio', 'pos_retail', 'pos_cafe', 'expenses', 'invoicing', 'payroll']);
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);

  const allModules = [
    { id: 'gym', label: 'Gym' },
    { id: 'reservation', label: 'Reservations' },
    { id: 'physio', label: 'Physio' },
    { id: 'pos_retail', label: 'Retail Shop POS' },
    { id: 'pos_cafe', label: 'Kiosk POS' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'invoicing', label: 'Invoicing' },
    { id: 'payroll', label: 'HR' }
  ];

  useEffect(() => {
    if (!user) return;
    const unsubCoa = onSnapshot(collection(db, 'chartOfAccounts'), snap => setCoa(snap.docs.map(d => ({id: d.id, ...d.data()}))), error => handleFirestoreError(error, OperationType.LIST, 'chartOfAccounts'));
    return () => unsubCoa();
  }, [user]);

  const convertValue = (amountInUSD: number) => {
    return globalCurrency === 'LBP' ? amountInUSD * usdToLbpRate : amountInUSD;
  };

  const formatCurrency = (amountInUSD: number) => {
    const amount = convertValue(amountInUSD);
    if (globalCurrency === 'LBP') {
      return `ل.ل ${Math.round(amount).toLocaleString()}`;
    }
    return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const toggleModule = (modId: string) => {
    if (globalSelectedModules.includes(modId)) {
      setGlobalSelectedModules(globalSelectedModules.filter(m => m !== modId));
    } else {
      setGlobalSelectedModules([...globalSelectedModules, modId]);
    }
  };

  const toggleAllModules = () => {
    if (globalSelectedModules.length === allModules.length) {
      setGlobalSelectedModules([]);
    } else {
      setGlobalSelectedModules(allModules.map(m => m.id));
    }
  };

  const exportDOM = (type: 'pdf' | 'xls' | 'csv' | 'print') => {
    // Generate a unique event to allow modules to handle their own custom data export
    const event = new CustomEvent('GLOBAL_EXPORT', { detail: { type }, cancelable: true });
    
    // If window.dispatchEvent returns false, a module handled it and called e.preventDefault()
    if (!window.dispatchEvent(event)) {
      return; 
    }

    // Default fallback simple DOM scraper
    const tables = document.querySelectorAll('main table');
    if (tables.length === 0) {
      toast.info('No tabular data found on this page to export. Try a different report view.');
      return;
    }

    const title = `${systemName || 'Vescio Nexus'} — Advanced Accounting (${activeTab.toUpperCase()})`;

    if (type === 'pdf' || type === 'print') {
      const doc = new jsPDF();
      doc.setFillColor(11, 15, 23);
      doc.rect(0, 0, 210, 22, 'F');
      doc.setFillColor(0, 184, 200);
      doc.rect(0, 22, 210, 1.5, 'F');
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text(title, 14, 14);
      
      let startY = 28;
      tables.forEach((table) => {
        autoTable(doc, {
          html: table as HTMLTableElement,
          startY: startY,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 2 },
          headStyles: { fillColor: [0, 184, 200], textColor: [11, 15, 23], fontStyle: 'bold' },
        });
        startY = (doc as any).lastAutoTable.finalY + 15;
      });
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 130);
      doc.text('Generated by Vescio Nexus ERP', 14, 288);
      if (type === 'print') {
        const blobUrl = URL.createObjectURL(doc.output('blob'));
        window.open(blobUrl, '_blank');
      } else {
        doc.save(`${activeTab}_export.pdf`);
      }
    } else {
      const wb = XLSX.utils.book_new();
      tables.forEach((table, i) => {
        const ws = XLSX.utils.table_to_sheet(table);
        XLSX.utils.book_append_sheet(wb, ws, `Data ${i + 1}`);
      });
      if (type === 'csv') {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        saveAs(blob, `${activeTab}_export.csv`);
      } else {
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, `${activeTab}_export.xlsx`);
      }
    }
  };

  return (
    <div className={`min-h-screen transition-colors ${isDarkMode ? 'dark bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans`}>
      <header className={`sticky top-0 z-50 border-b ${isDarkMode ? 'bg-[#0B0F17]/90 border-zinc-800/80' : 'bg-white/90 border-slate-200'} backdrop-blur-md print:hidden`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <TenantBrandLockup
                  systemName={systemName}
                  systemLogo={systemLogo}
                  size="sm"
                  subtitle="Posting & Adjusted Accounting"
                />
              </div>

              <div className="flex items-center gap-4">
                {canSwitchMode && onSwitchMode && (
                  <button
                    onClick={onSwitchMode}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
                  >
                    Switch to Real-Time Mode
                  </button>
                )}
                <div className="hidden md:flex rounded-xl border border-zinc-900/10 dark:border-white/5 overflow-hidden shadow-sm bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 transition-colors">
                  <button onClick={() => exportDOM('pdf')} className="flex items-center gap-1.5 px-3.5 py-2 text-[10px] uppercase font-bold hover:bg-black/20 dark:hover:bg-zinc-100 transition-colors border-r border-white/10 dark:border-zinc-900/10" title="Export to PDF">
                    <Download size={12} /> PDF
                  </button>
                  <button onClick={() => exportDOM('xls')} className="flex items-center gap-1.5 px-3.5 py-2 text-[10px] uppercase font-bold hover:bg-black/20 dark:hover:bg-zinc-100 transition-colors border-r border-white/10 dark:border-zinc-900/10" title="Export to Excel">
                    XLS
                  </button>
                  <button onClick={() => exportDOM('csv')} className="flex items-center gap-1.5 px-3.5 py-2 text-[10px] uppercase font-bold hover:bg-black/20 dark:hover:bg-zinc-100 transition-colors border-r border-white/10 dark:border-zinc-900/10" title="Export to CSV">
                    CSV
                  </button>
                  <button onClick={() => exportDOM('print')} className="flex items-center gap-1.5 px-3.5 py-2 text-[10px] uppercase font-bold hover:bg-black/20 dark:hover:bg-zinc-100 transition-colors" title="Print Current View">
                    <Printer size={12} /> Print
                  </button>
                </div>

                <div className="hidden md:flex rounded-xl border border-zinc-900/10 dark:border-zinc-800 overflow-hidden shadow-sm bg-slate-100 dark:bg-[#101622] text-slate-900 dark:text-white transition-colors">
                  <button onClick={() => setGlobalCurrency('USD')} className={`flex items-center gap-1.5 px-3.5 py-2 text-[10px] uppercase font-bold transition-colors border-r border-slate-200 dark:border-zinc-800 ${globalCurrency === 'USD' ? 'bg-[#00B8C8] text-slate-950' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
                    <DollarSign size={12} /> USD
                  </button>
                  <button onClick={() => setGlobalCurrency('LBP')} className={`flex items-center gap-1.5 px-3.5 py-2 text-[10px] uppercase font-bold transition-colors ${globalCurrency === 'LBP' ? 'bg-[#00B8C8] text-slate-950' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
                    LBP
                  </button>
                </div>

                <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                {(['journal', 'reports', 'manual', 'recon', 'expenses', 'invoicing', 'payroll', 'inventory', 'coa', 'depreciation', 'closing'] as const).map(tab => (
                  <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold tracking-tight transition-all ${activeTab === tab ? 'bg-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]' : isDarkMode ? 'bg-[#101622] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 border border-zinc-800/80' : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 border border-slate-200 shadow-sm'}`}
                  >
                    {tab === 'recon' ? 'Reconciliation' : tab === 'closing' ? 'Period Close' : tab === 'depreciation' ? 'Assets' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              
              <div className="relative">
                <button 
                  onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition-all shadow-sm ${isFilterDropdownOpen || globalSelectedModules.length < allModules.length ? isDarkMode ? 'bg-purple-900/40 border-purple-800/60 text-purple-300' : 'bg-purple-50 text-purple-700 border-purple-200' : isDarkMode ? 'bg-zinc-800/80 border-zinc-700 text-zinc-300' : 'bg-white text-zinc-700 border-zinc-200'}`}
                >
                  <Filter size={16} /> 
                  {globalSelectedModules.length === allModules.length ? 'All Modules' : `${globalSelectedModules.length} Modules`}
                  <ChevronDown size={14} className={`transition-transform duration-200 ${isFilterDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {isFilterDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsFilterDropdownOpen(false)}></div>
                    <div className={`absolute right-0 mt-2 w-64 rounded-2xl shadow-xl border z-50 overflow-hidden ${isDarkMode ? 'bg-zinc-900 border-zinc-800 shadow-black/50' : 'bg-white border-zinc-200 shadow-zinc-200/50'}`}>
                      <div className={`p-3 border-b text-xs font-bold uppercase tracking-widest flex justify-between items-center ${isDarkMode ? 'border-zinc-800 text-zinc-500' : 'border-zinc-100 text-zinc-400'}`}>
                        Filter by Module
                        <button onClick={toggleAllModules} className={`hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors ${globalSelectedModules.length === allModules.length ? 'text-purple-600 dark:text-purple-400' : ''}`}>
                          {globalSelectedModules.length === allModules.length ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                      <div className="p-2 max-h-[300px] overflow-y-auto">
                        {allModules.map(mod => (
                          <button 
                            key={mod.id}
                            onClick={() => toggleModule(mod.id)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[11px] font-bold mb-1 transition-all ${globalSelectedModules.includes(mod.id) ? isDarkMode ? 'bg-purple-500/20 text-purple-300' : 'bg-purple-50 text-purple-700' : isDarkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-zinc-50'}`}
                          >
                            <span className="uppercase tracking-widest">{mod.label}</span>
                            {globalSelectedModules.includes(mod.id) && <Check size={16} />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {activeTab === 'journal' && (
          <AdvancedJournal isDarkMode={isDarkMode} coa={coa} globalCurrency={globalCurrency} formatCurrency={formatCurrency} selectedModules={globalSelectedModules} />
        )}

        {activeTab === 'recon' && (
          <BankReconciliationModule isDarkMode={isDarkMode} globalCurrency={globalCurrency} formatCurrency={formatCurrency} selectedModules={globalSelectedModules} />
        )}

        {activeTab === 'manual' && (
          <ManualEntryModule isDarkMode={isDarkMode} coa={coa} globalCurrency={globalCurrency} formatCurrency={formatCurrency} />
        )}

        {activeTab === 'expenses' && (
          <ExpensesModule isDarkMode={isDarkMode} coa={coa} formatCurrency={formatCurrency} />
        )}

        {activeTab === 'invoicing' && (
          <InvoicingModule isDarkMode={isDarkMode} formatCurrency={formatCurrency} />
        )}

        {activeTab === 'coa' && (
          <COAModule isDarkMode={isDarkMode} coa={coa} formatCurrency={formatCurrency} />
        )}

        {activeTab === 'reports' && (
          <FinancialLedger isDarkMode={isDarkMode} isAdvancedMode={true} globalCurrency={globalCurrency} formatCurrency={formatCurrency} selectedModules={globalSelectedModules} />
        )}

        {activeTab === 'closing' && (
          <PeriodCloseModule isDarkMode={isDarkMode} globalCurrency={globalCurrency} formatCurrency={formatCurrency} />
        )}

        {activeTab === 'depreciation' && (
          <DepreciationModule isDarkMode={isDarkMode} globalCurrency={globalCurrency} formatCurrency={formatCurrency} />
        )}
        
        {activeTab === 'apar' && (
          <APARModule isDarkMode={isDarkMode} formatCurrency={formatCurrency} />
        )}
        
        {activeTab === 'payroll' && (
          <PayrollModule isDarkMode={isDarkMode} formatCurrency={formatCurrency} />
        )}
        
        {activeTab === 'budget' && (
          <BudgetModule isDarkMode={isDarkMode} formatCurrency={formatCurrency} />
        )}
        
        {activeTab === 'accruals' && (
          <AccrualsModule isDarkMode={isDarkMode} formatCurrency={formatCurrency} />
        )}
        
        {activeTab === 'inventory' && (
          <InventoryModule isDarkMode={isDarkMode} formatCurrency={formatCurrency} />
        )}
      </main>
    </div>
  );
};
