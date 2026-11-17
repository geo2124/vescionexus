import React, { useState, useEffect, useMemo } from 'react';
import { Package } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useFirebase } from '../../../contexts/FirebaseContext';
import { OperationType } from '../../../types';

export const InventoryLedger: React.FC<{ isDarkMode: boolean; formatCurrency: (v: number) => string }> = ({ isDarkMode, formatCurrency }) => {
  const { user, handleFirestoreError } = useFirebase();
  const [items, setItems] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'cafeteria' | 'retail'>('all');

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'inventory'), snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'inventory'));
    return () => unsub();
  }, [user]);

  const data = useMemo(() => {
    return items
      .filter(i => filterType === 'all' || (i.type || 'retail') === filterType)
      .map(i => {
        const stock = Number(i.stock ?? i.quantity ?? 0);
        const unitCost = Number(i.cost ?? i.price ?? 0);
        const unitPrice = Number(i.price ?? 0);
        return {
          id: i.id,
          sku: i.sku || i.barcode || i.id.slice(0, 8).toUpperCase(),
          item: i.name || 'Unnamed Item',
          type: (i.type || 'retail') === 'cafeteria' ? 'Kiosk POS (301)' : 'Retail Shop POS (302)',
          stock,
          unitCost,
          unitPrice,
          value: stock * unitCost,
          retailValue: stock * unitPrice
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [items, filterType]);

  const totalCostValuation = data.reduce((a, b) => a + b.value, 0);
  const totalRetailValuation = data.reduce((a, b) => a + b.retailValue, 0);

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h2 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'} mb-1`}>
            Inventory Ledger Valuation (LCOA Class 3: 301 & 302)
          </h2>
          <p className={`${isDarkMode ? 'text-zinc-500' : 'text-slate-500'} text-sm font-medium`}>
            Live stock on hand, unit cost basis, and total inventory valuation from Firestore.
          </p>
        </div>
        <div className="flex gap-1.5">
          {[
            { id: 'all', label: 'All Inventory' },
            { id: 'cafeteria', label: 'Kiosk POS (301)' },
            { id: 'retail', label: 'Retail Shop POS (302)' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                filterType === tab.id
                  ? 'bg-blue-600 text-white'
                  : isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm flex flex-col justify-between md:col-span-1`}>
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-blue-500/10 text-blue-500 rounded-2xl">
                <Package size={24} />
              </div>
              <div className={`text-xs font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                Total Cost Valuation
              </div>
            </div>
            <div className={`text-3xl font-black tracking-tight font-mono ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
              {formatCurrency(totalCostValuation)}
            </div>
          </div>
          <div className="pt-4 mt-4 border-t dark:border-zinc-800 flex justify-between items-center text-xs">
            <span className="text-zinc-500 font-bold uppercase">Est. Retail Value:</span>
            <span className="font-mono font-bold text-emerald-500">{formatCurrency(totalRetailValuation)}</span>
          </div>
        </div>
        <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm md:col-span-2 h-48`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="item" type="category" stroke={isDarkMode ? '#52525b' : '#94a3b8'} fontSize={10} tickLine={false} axisLine={false} width={110} />
              <Tooltip
                formatter={(val: number) => formatCurrency(val)}
                contentStyle={{ backgroundColor: isDarkMode ? '#18181b' : '#ffffff', borderRadius: '8px', border: 'none', fontSize: '12px' }}
              />
              <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`overflow-hidden rounded-3xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
        <table className="w-full text-sm text-left border-collapse">
          <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-950/80 border-b border-zinc-800' : 'text-slate-500 bg-slate-50 border-b border-slate-200'}`}>
            <tr>
              <th className="p-4">SKU / Code</th>
              <th className="p-4">Item Name</th>
              <th className="p-4">Sub-Ledger</th>
              <th className="p-4 text-right">Units in Stock</th>
              <th className="p-4 text-right">Unit Cost</th>
              <th className="p-4 text-right">Ledger Cost Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono text-xs">
            {data.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-12 text-center text-zinc-500 font-sans italic">No inventory items found in Firestore.</td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20">
                  <td className="p-4 text-zinc-400">{row.sku}</td>
                  <td className="p-4 font-bold text-zinc-900 dark:text-zinc-100 font-sans">{row.item}</td>
                  <td className="p-4 font-sans text-xs text-zinc-500">{row.type}</td>
                  <td className="p-4 text-right text-zinc-500">{row.stock}</td>
                  <td className="p-4 text-right text-zinc-500">{formatCurrency(row.unitCost)}</td>
                  <td className="p-4 text-right font-black text-zinc-900 dark:text-zinc-100">{formatCurrency(row.value)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
