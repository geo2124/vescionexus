import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { InventoryItem, OperationType } from '../../types';
import { Package, Plus, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  isDarkMode: boolean;
  formatCurrency: (amount: number) => string;
}

const KIOSK_CATEGORIES = ['Beverages', 'Snacks', 'Grocery', 'Protein Bars', 'Coffee & Hot Drinks', 'Dairy & Fresh'];
const RETAIL_CATEGORIES = ['Merchandise', 'Supplements', 'Medical Supplies', 'Equipment', 'Apparel'];

export const InventoryModule: React.FC<Props> = ({ isDarkMode, formatCurrency }) => {
  const { user, handleFirestoreError } = useFirebase();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [posFilter, setPosFilter] = useState<'all' | 'cafeteria' | 'retail'>('all');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    nameAr: '',
    sku: '',
    category: 'Beverages',
    categoryAr: '',
    subcategory: '',
    subcategoryAr: '',
    type: 'cafeteria' as 'cafeteria' | 'retail',
    stock: '0',
    costPrice: '0',
    price: '0',
    lowStockThreshold: '5',
    reorderQuantity: '20',
    supplier: '',
    expiryDate: ''
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'inventory'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => {
        const raw = d.data() as any;
        const resolvedType: 'cafeteria' | 'retail' =
          raw.type === 'retail' || raw.posType === 'retail' ? 'retail' : 'cafeteria';
        return {
          id: d.id,
          ...raw,
          name: raw.name || 'Unnamed Item',
          nameAr: raw.nameAr || '',
          sku: raw.sku || raw.barcode || '',
          barcode: raw.barcode || raw.sku || '',
          category: raw.category || (resolvedType === 'cafeteria' ? 'Grocery' : 'Merchandise'),
          categoryAr: raw.categoryAr || '',
          subcategory: raw.subcategory || '',
          subcategoryAr: raw.subcategoryAr || '',
          price: Number(raw.price ?? raw.unitCost ?? 0),
          cost: Number(raw.costPrice ?? raw.cost ?? raw.unitCost ?? 0),
          costPrice: Number(raw.costPrice ?? raw.cost ?? raw.unitCost ?? 0),
          stock: Number(raw.stock ?? raw.quantity ?? 0),
          lowStockThreshold: Number(raw.lowStockThreshold ?? 5),
          reorderQuantity: Number(raw.reorderQuantity ?? 20),
          supplier: raw.supplier || '',
          expiryDate: raw.expiryDate || '',
          variants: Array.isArray(raw.variants) ? raw.variants : [],
          isBundle: Boolean(raw.isBundle),
          bundleComponents: Array.isArray(raw.bundleComponents) ? raw.bundleComponents : [],
          type: resolvedType,
          posType: resolvedType,
          uid: raw.uid || user.uid,
          updatedAt: raw.updatedAt || ''
        } as InventoryItem;
      });
      setInventory(docs);
    }, error => handleFirestoreError(error, OperationType.LIST, 'inventory'));
    return () => unsub();
  }, [user]);

  const resetForm = () => {
    setFormData({
      name: '',
      nameAr: '',
      sku: '',
      category: 'Beverages',
      categoryAr: '',
      subcategory: '',
      subcategoryAr: '',
      type: posFilter === 'retail' ? 'retail' : 'cafeteria',
      stock: '0',
      costPrice: '0',
      price: '0',
      lowStockThreshold: '5',
      reorderQuantity: '20',
      supplier: '',
      expiryDate: ''
    });
    setEditingId(null);
    setIsAdding(false);
  };

  const handleEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      nameAr: item.nameAr || '',
      sku: item.sku || item.barcode || '',
      category: item.category || (item.type === 'cafeteria' ? 'Beverages' : 'Merchandise'),
      categoryAr: item.categoryAr || '',
      subcategory: item.subcategory || '',
      subcategoryAr: item.subcategoryAr || '',
      type: item.type || item.posType || 'cafeteria',
      stock: String(item.stock ?? 0),
      costPrice: String(item.costPrice ?? item.cost ?? 0),
      price: String(item.price ?? 0),
      lowStockThreshold: String(item.lowStockThreshold ?? 5),
      reorderQuantity: String(item.reorderQuantity ?? 20),
      supplier: item.supplier || '',
      expiryDate: item.expiryDate || ''
    });
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'inventory', id));
      setDeleteConfirmId(null);
      toast.success('Inventory item deleted.');
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `inventory/${id}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const stockVal = Math.max(0, parseInt(formData.stock, 10) || 0);
    const costVal = Math.max(0, parseFloat(formData.costPrice) || 0);
    const priceVal = Math.max(0, parseFloat(formData.price) || 0);
    const lowStockVal = Math.max(0, parseInt(formData.lowStockThreshold, 10) || 5);
    const reorderVal = Math.max(1, parseInt(formData.reorderQuantity, 10) || 20);
    const skuTrimmed = formData.sku.trim();

    const existingItem = editingId ? inventory.find(i => i.id === editingId) : null;
    const preservedVariants = existingItem?.variants || [];
    const computedStock = preservedVariants.length > 0
      ? preservedVariants.reduce((s, v) => s + Number(v.stock || 0), 0)
      : stockVal;

    const payload: Record<string, any> = {
      name: formData.name.trim(),
      nameAr: formData.nameAr.trim() || existingItem?.nameAr || '',
      sku: skuTrimmed,
      barcode: skuTrimmed,
      category: formData.category.trim() || (formData.type === 'cafeteria' ? 'Grocery' : 'Merchandise'),
      categoryAr: formData.categoryAr.trim() || existingItem?.categoryAr || '',
      subcategory: formData.subcategory.trim() || existingItem?.subcategory || '',
      subcategoryAr: formData.subcategoryAr.trim() || existingItem?.subcategoryAr || '',
      type: formData.type,
      posType: formData.type,
      stock: editingId && stockVal !== existingItem?.stock ? stockVal : computedStock,
      cost: costVal,
      costPrice: costVal,
      price: priceVal,
      lowStockThreshold: lowStockVal,
      reorderQuantity: reorderVal,
      supplier: formData.supplier.trim(),
      expiryDate: formData.expiryDate || '',
      variants: preservedVariants,
      isBundle: Boolean(existingItem?.isBundle),
      bundleComponents: existingItem?.bundleComponents || [],
      uid: user.uid,
      updatedAt: new Date().toISOString()
    };

    try {
      if (editingId) {
        await updateDoc(doc(db, 'inventory', editingId), payload);
        toast.success('Inventory item updated and synced with POS.');
      } else {
        await addDoc(collection(db, 'inventory'), {
          ...payload,
          createdAt: new Date().toISOString()
        });
        toast.success('Inventory item created and synced with POS.');
      }
      resetForm();
    } catch (e) {
      handleFirestoreError(e, editingId ? OperationType.UPDATE : OperationType.CREATE, 'inventory');
    }
  };

  const filteredInventory = inventory.filter(item => {
    if (posFilter === 'all') return true;
    return (item.type || item.posType) === posFilter;
  });

  const totalAssetValue = filteredInventory.reduce(
    (sum, item) => sum + (Number(item.stock) || 0) * (Number(item.costPrice ?? item.cost) || 0),
    0
  );
  const totalRetailValue = filteredInventory.reduce(
    (sum, item) => sum + (Number(item.stock) || 0) * (Number(item.price) || 0),
    0
  );

  const suggestedCategories = formData.type === 'cafeteria' ? KIOSK_CATEGORIES : RETAIL_CATEGORIES;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25 rounded-xl">
            <Package size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Unified Inventory & COGS Valuation</h2>
            <p className="text-sm text-zinc-500">Synchronized in real-time with Kiosk POS & Retail Shop POS</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className={`flex rounded-xl p-1 border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-100 border-slate-200'}`}>
            {([
              { id: 'all', label: 'All Inventory' },
              { id: 'cafeteria', label: 'Kiosk POS' },
              { id: 'retail', label: 'Retail Shop POS' }
            ] as const).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPosFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  posFilter === tab.id
                    ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                    : isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              if (isAdding) resetForm();
              else {
                setFormData(prev => ({
                  ...prev,
                  type: posFilter === 'retail' ? 'retail' : 'cafeteria',
                  category: posFilter === 'retail' ? 'Merchandise' : 'Beverages'
                }));
                setIsAdding(true);
              }
            }}
            className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
              isAdding ? 'bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300' : 'bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 shadow-sm shadow-cyan-500/20'
            }`}
          >
            {isAdding ? 'Cancel' : <><Plus size={16} /> Add Item</>}
          </button>
        </div>
      </div>

      {/* Valuation Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Total SKUs</p>
          <p className="text-2xl font-black mt-1">{filteredInventory.length}</p>
        </div>
        <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Total Cost Asset Value</p>
          <p className="text-2xl font-black font-mono text-[#00B8C8] mt-1">{formatCurrency(totalAssetValue)}</p>
        </div>
        <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Projected Retail Value</p>
          <p className="text-2xl font-black font-mono text-emerald-500 mt-1">{formatCurrency(totalRetailValue)}</p>
        </div>
      </div>

      {isAdding && (
        <form onSubmit={handleSubmit} className={`p-6 rounded-3xl border shadow-xl ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} mb-8`}>
          <h3 className="text-base font-bold mb-4">{editingId ? 'Edit Inventory Item' : 'Add New Inventory Item'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">POS Store Module</label>
              <select
                value={formData.type}
                onChange={e => {
                  const newType = e.target.value as 'cafeteria' | 'retail';
                  setFormData({
                    ...formData,
                    type: newType,
                    category: newType === 'cafeteria' ? 'Beverages' : 'Merchandise'
                  });
                }}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
              >
                <option value="cafeteria">Kiosk POS (Supermarket/Grocery)</option>
                <option value="retail">Retail Shop POS (Merch/Supplements)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Item Name</label>
              <input
                required
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
                placeholder="Protein Bar / Knee Brace"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">SKU / Barcode</label>
              <input
                value={formData.sku}
                onChange={e => setFormData({ ...formData, sku: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
                placeholder="5281000123"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Category</label>
              <input
                list="accounting-inventory-categories"
                required
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
              />
              <datalist id="accounting-inventory-categories">
                {suggestedCategories.map(cat => <option key={cat} value={cat} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Stock On Hand</label>
              <input
                type="number"
                required
                value={formData.stock}
                onChange={e => setFormData({ ...formData, stock: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Unit Cost ($ USD)</label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.costPrice}
                onChange={e => setFormData({ ...formData, costPrice: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Selling Price ($ USD)</label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.price}
                onChange={e => setFormData({ ...formData, price: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Supplier</label>
              <input
                value={formData.supplier}
                onChange={e => setFormData({ ...formData, supplier: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
                placeholder="Supplier Name"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Low Stock Alert Threshold</label>
              <input
                type="number"
                value={formData.lowStockThreshold}
                onChange={e => setFormData({ ...formData, lowStockThreshold: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Suggested Reorder Qty</label>
              <input
                type="number"
                value={formData.reorderQuantity}
                onChange={e => setFormData({ ...formData, reorderQuantity: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Expiry Date (Optional)</label>
              <input
                type="date"
                value={formData.expiryDate}
                onChange={e => setFormData({ ...formData, expiryDate: e.target.value })}
                className={`w-full border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'} py-2 px-3 rounded-xl focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none`}
              />
            </div>
            <div className="flex items-end justify-end">
              <button type="submit" className="w-full py-2.5 px-6 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-xl text-sm font-bold shadow-sm shadow-cyan-500/20 transition-colors">
                {editingId ? 'Update Item' : 'Save to Inventory'}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className={`rounded-3xl border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className={`border-b ${isDarkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-slate-100 bg-slate-50'}`}>
              <tr>
                <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Item & SKU</th>
                <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">POS Store</th>
                <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Category</th>
                <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Supplier / Expiry</th>
                <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">In Stock</th>
                <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Unit Cost</th>
                <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500">Selling Price</th>
                <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500 text-right">Asset Value</th>
                <th className="p-4 text-[10px] uppercase font-black tracking-widest text-zinc-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredInventory.length === 0 ? (
                <tr><td colSpan={9} className="p-8 text-center text-zinc-500 font-medium">No inventory items found.</td></tr>
              ) : filteredInventory.map(item => {
                const isLow = item.stock <= (item.lowStockThreshold ?? 5);
                const unitCost = Number(item.costPrice ?? item.cost ?? 0);
                return (
                  <tr key={item.id} className={`border-b last:border-0 ${isDarkMode ? 'border-zinc-800 hover:bg-zinc-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                    <td className="p-4">
                      <div className="font-bold">{item.name}</div>
                      {(item.sku || item.barcode) && (
                        <div className="text-xs font-mono text-zinc-500">SKU: {item.sku || item.barcode}</div>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        item.type === 'cafeteria'
                          ? 'bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/20'
                          : 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20'
                      }`}>
                        {item.type === 'cafeteria' ? 'Kiosk POS' : 'Retail Shop'}
                      </span>
                    </td>
                    <td className="p-4 text-zinc-500">{item.category}</td>
                    <td className="p-4 text-xs">
                      <div className="font-medium">{item.supplier || '—'}</div>
                      {item.expiryDate && (
                        <div className="text-zinc-500">Exp: {item.expiryDate}</div>
                      )}
                    </td>
                    <td className="p-4 font-mono">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                        isLow ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'
                      }`}>
                        {isLow && <AlertTriangle size={12} />}
                        {item.stock}
                      </span>
                    </td>
                    <td className="p-4 text-zinc-500 font-mono">{formatCurrency(unitCost)}</td>
                    <td className="p-4 font-mono font-bold text-[#0099A8] dark:text-[#00B8C8]">{formatCurrency(item.price || 0)}</td>
                    <td className="p-4 text-right font-mono font-black">{formatCurrency((item.stock || 0) * unitCost)}</td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleEdit(item)} className="p-1.5 text-zinc-400 hover:text-[#00B8C8] transition-colors" title="Edit">
                          <Edit2 size={15} />
                        </button>
                        {deleteConfirmId === item.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="px-2 py-1 rounded bg-rose-600 text-white text-[10px] font-bold"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-1.5 py-1 text-[10px] text-zinc-400 hover:text-white"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirmId(item.id)} className="p-1.5 text-zinc-400 hover:text-rose-500 transition-colors" title="Delete">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
