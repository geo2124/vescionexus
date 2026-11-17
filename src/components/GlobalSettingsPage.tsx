import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase, defaultTaxRules, TaxRules } from '../contexts/FirebaseContext';
import { OperationType } from '../types';
import { ArrowLeft, Save, Building, CreditCard, Settings, Receipt } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { VescioNexusLogo, TenantBrandLockup } from './VescioNexusLogo';

// Assuming we have a local helper or import one if it was globally required, but keeping it simple locally
const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null, _user?: any) => {
  console.error(`Firestore ${operationType} Error at ${path}:`, error);
};

export const GlobalSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useFirebase();
  const { isDarkMode } = useTheme();

  const [settings, setSettings] = useState({
    systemName: 'Vescio Nexus',
    systemLogo: '',
    currency: 'USD',
    usdToLbpRate: 90000,
    contactEmail: '',
    contactPhone: '',
    address: '',
    mofTaxId: 'MOF-3891042-601',
    taxRules: defaultTaxRules,
    accountingMode: 'real_time',
    adjustmentPercentage: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const docRef = doc(db, 'system', 'settings');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data() as any;
          const rawName = (data.systemName || data.complexName || '').trim();
          setSettings({
            ...data,
            systemName: !rawName || rawName === 'Elite OS' || rawName === 'Up ERP' ? 'Vescio Nexus' : rawName,
            systemLogo: data.systemLogo || '',
            mofTaxId: data.mofTaxId || 'MOF-3891042-601',
            taxRules: data.taxRules || defaultTaxRules,
            accountingMode: data.accountingMode || 'real_time',
            adjustmentPercentage: typeof data.adjustmentPercentage === 'number' ? data.adjustmentPercentage : 0
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'system/settings', user);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, [user]);

  const handleSave = async () => {
    try {
      await setDoc(doc(db, 'system', 'settings'), settings);
      toast.success('Settings saved successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'system/settings', user);
      toast.error('Failed to save settings');
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans`}>
      <nav className={`sticky top-0 z-50 border-b ${isDarkMode ? 'bg-[#05070A]/90 border-zinc-800/80' : 'bg-white/90 border-slate-200/80'} backdrop-blur-xl px-6 py-3.5`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <TenantBrandLockup
              systemName={settings.systemName}
              systemLogo={settings.systemLogo}
              size="sm"
              subtitle="Global Settings"
            />
          </div>
          <button 
            onClick={handleSave}
            className="flex items-center gap-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-5 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-lg shadow-cyan-500/20"
          >
            <Save size={17} /> Save Changes
          </button>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto p-6 space-y-8 mt-6">
        <div className={`p-8 rounded-3xl border ${isDarkMode ? 'bg-[#0B0F17]/90 border-zinc-800/80' : 'bg-white border-slate-200/80'} shadow-sm`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-cyan-500/10 text-[#00B8C8]' : 'bg-cyan-50 text-[#0099A8]'}`}>
                <Building size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Company / Tenant Branding (Powered by Vescio Nexus)</h2>
                <p className="text-xs text-zinc-500">White-label tenant identity while preserving core Vescio Nexus platform architecture</p>
              </div>
            </div>
            <VescioNexusLogo variant="mark-only" size="sm" />
          </div>
          
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold mb-2">Company / System Name</label>
                <input 
                  type="text" 
                  value={settings.systemName}
                  onChange={e => setSettings({...settings, systemName: e.target.value})}
                  placeholder="Vescio Nexus (or Custom Tenant Name)"
                  className="el-input"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Leave as <span className="font-bold text-[#00B8C8]">Vescio Nexus</span> for default platform branding, or enter a client company name for multi-tenant white-labeling.
                </p>
              </div>
              <div>
                <label className="block text-sm font-bold mb-2">Tenant Logo (Optional)</label>
                <div className="flex items-center gap-4">
                  {settings.systemLogo && (
                    <div className="relative group">
                      <img src={settings.systemLogo} alt="Logo" className="w-11 h-11 rounded-xl object-contain bg-white border border-slate-200 p-1" />
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, systemLogo: '' })}
                        className="text-[10px] font-bold text-rose-500 hover:underline block mt-1"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                  <input 
                    type="file" 
                    accept="image/png, image/jpeg, image/svg+xml"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setSettings({...settings, systemLogo: reader.result as string});
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="flex-1 text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-cyan-500/10 file:text-[#00B8C8] hover:file:bg-cyan-500/20"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold mb-2">Contact Email</label>
                <input 
                  type="email" 
                  value={settings.contactEmail}
                  onChange={e => setSettings({...settings, contactEmail: e.target.value})}
                  className="el-input"
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-2">Contact Phone</label>
                <input 
                  type="text" 
                  value={settings.contactPhone}
                  onChange={e => setSettings({...settings, contactPhone: e.target.value})}
                  className="el-input"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold mb-2">Lebanese MOF Tax ID (الرقم الضريبي — TIN)</label>
                <input 
                  type="text" 
                  value={settings.mofTaxId}
                  onChange={e => setSettings({...settings, mofTaxId: e.target.value})}
                  placeholder="e.g. MOF-3891042-601"
                  className="el-input font-mono"
                />
                <p className="text-[11px] text-zinc-500 mt-1">Printed on Official Lebanese MOF Sequential Tax Invoices (INV-YYYY-XXXX)</p>
              </div>
              <div>
                <label className="block text-sm font-bold mb-2">Address</label>
                <textarea 
                  value={settings.address}
                  onChange={e => setSettings({...settings, address: e.target.value})}
                  className="el-input min-h-[80px]"
                />
              </div>
            </div>
          </div>
        </div>

        <div className={`p-8 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-emerald-500/10 text-emerald-500' : 'bg-emerald-50 text-emerald-600'}`}>
                <CreditCard size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Currency & Exchange</h2>
                <p className="text-xs text-zinc-500">Configure system-wide financial display logic</p>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <label className="block text-sm font-bold mb-3">Primary Display Currency</label>
              <div className="flex flex-col gap-3">
                <label className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${
                  settings.currency === 'USD' 
                    ? 'border-blue-500 bg-blue-500/5 ring-1 ring-blue-500' 
                    : isDarkMode ? 'border-zinc-800 bg-zinc-900/30' : 'border-zinc-200 bg-white'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${settings.currency === 'USD' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>$</div>
                    <div>
                      <p className="font-bold">United States Dollar</p>
                      <p className="text-xs text-zinc-500">International Standard (USD)</p>
                    </div>
                  </div>
                  <input 
                    type="radio" 
                    name="currency" 
                    checked={settings.currency === 'USD'} 
                    onChange={() => setSettings({...settings, currency: 'USD'})}
                    className="w-5 h-5 accent-blue-600"
                  />
                </label>

                <label className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${
                  settings.currency === 'LBP' 
                    ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500' 
                    : isDarkMode ? 'border-zinc-800 bg-zinc-900/30' : 'border-zinc-200 bg-white'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${settings.currency === 'LBP' ? 'bg-emerald-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>ل.ل</div>
                    <div>
                      <p className="font-bold">Lebanese Pound</p>
                      <p className="text-xs text-zinc-500">Local Currency (LBP)</p>
                    </div>
                  </div>
                  <input 
                    type="radio" 
                    name="currency" 
                    checked={settings.currency === 'LBP'} 
                    onChange={() => setSettings({...settings, currency: 'LBP'})}
                    className="w-5 h-5 accent-emerald-600"
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-col justify-center">
              <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                <label className="block text-sm font-bold mb-4 flex items-center gap-2">
                  <Settings size={16} className="text-zinc-400" />
                  Conversion Rate (1 USD to LBP)
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-zinc-400">$1 =</div>
                  <input 
                    type="number" 
                    value={settings.usdToLbpRate}
                    onChange={e => setSettings({...settings, usdToLbpRate: parseFloat(e.target.value) || 0})}
                    className="el-input !pl-16 !font-mono !text-xl !py-4"
                    placeholder="e.g. 89500"
                  />
                </div>
                <div className="mt-6 space-y-2 border-t pt-4 dark:border-zinc-800">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Live Preview</p>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-zinc-500">Example Amount ($50.00)</span>
                    <span className="font-bold text-emerald-500">
                      ل.ل {(50 * settings.usdToLbpRate).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-zinc-500">Example Amount ($1,000.00)</span>
                    <span className="font-bold text-emerald-500">
                      ل.ل {(1000 * settings.usdToLbpRate).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`p-8 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-purple-500/10 text-purple-500' : 'bg-purple-50 text-purple-600'}`}>
                <Receipt size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Accounting System Mode</h2>
                <p className="text-xs text-zinc-500">Choose between automated real-time recording or advanced manual batch posting</p>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <label className={`flex flex-col gap-3 p-6 rounded-2xl border cursor-pointer transition-all ${
              settings.accountingMode === 'real_time'
                ? 'border-blue-500 bg-blue-500/5 ring-1 ring-blue-500' 
                : isDarkMode ? 'border-zinc-800 bg-zinc-900/30' : 'border-zinc-200 bg-white'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${settings.accountingMode === 'real_time' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>⚡</div>
                  <h3 className="font-bold">Real-time Integration</h3>
                </div>
                <input 
                  type="radio" 
                  name="accountingMode" 
                  checked={settings.accountingMode === 'real_time'} 
                  onChange={() => setSettings({...settings, accountingMode: 'real_time'})}
                  className="w-5 h-5 accent-blue-600"
                />
              </div>
              <p className="text-sm text-zinc-500">Transactions are automatically posted to the general ledger as they happen. Best for simpler setups.</p>
            </label>

            <label className={`flex flex-col gap-3 p-6 rounded-2xl border cursor-pointer transition-all ${
              settings.accountingMode === 'batch_manual'
                ? 'border-purple-500 bg-purple-500/5 ring-1 ring-purple-500' 
                : isDarkMode ? 'border-zinc-800 bg-zinc-900/30' : 'border-zinc-200 bg-white'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${settings.accountingMode === 'batch_manual' ? 'bg-purple-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>⚖️</div>
                  <h3 className="font-bold">Batch / Manual Posting</h3>
                </div>
                <input 
                  type="radio" 
                  name="accountingMode" 
                  checked={settings.accountingMode === 'batch_manual'} 
                  onChange={() => setSettings({...settings, accountingMode: 'batch_manual'})}
                  className="w-5 h-5 accent-purple-600"
                />
              </div>
              <p className="text-sm text-zinc-500">Advanced mode. Transactions stay unposted until reviewed and validated by the accountant.</p>
            </label>
          </div>

          {/* Custom % Adjustment / Deficit Modifier for Posting Mode */}
          <div className={`mt-6 p-6 rounded-2xl border transition-all ${
            settings.accountingMode === 'batch_manual'
              ? isDarkMode ? 'bg-purple-500/5 border-purple-500/30' : 'bg-purple-50/50 border-purple-200'
              : isDarkMode ? 'bg-zinc-950/60 border-zinc-800/80 opacity-80' : 'bg-slate-50 border-slate-200 opacity-80'
          }`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-sm">Posting Mode Adjustment / Deficit Modifier (%)</h3>
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                    settings.accountingMode === 'batch_manual'
                      ? 'bg-purple-600 text-white'
                      : 'bg-zinc-500/10 text-zinc-500'
                  }`}>
                    {settings.accountingMode === 'batch_manual' ? 'Active in Posting Mode' : 'Posting Mode Only'}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Adjusts uninvoiced cash-in transactions during Batch / Manual Posting between <span className="font-mono font-bold">-100%</span> and <span className="font-mono font-bold">+100%</span> while keeping official Invoices and Double-Entry Debits = Credits 100% balanced.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="relative w-36">
                  <input
                    type="number"
                    min="-100"
                    max="100"
                    step="0.5"
                    value={settings.adjustmentPercentage}
                    onChange={e => {
                      const raw = parseFloat(e.target.value);
                      const clamped = isNaN(raw) ? 0 : Math.max(-100, Math.min(100, raw));
                      setSettings({ ...settings, adjustmentPercentage: clamped });
                    }}
                    className="el-input !pr-8 !font-mono !text-lg !font-bold text-right"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-zinc-400">%</span>
                </div>
                <div className={`px-4 py-2.5 rounded-xl border text-xs font-mono font-bold min-w-[140px] text-right ${
                  isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'
                }`}>
                  <div className="text-[10px] text-zinc-500 uppercase font-sans">Example $100 Cash-In</div>
                  <div className={settings.adjustmentPercentage < 0 ? 'text-amber-500' : settings.adjustmentPercentage > 0 ? 'text-emerald-500' : 'text-blue-500'}>
                    Posts as ${(100 * (1 + (settings.adjustmentPercentage || 0) / 100)).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`p-8 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-rose-500/10 text-rose-500' : 'bg-rose-50 text-rose-600'}`}>
                <Receipt size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Taxation System</h2>
                <p className="text-xs text-zinc-500">Configure separate tax liabilities for USD and LBP</p>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* USD Tax Rules */}
            <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
               <div className="flex items-center justify-between mb-4">
                 <h3 className="font-bold flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs">$</span> USD Taxation</h3>
                 <label className="flex items-center gap-2 cursor-pointer">
                   <input type="checkbox" checked={settings.taxRules.USD.enabled} onChange={e => setSettings({...settings, taxRules: {...settings.taxRules, USD: {...settings.taxRules.USD, enabled: e.target.checked}}})} className="accent-blue-600 w-4 h-4" />
                   <span className="text-sm font-bold">Enable</span>
                 </label>
               </div>
               
               {settings.taxRules.USD.enabled ? (
                 <div className="space-y-4 animate-in fade-in zoom-in-95">
                   <div>
                     <label className="block text-xs font-bold mb-1 text-zinc-500">Tax Label (e.g. VAT, State Tax)</label>
                     <input type="text" value={settings.taxRules.USD.name} onChange={e => setSettings({...settings, taxRules: {...settings.taxRules, USD: {...settings.taxRules.USD, name: e.target.value}}})} className="el-input text-sm" />
                   </div>
                   <div>
                     <label className="block text-xs font-bold mb-1 text-zinc-500">Tax Percentage (%)</label>
                     <input type="number" value={settings.taxRules.USD.rate} onChange={e => setSettings({...settings, taxRules: {...settings.taxRules, USD: {...settings.taxRules.USD, rate: parseFloat(e.target.value) || 0}}})} className="el-input text-sm" />
                   </div>
                   <div>
                     <label className="flex items-center gap-3 p-3 rounded-lg border dark:border-zinc-800 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                       <input type="checkbox" checked={settings.taxRules.USD.inclusive} onChange={e => setSettings({...settings, taxRules: {...settings.taxRules, USD: {...settings.taxRules.USD, inclusive: e.target.checked}}})} className="accent-blue-600 w-4 h-4" />
                       <div>
                         <p className="text-sm font-bold leading-none mb-1">Inclusive Tax</p>
                         <p className="text-[10px] text-zinc-500 leading-tight">If checked, total revenue includes the tax. If unchecked, tax is calculated on top.</p>
                       </div>
                     </label>
                   </div>
                 </div>
               ) : (
                 <div className="p-4 text-center border border-dashed dark:border-zinc-800 rounded-xl">
                   <p className="text-xs text-zinc-500 font-bold">USD taxation is completely disabled.</p>
                 </div>
               )}
            </div>

            {/* LBP Tax Rules */}
            <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
               <div className="flex items-center justify-between mb-4">
                 <h3 className="font-bold flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">ل.ل</span> LBP Taxation</h3>
                 <label className="flex items-center gap-2 cursor-pointer">
                   <input type="checkbox" checked={settings.taxRules.LBP.enabled} onChange={e => setSettings({...settings, taxRules: {...settings.taxRules, LBP: {...settings.taxRules.LBP, enabled: e.target.checked}}})} className="accent-emerald-600 w-4 h-4" />
                   <span className="text-sm font-bold">Enable</span>
                 </label>
               </div>
               
               {settings.taxRules.LBP.enabled ? (
                 <div className="space-y-4 animate-in fade-in zoom-in-95">
                   <div>
                     <label className="block text-xs font-bold mb-1 text-zinc-500">Tax Label (e.g. TVA, VAT)</label>
                     <input type="text" value={settings.taxRules.LBP.name} onChange={e => setSettings({...settings, taxRules: {...settings.taxRules, LBP: {...settings.taxRules.LBP, name: e.target.value}}})} className="el-input text-sm" />
                   </div>
                   <div>
                     <label className="block text-xs font-bold mb-1 text-zinc-500">Tax Percentage (%)</label>
                     <input type="number" value={settings.taxRules.LBP.rate} onChange={e => setSettings({...settings, taxRules: {...settings.taxRules, LBP: {...settings.taxRules.LBP, rate: parseFloat(e.target.value) || 0}}})} className="el-input text-sm" />
                   </div>
                   <div>
                     <label className="flex items-center gap-3 p-3 rounded-lg border dark:border-zinc-800 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                       <input type="checkbox" checked={settings.taxRules.LBP.inclusive} onChange={e => setSettings({...settings, taxRules: {...settings.taxRules, LBP: {...settings.taxRules.LBP, inclusive: e.target.checked}}})} className="accent-emerald-600 w-4 h-4" />
                       <div>
                         <p className="text-sm font-bold leading-none mb-1">Inclusive Tax</p>
                         <p className="text-[10px] text-zinc-500 leading-tight">If checked, total revenue includes the tax. If unchecked, tax is calculated on top.</p>
                       </div>
                     </label>
                   </div>
                 </div>
               ) : (
                 <div className="p-4 text-center border border-dashed dark:border-zinc-800 rounded-xl">
                   <p className="text-xs text-zinc-500 font-bold">LBP taxation is completely disabled.</p>
                 </div>
               )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default GlobalSettingsPage;
