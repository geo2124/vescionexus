import React from 'react';
import { Calendar, Settings, Plus, Moon, Sun, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFirebase } from '../contexts/FirebaseContext';
import { NotificationCenter } from './NotificationCenter';
import { TenantBrandLockup } from './VescioNexusLogo';

interface HeaderProps {
  onOpenRates: () => void;
  onOpenBook: () => void;
  onOpenOffDays: () => void;
  dailyNet: number;
  monthlyNet: number;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenRates, onOpenBook, onOpenOffDays, dailyNet, monthlyNet, theme, onToggleTheme }) => {
  const navigate = useNavigate();
  const { systemName, systemLogo, formatCurrency } = useFirebase();
  
  return (
    <header className={`flex items-center justify-between px-6 py-3.5 border-b backdrop-blur-xl sticky top-0 z-40 transition-colors ${
      theme === 'dark' 
        ? 'bg-[#05070A]/90 border-zinc-800/80' 
        : 'bg-white/90 border-slate-200/80'
    }`}>
      <div className="flex items-center gap-3">
        <TenantBrandLockup
          systemName={systemName}
          systemLogo={systemLogo}
          size="sm"
          subtitle="Court Reservations"
        />
      </div>
      <div className="flex items-center gap-3">
        <NotificationCenter isDarkMode={theme === 'dark'} />
        <button 
          onClick={onToggleTheme}
          className={`p-2 rounded-xl border transition-all ${
            theme === 'dark' 
              ? 'bg-[#0B0F17] border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-cyan-500/40' 
              : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 hover:border-cyan-500/40'
          }`}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        <button 
          onClick={onOpenOffDays}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
            theme === 'dark' 
              ? 'bg-[#0B0F17] border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-cyan-500/40' 
              : 'bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-900 hover:border-cyan-500/40'
          }`}
        >
          <Calendar size={14} className="text-[#00B8C8]" />
          <span>Off Days</span>
        </button>

        <div className={`flex items-center gap-5 mr-2 px-4 py-1.5 rounded-xl border transition-colors ${
          theme === 'dark' 
            ? 'bg-[#0B0F17] border-zinc-800/80' 
            : 'bg-slate-50 border-slate-200/80'
        }`}>
          <div className="flex flex-col items-end">
            <span className="text-[8px] text-zinc-500 uppercase tracking-widest font-bold mb-0.5">Monthly Net</span>
            <span className="text-xs font-bold font-mono text-[#00B8C8]">{formatCurrency(monthlyNet)}</span>
          </div>
          <div className={`w-px h-6 transition-colors ${theme === 'dark' ? 'bg-zinc-800' : 'bg-slate-200'}`}></div>
          <div className="flex flex-col items-end">
            <span className="text-[8px] text-zinc-500 uppercase tracking-widest font-bold mb-0.5">Daily Net</span>
            <span className="text-xs font-bold font-mono text-emerald-500">{formatCurrency(dailyNet)}</span>
          </div>
        </div>
        
        <button onClick={onOpenRates} className={`flex items-center gap-2 px-3 py-2 text-xs font-bold transition-all border border-transparent rounded-xl ${
          theme === 'dark' 
            ? 'text-zinc-400 hover:text-zinc-100 hover:bg-[#0B0F17] hover:border-zinc-800' 
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 hover:border-slate-200'
        }`}>
          <Settings size={13} /> Rates
        </button>
        <button
          onClick={onOpenBook}
          className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-xl focus:ring-4 focus:ring-cyan-500/20 transition-all shadow-sm shadow-cyan-500/20"
        >
          <Plus size={14} /> Book Court
        </button>
      </div>
    </header>
  );
};

