import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { OperationType } from '../types';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { FinancialLedger } from './technical/FinancialLedger';
import { InvoicingModule } from './accounting/InvoicingModule';
import { ExpensesModule } from './accounting/ExpensesModule';
import { COAModule } from './accounting/COAModule';
import { FiscalModule } from './accounting/FiscalModule';
import { InventoryModule } from './accounting/InventoryModule';
import { PayrollModule } from './accounting/PayrollModule';
import { TenantBrandLockup } from './VescioNexusLogo';

export const AccountingApp: React.FC<{ canSwitchMode?: boolean; onSwitchMode?: () => void }> = ({ canSwitchMode, onSwitchMode }) => {
  const navigate = useNavigate();
  const { user, handleFirestoreError, formatCurrency, systemName, systemLogo } = useFirebase();
  const [activeTab, setActiveTab] = useState<'overview' | 'invoicing' | 'expenses' | 'payroll' | 'inventory' | 'coa' | 'fiscal'>('overview');
  const { isDarkMode, toggleDarkMode } = useTheme();

  const [coa, setCoa] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsubCoa = onSnapshot(collection(db, 'chartOfAccounts'), snap => setCoa(snap.docs.map(d => ({id: d.id, ...d.data()}))), error => handleFirestoreError(error, OperationType.LIST, 'chartOfAccounts'));
    return () => unsubCoa();
  }, [user]);

  return (
    <div className={`min-h-screen transition-colors ${isDarkMode ? 'dark bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans`}>
      <header className="bg-white/90 dark:bg-[#0B0F17]/90 border-b border-slate-200 dark:border-zinc-800/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <TenantBrandLockup
                systemName={systemName}
                systemLogo={systemLogo}
                size="sm"
                subtitle="Real-Time Accounting"
              />
            </div>

            <div className="flex items-center gap-4">
              {canSwitchMode && onSwitchMode && (
                <button
                  onClick={onSwitchMode}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
                >
                  Switch to Posting Mode
                </button>
              )}
              <div className="el-segmented">
                {(['overview', 'invoicing', 'expenses', 'payroll', 'inventory', 'coa', 'fiscal'] as const).map(tab => (
                  <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`el-segmented-item ${activeTab === tab ? 'el-segmented-item-active' : ''}`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {activeTab === 'overview' && (
          <FinancialLedger isDarkMode={isDarkMode} />
        )}

        {activeTab === 'invoicing' && (
          <InvoicingModule isDarkMode={isDarkMode} />
        )}

        {activeTab === 'expenses' && (
          <ExpensesModule isDarkMode={isDarkMode} coa={coa} formatCurrency={formatCurrency} />
        )}

        {activeTab === 'payroll' && (
          <PayrollModule isDarkMode={isDarkMode} formatCurrency={formatCurrency} />
        )}

        {activeTab === 'inventory' && (
          <InventoryModule isDarkMode={isDarkMode} formatCurrency={formatCurrency} />
        )}

        {activeTab === 'coa' && (
          <COAModule isDarkMode={isDarkMode} coa={coa} formatCurrency={formatCurrency} />
        )}
        
        {activeTab === 'fiscal' && (
          <FiscalModule isDarkMode={isDarkMode} />
        )}
      </main>
    </div>
  );
};

