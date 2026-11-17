import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { NotificationCenter } from './NotificationCenter';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  Calendar, Dumbbell, Activity, Ticket, 
  CreditCard, ArrowUpRight, Search, User, 
  Settings, LayoutGrid, BarChart3, 
  ShieldCheck, LogOut, Users, Gift,
  ArrowUp, ArrowDown, CheckCircle2,
  Lock, TrendingUp, TrendingDown, Maximize2
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { db } from '../firebase';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { format } from 'date-fns';
import { openCommandPalette } from './CommandPalette';
import { TenantBrandLockup, VescioNexusLogo } from './VescioNexusLogo';

type CardSize = '1x1' | '2x1' | '1x2';

interface DashboardItem {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  path: string;
  permission?: keyof import('../contexts/FirebaseContext').UserPermissions;
  iconStyle: string;
  stat?: { label: string; value: string; trend?: string };
}

const NEXUS_PRIMARY_ICON_STYLE =
  'bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/25 group-hover:bg-[#00B8C8] group-hover:text-slate-950 transition-all duration-200';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, userProfile, userRole, logout, systemName, systemLogo, formatCurrency, isModuleEnabled, updateEnabledModules } = useFirebase();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [isEditMode, setIsEditMode] = useState(false);
  const [isManageModulesModalOpen, setIsManageModulesModalOpen] = useState(false);
  const [layoutOrder, setLayoutOrder] = useState<string[]>([]);
  const [cardSizes, setCardSizes] = useState<Record<string, CardSize>>({});
  const [searchQuery, setSearchQuery] = useState('');

  const isAdminUser = !userProfile || userProfile.role === 'admin' || userRole === 'admin' || userRole === 'super_admin';

  // Live KPI Firestore States
  const [members, setMembers] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [physioBookings, setPhysioBookings] = useState<any[]>([]);
  const [gymScheduledSessions, setGymScheduledSessions] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const unsub = onSnapshot(doc(db, 'settings', `dashboard_${userProfile.uid}`), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLayoutOrder(data.order || []);
        setCardSizes(data.cardSizes || {});
      }
    }, () => {});
    return () => unsub();
  }, [userProfile?.uid]);

  useEffect(() => {
    if (!user) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(collection(db, 'members'), snap => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {}));

    unsubs.push(onSnapshot(collection(db, 'bookings'), snap => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {}));

    unsubs.push(onSnapshot(collection(db, 'physioBookings'), snap => {
      setPhysioBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {}));

    unsubs.push(onSnapshot(collection(db, 'gym_scheduled_sessions'), snap => {
      setGymScheduledSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {}));

    unsubs.push(onSnapshot(collection(db, 'transactions'), snap => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {}));

    unsubs.push(onSnapshot(collection(db, 'expenses'), snap => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {}));

    return () => unsubs.forEach(u => u());
  }, [user]);

  const saveLayout = async (newOrder: string[], newSizes: Record<string, CardSize>) => {
    if (!userProfile?.uid) return;
    try {
      await setDoc(
        doc(db, 'settings', `dashboard_${userProfile.uid}`),
        { order: newOrder, cardSizes: newSizes },
        { merge: true }
      );
    } catch (e) {
      console.error("Failed to save layout", e);
    }
  };

  // Live KPI Computations
  const liveKpis = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const currentMonthPrefix = format(new Date(), 'yyyy-MM');

    // 1. Active Members
    const realMembers = members.filter(
      m => m.id !== 'walk_in' && m.id !== 'system_walk_in' && !m.isSystemWalkIn && m.memberType !== 'ghost'
    );
    const activeMembersCount = realMembers.filter(m => m.status !== 'inactive').length;

    // 2. Today's Bookings (Courts + Physio + Gym Scheduled Sessions)
    const todayCourts = bookings.filter(b => b.date === todayStr && b.status !== 'cancelled').length;
    const todayPhysio = physioBookings.filter(pb => pb.date === todayStr && pb.status !== 'cancelled').length;
    const todayGymSessions = gymScheduledSessions.filter(gs => gs.date === todayStr && gs.status !== 'cancelled').length;
    const todaysTotalBookings = todayCourts + todayPhysio + todayGymSessions;

    // 3. Gross Revenue (MTD) from transactions inflows
    const mtdRevenue = transactions.reduce((sum, t) => {
      if (t.isReversal) return sum;
      let dateStr = '';
      if (t.createdAt?.seconds) {
        dateStr = format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd');
      } else if (typeof t.date === 'string') {
        dateStr = t.date;
      }
      if (!dateStr.startsWith(currentMonthPrefix)) return sum;
      if (t.direction === 'inflow') {
        return sum + Number(t.amount || 0);
      }
      return sum;
    }, 0);

    // 4. Pending Payables + Unpaid Member Dues
    const pendingExpensesTotal = expenses
      .filter(e => e.status === 'pending')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const unpaidMemberDues = realMembers.reduce((sum, m) => {
      if (m.billingStatus === 'unpaid') {
        const due = Math.max(0, Number(m.expectedFee || 0) - Number(m.totalPaid || 0));
        return sum + due;
      }
      return sum;
    }, 0);

    return {
      activeMembersCount,
      totalRealMembers: realMembers.length,
      todaysTotalBookings,
      todayCourts,
      todayPhysio,
      todayGymSessions,
      mtdRevenue,
      pendingExpensesTotal,
      unpaidMemberDues,
      totalOpenExposure: pendingExpensesTotal + unpaidMemberDues
    };
  }, [members, bookings, physioBookings, gymScheduledSessions, transactions, expenses]);

  const allItems: DashboardItem[] = useMemo(() => [
    {
      id: 'master_calendar',
      label: 'Master Calendar',
      description: 'Unified facility schedule across Courts, Gym & Physiotherapy (Month, Week & Day views).',
      icon: Calendar,
      path: '/master-calendar',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE,
      stat: { label: 'TODAY EVENTS', value: String(liveKpis.todaysTotalBookings), trend: 'Live' }
    },
    { 
      id: 'members', 
      label: 'Central Members', 
      description: 'Manage all profiles, wallets & statements of account.',
      icon: Users,
      path: '/members',
      permission: 'members',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE,
      stat: { label: 'Profiles', value: String(liveKpis.totalRealMembers), trend: 'Live' }
    },
    { 
      id: 'gym', 
      label: 'Gym Module', 
      description: 'Memberships, check-ins, trainers & billing.',
      icon: Dumbbell,
      path: '/gym',
      permission: 'gym',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE,
      stat: { label: 'Active Members', value: String(liveKpis.activeMembersCount), trend: '+Live' }
    },
    { 
      id: 'reservations', 
      label: 'Reservations', 
      description: 'Basketball, Padel & Tennis court bookings.',
      icon: Calendar,
      path: '/reservations',
      permission: 'reservations',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE,
      stat: { label: 'Today Courts', value: String(liveKpis.todayCourts), trend: '+Today' }
    },
    { 
      id: 'physio', 
      label: 'Physiotherapy', 
      description: 'Clinical cases, treatment plans & recovery.',
      icon: Activity,
      path: '/physio',
      permission: 'physio',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE,
      stat: { label: 'Today Sessions', value: String(liveKpis.todayPhysio), trend: '+Today' }
    },
    { 
      id: 'staff', 
      label: 'Access Control', 
      description: 'Staff directory, RBAC permissions & audit logs.',
      icon: ShieldCheck,
      path: '/staff',
      permission: 'staff',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE
    },
    { 
      id: 'hr', 
      label: 'HR System', 
      description: 'Employees, payroll, commissions & attendance.',
      icon: Users,
      path: '/hr',
      permission: 'hr',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE
    },
    { 
      id: 'accounting', 
      label: 'Accounting System', 
      description: 'Dual-Mode GL, LCOA, invoicing, expenses & taxes.',
      icon: BarChart3,
      path: '/accounting',
      permission: 'accounting',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE,
      stat: { label: 'MTD Inflow', value: formatCurrency(liveKpis.mtdRevenue), trend: '+Live' }
    },
    { 
      id: 'cafeteria_pos', 
      label: 'Kiosk POS', 
      description: 'Mini-supermarket, grocery & beverage checkout.',
      icon: CreditCard,
      path: '/pos/cafeteria',
      permission: 'pos',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE
    },
    { 
      id: 'retail_pos', 
      label: 'Retail Shop POS', 
      description: 'Merchandise, medical items & supplements store.',
      icon: CreditCard,
      path: '/pos/retail',
      permission: 'pos',
      iconStyle: NEXUS_PRIMARY_ICON_STYLE
    }
  ], [liveKpis, formatCurrency]);

  const itemsInOrder = useMemo(() => {
    if (!Array.isArray(layoutOrder) || layoutOrder.length === 0) return allItems;
    const itemMap = new Map(allItems.map(item => [item.id, item]));
    const ordered = layoutOrder
      .map(id => itemMap.get(id))
      .filter((item): item is DashboardItem => !!item);
    const remaining = allItems.filter(item => !layoutOrder.includes(item.id));
    return [...ordered, ...remaining];
  }, [layoutOrder, allItems]);

  const filteredItems = useMemo(() => {
    return itemsInOrder.filter(item => {
      const hasPerm = !item.permission || !userProfile || userProfile.role === 'admin' || userProfile.permissions[item.permission];
      if (!hasPerm) return false;
      // When not in Customize Layout mode, hide modules that have been toggled OFF
      if (!isEditMode && !isModuleEnabled(item.id)) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    });
  }, [itemsInOrder, userProfile, searchQuery, isEditMode, isModuleEnabled]);

  const handleToggleModule = async (moduleKey: string) => {
    if (moduleKey === 'members' || moduleKey === 'settings') return;
    const currentlyOn = isModuleEnabled(moduleKey);
    await updateEnabledModules({ [moduleKey]: !currentlyOn });
  };

  const moveItemById = (id: string, direction: 'up' | 'down') => {
    const visibleIds = filteredItems.map(i => i.id);
    const visibleIdx = visibleIds.indexOf(id);
    if (visibleIdx === -1) return;
    const targetVisibleIdx = direction === 'up' ? visibleIdx - 1 : visibleIdx + 1;
    if (targetVisibleIdx < 0 || targetVisibleIdx >= visibleIds.length) return;

    const targetId = visibleIds[targetVisibleIdx];
    const fullIds = itemsInOrder.map(i => i.id);
    const idxA = fullIds.indexOf(id);
    const idxB = fullIds.indexOf(targetId);
    if (idxA === -1 || idxB === -1) return;

    const nextIds = [...fullIds];
    nextIds[idxA] = targetId;
    nextIds[idxB] = id;

    setLayoutOrder(nextIds);
    saveLayout(nextIds, cardSizes);
  };

  const cycleCardSize = (id: string) => {
    const current: CardSize = cardSizes[id] || '1x1';
    const next: CardSize = current === '1x1' ? '2x1' : current === '2x1' ? '1x2' : '1x1';
    const updatedSizes = { ...cardSizes, [id]: next };
    setCardSizes(updatedSizes);
    const orderIds = itemsInOrder.map(i => i.id);
    saveLayout(orderIds, updatedSizes);
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 flex flex-col ${isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans`}>
      {/* Top Navigation Bar */}
      <nav className={`sticky top-0 z-50 border-b flex-none transition-all duration-300 ${isDarkMode ? 'bg-[#05070A]/90 backdrop-blur-xl border-zinc-800/80' : 'bg-white/90 backdrop-blur-xl border-slate-200/80'} px-6 py-3`}>
        <div className="max-w-screen-2xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-10">
            <div className="cursor-pointer" onClick={() => navigate('/')}>
              <TenantBrandLockup
                systemName={systemName}
                systemLogo={systemLogo}
                size="md"
              />
            </div>
            
            <div className="hidden md:flex items-center gap-6">
               <button 
                  onClick={() => navigate('/')} 
                  className={`relative py-2 text-sm font-semibold transition-all whitespace-nowrap ${location.pathname === '/' ? (isDarkMode ? 'text-[#00B8C8]' : 'text-[#0099A8]') : (isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-900')}`}
                >
                  Overview
                  {location.pathname === '/' && (
                    <motion.div layoutId="nav-indicator" className="absolute -bottom-[13px] left-0 right-0 h-0.5 bg-[#00B8C8] rounded-full shadow-[0_0_10px_rgba(0,184,200,0.6)]" />
                  )}
                </button>
               {(!userProfile || userProfile.role === 'admin' || userProfile.permissions.analytics) && (
                 <button 
                    onClick={() => navigate('/analytics')} 
                    className={`relative py-2 text-sm font-semibold transition-all whitespace-nowrap ${location.pathname === '/analytics' ? (isDarkMode ? 'text-[#00B8C8]' : 'text-[#0099A8]') : (isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-900')}`}
                  >
                    Analytics
                    {location.pathname === '/analytics' && (
                      <motion.div layoutId="nav-indicator" className="absolute -bottom-[13px] left-0 right-0 h-0.5 bg-[#00B8C8] rounded-full shadow-[0_0_10px_rgba(0,184,200,0.6)]" />
                    )}
                  </button>
               )}
               {(!userProfile || userProfile.role === 'admin' || userProfile.permissions.settings) && (
                 <button 
                    onClick={() => navigate('/settings')} 
                    className={`relative py-2 text-sm font-semibold transition-all whitespace-nowrap ${location.pathname === '/settings' ? (isDarkMode ? 'text-[#00B8C8]' : 'text-[#0099A8]') : (isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-900')}`}
                  >
                    Settings
                    {location.pathname === '/settings' && (
                      <motion.div layoutId="nav-indicator" className="absolute -bottom-[13px] left-0 right-0 h-0.5 bg-[#00B8C8] rounded-full shadow-[0_0_10px_rgba(0,184,200,0.6)]" />
                    )}
                  </button>
               )}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={openCommandPalette}
              className="hidden md:flex items-center gap-2 h-9 px-3 rounded-lg border text-xs font-bold transition-all bg-[#00B8C8]/10 border-[#00B8C8]/30 text-[#0099A8] dark:text-[#00B8C8] hover:bg-[#00B8C8]/20"
              title="Open Reception Command Palette (Ctrl + K)"
            >
              <Search size={13} />
              <span>Reception Desk</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white dark:bg-[#0B0F17] text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-800">
                Ctrl+K
              </kbd>
            </button>
            <div className="hidden sm:flex relative items-center">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search modules..." 
                className="w-44 h-9 pl-9 pr-3 text-xs rounded-lg border transition-all bg-white dark:bg-[#0B0F17] border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-[#00B8C8] focus:ring-1 focus:ring-[#00B8C8] outline-none"
              />
            </div>
            
            <div className={`h-4 w-px mx-1 ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />
            
            <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />

            <NotificationCenter isDarkMode={isDarkMode} />
            
            <button 
              onClick={logout}
              className={`h-9 w-9 inline-flex items-center justify-center rounded-lg border transition-colors ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-400 hover:border-red-500/40 hover:text-red-400' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-red-500'}`}
              title="Logout"
            >
              <LogOut size={16} />
            </button>
            
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800 hover:border-[#00B8C8]/50' : 'bg-white border-slate-200 hover:border-[#00B8C8]/50'} transition-colors`}>
              <User size={16} className={isDarkMode ? 'text-[#00B8C8]' : 'text-[#0099A8]'} />
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-screen-2xl w-full mx-auto p-6 md:p-10 flex flex-col gap-10">
        
        {/* Page Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Workspace Command</h2>
            <p className={`text-sm mt-1 mb-1 font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Welcome back. Here is your live operational overview.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={openCommandPalette}
              className="flex items-center gap-2 h-9 px-4 rounded-lg text-xs font-semibold transition-colors bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 shadow-sm shadow-cyan-500/15"
            >
              <Search size={14} />
              Quick Action (Ctrl+K)
            </button>
            {isModuleEnabled('coupons') && (
              <button 
                onClick={() => navigate('/coupons')}
                className="flex items-center gap-2 h-9 px-3.5 rounded-lg text-xs font-semibold transition-all border bg-white dark:bg-[#0B0F17] border-slate-200/90 dark:border-zinc-800/90 text-slate-700 dark:text-zinc-200 hover:border-[#00B8C8]/60 dark:hover:border-[#00B8C8]/50"
              >
                <Ticket size={15} className="text-[#00B8C8]" />
                Coupons
              </button>
            )}
            {isModuleEnabled('cashback') && (
              <button 
                onClick={() => navigate('/cashback')}
                className="flex items-center gap-2 h-9 px-3.5 rounded-lg text-xs font-semibold transition-all border bg-white dark:bg-[#0B0F17] border-slate-200/90 dark:border-zinc-800/90 text-slate-700 dark:text-zinc-200 hover:border-[#00B8C8]/60 dark:hover:border-[#00B8C8]/50"
              >
                <Gift size={15} className="text-[#00B8C8]" />
                Cashback
              </button>
            )}
            
            <div className={`w-px h-5 mx-1 hidden sm:block ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />
            
            {isAdminUser && (
              <button
                onClick={() => setIsManageModulesModalOpen(true)}
                className="flex items-center gap-2 h-9 px-3.5 rounded-lg text-xs font-semibold transition-all border bg-white dark:bg-[#0B0F17] border-slate-200/90 dark:border-zinc-800/90 hover:border-[#00B8C8]/60 dark:hover:border-[#00B8C8]/50 text-slate-800 dark:text-zinc-100"
                title="Turn operational modules ON or OFF without deleting Central Members data"
              >
                <LayoutGrid size={15} className="text-[#00B8C8]" />
                Active Modules
              </button>
            )}

            <button 
              onClick={() => setIsEditMode(!isEditMode)}
              className={`flex items-center gap-2 h-9 px-4 rounded-lg text-xs font-semibold transition-all ${
                isEditMode 
                  ? 'bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 shadow-sm shadow-cyan-500/15' 
                  : 'bg-white dark:bg-[#0B0F17] border border-slate-200/90 dark:border-zinc-800/90 hover:border-[#00B8C8]/60 dark:hover:border-[#00B8C8]/50 text-slate-800 dark:text-zinc-100'
              }`}
            >
              {isEditMode ? <CheckCircle2 size={15} className="text-slate-950" /> : <Settings size={15} className="text-[#00B8C8]" />}
              {isEditMode ? 'Done Customizing' : 'Customize Layout'}
            </button>
          </div>
        </header>

        {/* Customize Mode Info Banner */}
        {isEditMode && (
          <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            isDarkMode ? 'bg-[#0B0F17] border-[#00B8C8]/40 text-zinc-200' : 'bg-cyan-50/60 border-cyan-200 text-slate-800'
          }`}>
            <div className="flex items-center gap-3 text-xs">
              <div className="p-2 rounded-xl bg-[#00B8C8]/15 text-[#00B8C8]">
                <Settings size={16} />
              </div>
              <div>
                <p className="font-bold text-sm">Customize Dashboard Layout & Module Visibility</p>
                <p className="text-zinc-400">
                  Reorder cards, resize spans (1x1, 2x1, 1x2), or toggle modules ON/OFF. Turning a module OFF hides its launch card without deleting or hiding any historical records, balances, or SOA entries in Central Members.
                </p>
              </div>
            </div>
            {isAdminUser && (
              <button
                type="button"
                onClick={() => setIsManageModulesModalOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-black uppercase tracking-wider shrink-0"
              >
                All Module Switches
              </button>
            )}
          </div>
        )}

        {/* Modules Grid */}
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 auto-rows-[minmax(190px,auto)] gap-5">
            {filteredItems.map((item, index) => {
              const size: CardSize = cardSizes[item.id] || '1x1';
              const isEnabled = isModuleEnabled(item.id);
              const isCoreLocked = item.id === 'members';
              const spanClass =
                size === '2x1'
                  ? 'sm:col-span-2 lg:col-span-2'
                  : size === '1x2'
                  ? 'row-span-2'
                  : '';

              return (
                <motion.div 
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03, duration: 0.25 }}
                  className={`group relative ${spanClass}`}
                >
                  <div 
                    onClick={() => !isEditMode && isEnabled && navigate(item.path)}
                    className={`h-full rounded-2xl p-6 flex flex-col justify-between bg-white dark:bg-[#0B0F17] border border-slate-200/90 dark:border-zinc-800/90 shadow-sm hover:shadow-md hover:border-[#00B8C8]/60 dark:hover:border-[#00B8C8]/50 transition-all duration-200 ${
                      isEditMode
                        ? `cursor-default ring-2 ${isEnabled ? 'ring-[#00B8C8]/30 border-[#00B8C8]/40' : 'ring-rose-500/30 border-rose-500/30 opacity-60'} scale-[0.99]`
                        : 'cursor-pointer'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-5">
                        <div className={`p-3 rounded-xl ${item.iconStyle}`}>
                          <item.icon size={22} />
                        </div>
                        
                        {isEditMode ? (
                          <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-[#101622] rounded-lg p-1 border border-slate-200 dark:border-zinc-800">
                            {isAdminUser && !isCoreLocked && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleModule(item.id);
                                }}
                                title={isEnabled ? 'Switch Module OFF (Hide from Dashboard)' : 'Switch Module ON (Show on Dashboard)'}
                                className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                                  isEnabled
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25'
                                }`}
                              >
                                {isEnabled ? 'ON' : 'OFF'}
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); cycleCardSize(item.id); }}
                              title="Cycle Card Span (1x1 -> 2x1 Wide -> 1x2 Tall)"
                              className="px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider bg-[#00B8C8]/10 text-[#00B8C8] hover:bg-[#00B8C8]/20 flex items-center gap-1 transition-all"
                            >
                              <Maximize2 size={11} />
                              {size}
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); moveItemById(item.id, 'up'); }}
                              disabled={index === 0}
                              title="Move Left / Up"
                              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-30 transition-all shadow-sm"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); moveItemById(item.id, 'down'); }}
                              disabled={index === filteredItems.length - 1}
                              title="Move Right / Down"
                              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-30 transition-all shadow-sm"
                            >
                              <ArrowDown size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="p-2 rounded-lg opacity-0 translate-x-2 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-200 text-[#0099A8] dark:text-[#00B8C8] bg-[#00B8C8]/10">
                            <ArrowUpRight size={18} />
                          </div>
                        )}
                      </div>
                      
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-bold tracking-tight leading-tight">{item.label}</h3>
                          {isEditMode && !isEnabled && (
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                              Hidden / Off
                            </span>
                          )}
                        </div>
                        <p className={`text-sm leading-relaxed ${size === '1x2' ? '' : 'line-clamp-2'} ${isDarkMode ? 'text-zinc-400 font-medium' : 'text-slate-500 font-medium'}`}>
                          {item.description}
                        </p>
                      </div>
                    </div>

                    {item.stat && !isEditMode && (
                      <div className={`mt-6 pt-5 border-t ${isDarkMode ? 'border-zinc-800/80' : 'border-slate-100'} flex items-center justify-between`}>
                        <span className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>{item.stat.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold tracking-tight font-mono">{item.stat.value}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/20 font-semibold">
                            {item.stat.trend}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Live Analytics Snapshot Section */}
        <section className={`rounded-2xl border p-8 transition-all duration-300 ${isDarkMode ? 'bg-[#0B0F17]/90 border-zinc-800/80 hover:border-cyan-500/30' : 'bg-white border-slate-200/80 hover:shadow-lg hover:shadow-slate-200/40'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/20' : 'bg-cyan-50 text-[#0099A8]'}`}>
                <BarChart3 size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">Live Financial & Operational Snapshot</h3>
                <p className={`text-sm font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Real-time telemetry aggregated from Firestore</p>
              </div>
            </div>
            <button 
              onClick={() => navigate('/analytics')} 
              className={`text-sm font-bold px-5 py-2.5 rounded-xl transition-all border ${
                isDarkMode ? 'bg-[#101622] border-zinc-800 text-zinc-200 hover:border-cyan-500/40 hover:text-[#00B8C8]' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-cyan-500/40'
              }`}
            >
              View Full Reports
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                label: 'Gross Revenue (MTD)',
                value: formatCurrency(liveKpis.mtdRevenue),
                sub: 'Current Month Cash & Bank Inflows',
                isPositive: true
              },
              {
                label: 'Active Members',
                value: String(liveKpis.activeMembersCount),
                sub: `${liveKpis.totalRealMembers} Total Registered Profiles`,
                isPositive: true
              },
              {
                label: "Today's Scheduled Sessions",
                value: String(liveKpis.todaysTotalBookings),
                sub: `${liveKpis.todayCourts} Courts • ${liveKpis.todayPhysio} Physio`,
                isPositive: true
              },
              {
                label: 'Open AR & Pending Payables',
                value: formatCurrency(liveKpis.totalOpenExposure),
                sub: `AR: ${formatCurrency(liveKpis.unpaidMemberDues)} • AP: ${formatCurrency(liveKpis.pendingExpensesTotal)}`,
                isPositive: liveKpis.totalOpenExposure === 0
              },
            ].map((stat, i) => (
              <div key={i} className="flex flex-col gap-2">
                <span className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>{stat.label}</span>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-extrabold tracking-tight font-mono">{stat.value}</span>
                  <span className={`flex items-center gap-1 text-xs font-bold mb-1 ${
                    stat.isPositive 
                      ? (isDarkMode ? 'text-emerald-400' : 'text-emerald-600') 
                      : (isDarkMode ? 'text-amber-400' : 'text-amber-600')
                  }`}>
                    {stat.isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  </span>
                </div>
                <span className="text-[11px] font-medium text-zinc-500">{stat.sub}</span>
              </div>
            ))}
          </div>
        </section>
        
      </main>

      {/* Manage Active Modules (On/Off) Modal */}
      {isManageModulesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className={`w-full max-w-2xl rounded-2xl border p-6 shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto ${
            isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-zinc-800">
              <div>
                <h3 className="text-lg font-extrabold">Manage Active Modules (On / Off)</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Toggle operational modules on or off across the Landing Page and Command Palette.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsManageModulesModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#00B8C8] text-slate-950"
              >
                Done
              </button>
            </div>

            <div className={`p-3.5 rounded-xl border text-xs ${
              isDarkMode ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
              <span className="font-black uppercase tracking-wider block mb-0.5">
                ✓ Non-Destructive Data Safeguard
              </span>
              Switching a module OFF only hides its launch card and navigation shortcuts. It never deletes, alters, or hides any historical records, member wallet balances, check-ins, or Statement of Account (SOA) entries in Central Members or Accounting.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: 'members', label: 'Central Members & SOA', desc: 'Core member registry & 360° SOA (Always Active)', locked: true },
                { key: 'master_calendar', label: 'Master Calendar', desc: 'Unified Courts, Gym & Physio schedule' },
                { key: 'gym', label: 'Gym Module', desc: 'Memberships, check-ins & trainer contracts' },
                { key: 'reservations', label: 'Court Reservations', desc: 'Basketball, Padel & Tennis bookings' },
                { key: 'physio', label: 'Physiotherapy', desc: 'Clinical cases, treatment plans & B2B' },
                { key: 'pos_cafeteria', label: 'Kiosk POS', desc: 'Mini-supermarket, grocery & beverages' },
                { key: 'pos_retail', label: 'Retail Shop POS', desc: 'Merchandise, supplements & medical gear' },
                { key: 'accounting', label: 'Accounting System', desc: 'LCOA ledger, invoicing, expenses & VAT' },
                { key: 'hr', label: 'HR System', desc: 'Employees, payroll & commissions' },
                { key: 'staff', label: 'Access Control', desc: 'Staff directory & RBAC permissions' },
                { key: 'coupons', label: 'Promo Coupons', desc: 'Discount codes (Gym, Courts, Physio, Retail)' },
                { key: 'cashback', label: 'Cashback Rewards', desc: 'Member wallet reward codes' }
              ].map(mod => {
                const enabled = isModuleEnabled(mod.key);
                return (
                  <div
                    key={mod.key}
                    className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                      enabled
                        ? isDarkMode ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'
                        : isDarkMode ? 'bg-zinc-950/60 border-zinc-900 opacity-60' : 'bg-slate-100/60 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">{mod.label}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{mod.desc}</div>
                    </div>
                    {mod.locked ? (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-[#00B8C8]/15 text-[#00B8C8] border border-[#00B8C8]/30 shrink-0">
                        Always On
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleToggleModule(mod.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all shrink-0 border ${
                          enabled
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                            : 'bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/25'
                        }`}
                      >
                        {enabled ? 'ON' : 'OFF'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className={`mt-auto border-t py-8 px-6 ${isDarkMode ? 'border-zinc-900 bg-[#05070A]' : 'border-slate-200 bg-white'}`}>
        <div className="max-w-screen-2xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-6">
            <VescioNexusLogo variant="horizontal" size="sm" showVescioPrefix={true} />
            <div className={`hidden sm:flex items-center gap-6 text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-[#00B8C8]" />
                v2.5.0 (Vescio Nexus ERP)
              </div>
              <div className="flex items-center gap-2">
                <Lock size={14} className="text-[#00B8C8]" />
                AES-256 • Multi-Tenant RBAC
              </div>
            </div>
          </div>
          
          <div className={`flex items-center gap-4 text-xs font-bold ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
            <p>© 2026 {systemName} • Powered by <span className="text-[#00B8C8]">Vescio Nexus</span></p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

