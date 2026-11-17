import React from 'react';

import { Sun, Moon } from 'lucide-react';

interface ThemeToggleProps {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

export function ThemeToggle({ isDarkMode, toggleDarkMode }: ThemeToggleProps) {
  return (
    <button 
      onClick={toggleDarkMode}
      className={`h-9 w-9 inline-flex items-center justify-center rounded-lg border transition-colors ${
        isDarkMode 
          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-400 hover:border-[#00B8C8]/50 hover:text-[#00B8C8]' 
          : 'bg-white border-slate-200 text-slate-600 hover:border-[#00B8C8]/60 hover:text-[#0099A8]'
      }`}
      title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
