import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  doc,
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  increment
} from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { Member, MemberSubscription, GymPackage, PhysioPackage } from '../types';
import { processLedgerTransaction, stripUndefined } from '../lib/transaction-engine';
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  Calendar,
  Award,
  CreditCard,
  Activity,
  ShoppingBag,
  Dumbbell,
  Clock,
  DollarSign,
  FileText,
  Download,
  CheckCircle2,
  Plus,
  Edit2,
  Trash2,
  Package,
  HeartPulse,
  Layers
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Modal } from './Modal';
import { useTheme } from '../contexts/ThemeContext';

const safeFormatDate = (dateVal: any, pattern = 'MMM dd, yyyy'): string => {
  if (!dateVal) return 'N/A';
  try {
    const d = typeof dateVal?.toDate === 'function' ? dateVal.toDate() : new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return format(d, pattern);
  } catch {
    return String(dateVal);
  }
};

const safeTimestamp = (dateVal: any): number => {
  if (!dateVal) return 0;
  try {
    const d = typeof dateVal?.toDate === 'function' ? dateVal.toDate() : new Date(dateVal);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  } catch {
    return 0;
  }
};

const MemberProfilePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading, formatCurrency, systemName } = useFirebase();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? 'dark' : 'light';

  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'packages' | 'activity_report' | 'soa' | 'bookings' | 'physio' | 'pos' | 'ledger'
  >('overview');

  // Aggregated live data
  const [bookings, setBookings] = useState<any[]>([]);
  const [physioBookings, setPhysioBookings] = useState<any[]>([]);
  const [physioPrograms, setPhysioPrograms] = useState<any[]>([]);
  const [posOrders, setPosOrders] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [gymPackages, setGymPackages] = useState<GymPackage[]>([]);
  const [physioPackages, setPhysioPackages] = useState<PhysioPackage[]>([]);
  const [coaches, setCoaches] = useState<any[]>([]);
  const [therapists, setTherapists] = useState<any[]>([]);

  // SOA Settlement Modal State
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [settlePaymentMethod, setSettlePaymentMethod] = useState<
    'cash' | 'card' | 'transfer' | 'member_balance'
  >('cash');
  const [isSettling, setIsSettling] = useState(false);
  const [selectedSettleIds, setSelectedSettleIds] = useState<string[]>([]);
  const [customSettleAmount, setCustomSettleAmount] = useState<string>('');

  // Assign New Multi-Module Package Modal State
  const [isAssignPkgModalOpen, setIsAssignPkgModalOpen] = useState(false);
  const [assignModule, setAssignModule] = useState<'gym' | 'physio'>('gym');
  const [assignPackageId, setAssignPackageId] = useState('');
  const [assignStartDate, setAssignStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [assignExpiryDate, setAssignExpiryDate] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  );
  const [assignPriceOverride, setAssignPriceOverride] = useState<string>('');
  const [assignDiscountPct, setAssignDiscountPct] = useState<number>(0);
  const [assignBillingMode, setAssignBillingMode] = useState<'paid_now' | 'on_account'>('paid_now');
  const [assignPaymentMethod, setAssignPaymentMethod] = useState<
    'cash' | 'card' | 'transfer' | 'member_balance'
  >('cash');
  const [assignStaffId, setAssignStaffId] = useState('');
  const [isAssigningPkg, setIsAssigningPkg] = useState(false);

  // Edit Existing Subscription Modal State
  const [editingSub, setEditingSub] = useState<MemberSubscription | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    setLoading(true);

    const unsubs: (() => void)[] = [];

    try {
      unsubs.push(
        onSnapshot(
          doc(db, 'members', id),
          snap => {
            if (snap.exists()) {
              setMember({ id: snap.id, ...snap.data() } as Member);
            } else {
              setMember(null);
            }
            setLoading(false);
          },
          err => {
            console.error('Error listening to member profile:', err);
            setLoading(false);
          }
        )
      );
    } catch (e) {
      console.error('Error setting up member listener:', e);
      setLoading(false);
    }

    const safeSub = (q: any, setter: (rows: any[]) => void, label: string) => {
      try {
        unsubs.push(
          onSnapshot(
            q,
            (snap: any) => {
              setter(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
            },
            (err: any) => {
              console.warn(`Resilient fallback for ${label}:`, err);
            }
          )
        );
      } catch (err) {
        console.warn(`Could not subscribe to ${label}:`, err);
      }
    };

    safeSub(query(collection(db, 'bookings'), where('memberId', '==', id)), setBookings, 'bookings');
    safeSub(
      query(collection(db, 'physioBookings'), where('clientId', '==', id)),
      rows => {
        setPhysioBookings(prev => {
          const map = new Map<string, any>();
          prev.forEach(r => map.set(r.id, r));
          rows.forEach(r => map.set(r.id, r));
          return Array.from(map.values());
        });
      },
      'physioBookings(clientId)'
    );
    safeSub(
      query(collection(db, 'physioBookings'), where('memberId', '==', id)),
      rows => {
        setPhysioBookings(prev => {
          const map = new Map<string, any>();
          prev.forEach(r => map.set(r.id, r));
          rows.forEach(r => map.set(r.id, r));
          return Array.from(map.values());
        });
      },
      'physioBookings(memberId)'
    );
    safeSub(
      query(collection(db, 'physioPrograms'), where('clientId', '==', id)),
      setPhysioPrograms,
      'physioPrograms'
    );
    safeSub(query(collection(db, 'orders'), where('memberId', '==', id)), setPosOrders, 'orders');
    safeSub(
      query(collection(db, 'transactions'), where('memberId', '==', id)),
      setTransactions,
      'transactions'
    );
    safeSub(collection(db, 'packages'), setGymPackages, 'packages');
    safeSub(collection(db, 'physio_packages'), setPhysioPackages, 'physio_packages');
    safeSub(collection(db, 'coaches'), setCoaches, 'coaches');
    safeSub(collection(db, 'physiotherapists'), setTherapists, 'physiotherapists');

    return () => {
      unsubs.forEach(u => {
        try {
          u();
        } catch {
          // ignore cleanup error
        }
      });
    };
  }, [user, id]);

  // Unified Active & Historical Subscriptions across Gym & Physiotherapy
  const unifiedSubscriptions = useMemo((): MemberSubscription[] => {
    if (!member) return [];
    const list: MemberSubscription[] = [];
    const seenIds = new Set<string>();

    // 1. Explicit activeSubscriptions array
    (member.activeSubscriptions || []).forEach(sub => {
      if (!sub || !sub.id) return;
      seenIds.add(sub.id);
      list.push({
        ...sub,
        remainingSessions: Math.max(0, Number(sub.totalSessions || 0) - Number(sub.usedSessions || 0))
      });
    });

    // 2. Primary Gym Package (if not already in activeSubscriptions)
    if (member.packageId && member.packageId !== 'walk-in' && member.packageId !== 'free-lance') {
      const hasPrimaryGym = list.some(
        s => s.module === 'gym' && (s.packageId === member.packageId || s.id === `GYM-PRIMARY-${member.id}`)
      );
      if (!hasPrimaryGym) {
        const pkgObj = gymPackages.find(p => p.id === member.packageId);
        const totalSess = Number(pkgObj?.sessions || 12);
        const cycleCheckIns = (member.checkIns || []).filter(ci => {
          if (!member.startDate) return true;
          return ci.date >= member.startDate;
        }).length;
        const usedSess = Number(member.currentCycleCheckIns ?? cycleCheckIns);
        const expected = Number(member.expectedFee ?? pkgObj?.price ?? 0);
        const paid = Number(member.totalPaid ?? 0);
        list.push({
          id: `GYM-PRIMARY-${member.id}`,
          module: 'gym',
          packageId: member.packageId,
          packageName: pkgObj?.name || 'Gym Membership Package',
          totalSessions: totalSess,
          usedSessions: usedSess,
          remainingSessions: Math.max(0, totalSess - usedSess),
          startDate: member.startDate || new Date().toISOString().slice(0, 10),
          expiryDate: member.expiryDate || '',
          price: expected,
          amountPaid: paid,
          billingStatus: member.billingStatus === 'unpaid' ? 'unpaid' : 'paid',
          assignedStaffId: member.assignedCoachId,
          assignedStaffName: member.assignedCoachName,
          status:
            member.status === 'expired' || member.status === 'inactive'
              ? 'expired'
              : 'active'
        });
      }
    }

    // 3. Physiotherapy Active Packages (if not already in activeSubscriptions)
    (member.physioActivePackages || []).forEach(pSub => {
      if (!pSub || seenIds.has(pSub.id)) return;
      const totalSess = Number(pSub.totalSessions || 10);
      const usedSess = Number(pSub.usedSessions || 0);
      list.push({
        id: pSub.id,
        module: 'physio',
        packageId: pSub.packageId,
        packageName: pSub.packageName || 'Physiotherapy Package',
        totalSessions: totalSess,
        usedSessions: usedSess,
        remainingSessions: Math.max(0, totalSess - usedSess),
        startDate: (pSub.purchasedAt || '').slice(0, 10),
        expiryDate: (pSub.expiresAt || '').slice(0, 10),
        price: Number((pSub as any).totalPrice ?? pSub.pricePaid ?? 0),
        amountPaid: Number(pSub.pricePaid ?? 0),
        billingStatus: (pSub as any).billingStatus || 'paid',
        assignedStaffId: (pSub as any).assignedTherapistId || member.assignedPhysiotherapistId,
        assignedStaffName: (pSub as any).assignedTherapistName || member.assignedPhysiotherapistName,
        status: pSub.status === 'completed' ? 'completed' : pSub.status === 'expired' ? 'expired' : 'active'
      });
    });

    return list;
  }, [member, gymPackages]);

  // Statement of Account (SOA) Line Items across all 5 modules
  const soaItems = useMemo(() => {
    if (!member) return [];
    const items: {
      id: string;
      date: string;
      module: 'Gym' | 'Courts' | 'Physiotherapy' | 'POS';
      description: string;
      totalCharge: number;
      amountPaid: number;
      balanceDue: number;
      status: 'paid' | 'partial' | 'unpaid';
      sourceCollection: 'members' | 'bookings' | 'physioBookings' | 'physioPrograms' | 'orders' | 'subscription';
      rawId: string;
    }[] = [];

    // 1. Gym Primary Membership Dues
    if (member.packageId && member.packageId !== 'walk-in') {
      const pkg = gymPackages.find(p => p.id === member.packageId);
      const pkgName = pkg?.name || 'Gym Membership Package';
      const expected = member.expectedFee ?? pkg?.price ?? 0;
      const paid = member.totalPaid || 0;
      const due = member.billingStatus === 'unpaid' ? Math.max(0, expected - paid) : 0;
      if (expected > 0 || paid > 0) {
        items.push({
          id: `gym-${member.id}`,
          date: member.startDate || member.createdAt || new Date().toISOString().split('T')[0],
          module: 'Gym',
          description: `${pkgName} (${member.startDate || 'N/A'} to ${member.expiryDate || 'N/A'})`,
          totalCharge: expected,
          amountPaid: member.billingStatus === 'paid' ? Math.max(paid, expected) : paid,
          balanceDue: due,
          status: due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
          sourceCollection: 'members',
          rawId: member.id
        });
      }
    }

    // 1b. Additional Multi-Module Subscriptions on Account
    (member.activeSubscriptions || []).forEach(sub => {
      if (sub.module === 'gym' && sub.packageId === member.packageId) return;
      const charge = Number(sub.price || 0);
      const paid = Number(sub.amountPaid || 0);
      const due = sub.billingStatus !== 'paid' ? Math.max(0, charge - paid) : 0;
      if (charge > 0 || due > 0) {
        items.push({
          id: `sub-${sub.id}`,
          date: sub.startDate || new Date().toISOString().slice(0, 10),
          module: sub.module === 'physio' ? 'Physiotherapy' : 'Gym',
          description: `Package: ${sub.packageName} (${sub.usedSessions}/${sub.totalSessions} sessions)`,
          totalCharge: charge,
          amountPaid: paid,
          balanceDue: due,
          status: due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
          sourceCollection: 'subscription',
          rawId: sub.id
        });
      }
    });

    // 2. Court Reservations
    bookings.forEach(b => {
      if (b.isDeleted || b.category === 'academy') return;
      const slotCharge = (b.rateApplied ?? b.price ?? 40) / 4;
      const isPaid = b.status === 'paid';
      const paidAmt = isPaid ? slotCharge : Number(b.amountPaid || 0);
      const dueAmt = isPaid ? 0 : Math.max(0, slotCharge - paidAmt);
      items.push({
        id: `court-${b.id}`,
        date: b.date || new Date().toISOString().split('T')[0],
        module: 'Courts',
        description: `Court ${b.courtId || 1} Reservation (${b.time || ''} — 15m slot)`,
        totalCharge: slotCharge,
        amountPaid: paidAmt,
        balanceDue: dueAmt,
        status: dueAmt <= 0 ? 'paid' : paidAmt > 0 ? 'partial' : 'unpaid',
        sourceCollection: 'bookings',
        rawId: b.id
      });
    });

    // 3. Physiotherapy Bookings
    physioBookings.forEach(pb => {
      if (pb.isDeleted || pb.status === 'cancelled') return;
      const cost = Number(pb.cost || 0);
      const isPaid = pb.paymentStatus === 'paid';
      const paidAmt = isPaid ? cost : Number(pb.amountPaid || 0);
      const dueAmt = isPaid ? 0 : Math.max(0, cost - paidAmt);
      items.push({
        id: `physio-b-${pb.id}`,
        date: pb.date || new Date().toISOString().split('T')[0],
        module: 'Physiotherapy',
        description: `Physio Session: ${pb.sessionType || pb.type || 'Treatment'}${pb.injury ? ` (${pb.injury})` : ''}`,
        totalCharge: cost,
        amountPaid: paidAmt,
        balanceDue: dueAmt,
        status: dueAmt <= 0 ? 'paid' : paidAmt > 0 ? 'partial' : 'unpaid',
        sourceCollection: 'physioBookings',
        rawId: pb.id
      });
    });

    // 4. Physiotherapy Treatment Programs
    physioPrograms.forEach(pp => {
      if (pp.isDeleted || pp.status === 'cancelled') return;
      const cost = Number(pp.totalCost || pp.totalPrice || 0);
      if (cost <= 0) return;
      const paidAmt = Number(pp.amountPaid || pp.paidAmount || 0);
      const dueAmt = Math.max(0, cost - paidAmt);
      items.push({
        id: `physio-p-${pp.id}`,
        date: pp.startDate || pp.createdAt || new Date().toISOString().split('T')[0],
        module: 'Physiotherapy',
        description: `Physio Program: ${pp.name || 'Rehab Plan'} (${pp.completedSessions || 0}/${pp.totalSessions || 0} sessions)`,
        totalCharge: cost,
        amountPaid: paidAmt,
        balanceDue: dueAmt,
        status: dueAmt <= 0 ? 'paid' : paidAmt > 0 ? 'partial' : 'unpaid',
        sourceCollection: 'physioPrograms',
        rawId: pp.id
      });
    });

    // 5. POS Orders (Kiosk & Retail)
    posOrders.forEach(order => {
      if (order.status === 'refunded' || order.status === 'voided') return;
      const total = Number(order.total || 0);
      const isOnAccountUnpaid =
        order.paymentMethod === 'on_account' && order.paymentStatus !== 'paid';
      const paidAmt = isOnAccountUnpaid ? Number(order.amountPaid || 0) : total;
      const dueAmt = isOnAccountUnpaid ? Math.max(0, total - paidAmt) : 0;
      const itemSummary = (order.items || [])
        .map((i: any) => `${i.quantity}x ${i.name}`)
        .join(', ');
      items.push({
        id: `pos-${order.id}`,
        date: order.date || order.createdAt || new Date().toISOString(),
        module: 'POS',
        description: `${order.type === 'retail' ? 'Retail Shop' : 'Cafeteria Kiosk'}: ${itemSummary || 'POS Order'}`,
        totalCharge: total,
        amountPaid: paidAmt,
        balanceDue: dueAmt,
        status: dueAmt <= 0 ? 'paid' : paidAmt > 0 ? 'partial' : 'unpaid',
        sourceCollection: 'orders',
        rawId: order.id
      });
    });

    return items.sort((a, b) => safeTimestamp(b.date) - safeTimestamp(a.date));
  }, [member, gymPackages, bookings, physioBookings, physioPrograms, posOrders]);

  const soaTotals = useMemo(() => {
    return soaItems.reduce(
      (acc, item) => {
        acc.totalCharges += item.totalCharge;
        acc.totalPaid += item.amountPaid;
        acc.totalPending += item.balanceDue;
        if (item.module === 'Gym') {
          acc.gymPending += item.balanceDue;
          acc.gymSpent += item.amountPaid;
        }
        if (item.module === 'Courts') {
          acc.courtsPending += item.balanceDue;
          acc.courtsSpent += item.amountPaid;
        }
        if (item.module === 'Physiotherapy') {
          acc.physioPending += item.balanceDue;
          acc.physioSpent += item.amountPaid;
        }
        if (item.module === 'POS') {
          acc.posPending += item.balanceDue;
          acc.posSpent += item.amountPaid;
        }
        return acc;
      },
      {
        totalCharges: 0,
        totalPaid: 0,
        totalPending: 0,
        gymPending: 0,
        courtsPending: 0,
        physioPending: 0,
        posPending: 0,
        gymSpent: 0,
        courtsSpent: 0,
        physioSpent: 0,
        posSpent: 0
      }
    );
  }, [soaItems]);

  // Chronological Premises Activity Log across all modules
  const premisesActivityLog = useMemo(() => {
    if (!member) return [];
    const events: {
      id: string;
      date: string;
      module: 'Gym' | 'Courts' | 'Physiotherapy' | 'Kiosk POS' | 'Retail POS';
      title: string;
      subtitle: string;
      staffOrRoom: string;
      badge: string;
    }[] = [];

    // 1. Gym Check-ins
    (member.checkIns || []).forEach(ci => {
      events.push({
        id: `ci-${ci.id}`,
        date: ci.date,
        module: 'Gym',
        title: 'Gym Training Session Check-In',
        subtitle: ci.participantsCount && ci.participantsCount > 1 ? `Group Session (${ci.participantsCount} clients)` : 'Solo / Package Check-In',
        staffOrRoom: ci.coach ? `Coach: ${ci.coach}` : 'Self Training',
        badge: '-1 Gym Session'
      });
    });

    // 2. Court Reservations
    bookings.forEach(b => {
      if (b.isDeleted) return;
      events.push({
        id: `bk-${b.id}`,
        date: `${b.date}T${b.time || '12:00'}:00`,
        module: 'Courts',
        title: `Court ${b.courtId || 1} Reservation`,
        subtitle: `Slot: ${b.time || 'N/A'} (${b.category || 'Standard'})`,
        staffOrRoom: `Court ${b.courtId || 1}`,
        badge: b.status === 'paid' ? 'Paid' : 'Booked'
      });
    });

    // 3. Physiotherapy Sessions
    physioBookings.forEach(pb => {
      if (pb.isDeleted || pb.status === 'cancelled') return;
      const docObj = therapists.find(t => t.id === pb.therapistId);
      events.push({
        id: `pb-${pb.id}`,
        date: `${pb.date}T${pb.startTime || '10:00'}:00`,
        module: 'Physiotherapy',
        title: `${pb.sessionType || 'Physiotherapy Session'}`,
        subtitle: `${pb.injury || pb.bodyArea || 'Clinical Care'} (${pb.startTime || ''} - ${pb.endTime || ''})`,
        staffOrRoom: docObj ? `Dr. ${docObj.firstName} ${docObj.lastName}` : pb.roomId || 'Clinic',
        badge: pb.status?.toUpperCase() || 'SCHEDULED'
      });
    });

    // 4. POS Purchases (Kiosk & Retail)
    posOrders.forEach(o => {
      if (o.status === 'refunded' || o.status === 'voided') return;
      const summary = (o.items || []).map((i: any) => `${i.quantity}x ${i.name}`).join(', ');
      events.push({
        id: `pos-${o.id}`,
        date: o.date || o.createdAt,
        module: o.type === 'retail' ? 'Retail POS' : 'Kiosk POS',
        title: o.type === 'retail' ? 'Retail Pro-Shop Purchase' : 'Cafeteria Kiosk Order',
        subtitle: summary || 'POS Checkout',
        staffOrRoom: (o.paymentMethod || 'cash').toUpperCase(),
        badge: formatCurrency(Number(o.total || 0))
      });
    });

    return events.sort((a, b) => safeTimestamp(b.date) - safeTimestamp(a.date));
  }, [member, bookings, physioBookings, posOrders, therapists, formatCurrency]);

  const unpaidItems = useMemo(() => soaItems.filter(i => i.balanceDue > 0), [soaItems]);

  const selectedUnpaidItems = useMemo(
    () => unpaidItems.filter(i => selectedSettleIds.includes(i.id)),
    [unpaidItems, selectedSettleIds]
  );

  const selectedMaxDue = useMemo(
    () =>
      Number(
        selectedUnpaidItems
          .reduce((sum, item) => sum + item.balanceDue, 0)
          .toFixed(2)
      ),
    [selectedUnpaidItems]
  );

  const effectiveSettleAmount = useMemo(() => {
    const parsed = parseFloat(customSettleAmount);
    if (!isNaN(parsed) && parsed > 0) {
      return Math.min(Number(parsed.toFixed(2)), selectedMaxDue);
    }
    return selectedMaxDue;
  }, [customSettleAmount, selectedMaxDue]);

  // Assign New Multi-Module Package Handler
  const handleAssignNewPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !member || !assignPackageId) {
      toast.error('Please select a package to assign.');
      return;
    }

    const selectedGymPkg = assignModule === 'gym' ? gymPackages.find(p => p.id === assignPackageId) : null;
    const selectedPhysioPkg = assignModule === 'physio' ? physioPackages.find(p => p.id === assignPackageId) : null;
    const pkgName = selectedGymPkg?.name || selectedPhysioPkg?.name || 'Package';
    const totalSessions = Number(selectedGymPkg?.sessions ?? selectedPhysioPkg?.sessions ?? 10);
    const basePrice = Number(selectedGymPkg?.price ?? selectedPhysioPkg?.price ?? 0);
    const overrideNum = assignPriceOverride !== '' ? parseFloat(assignPriceOverride) : undefined;
    const finalPrice =
      overrideNum !== undefined && !isNaN(overrideNum)
        ? Math.max(0, overrideNum)
        : Math.max(0, Number((basePrice * (1 - (assignDiscountPct || 0) / 100)).toFixed(2)));

    if (
      assignBillingMode === 'paid_now' &&
      assignPaymentMethod === 'member_balance' &&
      (member.balance || 0) < finalPrice
    ) {
      toast.error(`Insufficient wallet balance (${formatCurrency(member.balance || 0)})`);
      return;
    }

    const staffObj =
      assignModule === 'gym'
        ? coaches.find(c => c.id === assignStaffId)
        : therapists.find(t => t.id === assignStaffId);
    const staffName = staffObj
      ? assignModule === 'physio'
        ? `Dr. ${staffObj.firstName} ${staffObj.lastName}`
        : `${staffObj.firstName} ${staffObj.lastName}`
      : undefined;

    const newSub: MemberSubscription = stripUndefined({
      id: `SUB-${Date.now()}`,
      module: assignModule,
      packageId: assignPackageId,
      packageName: pkgName,
      totalSessions,
      usedSessions: 0,
      remainingSessions: totalSessions,
      startDate: assignStartDate,
      expiryDate: assignExpiryDate,
      price: finalPrice,
      amountPaid: assignBillingMode === 'paid_now' ? finalPrice : 0,
      billingStatus: assignBillingMode === 'paid_now' ? 'paid' : 'unpaid',
      assignedStaffId: assignStaffId || undefined,
      assignedStaffName: staffName,
      status: 'active',
      createdAt: new Date().toISOString()
    });

    setIsAssigningPkg(true);
    try {
      const nextActiveSubs = [...(member.activeSubscriptions || []), newSub];
      const memberUpdates: Record<string, any> = {
        activeSubscriptions: nextActiveSubs,
        updatedAt: new Date().toISOString()
      };

      if (assignModule === 'gym') {
        memberUpdates.isGymMember = true;
        if (!member.packageId || member.packageId === 'walk-in' || member.status === 'expired') {
          memberUpdates.packageId = assignPackageId;
          memberUpdates.startDate = assignStartDate;
          memberUpdates.expiryDate = assignExpiryDate;
          memberUpdates.status = 'active';
          memberUpdates.expectedFee = finalPrice;
          memberUpdates.totalPaid = assignBillingMode === 'paid_now' ? finalPrice : 0;
          memberUpdates.billingStatus = assignBillingMode === 'paid_now' ? 'paid' : 'unpaid';
          if (assignStaffId && staffName) {
            memberUpdates.assignedCoachId = assignStaffId;
            memberUpdates.assignedCoachName = staffName;
          }
        }
      } else {
        memberUpdates.isPhysioPatient = true;
        const nextPhysioSubs = [
          ...(member.physioActivePackages || []),
          stripUndefined({
            id: newSub.id,
            packageId: assignPackageId,
            packageName: pkgName,
            sessionType: selectedPhysioPkg?.sessionType || 'Physiotherapy',
            totalSessions,
            usedSessions: 0,
            remainingSessions: totalSessions,
            purchasedAt: assignStartDate,
            expiresAt: assignExpiryDate,
            pricePaid: assignBillingMode === 'paid_now' ? finalPrice : 0,
            totalPrice: finalPrice,
            billingStatus: assignBillingMode === 'paid_now' ? 'paid' : 'unpaid',
            assignedTherapistId: assignStaffId || undefined,
            assignedTherapistName: staffName,
            status: 'active' as const
          })
        ];
        memberUpdates.physioActivePackages = nextPhysioSubs;
      }

      if (assignBillingMode === 'paid_now' && finalPrice > 0) {
        await processLedgerTransaction(
          {
            amount: finalPrice,
            paymentMethod: assignPaymentMethod,
            sourceModule: assignModule === 'gym' ? 'gym' : 'physio',
            cashierId: user.uid,
            transactionType: assignModule === 'gym' ? 'gym_membership' : 'physio_package_sale',
            direction: 'inflow',
            memberId: member.id,
            referenceId: newSub.id,
            notes: `Assigned ${assignModule.toUpperCase()} package "${pkgName}" to ${member.firstName} ${member.lastName}`
          },
          async transaction => {
            const mRef = doc(db, 'members', member.id);
            if (assignPaymentMethod === 'member_balance') {
              memberUpdates.balance = increment(-finalPrice);
              memberUpdates.walletBalance = increment(-finalPrice);
            }
            transaction.update(mRef, stripUndefined(memberUpdates));
          }
        );
      } else {
        await updateDoc(doc(db, 'members', member.id), stripUndefined(memberUpdates));
      }

      toast.success(
        `${assignModule === 'gym' ? 'Gym' : 'Physiotherapy'} package "${pkgName}" assigned to ${member.firstName}`
      );
      setIsAssignPkgModalOpen(false);
      setAssignPackageId('');
      setAssignPriceOverride('');
      setAssignDiscountPct(0);
    } catch (err: any) {
      console.error('Error assigning package:', err);
      toast.error(err?.message || 'Failed to assign package');
    } finally {
      setIsAssigningPkg(false);
    }
  };

  // Save Edited Subscription
  const handleSaveEditedSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member || !editingSub) return;

    try {
      const updatedSub: MemberSubscription = stripUndefined({
        ...editingSub,
        totalSessions: Math.max(1, Number(editingSub.totalSessions) || 1),
        usedSessions: Math.max(0, Number(editingSub.usedSessions) || 0),
        remainingSessions: Math.max(
          0,
          (Number(editingSub.totalSessions) || 1) - (Number(editingSub.usedSessions) || 0)
        )
      });

      const updates: Record<string, any> = {
        updatedAt: new Date().toISOString()
      };

      if (editingSub.id === `GYM-PRIMARY-${member.id}`) {
        updates.startDate = updatedSub.startDate;
        updates.expiryDate = updatedSub.expiryDate;
        updates.currentCycleCheckIns = updatedSub.usedSessions;
        updates.expectedFee = updatedSub.price;
        updates.totalPaid = updatedSub.amountPaid;
        updates.billingStatus = updatedSub.billingStatus === 'paid' ? 'paid' : 'unpaid';
        updates.status = updatedSub.status === 'expired' ? 'expired' : 'active';
      }

      // Sync activeSubscriptions array
      const existingActive = member.activeSubscriptions || [];
      const existsInArray = existingActive.some(s => s.id === updatedSub.id);
      updates.activeSubscriptions = existsInArray
        ? existingActive.map(s => (s.id === updatedSub.id ? updatedSub : s))
        : [...existingActive, updatedSub];

      // Sync physioActivePackages if module === 'physio'
      if (updatedSub.module === 'physio' && member.physioActivePackages) {
        updates.physioActivePackages = member.physioActivePackages.map(ps =>
          ps.id === updatedSub.id
            ? stripUndefined({
                ...ps,
                packageName: updatedSub.packageName,
                totalSessions: updatedSub.totalSessions,
                usedSessions: updatedSub.usedSessions,
                remainingSessions: updatedSub.remainingSessions,
                purchasedAt: updatedSub.startDate,
                expiresAt: updatedSub.expiryDate,
                pricePaid: updatedSub.amountPaid,
                totalPrice: updatedSub.price,
                billingStatus: updatedSub.billingStatus,
                status: updatedSub.status === 'completed' ? 'completed' : updatedSub.status === 'expired' ? 'expired' : 'active'
              })
            : ps
        );
      }

      await updateDoc(doc(db, 'members', member.id), stripUndefined(updates));
      setEditingSub(null);
      toast.success('Package subscription updated');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update package subscription');
    }
  };

  // Delete Subscription from Member Profile
  const handleDeleteSubscription = async (sub: MemberSubscription) => {
    if (!member) return;
    if (!window.confirm(`Remove package "${sub.packageName}" from ${member.firstName}'s profile?`)) {
      return;
    }
    try {
      const updates: Record<string, any> = {
        activeSubscriptions: (member.activeSubscriptions || []).filter(s => s.id !== sub.id),
        updatedAt: new Date().toISOString()
      };

      if (sub.id === `GYM-PRIMARY-${member.id}` || (sub.module === 'gym' && sub.packageId === member.packageId)) {
        updates.packageId = '';
        updates.status = 'inactive';
        updates.billingStatus = 'paid';
      }

      if (sub.module === 'physio' && member.physioActivePackages) {
        updates.physioActivePackages = member.physioActivePackages.filter(p => p.id !== sub.id);
      }

      await updateDoc(doc(db, 'members', member.id), stripUndefined(updates));
      toast.success(`Removed "${sub.packageName}" from member profile`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove package');
    }
  };

  const handleSettleSelectedDues = async () => {
    if (!user || !member || selectedUnpaidItems.length === 0 || effectiveSettleAmount <= 0) return;

    if (settlePaymentMethod === 'member_balance' && (member.balance || 0) < effectiveSettleAmount) {
      toast.error(
        `Insufficient wallet credit (${formatCurrency(member.balance || 0)}) to cover ${formatCurrency(effectiveSettleAmount)}.`
      );
      return;
    }

    setIsSettling(true);
    try {
      await processLedgerTransaction(
        {
          amount: effectiveSettleAmount,
          paymentMethod: settlePaymentMethod,
          sourceModule: 'member_management',
          cashierId: user.uid,
          transactionType: 'soa_consolidated_settlement',
          direction: 'inflow',
          memberId: member.id,
          referenceId: `SOA-${member.id}-${Date.now()}`,
          notes: `SOA Settlement (${effectiveSettleAmount < selectedMaxDue ? 'Partial' : 'Full'}) for ${member.firstName} ${member.lastName}`
        },
        async transaction => {
          const memberRef = doc(db, 'members', member.id);
          const memberUpdates: Record<string, any> = {};

          if (settlePaymentMethod === 'member_balance') {
            memberUpdates.balance = increment(-Number(effectiveSettleAmount));
            memberUpdates.walletBalance = increment(-Number(effectiveSettleAmount));
          }

          let remainingBudget = Number(effectiveSettleAmount);
          let nextActiveSubs = [...(member.activeSubscriptions || [])];

          for (const item of selectedUnpaidItems) {
            if (remainingBudget <= 0) break;
            const allocate = Number(Math.min(remainingBudget, item.balanceDue).toFixed(2));
            remainingBudget = Number((remainingBudget - allocate).toFixed(2));
            const isFullySettled = allocate >= item.balanceDue - 0.009;

            if (item.sourceCollection === 'members') {
              memberUpdates.totalPaid = Number((item.amountPaid + allocate).toFixed(2));
              memberUpdates.billingStatus = isFullySettled ? 'paid' : 'unpaid';
            } else if (item.sourceCollection === 'subscription') {
              nextActiveSubs = nextActiveSubs.map(s =>
                s.id === item.rawId
                  ? {
                      ...s,
                      amountPaid: Number((s.amountPaid + allocate).toFixed(2)),
                      billingStatus: isFullySettled ? 'paid' : 'partial'
                    }
                  : s
              );
              memberUpdates.activeSubscriptions = nextActiveSubs;
            } else if (item.sourceCollection === 'bookings') {
              const bRef = doc(db, 'bookings', item.rawId);
              transaction.update(
                bRef,
                isFullySettled
                  ? {
                      status: 'paid',
                      amountPaid: item.totalCharge,
                      paymentMethod: settlePaymentMethod,
                      paidAt: new Date().toISOString()
                    }
                  : {
                      amountPaid: Number((item.amountPaid + allocate).toFixed(2)),
                      paymentMethod: settlePaymentMethod
                    }
              );
            } else if (item.sourceCollection === 'physioBookings') {
              const pbRef = doc(db, 'physioBookings', item.rawId);
              transaction.update(pbRef, {
                paymentStatus: isFullySettled ? 'paid' : 'partial',
                amountPaid: Number((item.amountPaid + allocate).toFixed(2)),
                paymentMethod: settlePaymentMethod
              });
            } else if (item.sourceCollection === 'physioPrograms') {
              const ppRef = doc(db, 'physioPrograms', item.rawId);
              transaction.update(ppRef, {
                amountPaid: Number((item.amountPaid + allocate).toFixed(2)),
                paidAmount: Number((item.amountPaid + allocate).toFixed(2)),
                paymentStatus: isFullySettled ? 'paid' : 'partial'
              });
            } else if (item.sourceCollection === 'orders') {
              const oRef = doc(db, 'orders', item.rawId);
              transaction.update(oRef, {
                paymentStatus: isFullySettled ? 'paid' : 'partial',
                amountPaid: Number((item.amountPaid + allocate).toFixed(2)),
                settledAt: new Date().toISOString(),
                settledMethod: settlePaymentMethod
              });
            }
          }

          if (Object.keys(memberUpdates).length > 0) {
            transaction.update(memberRef, stripUndefined(memberUpdates));
          }
        }
      );

      toast.success(`Settled ${formatCurrency(effectiveSettleAmount)} for ${member.firstName} ${member.lastName}!`);
      setIsSettleModalOpen(false);
    } catch (error: any) {
      console.error('Error settling SOA dues:', error);
      toast.error('Failed to settle dues: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSettling(false);
    }
  };

  const handleExportActivityAndSOAPdf = () => {
    if (!member) return;
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();

    pdf.setFillColor(11, 15, 23);
    pdf.rect(0, 0, pageWidth, 42, 'F');
    pdf.setTextColor(0, 184, 200);
    pdf.setFontSize(15);
    pdf.setFont('helvetica', 'bold');
    pdf.text((systemName || 'VESCIO NEXUS').toUpperCase(), 14, 17);

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(11);
    pdf.text('MEMBER PREMISES ACTIVITY & STATEMENT OF ACCOUNT (SOA)', 14, 26);

    pdf.setFontSize(8.5);
    pdf.setTextColor(180, 190, 205);
    pdf.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, 14, 34);

    pdf.setTextColor(20, 25, 35);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Member: ${member.firstName} ${member.lastName}`, 14, 52);
    pdf.setFontSize(9.5);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Phone: ${member.phone || 'N/A'}   |   Email: ${member.email || 'N/A'}`, 14, 58);
    pdf.text(
      `Total Lifetime Spent: ${formatCurrency(soaTotals.totalPaid)}   |   Pending Dues: ${formatCurrency(soaTotals.totalPending)}   |   Wallet Credit: ${formatCurrency(member.balance || 0)}`,
      14,
      64
    );

    autoTable(pdf, {
      startY: 70,
      head: [['Date', 'Module', 'Description', 'Charge', 'Paid', 'Balance Due']],
      body: soaItems.map(item => [
        safeFormatDate(item.date, 'yyyy-MM-dd'),
        item.module,
        item.description,
        formatCurrency(item.totalCharge),
        formatCurrency(item.amountPaid),
        formatCurrency(item.balanceDue)
      ]),
      theme: 'grid',
      headStyles: { fillColor: [0, 184, 200], textColor: [5, 7, 10], fontStyle: 'bold' },
      styles: { fontSize: 8 }
    });

    const nextY = (pdf as any).lastAutoTable?.finalY ? (pdf as any).lastAutoTable.finalY + 10 : 140;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Chronological Premises Activity Log', 14, nextY);

    autoTable(pdf, {
      startY: nextY + 4,
      head: [['Date & Time', 'Module', 'Activity', 'Staff / Location', 'Impact']],
      body: premisesActivityLog.map(ev => [
        safeFormatDate(ev.date, 'yyyy-MM-dd HH:mm'),
        ev.module,
        `${ev.title} — ${ev.subtitle}`,
        ev.staffOrRoom,
        ev.badge
      ]),
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 8 }
    });

    pdf.save(`Member_Report_${member.firstName}_${member.lastName}_${format(new Date(), 'yyyyMMdd')}.pdf`);
    toast.success('Member Activity & SOA PDF exported');
  };

  if (authLoading || loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDarkMode ? 'bg-[#05070A] text-white' : 'bg-[#F8FAFC] text-slate-900'}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00B8C8]"></div>
      </div>
    );
  }

  if (!member) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center gap-4 ${isDarkMode ? 'bg-[#05070A] text-white' : 'bg-[#F8FAFC] text-slate-900'}`}>
        <p className="text-lg font-bold">Member profile not found.</p>
        <button
          onClick={() => navigate('/members')}
          className="px-4 py-2 rounded-xl bg-[#00B8C8] text-slate-950 font-bold text-xs"
        >
          Return to Central Members
        </button>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors ${isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans pb-12`}>
      {/* Header */}
      <header className={`sticky top-0 z-40 border-b backdrop-blur-xl ${isDarkMode ? 'bg-[#05070A]/90 border-zinc-800' : 'bg-white/90 border-slate-200'} px-6 py-4`}>
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className={`p-2 rounded-xl border transition-colors ${isDarkMode ? 'border-zinc-800 hover:bg-zinc-900 text-zinc-300' : 'border-slate-200 hover:bg-slate-100 text-slate-700'}`}
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#00B8C8]/15 border border-[#00B8C8]/30 flex items-center justify-center text-[#00B8C8] font-black">
                {(member.firstName || 'M')[0]}
                {(member.lastName || '')[0]}
              </div>
              <div>
                <h1 className="text-lg font-black tracking-tight">
                  {member.firstName} {member.lastName}
                </h1>
                <p className="text-xs text-zinc-400">
                  {member.phone || 'No Phone'} · Central Member 360 Profile
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => {
                setAssignModule('gym');
                setAssignPackageId('');
                setAssignPriceOverride('');
                setIsAssignPkgModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-bold text-xs shadow-sm"
            >
              <Plus size={15} /> Assign New Package (Gym / Physio)
            </button>
            <button
              onClick={handleExportActivityAndSOAPdf}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border font-bold text-xs ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-200 hover:border-[#00B8C8]/50' : 'bg-white border-slate-200 text-slate-800'
              }`}
            >
              <Download size={14} /> Export Activity & SOA PDF
            </button>
            {soaTotals.totalPending > 0 && (
              <button
                onClick={() => {
                  const allIds = unpaidItems.map(i => i.id);
                  setSelectedSettleIds(allIds);
                  setCustomSettleAmount(soaTotals.totalPending.toFixed(2));
                  setIsSettleModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs"
              >
                <DollarSign size={14} /> Settle Dues ({formatCurrency(soaTotals.totalPending)})
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Financial & Premises Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
              Total Lifetime Spent
            </span>
            <div className="text-2xl font-black font-mono text-[#00B8C8] mt-1">
              {formatCurrency(soaTotals.totalPaid)}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              Gym: {formatCurrency(soaTotals.gymSpent)} · Physio: {formatCurrency(soaTotals.physioSpent)}
            </div>
          </div>

          <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
              Courts & POS Lifetime Spent
            </span>
            <div className="text-2xl font-black font-mono text-emerald-400 mt-1">
              {formatCurrency(soaTotals.courtsSpent + soaTotals.posSpent)}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              Courts: {formatCurrency(soaTotals.courtsSpent)} · POS: {formatCurrency(soaTotals.posSpent)}
            </div>
          </div>

          <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
              Current Pending Balance (SOA)
            </span>
            <div className={`text-2xl font-black font-mono mt-1 ${soaTotals.totalPending > 0 ? 'text-amber-500' : 'text-zinc-400'}`}>
              {formatCurrency(soaTotals.totalPending)}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              {unpaidItems.length} unpaid invoice line(s)
            </div>
          </div>

          <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
              Wallet Credit Balance
            </span>
            <div className="text-2xl font-black font-mono text-emerald-500 mt-1">
              {formatCurrency(member.balance || 0)}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">Available across all modules</div>
          </div>

          <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
              Active Packages
            </span>
            <div className="text-2xl font-black font-mono text-[#00B8C8] mt-1">
              {unifiedSubscriptions.filter(s => s.status === 'active').length}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              {unifiedSubscriptions.reduce((s, item) => s + item.remainingSessions, 0)} total remaining sessions
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className={`flex gap-2 p-1.5 rounded-2xl border overflow-x-auto ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
          {[
            { id: 'overview', label: '360° Overview & Packages', icon: Layers },
            { id: 'packages', label: `Active Packages (${unifiedSubscriptions.length})`, icon: Package },
            { id: 'activity_report', label: `Premises Activity Report (${premisesActivityLog.length})`, icon: Activity },
            { id: 'soa', label: `Statement of Account (${soaItems.length})`, icon: FileText },
            { id: 'bookings', label: `Court Bookings (${bookings.length})`, icon: Calendar },
            { id: 'physio', label: `Physio Sessions (${physioBookings.length})`, icon: HeartPulse },
            { id: 'pos', label: `POS Purchases (${posOrders.length})`, icon: ShoppingBag },
            { id: 'ledger', label: `Ledger History (${transactions.length})`, icon: DollarSign }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  activeTab === tab.id
                    ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                    : isDarkMode
                      ? 'text-zinc-400 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon size={14} /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB: OVERVIEW & PACKAGES */}
        {(activeTab === 'overview' || activeTab === 'packages') && (
          <div className="space-y-6">
            {/* Multi-Module Active Subscriptions Section */}
            <div className={`p-6 rounded-2xl border space-y-4 ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black flex items-center gap-2">
                    <Package size={18} className="text-[#00B8C8]" /> Multi-Module Active Packages (Gym & Physiotherapy)
                  </h2>
                  <p className="text-xs text-zinc-400">
                    A single Central Member can hold multiple simultaneous packages across Gym and Physiotherapy. Edit or remove any package below.
                  </p>
                </div>
                <button
                  onClick={() => setIsAssignPkgModalOpen(true)}
                  className="px-3.5 py-2 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-bold text-xs flex items-center gap-1.5"
                >
                  <Plus size={14} /> + Assign New Package
                </button>
              </div>

              {unifiedSubscriptions.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
                  No active Gym or Physiotherapy packages assigned yet. Click &ldquo;+ Assign New Package&rdquo; to add one.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {unifiedSubscriptions.map(sub => {
                    const pct = Math.min(100, Math.round((sub.usedSessions / Math.max(1, sub.totalSessions)) * 100));
                    return (
                      <div
                        key={sub.id}
                        className={`p-4 rounded-2xl border space-y-3 ${
                          isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span
                              className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                                sub.module === 'gym'
                                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                  : 'bg-teal-500/15 text-teal-400 border border-teal-500/30'
                              }`}
                            >
                              {sub.module === 'gym' ? 'Gym Membership' : 'Physiotherapy Package'}
                            </span>
                            <h3 className="text-sm font-black mt-1.5">{sub.packageName}</h3>
                            <p className="text-[11px] text-zinc-400">
                              Valid: {sub.startDate || 'N/A'} → {sub.expiryDate || 'No Expiry'}
                              {sub.assignedStaffName ? ` · Staff: ${sub.assignedStaffName}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditingSub(sub)}
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-[#00B8C8] hover:bg-zinc-800"
                              title="Edit Package Details & Sessions"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteSubscription(sub)}
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-zinc-800"
                              title="Delete / Remove Package"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">
                              Sessions Used: <strong className="text-white font-mono">{sub.usedSessions} / {sub.totalSessions}</strong>
                            </span>
                            <span className="font-mono font-bold text-[#00B8C8]">
                              {sub.remainingSessions} Left
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                            <div className="h-full bg-[#00B8C8]" style={{ width: `${pct}%` }} />
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-zinc-800/80">
                          <span>
                            Fee: <strong className="font-mono">{formatCurrency(sub.price)}</strong> (Paid: {formatCurrency(sub.amountPaid)})
                          </span>
                          <span
                            className={`uppercase font-bold ${
                              sub.billingStatus === 'paid' ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {sub.billingStatus}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Member Personal & Clinical Bio */}
            <div className={`p-6 rounded-2xl border grid grid-cols-2 md:grid-cols-4 gap-4 text-xs ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <div>
                <span className="text-zinc-500 uppercase font-bold block text-[10px]">Date of Birth & Gender</span>
                <span className="font-semibold mt-0.5 block">{member.dob || 'N/A'} {member.gender ? `• ${member.gender}` : ''}</span>
              </div>
              <div>
                <span className="text-zinc-500 uppercase font-bold block text-[10px]">Blood Type & Marital</span>
                <span className="font-semibold mt-0.5 block">{member.bloodType || 'N/A'} {member.maritalStatus ? `• ${member.maritalStatus}` : ''}</span>
              </div>
              <div>
                <span className="text-zinc-500 uppercase font-bold block text-[10px]">Address & Occupation</span>
                <span className="font-semibold mt-0.5 block">{member.address || 'N/A'} {member.occupation ? `• ${member.occupation}` : ''}</span>
              </div>
              <div>
                <span className="text-zinc-500 uppercase font-bold block text-[10px]">Insurance & Emergency Contact</span>
                <span className="font-semibold mt-0.5 block">
                  {member.isInsured ? `Insured (${member.insuranceCompanyName || 'Yes'})` : 'Uninsured'}
                  {member.emergencyContactName ? ` • Emergency: ${member.emergencyContactName}` : ''}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* TAB: PREMISES ACTIVITY REPORT */}
        {activeTab === 'activity_report' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
                <span className="text-[10px] font-bold uppercase text-zinc-400">Gym Check-Ins</span>
                <div className="text-2xl font-black font-mono text-blue-400 mt-1">
                  {(member.checkIns || []).length}
                </div>
              </div>
              <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
                <span className="text-[10px] font-bold uppercase text-zinc-400">Court Reservations</span>
                <div className="text-2xl font-black font-mono text-amber-400 mt-1">
                  {bookings.filter(b => !b.isDeleted).length}
                </div>
              </div>
              <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
                <span className="text-[10px] font-bold uppercase text-zinc-400">Physiotherapy Sessions</span>
                <div className="text-2xl font-black font-mono text-teal-400 mt-1">
                  {physioBookings.filter(pb => !pb.isDeleted && pb.status !== 'cancelled').length}
                </div>
              </div>
              <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
                <span className="text-[10px] font-bold uppercase text-zinc-400">POS Orders (Kiosk & Retail)</span>
                <div className="text-2xl font-black font-mono text-emerald-400 mt-1">
                  {posOrders.filter(o => o.status !== 'refunded' && o.status !== 'voided').length}
                </div>
              </div>
            </div>

            <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-sm font-black">Complete Chronological Premises Activity Log</h3>
                <button
                  onClick={handleExportActivityAndSOAPdf}
                  className="px-3 py-1.5 rounded-lg bg-[#00B8C8]/15 text-[#00B8C8] border border-[#00B8C8]/30 text-xs font-bold flex items-center gap-1.5"
                >
                  <Download size={13} /> Export PDF Report
                </button>
              </div>
              <table className="w-full text-left text-xs">
                <thead className={`uppercase text-[10px] font-bold border-b ${isDarkMode ? 'bg-[#05070A] text-zinc-400 border-zinc-800' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                  <tr>
                    <th className="px-5 py-3.5">Date & Time</th>
                    <th className="px-5 py-3.5">Module</th>
                    <th className="px-5 py-3.5">Activity & Details</th>
                    <th className="px-5 py-3.5">Coach / Therapist / Location</th>
                    <th className="px-5 py-3.5 text-right">Session / Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {premisesActivityLog.map(ev => (
                    <tr key={ev.id} className={isDarkMode ? 'hover:bg-zinc-900/50' : 'hover:bg-slate-50'}>
                      <td className="px-5 py-3.5 font-mono">{safeFormatDate(ev.date, 'MMM dd, yyyy HH:mm')}</td>
                      <td className="px-5 py-3.5 font-bold text-[#00B8C8]">{ev.module}</td>
                      <td className="px-5 py-3.5">
                        <div className="font-bold">{ev.title}</div>
                        <div className="text-zinc-400">{ev.subtitle}</div>
                      </td>
                      <td className="px-5 py-3.5">{ev.staffOrRoom}</td>
                      <td className="px-5 py-3.5 text-right font-mono font-bold">{ev.badge}</td>
                    </tr>
                  ))}
                  {premisesActivityLog.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-zinc-500">
                        No premises activity recorded for this member yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB: STATEMENT OF ACCOUNT (SOA) */}
        {activeTab === 'soa' && (
          <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <table className="w-full text-left text-xs">
              <thead className={`uppercase text-[10px] font-bold border-b ${isDarkMode ? 'bg-[#05070A] text-zinc-400 border-zinc-800' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <tr>
                  <th className="px-5 py-3.5">Date</th>
                  <th className="px-5 py-3.5">Module</th>
                  <th className="px-5 py-3.5">Description</th>
                  <th className="px-5 py-3.5">Total Charge</th>
                  <th className="px-5 py-3.5">Paid</th>
                  <th className="px-5 py-3.5">Balance Due</th>
                  <th className="px-5 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {soaItems.map(item => (
                  <tr key={item.id}>
                    <td className="px-5 py-3.5 font-mono">{safeFormatDate(item.date)}</td>
                    <td className="px-5 py-3.5 font-bold">{item.module}</td>
                    <td className="px-5 py-3.5">{item.description}</td>
                    <td className="px-5 py-3.5 font-mono">{formatCurrency(item.totalCharge)}</td>
                    <td className="px-5 py-3.5 font-mono text-emerald-400">{formatCurrency(item.amountPaid)}</td>
                    <td className="px-5 py-3.5 font-mono font-bold text-amber-400">{formatCurrency(item.balanceDue)}</td>
                    <td className="px-5 py-3.5 uppercase font-bold text-[10px]">
                      <span className={item.status === 'paid' ? 'text-emerald-400' : 'text-amber-400'}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {soaItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-zinc-500">
                      No billing records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB: COURT BOOKINGS */}
        {activeTab === 'bookings' && (
          <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <table className="w-full text-left text-xs">
              <thead className={`uppercase text-[10px] font-bold border-b ${isDarkMode ? 'bg-[#05070A] text-zinc-400 border-zinc-800' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <tr>
                  <th className="px-5 py-3.5">Date</th>
                  <th className="px-5 py-3.5">Time Slot</th>
                  <th className="px-5 py-3.5">Court</th>
                  <th className="px-5 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {bookings.filter(b => !b.isDeleted).map(b => (
                  <tr key={b.id}>
                    <td className="px-5 py-3.5 font-mono">{b.date}</td>
                    <td className="px-5 py-3.5 font-mono">{b.time}</td>
                    <td className="px-5 py-3.5 font-bold">Court {b.courtId || 1}</td>
                    <td className="px-5 py-3.5 uppercase font-bold">{b.status}</td>
                  </tr>
                ))}
                {bookings.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-zinc-500">
                      No court bookings found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB: PHYSIO SESSIONS */}
        {activeTab === 'physio' && (
          <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <table className="w-full text-left text-xs">
              <thead className={`uppercase text-[10px] font-bold border-b ${isDarkMode ? 'bg-[#05070A] text-zinc-400 border-zinc-800' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <tr>
                  <th className="px-5 py-3.5">Date & Time</th>
                  <th className="px-5 py-3.5">Session Type</th>
                  <th className="px-5 py-3.5">Room</th>
                  <th className="px-5 py-3.5">Fee</th>
                  <th className="px-5 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {physioBookings.map(pb => (
                  <tr key={pb.id}>
                    <td className="px-5 py-3.5 font-mono">{pb.date} ({pb.startTime} - {pb.endTime})</td>
                    <td className="px-5 py-3.5 font-bold">{pb.sessionType || pb.type}</td>
                    <td className="px-5 py-3.5">{pb.roomId}</td>
                    <td className="px-5 py-3.5 font-mono">{formatCurrency(pb.cost || 0)}</td>
                    <td className="px-5 py-3.5 uppercase font-bold">{pb.status}</td>
                  </tr>
                ))}
                {physioBookings.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-zinc-500">
                      No physiotherapy sessions recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB: POS PURCHASES */}
        {activeTab === 'pos' && (
          <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <table className="w-full text-left text-xs">
              <thead className={`uppercase text-[10px] font-bold border-b ${isDarkMode ? 'bg-[#05070A] text-zinc-400 border-zinc-800' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <tr>
                  <th className="px-5 py-3.5">Date</th>
                  <th className="px-5 py-3.5">POS Terminal</th>
                  <th className="px-5 py-3.5">Items</th>
                  <th className="px-5 py-3.5">Total</th>
                  <th className="px-5 py-3.5">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {posOrders.map(o => (
                  <tr key={o.id}>
                    <td className="px-5 py-3.5 font-mono">{safeFormatDate(o.date || o.createdAt, 'MMM dd, yyyy HH:mm')}</td>
                    <td className="px-5 py-3.5 font-bold uppercase">{o.type === 'retail' ? 'Retail Shop' : 'Cafeteria Kiosk'}</td>
                    <td className="px-5 py-3.5">{(o.items || []).map((i: any) => `${i.quantity}x ${i.name}`).join(', ')}</td>
                    <td className="px-5 py-3.5 font-mono font-bold text-[#00B8C8]">{formatCurrency(o.total || 0)}</td>
                    <td className="px-5 py-3.5 uppercase">{o.paymentMethod}</td>
                  </tr>
                ))}
                {posOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-zinc-500">
                      No POS orders recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB: LEDGER HISTORY */}
        {activeTab === 'ledger' && (
          <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <table className="w-full text-left text-xs">
              <thead className={`uppercase text-[10px] font-bold border-b ${isDarkMode ? 'bg-[#05070A] text-zinc-400 border-zinc-800' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <tr>
                  <th className="px-5 py-3.5">Date</th>
                  <th className="px-5 py-3.5">Module</th>
                  <th className="px-5 py-3.5">Notes</th>
                  <th className="px-5 py-3.5">Method</th>
                  <th className="px-5 py-3.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {transactions.map(tx => (
                  <tr key={tx.id}>
                    <td className="px-5 py-3.5 font-mono">{safeFormatDate(tx.timestamp || tx.date, 'MMM dd, yyyy HH:mm')}</td>
                    <td className="px-5 py-3.5 uppercase font-bold">{tx.sourceModule}</td>
                    <td className="px-5 py-3.5">{tx.notes || tx.transactionType}</td>
                    <td className="px-5 py-3.5 uppercase">{tx.paymentMethod}</td>
                    <td className="px-5 py-3.5 text-right font-mono font-bold text-emerald-400">{formatCurrency(tx.amount || 0)}</td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-zinc-500">
                      No ledger transactions recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* ASSIGN NEW PACKAGE (GYM / PHYSIOTHERAPY) MODAL */}
      <Modal
        isOpen={isAssignPkgModalOpen}
        onClose={() => setIsAssignPkgModalOpen(false)}
        title={`Assign New Package to ${member.firstName} ${member.lastName}`}
        theme={theme}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleAssignNewPackage} className="space-y-4">
          <div className="flex p-1 rounded-xl bg-zinc-900 border border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setAssignModule('gym');
                setAssignPackageId('');
                setAssignStaffId('');
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase ${
                assignModule === 'gym' ? 'bg-[#00B8C8] text-slate-950' : 'text-zinc-400'
              }`}
            >
              Gym Membership Package
            </button>
            <button
              type="button"
              onClick={() => {
                setAssignModule('physio');
                setAssignPackageId('');
                setAssignStaffId('');
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase ${
                assignModule === 'physio' ? 'bg-[#00B8C8] text-slate-950' : 'text-zinc-400'
              }`}
            >
              Physiotherapy Package
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">
              Select {assignModule === 'gym' ? 'Gym' : 'Physiotherapy'} Package *
            </label>
            <select
              required
              value={assignPackageId}
              onChange={e => setAssignPackageId(e.target.value)}
              className={`w-full p-2.5 rounded-xl border text-xs ${
                theme === 'dark'
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                  : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
              }`}
            >
              <option value="">Choose package...</option>
              {assignModule === 'gym'
                ? gymPackages.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sessions} sessions · {formatCurrency(p.price)})
                    </option>
                  ))
                : physioPackages
                    .filter(p => p.targetType !== 'therapist')
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sessions} sessions · {formatCurrency(p.price)})
                      </option>
                    ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Start Date</label>
              <input
                type="date"
                value={assignStartDate}
                onChange={e => setAssignStartDate(e.target.value)}
                className={`w-full p-2.5 rounded-xl border text-xs ${
                  theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                    : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Expiry Date</label>
              <input
                type="date"
                value={assignExpiryDate}
                onChange={e => setAssignExpiryDate(e.target.value)}
                className={`w-full p-2.5 rounded-xl border text-xs ${
                  theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                    : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Discount (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={assignDiscountPct}
                onChange={e => setAssignDiscountPct(parseFloat(e.target.value) || 0)}
                className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                  theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                    : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Price Override ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Auto"
                value={assignPriceOverride}
                onChange={e => setAssignPriceOverride(e.target.value)}
                className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                  theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                    : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                }`}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">
              Assigned {assignModule === 'gym' ? 'Coach' : 'Physiotherapist'} (Optional)
            </label>
            <select
              value={assignStaffId}
              onChange={e => setAssignStaffId(e.target.value)}
              className={`w-full p-2.5 rounded-xl border text-xs ${
                theme === 'dark'
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                  : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
              }`}
            >
              <option value="">None / Any</option>
              {assignModule === 'gym'
                ? coaches.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))
                : therapists.map(t => (
                    <option key={t.id} value={t.id}>
                      Dr. {t.firstName} {t.lastName}
                    </option>
                  ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAssignBillingMode('paid_now')}
              className={`py-2.5 rounded-xl text-xs font-bold uppercase border ${
                assignBillingMode === 'paid_now'
                  ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8]'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-700'
              }`}
            >
              Paid Now
            </button>
            <button
              type="button"
              onClick={() => setAssignBillingMode('on_account')}
              className={`py-2.5 rounded-xl text-xs font-bold uppercase border ${
                assignBillingMode === 'on_account'
                  ? 'bg-amber-500 text-slate-950 border-amber-500'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-700'
              }`}
            >
              On Account (Unpaid SOA)
            </button>
          </div>

          {assignBillingMode === 'paid_now' && (
            <div className="grid grid-cols-4 gap-2">
              {(['cash', 'card', 'transfer', 'member_balance'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAssignPaymentMethod(m)}
                  className={`py-2 rounded-lg text-[10px] font-bold uppercase border ${
                    assignPaymentMethod === m
                      ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8]'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                  }`}
                >
                  {m === 'member_balance' ? 'Wallet' : m}
                </button>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={isAssigningPkg}
            className="w-full py-3 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] disabled:opacity-50 text-slate-950 font-black text-xs uppercase"
          >
            {isAssigningPkg ? 'Assigning Package...' : 'Confirm & Assign Package'}
          </button>
        </form>
      </Modal>

      {/* EDIT SUBSCRIPTION MODAL */}
      <Modal
        isOpen={!!editingSub}
        onClose={() => setEditingSub(null)}
        title={`Edit Subscription — ${editingSub?.packageName || ''}`}
        theme={theme}
        maxWidth="max-w-md"
      >
        {editingSub && (
          <form onSubmit={handleSaveEditedSubscription} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Used Sessions</label>
                <input
                  type="number"
                  min="0"
                  value={editingSub.usedSessions}
                  onChange={e => setEditingSub({ ...editingSub, usedSessions: parseInt(e.target.value) || 0 })}
                  className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                    theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Total Sessions</label>
                <input
                  type="number"
                  min="1"
                  value={editingSub.totalSessions}
                  onChange={e => setEditingSub({ ...editingSub, totalSessions: parseInt(e.target.value) || 1 })}
                  className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                    theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Start Date</label>
                <input
                  type="date"
                  value={editingSub.startDate}
                  onChange={e => setEditingSub({ ...editingSub, startDate: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={editingSub.expiryDate}
                  onChange={e => setEditingSub({ ...editingSub, expiryDate: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Package Fee ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingSub.price}
                  onChange={e => setEditingSub({ ...editingSub, price: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                    theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Amount Paid ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingSub.amountPaid}
                  onChange={e => setEditingSub({ ...editingSub, amountPaid: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                    theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Billing Status</label>
                <select
                  value={editingSub.billingStatus}
                  onChange={e => setEditingSub({ ...editingSub, billingStatus: e.target.value as any })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">Package Status</label>
                <select
                  value={editingSub.status}
                  onChange={e => setEditingSub({ ...editingSub, status: e.target.value as any })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-[#00B8C8] text-slate-950 font-black text-xs uppercase"
            >
              Save Package Changes
            </button>
          </form>
        )}
      </Modal>

      {/* SOA SETTLEMENT MODAL */}
      <Modal
        isOpen={isSettleModalOpen}
        onClose={() => setIsSettleModalOpen(false)}
        title="Settle Pending SOA Dues"
        theme={theme}
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {unpaidItems.map(item => (
              <label
                key={item.id}
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                    : 'bg-slate-50 border-slate-200 text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedSettleIds.includes(item.id)}
                    onChange={e => {
                      const next = e.target.checked
                        ? [...selectedSettleIds, item.id]
                        : selectedSettleIds.filter(idStr => idStr !== item.id);
                      setSelectedSettleIds(next);
                    }}
                    className="accent-[#00B8C8]"
                  />
                  <span>
                    <strong>{item.module}:</strong> {item.description}
                  </span>
                </span>
                <span className="font-mono font-bold text-amber-400">{formatCurrency(item.balanceDue)}</span>
              </label>
            ))}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-zinc-400 mb-1">
              Amount to Settle Now (Max: {formatCurrency(selectedMaxDue)})
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={selectedMaxDue}
              value={customSettleAmount}
              onChange={e => setCustomSettleAmount(e.target.value)}
              className={`w-full p-2.5 rounded-xl border text-sm font-mono font-bold ${
                theme === 'dark'
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                  : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
              }`}
            />
          </div>

          <div className="grid grid-cols-4 gap-2">
            {(['cash', 'card', 'transfer', 'member_balance'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setSettlePaymentMethod(m)}
                className={`py-2 rounded-lg text-[10px] font-bold uppercase border ${
                  settlePaymentMethod === m
                    ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8]'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                }`}
              >
                {m === 'member_balance' ? 'Wallet' : m}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={isSettling || effectiveSettleAmount <= 0}
            onClick={handleSettleSelectedDues}
            className="w-full py-3 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] disabled:opacity-50 text-slate-950 font-black text-xs uppercase"
          >
            {isSettling ? 'Processing Settlement...' : `Confirm Settlement (${formatCurrency(effectiveSettleAmount)})`}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default MemberProfilePage;
