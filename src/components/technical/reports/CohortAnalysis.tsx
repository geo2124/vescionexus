import React from 'react';
import { Users, Activity } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface CohortAnalysisProps {
  isDarkMode: boolean;
  formatCurrency: (val: number) => string;
}

export const CohortAnalysis: React.FC<CohortAnalysisProps> = ({ isDarkMode, formatCurrency }) => {
  // Mock data for cohort retention
  const retentionData = [
    { month: 'M1', cohort1: 100, cohort2: 100, cohort3: 100 },
    { month: 'M2', cohort1: 85, cohort2: 88, cohort3: 82 },
    { month: 'M3', cohort1: 76, cohort2: 80, cohort3: 75 },
    { month: 'M4', cohort1: 70, cohort2: 74, cohort3: 68 },
    { month: 'M5', cohort1: 65, cohort2: 71, cohort3: 60 },
    { month: 'M6', cohort1: 60, cohort2: 68, cohort3: 55 },
  ];

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="mb-8">
        <h2 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'} mb-2`}>Cohort & Behavior Analysis</h2>
        <p className={`${isDarkMode ? 'text-zinc-500' : 'text-slate-500'} font-medium`}>Revenue per cohort, retention curves, and spending patterns.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className={`p-8 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
          <div className="flex items-center gap-4 mb-6">
            <div className={`p-3 rounded-2xl bg-blue-500/10 text-blue-500`}>
              <Users size={24} />
            </div>
            <h3 className={`text-sm font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>Retention Curves (%)</h3>
          </div>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={retentionData}>
                <XAxis dataKey="month" stroke={isDarkMode ? '#52525b' : '#94a3b8'} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={isDarkMode ? '#52525b' : '#94a3b8'} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: isDarkMode ? '#18181b' : '#ffffff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)' }}
                />
                <Area type="monotone" dataKey="cohort1" name="Jan Cohort" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                <Area type="monotone" dataKey="cohort2" name="Feb Cohort" stackId="2" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`p-8 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
             <div className="flex items-center gap-4 mb-6">
                <div className={`p-3 rounded-2xl bg-purple-500/10 text-purple-500`}>
                  <Activity size={24} />
                </div>
                <h3 className={`text-sm font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>Spending Patterns (LTV)</h3>
              </div>
              <div className="space-y-4">
                 {['Top 10% Spenders', 'Mid 40% Spenders', 'Bottom 50% Spenders'].map((tier, idx) => (
                    <div key={idx} className={`p-4 rounded-2xl ${isDarkMode ? 'bg-zinc-800/40' : 'bg-slate-50'}`}>
                       <div className="flex justify-between items-center mb-2">
                          <span className={`font-bold ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>{tier}</span>
                          <span className="font-mono font-black text-emerald-500">{formatCurrency(idx === 0 ? 1500 : idx === 1 ? 450 : 120)}</span>
                       </div>
                       <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-full bg-emerald-500 rounded-full`} style={{ width: idx === 0 ? '100%' : idx === 1 ? '40%' : '15%' }} />
                       </div>
                    </div>
                 ))}
              </div>
        </div>
      </div>

      <div className={`overflow-hidden rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
         <table className="w-full text-sm text-left border-collapse">
            <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-950/80 border-b border-zinc-800' : 'text-slate-500 bg-slate-50 border-b border-slate-200'}`}>
              <tr>
                 <th className="p-4">Cohort Month</th>
                 <th className="p-4">Users Acquired</th>
                 <th className="p-4 text-right">M1 Revenue</th>
                 <th className="p-4 text-right">M3 Revenue</th>
                 <th className="p-4 text-right">M6 Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono text-xs">
              {['2023-10', '2023-11', '2023-12', '2024-01', '2024-02'].map((month, idx) => (
                <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20">
                  <td className="p-4 font-black">{month}</td>
                  <td className="p-4 text-zinc-500">{120 + idx * 15}</td>
                  <td className="p-4 text-right text-emerald-500 font-black">{formatCurrency(15000 + idx * 2000)}</td>
                  <td className="p-4 text-right text-emerald-500">{formatCurrency(12000 + idx * 1800)}</td>
                  <td className="p-4 text-right text-emerald-500">{idx < 3 ? formatCurrency(8000 + idx * 1200) : 'TBD'}</td>
                </tr>
              ))}
            </tbody>
         </table>
      </div>
    </div>
  );
};
