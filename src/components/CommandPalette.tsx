import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { useTheme } from '../contexts/ThemeContext';
import { Member, Booking, GymPackage, InventoryItem, CheckIn } from '../types';
import { processLedgerTransaction, processAtomicCheckout, stripUndefined } from '../lib/transaction-engine';
import { logSystemAudit } from '../lib/firestore-utils';
import {
  Search,
  Zap,
  CreditCard,
  ShoppingBag,
  User,
  Calendar,
  Dumbbell,
  Activity,
  BarChart3,
  Users,
  Settings,
  Ticket,
  Gift,
  X,
  CheckCircle2,
  ArrowRight,
  Command,
  QrCode,
  Wallet,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export const openCommandPalette = () => {
  window.dispatchEvent(new CustomEvent('open-command-palette'));
};

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const { user, userProfile, formatCurrency, usdToLbpRate, isModuleEnabled } = useFirebase();
  const { isDarkMode } = useTheme();

  const [isOpen, setIsOpen] = useState(false);
  const [queryStr, setQueryStr] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [activeActionTab, setActiveActionTab] = useState<'none' | 'pay_topup' | 'kiosk_charge'>('none');

  // Inline Quick Pay / Top-Up Form State
  const [payMode, setPayMode] = useState<'gym_dues' | 'court_dues' | 'physio_dues' | 'pos_dues' | 'all_dues' | 'wallet_topup'>('wallet_topup');
  const [payAmountUSD, setPayAmountUSD] = useState<string>('20');
  const [payMethod, setPayMethod] = useState<'cash' | 'card'>('cash');
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Inline Quick Kiosk Charge State
  const [kioskPaymentMethod, setKioskPaymentMethod] = useState<'cash' | 'card' | 'member_balance'>('cash');
  const [selectedKioskItemId, setSelectedKioskItemId] = useState<string>('');
  const [kioskQty, setKioskQty] = useState<number>(1);

  // Live Firestore Data
  const [members, setMembers] = useState<Member[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [packages, setPackages] = useState<GymPackage[]>([]);
  const [kioskItems, setKioskItems] = useState<InventoryItem[]>([]);
  const [physioBookings, setPhysioBookings] = useState<any[]>([]);
  const [coaches, setCoaches] = useState<any[]>([]);
  const [coachContracts, setCoachContracts] = useState<any[]>([]);
  const [gymThirdPartyContracts, setGymThirdPartyContracts] = useState<any[]>([]);
  const [posOrders, setPosOrders] = useState<any[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global Keyboard Shortcut (Ctrl+K / Cmd+K) & Custom Event Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    const handleCustomOpen = () => {
      setIsOpen(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-command-palette', handleCustomOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-command-palette', handleCustomOpen);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQueryStr('');
      setActiveActionTab('none');
    }
  }, [isOpen]);

  // Attach Live Listeners when authenticated
  useEffect(() => {
    if (!user) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(collection(db, 'members'), snap => {
        const list = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) } as Member))
          .filter(
            m =>
              m.id !== 'walk_in' &&
              m.id !== 'system_walk_in' &&
              !m.isSystemWalkIn &&
              !(m as any).isDeleted
          );
        setMembers(list);
      }, () => {})
    );

    unsubs.push(
      onSnapshot(collection(db, 'bookings'), snap => {
        setBookings(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Booking)));
      }, () => {})
    );

    unsubs.push(
      onSnapshot(collection(db, 'packages'), snap => {
        setPackages(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as GymPackage)));
      }, () => {})
    );

    unsubs.push(
      onSnapshot(collection(db, 'inventory'), snap => {
        const allInv = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as InventoryItem));
        setKioskItems(allInv.filter(i => (i.type || i.posType) === 'cafeteria' && i.stock > 0));
      }, () => {})
    );

    unsubs.push(
      onSnapshot(collection(db, 'physioBookings'), snap => {
        setPhysioBookings(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }, () => {})
    );

    unsubs.push(
      onSnapshot(collection(db, 'coaches'), snap => {
        setCoaches(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }, () => {})
    );

    unsubs.push(
      onSnapshot(collection(db, 'coachContracts'), snap => {
        setCoachContracts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }, () => {})
    );

    unsubs.push(
      onSnapshot(collection(db, 'gym_third_party_contracts'), snap => {
        setGymThirdPartyContracts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }, () => {})
    );

    unsubs.push(
      onSnapshot(collection(db, 'orders'), snap => {
        setPosOrders(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }, () => {})
    );

    return () => unsubs.forEach(u => u());
  }, [user]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Compute Member SOA Dues Map
  const memberStatsMap = useMemo(() => {
    const map: Record<
      string,
      {
        gymDues: number;
        courtDues: number;
        physioDues: number;
        posDues: number;
        totalDues: number;
        pkgName: string;
        totalSessions: number;
        usedSessions: number;
        remainingSessions: number;
      }
    > = {};

    const pkgMap = new Map<string, GymPackage>();
    packages.forEach(p => pkgMap.set(p.id, p));

    members.forEach(m => {
      const pkg = m.packageId ? pkgMap.get(m.packageId) : undefined;
      const expectedFee = m.expectedFee ?? (pkg?.price || 0);
      const gymDues = m.billingStatus === 'unpaid' ? Math.max(0, expectedFee - (m.totalPaid || 0)) : 0;
      const totalSessions = pkg?.sessions || 0;
      const usedSessions =
        typeof m.currentCycleCheckIns === 'number'
          ? m.currentCycleCheckIns
          : (m.checkIns || []).filter(ci => !m.startDate || ci.date >= m.startDate).length;
      const remainingSessions = Math.max(0, totalSessions - usedSessions);

      map[m.id] = {
        gymDues,
        courtDues: 0,
        physioDues: 0,
        posDues: 0,
        totalDues: gymDues,
        pkgName: pkg?.name || (m.isGymMember ? 'Custom Package' : 'No Gym Package'),
        totalSessions,
        usedSessions,
        remainingSessions
      };
    });

    bookings.forEach((b: any) => {
      if (!b.memberId || !map[b.memberId] || b.isDeleted || b.status === 'cancelled' || b.category === 'academy') return;
      if (b.status === 'booked') {
        const slotCharge = Math.max(0, (b.rateApplied ?? b.price ?? 40) / 4 - Number(b.amountPaid || 0));
        map[b.memberId].courtDues += slotCharge;
        map[b.memberId].totalDues += slotCharge;
      }
    });

    physioBookings.forEach((pb: any) => {
      const mId = pb.memberId || pb.clientId;
      if (!mId || !map[mId] || pb.isDeleted || pb.status === 'cancelled') return;
      if (pb.paymentStatus !== 'paid') {
        const due = Math.max(0, Number(pb.cost || 0) - Number(pb.amountPaid || 0));
        map[mId].physioDues += due;
        map[mId].totalDues += due;
      }
    });

    posOrders.forEach((o: any) => {
      if (!o.memberId || !map[o.memberId] || o.status === 'refunded' || o.status === 'voided') return;
      if (o.paymentStatus === 'unpaid' || o.paymentStatus === 'partial' || (o.paymentMethod === 'on_account' && o.paymentStatus !== 'paid')) {
        const due = Math.max(0, Number(o.total || 0) - Number(o.amountPaid || 0));
        map[o.memberId].posDues = (map[o.memberId].posDues || 0) + due;
        map[o.memberId].totalDues += due;
      }
    });

    return map;
  }, [members, packages, bookings, physioBookings, posOrders]);

  // Filtered Members
  const filteredMembers = useMemo(() => {
    const q = queryStr.trim().toLowerCase();
    const cleanedQr = q.replace(/^member:/i, '').trim();
    if (!q) return members.slice(0, 8);
    return members
      .filter(m => {
        const fullName = `${m.firstName || ''} ${m.lastName || ''}`.toLowerCase();
        const phone = (m.phone || '').toLowerCase();
        const qr = (m.qrCode || '').toLowerCase();
        const idMatch = m.id.toLowerCase() === cleanedQr || m.id.toLowerCase().includes(q);
        return fullName.includes(q) || phone.includes(q) || qr.includes(q) || idMatch;
      })
      .slice(0, 10);
  }, [members, queryStr]);

  // Auto-select first matching member
  const selectedMember = useMemo(() => {
    if (selectedMemberId) {
      const found = members.find(m => m.id === selectedMemberId);
      if (found) return found;
    }
    return filteredMembers[0] || null;
  }, [selectedMemberId, members, filteredMembers]);

  useEffect(() => {
    if (filteredMembers.length > 0 && (!selectedMemberId || !filteredMembers.some(m => m.id === selectedMemberId))) {
      setSelectedMemberId(filteredMembers[0].id);
    }
  }, [filteredMembers, selectedMemberId]);

  // Update default Quick Pay mode when selectedMember changes
  useEffect(() => {
    if (!selectedMember) return;
    const stats = memberStatsMap[selectedMember.id];
    if (stats && stats.totalDues > 0) {
      if (stats.gymDues > 0 && stats.courtDues === 0 && stats.physioDues === 0 && stats.posDues === 0) {
        setPayMode('gym_dues');
        setPayAmountUSD(String(stats.gymDues.toFixed(2)));
      } else if (stats.courtDues > 0 && stats.gymDues === 0 && stats.physioDues === 0 && stats.posDues === 0) {
        setPayMode('court_dues');
        setPayAmountUSD(String(stats.courtDues.toFixed(2)));
      } else if (stats.physioDues > 0 && stats.gymDues === 0 && stats.courtDues === 0 && stats.posDues === 0) {
        setPayMode('physio_dues');
        setPayAmountUSD(String(stats.physioDues.toFixed(2)));
      } else if (stats.posDues > 0 && stats.gymDues === 0 && stats.courtDues === 0 && stats.physioDues === 0) {
        setPayMode('pos_dues');
        setPayAmountUSD(String(stats.posDues.toFixed(2)));
      } else {
        setPayMode('all_dues');
        setPayAmountUSD(String(stats.totalDues.toFixed(2)));
      }
    } else {
      setPayMode('wallet_topup');
      setPayAmountUSD('20');
    }
    if (kioskItems.length > 0 && !selectedKioskItemId) {
      setSelectedKioskItemId(kioskItems[0].id);
    }
  }, [selectedMember?.id, memberStatsMap, kioskItems]);

  // Filtered Today's Active Court Bookings
  const matchingTodayBookings = useMemo(() => {
    const q = queryStr.trim().toLowerCase();
    const todayActive = bookings.filter(b => b.date === todayStr && b.status !== 'cancelled' && !(b as any).isDeleted);
    if (!q) return todayActive.slice(0, 5);
    return todayActive
      .filter(
        b =>
          (b.name || '').toLowerCase().includes(q) ||
          (b.phone || '').toLowerCase().includes(q) ||
          (b.court || '').toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [bookings, todayStr, queryStr]);

  // Permitted Quick Navigation Modules
  const navModules = useMemo(() => {
    const allMods = [
      { id: 'nav-master-calendar', moduleKey: 'master_calendar', label: 'Master Facility Calendar (All Modules)', path: '/master-calendar', perm: '', category: 'Navigation', icon: Calendar },
      { id: 'nav-gym', moduleKey: 'gym', label: 'Gym Management', path: '/gym', perm: 'gym', category: 'Navigation', icon: Dumbbell },
      { id: 'nav-reservations', moduleKey: 'reservations', label: 'Court Reservations', path: '/reservations', perm: 'reservations', category: 'Navigation', icon: Calendar },
      { id: 'nav-kiosk', moduleKey: 'pos_cafeteria', label: 'Kiosk POS (Supermarket)', path: '/pos/cafeteria', perm: 'pos', category: 'Navigation', icon: ShoppingBag },
      { id: 'nav-retail', moduleKey: 'pos_retail', label: 'Retail Shop POS', path: '/pos/retail', perm: 'pos', category: 'Navigation', icon: CreditCard },
      { id: 'nav-physio', moduleKey: 'physio', label: 'Physiotherapy Clinic', path: '/physio', perm: 'physio', category: 'Navigation', icon: Activity },
      { id: 'nav-members', moduleKey: 'members', label: 'Central Members & SOA', path: '/members', perm: 'members', category: 'Navigation', icon: Users },
      { id: 'nav-accounting', moduleKey: 'accounting', label: 'Accounting & LCOA Ledger', path: '/accounting', perm: 'accounting', category: 'Navigation', icon: BarChart3 },
      { id: 'nav-hr', moduleKey: 'hr', label: 'HR & Payroll Engine', path: '/hr', perm: 'hr', category: 'Navigation', icon: Users },
      { id: 'nav-coupons', moduleKey: 'coupons', label: 'Omnichannel Coupons', path: '/coupons', perm: 'coupons', category: 'Navigation', icon: Ticket },
      { id: 'nav-cashback', moduleKey: 'cashback', label: 'Cashback Rewards', path: '/cashback', perm: 'cashback', category: 'Navigation', icon: Gift },
      { id: 'nav-settings', moduleKey: 'settings', label: 'Global Settings', path: '/settings', perm: 'settings', category: 'Navigation', icon: Settings }
    ];
    const q = queryStr.trim().toLowerCase();
    return allMods.filter(m => {
      if (!isModuleEnabled(m.moduleKey)) return false;
      const hasPerm =
        !m.perm ||
        !userProfile ||
        userProfile.role === 'admin' ||
        (userProfile.permissions as any)?.[m.perm];
      if (!hasPerm) return false;
      if (!q) return true;
      return m.label.toLowerCase().includes(q) || m.path.toLowerCase().includes(q);
    });
  }, [userProfile, queryStr, isModuleEnabled]);

  // ACTION 1: Instant 1-Click Gym Check-In
  const handleInstantGymCheckIn = async (member: Member) => {
    if (!user || isProcessingAction) return;
    const stats = memberStatsMap[member.id];

    if (member.isFrozen) {
      toast.error(`${member.firstName}'s membership is currently FROZEN. Unfreeze first in Gym Module.`);
      return;
    }
    if (!member.packageId) {
      toast.error(`${member.firstName} does not have an active Gym Package assigned.`);
      return;
    }
    if (member.expiryDate && new Date(member.expiryDate).getTime() < new Date(todayStr).getTime()) {
      toast.error(`${member.firstName}'s gym membership expired on ${member.expiryDate}.`);
      return;
    }
    if (stats && stats.totalSessions > 0 && stats.remainingSessions <= 0) {
      toast.error(`${member.firstName} has 0 remaining sessions (${stats.usedSessions}/${stats.totalSessions} used).`);
      return;
    }

    setIsProcessingAction(true);
    try {
      const nowIso = new Date().toISOString();
      const assignedCoachName = member.assignedCoachName || 'Gym Floor';
      const newCheckIn: CheckIn = stripUndefined({
        id: Date.now().toString(),
        memberId: member.id,
        date: nowIso,
        coach: member.assignedCoachId || assignedCoachName,
        coachId: member.assignedCoachId || '',
        clientName: `${member.firstName} ${member.lastName}`
      });

      const nextCycleCheckIns = (stats?.usedSessions ?? (member.currentCycleCheckIns || 0)) + 1;
      const updatedCheckIns = stripUndefined([...(member.checkIns || []), newCheckIn]);

      await updateDoc(doc(db, 'members', member.id), stripUndefined({
        checkIns: updatedCheckIns,
        currentCycleCheckIns: nextCycleCheckIns
      }));

      await setDoc(doc(db, `members/${member.id}/checkIns`, newCheckIn.id), stripUndefined({
        memberId: member.id,
        date: nowIso.split('T')[0],
        time: nowIso.split('T')[1].slice(0, 5),
        serviceType: 'gym',
        coachId: member.assignedCoachId || null,
        createdAt: nowIso,
        createdBy: user.uid,
        source: 'command_palette_checkin'
      }));

      // Increment coach monthly sessions, deduct coach contract remainingSessions & update B2B contract pool
      const coachObj = member.assignedCoachId
        ? coaches.find(c => c.id === member.assignedCoachId)
        : coaches.find(c => `${c.firstName} ${c.lastName}`.trim().toLowerCase() === assignedCoachName.trim().toLowerCase());

      if (coachObj) {
        const activeCoachContract = coachContracts.find(cc => cc.coachId === coachObj.id);
        const sessionFee = Number(activeCoachContract?.baseFeeOneClient ?? coachObj.baseFeeOneClient ?? coachObj.hourRate ?? 0);
        const ledgerEntry = stripUndefined({
          id: `SESS-${Date.now()}`,
          date: nowIso,
          clientNames: [`${member.firstName} ${member.lastName}`],
          memberIds: [member.id],
          clientCount: 1,
          calculatedFee: sessionFee,
          feeOverride: sessionFee,
          leadSource: 'facility_client',
          status: 'completed'
        });

        await updateDoc(doc(db, 'coaches', coachObj.id), stripUndefined({
          currentMonthlySessions: (coachObj.currentMonthlySessions || 0) + 1,
          sessionLedger: [ledgerEntry, ...(coachObj.sessionLedger || [])],
          accruedSessionFees: Number(((coachObj.accruedSessionFees || 0) + sessionFee).toFixed(2))
        }));

        if (activeCoachContract && activeCoachContract.contractMode !== 'session_bypass' && (activeCoachContract.remainingSessions ?? activeCoachContract.sessions) > 0) {
          const nextRem = Math.max(0, (activeCoachContract.remainingSessions ?? activeCoachContract.sessions) - 1);
          await updateDoc(doc(db, 'coachContracts', activeCoachContract.id), stripUndefined({
            remainingSessions: nextRem,
            accruedSessionFees: Number(((activeCoachContract.accruedSessionFees || 0) + sessionFee).toFixed(2))
          }));
        }
      }

      // Check if coach/practitioner belongs to a 3rd-party B2B Gym Contract
      const targetCoachNameLower = (coachObj ? `${coachObj.firstName} ${coachObj.lastName}` : assignedCoachName).trim().toLowerCase();
      const matchedTp = gymThirdPartyContracts.find(tp => {
        if (tp.status !== 'active') return false;
        if (coachObj && ((tp.linkedCoachIds || []).includes(coachObj.id) || coachObj.thirdPartyContractId === tp.id)) return true;
        return (tp.practitioners || []).some(
          (p: any) => (coachObj && (p.id === coachObj.id || p.linkedStaffId === coachObj.id)) || (targetCoachNameLower && p.name?.trim().toLowerCase() === targetCoachNameLower)
        );
      });

      if (matchedTp) {
        const updatedPractitioners = (matchedTp.practitioners || []).map((p: any) => {
          const isMatch =
            (coachObj && (p.id === coachObj.id || p.linkedStaffId === coachObj.id)) ||
            (targetCoachNameLower && p.name?.trim().toLowerCase() === targetCoachNameLower);
          return isMatch ? { ...p, completedSessions: (p.completedSessions || 0) + 1 } : p;
        });
        await updateDoc(doc(db, 'gym_third_party_contracts', matchedTp.id), stripUndefined({
          usedSessionsCurrentCycle: (matchedTp.usedSessionsCurrentCycle || 0) + 1,
          practitioners: updatedPractitioners
        }));
      }

      const newRemaining = stats ? Math.max(0, stats.totalSessions - nextCycleCheckIns) : 0;
      toast.success(
        `⚡ Checked in ${member.firstName} ${member.lastName}! Coach: ${assignedCoachName} • Remaining Sessions: ${newRemaining}/${stats?.totalSessions || '∞'}`
      );
    } catch (e: any) {
      toast.error('Check-in failed: ' + (e.message || 'Unknown error'));
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ACTION 2: Quick Pay Gym / Court / Physio / POS / All Dues OR Top-Up Member Wallet
  const handleExecuteQuickPayOrTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedMember || isProcessingAction) return;
    const amt = parseFloat(payAmountUSD);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Enter a valid positive amount in USD.');
      return;
    }

    const debitAcc = payMethod === 'cash' ? '531 - Cash Drawer / Register (Caisse)' : '512 - Bank Accounts (Fresh USD / LBP)';
    const stats = memberStatsMap[selectedMember.id];

    // Helper to settle POS On-Account orders chronologically and sync transactions + advanced_transactions
    const settleMemberPosOrders = async (paymentBudget: number, notePrefix: string) => {
      const unpaidPosOrders = posOrders
        .filter(
          (o: any) =>
            o.memberId === selectedMember.id &&
            o.status !== 'refunded' &&
            o.status !== 'voided' &&
            (o.paymentStatus === 'unpaid' || o.paymentStatus === 'partial' || (o.paymentMethod === 'on_account' && o.paymentStatus !== 'paid'))
        )
        .sort((a: any, b: any) => String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || '')));

      if (unpaidPosOrders.length === 0 || paymentBudget <= 0) return 0;

      // Pre-fetch matching on_account ledger rows so we can update their paymentStatus inside the transaction
      const [txnSnap, advTxnSnap] = await Promise.all([
        getDocs(query(collection(db, 'transactions'), where('memberId', '==', selectedMember.id))),
        getDocs(query(collection(db, 'advanced_transactions'), where('memberId', '==', selectedMember.id)))
      ]);

      let pool = paymentBudget;
      const orderUpdates: Array<{ orderId: string; status: 'paid' | 'partial'; amountPaid: number }> = [];
      for (const o of unpaidPosOrders) {
        if (pool <= 0.001) break;
        const fullTotal = Number(o.total || 0);
        const alreadyPaid = Number(o.amountPaid || 0);
        const rem = Math.max(0, fullTotal - alreadyPaid);
        if (rem <= 0) continue;

        if (pool >= rem - 0.01) {
          orderUpdates.push({ orderId: o.id, status: 'paid', amountPaid: fullTotal });
          pool = Math.max(0, Number((pool - rem).toFixed(2)));
        } else {
          orderUpdates.push({
            orderId: o.id,
            status: 'partial',
            amountPaid: Number((alreadyPaid + pool).toFixed(2))
          });
          pool = 0;
        }
      }

      const appliedAmount = Number((paymentBudget - pool).toFixed(2));
      if (appliedAmount <= 0) return 0;

      const settledOrderMap = new Map(orderUpdates.map(u => [u.orderId, u]));

      await processLedgerTransaction(
        {
          amount: appliedAmount,
          subtotal: appliedAmount,
          discount: 0,
          paymentMethod: payMethod,
          memberId: selectedMember.id,
          sourceModule: 'pos_cafe',
          cashierId: user.uid,
          transactionType: 'pos_soa_settlement',
          referenceType: 'pos_soa_settlement',
          sourceAccount: debitAcc,
          destinationAccount: '411 - Clients / Member Receivables (On-Account)',
          referenceId: orderUpdates[0]?.orderId || selectedMember.id,
          relatedIds: orderUpdates.map(u => u.orderId),
          notes: `${notePrefix} (${orderUpdates.length} POS order(s)) for ${selectedMember.firstName} ${selectedMember.lastName}`
        },
        async transaction => {
          for (const upd of orderUpdates) {
            transaction.update(doc(db, 'orders', upd.orderId), {
              paymentStatus: upd.status,
              amountPaid: upd.amountPaid
            });
          }

          txnSnap.docs.forEach(d => {
            const data = d.data();
            const matchUpd = settledOrderMap.get(data.referenceId);
            if (matchUpd && data.paymentMethod === 'on_account' && data.transactionType !== 'pos_soa_settlement') {
              transaction.update(doc(db, 'transactions', d.id), {
                paymentStatus: matchUpd.status,
                amountPaid: matchUpd.amountPaid
              });
            }
          });

          advTxnSnap.docs.forEach(d => {
            const data = d.data();
            const matchUpd = settledOrderMap.get(data.referenceId);
            if (matchUpd && data.paymentMethod === 'on_account' && data.transactionType !== 'pos_soa_settlement') {
              transaction.update(doc(db, 'advanced_transactions', d.id), {
                paymentStatus: matchUpd.status,
                amountPaid: matchUpd.amountPaid
              });
            }
          });
        }
      );

      return appliedAmount;
    };

    setIsProcessingAction(true);
    try {
      if (payMode === 'gym_dues') {
        const expected = selectedMember.expectedFee ?? 0;
        const newTotalPaid = (selectedMember.totalPaid || 0) + amt;
        const isFullyPaid = newTotalPaid >= expected - 0.01;
        const newPaymentEntry = {
          id: Date.now().toString(),
          date: new Date().toISOString(),
          amount: amt,
          packageId: selectedMember.packageId || 'gym'
        };

        await processLedgerTransaction(
          {
            amount: amt,
            subtotal: amt,
            discount: 0,
            paymentMethod: payMethod,
            memberId: selectedMember.id,
            sourceModule: 'gym',
            cashierId: user.uid,
            transactionType: 'membership_payment',
            sourceAccount: debitAcc,
            destinationAccount: '7061 - Gym Membership & Training Revenue',
            referenceId: selectedMember.id,
            notes: `Command Palette Quick Gym Settlement for ${selectedMember.firstName} ${selectedMember.lastName}`
          },
          async transaction => {
            transaction.update(doc(db, 'members', selectedMember.id), {
              totalPaid: newTotalPaid,
              billingStatus: isFullyPaid ? 'paid' : 'unpaid',
              paymentHistory: [...(selectedMember.paymentHistory || []), newPaymentEntry]
            });
          }
        );

        toast.success(
          `Recorded ${formatCurrency(amt)} Gym payment for ${selectedMember.firstName} (${isFullyPaid ? 'Fully Paid' : `Remaining due: ${formatCurrency(Math.max(0, (stats?.gymDues || 0) - amt))}`})`
        );
      } else if (payMode === 'court_dues') {
        const unpaidCourtBookings = bookings
          .filter(
            (b: any) =>
              b.memberId === selectedMember.id &&
              !b.isDeleted &&
              b.status === 'booked' &&
              b.category !== 'academy'
          )
          .sort((a: any, b: any) => `${a.date}_${a.time}`.localeCompare(`${b.date}_${b.time}`));

        let remainingPaymentPool = amt;
        const hasIndAccess = unpaidCourtBookings.some(
          (b: any) => b.isIndividualAccess || b.bookingSubType === 'individual_access'
        );
        await processLedgerTransaction(
          {
            amount: amt,
            subtotal: amt,
            discount: 0,
            paymentMethod: payMethod,
            memberId: selectedMember.id,
            sourceModule: 'reservation',
            cashierId: user.uid,
            transactionType: 'court_booking_payment',
            sourceAccount: debitAcc,
            destinationAccount: hasIndAccess
              ? '70621 - Court Individual Access Revenue'
              : '7062 - Court Reservation Revenue',
            category: hasIndAccess ? 'Court Individual Access' : 'public',
            bookingSubType: hasIndAccess ? 'individual_access' : 'standard',
            referenceId: unpaidCourtBookings[0]?.id || selectedMember.id,
            relatedIds: unpaidCourtBookings.map(b => b.id),
            notes: `Command Palette Court Dues Settlement (${unpaidCourtBookings.length} slot(s)) for ${selectedMember.firstName} ${selectedMember.lastName}`
          },
          async transaction => {
            for (const b of unpaidCourtBookings) {
              if (remainingPaymentPool <= 0.001) break;
              const slotFullCost = Number(((b.rateApplied ?? b.price ?? 40) / 4).toFixed(2));
              const alreadyPaid = Number((b as any).amountPaid || 0);
              const slotRem = Math.max(0, Number((slotFullCost - alreadyPaid).toFixed(2)));
              if (slotRem <= 0) continue;

              if (remainingPaymentPool >= slotRem - 0.01) {
                transaction.update(doc(db, 'bookings', b.id), {
                  status: 'cashed_in',
                  amountPaid: slotFullCost
                });
                remainingPaymentPool = Math.max(0, Number((remainingPaymentPool - slotRem).toFixed(2)));
              } else {
                transaction.update(doc(db, 'bookings', b.id), {
                  status: 'booked',
                  amountPaid: Number((alreadyPaid + remainingPaymentPool).toFixed(2))
                });
                remainingPaymentPool = 0;
              }
            }
          }
        );

        toast.success(
          `Settled ${formatCurrency(amt)} Court Reservation Dues for ${selectedMember.firstName}!`
        );
      } else if (payMode === 'physio_dues') {
        const unpaidPhysioBookings = physioBookings
          .filter(
            (pb: any) =>
              (pb.memberId === selectedMember.id || pb.clientId === selectedMember.id) &&
              !pb.isDeleted &&
              pb.status !== 'cancelled' &&
              pb.paymentStatus !== 'paid'
          )
          .sort((a: any, b: any) => `${a.date}_${a.time}`.localeCompare(`${b.date}_${b.time}`));

        let remainingPaymentPool = amt;
        await processLedgerTransaction(
          {
            amount: amt,
            subtotal: amt,
            discount: 0,
            paymentMethod: payMethod,
            memberId: selectedMember.id,
            sourceModule: 'physio',
            cashierId: user.uid,
            transactionType: 'physio_session_payment',
            sourceAccount: debitAcc,
            destinationAccount: '7063 - Physiotherapy Clinical Revenue',
            referenceId: unpaidPhysioBookings[0]?.id || selectedMember.id,
            relatedIds: unpaidPhysioBookings.map(pb => pb.id),
            notes: `Command Palette Physio Dues Settlement (${unpaidPhysioBookings.length} session(s)) for ${selectedMember.firstName} ${selectedMember.lastName}`
          },
          async transaction => {
            for (const pb of unpaidPhysioBookings) {
              if (remainingPaymentPool <= 0.001) break;
              const fullCost = Number(pb.cost || 0);
              const alreadyPaid = Number(pb.amountPaid || 0);
              const rem = Math.max(0, Number((fullCost - alreadyPaid).toFixed(2)));
              if (rem <= 0) continue;

              if (remainingPaymentPool >= rem - 0.01) {
                transaction.update(doc(db, 'physioBookings', pb.id), {
                  paymentStatus: 'paid',
                  amountPaid: fullCost
                });
                remainingPaymentPool = Math.max(0, Number((remainingPaymentPool - rem).toFixed(2)));
              } else {
                transaction.update(doc(db, 'physioBookings', pb.id), {
                  paymentStatus: 'partial',
                  amountPaid: Number((alreadyPaid + remainingPaymentPool).toFixed(2))
                });
                remainingPaymentPool = 0;
              }
            }
          }
        );

        toast.success(
          `Settled ${formatCurrency(amt)} Physiotherapy Dues for ${selectedMember.firstName}!`
        );
      } else if (payMode === 'pos_dues') {
        const appliedPos = await settleMemberPosOrders(amt, 'Command Palette POS On-Account Settlement');
        toast.success(
          `Settled ${formatCurrency(appliedPos || amt)} POS On-Account Dues for ${selectedMember.firstName}!`
        );
      } else if (payMode === 'all_dues') {
        let remainingPool = amt;
        const gymDueAmt = Math.min(remainingPool, Number((stats?.gymDues || 0).toFixed(2)));
        remainingPool = Math.max(0, Number((remainingPool - gymDueAmt).toFixed(2)));

        const courtDueAmt = Math.min(remainingPool, Number((stats?.courtDues || 0).toFixed(2)));
        remainingPool = Math.max(0, Number((remainingPool - courtDueAmt).toFixed(2)));

        const physioDueAmt = Math.min(remainingPool, Number((stats?.physioDues || 0).toFixed(2)));
        remainingPool = Math.max(0, Number((remainingPool - physioDueAmt).toFixed(2)));

        const posDueAmt = Math.min(remainingPool, Number((stats?.posDues || 0).toFixed(2)));

        if (gymDueAmt > 0) {
          const expected = selectedMember.expectedFee ?? 0;
          const newTotalPaid = (selectedMember.totalPaid || 0) + gymDueAmt;
          const isGymFullyPaid = newTotalPaid >= expected - 0.01;
          const newPaymentEntry = {
            id: `${Date.now()}_gym`,
            date: new Date().toISOString(),
            amount: gymDueAmt,
            packageId: selectedMember.packageId || 'gym'
          };
          await processLedgerTransaction(
            {
              amount: gymDueAmt,
              subtotal: gymDueAmt,
              discount: 0,
              paymentMethod: payMethod,
              memberId: selectedMember.id,
              sourceModule: 'gym',
              cashierId: user.uid,
              transactionType: 'membership_payment',
              sourceAccount: debitAcc,
              destinationAccount: '7061 - Gym Membership & Training Revenue',
              referenceId: selectedMember.id,
              notes: `Command Palette All-Dues Settlement (Gym Portion) for ${selectedMember.firstName} ${selectedMember.lastName}`
            },
            async transaction => {
              transaction.update(doc(db, 'members', selectedMember.id), {
                totalPaid: newTotalPaid,
                billingStatus: isGymFullyPaid ? 'paid' : 'unpaid',
                paymentHistory: [...(selectedMember.paymentHistory || []), newPaymentEntry]
              });
            }
          );
        }

        if (courtDueAmt > 0) {
          const unpaidCourtBookings = bookings
            .filter(
              (b: any) =>
                b.memberId === selectedMember.id &&
                !b.isDeleted &&
                b.status === 'booked' &&
                b.category !== 'academy'
            )
            .sort((a: any, b: any) => `${a.date}_${a.time}`.localeCompare(`${b.date}_${b.time}`));
          let courtPool = courtDueAmt;
          const allDuesHasIndAccess = unpaidCourtBookings.some(
            (b: any) => b.isIndividualAccess || b.bookingSubType === 'individual_access'
          );
          await processLedgerTransaction(
            {
              amount: courtDueAmt,
              subtotal: courtDueAmt,
              discount: 0,
              paymentMethod: payMethod,
              memberId: selectedMember.id,
              sourceModule: 'reservation',
              cashierId: user.uid,
              transactionType: 'court_booking_payment',
              sourceAccount: debitAcc,
              destinationAccount: allDuesHasIndAccess
                ? '70621 - Court Individual Access Revenue'
                : '7062 - Court Reservation Revenue',
              category: allDuesHasIndAccess ? 'Court Individual Access' : 'public',
              bookingSubType: allDuesHasIndAccess ? 'individual_access' : 'standard',
              referenceId: unpaidCourtBookings[0]?.id || selectedMember.id,
              relatedIds: unpaidCourtBookings.map(b => b.id),
              notes: `Command Palette All-Dues Settlement (Court Portion) for ${selectedMember.firstName} ${selectedMember.lastName}`
            },
            async transaction => {
              for (const b of unpaidCourtBookings) {
                if (courtPool <= 0.001) break;
                const slotFullCost = Number(((b.rateApplied ?? b.price ?? 40) / 4).toFixed(2));
                const alreadyPaid = Number((b as any).amountPaid || 0);
                const slotRem = Math.max(0, Number((slotFullCost - alreadyPaid).toFixed(2)));
                if (slotRem <= 0) continue;

                if (courtPool >= slotRem - 0.01) {
                  transaction.update(doc(db, 'bookings', b.id), {
                    status: 'cashed_in',
                    amountPaid: slotFullCost
                  });
                  courtPool = Math.max(0, Number((courtPool - slotRem).toFixed(2)));
                } else {
                  transaction.update(doc(db, 'bookings', b.id), {
                    status: 'booked',
                    amountPaid: Number((alreadyPaid + courtPool).toFixed(2))
                  });
                  courtPool = 0;
                }
              }
            }
          );
        }

        if (physioDueAmt > 0) {
          const unpaidPhysioBookings = physioBookings
            .filter(
              (pb: any) =>
                (pb.memberId === selectedMember.id || pb.clientId === selectedMember.id) &&
                !pb.isDeleted &&
                pb.status !== 'cancelled' &&
                pb.paymentStatus !== 'paid'
            )
            .sort((a: any, b: any) => `${a.date}_${a.time}`.localeCompare(`${b.date}_${b.time}`));
          let physioPool = physioDueAmt;
          await processLedgerTransaction(
            {
              amount: physioDueAmt,
              subtotal: physioDueAmt,
              discount: 0,
              paymentMethod: payMethod,
              memberId: selectedMember.id,
              sourceModule: 'physio',
              cashierId: user.uid,
              transactionType: 'physio_session_payment',
              sourceAccount: debitAcc,
              destinationAccount: '7063 - Physiotherapy Clinical Revenue',
              referenceId: unpaidPhysioBookings[0]?.id || selectedMember.id,
              relatedIds: unpaidPhysioBookings.map(pb => pb.id),
              notes: `Command Palette All-Dues Settlement (Physio Portion) for ${selectedMember.firstName} ${selectedMember.lastName}`
            },
            async transaction => {
              for (const pb of unpaidPhysioBookings) {
                if (physioPool <= 0.001) break;
                const fullCost = Number(pb.cost || 0);
                const alreadyPaid = Number(pb.amountPaid || 0);
                const rem = Math.max(0, Number((fullCost - alreadyPaid).toFixed(2)));
                if (rem <= 0) continue;

                if (physioPool >= rem - 0.01) {
                  transaction.update(doc(db, 'physioBookings', pb.id), {
                    paymentStatus: 'paid',
                    amountPaid: fullCost
                  });
                  physioPool = Math.max(0, Number((physioPool - rem).toFixed(2)));
                } else {
                  transaction.update(doc(db, 'physioBookings', pb.id), {
                    paymentStatus: 'partial',
                    amountPaid: Number((alreadyPaid + physioPool).toFixed(2))
                  });
                  physioPool = 0;
                }
              }
            }
          );
        }

        if (posDueAmt > 0) {
          await settleMemberPosOrders(posDueAmt, 'Command Palette All-Dues Settlement (POS On-Account Portion)');
        }

        toast.success(
          `Settled pending dues (${formatCurrency(gymDueAmt + courtDueAmt + physioDueAmt + posDueAmt)}) for ${selectedMember.firstName}!`
        );
      } else {
        // Wallet Top-Up
        const newBalance = (selectedMember.balance || 0) + amt;
        await processLedgerTransaction(
          {
            amount: amt,
            subtotal: amt,
            discount: 0,
            paymentMethod: payMethod,
            memberId: selectedMember.id,
            sourceModule: 'member_management',
            cashierId: user.uid,
            transactionType: 'wallet_topup',
            direction: 'inflow',
            sourceAccount: debitAcc,
            destinationAccount: '419 - Member Wallet & Deposits Liability',
            referenceId: selectedMember.id,
            notes: `Command Palette Wallet Top-Up for ${selectedMember.firstName} ${selectedMember.lastName}`
          },
          async transaction => {
            transaction.update(doc(db, 'members', selectedMember.id), {
              balance: newBalance
            });
          }
        );

        await logSystemAudit({
          action: 'UPDATE',
          collectionName: 'members',
          documentId: selectedMember.id,
          staffId: user.uid,
          timestamp: new Date().toISOString(),
          details: { event: 'WALLET_TOPUP', amountUSD: amt, newBalance }
        });

        toast.success(`Topped up ${selectedMember.firstName}'s Wallet by ${formatCurrency(amt)}! New Balance: ${formatCurrency(newBalance)}`);
      }
      setActiveActionTab('none');
    } catch (err: any) {
      toast.error(err.message || 'Payment action failed.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ACTION 3: Quick Kiosk Charge (1-Click Water / Sports Drink / Towel / Kiosk Item)
  const handleExecuteQuickKioskCharge = async (itemToCharge?: InventoryItem) => {
    if (!user || !selectedMember || isProcessingAction) return;
    const item = itemToCharge || kioskItems.find(k => k.id === selectedKioskItemId);
    if (!item) {
      toast.error('Please select a Kiosk POS item to charge.');
      return;
    }
    const qty = itemToCharge ? 1 : Math.max(1, kioskQty);
    const lineTotal = item.price * qty;

    if (kioskPaymentMethod === 'member_balance' && (selectedMember.balance || 0) < lineTotal) {
      toast.error(
        `Insufficient Member Wallet balance (${formatCurrency(selectedMember.balance || 0)}) for ${formatCurrency(lineTotal)}.`
      );
      return;
    }

    setIsProcessingAction(true);
    try {
      await processAtomicCheckout({
        memberId: selectedMember.id,
        items: [
          {
            itemId: item.id,
            name: item.name,
            quantity: qty,
            price: item.price,
            isBundle: item.isBundle,
            bundleComponents: item.bundleComponents
          }
        ],
        subtotal: lineTotal,
        discount: 0,
        total: lineTotal,
        paymentMethod: kioskPaymentMethod,
        sourceModule: 'pos_cafe',
        cashierId: user.uid,
        notes: `Quick Kiosk Charge via Reception Command Palette (${selectedMember.firstName} ${selectedMember.lastName})`
      });

      toast.success(
        `🥤 Charged ${qty}x ${item.name} (${formatCurrency(lineTotal)}) to ${selectedMember.firstName} via ${
          kioskPaymentMethod === 'member_balance' ? 'Member Wallet' : kioskPaymentMethod.toUpperCase()
        }!`
      );
      setActiveActionTab('none');
    } catch (err: any) {
      toast.error(err.message || 'Quick Kiosk charge failed.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  if (!user || !isOpen) return null;

  const selectedStats = selectedMember ? memberStatsMap[selectedMember.id] : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-12 sm:pt-20 px-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className={`w-full max-w-4xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
          isDarkMode ? 'bg-[#101622] border-zinc-800/90 text-zinc-100 shadow-[0_0_50px_-10px_rgba(0,184,200,0.2)]' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Top Search & QR Input Bar */}
        <div className={`p-4 border-b flex items-center gap-3 ${isDarkMode ? 'border-zinc-800/80 bg-[#05070A]/80' : 'border-slate-200 bg-slate-50'}`}>
          <div className="p-2 rounded-xl bg-cyan-500/10 text-[#00B8C8]">
            <Search size={20} />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={queryStr}
            onChange={e => setQueryStr(e.target.value)}
            placeholder="Type member name, phone, court (HCA/Padel 1), module, or scan QR code (MEMBER:...)..."
            className="flex-1 bg-transparent text-sm sm:text-base font-semibold focus:outline-none placeholder:text-zinc-500"
          />
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-800">
            <QrCode size={13} className="text-[#00B8C8]" />
            <span>QR Ready</span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-colors"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Main Split Body */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-zinc-800/80">
          {/* Left Column: Omnichannel Search Results (Members, Today's Bookings, Quick Nav) */}
          <div className="lg:col-span-5 p-4 space-y-5 overflow-y-auto max-h-[65vh]">
            {/* 1. Central Members */}
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Central Members ({filteredMembers.length})
                </span>
                <span className="text-[10px] text-zinc-400 font-mono">Click to inspect</span>
              </div>
              <div className="space-y-1">
                {filteredMembers.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-3 px-2 italic">No matching members found.</p>
                ) : (
                  filteredMembers.map(m => {
                    const isSelected = selectedMember?.id === m.id;
                    const st = memberStatsMap[m.id];
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setSelectedMemberId(m.id);
                          setActiveActionTab('none');
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between transition-all ${
                          isSelected
                            ? 'bg-[#00B8C8] text-slate-950 shadow-md shadow-cyan-500/20'
                            : isDarkMode
                              ? 'hover:bg-[#0B0F17] text-zinc-200'
                              : 'hover:bg-slate-100 text-slate-800'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-bold text-sm truncate flex items-center gap-1.5">
                            <span>{m.firstName} {m.lastName}</span>
                            {m.isFrozen && (
                              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-black">
                                Frozen
                              </span>
                            )}
                          </div>
                          <div className={`text-xs truncate font-mono ${isSelected ? 'text-slate-900/80' : 'text-zinc-500'}`}>
                            {m.phone || 'No phone'} • {st?.pkgName || 'Standard'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-xs font-mono font-bold ${isSelected ? 'text-slate-950' : 'text-emerald-500'}`}>
                            {formatCurrency(m.balance || 0)}
                          </div>
                          {st && st.totalDues > 0 && (
                            <div className={`text-[10px] font-mono font-bold ${isSelected ? 'text-amber-200' : 'text-rose-500'}`}>
                              Due: {formatCurrency(st.totalDues)}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* 2. Today's Active Court Bookings */}
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Today's Active Court Bookings ({todayStr})
                </span>
              </div>
              <div className="space-y-1">
                {matchingTodayBookings.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-2 px-2 italic">No active court bookings matching query for today.</p>
                ) : (
                  matchingTodayBookings.map(b => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        navigate('/reservations');
                      }}
                      className={`w-full text-left px-3 py-2 rounded-xl flex items-center justify-between text-xs transition-colors ${
                        isDarkMode ? 'hover:bg-zinc-800/70 bg-zinc-950/40' : 'hover:bg-zinc-100 bg-zinc-50'
                      }`}
                    >
                      <div>
                        <div className="font-bold">
                          {b.court} — {b.name}
                        </div>
                        <div className="text-zinc-500 font-mono">
                          {b.startTime || b.time} • {b.phone || 'No phone'}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                          b.status === 'cashed_in' || b.status === 'cashed-in'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-amber-500/10 text-amber-500'
                        }`}
                      >
                        {b.status === 'cashed_in' || b.status === 'cashed-in' ? 'Paid' : 'Booked'}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* 3. Quick Module Navigation */}
            <div>
              <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 px-1">
                Quick Module Jump
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {navModules.map(mod => {
                  const Icon = mod.icon;
                  return (
                    <button
                      key={mod.path}
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        navigate(mod.path);
                      }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                        isDarkMode
                          ? 'bg-[#0B0F17] hover:bg-zinc-800/80 text-zinc-300 border border-zinc-800/60'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/60'
                      }`}
                    >
                      <Icon size={14} className="text-[#00B8C8] shrink-0" />
                      <span className="truncate">{mod.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Instant 1-Click Front-Desk Actions for Selected Member */}
          <div className="lg:col-span-7 p-5 flex flex-col justify-between overflow-y-auto max-h-[65vh]">
            {selectedMember ? (
              <div className="space-y-5">
                {/* Member Header & Live Status Badges */}
                <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-black tracking-tight">
                          {selectedMember.firstName} {selectedMember.lastName}
                        </h3>
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                            selectedMember.isFrozen
                              ? 'bg-amber-500/15 text-amber-500'
                              : selectedMember.status === 'active'
                                ? 'bg-emerald-500/15 text-emerald-500'
                                : 'bg-zinc-500/15 text-zinc-400'
                          }`}
                        >
                          {selectedMember.isFrozen ? 'Frozen' : selectedMember.status || 'Active'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 font-mono mt-0.5">
                        {selectedMember.phone || 'No phone'} • ID: {selectedMember.qrCode || `MEMBER:${selectedMember.id.slice(0, 8)}`}
                      </p>
                      {selectedMember.assignedCoachName && (
                        <p className="text-xs text-[#00B8C8] font-bold mt-1">
                          Assigned Trainer: {selectedMember.assignedCoachName}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        navigate(`/members/${selectedMember.id}`);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors shrink-0"
                    >
                      <User size={14} />
                      <span>360° SOA Profile</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>

                  {/* 3 Live Telemetry Metrics */}
                  <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-slate-200 dark:border-zinc-800">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">
                        Gym Quota
                      </span>
                      <span className="text-sm font-black font-mono text-[#00B8C8]">
                        {selectedStats && selectedStats.totalSessions > 0
                          ? `${selectedStats.remainingSessions} / ${selectedStats.totalSessions} left`
                          : selectedStats?.pkgName || 'No Package'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">
                        Wallet Balance
                      </span>
                      <span className="text-sm font-black font-mono text-emerald-500">
                        {formatCurrency(selectedMember.balance || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">
                        Pending SOA Dues
                      </span>
                      <span
                        className={`text-sm font-black font-mono ${
                          (selectedStats?.totalDues || 0) > 0 ? 'text-rose-500' : 'text-zinc-400'
                        }`}
                      >
                        {formatCurrency(selectedStats?.totalDues || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4 Instant Front-Desk Action Buttons */}
                <div>
                  <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2.5">
                    Instant 1-Click Front-Desk Actions
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {/* 1. Instant Gym Check-In */}
                    <button
                      type="button"
                      disabled={isProcessingAction}
                      onClick={() => handleInstantGymCheckIn(selectedMember)}
                      className="p-3.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-left transition-all flex items-center gap-3 group"
                    >
                      <div className="p-2.5 rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
                        <Zap size={18} />
                      </div>
                      <div>
                        <div className="font-black text-sm text-emerald-600 dark:text-emerald-400">
                          ⚡ Instant Gym Check-In
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Deduct 1 session & log attendance now
                        </div>
                      </div>
                    </button>

                    {/* 2. Quick Pay / Top-Up Wallet */}
                    <button
                      type="button"
                      onClick={() => setActiveActionTab(activeActionTab === 'pay_topup' ? 'none' : 'pay_topup')}
                      className={`p-3.5 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                        activeActionTab === 'pay_topup'
                          ? 'border-[#00B8C8] bg-[#00B8C8]/15'
                          : isDarkMode
                            ? 'border-zinc-800 bg-[#0B0F17] hover:border-zinc-700'
                            : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="p-2.5 rounded-xl bg-[#00B8C8] text-slate-950 shadow-md shadow-cyan-500/20">
                        <Wallet size={18} />
                      </div>
                      <div>
                        <div className="font-black text-sm">💳 Quick Pay / Top-Up</div>
                        <div className="text-[11px] text-zinc-500">
                          Settle Gym dues or top up Wallet balance
                        </div>
                      </div>
                    </button>

                    {/* 3. Quick Kiosk Charge */}
                    <button
                      type="button"
                      onClick={() => setActiveActionTab(activeActionTab === 'kiosk_charge' ? 'none' : 'kiosk_charge')}
                      className={`p-3.5 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                        activeActionTab === 'kiosk_charge'
                          ? 'border-amber-500 bg-amber-500/15'
                          : isDarkMode
                            ? 'border-zinc-800 bg-[#0B0F17] hover:border-zinc-700'
                            : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="p-2.5 rounded-xl bg-amber-600 text-white shadow-md shadow-amber-600/20">
                        <ShoppingBag size={18} />
                      </div>
                      <div>
                        <div className="font-black text-sm">🥤 Quick Kiosk Charge</div>
                        <div className="text-[11px] text-zinc-500">
                          1-click Water, Drink, or Kiosk POS item
                        </div>
                      </div>
                    </button>

                    {/* 4. Open Full 360 SOA Profile */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        navigate(`/members/${selectedMember.id}`);
                      }}
                      className={`p-3.5 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                        isDarkMode
                          ? 'border-zinc-800 bg-[#0B0F17] hover:border-zinc-700'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="p-2.5 rounded-xl bg-[#00B8C8]/20 text-[#00B8C8] border border-[#00B8C8]/30 shadow-md shadow-cyan-500/10">
                        <User size={18} />
                      </div>
                      <div>
                        <div className="font-black text-sm">👤 Open 360° SOA Profile</div>
                        <div className="text-[11px] text-zinc-500">
                          Full ledger statement, QR card & history
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Inline Mini-Form: Quick Pay / Top-Up Wallet */}
                {activeActionTab === 'pay_topup' && (
                  <form
                    onSubmit={handleExecuteQuickPayOrTopUp}
                    className={`p-4 rounded-2xl border space-y-3 ${
                      isDarkMode ? 'bg-[#0B0F17] border-[#00B8C8]/40' : 'bg-cyan-50/40 border-cyan-200'
                    }`}
                  >
                    <div className="space-y-2">
                      <span className="text-xs font-black uppercase tracking-widest text-[#00B8C8] block">
                        💳 Quick Payment & Multi-Module Dues Settlement
                      </span>
                      <div className="flex flex-wrap gap-1.5 bg-slate-200 dark:bg-zinc-800 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => {
                            setPayMode('wallet_topup');
                            setPayAmountUSD('20');
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                            payMode === 'wallet_topup' ? 'bg-[#00B8C8] text-slate-950' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Top-Up Wallet
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPayMode('gym_dues');
                            setPayAmountUSD(String((selectedStats?.gymDues || 50).toFixed(2)));
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                            payMode === 'gym_dues' ? 'bg-[#00B8C8] text-slate-950' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Settle Gym Dues ({formatCurrency(selectedStats?.gymDues || 0)})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPayMode('court_dues');
                            setPayAmountUSD(String((selectedStats?.courtDues || 40).toFixed(2)));
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                            payMode === 'court_dues' ? 'bg-[#00B8C8] text-slate-950' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Settle Court Dues ({formatCurrency(selectedStats?.courtDues || 0)})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPayMode('physio_dues');
                            setPayAmountUSD(String((selectedStats?.physioDues || 50).toFixed(2)));
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                            payMode === 'physio_dues' ? 'bg-[#00B8C8] text-slate-950' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Settle Physio Dues ({formatCurrency(selectedStats?.physioDues || 0)})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPayMode('pos_dues');
                            setPayAmountUSD(String((selectedStats?.posDues || 10).toFixed(2)));
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                            payMode === 'pos_dues' ? 'bg-[#00B8C8] text-slate-950' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Settle POS Dues ({formatCurrency(selectedStats?.posDues || 0)})
                        </button>
                        {(selectedStats?.totalDues || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayMode('all_dues');
                              setPayAmountUSD(String((selectedStats?.totalDues || 0).toFixed(2)));
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                              payMode === 'all_dues' ? 'bg-emerald-500 text-slate-950' : 'text-emerald-400 hover:text-emerald-300'
                            }`}
                          >
                            Settle All Pending Dues ({formatCurrency(selectedStats?.totalDues || 0)})
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1">
                          Amount ($ USD)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.5"
                          required
                          value={payAmountUSD}
                          onChange={e => setPayAmountUSD(e.target.value)}
                          className={`w-full px-3 py-2 rounded-xl border text-sm font-mono font-bold ${
                            isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                          }`}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1">
                          LBP Equivalent
                        </label>
                        <div className="px-3 py-2 rounded-xl border border-transparent text-xs font-mono font-bold text-amber-500 flex items-center h-[38px]">
                          {Math.round((parseFloat(payAmountUSD) || 0) * usdToLbpRate).toLocaleString()} ل.ل
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1">
                          Tender Method
                        </label>
                        <select
                          value={payMethod}
                          onChange={e => setPayMethod(e.target.value as 'cash' | 'card')}
                          className={`w-full px-3 py-2 rounded-xl border text-xs font-bold ${
                            isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                          }`}
                        >
                          <option value="cash">Cash (531)</option>
                          <option value="card">Card / Bank (512)</option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isProcessingAction}
                      className="w-full py-2.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 size={15} />
                      {payMode === 'wallet_topup'
                        ? `Confirm Wallet Top-Up (+$${(parseFloat(payAmountUSD) || 0).toFixed(2)})`
                        : payMode === 'court_dues'
                          ? `Confirm Court Dues Settlement ($${(parseFloat(payAmountUSD) || 0).toFixed(2)})`
                          : payMode === 'physio_dues'
                            ? `Confirm Physio Dues Settlement ($${(parseFloat(payAmountUSD) || 0).toFixed(2)})`
                            : payMode === 'all_dues'
                              ? `Confirm All Pending Dues Settlement ($${(parseFloat(payAmountUSD) || 0).toFixed(2)})`
                              : `Confirm Gym Balance Settlement ($${(parseFloat(payAmountUSD) || 0).toFixed(2)})`}
                    </button>
                  </form>
                )}

                {/* Inline Mini-Form: Quick Kiosk Charge */}
                {activeActionTab === 'kiosk_charge' && (
                  <div
                    className={`p-4 rounded-2xl border space-y-3 ${
                      isDarkMode ? 'bg-zinc-950 border-amber-500/40' : 'bg-amber-50/40 border-amber-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-widest text-amber-500">
                        🥤 Instant Kiosk POS Charge (2-Second Checkout)
                      </span>
                      <div className="flex gap-1 bg-zinc-200 dark:bg-zinc-800 p-0.5 rounded-lg">
                        {(['cash', 'card', 'member_balance'] as const).map(m => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setKioskPaymentMethod(m)}
                            className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                              kioskPaymentMethod === m ? 'bg-amber-600 text-white' : 'text-zinc-500'
                            }`}
                          >
                            {m === 'member_balance' ? 'Wallet' : m}
                          </button>
                        ))}
                      </div>
                    </div>

                    {kioskItems.length === 0 ? (
                      <div className="text-xs text-zinc-500 flex items-center gap-2 py-2">
                        <AlertCircle size={14} className="text-amber-500" />
                        <span>No in-stock Kiosk POS items found. Add items in Kiosk POS first.</span>
                      </div>
                    ) : (
                      <>
                        {/* 1-Click Quick Buttons for Top Kiosk Items */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {kioskItems.slice(0, 6).map(item => (
                            <button
                              key={item.id}
                              type="button"
                              disabled={isProcessingAction}
                              onClick={() => handleExecuteQuickKioskCharge(item)}
                              className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                                isDarkMode
                                  ? 'bg-zinc-900 border-zinc-800 hover:border-amber-500/60'
                                  : 'bg-white border-zinc-200 hover:border-amber-500'
                              }`}
                            >
                              <div className="font-bold text-xs truncate">{item.name}</div>
                              <div className="flex items-center justify-between mt-1">
                                <span className="text-xs font-mono font-black text-amber-500">
                                  {formatCurrency(item.price)}
                                </span>
                                <span className="text-[10px] text-zinc-400">1-Click ⚡</span>
                              </div>
                            </button>
                          ))}
                        </div>

                        {/* Custom Item & Qty Selector */}
                        <div className="flex items-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                          <select
                            value={selectedKioskItemId}
                            onChange={e => setSelectedKioskItemId(e.target.value)}
                            className={`flex-1 px-3 py-2 rounded-xl border text-xs font-bold ${
                              isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                            }`}
                          >
                            {kioskItems.map(k => (
                              <option key={k.id} value={k.id}>
                                {k.name} — {formatCurrency(k.price)} ({k.stock} in stock)
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="1"
                            max="20"
                            value={kioskQty}
                            onChange={e => setKioskQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className={`w-16 px-2.5 py-2 rounded-xl border text-xs font-mono font-bold text-center ${
                              isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                            }`}
                          />
                          <button
                            type="button"
                            disabled={isProcessingAction}
                            onClick={() => handleExecuteQuickKioskCharge()}
                            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-wider shrink-0"
                          >
                            Charge Now
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12 text-zinc-500">
                <Command size={40} className="mb-3 opacity-20" />
                <p className="font-bold text-sm">Select or search a Member on the left</p>
                <p className="text-xs mt-1">
                  Execute 1-click Gym check-in, settle SOA dues, top up Wallet, or charge Kiosk items
                </p>
              </div>
            )}

            {/* Footer Shortcut Legend */}
            <div className="mt-6 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
              <div className="flex items-center gap-3">
                <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded font-bold">
                  Ctrl + K / ⌘K
                </span>
                <span>Toggle Reception Command Palette anywhere</span>
              </div>
              <span className="font-mono">ESC to close</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
