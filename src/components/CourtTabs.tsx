import React from 'react';

interface CourtTabsProps {
  activeCourt: string;
  onCourtChange: (court: string) => void;
  theme: 'dark' | 'light';
}

const courts = [
  { id: 'basketball', name: 'Basketball Court', color: 'bg-[#00B8C8]' },
  { id: 'padel1', name: 'Padel Court 1', color: 'bg-emerald-500' },
  { id: 'padel2', name: 'Padel Court 2', color: 'bg-emerald-500' },
  { id: 'tennis', name: 'Tennis Court', color: 'bg-[#00B8C8]' },
];

export const CourtTabs: React.FC<CourtTabsProps> = ({ activeCourt, onCourtChange, theme }) => (
  <div className="flex gap-3 px-8 py-5">
    {courts.map((court) => (
      <button
        key={court.id}
        onClick={() => onCourtChange(court.id)}
        className={`flex items-center gap-2.5 px-5 py-2.5 text-sm font-bold rounded-xl transition-all border ${
          activeCourt === court.id 
            ? theme === 'dark' 
              ? 'bg-[#0B0F17] text-[#00B8C8] border-cyan-500/40 shadow-[0_0_20px_-5px_rgba(0,184,200,0.3)]' 
              : 'bg-white text-[#0099A8] border-cyan-500/50 shadow-sm'
            : theme === 'dark'
              ? 'bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#0B0F17]/60 border-transparent'
              : 'bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-transparent'
        }`}
      >
        <div className={`w-2 h-2 rounded-full ${court.color} ${activeCourt === court.id ? 'shadow-[0_0_8px_rgba(0,184,200,0.6)]' : 'opacity-70'}`}></div>
        {court.name}
      </button>
    ))}
  </div>
);

