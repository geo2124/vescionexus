import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { NotificationCenter } from './NotificationCenter';
import { TenantBrandLockup } from './VescioNexusLogo';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { Member, POSOrder, Booking, OperationType } from '../types';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts';
import { 
  TrendingUp, Users, DollarSign, Calendar, ArrowLeft, CreditCard, BookOpen
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, subDays, subMonths } from 'date-fns';
import { FinancialLedger } from './technical/FinancialLedger';

const COLORS = ['#00B8C8', '#0D9488', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];

type TimeRange = '7' | '30' | '90' | '365' | 'all';
type ViewTab = 'insights' | 'ledger';

export const AnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, formatCurrency, handleFirestoreError } = useFirebase();
  const { isDarkMode, toggleDarkMode } = useTheme();

  const [activeTab, setActiveTab] = useState<ViewTab>('insights');
  const [timeRange, setTimeRange] = useState<TimeRange>('30');
  const [members, setMembers] = useState<Member[]>([]);
  const [orders, setOrders] = useState<POSOrder[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [physioBookings, setPhysioBookings] = useState<any[]>([]);
  const [ledgerTxns, setLedgerTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || activeTab !== 'insights') return;
    setLoading(true);

    const getStartDate = () => {
      if (timeRange === 'all') return '1900-01-01';
      return format(subDays(new Date(), parseInt(timeRange)), 'yyyy-MM-dd');
    };

    const startStr = getStartDate();

    const unsubMembers = onSnapshot(collection(db, 'members'), (snapshot) => {
      setMembers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'members'));

    const qOrders = query(collection(db, 'orders'), where('date', '>=', startStr));
    const unsubOrders = onSnapshot(qOrders, (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as POSOrder)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'orders'));

    const qBookings = query(collection(db, 'bookings'), where('date', '>=', startStr));
    const unsubBookings = onSnapshot(qBookings, (snapshot) => {
      setBookings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'bookings'));

    const qPhysio = query(collection(db, 'physioBookings'), where('date', '>=', startStr));
    const unsubPhysioBookings = onSnapshot(qPhysio, (snapshot) => {
      setPhysioBookings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'physioBookings'));

    const unsubTxns = onSnapshot(collection(db, 'transactions'), (snapshot) => {
      const allTxns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      const filtered = allTxns.filter(t => {
        if (t.isReversal || t.direction !== 'inflow') return false;
        const dStr = t.createdAt?.seconds
          ? format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd')
          : (t.date || '');
        return dStr >= startStr;
      });
      setLedgerTxns(filtered);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'transactions'));

    setLoading(false);

    return () => {
      unsubMembers();
      unsubOrders();
      unsubBookings();
      unsubPhysioBookings();
      unsubTxns();
    };
  }, [user, timeRange, activeTab]);

  // Gym & Membership Revenue from transactions
  const gymRevenue = ledgerTxns
    .filter(t => (t.sourceModule === 'gym' || t.sourceModule === 'gym_checkin') && !t.isReversal && t.direction !== 'outflow')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const posRevenue = orders
    .filter(o => o.status !== 'refunded' && o.status !== 'voided')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const courtStandardRevenue = bookings
    .filter(b => b.status !== 'cancelled' && b.category !== 'academy' && !b.isDeleted && !b.isIndividualAccess && b.bookingSubType !== 'individual_access')
    .reduce((sum, b) => sum + Number(b.rateApplied ?? b.price ?? 0) / 4, 0);
  const courtIndividualAccessRevenue = bookings
    .filter(b => b.status !== 'cancelled' && b.category !== 'academy' && !b.isDeleted && (b.isIndividualAccess || b.bookingSubType === 'individual_access'))
    .reduce((sum, b) => sum + Number(b.rateApplied ?? b.price ?? 0) / 4, 0);
  const courtIndividualHalfRevenue = bookings
    .filter(b => b.status !== 'cancelled' && b.category !== 'academy' && !b.isDeleted && (b.isIndividualAccess || b.bookingSubType === 'individual_access') && (b.individualAccessScope === 'Half Court' || b.type === 'HCA' || b.type === 'HCB'))
    .reduce((sum, b) => sum + Number(b.rateApplied ?? b.price ?? 0) / 4, 0);
  const courtIndividualFullRevenue = Math.max(0, courtIndividualAccessRevenue - courtIndividualHalfRevenue);
  const courtRevenue = courtStandardRevenue + courtIndividualAccessRevenue;
  const physioRevenue = physioBookings
    .filter(pb => pb.status !== 'cancelled' && !pb.isDeleted)
    .reduce((sum, pb) => sum + Number(pb.cost ?? pb.price ?? 0), 0);

  const totalRevenue = gymRevenue + posRevenue + courtRevenue + physioRevenue;

  const revenueSources = [
    { name: 'Gym Memberships', value: gymRevenue },
    { name: 'POS Orders', value: posRevenue },
    { name: 'Court Hourly Rentals (7062)', value: courtStandardRevenue },
    { name: 'Court Individual Access (70621)', value: courtIndividualAccessRevenue },
    { name: 'Physio Bookings', value: physioRevenue }
  ].filter(s => s.value > 0);

  // Monthly Revenue Trend (Dynamic)
  const monthlyRevenueData = () => {
    const months: Record<string, number> = {};
    const now = new Date();
    const monthsToDisplay = timeRange === '30' ? 2 : timeRange === '7' ? 1 : timeRange === 'all' ? 12 : Math.ceil(parseInt(timeRange) / 30) + 1;
    
    for (let i = monthsToDisplay - 1; i >= 0; i--) {
      months[format(subMonths(now, i), 'yyyy-MM')] = 0;
    }

    ledgerTxns.filter(t => (t.sourceModule === 'gym' || t.sourceModule === 'gym_checkin') && !t.isReversal && t.direction !== 'outflow').forEach(t => {
      const dStr = t.createdAt?.seconds
        ? format(new Date(t.createdAt.seconds * 1000), 'yyyy-MM-dd')
        : (t.date || '');
      const month = dStr.substring(0, 7);
      if (months[month] !== undefined) months[month] += Number(t.amount || 0);
    });

    orders.filter(o => o.status !== 'refunded' && o.status !== 'voided').forEach(o => {
      const month = (o.date || '').substring(0, 7);
      if (months[month] !== undefined) months[month] += Number(o.total || 0);
    });

    bookings.filter(b => b.status !== 'cancelled' && b.category !== 'academy' && !b.isDeleted).forEach(b => {
      if (!b.date) return;
      const month = b.date.substring(0, 7);
      if (months[month] !== undefined) months[month] += Number(b.rateApplied ?? b.price ?? 0) / 4;
    });

    physioBookings.filter(pb => pb.status !== 'cancelled' && !pb.isDeleted).forEach(pb => {
      if (!pb.date) return;
      const month = pb.date.substring(0, 7);
      if (months[month] !== undefined) months[month] += Number(pb.cost ?? pb.price ?? 0);
    });

    return Object.entries(months).map(([month, amount]) => ({ month, amount }));
  };

  if (loading && activeTab === 'insights') {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDarkMode ? 'bg-[#05070A] text-white' : 'bg-white text-black'}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#00B8C8]"></div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans`}>
      <nav className={`sticky top-0 z-50 border-b ${isDarkMode ? 'bg-[#05070A]/85 border-zinc-800/80' : 'bg-white/85 border-slate-200'} backdrop-blur-md px-6 py-3`}>
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <TenantBrandLockup size="sm" subtitle="Analytics & Financials" />
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
            <NotificationCenter isDarkMode={isDarkMode} />
            <div className={`flex items-center p-1 rounded-xl border transition-all ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-100 border-slate-200'}`}>
              <button
                onClick={() => setActiveTab('insights')}
                className={`flex items-center gap-2 px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${
                  activeTab === 'insights'
                    ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                    : isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <TrendingUp size={16} /> Business Insights
              </button>
              <button
                onClick={() => setActiveTab('ledger')}
                className={`flex items-center gap-2 px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${
                  activeTab === 'ledger'
                    ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                    : isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <BookOpen size={16} /> Live Ledger
              </button>
            </div>
            
            {activeTab === 'insights' && (
              <div className={`flex items-center p-1 rounded-xl border transition-all ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-100 border-slate-200'}`}>
                {[
                  { label: '7D', value: '7' },
                  { label: '30D', value: '30' },
                  { label: '90D', value: '90' },
                  { label: '1Y', value: '365' },
                  { label: 'ALL', value: 'all' }
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTimeRange(opt.value as TimeRange)}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      timeRange === opt.value
                        ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                        : isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </nav>

      {activeTab === 'insights' ? (
        <main className="max-w-7xl mx-auto p-6 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <DollarSign size={24} />
                </div>
              </div>
              <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Revenue</p>
              <h3 className="text-3xl font-black font-mono">{formatCurrency(totalRevenue)}</h3>
            </div>

            <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 rounded-xl bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/25">
                  <Users size={24} />
                </div>
              </div>
              <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Total Members</p>
              <h3 className="text-3xl font-black font-mono">{members.length}</h3>
            </div>

            <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 rounded-xl bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/25">
                  <Calendar size={24} />
                </div>
              </div>
              <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Bookings</p>
              <h3 className="text-3xl font-black font-mono">{bookings.length}</h3>
            </div>

            <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/25">
                  <CreditCard size={24} />
                </div>
              </div>
              <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>Orders</p>
              <h3 className="text-3xl font-black font-mono">{orders.length}</h3>
            </div>
          </div>

          {/* Dedicated Court Revenue Segmentation Card (7062 Standard vs 70621 Individual Access) */}
          <div className={`p-5 rounded-3xl border flex flex-wrap items-center justify-between gap-4 ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#00B8C8] block">Court Revenue Breakdown (LCOA 7062 vs 70621)</span>
              <h4 className="text-sm font-bold mt-0.5">Standard Hourly Court Rentals vs. Walk-In Individual Access (Half / Full Court)</h4>
            </div>
            <div className="flex flex-wrap items-center gap-6 font-mono">
              <div>
                <span className="text-[10px] font-bold uppercase text-zinc-500 block">Standard Rentals (7062)</span>
                <span className="text-lg font-black text-emerald-500">{formatCurrency(courtStandardRevenue)}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-[#00B8C8] block">Individual Access Total (70621)</span>
                <span className="text-lg font-black text-[#00B8C8]">{formatCurrency(courtIndividualAccessRevenue)}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-zinc-500 block">Half Court Access</span>
                <span className="text-sm font-bold text-zinc-300">{formatCurrency(courtIndividualHalfRevenue)}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-zinc-500 block">Full Court Access</span>
                <span className="text-sm font-bold text-zinc-300">{formatCurrency(courtIndividualFullRevenue)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
              <h3 className="text-lg font-bold mb-6">Revenue Trend</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyRevenueData()}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#27272a' : '#e4e4e7'} vertical={false} />
                    <XAxis dataKey="month" stroke={isDarkMode ? '#71717a' : '#a1a1aa'} fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke={isDarkMode ? '#71717a' : '#a1a1aa'} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => formatCurrency(val)} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: isDarkMode ? '#101622' : '#fff', border: isDarkMode ? '1px solid #27272a' : '1px solid #e2e8f0', borderRadius: '12px' }} 
                      itemStyle={{ color: '#00B8C8' }}
                    />
                    <Line type="monotone" dataKey="amount" stroke="#00B8C8" strokeWidth={4} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
              <h3 className="text-lg font-bold mb-6">Revenue by Source</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={revenueSources} cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={8} dataKey="value">
                      {revenueSources.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#101622' : '#fff', borderRadius: '12px' }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </main>
      ) : (
        <FinancialLedger isDarkMode={isDarkMode} />
      )}
    </div>
  );
};

export default AnalyticsPage;
