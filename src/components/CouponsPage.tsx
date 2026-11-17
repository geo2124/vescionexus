import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { TenantBrandLockup } from './VescioNexusLogo';
import { collection, onSnapshot, query, addDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { Coupon, OperationType } from '../types';
import { handleFirestoreError } from '../lib/firestore-utils';
import { Ticket, Plus, Trash2, Copy, Check, ArrowLeft, Edit2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

const COUPON_MODULES = [
  { id: 'gym', label: 'Gym' },
  { id: 'courts', label: 'Courts' },
  { id: 'physio', label: 'Physio' },
  { id: 'pos_retail', label: 'Retail Shop POS' },
];

const ELIGIBLE_MODULE_IDS = COUPON_MODULES.map(m => m.id);

const CouponsPage: React.FC = () => {
  const [user] = useAuthState(auth);
  const navigate = useNavigate();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { isDarkMode, toggleDarkMode } = useTheme();

  const [newCoupon, setNewCoupon] = useState({
    code: '',
    discountType: 'percentage' as 'percentage' | 'fixed',
    discountValue: 0,
    usageLimit: 1,
    expiryDate: '',
    isActive: true,
    applicableModules: [...ELIGIBLE_MODULE_IDS] as string[]
  });

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'coupons'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Coupon));
      setCoupons(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'coupons', user);
    });
    return () => unsubscribe();
  }, [user]);

  const toggleModule = (modId: string) => {
    const current = newCoupon.applicableModules || [];
    if (current.includes(modId)) {
      setNewCoupon({ ...newCoupon, applicableModules: current.filter(m => m !== modId) });
    } else {
      setNewCoupon({ ...newCoupon, applicableModules: [...current, modId] });
    }
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const sanitizedModules = (newCoupon.applicableModules || ELIGIBLE_MODULE_IDS).filter(
        m => m !== 'pos_cafe' && m !== 'pos_cafeteria' && m !== 'cafeteria'
      );
      if (editingCoupon) {
        await setDoc(doc(db, 'coupons', editingCoupon.id), {
          ...newCoupon,
          applicableModules: sanitizedModules,
          uid: user.uid,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } else {
        await addDoc(collection(db, 'coupons'), {
          ...newCoupon,
          applicableModules: sanitizedModules,
          usageCount: 0,
          uid: user.uid,
          createdAt: new Date().toISOString()
        });
      }
      setIsModalOpen(false);
      setEditingCoupon(null);
      setNewCoupon({
        code: '',
        discountType: 'percentage',
        discountValue: 0,
        usageLimit: 1,
        expiryDate: '',
        isActive: true,
        applicableModules: [...ELIGIBLE_MODULE_IDS]
      });
      toast.success(editingCoupon ? 'Coupon updated successfully' : 'Coupon created successfully');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, 'coupons', user);
      toast.error(error.message || 'Failed to save coupon');
    }
  };

  const handleDeleteCoupon = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this coupon?')) return;
    try {
      await deleteDoc(doc(db, 'coupons', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `coupons/${id}`, user);
    }
  };

  const copyToClipboard = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const generateRandomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewCoupon({ ...newCoupon, code });
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans`}>
      <div className="max-w-6xl mx-auto p-6 md:p-12">
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <TenantBrandLockup size="sm" subtitle="Coupons Engine" />
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
            <button
              onClick={() => {
                setEditingCoupon(null);
                setNewCoupon({
                  code: '',
                  discountType: 'percentage',
                  discountValue: 0,
                  usageLimit: 1,
                  expiryDate: '',
                  isActive: true,
                  applicableModules: [...ELIGIBLE_MODULE_IDS]
                });
                setIsModalOpen(true);
              }}
              className="bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-colors shadow-sm shadow-cyan-500/15"
            >
              <Plus size={18} />
              Create Coupon
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {coupons.map((coupon) => (
              <motion.div
                key={coupon.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`rounded-2xl p-6 shadow-sm border transition-all group relative ${
                  coupon.isActive === false ? 'opacity-60 ' : ''
                }${
                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800 hover:border-[#00B8C8]/50' : 'bg-white border-slate-200 hover:border-[#00B8C8]/60 hover:shadow-md'
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="p-2 rounded-xl bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/25">
                    <Ticket size={24} />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setEditingCoupon(coupon);
                        setNewCoupon({
                          code: coupon.code,
                          discountType: coupon.discountType,
                          discountValue: coupon.discountValue,
                          usageLimit: coupon.usageLimit,
                          expiryDate: coupon.expiryDate || '',
                          isActive: coupon.isActive !== false,
                          applicableModules: (coupon.applicableModules || ELIGIBLE_MODULE_IDS).filter(
                            m => m !== 'pos_cafe' && m !== 'pos_cafeteria' && m !== 'cafeteria'
                          )
                        });
                        setIsModalOpen(true);
                      }}
                      className="p-2 text-zinc-400 hover:text-[#00B8C8] transition-colors"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleDeleteCoupon(coupon.id)}
                      className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono font-bold text-lg tracking-wider">{coupon.code}</span>
                  <button
                    onClick={() => copyToClipboard(coupon.code, coupon.id)}
                    className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-zinc-800 text-zinc-500' : 'hover:bg-slate-100 text-slate-400'}`}
                  >
                    {copiedId === coupon.id ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Discount</span>
                    <span className="font-semibold text-[#0099A8] dark:text-[#00B8C8]">
                      {coupon.discountType === 'percentage' ? `${coupon.discountValue}%` : `$${coupon.discountValue}`}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Usage</span>
                    <span className="font-semibold">
                      {coupon.usageCount} / {coupon.usageLimit === 0 ? '∞' : coupon.usageLimit}
                    </span>
                  </div>
                  {coupon.expiryDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Expires</span>
                      <span className="font-semibold">{new Date(coupon.expiryDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  <div className="pt-2 flex flex-wrap gap-1">
                    {(coupon.applicableModules && coupon.applicableModules.length > 0
                      ? coupon.applicableModules
                      : ['All Modules']
                    ).map(m => (
                      <span key={m} className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${isDarkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-100 text-slate-600'}`}>
                        {m}
                      </span>
                    ))}
                  </div>
                </div>

                {coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit && (
                  <div className={`absolute inset-0 backdrop-blur-[1px] rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-black/60' : 'bg-white/60'}`}>
                    <span className="bg-zinc-900 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">Fully Used</span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {coupons.length === 0 && (
          <div className="text-center py-24">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${isDarkMode ? 'bg-[#0B0F17] border border-zinc-800' : 'bg-slate-100'}`}>
              <Ticket size={32} className="text-zinc-400" />
            </div>
            <h3 className="text-lg font-medium">No coupons yet</h3>
            <p className="text-zinc-500">Create your first discount code to get started.</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`rounded-3xl w-full max-w-md p-8 shadow-2xl border ${isDarkMode ? 'bg-[#101622] border-zinc-800 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
          >
            <h2 className="text-2xl font-semibold mb-6">{editingCoupon ? 'Edit Coupon' : 'New Coupon'}</h2>
            <form onSubmit={handleCreateCoupon} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Coupon Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={newCoupon.code}
                    onChange={e => setNewCoupon({ ...newCoupon, code: e.target.value.toUpperCase() })}
                    className={`flex-1 rounded-xl px-4 py-3 border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-mono ${
                      isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-white' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                    placeholder="SUMMER2024"
                  />
                  <button
                    type="button"
                    onClick={generateRandomCode}
                    className={`px-4 py-2 rounded-xl border transition-colors text-sm font-medium ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 hover:border-[#00B8C8]/50' : 'bg-slate-100 border-slate-200 hover:bg-slate-200'}`}
                  >
                    Auto
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Type</label>
                  <select
                    value={newCoupon.discountType}
                    onChange={e => setNewCoupon({ ...newCoupon, discountType: e.target.value as 'percentage' | 'fixed' })}
                    className={`w-full rounded-xl px-4 py-3 border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all ${
                      isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-white' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                  >
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed Amount</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Value</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={newCoupon.discountValue}
                    onChange={e => setNewCoupon({ ...newCoupon, discountValue: Number(e.target.value) })}
                    className={`w-full rounded-xl px-4 py-3 border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all ${
                      isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-white' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                    placeholder={newCoupon.discountType === 'percentage' ? '20' : '10'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Usage Limit</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={newCoupon.usageLimit}
                    onChange={e => setNewCoupon({ ...newCoupon, usageLimit: Number(e.target.value) })}
                    className={`w-full rounded-xl px-4 py-3 border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all ${
                      isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-white' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                    placeholder="1"
                  />
                  <p className="text-[10px] text-zinc-400 mt-1">0 for unlimited</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Expiry Date</label>
                  <input
                    type="date"
                    value={newCoupon.expiryDate}
                    onChange={e => setNewCoupon({ ...newCoupon, expiryDate: e.target.value })}
                    className={`w-full rounded-xl px-4 py-3 border focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all ${
                      isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-white [color-scheme:dark]' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest">
                    Applicable Modules (Kiosk POS Excluded)
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setNewCoupon({ ...newCoupon, applicableModules: [...ELIGIBLE_MODULE_IDS] })
                    }
                    className="text-[11px] font-bold text-[#00B8C8] hover:underline"
                  >
                    All Eligible Modules
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {COUPON_MODULES.map(mod => {
                    const active = (newCoupon.applicableModules || []).includes(mod.id);
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => toggleModule(mod.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                          active
                            ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8]'
                            : isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-400' : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        {mod.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Active Status</span>
                <button
                  type="button"
                  onClick={() => setNewCoupon({ ...newCoupon, isActive: !newCoupon.isActive })}
                  className={`px-3 py-1 rounded-lg text-xs font-bold ${newCoupon.isActive ? 'bg-emerald-500/15 text-emerald-500' : 'bg-zinc-500/15 text-zinc-400'}`}
                >
                  {newCoupon.isActive ? 'Active' : 'Paused'}
                </button>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className={`flex-1 px-6 py-3 border rounded-2xl font-medium transition-colors ${isDarkMode ? 'border-zinc-800 hover:bg-zinc-800' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-2xl font-semibold transition-colors shadow-sm shadow-cyan-500/15"
                >
                  {editingCoupon ? 'Save Changes' : 'Create'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default CouponsPage;
