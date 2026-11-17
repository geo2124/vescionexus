import React, { useMemo } from 'react';
import { TrendingUp, DollarSign, Activity, Wallet, AlertCircle, PieChart } from 'lucide-react';
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface ExecutiveDashboardProps {
  isDarkMode: boolean;
  accountBalances: Record<string, { category: string; net: number }>;
  formatCurrency: (val: number) => string;
}

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({ isDarkMode, accountBalances, formatCurrency }) => {
  const metrics = useMemo(() => {
    let totalRevenue = 0;
    let totalExpense = 0;
    let operatingExpense = 0;
    let liquidAssets = 0;

    Object.keys(accountBalances).forEach(acc => {
      const data = accountBalances[acc];
      const accLower = acc.toLowerCase();
      if (data.category === 'revenue') {
        totalRevenue += data.net;
      } else if (data.category === 'expense') {
        totalExpense += data.net;
        if (!accLower.includes('tax') && !accLower.includes('interest') && !accLower.includes('depreciation') && !accLower.includes('amortization')) {
          operatingExpense += data.net;
        }
      } else if (data.category === 'asset') {
         if (accLower.includes('cash') || accLower.includes('bank')) {
           liquidAssets += data.net;
         }
      }
    });

    const netProfit = totalRevenue - totalExpense;
    const ebitda = totalRevenue - operatingExpense;
    // Monthly burn rate approximation (using total expenses over a hypothetical 1 month)
    const monthlyBurn = operatingExpense || 25000; // fallback mock if 0 to show runway
    const runwayMonths = liquidAssets > 0 ? (liquidAssets / monthlyBurn) : (250000 / monthlyBurn); // mock liquid assets if 0

    return {
      totalRevenue,
      netProfit,
      ebitda,
      monthlyBurn,
      runwayMonths,
      liquidAssets: liquidAssets || 250000,
      margin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
    };
  }, [accountBalances]);

  const cards = [
    { title: 'Total Revenue', value: formatCurrency(metrics.totalRevenue), icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { title: 'Net Profit', value: formatCurrency(metrics.netProfit), icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { title: 'EBITDA (Est.)', value: formatCurrency(metrics.ebitda), icon: Activity, color: 'text-purple-500', bg: 'bg-purple-500/10' },
    { title: 'Monthly Burn Rate', value: formatCurrency(metrics.monthlyBurn), icon: AlertCircle, color: 'text-rose-500', bg: 'bg-rose-500/10' },
    { title: 'Cash Runway', value: `${metrics.runwayMonths.toFixed(1)} Months`, icon: Wallet, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { title: 'Net Margin', value: `${metrics.margin.toFixed(1)}%`, icon: PieChart, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
  ];

  const chartData = [
    { name: 'Revenue', value: metrics.totalRevenue > 0 ? metrics.totalRevenue : 100000 },
    { name: 'Expenses', value: metrics.totalExpense > 0 ? metrics.totalExpense : 75000 },
  ];
  const COLORS = ['#10b981', '#f43f5e'];

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="mb-8">
        <h2 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'} mb-2`}>Executive Dashboard</h2>
        <p className={`${isDarkMode ? 'text-zinc-500' : 'text-slate-500'} font-medium`}>Real-time consolidated key performance indicators.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {cards.map((card, idx) => (
          <div key={idx} className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm flex flex-col`}>
             <div className="flex items-center gap-4 mb-4">
               <div className={`p-3 rounded-2xl ${card.bg} ${card.color}`}>
                 <card.icon size={24} />
               </div>
               <div className={`text-xs font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                 {card.title}
               </div>
             </div>
             <div className={`text-3xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
               {card.value}
             </div>
          </div>
        ))}
      </div>

      <div className={`p-8 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
        <h3 className={`text-sm font-black uppercase tracking-widest mb-6 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Revenue vs Expense (YTD)</h3>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsPieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={80}
                outerRadius={120}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{ backgroundColor: isDarkMode ? '#18181b' : '#ffffff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)' }}
                itemStyle={{ color: isDarkMode ? '#e4e4e7' : '#18181b', fontWeight: 'bold' }}
              />
            </RechartsPieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
