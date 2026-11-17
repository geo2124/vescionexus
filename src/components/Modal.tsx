import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  theme: 'dark' | 'light';
  maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, theme, maxWidth = 'max-w-md' }) => {
  if (!isOpen) return null;
  return (
    <div className={`fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-colors ${
      theme === 'dark' ? 'bg-[#05070A]/80' : 'bg-slate-900/40'
    }`}>
      <div className={`border rounded-2xl w-full ${maxWidth} flex flex-col max-h-[90vh] shadow-2xl ring-1 transition-all ${
        theme === 'dark' 
          ? 'bg-[#101622] border-zinc-800/80 text-zinc-100 shadow-black/60 ring-white/5' 
          : 'bg-white border-slate-200 text-slate-900 shadow-slate-400/20 ring-black/5'
      }`}>
        <div className="flex justify-between items-center p-6 sm:p-8 flex-none">
          <h2 className={`text-lg font-medium tracking-tight transition-colors ${
            theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'
          }`}>{title}</h2>
          <button onClick={onClose} className="el-btn-ghost !p-1.5">
            <X size={18} />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto px-6 sm:px-8 pb-6 sm:pb-8 ${
          theme === 'dark' ? 'text-zinc-100' : 'text-slate-900'
        }`}>
          {children}
        </div>
      </div>
    </div>
  );
};
