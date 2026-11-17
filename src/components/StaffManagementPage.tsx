import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { TenantBrandLockup } from './VescioNexusLogo';
import { collection, query, getDocs, doc, setDoc, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { db, firebaseConfig } from '../firebase';
import { Shield, ShieldCheck, UserPlus, Trash2, Edit2, Check, X, ArrowLeft, FileText, Search, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useFirebase, UserProfile, UserPermissions } from '../contexts/FirebaseContext';
import { OperationType } from '../types';
import { logSystemAudit } from '../lib/firestore-utils';

const defaultPermissions: UserPermissions = {
  reservations: false,
  gym: false,
  coupons: false,
  cashback: false,
  physio: false,
  members: true,
  pos: false,
  staff: false,
  hr: false,
  analytics: false,
  settings: false,
  accounting: false,
  accountingAccess: 'real_time',
};

const PERMISSION_KEYS: { key: Exclude<keyof UserPermissions, 'accountingAccess'>; label: string }[] = [
  { key: 'members', label: 'Central Members' },
  { key: 'gym', label: 'Gym Module' },
  { key: 'reservations', label: 'Court Reservations' },
  { key: 'physio', label: 'Physiotherapy' },
  { key: 'pos', label: 'Kiosk & Retail POS' },
  { key: 'coupons', label: 'Coupons Engine' },
  { key: 'cashback', label: 'Cashback Engine' },
  { key: 'accounting', label: 'Accounting System' },
  { key: 'hr', label: 'HR & Payroll' },
  { key: 'analytics', label: 'Analytics Hub' },
  { key: 'staff', label: 'Access Control' },
  { key: 'settings', label: 'Global Settings' },
];

export default function StaffManagementPage() {
  const navigate = useNavigate();
  const { handleFirestoreError, user, formatCurrency } = useFirebase();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [activeTab, setActiveTab] = useState<'staff' | 'audit'>('staff');
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<UserProfile | null>(null);

  // Form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'staff'>('staff');
  const [permissions, setPermissions] = useState<UserPermissions>(defaultPermissions);

  useEffect(() => {
    fetchStaff();
    fetchAuditLogs();
  }, []);

  const fetchStaff = async () => {
    try {
      const q = query(collection(db, 'staff'));
      const snapshot = await getDocs(q);
      const staffData = snapshot.docs.map(doc => doc.data() as UserProfile);
      setStaff(staffData);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'staff');
      toast.error('Failed to load staff members');
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const [sysSnap, txnSnap] = await Promise.all([
        getDocs(query(collection(db, 'system_audit'), orderBy('timestamp', 'desc'), limit(200))),
        getDocs(query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(150)))
      ]);

      const sysEntries = sysSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          timestamp: data.timestamp || new Date().toISOString(),
          action: data.action || 'AUDIT',
          module: data.collectionName || 'system',
          staffId: data.staffId || 'system',
          documentId: data.documentId || '-',
          details: data.details ? JSON.stringify(data.details) : 'System record mutation'
        };
      });

      const txnEntries = txnSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(t => t.isReversal || t.direction === 'outflow' || t.transactionType?.includes('reversal') || t.transactionType?.includes('void') || t.couponCode || t.cashbackCodeId)
        .map(t => {
          const ts = t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : (typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString());
          return {
            id: t.id,
            timestamp: ts,
            action: t.isReversal || t.transactionType?.includes('reversal') ? 'REVERSAL' : 'FINANCIAL_TXN',
            module: t.sourceModule || 'ledger',
            staffId: t.cashierId || 'system',
            documentId: t.referenceId || t.id,
            details: `${t.transactionType || 'txn'} | ${formatCurrency(Math.abs(t.amount || 0))}${t.couponCode ? ` | Promo: ${t.couponCode}` : ''}${t.notes ? ` | ${t.notes}` : ''}`
          };
        });

      const merged = [...sysEntries, ...txnEntries].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setAuditLogs(merged);
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setAuditLoading(false);
    }
  };

  const staffNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    staff.forEach(s => {
      map[s.uid] = s.username;
    });
    return map;
  }, [staff]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      if (auditActionFilter !== 'ALL' && log.action !== auditActionFilter) return false;
      if (!auditSearch.trim()) return true;
      const q = auditSearch.toLowerCase();
      const staffLabel = (staffNameMap[log.staffId] || log.staffId || '').toLowerCase();
      return (
        log.action.toLowerCase().includes(q) ||
        log.module.toLowerCase().includes(q) ||
        staffLabel.includes(q) ||
        log.documentId.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, auditActionFilter, auditSearch, staffNameMap]);

  const handleOpenModal = (staffMember?: UserProfile) => {
    if (staffMember) {
      setEditingStaff(staffMember);
      setUsername(staffMember.username);
      setPassword('');
      setRole(staffMember.role);
      setPermissions({
        ...defaultPermissions,
        ...(staffMember.permissions || {}),
        accountingAccess: staffMember.permissions?.accountingAccess || 'real_time'
      });
    } else {
      setEditingStaff(null);
      setUsername('');
      setPassword('');
      setRole('staff');
      setPermissions(defaultPermissions);
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) {
      toast.error('Username is required');
      return;
    }

    try {
      let uid = editingStaff?.uid;

      if (!editingStaff) {
        if (!password) {
          toast.error('Password is required for new users');
          return;
        }
        const email = `${username}@eliteos.com`;
        const secondaryApp = initializeApp(firebaseConfig, `SecondaryStaffCreationApp_${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);
        try {
          const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
          uid = userCredential.user.uid;
          await signOut(secondaryAuth);
        } finally {
          await deleteApp(secondaryApp);
        }
      }

      if (!uid) throw new Error('No UID available');

      const newProfile: UserProfile = {
        uid,
        username,
        role,
        permissions: role === 'admin' ? {
          reservations: true, gym: true, coupons: true, cashback: true,
          physio: true, members: true, pos: true, staff: true,
          hr: true, analytics: true, settings: true, accounting: true,
          accountingAccess: 'both'
        } : {
          ...permissions,
          accountingAccess: permissions.accounting ? (permissions.accountingAccess || 'real_time') : 'none'
        },
      };

      await setDoc(doc(db, 'staff', uid), newProfile);
      await logSystemAudit({
        action: editingStaff ? 'UPDATE' : 'CREATE',
        collectionName: 'staff',
        documentId: uid,
        staffId: user?.uid || 'admin',
        timestamp: new Date().toISOString(),
        details: { username, role, accountingAccess: newProfile.permissions.accountingAccess }
      });

      toast.success(editingStaff ? 'Staff updated successfully' : 'Staff added successfully');
      setIsModalOpen(false);
      fetchStaff();
      fetchAuditLogs();
    } catch (error: any) {
      handleFirestoreError(error, editingStaff ? OperationType.UPDATE : OperationType.CREATE, 'staff');
      toast.error(error.message || 'Failed to save staff');
    }
  };

  const handleDelete = async (uid: string) => {
    if (window.confirm('Are you sure you want to delete this staff member?')) {
      try {
        await deleteDoc(doc(db, 'staff', uid));
        await logSystemAudit({
          action: 'DELETE',
          collectionName: 'staff',
          documentId: uid,
          staffId: user?.uid || 'admin',
          timestamp: new Date().toISOString()
        });
        toast.success('Staff member deleted');
        fetchStaff();
        fetchAuditLogs();
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `staff/${uid}`);
        toast.error('Failed to delete staff member');
      }
    }
  };

  const togglePermission = (key: Exclude<keyof UserPermissions, 'accountingAccess'>) => {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} p-6 md:p-8 font-sans`}>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <TenantBrandLockup size="sm" subtitle="Access Control & Audit Trail" />
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex p-1 rounded-xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <button
                onClick={() => setActiveTab('staff')}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'staff' ? 'bg-[#00B8C8] text-slate-950 font-semibold shadow-sm' : isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Staff & Roles
              </button>
              <button
                onClick={() => { setActiveTab('audit'); fetchAuditLogs(); }}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${activeTab === 'audit' ? 'bg-[#00B8C8] text-slate-950 font-semibold shadow-sm' : isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-600 hover:text-slate-900'}`}
              >
                <FileText size={14} />
                System Audit Trail
              </button>
            </div>
            <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
            {activeTab === 'staff' && (
              <button
                onClick={() => handleOpenModal()}
                className="bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-5 py-2.5 rounded-xl font-semibold transition-colors flex items-center gap-2 shadow-sm shadow-cyan-500/15 text-sm"
              >
                <UserPlus size={18} />
                Add Staff
              </button>
            )}
          </div>
        </div>

        {activeTab === 'staff' ? (
          loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00B8C8]"></div>
            </div>
          ) : (
            <div className={`rounded-3xl shadow-sm border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200/80'}`}>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`border-b ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                    <th className={`p-6 text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>User</th>
                    <th className={`p-6 text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Role</th>
                    <th className={`p-6 text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Access Level</th>
                    <th className={`p-6 text-xs font-bold uppercase tracking-widest text-right ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Actions</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? 'divide-zinc-800' : 'divide-slate-100'}`}>
                  {staff.map((member, index) => (
                    <tr key={`${member.uid}-${index}`} className={`transition-colors ${isDarkMode ? 'hover:bg-zinc-900/50' : 'hover:bg-slate-50/50'}`}>
                      <td className="p-6">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${member.role === 'admin' ? 'bg-[#00B8C8]/15 text-[#0099A8] dark:text-[#00B8C8]' : (isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-100 text-slate-600')}`}>
                            {member.role === 'admin' ? <ShieldCheck size={20} /> : <Shield size={20} />}
                          </div>
                          <div>
                            <p className={`font-bold ${isDarkMode ? 'text-zinc-100' : 'text-slate-900'}`}>{member.username}</p>
                            <p className={`text-xs font-medium ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>{member.uid.substring(0, 8)}...</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-6">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${member.role === 'admin' ? 'bg-[#00B8C8]/15 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/25' : (isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-100 text-slate-700')}`}>
                          {member.role}
                        </span>
                      </td>
                      <td className="p-6">
                        <div className="flex flex-wrap gap-2">
                          {member.role === 'admin' ? (
                            <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/20">Full System + Dual Accounting</span>
                          ) : (
                            Object.entries(member.permissions || {})
                              .filter(([k, hasAccess]) => k !== 'accountingAccess' && Boolean(hasAccess))
                              .map(([key]) => (
                                <span key={key} className={`text-xs font-bold px-2 py-1 rounded-md capitalize ${isDarkMode ? 'bg-zinc-800 text-zinc-300' : 'text-slate-600 bg-slate-100'}`}>
                                  {key === 'accounting'
                                    ? `Accounting (${member.permissions?.accountingAccess || 'real_time'})`
                                    : key}
                                </span>
                              ))
                          )}
                        </div>
                      </td>
                      <td className="p-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenModal(member)}
                            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'text-zinc-400 hover:text-[#00B8C8] hover:bg-[#00B8C8]/10' : 'text-slate-400 hover:text-[#0099A8] hover:bg-[#00B8C8]/10'}`}
                          >
                            <Edit2 size={18} />
                          </button>
                          {member.username !== 'admin' && (
                            <button
                              onClick={() => handleDelete(member.uid)}
                              className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'text-zinc-400 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {staff.length === 0 && (
                    <tr>
                      <td colSpan={4} className={`p-8 text-center font-medium ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                        No staff members found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className={`rounded-3xl shadow-sm border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200/80'}`}>
            <div className={`p-6 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isDarkMode ? 'border-zinc-800 bg-[#05070A]/60' : 'border-slate-200 bg-slate-50/50'}`}>
              <div className="relative flex-1 max-w-md">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={e => setAuditSearch(e.target.value)}
                  placeholder="Search staff, module, document ID, or details..."
                  className={`w-full pl-10 pr-4 py-2 text-sm rounded-xl border focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none ${isDarkMode ? 'bg-[#05070A] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
                />
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={auditActionFilter}
                  onChange={e => setAuditActionFilter(e.target.value)}
                  className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-xl border focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none ${isDarkMode ? 'bg-[#05070A] border-zinc-800 text-zinc-200' : 'bg-white border-slate-200 text-slate-700'}`}
                >
                  <option value="ALL">All Actions</option>
                  <option value="CREATE">Create</option>
                  <option value="UPDATE">Update</option>
                  <option value="DELETE">Delete</option>
                  <option value="SOFT_DELETE">Soft Delete</option>
                  <option value="RESTORE">Restore</option>
                  <option value="REVERSAL">Financial Reversal</option>
                  <option value="FINANCIAL_TXN">Promo / Financial</option>
                </select>
                <button
                  onClick={fetchAuditLogs}
                  className={`p-2 rounded-xl border transition-colors ${isDarkMode ? 'border-zinc-800 hover:border-[#00B8C8]/50 text-zinc-300' : 'border-slate-200 hover:border-[#00B8C8]/50 text-slate-700'}`}
                  title="Refresh Audit Logs"
                >
                  <RefreshCw size={16} className={auditLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`border-b ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-zinc-500">Timestamp</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-zinc-500">Action</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-zinc-500">Module / Collection</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-zinc-500">Staff / Cashier</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-zinc-500">Reference ID</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-zinc-500">Details</th>
                  </tr>
                </thead>
                <tbody className={`divide-y text-sm ${isDarkMode ? 'divide-zinc-800' : 'divide-slate-100'}`}>
                  {filteredAuditLogs.map((log, idx) => (
                    <tr key={`${log.id}-${idx}`} className={isDarkMode ? 'hover:bg-zinc-800/40' : 'hover:bg-slate-50/70'}>
                      <td className="p-4 font-mono text-xs text-zinc-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider ${
                          log.action.includes('DELETE') || log.action === 'REVERSAL'
                            ? 'bg-red-500/10 text-red-500'
                            : log.action === 'CREATE'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8]'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="p-4 font-semibold capitalize">{log.module}</td>
                      <td className="p-4 font-medium">
                        {staffNameMap[log.staffId] || (log.staffId ? `${log.staffId.slice(0, 8)}...` : 'System')}
                      </td>
                      <td className="p-4 font-mono text-xs text-zinc-500">{log.documentId}</td>
                      <td className="p-4 text-xs max-w-md truncate" title={log.details}>{log.details}</td>
                    </tr>
                  ))}
                  {filteredAuditLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-zinc-500">
                        No audit trail entries match your filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className={`rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto ${isDarkMode ? 'bg-[#101622] border border-zinc-800' : 'bg-white border border-slate-200'}`}>
              <div className={`p-8 border-b flex items-center justify-between sticky top-0 backdrop-blur-md z-10 ${isDarkMode ? 'border-zinc-800 bg-[#101622]/90' : 'border-slate-100 bg-white/90'}`}>
                <h2 className="text-2xl font-extrabold tracking-tight">
                  {editingStaff ? 'Edit Staff Member' : 'Add New Staff'}
                </h2>
                <button onClick={() => setIsModalOpen(false)} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-slate-400 hover:bg-slate-100'}`}>
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={`block text-xs font-bold uppercase tracking-widest mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Username</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={editingStaff?.username === 'admin'}
                      className={`w-full px-4 py-3 border rounded-xl focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] outline-none font-medium disabled:opacity-50 ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
                      placeholder="e.g. john.doe"
                    />
                  </div>
                  {!editingStaff && (
                    <div>
                      <label className={`block text-xs font-bold uppercase tracking-widest mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`w-full px-4 py-3 border rounded-xl focus:ring-1 focus:ring-[#00B8C8] focus:border-[#00B8C8] outline-none font-medium ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
                        placeholder="••••••••"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className={`block text-xs font-bold uppercase tracking-widest mb-4 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Role</label>
                  <div className="flex gap-4">
                    <label className={`flex-1 flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${role === 'admin' ? 'border-[#00B8C8] bg-[#00B8C8]/10' : (isDarkMode ? 'border-zinc-800 hover:border-zinc-700' : 'border-slate-200 hover:border-slate-300')}`}>
                      <input type="radio" name="role" value="admin" checked={role === 'admin'} onChange={() => setRole('admin')} className="sr-only" />
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${role === 'admin' ? 'border-[#00B8C8]' : (isDarkMode ? 'border-zinc-600' : 'border-slate-300')}`}>
                        {role === 'admin' && <div className="w-2.5 h-2.5 rounded-full bg-[#00B8C8]" />}
                      </div>
                      <div>
                        <p className="font-bold">Administrator</p>
                        <p className={`text-xs font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Full access to all modules & accounting modes</p>
                      </div>
                    </label>
                    <label className={`flex-1 flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${role === 'staff' ? 'border-[#00B8C8] bg-[#00B8C8]/10' : (isDarkMode ? 'border-zinc-800 hover:border-zinc-700' : 'border-slate-200 hover:border-slate-300')}`}>
                      <input type="radio" name="role" value="staff" checked={role === 'staff'} onChange={() => setRole('staff')} className="sr-only" />
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${role === 'staff' ? 'border-[#00B8C8]' : (isDarkMode ? 'border-zinc-600' : 'border-slate-300')}`}>
                        {role === 'staff' && <div className="w-2.5 h-2.5 rounded-full bg-[#00B8C8]" />}
                      </div>
                      <div>
                        <p className="font-bold">Staff Member</p>
                        <p className={`text-xs font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Customized module & accounting access</p>
                      </div>
                    </label>
                  </div>
                </div>

                {role === 'staff' && (
                  <div className="space-y-6">
                    <div>
                      <label className={`block text-xs font-bold uppercase tracking-widest mb-4 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Module Access</label>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {PERMISSION_KEYS.map(({ key, label }) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => togglePermission(key)}
                            className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                              permissions[key]
                                ? 'border-[#00B8C8] bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8]'
                                : (isDarkMode ? 'border-zinc-800 bg-[#0B0F17] text-zinc-300 hover:border-zinc-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
                            }`}
                          >
                            <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                              permissions[key] ? 'bg-[#00B8C8] border-[#00B8C8] text-slate-950' : (isDarkMode ? 'border-zinc-600' : 'border-slate-300')
                            }`}>
                              {permissions[key] && <Check size={14} />}
                            </div>
                            <span className="font-bold text-xs">{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {permissions.accounting && (
                      <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                        <label className={`block text-xs font-bold uppercase tracking-widest mb-3 ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>
                          Accounting Mode Sub-Access
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {([
                            { id: 'real_time', title: 'Real-Time Only', desc: 'Standard live ledger & expenses' },
                            { id: 'posting', title: 'Posting Mode Only', desc: 'Batch journal & adjustment mode' },
                            { id: 'both', title: 'Both Modes', desc: 'Can switch between Real-Time & Posting' }
                          ] as const).map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setPermissions(prev => ({ ...prev, accountingAccess: opt.id }))}
                              className={`p-3 rounded-xl border text-left transition-all ${
                                (permissions.accountingAccess || 'real_time') === opt.id
                                  ? 'border-[#00B8C8] bg-[#00B8C8]/15 text-[#0099A8] dark:text-[#00B8C8] shadow-sm'
                                  : (isDarkMode ? 'border-zinc-800 bg-[#05070A] text-zinc-400' : 'border-slate-200 bg-white text-slate-600')
                              }`}
                            >
                              <div className="font-bold text-xs mb-0.5">{opt.title}</div>
                              <div className="text-[11px] opacity-75">{opt.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className={`pt-6 border-t flex justify-end gap-4 ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className={`px-6 py-3 rounded-xl font-bold transition-colors ${isDarkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-3 rounded-xl font-semibold bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 transition-colors shadow-sm shadow-cyan-500/15"
                  >
                    Save Staff Member
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
