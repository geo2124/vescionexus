import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { TenantBrandLockup } from './VescioNexusLogo';
import { collection, onSnapshot, query, addDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { CashbackCode, OperationType, Member } from '../types';
import { handleFirestoreError } from '../lib/firestore-utils';
import { Plus, Trash2, ArrowLeft, Edit2, Copy, Check, Gift, Search, X, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

const MODULES = [
  { id: 'gym', label: 'Gym Membership' },
  { id: 'physio', label: 'Physiotherapy' },
  { id: 'courts', label: 'Court Reservations' },
  { id: 'pos_retail', label: 'Retail Shop POS' },
];

const ELIGIBLE_CASHBACK_MODULES = MODULES.map(m => m.id);

const CashbackPage: React.FC = () => {
  const { user, currency } = useFirebase();
  const navigate = useNavigate();
  const [codes, setCodes] = useState<CashbackCode[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<CashbackCode | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [searchMember, setSearchMember] = useState('');
  const [showMemberResults, setShowMemberResults] = useState(false);

  // New Code state management with strict business rules (Kiosk POS excluded)
  const [newCode, setNewCode] = useState<Partial<CashbackCode>>({
    code: '',
    cashbackType: 'percentage',
    value: 5,
    maxUses: 0, // 0 = Unlimited
    usageCount: 0,
    isActive: true,
    expiryDate: '',
    applicableModules: [...ELIGIBLE_CASHBACK_MODULES],
    memberId: ''
  });

  useEffect(() => {
    if (!user) return;
    const qCodes = query(collection(db, 'cashbackCodes'));
    const unsubscribeCodes = onSnapshot(qCodes, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CashbackCode));
      setCodes(data);
    });

    const qMembers = query(collection(db, 'members'));
    const unsubscribeMembers = onSnapshot(qMembers, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member));
      setMembers(data);
    });

    return () => {
      unsubscribeCodes();
      unsubscribeMembers();
    };
  }, [user]);

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const sanitizedModules = (newCode.applicableModules || ELIGIBLE_CASHBACK_MODULES).filter(
        m => m !== 'pos_cafe' && m !== 'pos_cafeteria' && m !== 'cafeteria' && m !== 'pos'
      );
      const codeData = {
        ...newCode,
        applicableModules: sanitizedModules,
        uid: user.uid,
        updatedAt: new Date().toISOString()
      };

      if (editingCode) {
        await setDoc(doc(db, 'cashbackCodes', editingCode.id), codeData, { merge: true });
      } else {
        await addDoc(collection(db, 'cashbackCodes'), {
          ...codeData,
          usageCount: 0,
          isActive: true,
          createdAt: new Date().toISOString()
        });
      }
      setIsModalOpen(false);
      setEditingCode(null);
      resetForm();
      toast.success(editingCode ? 'Execution Logic Updated' : 'Registry Code Initialized');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, 'cashbackCodes', user);
      toast.error(error.message || 'Failed to apply logic changes');
    }
  };

  const resetForm = () => {
    setNewCode({
      code: '',
      cashbackType: 'percentage',
      value: 5,
      maxUses: 1,
      usageCount: 0,
      isActive: true,
      expiryDate: '',
      applicableModules: [...ELIGIBLE_CASHBACK_MODULES],
      memberId: ''
    });
    setSearchMember('');
  };

  const handleDeleteCode = async (id: string) => {
    if (!window.confirm('Are you sure you want to decommission this cashback code?')) return;
    try {
      await deleteDoc(doc(db, 'cashbackCodes', id));
      toast.success('Cashback code removed');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `cashbackCodes/${id}`, user);
    }
  };

  const copyToClipboard = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const generateRandomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let codeStr = 'CB-';
    for (let i = 0; i < 8; i++) {
      codeStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewCode({ ...newCode, code: codeStr });
  };

  const toggleModule = (moduleId: string) => {
    const current = newCode.applicableModules || [];
    if (current.includes(moduleId)) {
      setNewCode({ ...newCode, applicableModules: current.filter(id => id !== moduleId) });
    } else {
      setNewCode({ ...newCode, applicableModules: [...current, moduleId] });
    }
  };

  const filteredMembers = members.filter(m => 
    `${m.firstName} ${m.lastName}`.toLowerCase().includes(searchMember.toLowerCase()) ||
    m.email.toLowerCase().includes(searchMember.toLowerCase()) ||
    m.phone.includes(searchMember)
  );

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans`}>
      <div className="max-w-7xl mx-auto p-6 md:p-12">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div className="flex items-center gap-3">
            <TenantBrandLockup size="sm" subtitle="Cashback & Rewards Engine" />
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
            <button
              onClick={() => {
                resetForm();
                setIsModalOpen(true);
              }}
              className="bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-colors shadow-sm shadow-cyan-500/15"
            >
              <Plus size={18} />
              Create Reward Logic
            </button>
          </div>
        </header>

        <div className="space-y-4">
          <AnimatePresence>
            {codes.map((code) => {
              const assignedMember = members.find(m => m.id === code.memberId);
              const isExpired = code.expiryDate && new Date(code.expiryDate).getTime() < Date.now();
              const isFullyUsed = code.maxUses > 0 && code.usageCount >= code.maxUses;

              return (
                <motion.div
                  key={code.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className={`group relative rounded-2xl border p-5 transition-all duration-300 ${
                    !code.isActive || isExpired || isFullyUsed ? 'opacity-60' : ''
                  } ${
                    isDarkMode 
                      ? 'bg-[#0B0F17] border-zinc-800 hover:border-[#00B8C8]/50' 
                      : 'bg-white border-slate-200 hover:border-[#00B8C8]/60 hover:shadow-md'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-6">
                    {/* Code Identity */}
                    <div className="flex items-center gap-4 min-w-[220px]">
                      <div className="p-3 rounded-xl bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/25">
                        <Tag size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-mono font-black text-lg tracking-tighter uppercase">{code.code}</p>
                          <button
                            onClick={() => copyToClipboard(code.code, code.id)}
                            className="text-zinc-500 hover:text-[#00B8C8] transition-colors"
                          >
                            {copiedId === code.id ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`el-badge transition-colors ${
                            code.isActive && !isExpired && !isFullyUsed ? 'el-badge-success' : 'el-badge-danger'
                          }`}>
                            {isExpired ? 'Expired' : isFullyUsed ? 'Depleted' : code.isActive ? 'Active' : 'Halted'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Reward Details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 flex-1 gap-4">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Benefit</p>
                        <p className="font-bold flex items-center gap-1 text-[#0099A8] dark:text-[#00B8C8]">
                          {code.cashbackType === 'percentage' ? '' : (currency === 'USD' ? '$' : 'LBP ')}
                          {code.value}
                          {code.cashbackType === 'percentage' ? '%' : ''}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Redemptions</p>
                        <p className="font-bold">
                          {code.usageCount} <span className="text-zinc-500 font-medium">/ {code.maxUses || '∞'}</span>
                        </p>
                      </div>
                      <div className="hidden md:block">
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Modules</p>
                        <div className="flex flex-wrap gap-1">
                          {(code.applicableModules || []).slice(0, 2).map(modId => (
                            <span key={modId} className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border ${
                              isDarkMode ? 'bg-zinc-800 text-zinc-400 border-zinc-700' : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}>
                              {modId}
                            </span>
                          ))}
                          {(code.applicableModules || []).length > 2 && (
                            <span className="text-[8px] font-black text-zinc-500">+{code.applicableModules!.length - 2}</span>
                          )}
                        </div>
                      </div>
                      <div className="hidden md:block">
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Assignment</p>
                        {assignedMember ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[#0099A8] dark:text-[#00B8C8] truncate">{assignedMember.firstName} {assignedMember.lastName}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-zinc-500 italic">Global Logic</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className={`flex items-center gap-2 justify-end border-t pt-4 md:pt-0 md:border-t-0 ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
                      <button
                        onClick={() => {
                          setEditingCode(code);
                          setNewCode(code);
                          const member = members.find(m => m.id === code.memberId);
                          setSearchMember(member ? `${member.firstName} ${member.lastName}` : '');
                          setIsModalOpen(true);
                        }}
                        className={`p-2 rounded-xl transition-colors ${
                          isDarkMode ? 'bg-zinc-800 hover:bg-[#00B8C8]/15 text-zinc-400 hover:text-[#00B8C8]' : 'bg-slate-100 hover:bg-[#00B8C8]/15 text-slate-500 hover:text-[#0099A8]'
                        }`}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteCode(code.id)}
                        className={`p-2 rounded-xl transition-colors ${
                          isDarkMode ? 'bg-zinc-800 hover:bg-red-500/20 text-zinc-400 hover:text-red-500' : 'bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600'
                        }`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {codes.length === 0 && (
          <div className={`text-center py-32 border-2 border-dashed rounded-[2rem] ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
            <Gift size={48} className="text-zinc-500 mx-auto mb-4 opacity-30" />
            <h3 className="text-xl font-bold mb-2">Passive Registry Engine</h3>
            <p className="text-zinc-500 max-w-sm mx-auto text-sm">Deploy reward logic to automate member balance crediting across operations.</p>
          </div>
        )}
      </div>

      {/* Logic Configuration Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 flex items-center justify-center p-4 z-50">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-2xl rounded-[2.5rem] overflow-hidden shadow-2xl border ${isDarkMode ? 'bg-[#101622] text-white border-zinc-800' : 'bg-white text-slate-900 border-slate-200'}`}
            >
              <div className="p-8 md:p-12">
                <header className="flex justify-between items-center mb-10">
                  <div>
                    <h2 className="text-3xl font-black tracking-tight">{editingCode ? 'Configure Logic' : 'Initiate Engine'}</h2>
                    <p className="text-zinc-500 text-xs uppercase font-black tracking-widest mt-1">Cashback Crediting parameters</p>
                  </div>
                  <button 
                    onClick={() => setIsModalOpen(false)}
                    className={`p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-zinc-800' : 'hover:bg-slate-100'}`}
                  >
                    <X size={20} />
                  </button>
                </header>

                <form onSubmit={handleCreateCode} className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div className="space-y-8">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Redemption Code</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            required
                            value={newCode.code}
                            onChange={e => setNewCode({ ...newCode, code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
                            className={`flex-1 rounded-2xl px-5 py-4 focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-mono font-bold tracking-wider ${
                              isDarkMode ? 'bg-[#0B0F17] border border-zinc-800 text-white' : 'bg-slate-50 border border-slate-200'
                            }`}
                            placeholder="CB-ENGINE-X"
                          />
                          <button
                            type="button"
                            onClick={generateRandomCode}
                            className={`px-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 border ${
                              isDarkMode ? 'bg-[#0B0F17] border-zinc-800 hover:border-[#00B8C8]/50' : 'bg-slate-100 border-slate-200 hover:bg-slate-200'
                            }`}
                          >
                            Gen
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Calculation</label>
                          <select
                            value={newCode.cashbackType}
                            onChange={e => setNewCode({ ...newCode, cashbackType: e.target.value as 'percentage' | 'fixed' })}
                            className={`w-full rounded-2xl px-5 py-4 focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-bold ${
                              isDarkMode ? 'bg-[#0B0F17] border border-zinc-800' : 'bg-slate-50 border border-slate-200'
                            }`}
                          >
                            <option value="percentage">Percent (%)</option>
                            <option value="fixed">Fixed Sum</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Reward Value</label>
                          <div className="relative">
                            <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 font-bold text-xs uppercase">
                              {newCode.cashbackType === 'percentage' ? '%' : (currency === 'USD' ? '$' : 'LBP')}
                            </span>
                            <input
                              type="number"
                              required
                              step="0.01"
                              min="0"
                              value={newCode.value}
                              onChange={e => setNewCode({ ...newCode, value: parseFloat(e.target.value) || 0 })}
                              className={`w-full rounded-2xl pl-12 pr-5 py-4 focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-bold ${
                                isDarkMode ? 'bg-[#0B0F17] border border-zinc-800' : 'bg-slate-50 border border-slate-200'
                              }`}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Max Usages (0=∞)</label>
                          <input
                            type="number"
                            min="0"
                            value={newCode.maxUses}
                            onChange={e => setNewCode({ ...newCode, maxUses: parseInt(e.target.value) || 0 })}
                            className={`w-full rounded-2xl px-5 py-4 focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-bold ${
                              isDarkMode ? 'bg-[#0B0F17] border border-zinc-800' : 'bg-slate-50 border border-slate-200'
                            }`}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Expiry Constraint</label>
                          <input
                            type="date"
                            value={newCode.expiryDate}
                            onChange={e => setNewCode({ ...newCode, expiryDate: e.target.value })}
                            className={`w-full rounded-2xl px-5 py-4 focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all font-bold ${
                              isDarkMode ? 'bg-[#0B0F17] border border-zinc-800 [color-scheme:dark]' : 'bg-slate-50 border border-slate-200'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Identity Lock (Optional)</label>
                        <div className="relative">
                          <Search size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500" />
                          <input
                            type="text"
                            value={searchMember}
                            onChange={e => {
                              setSearchMember(e.target.value);
                              setShowMemberResults(true);
                              if (!e.target.value) setNewCode({ ...newCode, memberId: '' });
                            }}
                            onFocus={() => setShowMemberResults(true)}
                            placeholder="Restrict to specific member..."
                            className={`w-full pl-12 pr-12 py-4 rounded-2xl focus:outline-none focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] transition-all text-sm font-medium ${
                              isDarkMode ? 'bg-[#0B0F17] border border-zinc-800' : 'bg-slate-50 border border-slate-200'
                            }`}
                          />
                          {searchMember && (
                            <button 
                              type="button"
                              onClick={() => {
                                setSearchMember('');
                                setNewCode({ ...newCode, memberId: '' });
                                setShowMemberResults(false);
                              }}
                              className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                            >
                              <X size={14} />
                            </button>
                          )}

                          <AnimatePresence>
                            {showMemberResults && searchMember && (
                              <motion.div 
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className={`absolute left-0 right-0 top-full mt-3 rounded-[2rem] border overflow-hidden shadow-2xl z-[60] ${
                                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
                                }`}
                              >
                                <div className="max-h-60 overflow-y-auto">
                                  {filteredMembers.length > 0 ? (
                                    filteredMembers.map(m => (
                                      <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => {
                                          setNewCode({ ...newCode, memberId: m.id });
                                          setSearchMember(`${m.firstName} ${m.lastName}`);
                                          setShowMemberResults(false);
                                        }}
                                        className={`w-full p-4 flex items-center gap-4 text-left transition-colors border-b last:border-b-0 ${
                                          isDarkMode ? 'hover:bg-zinc-900 border-zinc-900' : 'hover:bg-slate-50 border-slate-50'
                                        }`}
                                      >
                                        <div className="w-10 h-10 rounded-full bg-[#00B8C8]/15 flex items-center justify-center text-[#0099A8] dark:text-[#00B8C8] font-bold text-xs">
                                          {m.firstName[0]}{m.lastName[0]}
                                        </div>
                                        <div className="min-w-0">
                                          <p className="font-bold text-sm truncate">{m.firstName} {m.lastName}</p>
                                          <p className="text-zinc-500 text-xs truncate">{m.phone || m.email}</p>
                                        </div>
                                      </button>
                                    ))
                                  ) : (
                                    <p className="p-10 text-center text-zinc-500 text-sm font-medium italic">Logic: Member not found in registry</p>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500">
                            Module Logical Applicability (Kiosk POS Excluded)
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setNewCode({ ...newCode, applicableModules: [...ELIGIBLE_CASHBACK_MODULES] })
                            }
                            className="text-[10px] font-bold text-[#00B8C8] hover:underline"
                          >
                            All Eligible Modules
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {MODULES.map(mod => (
                            <button
                              key={mod.id}
                              type="button"
                              onClick={() => toggleModule(mod.id)}
                              className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                                (newCode.applicableModules || []).includes(mod.id)
                                  ? 'bg-[#00B8C8]/10 border-[#00B8C8]/50 text-[#0099A8] dark:text-[#00B8C8]'
                                  : isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-500' : 'bg-white border-slate-200 text-slate-400'
                              }`}
                            >
                              <span className="text-[10px] font-black uppercase tracking-tight">{mod.label}</span>
                              {(newCode.applicableModules || []).includes(mod.id) && <div className="w-2 h-2 rounded-full bg-[#00B8C8]" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setIsModalOpen(false);
                        setEditingCode(null);
                      }}
                      className={`flex-1 py-5 rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all border ${
                        isDarkMode ? 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-400' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-500'
                      }`}
                    >
                      Decline
                    </button>
                    <button
                      type="submit"
                      className="flex-[2] bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 py-5 rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all shadow-lg shadow-cyan-500/20 active:scale-[0.98]"
                    >
                      {editingCode ? 'Overwrite Optimization Logic' : 'Initiate Cashback Protocol'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CashbackPage;

