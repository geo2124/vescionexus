import React, { useMemo, useState } from 'react';
import { DollarSign, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

interface BudgetVarianceProps {
  isDarkMode: boolean;
  formatCurrency: (val: number) => string;
  transactions: any[];
}

export const BudgetVariance: React.FC<BudgetVarianceProps> = ({ isDarkMode, formatCurrency, transactions }) => {
  // In a real app these targets would come from a Firestore collection like "budgets"
  const defaultBudgets: Record<string, number> = {
    'marketing_expense': 5000,
    'payroll_expense': 25000,
    'utilities_expense': 3000,
    'inventory_cogs': 15000,
    'office_supplies': 1000,
  };

  const [budgets, setBudgets] = useState<Record<string, number>>(defaultBudgets);

  const varianceData = useMemo(() => {
    const expenses: Record<string, number> = {};
    
    // Calculate actuals
    transactions.forEach(t => {
      // Look for outgoing expense transactions
      if (t.destinationAccount && t.destinationAccount.includes('expense')) {
        expenses[t.destinationAccount] = (expenses[t.destinationAccount] || 0) + (t.amount || 0);
      }
      if (t.sourceAccount && t.sourceAccount.includes('expense')) {
        // Refund or reduction in expense
        expenses[t.sourceAccount] = (expenses[t.sourceAccount] || 0) - (t.amount || 0);
      }
    });

    // Merge with budgets
    const allKeys = Array.from(new Set([...Object.keys(budgets), ...Object.keys(expenses)]));
    
    return allKeys.map(key => {
      const actual = expenses[key] || 0;
      const budget = budgets[key] || 0;
      const variance = actual - budget;
      const variancePercent = budget > 0 ? (variance / budget) * 100 : (actual > 0 ? 100 : 0);
      
      return {
        account: key.replace(/_/g, ' ').toUpperCase(),
        actual,
        budget,
        variance,
        variancePercent,
        status: variance > 0 ? 'over' : 'under'
      };
    }).sort((a,b) => b.actual - a.actual);
  }, [transactions, budgets]);

  const updateBudget = (key: string, value: string) => {
    const num = parseFloat(value) || 0;
    setBudgets(prev => ({ ...prev, [key.toLowerCase().replace(/ /g, '_')]: num }));
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold font-sans tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
             Budget vs Actuals (Variance Analysis)
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Real-time expenditure tracking against operational targets</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-6 uppercase tracking-wider">Variance Overview</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={varianceData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <XAxis dataKey="account" stroke={isDarkMode ? '#52525b' : '#a1a1aa'} fontSize={10} tickFormatter={(val) => val.split(' ')[0]} />
                <YAxis stroke={isDarkMode ? '#52525b' : '#a1a1aa'} fontSize={10} tickFormatter={(val) => `$${val/1000}k`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: isDarkMode ? '#18181b' : '#ffffff', borderColor: isDarkMode ? '#27272a' : '#e4e4e7', borderRadius: '8px' }}
                  itemStyle={{ fontSize: '12px' }}
                />
                <ReferenceLine y={0} stroke={isDarkMode ? '#3f3f46' : '#d4d4d8'} />
                <Bar dataKey="variance" radius={[4, 4, 0, 0]}>
                  {varianceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.status === 'over' ? (isDarkMode ? '#ef4444' : '#dc2626') : (isDarkMode ? '#10b981' : '#059669')} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm flex flex-col justify-center">
            <div className="flex flex-col gap-4">
                <div className="p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                    <div className="flex items-center gap-2 mb-2">
                        <TrendingDown size={16} className="text-emerald-500" />
                        <h4 className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Total Under Budget</h4>
                    </div>
                    <p className="text-2xl font-black text-emerald-600 dark:text-emerald-500">
                        {formatCurrency(Math.abs(varianceData.filter(d => d.variance < 0).reduce((a,b) => a + b.variance, 0)))}
                    </p>
                </div>
                <div className="p-4 bg-rose-500/10 rounded-lg border border-rose-500/20">
                    <div className="flex items-center gap-2 mb-2">
                        <TrendingUp size={16} className="text-rose-500" />
                        <h4 className="text-sm font-bold text-rose-700 dark:text-rose-400">Total Over Budget</h4>
                    </div>
                    <p className="text-2xl font-black text-rose-600 dark:text-rose-500">
                        {formatCurrency(varianceData.filter(d => d.variance > 0).reduce((a,b) => a + b.variance, 0))}
                    </p>
                </div>
            </div>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden">
         <table className="w-full text-left text-sm">
            <thead className={`text-xs uppercase text-zinc-500 dark:text-zinc-400 font-bold bg-slate-50 dark:bg-zinc-950/50 border-b border-zinc-200 dark:border-zinc-800`}>
              <tr>
                <th className="p-4">Expense Account</th>
                <th className="p-4 text-right">Target Budget</th>
                <th className="p-4 text-right">Actual YTD</th>
                <th className="p-4 text-right">Variance</th>
                <th className="p-4 text-right">Warning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono text-xs">
              {varianceData.map((row, idx) => (
                <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-colors">
                  <td className="p-4 font-bold text-zinc-900 dark:text-zinc-100 font-sans">{row.account}</td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                        <span className="text-zinc-400">$</span>
                        <input 
                            type="number" 
                            className="bg-transparent text-right w-24 border-b border-dashed border-zinc-300 dark:border-zinc-700 flex-1 min-w-[80px]"
                            value={row.budget || ''}
                            onChange={(e) => updateBudget(row.account, e.target.value)}
                        />
                    </div>
                  </td>
                  <td className="p-4 text-right text-zinc-900 dark:text-zinc-100">{formatCurrency(row.actual)}</td>
                  <td className={`p-4 text-right font-black ${row.status === 'over' ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {row.variance > 0 ? '+' : ''}{formatCurrency(row.variance)}
                  </td>
                  <td className="p-4 text-right">
                      {row.status === 'over' ? (
                          <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-md text-[10px] font-bold uppercase tracking-wider">
                              <AlertTriangle size={12} /> {row.variancePercent.toFixed(0)}% Over
                          </div>
                      ) : (
                          <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md text-[10px] font-bold uppercase tracking-wider">
                              Healthy
                          </div>
                      )}
                  </td>
                </tr>
              ))}
              {varianceData.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-zinc-400 italic font-medium"> No operational expenses matching established budget targets.</td>
                </tr>
              )}
            </tbody>
         </table>
      </div>
    </div>
  );
};
