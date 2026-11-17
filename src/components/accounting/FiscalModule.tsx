import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { Plus, Edit2, Trash2, Percent } from 'lucide-react';
import { toast } from 'sonner';

export const FiscalModule: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => {
  const { user, handleFirestoreError } = useFirebase();
  const [rules, setRules] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    customerType: 'B2B',
    taxRate: '11',
    description: ''
  });

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'fiscalRules'), snap => {
      setRules(snap.docs.map(d => ({id: d.id, ...d.data()})));
    }, err => handleFirestoreError(err, OperationType.LIST, 'fiscalRules'));
    return () => unsub();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateDoc(doc(db, 'fiscalRules', editingId), formData);
        toast.success('Fiscal rule updated');
      } else {
        await addDoc(collection(db, 'fiscalRules'), formData);
        toast.success('Fiscal rule created');
      }
      setIsAdding(false);
      setEditingId(null);
      setFormData({ name: '', customerType: 'B2B', taxRate: '11', description: '' });
    } catch (err) {
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'fiscalRules');
    }
  };

  const handleEdit = (rule: any) => {
    setFormData({
      name: rule.name,
      customerType: rule.customerType,
      taxRate: rule.taxRate,
      description: rule.description
    });
    setEditingId(rule.id);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this fiscal rule?')) return;
    try {
      await deleteDoc(doc(db, 'fiscalRules', id));
      toast.success('Fiscal rule removed');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'fiscalRules');
    }
  };

  return (
    <div className="bg-white dark:bg-[#0B0F17] p-6 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
           <Percent className="text-[#00B8C8]" />
           <h2 className="text-xl font-bold">Fiscal Positions & Tax Rules</h2>
        </div>
        <button 
          onClick={() => { setIsAdding(!isAdding); setEditingId(null); setFormData({name:'',customerType:'B2B',taxRate:'11',description:''}); }}
          className="px-4 py-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors"
        >
          {isAdding ? 'Cancel' : <><Plus size={16} /> New Rule</>}
        </button>
      </div>

      {isAdding && (
         <form onSubmit={handleSubmit} className="mb-8 p-6 border border-slate-200 dark:border-zinc-800 rounded-xl bg-slate-50 dark:bg-zinc-900/40">
           <h3 className="text-sm font-bold mb-4 uppercase text-zinc-500 tracking-widest">{editingId ? 'Edit Fiscal Rule' : 'Create Fiscal Rule'}</h3>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
             <div>
               <label className="block text-sm font-medium mb-1">Rule Name</label>
               <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] outline-none" placeholder="e.g. VAT Exempt Export" />
             </div>
             <div>
               <label className="block text-sm font-medium mb-1">Customer Type</label>
               <select value={formData.customerType} onChange={e => setFormData({...formData, customerType: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] outline-none">
                 <option value="B2B">B2B (Business)</option>
                 <option value="B2C">B2C (Consumer)</option>
                 <option value="Export">Export</option>
                 <option value="Government">Government</option>
               </select>
             </div>
             <div>
               <label className="block text-sm font-medium mb-1">Tax Rate (%)</label>
               <input required type="number" step="0.01" value={formData.taxRate} onChange={e => setFormData({...formData, taxRate: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] outline-none" placeholder="11.00" />
             </div>
             <div className="md:col-span-3">
                <label className="block text-sm font-medium mb-1">Description / Mapping Logic</label>
                <input required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:border-[#00B8C8] outline-none" placeholder="Describe when this rule applies..." />
             </div>
           </div>
           <div className="flex justify-end">
             <button type="submit" className="px-6 py-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg text-sm font-bold transition-colors">{editingId ? 'Update Rule' : 'Save Rule'}</button>
           </div>
         </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 dark:border-zinc-800">
              <th className="pb-3 text-[10px] uppercase font-black tracking-widest text-zinc-500">Rule Name</th>
              <th className="pb-3 text-[10px] uppercase font-black tracking-widest text-zinc-500">Customer Type</th>
              <th className="pb-3 text-[10px] uppercase font-black tracking-widest text-zinc-500">Tax Rate</th>
              <th className="pb-3 text-[10px] uppercase font-black tracking-widest text-zinc-500">Description</th>
              <th className="pb-3 text-[10px] uppercase font-black tracking-widest text-zinc-500 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm">
             {rules.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-zinc-500">No fiscal rules defined.</td></tr>
             )}
             {rules.map(rule => (
                <tr key={rule.id} className="border-b border-slate-100 dark:border-zinc-800/50 hover:bg-slate-50 dark:hover:bg-zinc-800/20">
                  <td className="py-4 font-bold">{rule.name}</td>
                  <td className="py-4"><span className="px-2 py-1 bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-medium text-xs rounded-lg">{rule.customerType}</span></td>
                  <td className="py-4 font-mono font-bold text-[#0099A8] dark:text-[#00B8C8]">{rule.taxRate}%</td>
                  <td className="py-4 text-zinc-500 text-xs">{rule.description}</td>
                  <td className="py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                       <button onClick={() => handleEdit(rule)} className="p-1.5 text-[#00B8C8] hover:bg-[#00B8C8]/10 rounded"><Edit2 size={16} /></button>
                       <button onClick={() => handleDelete(rule.id)} className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
             ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
