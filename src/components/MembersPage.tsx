import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Plus, Edit2, Trash2, Home, Activity, Dumbbell, Calendar, CreditCard, FileText } from 'lucide-react';
import { collection, onSnapshot, deleteDoc, doc, setDoc, updateDoc, query, where, increment } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { Member, OperationType, COUNTRIES } from '../types';
import { normalizePhone } from '../lib/firestore-utils';
import { stripUndefined } from '../lib/transaction-engine';
import { Modal } from './Modal';
import { toast } from 'sonner';
import { TenantBrandLockup } from './VescioNexusLogo';

const MembersPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, handleFirestoreError, formatCurrency, systemName, systemLogo } = useFirebase();
  const { isDarkMode: themeDark, toggleDarkMode } = useTheme();
  const theme = themeDark ? 'dark' : 'light';
  const [members, setMembers] = useState<Member[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [physioBookings, setPhysioBookings] = useState<any[]>([]);
  const [physioPrograms, setPhysioPrograms] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [onAccountOrders, setOnAccountOrders] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);

  const [formData, setFormData] = useState<Partial<Member>>({
    firstName: '',
    lastName: '',
    dob: '',
    gender: '',
    nationality: 'Lebanon',
    phone: '',
    email: '',
    allergies: '',
    healthProblems: '',
    height: '',
    weight: '',
    level: 'Novice'
  });

  useEffect(() => {
    if (!user) return;
    const unsubMembers = onSnapshot(collection(db, 'members'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member));
      setMembers(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'members'));

    const unsubBookings = onSnapshot(collection(db, 'bookings'), (snap) => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubPhysioB = onSnapshot(collection(db, 'physioBookings'), (snap) => {
      setPhysioBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubPhysioP = onSnapshot(collection(db, 'physioPrograms'), (snap) => {
      setPhysioPrograms(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubPackages = onSnapshot(collection(db, 'packages'), (snap) => {
      setPackages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), where('paymentMethod', '==', 'on_account')),
      (snap) => {
        setOnAccountOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    );

    return () => {
      unsubMembers();
      unsubBookings();
      unsubPhysioB();
      unsubPhysioP();
      unsubPackages();
      unsubOrders();
    };
  }, [user]);

  const memberDuesMap = useMemo(() => {
    const map: Record<string, { gymDues: number; courtDues: number; physioDues: number; posDues: number; totalDues: number; hasCourtBookings: boolean }> = {};
    const pkgPriceMap: Record<string, number> = {};
    packages.forEach(p => { pkgPriceMap[p.id] = p.price || 0; });

    members.forEach(m => {
      const expectedGym = m.expectedFee ?? (m.packageId ? (pkgPriceMap[m.packageId] || 0) : 0);
      const gymDues = m.billingStatus === 'unpaid' ? Math.max(0, expectedGym - (m.totalPaid || 0)) : 0;
      map[m.id] = { gymDues, courtDues: 0, physioDues: 0, posDues: 0, totalDues: gymDues, hasCourtBookings: false };
    });

    bookings.forEach(b => {
      if (!b.memberId || !map[b.memberId] || b.isDeleted) return;
      map[b.memberId].hasCourtBookings = true;
      if (b.status === 'booked' && b.category !== 'academy') {
        const slotCharge = (b.rateApplied ?? b.price ?? 40) / 4;
        const slotDue = Math.max(0, slotCharge - Number(b.amountPaid || 0));
        map[b.memberId].courtDues += slotDue;
        map[b.memberId].totalDues += slotDue;
      }
    });

    physioBookings.forEach(pb => {
      if (!pb.memberId || !map[pb.memberId] || pb.isDeleted || pb.status === 'cancelled') return;
      if (pb.paymentStatus !== 'paid') {
        const due = Math.max(0, (pb.cost || 0) - (pb.amountPaid || 0));
        map[pb.memberId].physioDues += due;
        map[pb.memberId].totalDues += due;
      }
    });

    physioPrograms.forEach(pp => {
      const mId = pp.memberId || pp.patientId;
      if (!mId || !map[mId] || pp.isDeleted || pp.status === 'cancelled') return;
      const totalCost = pp.totalCost || pp.totalPrice || 0;
      const paid = pp.amountPaid || pp.paidAmount || 0;
      const due = Math.max(0, totalCost - paid);
      if (due > 0) {
        map[mId].physioDues += due;
        map[mId].totalDues += due;
      }
    });

    onAccountOrders.forEach(o => {
      if (!o.memberId || !map[o.memberId] || o.status === 'refunded' || o.status === 'voided') return;
      if (o.paymentStatus === 'unpaid' || o.paymentStatus === 'partial' || o.paymentStatus !== 'paid') {
        const due = Math.max(0, Number(o.total || 0) - Number(o.amountPaid || 0));
        if (due > 0) {
          map[o.memberId].posDues += due;
          map[o.memberId].totalDues += due;
        }
      }
    });

    return map;
  }, [members, bookings, physioBookings, physioPrograms, packages, onAccountOrders]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !formData.firstName || !formData.lastName) return;

    try {
      if (editingMember) {
        await updateDoc(doc(db, 'members', editingMember.id), stripUndefined({ ...formData }));
        toast.success('Member updated successfully');
      } else {
        const normPhone = normalizePhone(formData.phone);
        const fullClean = `${(formData.firstName || '').trim()} ${(formData.lastName || '').trim()}`.trim().toLowerCase();
        const existing = members.find(m => {
          if (m.id === 'walk_in' || m.id === 'system_walk_in' || m.isSystemWalkIn || m.packageId === 'walk-in' || (m as any).isDeleted) return false;
          const mPhone = normalizePhone(m.phone);
          if (normPhone && mPhone && normPhone === mPhone) return true;
          const mFull = `${(m.firstName || '').trim()} ${(m.lastName || '').trim()}`.trim().toLowerCase();
          return fullClean && mFull === fullClean && (!normPhone || !mPhone || normPhone === mPhone);
        });

        if (existing) {
          await updateDoc(doc(db, 'members', existing.id), stripUndefined({
            ...formData,
            memberType: 'full',
            status: existing.status === 'inactive' ? 'active' : (existing.status || 'active'),
            updatedAt: new Date().toISOString()
          }));
          toast.success(`Merged with existing profile for ${existing.firstName} ${existing.lastName}`);
        } else {
          const newId = Date.now().toString();
          await setDoc(doc(db, 'members', newId), stripUndefined({
            ...formData,
            id: newId,
            memberType: 'full',
            status: 'active',
            balance: formData.balance || 0,
            uid: user.uid,
            createdAt: new Date().toISOString()
          }));
          toast.success('Member created successfully');
        }
      }
      setIsModalOpen(false);
      setEditingMember(null);
      setFormData({
        firstName: '', lastName: '', dob: '', gender: '', nationality: 'Lebanon',
        phone: '', email: '', allergies: '', healthProblems: '', height: '', weight: '', level: 'Novice'
      });
    } catch (error) {
      handleFirestoreError(error, editingMember ? OperationType.UPDATE : OperationType.CREATE, 'members');
      toast.error(editingMember ? 'Failed to update member' : 'Failed to create member');
    }
  };

  const handleDelete = async (id: string) => {
    const member = members.find(m => m.id === id);
    const dues = memberDuesMap[id]?.totalDues || 0;
    if (member && (member.billingStatus === 'paid' || (member.totalPaid || 0) > 0 || (member.balance || 0) > 0 || dues > 0)) {
      toast.error('Cannot delete a member with active financial records, pending dues, or wallet balance. Please settle their account first.');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this member?')) return;
    try {
      await deleteDoc(doc(db, 'members', id));
      toast.success('Member deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `members/${id}`);
      toast.error('Failed to delete member');
    }
  };

  const filteredMembers = members.filter(m => {
    if (
      m.id === 'walk_in' ||
      m.id === 'system_walk_in' ||
      m.isSystemWalkIn === true ||
      m.packageId === 'walk-in' ||
      (m as any).isDeleted === true ||
      m.lastName === '(Walk-In)'
    ) {
      return false;
    }
    const q = searchQuery.toLowerCase();
    return (
      `${m.firstName || ''} ${m.lastName || ''}`.toLowerCase().includes(q) ||
      m.phone?.includes(searchQuery) ||
      m.email?.toLowerCase().includes(q)
    );
  });

  if (authLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <div className="min-h-screen flex items-center justify-center">Please sign in.</div>;

  return (
    <div className={`min-h-screen transition-colors ${theme === 'dark' ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans`}>
      <header className={`sticky top-0 z-40 border-b backdrop-blur-xl ${theme === 'dark' ? 'bg-[#05070A]/90 border-zinc-800/80' : 'bg-white/90 border-slate-200/80'} px-6 py-3.5`}>
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <TenantBrandLockup
              systemName={systemName}
              systemLogo={systemLogo}
              size="sm"
              subtitle="Central Members Hub"
            />
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle isDarkMode={themeDark} toggleDarkMode={toggleDarkMode} />
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border focus-within:ring-2 focus-within:ring-cyan-500/40 transition-all ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <Search size={16} className="text-zinc-400" />
              <input 
                type="text" 
                placeholder="Search name, phone, email..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-transparent border-none focus:outline-none text-sm w-52 text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500"
              />
            </div>
            <button 
              onClick={() => {
                setEditingMember(null);
                setFormData({
                  firstName: '', lastName: '', dob: '', gender: '', nationality: 'Lebanon',
                  phone: '', email: '', allergies: '', healthProblems: '', height: '', weight: '', level: 'Novice'
                });
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-4 py-2 rounded-xl text-sm font-bold transition-colors shadow-lg shadow-cyan-500/20"
            >
              <Plus size={16} />
              Add Member
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <div className={`border rounded-2xl overflow-hidden ${theme === 'dark' ? 'bg-[#0B0F17]/90 border-zinc-800/80' : 'bg-white border-slate-200/80'}`}>
          <table className="w-full text-left text-sm">
            <thead className={`text-xs uppercase tracking-wider font-bold ${theme === 'dark' ? 'bg-[#05070A] text-zinc-400 border-zinc-800' : 'bg-slate-50 text-slate-500 border-slate-200'} border-b`}>
              <tr>
                <th className="px-6 py-4">Member</th>
                <th className="px-6 py-4">Contact</th>
                <th className="px-6 py-4">Wallet Credit</th>
                <th className="px-6 py-4">Pending Dues (SOA)</th>
                <th className="px-6 py-4">Active Modules</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800/60' : 'divide-slate-200'}`}>
              {filteredMembers.map(member => {
                const dues = memberDuesMap[member.id] || { gymDues: 0, courtDues: 0, physioDues: 0, posDues: 0, totalDues: 0, hasCourtBookings: false };
                return (
                  <tr key={member.id} className={`group transition-colors ${theme === 'dark' ? 'hover:bg-[#101622]/70' : 'hover:bg-slate-50'}`}>
                    <td className="px-6 py-4">
                      <button onClick={() => navigate(`/members/${member.id}`)} className="font-bold hover:text-[#00B8C8] transition-colors text-left flex items-center gap-2">
                        <span>{member.firstName} {member.lastName}</span>
                        {member.memberType === 'ghost' && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">Auto-Linked</span>
                        )}
                      </button>
                      <div className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>{member.nationality || 'Lebanon'} {member.gender ? `• ${member.gender}` : ''}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div>{member.phone || '-'}</div>
                      <div className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>{member.email || ''}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`font-bold font-mono ${(member.balance || 0) > 0 ? 'text-emerald-500' : (member.balance || 0) < 0 ? 'text-red-500' : 'text-zinc-500'}`}>
                        {formatCurrency(member.balance || 0)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {dues.totalDues > 0 ? (
                        <div>
                          <div className="font-bold font-mono text-amber-500">{formatCurrency(dues.totalDues)}</div>
                          <div className="text-[10px] text-zinc-400">
                            {[
                              dues.gymDues > 0 ? `Gym: ${formatCurrency(dues.gymDues)}` : null,
                              dues.courtDues > 0 ? `Courts: ${formatCurrency(dues.courtDues)}` : null,
                              dues.physioDues > 0 ? `Physio: ${formatCurrency(dues.physioDues)}` : null,
                              dues.posDues > 0 ? `POS: ${formatCurrency(dues.posDues)}` : null
                            ].filter(Boolean).join(' • ')}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-zinc-500">Settled ($0.00)</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {((member.packageId && member.packageId !== 'walk-in' && member.packageId !== 'free-lance') || member.isGymMember) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-500 text-xs font-bold">
                            <Dumbbell size={11} /> Gym
                          </span>
                        )}
                        {dues.hasCourtBookings && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-500 text-xs font-bold">
                            <Calendar size={11} /> Courts
                          </span>
                        )}
                        {member.isPhysioPatient && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 text-red-500 text-xs font-bold">
                            <Activity size={11} /> Physio
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => navigate(`/members/${member.id}`)}
                          className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-blue-900/30 text-blue-400' : 'hover:bg-blue-50 text-blue-600'}`}
                          title="View Statement of Account (SOA)"
                        >
                          <FileText size={16} />
                        </button>
                        <button 
                          onClick={async () => {
                            const amountStr = window.prompt(`Add wallet funds for ${member.firstName} ${member.lastName}:`, "0");
                            if (amountStr !== null) {
                              const parsedAmount = parseFloat(amountStr);
                              if (!isNaN(parsedAmount) && parsedAmount > 0) {
                                try {
                                  const { processLedgerTransaction } = await import('../lib/transaction-engine');
                                  await processLedgerTransaction(
                                    {
                                      amount: parsedAmount,
                                      paymentMethod: 'cash',
                                      sourceModule: 'member_management',
                                      cashierId: user?.uid || 'system',
                                      direction: 'inflow',
                                      transactionType: 'member_topup',
                                      sourceAccount: '531 - Cash Drawer / Register (Caisse)',
                                      destinationAccount: '419 - Member Wallet & Deposits Liability',
                                      memberId: member.id,
                                      notes: `Wallet top-up for ${member.firstName} ${member.lastName}`
                                    },
                                    async (transaction) => {
                                      const memberRef = doc(db, 'members', member.id);
                                      transaction.update(memberRef, {
                                        balance: increment(Number(parsedAmount)),
                                        walletBalance: increment(Number(parsedAmount))
                                      });
                                    }
                                  );
                                  toast.success(`Funds added. New wallet balance: ${formatCurrency((member.balance || 0) + parsedAmount)}`);
                                } catch (e: any) {
                                  toast.error('Failed to add funds: ' + e.message);
                                }
                              }
                            }
                          }}
                          className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-green-900/30 text-green-400 hover:text-green-300' : 'hover:bg-green-50 text-green-500 hover:text-green-600'}`}
                          title="Add Wallet Funds"
                        >
                          <CreditCard size={16} />
                        </button>
                        <button 
                          onClick={() => {
                            setEditingMember(member);
                            setFormData(member);
                            setIsModalOpen(true);
                          }}
                          className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900'}`}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(member.id)}
                          className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-red-900/30 text-red-400 hover:text-red-300' : 'hover:bg-red-50 text-red-500 hover:text-red-600'}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredMembers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                    No members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingMember ? "Edit Member" : "Add Member"} theme={theme}>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">First Name</label>
              <input 
                type="text" 
                value={formData.firstName}
                onChange={e => setFormData({...formData, firstName: e.target.value})}
                required
                className="el-input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Last Name</label>
              <input 
                type="text" 
                value={formData.lastName}
                onChange={e => setFormData({...formData, lastName: e.target.value})}
                required
                className="el-input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Phone</label>
              <input 
                type="tel" 
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
                required
                className="el-input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Email</label>
              <input 
                type="email" 
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
                className="el-input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Wallet Balance ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={formData.balance || 0}
                onChange={e => setFormData({...formData, balance: parseFloat(e.target.value) || 0})}
                className="el-input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Date of Birth</label>
              <input 
                type="date" 
                value={formData.dob}
                onChange={e => setFormData({...formData, dob: e.target.value})}
                className="el-input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Gender</label>
              <select 
                value={formData.gender}
                onChange={e => setFormData({...formData, gender: e.target.value})}
                className="el-select text-slate-900 dark:text-zinc-100 [color-scheme:light] dark:[color-scheme:dark]"
              >
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
          </div>
          <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors shadow-lg shadow-blue-500/20">
            {editingMember ? 'Update Member' : 'Create Member'}
          </button>
        </form>
      </Modal>
    </div>
  );
};

export default MembersPage;
