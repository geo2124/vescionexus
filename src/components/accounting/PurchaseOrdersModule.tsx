import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { Plus, CheckCircle2, FileText, Sparkles, PackagePlus, DollarSign } from 'lucide-react';
import { OperationType, InventoryItem } from '../../types';
import { toast } from 'sonner';

interface POItemRow {
  id: string;
  itemId?: string;
  variantId?: string;
  variantName?: string;
  name: string;
  sku?: string;
  quantity: number;
  unitCost: number;
  posType?: 'cafeteria' | 'retail';
}

export const PurchaseOrdersModule = ({
  isDarkMode,
  formatCurrency,
  posType
}: {
  isDarkMode: boolean;
  formatCurrency: (val: number) => string;
  posType?: 'cafeteria' | 'retail';
}) => {
  const { user, handleFirestoreError, usdToLbpRate } = useFirebase();
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [showPOForm, setShowPOForm] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [customSupplierName, setCustomSupplierName] = useState('');
  const [targetStore, setTargetStore] = useState<'cafeteria' | 'retail'>(posType || 'cafeteria');
  const [poItems, setPoItems] = useState<POItemRow[]>([]);

  useEffect(() => {
    if (!user) return;
    const qPOs = query(collection(db, 'purchaseOrders'));
    const unsubPOs = onSnapshot(
      qPOs,
      snap => setPurchaseOrders(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      error => handleFirestoreError(error, OperationType.LIST, 'purchaseOrders')
    );
    const qSuppliers = query(collection(db, 'academySuppliers'));
    const unsubSuppliers = onSnapshot(
      qSuppliers,
      snap => setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      error => handleFirestoreError(error, OperationType.LIST, 'academySuppliers')
    );
    const qInv = query(collection(db, 'inventory'));
    const unsubInv = onSnapshot(
      qInv,
      snap =>
        setInventoryItems(
          snap.docs.map(d => {
            const raw = d.data() as any;
            return {
              id: d.id,
              ...raw,
              cost: Number(raw.costPrice ?? raw.cost ?? 0),
              costPrice: Number(raw.costPrice ?? raw.cost ?? 0),
              stock: Number(raw.stock ?? raw.quantity ?? 0),
              lowStockThreshold: Number(raw.lowStockThreshold ?? 5),
              reorderQuantity: Number(raw.reorderQuantity ?? 20),
              type: (raw.posType || raw.type || 'cafeteria') as 'cafeteria' | 'retail'
            } as InventoryItem;
          })
        ),
      error => handleFirestoreError(error, OperationType.LIST, 'inventory')
    );
    return () => {
      unsubPOs();
      unsubSuppliers();
      unsubInv();
    };
  }, [user]);

  const scopedInventory = useMemo(() => {
    if (posType) return inventoryItems.filter(i => (i.posType || i.type) === posType);
    return inventoryItems.filter(i => (i.posType || i.type) === targetStore);
  }, [inventoryItems, posType, targetStore]);

  const lowStockItems = useMemo(() => {
    const baseList = posType
      ? inventoryItems.filter(i => (i.posType || i.type) === posType)
      : inventoryItems;
    return baseList.filter(i => i.stock <= (i.lowStockThreshold ?? 5));
  }, [inventoryItems, posType]);

  const displayedPOs = useMemo(() => {
    const sorted = [...purchaseOrders].sort((a, b) => {
      const tA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime();
      const tB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime();
      return tB - tA;
    });
    if (!posType) return sorted;
    return sorted.filter(po => po.posType === posType);
  }, [purchaseOrders, posType]);

  const handleAutoGenerateLowStockPOs = async () => {
    if (lowStockItems.length === 0) {
      toast.info('All inventory items are currently above their low-stock thresholds!');
      return;
    }

    try {
      // Group low-stock items by supplier + posType
      const grouped = new Map<string, { supplierName: string; storeType: 'cafeteria' | 'retail'; items: POItemRow[] }>();
      lowStockItems.forEach(item => {
        const sup = (item.supplier || 'General Restock Supplier').trim();
        const st = (item.posType || item.type || 'cafeteria') as 'cafeteria' | 'retail';
        const key = `${sup}__${st}`;
        if (!grouped.has(key)) {
          grouped.set(key, { supplierName: sup, storeType: st, items: [] });
        }
        const reorderQty = item.reorderQuantity ?? Math.max(10, ((item.lowStockThreshold ?? 5) * 3) - item.stock);
        const unitCost = Number(item.costPrice ?? item.cost ?? Number((item.price * 0.6).toFixed(2)) ?? 1);
        grouped.get(key)!.items.push({
          id: Math.random().toString(36).substring(2, 9),
          itemId: item.id,
          name: item.name,
          sku: item.sku || item.barcode || '',
          quantity: Math.max(1, reorderQty),
          unitCost,
          posType: st
        });
      });

      let count = 0;
      for (const group of grouped.values()) {
        const totalCost = group.items.reduce((sum, it) => sum + it.quantity * it.unitCost, 0);
        await addDoc(collection(db, 'purchaseOrders'), {
          supplierId: group.supplierName,
          supplierName: group.supplierName,
          posType: group.storeType,
          items: group.items,
          totalCost,
          historicalFxRate: usdToLbpRate || 89500,
          status: 'draft',
          autoGenerated: true,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || 'system'
        });
        count++;
      }

      toast.success(`Auto-generated ${count} Supplier Purchase Order(s) for ${lowStockItems.length} low-stock item(s)!`);
    } catch (e: any) {
      toast.error('Failed to auto-generate POs: ' + e.message);
    }
  };

  const handleCreateDraftPO = async () => {
    const finalSupplier = customSupplierName.trim() || selectedSupplier;
    if (!finalSupplier || poItems.length === 0) {
      return toast.error('Please enter/select a supplier and add at least one item.');
    }
    try {
      const store = posType || targetStore;
      const payload = {
        supplierId: finalSupplier,
        supplierName:
          customSupplierName.trim() ||
          suppliers.find(s => s.id === selectedSupplier)?.firstName ||
          finalSupplier,
        posType: store,
        items: poItems,
        totalCost: poItems.reduce((acc, item) => acc + item.quantity * item.unitCost, 0),
        historicalFxRate: usdToLbpRate || 89500,
        status: 'draft',
        createdAt: serverTimestamp(),
        createdBy: user?.uid || 'system'
      };
      await addDoc(collection(db, 'purchaseOrders'), payload);
      toast.success('Draft Purchase Order created');
      setShowPOForm(false);
      setSelectedSupplier('');
      setCustomSupplierName('');
      setPoItems([]);
    } catch (e: any) {
      toast.error(e.message);
      handleFirestoreError(e, OperationType.CREATE, 'purchaseOrders');
    }
  };

  const handleReceiveItems = async (poId: string, poData: any) => {
    try {
      const { processLedgerTransaction } = await import('../../lib/transaction-engine');
      const storeType = poData.posType || posType || 'cafeteria';
      const inventoryAccount =
        storeType === 'retail'
          ? '302 - Retail Shop Inventory'
          : '301 - Kiosk POS Inventory';

      // Increment stock & calculate Weighted Average Cost (Coût Moyen Pondéré) on each linked inventory item
      const poItemList: POItemRow[] = Array.isArray(poData.items) ? poData.items : [];
      let updatedStockCount = 0;

      for (const poItem of poItemList) {
        let targetId = poItem.itemId;
        if (!targetId && poItem.name) {
          const match = inventoryItems.find(
            inv =>
              inv.name.toLowerCase() === poItem.name.toLowerCase() &&
              (!poData.posType || (inv.posType || inv.type) === poData.posType)
          );
          if (match) targetId = match.id;
        }

        if (targetId) {
          const invRef = doc(db, 'inventory', targetId);
          const invSnap = await getDoc(invRef);
          if (invSnap.exists()) {
            const currentData = invSnap.data() as any;
            const oldStock = Math.max(0, Number(currentData.stock ?? currentData.quantity ?? 0));
            const oldCost = Math.max(0, Number(currentData.costPrice ?? currentData.cost ?? 0));
            const addedQty = Math.max(0, Number(poItem.quantity || 0));
            const unitCost = Math.max(0, Number(poItem.unitCost || oldCost));
            const newWeightedCost =
              oldStock + addedQty > 0
                ? Number(((oldStock * oldCost + addedQty * unitCost) / (oldStock + addedQty)).toFixed(4))
                : unitCost;

            const currentVariants = Array.isArray(currentData.variants)
              ? currentData.variants.map((v: any) => ({ ...v }))
              : [];

            let nextStock = oldStock + addedQty;
            if (currentVariants.length > 0 && (poItem.variantId || poItem.variantName)) {
              const vIdx = currentVariants.findIndex(
                (v: any) => v.id === poItem.variantId || v.name === poItem.variantName
              );
              if (vIdx !== -1) {
                currentVariants[vIdx].stock = Number(currentVariants[vIdx].stock || 0) + addedQty;
                nextStock = currentVariants.reduce((sum: number, v: any) => sum + Number(v.stock || 0), 0);
              }
            }

            const updatePayload: Record<string, any> = {
              stock: nextStock,
              cost: newWeightedCost,
              costPrice: newWeightedCost,
              supplier: poData.supplierName || poData.supplierId || currentData.supplier || '',
              updatedAt: new Date().toISOString()
            };
            if (currentVariants.length > 0) {
              updatePayload.variants = currentVariants;
            }

            await updateDoc(invRef, updatePayload);
            updatedStockCount++;
          }
        }
      }

      await processLedgerTransaction({
        amount: Number(poData.totalCost || 0),
        paymentMethod: 'system',
        sourceModule: 'procurement',
        cashierId: user?.uid || 'system',
        direction: 'audit',
        transactionType: 'po_receipt',
        sourceAccount: inventoryAccount,
        destinationAccount: '401 - Accounts Payable — Suppliers',
        referenceId: poId,
        notes: `PO #${poId.slice(-6)} Received from ${poData.supplierName || poData.supplierId} (${poItemList.length} items)`
      });

      await updateDoc(doc(db, 'purchaseOrders', poId), {
        status: 'received',
        receivedAt: serverTimestamp(),
        historicalFxRate: poData.historicalFxRate || usdToLbpRate || 89500
      });

      toast.success(
        `PO Received! Restocked ${updatedStockCount} inventory SKU(s) with Weighted Average Cost & accrued AP (LCOA 401).`
      );
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handlePayBill = async (poId: string, poData: any) => {
    try {
      const { processLedgerTransaction } = await import('../../lib/transaction-engine');
      const totalUSD = Number(poData.totalCost || 0);
      await processLedgerTransaction({
        amount: totalUSD,
        paymentMethod: 'cash',
        sourceModule: 'procurement',
        cashierId: user?.uid || 'system',
        direction: 'outflow',
        transactionType: 'po_payment',
        sourceAccount: '401 - Accounts Payable — Suppliers',
        destinationAccount: '531 - Cash Drawer / Register (Caisse)',
        referenceId: poId,
        notes: `Supplier Bill Paid for PO #${poId.slice(-6)} (${poData.supplierName || poData.supplierId})`
      });

      // Check for Realized FX Gain / Loss (LCOA 676 / 776) if FX rate shifted between PO receipt and payment
      const lockedRate = Number(poData.historicalFxRate || usdToLbpRate || 89500);
      const currentRate = Number(usdToLbpRate || 89500);
      if (lockedRate > 0 && currentRate > 0 && Math.abs(currentRate - lockedRate) >= 100 && totalUSD > 0) {
        const lbpDiff = totalUSD * (currentRate - lockedRate);
        const fxDiffUSD = Number((Math.abs(lbpDiff) / currentRate).toFixed(2));
        if (fxDiffUSD >= 0.01) {
          // For a Payable (liability), if LBP rate increased (USD appreciated), paying fixed LBP equivalent yields FX Gain (776); if LBP strengthened, FX Loss (676)
          const isGain = currentRate < lockedRate;
          await processLedgerTransaction({
            amount: fxDiffUSD,
            paymentMethod: 'system',
            sourceModule: 'procurement',
            cashierId: user?.uid || 'system',
            direction: isGain ? 'inflow' : 'outflow',
            transactionType: isGain ? 'fx_gain' : 'fx_loss',
            sourceAccount: isGain
              ? '401 - Accounts Payable — Suppliers'
              : '676 - Foreign Exchange Losses (Différences de Change Négatives)',
            destinationAccount: isGain
              ? '776 - Foreign Exchange Gains (Différences de Change Positives)'
              : '531 - Cash Drawer / Register (Caisse)',
            referenceId: poId,
            notes: `Realized FX ${isGain ? 'Gain (776)' : 'Loss (676)'} on PO #${poId.slice(-6)} (PO Rate: ${lockedRate.toLocaleString()} vs Paid Rate: ${currentRate.toLocaleString()} LBP)`
          });
        }
      }

      await updateDoc(doc(db, 'purchaseOrders', poId), {
        status: 'paid',
        paidAt: serverTimestamp(),
        paidFxRate: currentRate
      });
      toast.success('Supplier Bill Paid! LCOA 401 AP settled and Cash updated.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className={`h-full flex flex-col p-6 overflow-y-auto ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6">
        <div>
           <h2 className="text-2xl font-bold font-sans tracking-tight">
             Procurement & Supplier Purchase Orders {posType ? `(${posType === 'cafeteria' ? 'Kiosk POS' : 'Retail Shop POS'})` : ''}
           </h2>
           <p className="text-sm text-zinc-500">
             Automated low-stock PO generation, 1-click stock receive into Inventory (LCOA 301/302), and Accounts Payable (LCOA 401).
           </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleAutoGenerateLowStockPOs}
            className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 shadow-sm shadow-amber-500/20 transition-all"
          >
            <Sparkles size={15} />
            Auto-Generate POs from Low Stock ({lowStockItems.length})
          </button>
          <button
            onClick={() => setShowPOForm(!showPOForm)}
            className="bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 shadow-sm shadow-cyan-500/20 transition-all"
          >
            <Plus size={15} /> Create Manual PO
          </button>
        </div>
      </div>

      {showPOForm && (
        <div className="bg-slate-50 dark:bg-[#0B0F17] p-5 rounded-2xl border border-slate-200 dark:border-zinc-800 mb-6 space-y-4">
           <h3 className="font-bold flex items-center gap-2"><FileText size={18} className="text-[#00B8C8]" /> Draft New Purchase Order</h3>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
             <div>
               <label className="block text-xs font-bold uppercase text-zinc-500 mb-1">Supplier Name</label>
               <input
                 type="text"
                 placeholder="Type supplier name (e.g. Nestle Waters SARL)"
                 value={customSupplierName}
                 onChange={e => setCustomSupplierName(e.target.value)}
                 className={`w-full p-2.5 border rounded-xl text-sm focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-slate-300'}`}
               />
             </div>
             <div>
               <label className="block text-xs font-bold uppercase text-zinc-500 mb-1">Or Select Saved Supplier</label>
               <select
                 className={`w-full p-2.5 border rounded-xl text-sm focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-slate-300'}`}
                 value={selectedSupplier}
                 onChange={(e) => {
                   setSelectedSupplier(e.target.value);
                   const sup = suppliers.find(s => s.id === e.target.value);
                   if (sup) setCustomSupplierName(`${sup.firstName || ''} ${sup.lastName || ''}`.trim());
                 }}
               >
                 <option value="">-- Optional Saved Directory --</option>
                 {suppliers.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
               </select>
             </div>
             {!posType && (
               <div>
                 <label className="block text-xs font-bold uppercase text-zinc-500 mb-1">Target Inventory Store</label>
                 <select
                   className={`w-full p-2.5 border rounded-xl text-sm font-bold focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-slate-300'}`}
                   value={targetStore}
                   onChange={e => setTargetStore(e.target.value as 'cafeteria' | 'retail')}
                 >
                   <option value="cafeteria">Kiosk POS (LCOA 301)</option>
                   <option value="retail">Retail Shop POS (LCOA 302)</option>
                 </select>
               </div>
             )}
           </div>
           
           <div className="space-y-2">
             <div className="flex justify-between items-center">
               <h4 className="font-bold text-xs uppercase tracking-wider text-zinc-500">PO Line Items (Link to Inventory SKU for Auto-Restock)</h4>
               <button
                 type="button"
                 onClick={() =>
                   setPoItems([
                     ...poItems,
                     {
                       id: Math.random().toString(36).substring(2, 9),
                       itemId: '',
                       name: '',
                       quantity: 10,
                       unitCost: 0,
                       posType: posType || targetStore
                     }
                   ])
                 }
                 className="text-[#0099A8] dark:text-[#00B8C8] hover:underline text-xs font-bold flex items-center gap-1"
               >
                 <Plus size={14} /> Add Line Item
               </button>
             </div>
             {poItems.map((item, idx) => {
               const linkedInv = scopedInventory.find(i => i.id === item.itemId);
               const hasVariants = Boolean(linkedInv?.variants && linkedInv.variants.length > 0);
               return (
                 <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                   <select
                     className={`md:col-span-4 p-2 border rounded-xl text-xs ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-300'}`}
                     value={item.itemId || ''}
                     onChange={e => {
                       const inv = scopedInventory.find(i => i.id === e.target.value);
                       const next = [...poItems];
                       if (inv) {
                         const firstVar = inv.variants && inv.variants.length > 0 ? inv.variants[0] : undefined;
                         next[idx] = {
                           ...next[idx],
                           itemId: inv.id,
                           variantId: firstVar?.id,
                           variantName: firstVar?.name,
                           name: firstVar ? `${inv.name} (${firstVar.name})` : inv.name,
                           sku: firstVar?.sku || inv.sku || inv.barcode || '',
                           quantity: inv.reorderQuantity ?? 20,
                           unitCost: Number(inv.costPrice ?? inv.cost ?? 0)
                         };
                       } else {
                         next[idx].itemId = '';
                         next[idx].variantId = undefined;
                         next[idx].variantName = undefined;
                       }
                       setPoItems(next);
                     }}
                   >
                     <option value="">-- Link Inventory Item (Optional) --</option>
                     {scopedInventory.map(inv => (
                       <option key={inv.id} value={inv.id}>
                         {inv.name} (Stock: {inv.stock} | Cost: ${Number(inv.costPrice ?? inv.cost ?? 0).toFixed(2)})
                       </option>
                     ))}
                   </select>
                   {hasVariants ? (
                     <select
                       className={`md:col-span-4 p-2 border rounded-xl text-xs ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-indigo-400' : 'bg-white border-slate-300 text-indigo-700'}`}
                       value={item.variantId || ''}
                       onChange={e => {
                         const v = linkedInv?.variants?.find(vr => vr.id === e.target.value);
                         const next = [...poItems];
                         next[idx] = {
                           ...next[idx],
                           variantId: v?.id,
                           variantName: v?.name,
                           name: v && linkedInv ? `${linkedInv.name} (${v.name})` : (linkedInv?.name || next[idx].name),
                           sku: v?.sku || linkedInv?.sku || ''
                         };
                         setPoItems(next);
                       }}
                     >
                       {(linkedInv?.variants || []).map(v => (
                         <option key={v.id} value={v.id}>
                           Variant: {v.name} (Stock: {v.stock})
                         </option>
                       ))}
                     </select>
                   ) : (
                     <input
                       type="text"
                       placeholder="Item Description"
                       className={`md:col-span-4 p-2 border rounded-xl text-xs ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-300'}`}
                       value={item.name}
                       onChange={(e) => {
                         const newItems = [...poItems];
                         newItems[idx].name = e.target.value;
                         setPoItems(newItems);
                       }}
                     />
                   )}
                   <input
                     type="number"
                     min="1"
                     placeholder="Qty"
                     className={`md:col-span-2 p-2 border rounded-xl text-xs font-mono ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-300'}`}
                     value={item.quantity}
                     onChange={(e) => {
                       const newItems = [...poItems];
                       newItems[idx].quantity = Number(e.target.value);
                       setPoItems(newItems);
                     }}
                   />
                   <div className="md:col-span-2 flex items-center gap-1">
                     <input
                       type="number"
                       step="0.01"
                       placeholder="Unit Cost ($)"
                       className={`w-full p-2 border rounded-xl text-xs font-mono ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-300'}`}
                       value={item.unitCost}
                       onChange={(e) => {
                         const newItems = [...poItems];
                         newItems[idx].unitCost = Number(e.target.value);
                         setPoItems(newItems);
                       }}
                     />
                     <button
                       type="button"
                       onClick={() => setPoItems(poItems.filter((_, i) => i !== idx))}
                       className="px-2 py-1 text-rose-500 hover:text-rose-600 font-bold"
                     >
                       ×
                     </button>
                   </div>
                 </div>
               );
             })}
             {poItems.length > 0 && (
               <div className="text-right font-bold text-sm pt-2">
                 Total PO Value: {formatCurrency(poItems.reduce((acc, item) => acc + item.quantity * item.unitCost, 0))}
               </div>
             )}
           </div>

           <div className="flex gap-2 pt-2">
             <button onClick={handleCreateDraftPO} className="bg-[#00B8C8] hover:bg-[#0099A8] px-4 py-2 rounded-xl text-slate-950 text-xs font-bold transition-colors">
               Save Draft PO
             </button>
             <button onClick={() => setShowPOForm(false)} className="bg-zinc-500 hover:bg-zinc-600 px-4 py-2 rounded-xl text-white text-xs font-bold">
               Cancel
             </button>
           </div>
        </div>
      )}

      <div className="bg-white dark:bg-[#0B0F17] rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-zinc-950/50 text-zinc-500 font-bold uppercase text-xs">
            <tr>
              <th className="p-4">PO #</th>
              <th className="p-4">Supplier</th>
              <th className="p-4">Store</th>
              <th className="p-4">Line Items</th>
              <th className="p-4">Total Cost</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-zinc-800">
            {displayedPOs.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-zinc-500">
                  No purchase orders found. Click "Auto-Generate POs from Low Stock" or "Create Manual PO" above.
                </td>
              </tr>
            ) : (
              displayedPOs.map(po => (
                <tr key={po.id} className="hover:bg-slate-50 dark:hover:bg-zinc-800/30">
                  <td className="p-4 font-mono font-bold text-xs text-[#0099A8] dark:text-[#00B8C8]">PO-{po.id.slice(-6).toUpperCase()}</td>
                  <td className="p-4 font-bold">
                    {po.supplierName || suppliers.find(s => s.id === po.supplierId)?.firstName || po.supplierId}
                  </td>
                  <td className="p-4 text-xs uppercase font-bold text-zinc-400">
                    {po.posType === 'retail' ? 'Retail (302)' : 'Kiosk (301)'}
                  </td>
                  <td className="p-4 text-xs text-zinc-500">
                    {(po.items || []).map((it: any, i: number) => (
                      <div key={i}>
                        {it.quantity}x {it.name} @ ${Number(it.unitCost || 0).toFixed(2)}
                      </div>
                    ))}
                  </td>
                  <td className="p-4 font-bold font-mono">
                    <div>{formatCurrency(po.totalCost || 0)}</div>
                    {po.historicalFxRate && (
                      <div className="text-[10px] text-zinc-400">
                        FX: {Number(po.historicalFxRate).toLocaleString()} LBP
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                        po.status === 'paid'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : po.status === 'received'
                          ? 'bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8]'
                          : 'bg-amber-500/10 text-amber-500'
                      }`}
                    >
                      {po.status}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      {po.status === 'draft' && (
                        <button
                          onClick={() => handleReceiveItems(po.id, po)}
                          className="bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1 transition-colors"
                        >
                          <PackagePlus size={13} /> Receive Stock & Accrue AP (401)
                        </button>
                      )}
                      {po.status === 'received' && (
                        <button
                          onClick={() => handlePayBill(po.id, po)}
                          className="bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1 transition-colors"
                        >
                          <DollarSign size={13} /> Pay Supplier Bill
                        </button>
                      )}
                      {po.status === 'paid' && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-500">
                          <CheckCircle2 size={14} /> Settled
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
