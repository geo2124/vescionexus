import React, { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useFirebase } from '../../../contexts/FirebaseContext';
import { OperationType } from '../../../types';

export const OperationalFinance: React.FC<{
  isDarkMode: boolean;
  formatCurrency: (v: number) => string;
  specificType: string;
  transactions?: any[];
}> = ({ isDarkMode, formatCurrency, specificType, transactions = [] }) => {
  const { user, handleFirestoreError, taxRules, currency } = useFirebase();
  const [bookings, setBookings] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsubB = onSnapshot(collection(db, 'bookings'), snap => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'bookings'));

    const unsubE = onSnapshot(collection(db, 'expenses'), snap => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'expenses'));

    return () => {
      unsubB();
      unsubE();
    };
  }, [user]);

  const { title, desc, chartData } = useMemo(() => {
    if (specificType === 'revenue_breakdown') {
      const modTotals: Record<string, number> = {
        'Gym Memberships (7061)': 0,
        'Court Reservations (7062)': 0,
        'Court Individual Access (70621)': 0,
        'Physiotherapy (7063)': 0,
        'Kiosk POS (701)': 0,
        'Retail Shop POS (702)': 0,
      };
      transactions.forEach(t => {
        if (t.direction === 'outflow' || t.isReversal) return;
        const amt = Number(t.amount || 0);
        if (amt <= 0) return;
        const mod = t.sourceModule || '';
        const dest = String(t.destinationAccount || '');
        if (mod === 'gym') modTotals['Gym Memberships (7061)'] += amt;
        else if (dest.startsWith('70621') || t.bookingSubType === 'individual_access' || t.category === 'Court Individual Access') {
          modTotals['Court Individual Access (70621)'] += amt;
        } else if (mod === 'reservation' || mod === 'reservations' || mod === 'court') {
          modTotals['Court Reservations (7062)'] += amt;
        } else if (mod === 'physio') modTotals['Physiotherapy (7063)'] += amt;
        else if (mod === 'pos_cafe' || mod === 'pos_cafeteria') modTotals['Kiosk POS (701)'] += amt;
        else if (mod === 'pos_retail') modTotals['Retail Shop POS (702)'] += amt;
      });
      return {
        title: 'Revenue Breakdown by Operational Module (LCOA Class 7)',
        desc: 'Live revenue segmentation across Gym, Standard Court Rentals (7062), Court Individual Access (70621), Physiotherapy, Kiosk POS, and Retail Shop POS.',
        chartData: Object.entries(modTotals).map(([name, value]) => ({ name, value }))
      };
    }

    if (specificType === 'pos_finance') {
      let kioskSales = 0;
      let retailSales = 0;
      let posCogs = 0;
      transactions.forEach(t => {
        const amt = Number(t.amount || 0);
        if (t.transactionType === 'inventory_cogs_movement') {
          posCogs += amt;
        } else if (t.direction === 'inflow' && !t.isReversal) {
          if (t.sourceModule === 'pos_cafe' || t.sourceModule === 'pos_cafeteria') kioskSales += amt;
          else if (t.sourceModule === 'pos_retail') retailSales += amt;
        }
      });
      const grossProfit = Math.max(0, (kioskSales + retailSales) - posCogs);
      return {
        title: 'Kiosk POS & Retail Shop POS Gross Margins',
        desc: 'Live sales breakdown vs Cost of Goods Sold (COGS - LCOA 601) and Gross Margin.',
        chartData: [
          { name: 'Kiosk POS Sales (701)', value: kioskSales },
          { name: 'Retail Shop Sales (702)', value: retailSales },
          { name: 'Cost of Goods Sold (601)', value: posCogs },
          { name: 'Net POS Gross Margin', value: grossProfit }
        ]
      };
    }

    if (specificType === 'facility_finance') {
      const courtTotals: Record<string, number> = {
        'Basketball Standard Rental (7062)': 0,
        'Individual Access - Half Court (70621)': 0,
        'Individual Access - Full Court (70621)': 0,
        'Padel Courts (7062)': 0,
        'Tennis Court (7062)': 0,
        'Private & Hustle Sessions': 0
      };
      bookings
        .filter(b => b.status === 'cashed_in' || b.status === 'booked')
        .forEach(b => {
          const val = Number(b.rateApplied ?? b.price ?? 0) / 4;
          const isInd = Boolean(b.isIndividualAccess || b.bookingSubType === 'individual_access');
          if (b.category === 'academy') return;
          if (isInd) {
            const scope = b.individualAccessScope || ((b.type === 'HCA' || b.type === 'HCB') ? 'Half Court' : 'Full Court');
            if (scope === 'Half Court') courtTotals['Individual Access - Half Court (70621)'] += val;
            else courtTotals['Individual Access - Full Court (70621)'] += val;
          } else if (b.category === 'private' || b.category === 'hustle') {
            courtTotals['Private & Hustle Sessions'] += val;
          } else if ((b.court || 'basketball') === 'basketball') {
            courtTotals['Basketball Standard Rental (7062)'] += val;
          } else if (b.court === 'padel' || b.court === 'padel1' || b.court === 'padel2') {
            courtTotals['Padel Courts (7062)'] += val;
          } else if (b.court === 'tennis') {
            courtTotals['Tennis Court (7062)'] += val;
          }
        });
      return {
        title: 'Facility & Court Reservations Yield (LCOA 7062 & 70621)',
        desc: 'Independent revenue segmentation across Standard Hourly Rentals, Walk-In Individual Access (Half vs. Full Court), Private, and Hustle Sessions.',
        chartData: Object.entries(courtTotals).map(([name, value]) => ({ name, value }))
      };
    }

    // Default: vat_report
    const activeRule = taxRules[currency] || { rate: 11, enabled: true };
    const vatRate = (activeRule.rate || 11) / 100;
    let totalInflows = 0;
    let explicitOutputVat = 0;
    transactions.forEach(t => {
      if (t.direction === 'inflow' && !t.isReversal) {
        totalInflows += Number(t.amount || 0);
        if (t.vatAmount) explicitOutputVat += Number(t.vatAmount);
      }
    });
    const outputVat = explicitOutputVat > 0 ? explicitOutputVat : totalInflows * vatRate;
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const inputVat = totalExpenses * vatRate;
    const netVatPayable = Math.max(0, outputVat - inputVat);

    return {
      title: 'Lebanese VAT (TVA) Compliance Report (LCOA 442 vs 443)',
      desc: `Output VAT Collected (442) vs Input VAT Deductible (443) computed at ${activeRule.rate || 11}%.`,
      chartData: [
        { name: 'Output VAT (442 - Sales)', value: outputVat },
        { name: 'Input VAT (443 - Expenses)', value: inputVat },
        { name: 'Net VAT Payable to MOF', value: netVatPayable }
      ]
    };
  }, [specificType, transactions, bookings, expenses, taxRules, currency]);

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#f43f5e'];
  const totalSum = chartData.reduce((acc, curr) => acc + curr.value, 0);

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="mb-8">
        <h2 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'} mb-2`}>{title}</h2>
        <p className={`${isDarkMode ? 'text-zinc-500' : 'text-slate-500'} font-medium`}>{desc}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm h-64 flex flex-col justify-center`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip formatter={(val: number) => formatCurrency(val)} contentStyle={{ backgroundColor: isDarkMode ? '#18181b' : '#ffffff', borderRadius: '8px', border: 'none', fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm h-64 flex flex-col justify-center`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
              <XAxis dataKey="name" stroke={isDarkMode ? '#52525b' : '#94a3b8'} fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke={isDarkMode ? '#52525b' : '#94a3b8'} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
              <RechartsTooltip formatter={(val: number) => formatCurrency(val)} contentStyle={{ backgroundColor: isDarkMode ? '#18181b' : '#ffffff', borderRadius: '8px', border: 'none', fontSize: '12px' }} cursor={{ fill: isDarkMode ? '#27272a' : '#f1f5f9' }} />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30}>
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`mt-8 overflow-hidden rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
        <table className="w-full text-sm text-left border-collapse">
          <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-950/80 border-b border-zinc-800' : 'text-slate-500 bg-slate-50 border-b border-slate-200'}`}>
            <tr>
              <th className="p-4">Category / LCOA Line</th>
              <th className="p-4 text-right">Amount</th>
              <th className="p-4 text-right">% Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
            {chartData.map((row, idx) => {
              const percent = totalSum > 0 ? ((row.value / totalSum) * 100).toFixed(1) : '0.0';
              return (
                <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20">
                  <td className="p-4 font-bold text-zinc-900 dark:text-zinc-100">{row.name}</td>
                  <td className="p-4 text-right text-zinc-500 font-mono">{formatCurrency(row.value)}</td>
                  <td className="p-4 text-right text-zinc-500 font-mono">{percent}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
