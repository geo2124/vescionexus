import React, { useState } from 'react';
import { Repeat, Calendar, Plus, Play, Pause, AlertCircle } from 'lucide-react';

interface RecurringAccrualsProps {
  isDarkMode: boolean;
  formatCurrency: (val: number) => string;
}

export const RecurringAccruals: React.FC<RecurringAccrualsProps> = ({ isDarkMode, formatCurrency }) => {
  const [schedules] = useState([
    {
      id: 'acc-1',
      name: 'Yearly Office Rent Amortization',
      totalAmount: 12000,
      monthlyAmount: 1000,
      sourceAccount: 'prepaid_rent_asset',
      destinationAccount: 'rent_expense',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      status: 'active',
      nextPosting: '2024-05-01'
    },
    {
      id: 'acc-2',
      name: 'Annual Software Subscriptions',
      totalAmount: 3600,
      monthlyAmount: 300,
      sourceAccount: 'prepaid_software_asset',
      destinationAccount: 'software_expense',
      startDate: '2024-03-01',
      endDate: '2025-02-28',
      status: 'active',
      nextPosting: '2024-05-01'
    }
  ]);

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold font-sans tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
             Recurring Accruals & Prepayments
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Automatically schedule and post amortization journal entries month over month.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold transition-colors">
          <Plus size={16} /> New Schedule
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {schedules.map(schedule => (
          <div key={schedule.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
             <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                      <Repeat size={20} />
                   </div>
                   <div>
                     <h3 className="font-bold text-zinc-900 dark:text-zinc-100">{schedule.name}</h3>
                     <span className="text-xs text-zinc-500 font-mono">{schedule.sourceAccount} → {schedule.destinationAccount}</span>
                   </div>
                </div>
                <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${schedule.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-zinc-500'}`}>
                  {schedule.status}
                </div>
             </div>
             
             <div className="space-y-4 mb-4">
               <div>
                 <div className="text-xs text-zinc-500 mb-1">Total Amortization</div>
                 <div className="font-bold text-lg">{formatCurrency(schedule.totalAmount)}</div>
               </div>
               <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 pt-4">
                 <div>
                   <div className="text-xs text-zinc-500 mb-1">Monthly Posting</div>
                   <div className="font-mono text-sm text-rose-500">{formatCurrency(schedule.monthlyAmount)} / mo</div>
                 </div>
                 <div className="text-right">
                   <div className="text-xs text-zinc-500 mb-1 flex items-center justify-end gap-1"><Calendar size={12}/> Next Run</div>
                   <div className="font-mono text-sm">{schedule.nextPosting}</div>
                 </div>
               </div>
             </div>

             <div className="flex gap-2">
               <button className="flex-1 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5">
                  <Pause size={14} /> Suspend
               </button>
               <button className="flex-1 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-bold transition-colors">
                  Edit Schedule
               </button>
             </div>
          </div>
        ))}
      </div>

       <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-4">
          <AlertCircle className="text-blue-600 shrink-0 mt-0.5" size={20} />
          <div>
            <h4 className="font-bold text-blue-900 dark:text-blue-300">How Accruals Work</h4>
            <p className="text-sm text-blue-800 dark:text-blue-400 mt-1">
               When you create an accrual schedule, the system will automatically generate a draft Journal Voucher on the "Next Run" date every month. The accountant just needs to review and approve it to hit the General Ledger.
            </p>
          </div>
       </div>
    </div>
  );
};
