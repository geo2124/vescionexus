import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { TenantBrandLockup } from './VescioNexusLogo';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  onSnapshot,
  query,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  where,
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  getOrCreateGhostMember,
  normalizePhone,
  handleFirestoreError as handleGlobalError
} from '../lib/firestore-utils';
import { processLedgerTransaction, stripUndefined } from '../lib/transaction-engine';
import {
  ArrowLeft,
  Search,
  Plus,
  Calendar as CalendarIcon,
  Users,
  UserPlus,
  Activity,
  FileText,
  Clock,
  Copy,
  Share2,
  Upload,
  Link2,
  CheckCircle,
  XCircle,
  Edit,
  Trash2,
  Stethoscope,
  ChevronRight,
  ChevronLeft,
  User,
  CreditCard,
  Tag,
  DollarSign,
  Settings,
  Package,
  Building2,
  DoorOpen,
  Repeat,
  AlertTriangle
} from 'lucide-react';
import {
  Member,
  Coupon,
  OperationType,
  PhysioRoom,
  PhysioClinicalSettings,
  PhysioPackage,
  PhysioPatientPackageSubscription,
  PhysioThirdPartyContract
} from '../types';
import { PhysioClinicalSettingsModal } from './physio/PhysioClinicalSettingsModal';
import {
  PhysioTherapist360Modal,
  PhysioTherapistRecord,
  PhysioBookingRecord
} from './physio/PhysioTherapist360Modal';
import { PhysioThirdPartyContractsTab } from './physio/PhysioThirdPartyContractsTab';
import { toast } from 'sonner';
import { motion } from 'motion/react';

interface PhysioProgram {
  id: string;
  clientId: string;
  name: string;
  totalSessions: number;
  completedSessions: number;
  startDate: string;
  endDate: string;
  notes: string;
  totalCost?: number;
  amountPaid?: number;
  uid: string;
}

interface PhysioPrescription {
  id: string;
  clientId: string;
  date: string;
  details: string;
  exercises: string[];
  uid: string;
}

const DEFAULT_ROOMS: PhysioRoom[] = [
  { id: 'room_1', name: 'Room 1 - Manual Therapy', equipmentTags: ['Manual Table', 'Dry Needling'], isActive: true },
  { id: 'room_2', name: 'Room 2 - Electro & Shockwave', equipmentTags: ['Shockwave', 'Ultrasound', 'TENS'], isActive: true },
  { id: 'room_3', name: 'Room 3 - Rehab & Spine', equipmentTags: ['Traction', 'Rehab Rack'], isActive: true },
  { id: 'room_4', name: 'Recovery - Ice Bath & Sauna', equipmentTags: ['Cold Plunge', 'Infrared Sauna'], isActive: true }
];

const DEFAULT_CLINICAL_SETTINGS: PhysioClinicalSettings = {
  id: 'config',
  sessionTypes: [
    { id: 'st_assessment', name: 'Initial Assessment', defaultDurationMinutes: 45, defaultPrice: 50 },
    { id: 'st_manual', name: 'Manual Therapy', defaultDurationMinutes: 45, defaultPrice: 55 },
    { id: 'st_needling', name: 'Dry Needling', defaultDurationMinutes: 30, defaultPrice: 45 },
    { id: 'st_shockwave', name: 'Shockwave Therapy', defaultDurationMinutes: 30, defaultPrice: 60 },
    { id: 'st_postop', name: 'Post-Op Rehab', defaultDurationMinutes: 60, defaultPrice: 65 },
    { id: 'st_recovery', name: 'Sports Recovery / Ice Bath', defaultDurationMinutes: 45, defaultPrice: 40 }
  ],
  injuryCategories: [
    'ACL / Knee Ligament Reconstruction',
    'Rotator Cuff / Shoulder Impingement',
    'Lumbar Disc / Lower Back Pain',
    'Cervical Spine / Neck Strain',
    'Hamstring / Muscle Tear',
    'Ankle Sprain / Tendonitis',
    'Post-Surgical Orthopedic Rehab',
    'Sports Recovery & Mobility'
  ],
  customStatuses: [
    'Assessment',
    'Active Treatment',
    'Checked-In / Completed',
    'On Hold',
    'Discharged / Recovered',
    'Cancelled'
  ]
};

export default function PhysioPage() {
  const navigate = useNavigate();
  const { user, formatCurrency, systemName, systemLogo } = useFirebase();
  const { isDarkMode, toggleDarkMode } = useTheme();

  const [activeTab, setActiveTab] = useState<
    'calendar' | 'clients' | 'therapists' | 'packages' | 'third_party' | 'finance'
  >('calendar');

  // Calendar Filters & View State
  const [calendarViewMode, setCalendarViewMode] = useState<'rooms_day' | 'weekly'>('rooms_day');
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [calendarFilterRoom, setCalendarFilterRoom] = useState<string>('all');
  const [calendarFilterTherapist, setCalendarFilterTherapist] = useState<string>('all');

  // Finance Filters State
  const [financeActiveSubTab, setFinanceActiveSubTab] = useState<'therapists' | 'clients'>('therapists');
  const [financeFilterTherapistId, setFinanceFilterTherapistId] = useState<string>('all');
  const [financeFilterClientId, setFinanceFilterClientId] = useState<string>('all');
  const [financeFilterStartDate, setFinanceFilterStartDate] = useState<string>('');
  const [financeFilterEndDate, setFinanceFilterEndDate] = useState<string>('');
  const [financeFilterType, setFinanceFilterType] = useState<string>('all');

  // Data State
  const [therapists, setTherapists] = useState<PhysioTherapistRecord[]>([]);
  const [clients, setClients] = useState<Member[]>([]);
  const [programs, setPrograms] = useState<PhysioProgram[]>([]);
  const [prescriptions, setPrescriptions] = useState<PhysioPrescription[]>([]);
  const [bookings, setBookings] = useState<PhysioBookingRecord[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [rooms, setRooms] = useState<PhysioRoom[]>(DEFAULT_ROOMS);
  const [clinicalSettings, setClinicalSettings] = useState<PhysioClinicalSettings>(DEFAULT_CLINICAL_SETTINGS);
  const [physioPackages, setPhysioPackages] = useState<PhysioPackage[]>([]);
  const [thirdPartyContracts, setThirdPartyContracts] = useState<PhysioThirdPartyContract[]>([]);

  // Modals State
  const [isTherapistModalOpen, setIsTherapistModalOpen] = useState(false);
  const [selectedTherapistFor360, setSelectedTherapistFor360] = useState<PhysioTherapistRecord | null>(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isProgramModalOpen, setIsProgramModalOpen] = useState(false);
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [isClinicalSettingsModalOpen, setIsClinicalSettingsModalOpen] = useState(false);
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<PhysioPackage | null>(null);
  const [assignPackageModalPkg, setAssignPackageModalPkg] = useState<PhysioPackage | null>(null);
  const [assignPackageClientId, setAssignPackageClientId] = useState('');
  const [assignPackagePaymentMethod, setAssignPackagePaymentMethod] = useState<'cash' | 'card' | 'member_balance'>('cash');

  const [paymentModalBooking, setPaymentModalBooking] = useState<PhysioBookingRecord | null>(null);
  const [physioPaymentMethod, setPhysioPaymentMethod] = useState<'cash' | 'card' | 'member_balance'>('cash');
  const [physioCouponInput, setPhysioCouponInput] = useState('');
  const [physioCashbackInput, setPhysioCashbackInput] = useState('');

  const [editingItem, setEditingItem] = useState<any | null>(null);

  // Form State
  const [newTherapist, setNewTherapist] = useState<Partial<PhysioTherapistRecord>>({});
  const [newClient, setNewClient] = useState<Partial<Member>>({});
  const [patientModalMode, setPatientModalMode] = useState<'form' | 'short_link'>('form');
  const [clientTherapistSearch, setClientTherapistSearch] = useState('');
  const [isClientTherapistDropdownOpen, setIsClientTherapistDropdownOpen] = useState(false);
  const [shareWhatsappPhone, setShareWhatsappPhone] = useState('');
  const [editingPatientSub, setEditingPatientSub] = useState<any | null>(null);
  const [newBooking, setNewBooking] = useState<Partial<PhysioBookingRecord>>({
    date: new Date().toISOString().split('T')[0],
    roomId: 'Room 1 - Manual Therapy',
    status: 'scheduled',
    type: 'treatment',
    sessionType: 'Manual Therapy',
    injury: '',
    bodyArea: '',
    caseStatus: 'Active Treatment',
    estimatedSessions: 10,
    soapNotes: '',
    leadSource: 'facility_client'
  });
  const [recurringCount, setRecurringCount] = useState<number>(1);
  const [recurringIntervalDays, setRecurringIntervalDays] = useState<number>(2);

  const [newPackageForm, setNewPackageForm] = useState<Partial<PhysioPackage>>({
    name: '',
    targetType: 'patient',
    sessionType: 'Manual Therapy',
    sessions: 10,
    price: 350,
    discountPercent: 0,
    discountAmount: 0,
    priceOverride: undefined,
    durationWeeks: 8,
    notes: ''
  });

  const [newProgram, setNewProgram] = useState<Partial<PhysioProgram>>({
    completedSessions: 0
  });
  const [newPrescription, setNewPrescription] = useState<Partial<PhysioPrescription>>({
    date: new Date().toISOString().split('T')[0],
    exercises: []
  });

  const [selectedClient, setSelectedClient] = useState<Member | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Member Search State (for Booking/Modals)
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [isQuickAddMember, setIsQuickAddMember] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [selectedBookingMember, setSelectedBookingMember] = useState<Member | null>(null);

  const activeRooms = useMemo(() => {
    const list = rooms.filter(r => r.isActive !== false);
    return list.length > 0 ? list : DEFAULT_ROOMS;
  }, [rooms]);

  // Fetch Data
  useEffect(() => {
    if (!user) return;

    const unsubTherapists = onSnapshot(
      collection(db, 'physiotherapists'),
      snapshot => {
        setTherapists(
          snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PhysioTherapistRecord))
        );
      },
      error => handleGlobalError(error, OperationType.LIST, 'physiotherapists', user)
    );

    const unsubClients = onSnapshot(
      collection(db, 'members'),
      snapshot => {
        setClients(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Member)));
      },
      error => handleGlobalError(error, OperationType.LIST, 'members', user)
    );

    const unsubPrograms = onSnapshot(
      collection(db, 'physioPrograms'),
      snapshot => {
        setPrograms(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PhysioProgram)));
      },
      error => handleGlobalError(error, OperationType.LIST, 'physioPrograms', user)
    );

    const unsubPrescriptions = onSnapshot(
      collection(db, 'physioPrescriptions'),
      snapshot => {
        setPrescriptions(
          snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PhysioPrescription))
        );
      },
      error => handleGlobalError(error, OperationType.LIST, 'physioPrescriptions', user)
    );

    const unsubBookings = onSnapshot(
      collection(db, 'physioBookings'),
      snapshot => {
        setBookings(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PhysioBookingRecord)));
      },
      error => handleGlobalError(error, OperationType.LIST, 'physioBookings', user)
    );

    const unsubCoupons = onSnapshot(
      collection(db, 'coupons'),
      snapshot => {
        setCoupons(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Coupon)));
      },
      error => handleGlobalError(error, OperationType.LIST, 'coupons', user)
    );

    const unsubRooms = onSnapshot(
      collection(db, 'physio_rooms'),
      snapshot => {
        if (!snapshot.empty) {
          setRooms(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PhysioRoom)));
        } else {
          setRooms(DEFAULT_ROOMS);
        }
      },
      error => handleGlobalError(error, OperationType.LIST, 'physio_rooms', user)
    );

    const unsubSettings = onSnapshot(
      doc(db, 'physio_settings', 'config'),
      snap => {
        if (snap.exists()) {
          const data = snap.data() as PhysioClinicalSettings;
          setClinicalSettings({
            id: 'config',
            sessionTypes: data.sessionTypes?.length ? data.sessionTypes : DEFAULT_CLINICAL_SETTINGS.sessionTypes,
            injuryCategories: data.injuryCategories?.length ? data.injuryCategories : DEFAULT_CLINICAL_SETTINGS.injuryCategories,
            customStatuses: data.customStatuses?.length ? data.customStatuses : DEFAULT_CLINICAL_SETTINGS.customStatuses
          });
        }
      },
      error => handleGlobalError(error, OperationType.GET, 'physio_settings/config', user)
    );

    const unsubPackages = onSnapshot(
      collection(db, 'physio_packages'),
      snapshot => {
        setPhysioPackages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PhysioPackage)));
      },
      error => handleGlobalError(error, OperationType.LIST, 'physio_packages', user)
    );

    const unsubThirdParty = onSnapshot(
      collection(db, 'physio_third_party_contracts'),
      snapshot => {
        setThirdPartyContracts(
          snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PhysioThirdPartyContract))
        );
      },
      error => handleGlobalError(error, OperationType.LIST, 'physio_third_party_contracts', user)
    );

    return () => {
      unsubTherapists();
      unsubClients();
      unsubPrograms();
      unsubPrescriptions();
      unsubBookings();
      unsubCoupons();
      unsubRooms();
      unsubSettings();
      unsubPackages();
      unsubThirdParty();
    };
  }, [user]);

  const getEffectivePhysioPackagePrice = (pkg: Partial<PhysioPackage>) => {
    if (pkg.priceOverride !== undefined && Number(pkg.priceOverride) > 0) {
      return Number(pkg.priceOverride);
    }
    const base = Number(pkg.price) || 0;
    const afterPct = base * (1 - (Number(pkg.discountPercent) || 0) / 100);
    return Math.max(0, afterPct - (Number(pkg.discountAmount) || 0));
  };

  const addMinutesToTime = (timeStr: string, minutesToAdd: number): string => {
    const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
    const total = hh * 60 + mm + minutesToAdd;
    const nextH = Math.floor(total / 60) % 24;
    const nextM = total % 60;
    return `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
  };

  const openBookingModal = (
    booking: PhysioBookingRecord | null = null,
    prefillRoom?: string,
    prefillDate?: string,
    prefillStartTime?: string
  ) => {
    setRecurringCount(1);
    if (booking) {
      setEditingItem(booking);
      setNewBooking(booking);
      setSelectedBookingMember(clients.find(c => c.id === booking.clientId) || null);
    } else {
      const defaultType = clinicalSettings.sessionTypes[0] || {
        name: 'Manual Therapy',
        defaultDurationMinutes: 45,
        defaultPrice: 50
      };
      const startT = prefillStartTime || '10:00';
      const endT = addMinutesToTime(startT, defaultType.defaultDurationMinutes);
      setEditingItem(null);
      setNewBooking({
        date: prefillDate || selectedCalendarDate || new Date().toISOString().split('T')[0],
        roomId: prefillRoom || activeRooms[0]?.name || 'Room 1 - Manual Therapy',
        startTime: startT,
        endTime: endT,
        status: 'scheduled',
        type: 'treatment',
        sessionType: defaultType.name,
        injury: '',
        bodyArea: '',
        caseStatus: 'Active Treatment',
        estimatedSessions: 10,
        soapNotes: '',
        leadSource: 'facility_client',
        cost: defaultType.defaultPrice,
        amountPaid: 0,
        paymentStatus: 'pending',
        therapistPaidStatus: 'pending'
      });
      setSelectedBookingMember(null);
    }
    setMemberSearchQuery('');
    setGuestName('');
    setGuestPhone('');
    setIsQuickAddMember(false);
    setIsBookingModalOpen(true);
  };

  const getAppliedPhysioCoupon = (codeRaw: string): Coupon | null => {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return null;
    const match = coupons.find(c => c.code?.toUpperCase() === code);
    if (!match) return null;
    const isExpired = match.expiryDate && new Date(match.expiryDate).getTime() < Date.now();
    const isLimitReached = match.usageLimit > 0 && (match.usageCount || 0) >= match.usageLimit;
    const isModAllowed =
      !match.applicableModules ||
      match.applicableModules.length === 0 ||
      match.applicableModules.includes('physio');
    if (match.isActive !== false && !isExpired && !isLimitReached && isModAllowed) {
      return match;
    }
    return null;
  };

  const executePhysioCustomerPayment = async (
    booking: PhysioBookingRecord,
    method: 'cash' | 'card' | 'member_balance',
    couponCodeStr: string,
    cashbackCodeStr: string
  ) => {
    if (!user) return;
    const baseCost = Number(booking.cost) || 0;
    const appliedCoupon = getAppliedPhysioCoupon(couponCodeStr);
    if (couponCodeStr.trim() && !appliedCoupon) {
      throw new Error('Invalid, expired, or inapplicable Coupon Code.');
    }

    const couponDiscount = appliedCoupon
      ? appliedCoupon.discountType === 'percentage'
        ? baseCost * ((appliedCoupon.discountValue || 0) / 100)
        : appliedCoupon.discountValue || 0
      : 0;
    const finalNetAmount = Math.max(0, baseCost - couponDiscount);

    if (method === 'member_balance') {
      const client = clients.find(c => c.id === booking.clientId);
      if (!client) throw new Error('Client record not found for Wallet payment.');
      if ((client.balance || 0) < finalNetAmount) {
        throw new Error('Insufficient Member Wallet balance.');
      }
    }

    let resolvedCashbackId: string | null = null;
    let resolvedCashbackCode: string | null = null;
    if (cashbackCodeStr.trim()) {
      const q = query(
        collection(db, 'cashbackCodes'),
        where('code', '==', cashbackCodeStr.trim().toUpperCase())
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        throw new Error('Invalid Cashback Code.');
      }
      const cbDoc = snap.docs[0];
      const cbData = cbDoc.data();
      if (!cbData.isActive) throw new Error('This reward code is inactive.');
      if (cbData.expiryDate && new Date(cbData.expiryDate).getTime() < Date.now()) {
        throw new Error('This reward code has expired.');
      }
      if (cbData.maxUses > 0 && (cbData.usageCount || 0) >= cbData.maxUses) {
        throw new Error('Reward code usage limit reached.');
      }
      if (cbData.memberId && cbData.memberId !== booking.clientId) {
        throw new Error('This reward code is assigned to another member.');
      }
      if (
        cbData.applicableModules &&
        cbData.applicableModules.length > 0 &&
        !cbData.applicableModules.includes('physio')
      ) {
        throw new Error('This reward code is not applicable to Physiotherapy.');
      }
      resolvedCashbackId = cbDoc.id;
      resolvedCashbackCode = cbData.code;
    }

    await processLedgerTransaction(
      {
        amount: finalNetAmount,
        subtotal: baseCost,
        discount: Math.min(baseCost, couponDiscount),
        paymentMethod: method,
        memberId: booking.clientId,
        sourceModule: 'physio',
        cashierId: user.uid,
        transactionType: 'physio_treatment',
        referenceId: booking.id,
        couponId: appliedCoupon?.id || null,
        couponCode: appliedCoupon?.code || resolvedCashbackCode,
        cashbackCodeId: resolvedCashbackId,
        notes: `Physio payment for ${booking.sessionType || booking.type} (${booking.roomId})${
          appliedCoupon ? ` (Coupon: ${appliedCoupon.code})` : ''
        }`
      },
      async transaction => {
        transaction.update(doc(db, 'physioBookings', booking.id), {
          paymentStatus: 'paid',
          amountPaid: finalNetAmount
        });
      }
    );
  };

  // Collision Detection Helper (Room & Physiotherapist)
  const checkScheduleCollision = (
    dateStr: string,
    startTime: string,
    endTime: string,
    roomId: string,
    therapistId?: string,
    excludeBookingId?: string
  ): string | null => {
    const dayBookings = bookings.filter(
      b =>
        b.date === dateStr &&
        b.status !== 'cancelled' &&
        b.status !== 'no_show' &&
        b.id !== excludeBookingId
    );

    for (const existing of dayBookings) {
      const overlaps = startTime < existing.endTime && endTime > existing.startTime;
      if (!overlaps) continue;

      if (existing.roomId === roomId) {
        return `Room collision on ${dateStr} (${existing.startTime}–${existing.endTime}): ${roomId} is already booked.`;
      }
      if (therapistId && existing.therapistId && existing.therapistId === therapistId) {
        const docObj = therapists.find(t => t.id === therapistId);
        return `Physiotherapist collision on ${dateStr} (${existing.startTime}–${existing.endTime}): Dr. ${
          docObj?.lastName || 'Therapist'
        } is already booked in ${existing.roomId}.`;
      }
    }
    return null;
  };

  // Check-In & Clinical Session Deduction Engine
  const handleConfirmPhysioCheckIn = async (booking: PhysioBookingRecord) => {
    if (!user) return;
    if (booking.status === 'checked_in' || booking.status === 'completed') {
      toast.info('This session is already checked in.');
      return;
    }

    try {
      const nowIso = new Date().toISOString();

      // 1. Update Booking status -> 'checked_in'
      await updateDoc(doc(db, 'physioBookings', booking.id), {
        status: 'checked_in',
        caseStatus: 'Checked-In / Completed',
        checkedInAt: nowIso
      });

      // 2. Increment Patient completed sessions & deduct 1 session from active Physio Package
      const patient = clients.find(c => c.id === booking.clientId);
      if (patient) {
        const nextCompleted = (Number(patient.physioCompletedSessions) || 0) + 1;
        const activePackages = [...(patient.physioActivePackages || [])];
        let deductedFromPkgName = '';

        const pkgIdx = activePackages.findIndex(p => {
          if (booking.patientPackageSubId && p.id === booking.patientPackageSubId) return true;
          return p.status === 'active' && p.usedSessions < p.totalSessions;
        });

        if (pkgIdx !== -1) {
          const targetSub = { ...activePackages[pkgIdx] };
          targetSub.usedSessions = (targetSub.usedSessions || 0) + 1;
          if (targetSub.usedSessions >= targetSub.totalSessions) {
            targetSub.status = 'completed';
          }
          activePackages[pkgIdx] = targetSub;
          deductedFromPkgName = targetSub.packageName;
        }

        await updateDoc(doc(db, 'members', patient.id), stripUndefined({
          isPhysioPatient: true,
          physioCompletedSessions: nextCompleted,
          physioEstimatedSessions:
            booking.estimatedSessions || patient.physioEstimatedSessions || 10,
          physioDiagnosis: booking.injury || patient.physioDiagnosis || '',
          physioBodyArea: booking.bodyArea || patient.physioBodyArea || '',
          physioCaseStatus: booking.caseStatus || 'Active Treatment',
          physioActivePackages: activePackages
        }));

        if (deductedFromPkgName) {
          toast.success(`1 session deducted from patient package: ${deductedFromPkgName}`);
        }
      }

      // 3. Increment linked Treatment Program completedSessions if attached
      if (booking.programId) {
        const prog = programs.find(p => p.id === booking.programId);
        if (prog) {
          await updateDoc(doc(db, 'physioPrograms', prog.id), stripUndefined({
            completedSessions: Math.min(prog.totalSessions, (prog.completedSessions || 0) + 1)
          }));
        }
      }

      // 4. Increment Physiotherapist conducted sessions & Quota / 3rd-Party B2B counters
      const therapist = booking.therapistId
        ? therapists.find(t => t.id === booking.therapistId)
        : undefined;
      if (therapist) {
        const nextConducted = (Number(therapist.totalSessionsConducted) || 0) + 1;
        const quotaTotal = Number(therapist.quotaTotalSessions) || 0;
        const nextQuotaUsed = quotaTotal > 0
          ? (Number(therapist.quotaUsedSessions) || 0) + 1
          : Number(therapist.quotaUsedSessions) || 0;
        const nextRemaining = quotaTotal > 0 ? Math.max(0, quotaTotal - nextQuotaUsed) : undefined;
        await updateDoc(doc(db, 'physiotherapists', therapist.id), stripUndefined({
          totalSessionsConducted: nextConducted,
          quotaUsedSessions: nextQuotaUsed,
          ...(nextRemaining !== undefined ? { remainingSessions: nextRemaining } : {})
        }));
      }

      const therapistFullName = therapist
        ? `${therapist.firstName} ${therapist.lastName}`.trim().toLowerCase()
        : ((booking as any).therapistName || (booking as any).physiotherapistName || '').trim().toLowerCase();
      const linkedB2B = thirdPartyContracts.find(
        tp =>
          tp.status === 'active' &&
          (tp.id === booking.thirdPartyContractId ||
            (booking.therapistId && (tp.linkedTherapistIds || []).includes(booking.therapistId)) ||
            (tp.practitioners || []).some(
              p =>
                (booking.therapistId && (p.id === booking.therapistId || p.linkedStaffId === booking.therapistId)) ||
                (therapistFullName && p.name.trim().toLowerCase() === therapistFullName)
            ))
      );
      if (linkedB2B) {
        const updatedPractitioners = (linkedB2B.practitioners || []).map(p => {
          const isMatch =
            (booking.therapistId && (p.id === booking.therapistId || p.linkedStaffId === booking.therapistId)) ||
            (therapistFullName && p.name.trim().toLowerCase() === therapistFullName);
          return isMatch
            ? { ...p, completedSessions: (p.completedSessions || 0) + 1 }
            : p;
        });
        const nextUsedCycle = (Number(linkedB2B.usedSessionsCurrentCycle) || 0) + 1;
        await updateDoc(doc(db, 'physio_third_party_contracts', linkedB2B.id), stripUndefined({
          usedSessionsCurrentCycle: nextUsedCycle,
          practitioners: updatedPractitioners
        }));
      }

      toast.success('Patient Checked-In! Patient, Physiotherapist & B2B Contract session counts updated.');
    } catch (error: any) {
      handleGlobalError(error, OperationType.UPDATE, `physioBookings/${booking.id}`, user);
      toast.error(error.message || 'Failed to confirm check-in');
    }
  };

  // Handlers
  const handleAddTherapist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTherapist.firstName || !newTherapist.lastName) return;
    try {
      if (editingItem) {
        await updateDoc(doc(db, 'physiotherapists', editingItem.id), stripUndefined({ ...newTherapist }));
      } else {
        await addDoc(collection(db, 'physiotherapists'), stripUndefined({
          ...newTherapist,
          totalSessionsConducted: 0,
          uid: user.uid
        }));
      }
      toast.success(editingItem ? 'Therapist updated successfully' : 'Therapist added successfully');
      setIsTherapistModalOpen(false);
      setNewTherapist({});
      setEditingItem(null);
    } catch (error: any) {
      handleGlobalError(
        error,
        editingItem ? OperationType.UPDATE : OperationType.CREATE,
        'physiotherapists',
        user
      );
      toast.error(error.message || 'Failed to save therapist');
    }
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!newClient.firstName?.trim() || !newClient.lastName?.trim() || !newClient.phone?.trim()) {
      toast.error('First Name, Last Name, and Phone Number are mandatory.');
      return;
    }
    if (!newClient.dob) {
      toast.error('Date of Birth is mandatory.');
      return;
    }
    const chosenTherapistName =
      (newClient.assignedPhysiotherapistName || clientTherapistSearch || '').trim();
    if (!chosenTherapistName) {
      toast.error('Assigned Physiotherapist is mandatory.');
      return;
    }
    const chosenVisitType = newClient.visitType || 'Initial Session';
    const chosenSessions = Math.max(
      1,
      Number(newClient.numberOfSessions ?? newClient.physioEstimatedSessions ?? 1)
    );
    const chosenBloodType = newClient.bloodType || 'O+';

    try {
      const sanitizedClient = stripUndefined({
        ...newClient,
        firstName: newClient.firstName.trim(),
        lastName: newClient.lastName.trim(),
        phone: newClient.phone.trim(),
        email: (newClient.email || '').trim(),
        address: (newClient.address || '').trim() || undefined,
        dob: newClient.dob,
        maritalStatus: newClient.maritalStatus || undefined,
        occupation: (newClient.occupation || '').trim() || undefined,
        assignedPhysiotherapistId:
          newClient.assignedPhysiotherapistId || newClient.physioAssignedTherapistId || undefined,
        assignedPhysiotherapistName: chosenTherapistName,
        physioAssignedTherapistId:
          newClient.assignedPhysiotherapistId || newClient.physioAssignedTherapistId || undefined,
        referringPhysician: (newClient.referringPhysician || '').trim() || undefined,
        emergencyContactName: (newClient.emergencyContactName || '').trim() || undefined,
        emergencyContactPhone: (newClient.emergencyContactPhone || '').trim() || undefined,
        emergencyContactRelationship: (newClient.emergencyContactRelationship || '').trim() || undefined,
        isInsured: Boolean(newClient.isInsured),
        insuranceCompanyName: newClient.isInsured
          ? (newClient.insuranceCompanyName || '').trim() || undefined
          : undefined,
        visitType: chosenVisitType,
        numberOfSessions: chosenSessions,
        physioEstimatedSessions: chosenSessions,
        physioCompletedSessions: Number(newClient.physioCompletedSessions) || 0,
        bloodType: chosenBloodType,
        scanImageUrl: newClient.scanImageUrl || undefined,
        scanImageName: newClient.scanImageName || undefined,
        physioCaseStatus: newClient.physioCaseStatus || 'Active Treatment',
        physioDiagnosis: newClient.physioDiagnosis || chosenVisitType,
        isPhysioPatient: true,
        intakeSource: newClient.intakeSource || 'reception',
        updatedAt: new Date().toISOString()
      });

      if (editingItem) {
        await updateDoc(doc(db, 'members', editingItem.id), sanitizedClient);
        if (selectedClient && selectedClient.id === editingItem.id) {
          setSelectedClient({ ...selectedClient, ...sanitizedClient } as Member);
        }
      } else {
        const normPhone = normalizePhone(newClient.phone);
        let existingMember = null;
        if (normPhone) {
          existingMember = clients.find(c => normalizePhone(c.phone) === normPhone);
        }
        if (!existingMember) {
          existingMember = clients.find(
            c =>
              (c.firstName || '').trim().toLowerCase() ===
                (newClient.firstName || '').trim().toLowerCase() &&
              (c.lastName || '').trim().toLowerCase() ===
                (newClient.lastName || '').trim().toLowerCase()
          );
        }

        if (existingMember) {
          await updateDoc(doc(db, 'members', existingMember.id), sanitizedClient);
        } else {
          const newId = `PAT-${Date.now()}`;
          await setDoc(
            doc(db, 'members', newId),
            stripUndefined({
              ...sanitizedClient,
              id: newId,
              gender: newClient.gender || '',
              nationality: newClient.nationality || 'Lebanon',
              level: 'Novice',
              height: '',
              weight: '',
              allergies: '',
              healthProblems: newClient.medicalHistory || '',
              memberType: 'full',
              status: 'active',
              balance: 0,
              qrCode: `MEM-${newId}`,
              checkIns: [],
              createdAt: new Date().toISOString(),
              uid: user.uid
            })
          );
        }
      }
      toast.success(
        editingItem ? 'Patient clinical profile updated' : 'Patient registered & linked to Central Members'
      );
      setIsClientModalOpen(false);
      setNewClient({});
      setClientTherapistSearch('');
      setEditingItem(null);
    } catch (error: any) {
      handleGlobalError(
        error,
        editingItem ? OperationType.UPDATE : OperationType.CREATE,
        'members',
        user
      );
      toast.error(error.message || 'Failed to save patient profile');
    }
  };

  const handleAddBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newBooking.date || !newBooking.startTime || !newBooking.endTime || !newBooking.roomId) {
      return;
    }

    if (newBooking.startTime >= newBooking.endTime) {
      toast.error('End time must be after start time.');
      return;
    }

    let finalClientId = selectedBookingMember?.id;

    if (!selectedBookingMember && guestName && guestPhone) {
      try {
        const guestResult = await getOrCreateGhostMember(guestPhone, guestName, user.uid);
        finalClientId = guestResult.memberId;
        if (guestResult.created) {
          await updateDoc(doc(db, 'members', finalClientId), { isPhysioPatient: true });
        }
      } catch {
        toast.error('Failed to create guest record');
        return;
      }
    }

    if (!finalClientId) {
      toast.error('Please select a patient or provide walk-in guest details.');
      return;
    }

    // Build schedule dates (supports single or recurring multi-session plan)
    const datesToSchedule: string[] = [];
    const totalCount = editingItem ? 1 : Math.max(1, Math.min(20, Number(recurringCount) || 1));
    const baseDateObj = new Date(`${newBooking.date}T12:00:00`);
    for (let i = 0; i < totalCount; i++) {
      const d = new Date(baseDateObj.getTime() + i * (Number(recurringIntervalDays) || 2) * 86400000);
      datesToSchedule.push(d.toISOString().split('T')[0]);
    }

    // Strict Collision Check across all target dates
    for (const dStr of datesToSchedule) {
      const collisionMsg = checkScheduleCollision(
        dStr,
        newBooking.startTime,
        newBooking.endTime,
        newBooking.roomId,
        newBooking.therapistId,
        editingItem?.id
      );
      if (collisionMsg) {
        toast.error(collisionMsg);
        return;
      }
    }

    try {
      // Sync clinical fields onto Central Member
      await updateDoc(doc(db, 'members', finalClientId), stripUndefined({
        isPhysioPatient: true,
        physioDiagnosis: newBooking.injury || selectedBookingMember?.physioDiagnosis || '',
        physioBodyArea: newBooking.bodyArea || selectedBookingMember?.physioBodyArea || '',
        physioCaseStatus: newBooking.caseStatus || 'Active Treatment',
        physioEstimatedSessions:
          Number(newBooking.estimatedSessions) || selectedBookingMember?.physioEstimatedSessions || 10,
        physioAssignedTherapistId:
          newBooking.therapistId || selectedBookingMember?.physioAssignedTherapistId || '',
        physioAssignedRoomId: newBooking.roomId,
        physioSoapNotes: newBooking.soapNotes || ''
      }));

      const selectedTherapistObj = therapists.find(t => t.id === newBooking.therapistId);
      const selectedTherapistNameLower = selectedTherapistObj
        ? `${selectedTherapistObj.firstName} ${selectedTherapistObj.lastName}`.trim().toLowerCase()
        : '';
      const linkedContract = thirdPartyContracts.find(
        tp =>
          tp.status === 'active' &&
          newBooking.therapistId &&
          ((tp.linkedTherapistIds || []).includes(newBooking.therapistId) ||
            (tp.practitioners || []).some(
              p =>
                p.id === newBooking.therapistId ||
                (selectedTherapistNameLower && p.name.trim().toLowerCase() === selectedTherapistNameLower)
            ))
      );

      if (editingItem) {
        const wasAlreadyPaid = editingItem?.paymentStatus === 'paid';
        const wantsImmediatePayment = newBooking.paymentStatus === 'paid' && !wasAlreadyPaid;
        const bookingData = stripUndefined({
          ...newBooking,
          paymentStatus: wantsImmediatePayment ? 'pending' : newBooking.paymentStatus || 'pending',
          clientId: finalClientId,
          thirdPartyContractId: linkedContract?.id || newBooking.thirdPartyContractId || '',
          uid: user.uid
        });
        await updateDoc(doc(db, 'physioBookings', editingItem.id), stripUndefined(bookingData));
        if (wantsImmediatePayment) {
          await executePhysioCustomerPayment(
            { ...(bookingData as PhysioBookingRecord), id: editingItem.id },
            physioPaymentMethod,
            physioCouponInput,
            physioCashbackInput
          );
        }
        toast.success('Appointment updated');
      } else {
        let firstCreatedId = '';
        const wantsImmediatePayment = newBooking.paymentStatus === 'paid';
        for (let idx = 0; idx < datesToSchedule.length; idx++) {
          const dStr = datesToSchedule[idx];
          const bookingData = stripUndefined({
            ...newBooking,
            date: dStr,
            paymentStatus: idx === 0 && wantsImmediatePayment ? 'pending' : newBooking.paymentStatus || 'pending',
            clientId: finalClientId,
            thirdPartyContractId: linkedContract?.id || '',
            uid: user.uid
          });
          const docRef = await addDoc(collection(db, 'physioBookings'), stripUndefined(bookingData));
          if (idx === 0) firstCreatedId = docRef.id;
        }

        if (wantsImmediatePayment && firstCreatedId) {
          await executePhysioCustomerPayment(
            {
              ...(newBooking as PhysioBookingRecord),
              id: firstCreatedId,
              clientId: finalClientId
            },
            physioPaymentMethod,
            physioCouponInput,
            physioCashbackInput
          );
        }
        toast.success(
          datesToSchedule.length > 1
            ? `Scheduled ${datesToSchedule.length} recurring physiotherapy sessions`
            : 'Physiotherapy session scheduled'
        );
      }

      setIsBookingModalOpen(false);
      setSelectedBookingMember(null);
      setGuestName('');
      setGuestPhone('');
      setPhysioPaymentMethod('cash');
      setPhysioCouponInput('');
      setPhysioCashbackInput('');
      setEditingItem(null);
    } catch (error: any) {
      handleGlobalError(
        error,
        editingItem ? OperationType.UPDATE : OperationType.CREATE,
        'physioBookings',
        user
      );
      toast.error(error.message || 'Failed to schedule appointment');
    }
  };

  // Room & Settings CRUD
  const handleSaveRoom = async (roomData: Omit<PhysioRoom, 'id'>, existingId?: string) => {
    if (!user) return;
    const id = existingId || `room_${Date.now()}`;
    await setDoc(doc(db, 'physio_rooms', id), stripUndefined({ ...roomData, id, uid: user.uid }), { merge: true });
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!user) return;
    if (!window.confirm('Delete this treatment room?')) return;
    await deleteDoc(doc(db, 'physio_rooms', roomId));
    toast.success('Treatment room deleted');
  };

  const handleSaveClinicalSettings = async (updated: PhysioClinicalSettings) => {
    if (!user) return;
    await setDoc(
      doc(db, 'physio_settings', 'config'),
      stripUndefined({ ...updated, updatedAt: new Date().toISOString() }),
      { merge: true }
    );
    setClinicalSettings(updated);
  };

  // Physio Packages CRUD & Assignment
  const handleSavePhysioPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newPackageForm.name) return;
    const id = editingPackage?.id || `PPKG-${Date.now()}`;
    const payload: PhysioPackage = stripUndefined({
      id,
      name: newPackageForm.name.trim(),
      targetType: newPackageForm.targetType || 'patient',
      sessionType: newPackageForm.sessionType || 'Manual Therapy',
      sessions: Math.max(1, Number(newPackageForm.sessions) || 10),
      price: Math.max(0, Number(newPackageForm.price) || 0),
      discountPercent: Number(newPackageForm.discountPercent) || 0,
      discountAmount: Number(newPackageForm.discountAmount) || 0,
      priceOverride:
        newPackageForm.priceOverride !== undefined && Number(newPackageForm.priceOverride) > 0
          ? Number(newPackageForm.priceOverride)
          : undefined,
      durationWeeks: Number(newPackageForm.durationWeeks) || 8,
      notes: newPackageForm.notes || '',
      uid: user.uid,
      createdAt: editingPackage?.createdAt || new Date().toISOString()
    });
    await setDoc(doc(db, 'physio_packages', id), stripUndefined(payload), { merge: true });
    toast.success(editingPackage ? 'Physio package updated' : 'Physio package created');
    setIsPackageModalOpen(false);
    setEditingPackage(null);
  };

  const handleAssignPatientPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !assignPackageModalPkg || !assignPackageClientId) return;
    const client = clients.find(c => c.id === assignPackageClientId);
    if (!client) return;

    const effectiveFee = getEffectivePhysioPackagePrice(assignPackageModalPkg);
    if (assignPackagePaymentMethod === 'member_balance' && (client.balance || 0) < effectiveFee) {
      toast.error('Insufficient Member Wallet balance.');
      return;
    }

    const sub: PhysioPatientPackageSubscription = {
      id: `PSUB-${Date.now()}`,
      packageId: assignPackageModalPkg.id,
      packageName: assignPackageModalPkg.name,
      sessionType: assignPackageModalPkg.sessionType,
      totalSessions: assignPackageModalPkg.sessions,
      usedSessions: 0,
      pricePaid: effectiveFee,
      startDate: new Date().toISOString().slice(0, 10),
      status: 'active'
    };

    try {
      await processLedgerTransaction(
        {
          amount: effectiveFee,
          subtotal: assignPackageModalPkg.price,
          discount: Math.max(0, assignPackageModalPkg.price - effectiveFee),
          paymentMethod: assignPackagePaymentMethod,
          memberId: client.id,
          sourceModule: 'physio',
          cashierId: user.uid,
          transactionType: 'physio_package_sale',
          referenceId: sub.id,
          notes: `Physio Package Assigned: ${assignPackageModalPkg.name} (${assignPackageModalPkg.sessions} sessions) for ${client.firstName} ${client.lastName}`
        },
        async transaction => {
          transaction.update(doc(db, 'members', client.id), {
            isPhysioPatient: true,
            physioEstimatedSessions: assignPackageModalPkg.sessions,
            physioActivePackages: [...(client.physioActivePackages || []), sub]
          });
        }
      );
      toast.success(`Assigned ${assignPackageModalPkg.name} to ${client.firstName} ${client.lastName}`);
      setAssignPackageModalPkg(null);
      setAssignPackageClientId('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign physio package');
    }
  };

  const handleAssignTherapistQuotaPackage = async (
    therapist: PhysioTherapistRecord,
    pkg: PhysioPackage
  ) => {
    if (!user) return;
    const effectiveFee = getEffectivePhysioPackagePrice(pkg);
    try {
      await processLedgerTransaction({
        amount: effectiveFee,
        paymentMethod: 'cash',
        sourceModule: 'physio',
        cashierId: user.uid,
        transactionType: 'physio_therapist_quota_package',
        direction: 'inflow',
        referenceId: therapist.id,
        notes: `External Physiotherapist Quota Package: ${pkg.name} (${pkg.sessions} sessions) — Dr. ${therapist.firstName} ${therapist.lastName}`
      });

      await updateDoc(doc(db, 'physiotherapists', therapist.id), stripUndefined({
        activeQuotaPackageId: pkg.id,
        quotaPackageName: pkg.name,
        quotaTotalSessions: pkg.sessions,
        quotaUsedSessions: 0
      }));
      toast.success(`Assigned ${pkg.name} quota package to Dr. ${therapist.lastName}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign therapist quota package');
    }
  };

  const handleAddProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newProgram.clientId || !newProgram.name || !newProgram.totalSessions) return;
    try {
      const clientTarget = clients.find(c => c.id === newProgram.clientId);
      if (clientTarget && !clientTarget.isPhysioPatient) {
        await updateDoc(doc(db, 'members', newProgram.clientId), stripUndefined({ isPhysioPatient: true }));
      }

      if (editingItem) {
        await updateDoc(doc(db, 'physioPrograms', editingItem.id), stripUndefined({ ...newProgram }));
      } else {
        await addDoc(collection(db, 'physioPrograms'), stripUndefined({ ...newProgram, uid: user.uid }));
      }
      toast.success(editingItem ? 'Program updated' : 'Program added');
      setIsProgramModalOpen(false);
      setNewProgram({ completedSessions: 0 });
      setEditingItem(null);
    } catch (error: any) {
      handleGlobalError(error, OperationType.WRITE, 'physioPrograms', user);
    }
  };

  const handleAddPrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newPrescription.clientId || !newPrescription.details) return;
    try {
      if (editingItem) {
        await updateDoc(doc(db, 'physioPrescriptions', editingItem.id), stripUndefined({ ...newPrescription }));
      } else {
        await addDoc(collection(db, 'physioPrescriptions'), stripUndefined({ ...newPrescription, uid: user.uid }));
      }
      toast.success(editingItem ? 'Prescription updated' : 'Prescription added');
      setIsPrescriptionModalOpen(false);
      setNewPrescription({ date: new Date().toISOString().split('T')[0], exercises: [] });
      setEditingItem(null);
    } catch (error: any) {
      handleGlobalError(error, OperationType.WRITE, 'physioPrescriptions', user);
    }
  };

  const updateBookingStatus = async (
    booking: PhysioBookingRecord,
    status: 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show'
  ) => {
    if (status === 'checked_in' || status === 'completed') {
      await handleConfirmPhysioCheckIn(booking);
      return;
    }
    try {
      await updateDoc(doc(db, 'physioBookings', booking.id), { status });
      toast.success(`Booking marked as ${status}`);
    } catch (error) {
      handleGlobalError(error, OperationType.UPDATE, `physioBookings/${booking.id}`, user);
    }
  };

  const deleteItem = async (collectionName: string, id: string) => {
    if (!window.confirm('Are you sure you want to delete this record?')) return;
    try {
      await deleteDoc(doc(db, collectionName, id));
      toast.success('Deleted');
    } catch (error) {
      handleGlobalError(error, OperationType.DELETE, `${collectionName}/${id}`, user);
    }
  };

  const filteredClients = clients.filter(
    c =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone?.includes(searchQuery)
  );

  // 7-day dates for Weekly calendar view
  const weekDates = useMemo(() => {
    const base = new Date(`${selectedCalendarDate}T12:00:00`);
    const dayOfWeek = base.getDay();
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(base.getTime() + diffToMon * 86400000);
    return Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date(monday.getTime() + idx * 86400000);
      return d.toISOString().split('T')[0];
    });
  }, [selectedCalendarDate]);

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'
      } font-sans`}
    >
      <div className="max-w-7xl mx-auto p-6 md:p-10">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 shrink-0">
            <TenantBrandLockup
              systemName={systemName}
              systemLogo={systemLogo}
              size="sm"
              subtitle="Physiotherapy"
            />
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => setIsClinicalSettingsModalOpen(true)}
              className={`h-9 px-3.5 rounded-lg border text-xs font-semibold flex items-center gap-2 transition-colors ${
                isDarkMode
                  ? 'bg-[#0B0F17] border-zinc-800 text-zinc-200 hover:border-[#00B8C8]/50'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-[#00B8C8]/50'
              }`}
            >
              <Settings size={14} className="text-[#00B8C8]" />
              Rooms & Clinical Options
            </button>
            <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
          </div>
        </header>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 mb-8 border-b border-slate-200 dark:border-zinc-800 pb-4">
          {[
            { id: 'calendar', label: 'Rooms & Schedule', icon: CalendarIcon },
            { id: 'clients', label: 'Patients & Cases', icon: Users },
            { id: 'therapists', label: 'Physiotherapists (360°)', icon: Stethoscope },
            { id: 'packages', label: 'Packages & Plans', icon: Package },
            { id: 'third_party', label: '3rd-Party B2B', icon: Building2 },
            { id: 'finance', label: 'Finance & Ledgers', icon: CreditCard }
          ].map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id as any);
                  if (t.id !== 'clients') setSelectedClient(null);
                }}
                className={`h-9 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  activeTab === t.id
                    ? 'bg-[#00B8C8] text-[#05070A] shadow-sm'
                    : isDarkMode
                    ? 'text-zinc-400 hover:text-white hover:bg-[#0B0F17]'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-white'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* 1. DYNAMIC ROOM-BY-ROOM & WEEKLY CALENDAR TAB */}
        {activeTab === 'calendar' && (
          <div className="space-y-6">
            {/* Calendar Toolbar */}
            <div
              className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1">
                  <button
                    onClick={() => {
                      const d = new Date(`${selectedCalendarDate}T12:00:00`);
                      d.setDate(d.getDate() - (calendarViewMode === 'weekly' ? 7 : 1));
                      setSelectedCalendarDate(d.toISOString().split('T')[0]);
                    }}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <input
                    type="date"
                    value={selectedCalendarDate}
                    onChange={e => setSelectedCalendarDate(e.target.value)}
                    className={`bg-transparent text-xs font-bold font-mono px-2 outline-none ${
                      isDarkMode ? 'text-zinc-100 [color-scheme:dark]' : 'text-slate-900 [color-scheme:light]'
                    }`}
                  />
                  <button
                    onClick={() => {
                      const d = new Date(`${selectedCalendarDate}T12:00:00`);
                      d.setDate(d.getDate() + (calendarViewMode === 'weekly' ? 7 : 1));
                      setSelectedCalendarDate(d.toISOString().split('T')[0]);
                    }}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>

                <button
                  onClick={() => setSelectedCalendarDate(new Date().toISOString().split('T')[0])}
                  className="px-3 py-1.5 rounded-lg bg-[#00B8C8]/15 text-[#00B8C8] text-xs font-bold"
                >
                  Today
                </button>

                <div className="flex p-1 rounded-xl border bg-zinc-900 border-zinc-800">
                  <button
                    onClick={() => setCalendarViewMode('rooms_day')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      calendarViewMode === 'rooms_day'
                        ? 'bg-[#00B8C8] text-[#05070A]'
                        : 'text-zinc-400'
                    }`}
                  >
                    Room-by-Room Day Grid
                  </button>
                  <button
                    onClick={() => setCalendarViewMode('weekly')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      calendarViewMode === 'weekly'
                        ? 'bg-[#00B8C8] text-[#05070A]'
                        : 'text-zinc-400'
                    }`}
                  >
                    7-Day Weekly View
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={calendarFilterRoom}
                  onChange={e => setCalendarFilterRoom(e.target.value)}
                  className={`p-2 rounded-xl border text-xs font-bold ${
                    isDarkMode
                      ? 'bg-[#05070A] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="all">All Rooms ({activeRooms.length})</option>
                  {activeRooms.map(r => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>

                <select
                  value={calendarFilterTherapist}
                  onChange={e => setCalendarFilterTherapist(e.target.value)}
                  className={`p-2 rounded-xl border text-xs font-bold ${
                    isDarkMode
                      ? 'bg-[#05070A] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="all">All Physiotherapists</option>
                  {therapists.map(t => (
                    <option key={t.id} value={t.id}>
                      Dr. {t.firstName} {t.lastName}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => openBookingModal()}
                  className="flex items-center gap-2 px-4 py-2 bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] rounded-xl text-xs font-bold shadow-sm shadow-cyan-500/20"
                >
                  <Plus size={16} />
                  Schedule Appointment
                </button>
              </div>
            </div>

            {/* Room-by-Room Daily Columns */}
            {calendarViewMode === 'rooms_day' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {activeRooms
                  .filter(r => calendarFilterRoom === 'all' || r.name === calendarFilterRoom)
                  .map(room => {
                    const roomBookings = bookings
                      .filter(
                        b =>
                          b.roomId === room.name &&
                          b.date === selectedCalendarDate &&
                          (calendarFilterTherapist === 'all' || b.therapistId === calendarFilterTherapist)
                      )
                      .sort((a, b) => a.startTime.localeCompare(b.startTime));

                    return (
                      <div
                        key={room.id}
                        className={`p-5 rounded-2xl border flex flex-col justify-between ${
                          isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-4 pb-3 border-b border-zinc-800/60">
                            <div>
                              <h3 className="font-bold text-sm flex items-center gap-2">
                                <DoorOpen className="text-[#00B8C8]" size={16} />
                                {room.name}
                              </h3>
                              {room.equipmentTags && room.equipmentTags.length > 0 && (
                                <p className="text-[11px] text-zinc-400 mt-0.5">
                                  {room.equipmentTags.join(' · ')}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => openBookingModal(null, room.name, selectedCalendarDate)}
                              className="p-1.5 rounded-lg bg-[#00B8C8]/15 text-[#00B8C8] hover:bg-[#00B8C8]/25"
                              title={`Book ${room.name}`}
                            >
                              <Plus size={14} />
                            </button>
                          </div>

                          <div className="space-y-3">
                            {roomBookings.map(booking => {
                              const client = clients.find(c => c.id === booking.clientId);
                              const therapist = therapists.find(t => t.id === booking.therapistId);
                              const isCheckedIn =
                                booking.status === 'checked_in' || booking.status === 'completed';
                              const compSessions = client?.physioCompletedSessions || 0;
                              const estSessions =
                                booking.estimatedSessions || client?.physioEstimatedSessions || 10;

                              return (
                                <div
                                  key={booking.id}
                                  className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                                    isDarkMode
                                      ? 'bg-[#05070A] border-zinc-800'
                                      : 'bg-slate-50 border-slate-200'
                                  }`}
                                >
                                  <div className="flex justify-between items-center">
                                    <span className="font-mono font-bold text-[#00B8C8]">
                                      {booking.startTime} – {booking.endTime}
                                    </span>
                                    <span
                                      className={`text-[10px] font-bold uppercase ${
                                        isCheckedIn
                                          ? 'text-emerald-400'
                                          : booking.status === 'cancelled'
                                          ? 'text-rose-400'
                                          : 'text-amber-400'
                                      }`}
                                    >
                                      {isCheckedIn ? 'Checked-In' : booking.status}
                                    </span>
                                  </div>

                                  <div>
                                    <p className="font-bold text-sm">
                                      {client
                                        ? `${client.firstName} ${client.lastName}`
                                        : 'Walk-in Patient'}
                                    </p>
                                    <p className="text-[11px] text-zinc-400">
                                      {booking.sessionType || booking.type}
                                      {therapist ? ` · Dr. ${therapist.lastName}` : ''}
                                    </p>
                                  </div>

                                  {(booking.injury || client?.physioDiagnosis) && (
                                    <div className="text-[11px] text-zinc-400">
                                      Diagnosis: <strong className="text-zinc-200">{booking.injury || client?.physioDiagnosis}</strong>
                                    </div>
                                  )}

                                  {/* Session Progress Bar */}
                                  <div className="space-y-1 pt-1">
                                    <div className="flex justify-between text-[10px] text-zinc-400">
                                      <span>Treatment Plan</span>
                                      <span className="font-mono font-bold text-[#00B8C8]">
                                        {compSessions} / {estSessions} Sessions
                                      </span>
                                    </div>
                                    <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                                      <div
                                        className="h-full bg-[#00B8C8]"
                                        style={{
                                          width: `${Math.min(
                                            100,
                                            (compSessions / Math.max(1, estSessions)) * 100
                                          )}%`
                                        }}
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60">
                                    {booking.status === 'scheduled' ? (
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          onClick={() => handleConfirmPhysioCheckIn(booking)}
                                          className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold text-[10px] flex items-center gap-1 hover:bg-emerald-500/30"
                                        >
                                          <CheckCircle size={12} /> Confirm Check-In
                                        </button>
                                        <button
                                          onClick={() => updateBookingStatus(booking, 'cancelled')}
                                          className="p-1 text-zinc-400 hover:text-rose-500"
                                          title="Cancel"
                                        >
                                          <XCircle size={14} />
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-[10px] font-mono text-zinc-400">
                                        {formatCurrency(booking.cost || 0)} · {booking.paymentStatus || 'pending'}
                                      </span>
                                    )}
                                    <div className="flex items-center gap-1.5 ml-auto">
                                      <button
                                        onClick={() => openBookingModal(booking)}
                                        className="p-1 text-zinc-400 hover:text-[#00B8C8]"
                                      >
                                        <Edit size={13} />
                                      </button>
                                      <button
                                        onClick={() => deleteItem('physioBookings', booking.id)}
                                        className="p-1 text-zinc-400 hover:text-rose-500"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}

                            {roomBookings.length === 0 && (
                              <p className="text-xs text-zinc-500 italic py-6 text-center">
                                No appointments scheduled for {selectedCalendarDate}.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              /* 7-Day Weekly View */
              <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
                {weekDates.map(dStr => {
                  const dayBookings = bookings
                    .filter(
                      b =>
                        b.date === dStr &&
                        (calendarFilterRoom === 'all' || b.roomId === calendarFilterRoom) &&
                        (calendarFilterTherapist === 'all' || b.therapistId === calendarFilterTherapist)
                    )
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));

                  const isSelected = dStr === selectedCalendarDate;

                  return (
                    <div
                      key={dStr}
                      className={`p-3.5 rounded-2xl border space-y-3 ${
                        isSelected
                          ? 'border-[#00B8C8] bg-[#00B8C8]/5'
                          : isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                        <div>
                          <div className="text-[10px] font-bold uppercase text-zinc-400">
                            {new Date(`${dStr}T12:00:00`).toLocaleDateString('en-US', {
                              weekday: 'short'
                            })}
                          </div>
                          <div className="text-xs font-mono font-bold">{dStr.slice(5)}</div>
                        </div>
                        <button
                          onClick={() => openBookingModal(null, undefined, dStr)}
                          className="p-1 rounded bg-[#00B8C8]/15 text-[#00B8C8]"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      <div className="space-y-2">
                        {dayBookings.map(b => {
                          const client = clients.find(c => c.id === b.clientId);
                          const isChecked = b.status === 'checked_in' || b.status === 'completed';
                          return (
                            <div
                              key={b.id}
                              onClick={() => openBookingModal(b)}
                              className={`p-2 rounded-lg border text-[11px] cursor-pointer transition-colors ${
                                isDarkMode
                                  ? 'bg-[#05070A] border-zinc-800 hover:border-[#00B8C8]/50'
                                  : 'bg-slate-50 border-slate-200'
                              }`}
                            >
                              <div className="flex justify-between font-mono text-[10px] text-[#00B8C8] font-bold">
                                <span>{b.startTime}</span>
                                <span className={isChecked ? 'text-emerald-400' : 'text-amber-400'}>
                                  {isChecked ? '✓' : '•'}
                                </span>
                              </div>
                              <div className="font-bold truncate mt-0.5">
                                {client ? `${client.firstName} ${client.lastName}` : 'Walk-in'}
                              </div>
                              <div className="text-[10px] text-zinc-400 truncate">{b.roomId}</div>
                            </div>
                          );
                        })}
                        {dayBookings.length === 0 && (
                          <div className="text-[10px] text-zinc-500 text-center py-4">Empty</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 2. PATIENTS & CLINICAL CASES TAB */}
        {activeTab === 'clients' && !selectedClient && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border ${
                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
                } w-full md:w-96`}
              >
                <Search size={18} className="text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search patients by name or phone..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none focus:ring-0 w-full text-sm outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setPatientModalMode('short_link');
                    setShareWhatsappPhone('');
                    setIsClientModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-[#00B8C8] border border-[#00B8C8]/40 rounded-xl text-xs font-bold transition-colors whitespace-nowrap"
                >
                  <Link2 size={15} />
                  Patient Self-Intake Link
                </button>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setPatientModalMode('form');
                    setClientTherapistSearch('');
                    setNewClient({
                      physioCaseStatus: 'Active Treatment',
                      visitType: 'Initial Session',
                      numberOfSessions: 10,
                      physioEstimatedSessions: 10,
                      physioCompletedSessions: 0,
                      bloodType: 'O+',
                      isInsured: false
                    });
                    setIsClientModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] rounded-xl text-xs font-bold shadow-sm shadow-cyan-500/15 transition-colors whitespace-nowrap"
                >
                  <UserPlus size={16} />
                  New Patient Case
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredClients.map(client => {
                const est = client.numberOfSessions || client.physioEstimatedSessions || 10;
                const comp =
                  client.physioCompletedSessions ??
                  bookings.filter(
                    b =>
                      b.clientId === client.id &&
                      (b.status === 'checked_in' || b.status === 'completed')
                  ).length;
                const assignedDoc = therapists.find(
                  t => t.id === (client.assignedPhysiotherapistId || client.physioAssignedTherapistId)
                );

                return (
                  <div
                    key={client.id}
                    onClick={() => setSelectedClient(client)}
                    className={`p-5 rounded-2xl border cursor-pointer transition-all hover:shadow-md space-y-3 ${
                      isDarkMode
                        ? 'bg-[#0B0F17] border-zinc-800 hover:border-[#00B8C8]/50'
                        : 'bg-white border-slate-200 hover:border-[#00B8C8]/60'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-base font-bold">
                          {client.firstName} {client.lastName}
                        </h3>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {client.phone || 'No phone'} ·{' '}
                          <span className="text-[#00B8C8] font-semibold">
                            {client.visitType || client.physioCaseStatus || 'Active Treatment'}
                          </span>
                        </p>
                      </div>
                      {client.bloodType && (
                        <span className="px-2 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-[10px] font-mono text-rose-400 font-bold">
                          {client.bloodType}
                        </span>
                      )}
                    </div>

                    {client.physioDiagnosis && (
                      <div className="text-xs text-zinc-300">
                        Diagnosis: <strong>{client.physioDiagnosis}</strong>
                        {client.physioBodyArea ? ` (${client.physioBodyArea})` : ''}
                      </div>
                    )}

                    {assignedDoc && (
                      <div className="text-xs text-zinc-400">
                        Physiotherapist: Dr. {assignedDoc.firstName} {assignedDoc.lastName}
                      </div>
                    )}

                    {/* Completed vs Estimated Sessions Progress */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-zinc-400">Treatment Progress</span>
                        <span className="font-mono font-bold text-[#00B8C8]">
                          {comp} / {est} Sessions Completed
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-[#00B8C8]"
                          style={{
                            width: `${Math.min(100, (comp / Math.max(1, est)) * 100)}%`
                          }}
                        />
                      </div>
                    </div>

                    {client.physioActivePackages && client.physioActivePackages.length > 0 && (
                      <div className="pt-2 border-t border-zinc-800/60 flex flex-wrap gap-2 text-[11px] text-emerald-400 font-semibold">
                        {client.physioActivePackages.map(sub => (
                          <span key={sub.id}>
                            Package: {sub.packageName} ({sub.usedSessions}/{sub.totalSessions} used)
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Patient Clinical Profile Detail View */}
        {activeTab === 'clients' && selectedClient && (
          <div className="space-y-8">
            <button
              onClick={() => setSelectedClient(null)}
              className={`flex items-center gap-2 text-sm font-medium ${
                isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-black'
              }`}
            >
              <ArrowLeft size={16} /> Back to Patients
            </button>

            <div
              className={`p-8 rounded-3xl border space-y-6 ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-2xl font-black">
                    {selectedClient.firstName} {selectedClient.lastName}
                  </h2>
                  <p className="text-sm text-zinc-400 mt-1">
                    {selectedClient.phone} · {selectedClient.email} · Case Status:{' '}
                    <strong className="text-[#00B8C8]">
                      {selectedClient.physioCaseStatus || 'Active Treatment'}
                    </strong>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingItem(selectedClient);
                      setPatientModalMode('form');
                      setNewClient(selectedClient);
                      const docMatch = therapists.find(
                        t => t.id === (selectedClient.assignedPhysiotherapistId || selectedClient.physioAssignedTherapistId)
                      );
                      setClientTherapistSearch(
                        selectedClient.assignedPhysiotherapistName ||
                          (docMatch ? `Dr. ${docMatch.firstName} ${docMatch.lastName}` : '')
                      );
                      setIsClientModalOpen(true);
                    }}
                    className="text-[#00B8C8] hover:text-[#0099A8] p-2"
                  >
                    <Edit size={20} />
                  </button>
                  <button
                    onClick={() => {
                      deleteItem('members', selectedClient.id);
                      setSelectedClient(null);
                    }}
                    className="text-red-500 hover:text-red-600 p-2"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="text-[10px] font-bold uppercase text-zinc-400">Visit Type & Diagnosis</div>
                  <div className="font-bold text-sm mt-1">
                    {selectedClient.visitType || selectedClient.physioDiagnosis || 'Initial Session'}
                  </div>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="text-[10px] font-bold uppercase text-zinc-400">Body Area & Blood Type</div>
                  <div className="font-bold text-sm mt-1">
                    {selectedClient.physioBodyArea || 'General'} ·{' '}
                    <span className="text-rose-400 font-mono">Blood: {selectedClient.bloodType || 'N/A'}</span>
                  </div>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="text-[10px] font-bold uppercase text-zinc-400">Sessions Progress</div>
                  <div className="font-bold font-mono text-sm text-[#00B8C8] mt-1">
                    {selectedClient.physioCompletedSessions || 0} / {selectedClient.numberOfSessions || selectedClient.physioEstimatedSessions || 10} Completed
                  </div>
                </div>
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="text-[10px] font-bold uppercase text-zinc-400">Assigned Physiotherapist</div>
                  <div className="font-bold text-sm mt-1 text-[#00B8C8]">
                    {selectedClient.assignedPhysiotherapistName ||
                      (() => {
                        const docObj = therapists.find(t => t.id === selectedClient.physioAssignedTherapistId);
                        return docObj ? `Dr. ${docObj.firstName} ${docObj.lastName}` : 'Unassigned';
                      })()}
                  </div>
                </div>
              </div>

              {/* Extended Patient Intake Details */}
              <div className={`p-4 rounded-2xl border grid grid-cols-2 md:grid-cols-4 gap-4 text-xs ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                <div>
                  <span className="text-zinc-500 block uppercase text-[10px] font-bold">Date of Birth & Marital</span>
                  <span className="font-semibold">{selectedClient.dob || 'N/A'} {selectedClient.maritalStatus ? `• ${selectedClient.maritalStatus}` : ''}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block uppercase text-[10px] font-bold">Occupation & Address</span>
                  <span className="font-semibold">{selectedClient.occupation || 'N/A'} {selectedClient.address ? `• ${selectedClient.address}` : ''}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block uppercase text-[10px] font-bold">Referring Physician & Insurance</span>
                  <span className="font-semibold">
                    {selectedClient.referringPhysician ? `Dr. ${selectedClient.referringPhysician}` : 'Self-Referred'} ·{' '}
                    {selectedClient.isInsured ? `Insured (${selectedClient.insuranceCompanyName || 'Yes'})` : 'Uninsured'}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block uppercase text-[10px] font-bold">Emergency Contact</span>
                  <span className="font-semibold">
                    {selectedClient.emergencyContactName
                      ? `${selectedClient.emergencyContactName} (${selectedClient.emergencyContactRelationship || 'Contact'}) ${selectedClient.emergencyContactPhone || ''}`
                      : 'None recorded'}
                  </span>
                </div>
              </div>

              {selectedClient.scanImageUrl && (
                <div className={`p-4 rounded-2xl border space-y-2 ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-[#00B8C8]">
                      Diagnostic Scan / X-Ray Attachment ({selectedClient.scanImageName || 'Scan Image'})
                    </span>
                    <a
                      href={selectedClient.scanImageUrl}
                      download={selectedClient.scanImageName || 'patient-scan'}
                      className="text-xs font-bold text-[#00B8C8] hover:underline"
                    >
                      Download Scan
                    </a>
                  </div>
                  {selectedClient.scanImageUrl.startsWith('data:image') && (
                    <img
                      src={selectedClient.scanImageUrl}
                      alt="Patient Scan"
                      className="max-h-64 rounded-xl border border-zinc-800 object-contain"
                    />
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <h3 className="text-sm font-bold uppercase text-zinc-400 mb-2 flex items-center gap-2">
                    <Activity size={16} className="text-[#00B8C8]" /> Medical History & SOAP Notes
                  </h3>
                  <p className="text-sm whitespace-pre-wrap text-zinc-300">
                    {selectedClient.physioSoapNotes ||
                      selectedClient.medicalHistory ||
                      'No clinical SOAP notes recorded.'}
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold uppercase text-zinc-400 flex items-center gap-2">
                      <Package size={16} className="text-[#00B8C8]" /> Active Patient Packages
                    </h3>
                    {physioPackages.filter(p => p.targetType === 'patient').length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const firstPatientPkg = physioPackages.find(p => p.targetType === 'patient');
                          if (firstPatientPkg) {
                            setAssignPackageClientId(selectedClient.id);
                            setAssignPackageModalPkg(firstPatientPkg);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[#00B8C8]/15 text-[#00B8C8] border border-[#00B8C8]/30 text-[10px] font-bold uppercase"
                      >
                        + Assign Package
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(selectedClient.physioActivePackages || []).map(sub => (
                      <div
                        key={sub.id}
                        className="p-3 rounded-xl bg-[#00B8C8]/10 border border-[#00B8C8]/30 flex justify-between items-center text-xs"
                      >
                        <div>
                          <div className="font-bold">{sub.packageName}</div>
                          <div className="text-zinc-400">{sub.sessionType} · Exp: {sub.expiresAt?.slice(0, 10) || 'N/A'}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="font-mono font-bold text-[#00B8C8]">
                            {sub.usedSessions} / {sub.totalSessions} Used
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              const nextUsedStr = window.prompt(
                                `Edit used sessions for "${sub.packageName}" (Total: ${sub.totalSessions}):`,
                                String(sub.usedSessions || 0)
                              );
                              if (nextUsedStr === null) return;
                              const nextUsed = Math.max(0, parseInt(nextUsedStr) || 0);
                              const nextTotalStr = window.prompt(
                                `Edit total sessions for "${sub.packageName}":`,
                                String(sub.totalSessions || 10)
                              );
                              const nextTotal = Math.max(1, parseInt(nextTotalStr || String(sub.totalSessions)) || sub.totalSessions);
                              const updatedSubs = (selectedClient.physioActivePackages || []).map(item =>
                                item.id === sub.id
                                  ? {
                                      ...item,
                                      usedSessions: nextUsed,
                                      totalSessions: nextTotal,
                                      remainingSessions: Math.max(0, nextTotal - nextUsed),
                                      status: nextUsed >= nextTotal ? ('completed' as const) : ('active' as const)
                                    }
                                  : item
                              );
                              await updateDoc(doc(db, 'members', selectedClient.id), {
                                physioActivePackages: updatedSubs
                              });
                              setSelectedClient({ ...selectedClient, physioActivePackages: updatedSubs });
                              toast.success('Package sessions updated');
                            }}
                            className="p-1 text-zinc-400 hover:text-[#00B8C8]"
                            title="Edit Package Sessions"
                          >
                            <Edit size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`Remove package "${sub.packageName}" from ${selectedClient.firstName}?`)) return;
                              const updatedSubs = (selectedClient.physioActivePackages || []).filter(
                                item => item.id !== sub.id
                              );
                              await updateDoc(doc(db, 'members', selectedClient.id), {
                                physioActivePackages: updatedSubs
                              });
                              setSelectedClient({ ...selectedClient, physioActivePackages: updatedSubs });
                              toast.success('Package removed from patient');
                            }}
                            className="p-1 text-zinc-400 hover:text-rose-500"
                            title="Remove Package"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {(!selectedClient.physioActivePackages ||
                      selectedClient.physioActivePackages.length === 0) && (
                      <p className="text-xs text-zinc-500 italic">No active packages assigned.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Programs */}
              <div
                className={`p-6 rounded-2xl border ${
                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold">Treatment Programs</h3>
                  <button
                    onClick={() => {
                      setNewProgram({ clientId: selectedClient.id, completedSessions: 0 });
                      setIsProgramModalOpen(true);
                    }}
                    className="p-2 bg-[#00B8C8]/15 text-[#00B8C8] rounded-lg hover:bg-[#00B8C8]/25 transition-colors"
                  >
                    <Plus size={18} />
                  </button>
                </div>
                <div className="space-y-4">
                  {programs
                    .filter(p => p.clientId === selectedClient.id)
                    .map(program => (
                      <div
                        key={program.id}
                        className={`p-4 rounded-xl border ${
                          isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-bold">{program.name}</h4>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingItem(program);
                                setNewProgram(program);
                                setIsProgramModalOpen(true);
                              }}
                              className="text-zinc-400 hover:text-[#00B8C8]"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => deleteItem('physioPrograms', program.id)}
                              className="text-zinc-400 hover:text-red-500"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-zinc-800 rounded-full h-2 mb-2">
                          <div
                            className="bg-[#00B8C8] h-2 rounded-full"
                            style={{
                              width: `${(program.completedSessions / program.totalSessions) * 100}%`
                            }}
                          />
                        </div>
                        <p className="text-xs text-zinc-500">
                          {program.completedSessions} of {program.totalSessions} sessions completed
                        </p>
                      </div>
                    ))}
                </div>
              </div>

              {/* Prescriptions */}
              <div
                className={`p-6 rounded-2xl border ${
                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold">Exercise Prescriptions</h3>
                  <button
                    onClick={() => {
                      setNewPrescription({
                        clientId: selectedClient.id,
                        date: new Date().toISOString().split('T')[0],
                        exercises: []
                      });
                      setIsPrescriptionModalOpen(true);
                    }}
                    className="p-2 bg-[#00B8C8]/15 text-[#00B8C8] rounded-lg hover:bg-[#00B8C8]/25 transition-colors"
                  >
                    <Plus size={18} />
                  </button>
                </div>
                <div className="space-y-4">
                  {prescriptions
                    .filter(p => p.clientId === selectedClient.id)
                    .map(prescription => (
                      <div
                        key={prescription.id}
                        className={`p-4 rounded-xl border ${
                          isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-bold text-sm">{prescription.date}</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingItem(prescription);
                                setNewPrescription(prescription);
                                setIsPrescriptionModalOpen(true);
                              }}
                              className="text-zinc-400 hover:text-[#00B8C8]"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => deleteItem('physioPrescriptions', prescription.id)}
                              className="text-zinc-400 hover:text-red-500"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm mb-2">{prescription.details}</p>
                        {prescription.exercises && prescription.exercises.length > 0 && (
                          <ul className="list-disc list-inside text-xs text-zinc-400 space-y-1">
                            {prescription.exercises.map((ex, i) => (
                              <li key={i}>{ex}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. PHYSIOTHERAPISTS 360° TAB */}
        {activeTab === 'therapists' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Physiotherapists & Clinical Specialists</h2>
                <p className="text-xs text-zinc-400">
                  Click any physiotherapist card to open their 360° Clinical, Session & Financial Ledger View
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingItem(null);
                  setNewTherapist({});
                  setIsTherapistModalOpen(true);
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] rounded-xl text-xs font-bold shadow-sm shadow-cyan-500/15 transition-colors"
              >
                <Plus size={16} />
                Add Physiotherapist
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {therapists.map(therapist => {
                const conductedCount = bookings.filter(
                  b =>
                    b.therapistId === therapist.id &&
                    (b.status === 'checked_in' || b.status === 'completed')
                ).length;

                return (
                  <div
                    key={therapist.id}
                    onClick={() => setSelectedTherapistFor360(therapist)}
                    className={`p-6 rounded-2xl border cursor-pointer transition-all hover:border-[#00B8C8]/60 ${
                      isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black bg-[#00B8C8]/15 text-[#00B8C8]">
                        {therapist.firstName[0]}
                        {therapist.lastName[0]}
                      </div>
                      <div
                        className="flex gap-2"
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setEditingItem(therapist);
                            setNewTherapist(therapist);
                            setIsTherapistModalOpen(true);
                          }}
                          className="text-zinc-400 hover:text-[#00B8C8]"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => deleteItem('physiotherapists', therapist.id)}
                          className="text-zinc-400 hover:text-red-500"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <h3 className="text-lg font-bold">
                      Dr. {therapist.firstName} {therapist.lastName}
                    </h3>
                    <p className="text-[#00B8C8] font-semibold text-xs mb-3">
                      {therapist.specialization}
                    </p>
                    <div className="space-y-1.5 text-xs text-zinc-400">
                      <p>
                        Sessions Conducted:{' '}
                        <strong className="font-mono text-zinc-100">{conductedCount}</strong>
                      </p>
                      <p>
                        Session Fee:{' '}
                        <strong className="font-mono text-[#00B8C8]">
                          {formatCurrency(therapist.feePerSession || 0)}
                        </strong>
                      </p>
                      {therapist.quotaPackageName && (
                        <p className="text-emerald-400 font-semibold">
                          Quota Pack: {therapist.quotaPackageName} ({therapist.quotaUsedSessions || 0}/
                          {therapist.quotaTotalSessions || 0})
                        </p>
                      )}
                    </div>
                    <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs font-bold text-[#00B8C8]">
                      <span>Open 360° Clinical & Payout Profile</span>
                      <ChevronRight size={15} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. PHYSIOTHERAPY PACKAGES & PLANS TAB */}
        {activeTab === 'packages' && (
          <div className="space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Patient & Physiotherapist Session Packages</h2>
                <p className="text-xs text-zinc-400">
                  Multi-session treatment packages with automatic check-in session deduction, discounts, and fee overrides
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingPackage(null);
                  setNewPackageForm({
                    name: '',
                    targetType: 'patient',
                    sessionType: clinicalSettings.sessionTypes[0]?.name || 'Manual Therapy',
                    sessions: 10,
                    price: 350,
                    discountPercent: 0,
                    discountAmount: 0,
                    priceOverride: undefined,
                    durationWeeks: 8,
                    notes: ''
                  });
                  setIsPackageModalOpen(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] font-bold text-xs flex items-center gap-2"
              >
                <Plus size={16} /> Create Physio Package
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {physioPackages.map(pkg => {
                const effPrice = getEffectivePhysioPackagePrice(pkg);
                return (
                  <div
                    key={pkg.id}
                    className={`p-6 rounded-2xl border flex flex-col justify-between space-y-4 ${
                      isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#00B8C8]">
                            {pkg.targetType === 'therapist'
                              ? 'External Physiotherapist Quota Pack'
                              : 'Patient Treatment Package'}{' '}
                            · {pkg.sessionType}
                          </span>
                          <h3 className="text-lg font-black mt-0.5">{pkg.name}</h3>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => {
                              setEditingPackage(pkg);
                              setNewPackageForm(pkg);
                              setIsPackageModalOpen(true);
                            }}
                            className="p-1.5 text-zinc-400 hover:text-[#00B8C8]"
                          >
                            <Edit size={15} />
                          </button>
                          <button
                            onClick={() => deleteItem('physio_packages', pkg.id)}
                            className="p-1.5 text-zinc-400 hover:text-rose-500"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-baseline gap-2 pt-2">
                        <span className="text-2xl font-black font-mono text-[#00B8C8]">
                          {formatCurrency(effPrice)}
                        </span>
                        {effPrice < pkg.price && (
                          <span className="text-xs line-through text-zinc-500 font-mono">
                            {formatCurrency(pkg.price)}
                          </span>
                        )}
                        <span className="text-xs text-zinc-400">
                          · {pkg.sessions} Sessions ({pkg.durationWeeks || 8} wks)
                        </span>
                      </div>
                      {pkg.notes && <p className="text-xs text-zinc-400">{pkg.notes}</p>}
                    </div>

                    {pkg.targetType === 'patient' && (
                      <button
                        onClick={() => setAssignPackageModalPkg(pkg)}
                        className="w-full py-2.5 rounded-xl bg-[#00B8C8]/15 hover:bg-[#00B8C8]/25 text-[#00B8C8] border border-[#00B8C8]/30 font-bold text-xs"
                      >
                        Assign to Patient & Collect Payment
                      </button>
                    )}
                  </div>
                );
              })}

              {physioPackages.length === 0 && (
                <div
                  className={`col-span-3 p-10 rounded-2xl border text-center space-y-2 ${
                    isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
                  }`}
                >
                  <Package className="mx-auto text-[#00B8C8]" size={30} />
                  <h3 className="font-bold text-base">No Physiotherapy Packages Created Yet</h3>
                  <p className="text-xs text-zinc-400">
                    Create Patient Rehab Packages (e.g. 10-Session ACL Rehab) or External Therapist Quota Packages.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. 3RD-PARTY PHYSIOTHERAPY B2B CONTRACTS TAB */}
        {activeTab === 'third_party' && (
          <PhysioThirdPartyContractsTab
            contracts={thirdPartyContracts}
            therapists={therapists}
            bookings={bookings}
            isDarkMode={isDarkMode}
            formatCurrency={formatCurrency}
            userUid={user?.uid || 'system'}
            systemName={systemName}
            onSaveContract={async (contractData, existingId) => {
              if (!user) return;
              const id = existingId || `PTP-${Date.now()}`;
              await setDoc(
                doc(db, 'physio_third_party_contracts', id),
                stripUndefined({ ...contractData, id, uid: user.uid }),
                { merge: true }
              );
            }}
            onDeleteContract={async id => {
              if (!window.confirm('Delete this 3rd-Party Physiotherapy Contract?')) return;
              await deleteDoc(doc(db, 'physio_third_party_contracts', id));
              toast.success('3rd-Party Physiotherapy Contract deleted');
            }}
          />
        )}

        {/* 6. FINANCE & LEDGERS TAB */}
        {activeTab === 'finance' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">Finance & Sessions Tracker</h2>
              <div
                className={`flex p-1 rounded-xl border ${
                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-100 border-slate-200'
                }`}
              >
                <button
                  onClick={() => setFinanceActiveSubTab('therapists')}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    financeActiveSubTab === 'therapists'
                      ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Physiotherapists
                </button>
                <button
                  onClick={() => setFinanceActiveSubTab('clients')}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    financeActiveSubTab === 'clients'
                      ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Patients
                </button>
              </div>
            </div>

            {/* Filters */}
            <div
              className={`p-4 rounded-xl border ${
                isDarkMode ? 'bg-zinc-900/30 border-zinc-800' : 'bg-white border-zinc-200'
              } grid grid-cols-1 md:grid-cols-4 gap-4`}
            >
              {financeActiveSubTab === 'therapists' ? (
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                    Physiotherapist
                  </label>
                  <select
                    value={financeFilterTherapistId}
                    onChange={e => setFinanceFilterTherapistId(e.target.value)}
                    className={`w-full p-2.5 rounded-lg border text-sm ${
                      isDarkMode
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light]'
                    }`}
                  >
                    <option value="all">All Therapists</option>
                    {therapists.map(t => (
                      <option key={t.id} value={t.id}>
                        Dr. {t.firstName} {t.lastName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                    Patient
                  </label>
                  <select
                    value={financeFilterClientId}
                    onChange={e => setFinanceFilterClientId(e.target.value)}
                    className={`w-full p-2.5 rounded-lg border text-sm ${
                      isDarkMode
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light]'
                    }`}
                  >
                    <option value="all">All Patients</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                  Session Type
                </label>
                <select
                  value={financeFilterType}
                  onChange={e => setFinanceFilterType(e.target.value)}
                  className={`w-full p-2.5 rounded-lg border text-sm ${
                    isDarkMode
                      ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="all">All Session Types</option>
                  {clinicalSettings.sessionTypes.map(st => (
                    <option key={st.id} value={st.name}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                  From Date
                </label>
                <input
                  type="date"
                  value={financeFilterStartDate}
                  onChange={e => setFinanceFilterStartDate(e.target.value)}
                  className={`w-full p-2.5 rounded-lg border text-sm ${
                    isDarkMode ? 'bg-zinc-800 border-zinc-700 [color-scheme:dark]' : 'bg-white border-zinc-200'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                  To Date
                </label>
                <input
                  type="date"
                  value={financeFilterEndDate}
                  onChange={e => setFinanceFilterEndDate(e.target.value)}
                  className={`w-full p-2.5 rounded-lg border text-sm ${
                    isDarkMode ? 'bg-zinc-800 border-zinc-700 [color-scheme:dark]' : 'bg-white border-zinc-200'
                  }`}
                />
              </div>
            </div>

            <div
              className={`border rounded-2xl overflow-hidden ${
                isDarkMode ? 'bg-zinc-900/30 border-zinc-800' : 'bg-white border-zinc-200'
              }`}
            >
              <table className="w-full text-left text-sm">
                <thead
                  className={`text-xs uppercase tracking-wider font-bold ${
                    isDarkMode
                      ? 'bg-zinc-900/50 text-zinc-400 border-zinc-800'
                      : 'bg-zinc-50 text-zinc-500 border-zinc-200'
                  } border-b`}
                >
                  <tr>
                    <th className="px-6 py-4">Date & Time</th>
                    <th className="px-6 py-4">
                      {financeActiveSubTab === 'therapists' ? 'Patient' : 'Therapist'}
                    </th>
                    <th className="px-6 py-4">Session Type & Room</th>
                    <th className="px-6 py-4">Fee ($)</th>
                    {financeActiveSubTab === 'therapists' && (
                      <th className="px-6 py-4">Therapist Payout ($)</th>
                    )}
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {bookings
                    .filter(b => {
                      if (
                        financeActiveSubTab === 'therapists' &&
                        financeFilterTherapistId !== 'all' &&
                        b.therapistId !== financeFilterTherapistId
                      )
                        return false;
                      if (
                        financeActiveSubTab === 'clients' &&
                        financeFilterClientId !== 'all' &&
                        b.clientId !== financeFilterClientId
                      )
                        return false;
                      if (
                        financeFilterType !== 'all' &&
                        b.sessionType !== financeFilterType &&
                        b.type !== financeFilterType
                      )
                        return false;
                      if (financeFilterStartDate && b.date < financeFilterStartDate) return false;
                      if (financeFilterEndDate && b.date > financeFilterEndDate) return false;
                      return true;
                    })
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map(booking => {
                      const client = clients.find(c => c.id === booking.clientId);
                      const therapist = therapists.find(t => t.id === booking.therapistId);
                      const payout = therapist?.feePerSession || 0;

                      return (
                        <tr
                          key={booking.id}
                          className={`group transition-colors ${
                            isDarkMode ? 'hover:bg-zinc-900/50' : 'hover:bg-zinc-50'
                          }`}
                        >
                          <td className="px-6 py-4">
                            <div className="font-bold font-mono">{booking.date}</div>
                            <div className="text-xs text-zinc-400">
                              {booking.startTime} - {booking.endTime}
                            </div>
                          </td>
                          <td className="px-6 py-4 font-medium">
                            {financeActiveSubTab === 'therapists'
                              ? client
                                ? `${client.firstName} ${client.lastName}`
                                : 'Walk-in'
                              : therapist
                              ? `Dr. ${therapist.firstName} ${therapist.lastName}`
                              : 'Unassigned'}
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium">{booking.sessionType || booking.type}</div>
                            <div className="text-xs text-zinc-400">{booking.roomId}</div>
                          </td>
                          <td className="px-6 py-4 font-bold font-mono text-[#00B8C8]">
                            ${(booking.cost || 0).toFixed(2)}
                          </td>
                          {financeActiveSubTab === 'therapists' && (
                            <td className="px-6 py-4 font-bold font-mono text-teal-400">
                              ${payout.toFixed(2)}
                            </td>
                          )}
                          <td className="px-6 py-4">
                            {financeActiveSubTab === 'clients' ? (
                              <span
                                className={`text-xs font-bold uppercase ${
                                  booking.paymentStatus === 'paid'
                                    ? 'text-emerald-400'
                                    : 'text-amber-400'
                                }`}
                              >
                                {booking.paymentStatus === 'paid' ? 'Paid' : 'Pending'}
                              </span>
                            ) : (
                              <span
                                className={`text-xs font-bold uppercase ${
                                  booking.therapistPaidStatus === 'paid'
                                    ? 'text-teal-400'
                                    : 'text-amber-400'
                                }`}
                              >
                                {booking.therapistPaidStatus === 'paid' ? 'Paid' : 'Pending'}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {financeActiveSubTab === 'clients' ? (
                              booking.paymentStatus !== 'paid' && (
                                <button
                                  onClick={() => {
                                    setPaymentModalBooking(booking);
                                    setPhysioPaymentMethod('cash');
                                    setPhysioCouponInput('');
                                    setPhysioCashbackInput('');
                                  }}
                                  className="bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-semibold px-3 py-1.5 rounded-lg"
                                >
                                  Mark Paid
                                </button>
                              )
                            ) : (
                              booking.therapistPaidStatus !== 'paid' && (
                                <button
                                  onClick={async () => {
                                    if (!user) return;
                                    if (!window.confirm('Mark this session as paid to the therapist?'))
                                      return;
                                    try {
                                      await processLedgerTransaction(
                                        {
                                          amount: payout,
                                          paymentMethod: 'cash',
                                          sourceModule: 'physio',
                                          cashierId: user.uid,
                                          transactionType: 'physio_therapist_payout',
                                          direction: 'outflow',
                                          sourceAccount: '622 - Practitioner & Coach Commissions',
                                          destinationAccount: '531 - Cash Drawer / Register (Caisse)',
                                          referenceId: booking.id,
                                          notes: `Payout to therapist for session: ${booking.id}`
                                        },
                                        async transaction => {
                                          transaction.update(doc(db, 'physioBookings', booking.id), {
                                            therapistPaidStatus: 'paid'
                                          });
                                        }
                                      );
                                      toast.success('Payout recorded in ledger');
                                    } catch {
                                      toast.error('Failed to record payout');
                                    }
                                  }}
                                  className="bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-semibold px-3 py-1.5 rounded-lg"
                                >
                                  Pay Session
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Clinical Settings Modal */}
      <PhysioClinicalSettingsModal
        isOpen={isClinicalSettingsModalOpen}
        onClose={() => setIsClinicalSettingsModalOpen(false)}
        isDarkMode={isDarkMode}
        rooms={rooms}
        settings={clinicalSettings}
        onSaveRoom={handleSaveRoom}
        onDeleteRoom={handleDeleteRoom}
        onSaveSettings={handleSaveClinicalSettings}
        formatCurrency={formatCurrency}
      />

      {/* Physiotherapist 360 Modal */}
      <PhysioTherapist360Modal
        isOpen={!!selectedTherapistFor360}
        onClose={() => setSelectedTherapistFor360(null)}
        therapist={
          selectedTherapistFor360
            ? therapists.find(t => t.id === selectedTherapistFor360.id) || selectedTherapistFor360
            : null
        }
        bookings={bookings}
        clients={clients}
        packages={physioPackages}
        thirdPartyContracts={thirdPartyContracts}
        isDarkMode={isDarkMode}
        formatCurrency={formatCurrency}
        userUid={user?.uid || 'system'}
        systemName={systemName}
        onAssignQuotaPackage={handleAssignTherapistQuotaPackage}
      />

      {/* Create / Edit Physio Package Modal */}
      {isPackageModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-lg rounded-2xl p-6 border ${
              isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200'
            }`}
          >
            <h2 className="text-xl font-bold mb-4">
              {editingPackage ? 'Edit Physiotherapy Package' : 'Create Physiotherapy Package'}
            </h2>
            <form onSubmit={handleSavePhysioPackage} className="space-y-4">
              <div className="flex p-1 rounded-xl border bg-zinc-900 border-zinc-800">
                <button
                  type="button"
                  onClick={() => setNewPackageForm({ ...newPackageForm, targetType: 'patient' })}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase ${
                    newPackageForm.targetType !== 'therapist'
                      ? 'bg-[#00B8C8] text-[#05070A]'
                      : 'text-zinc-400'
                  }`}
                >
                  Patient Rehab Package
                </button>
                <button
                  type="button"
                  onClick={() => setNewPackageForm({ ...newPackageForm, targetType: 'therapist' })}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase ${
                    newPackageForm.targetType === 'therapist'
                      ? 'bg-[#00B8C8] text-[#05070A]'
                      : 'text-zinc-400'
                  }`}
                >
                  External Physio Quota Pack
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                  Package Name
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. 10-Session ACL Rehab Package"
                  value={newPackageForm.name || ''}
                  onChange={e => setNewPackageForm({ ...newPackageForm, name: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-slate-50 border-slate-200'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                    Session Type
                  </label>
                  <select
                    value={newPackageForm.sessionType || ''}
                    onChange={e =>
                      setNewPackageForm({ ...newPackageForm, sessionType: e.target.value })
                    }
                    className={`w-full p-2.5 rounded-xl border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  >
                    {clinicalSettings.sessionTypes.map(st => (
                      <option key={st.id} value={st.name}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                    Number of Sessions
                  </label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={newPackageForm.sessions || 10}
                    onChange={e =>
                      setNewPackageForm({
                        ...newPackageForm,
                        sessions: parseInt(e.target.value) || 1
                      })
                    }
                    className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                    Base Fee ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newPackageForm.price || 0}
                    onChange={e =>
                      setNewPackageForm({
                        ...newPackageForm,
                        price: parseFloat(e.target.value) || 0
                      })
                    }
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                    Discount (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={newPackageForm.discountPercent || 0}
                    onChange={e =>
                      setNewPackageForm({
                        ...newPackageForm,
                        discountPercent: parseFloat(e.target.value) || 0
                      })
                    }
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                    Discount ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newPackageForm.discountAmount || 0}
                    onChange={e =>
                      setNewPackageForm({
                        ...newPackageForm,
                        discountAmount: parseFloat(e.target.value) || 0
                      })
                    }
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                    Override ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Auto"
                    value={newPackageForm.priceOverride ?? ''}
                    onChange={e =>
                      setNewPackageForm({
                        ...newPackageForm,
                        priceOverride:
                          e.target.value !== '' ? parseFloat(e.target.value) : undefined
                      })
                    }
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPackageModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs"
                >
                  {editingPackage ? 'Save Package' : 'Create Package'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Patient Package Modal */}
      {assignPackageModalPkg && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl p-6 border ${
              isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200'
            }`}
          >
            <h3 className="text-lg font-bold mb-4">
              Assign {assignPackageModalPkg.name} ({assignPackageModalPkg.sessions} Sessions)
            </h3>
            <form onSubmit={handleAssignPatientPackage} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                  Select Patient (Central Member)
                </label>
                <select
                  required
                  value={assignPackageClientId}
                  onChange={e => setAssignPackageClientId(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    isDarkMode
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="">Choose patient...</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                  Payment Method ({formatCurrency(getEffectivePhysioPackagePrice(assignPackageModalPkg))})
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['cash', 'card', 'member_balance'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAssignPackagePaymentMethod(m)}
                      className={`py-2 rounded-xl text-xs font-bold uppercase border ${
                        assignPackagePaymentMethod === m
                          ? 'bg-[#00B8C8] border-[#00B8C8] text-[#05070A]'
                          : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                      }`}
                    >
                      {m === 'member_balance' ? 'Wallet' : m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignPackageModalPkg(null)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs"
                >
                  Confirm & Post to Ledger
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Patient Case Profile Modal (Reception Form + Short Shareable Self-Intake Link) */}
      {isClientModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-2xl rounded-3xl p-6 max-h-[90vh] overflow-y-auto border ${
              isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <h2 className="text-xl font-black">
                {editingItem ? 'Edit Patient Clinical Registration' : 'Patient Registration & Intake'}
              </h2>
              {!editingItem && (
                <div className="flex p-1 rounded-xl bg-zinc-900 border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setPatientModalMode('form')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase transition-all ${
                      patientModalMode === 'form'
                        ? 'bg-[#00B8C8] text-[#05070A]'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Fill Form Now
                  </button>
                  <button
                    type="button"
                    onClick={() => setPatientModalMode('short_link')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase transition-all ${
                      patientModalMode === 'short_link'
                        ? 'bg-[#00B8C8] text-[#05070A]'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Short Self-Fill Link
                  </button>
                </div>
              )}
            </div>

            {patientModalMode === 'short_link' && !editingItem ? (
              <div className="space-y-5 py-2">
                <div className={`p-5 rounded-2xl border space-y-3 ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="text-xs font-black uppercase tracking-wider text-[#00B8C8]">
                    Shareable Patient Self-Registration Short URL
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Send this clean short link to your patient via WhatsApp or SMS. When the patient submits the form on their phone, their complete clinical profile automatically syncs to Physiotherapy & Central Members.
                  </p>
                  <div className={`flex items-center gap-2 p-3 rounded-xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'}`}>
                    <span className="font-mono text-xs text-[#00B8C8] flex-1 truncate">
                      {`${window.location.origin}/p/physio`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/p/physio`);
                        toast.success('Short link copied to clipboard!');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#00B8C8] text-[#05070A] font-bold text-xs flex items-center gap-1.5"
                    >
                      <Copy size={13} /> Copy Link
                    </button>
                  </div>
                </div>

                <div className={`p-5 rounded-2xl border space-y-3 ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <label className="block text-xs font-bold uppercase text-zinc-400">
                    Send Directly via WhatsApp (Optional Patient Phone)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      placeholder="+961 70 000 000"
                      value={shareWhatsappPhone}
                      onChange={e => setShareWhatsappPhone(e.target.value)}
                      className={`flex-1 p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                    <a
                      href={`https://wa.me/${shareWhatsappPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                        `Hello from ${systemName || 'Vescio Nexus'} Physiotherapy Clinic! Please complete your quick patient registration form prior to your session: ${window.location.origin}/p/physio`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                    >
                      <Share2 size={14} /> Send via WhatsApp
                    </a>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIsClientModalOpen(false)}
                    className="px-6 py-2.5 rounded-xl bg-zinc-800 text-zinc-200 font-bold text-xs"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddClient} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      First Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="First name"
                      value={newClient.firstName || ''}
                      onChange={e => setNewClient({ ...newClient, firstName: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Last Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="Last name"
                      value={newClient.lastName || ''}
                      onChange={e => setNewClient({ ...newClient, lastName: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Phone Number <span className="text-rose-400">*</span>
                    </label>
                    <input
                      required
                      type="tel"
                      placeholder="+961 ..."
                      value={newClient.phone || ''}
                      onChange={e => setNewClient({ ...newClient, phone: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Email Address (Optional)
                    </label>
                    <input
                      type="email"
                      placeholder="patient@example.com"
                      value={newClient.email || ''}
                      onChange={e => setNewClient({ ...newClient, email: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Residential Address (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="City, Street, Building..."
                      value={newClient.address || ''}
                      onChange={e => setNewClient({ ...newClient, address: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Date of Birth <span className="text-rose-400">*</span>
                    </label>
                    <input
                      required
                      type="date"
                      value={newClient.dob || ''}
                      onChange={e => setNewClient({ ...newClient, dob: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Marital Status (Optional)
                    </label>
                    <select
                      value={newClient.maritalStatus || ''}
                      onChange={e => setNewClient({ ...newClient, maritalStatus: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      <option value="">Select Status...</option>
                      <option value="Single">Single</option>
                      <option value="Married">Married</option>
                      <option value="Divorced">Divorced</option>
                      <option value="Widowed">Widowed</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Occupation (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Engineer, Athlete"
                      value={newClient.occupation || ''}
                      onChange={e => setNewClient({ ...newClient, occupation: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                </div>

                {/* Physiotherapist Autocomplete + Referring Physician */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Assigned Physiotherapist (Autocomplete) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="Type physiotherapist name..."
                      value={clientTherapistSearch}
                      onFocus={() => setIsClientTherapistDropdownOpen(true)}
                      onChange={e => {
                        setClientTherapistSearch(e.target.value);
                        setNewClient({
                          ...newClient,
                          assignedPhysiotherapistName: e.target.value,
                          assignedPhysiotherapistId: ''
                        });
                        setIsClientTherapistDropdownOpen(true);
                      }}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                    {isClientTherapistDropdownOpen && (
                      <div className={`absolute z-40 left-0 right-0 mt-1 rounded-xl border shadow-2xl max-h-44 overflow-y-auto divide-y ${
                        isDarkMode ? 'bg-zinc-900 border-zinc-700 divide-zinc-800' : 'bg-white border-slate-200 divide-slate-100'
                      }`}>
                        {therapists
                          .filter(t => {
                            const q = clientTherapistSearch.trim().toLowerCase();
                            if (!q) return true;
                            return `dr. ${t.firstName} ${t.lastName} ${t.specialization || ''}`
                              .toLowerCase()
                              .includes(q);
                          })
                          .map(t => {
                            const label = `Dr. ${t.firstName} ${t.lastName}`;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  setClientTherapistSearch(label);
                                  setNewClient({
                                    ...newClient,
                                    assignedPhysiotherapistId: t.id,
                                    assignedPhysiotherapistName: label,
                                    physioAssignedTherapistId: t.id
                                  });
                                  setIsClientTherapistDropdownOpen(false);
                                }}
                                className={`w-full px-3 py-2 text-left text-xs hover:bg-[#00B8C8]/15 flex items-center justify-between ${
                                  isDarkMode ? 'text-zinc-100' : 'text-slate-900'
                                }`}
                              >
                                <span className="font-bold">{label}</span>
                                <span className="text-[10px] text-[#00B8C8]">{t.specialization || 'Physiotherapist'}</span>
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Referring Physician (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Dr. Name (if referred)"
                      value={newClient.referringPhysician || ''}
                      onChange={e => setNewClient({ ...newClient, referringPhysician: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                </div>

                {/* Visit Type, Number of Sessions, Blood Type */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Visit Type <span className="text-rose-400">*</span>
                    </label>
                    <select
                      required
                      value={newClient.visitType || 'Initial Session'}
                      onChange={e => setNewClient({ ...newClient, visitType: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      <option value="Initial Session">Initial Session</option>
                      <option value="Assessment">Assessment</option>
                      <option value="Follow up">Follow up</option>
                      <option value="Rehab Session">Rehab Session</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Number of Sessions <span className="text-rose-400">*</span>
                    </label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={newClient.numberOfSessions ?? newClient.physioEstimatedSessions ?? 10}
                      onChange={e => {
                        const val = Math.max(1, parseInt(e.target.value) || 1);
                        setNewClient({
                          ...newClient,
                          numberOfSessions: val,
                          physioEstimatedSessions: val
                        });
                      }}
                      className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Blood Type <span className="text-rose-400">*</span>
                    </label>
                    <select
                      required
                      value={newClient.bloodType || 'O+'}
                      onChange={e => setNewClient({ ...newClient, bloodType: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'].map(bt => (
                        <option key={bt} value={bt}>{bt}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Emergency Contact (All 3 Optional) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Emergency Contact Name (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Contact Full Name"
                      value={newClient.emergencyContactName || ''}
                      onChange={e => setNewClient({ ...newClient, emergencyContactName: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Emergency Contact Phone (Optional)
                    </label>
                    <input
                      type="tel"
                      placeholder="+961 ..."
                      value={newClient.emergencyContactPhone || ''}
                      onChange={e => setNewClient({ ...newClient, emergencyContactPhone: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Relationship (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Spouse, Parent"
                      value={newClient.emergencyContactRelationship || ''}
                      onChange={e => setNewClient({ ...newClient, emergencyContactRelationship: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                </div>

                {/* Insured Toggle & Insurance Company */}
                <div className={`p-3.5 rounded-2xl border space-y-2.5 ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
                      Medical Insurance Coverage (Optional)
                    </span>
                    <button
                      type="button"
                      onClick={() => setNewClient({ ...newClient, isInsured: !newClient.isInsured })}
                      className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase border transition-all ${
                        newClient.isInsured
                          ? 'bg-[#00B8C8] text-[#05070A] border-[#00B8C8]'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                      }`}
                    >
                      {newClient.isInsured ? 'Insured: YES' : 'Insured: NO'}
                    </button>
                  </div>
                  {newClient.isInsured && (
                    <input
                      type="text"
                      placeholder="Insurance Company Name (e.g. Bankers, MedGulf, Allianz SNA...)"
                      value={newClient.insuranceCompanyName || ''}
                      onChange={e => setNewClient({ ...newClient, insuranceCompanyName: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  )}
                </div>

                {/* Diagnosis, Body Area, Case Status */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Injury / Diagnosis
                    </label>
                    <select
                      value={newClient.physioDiagnosis || ''}
                      onChange={e => setNewClient({ ...newClient, physioDiagnosis: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      <option value="">Select Diagnosis...</option>
                      {clinicalSettings.injuryCategories.map(cat => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Body Area
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Right Knee, Lumbar Spine"
                      value={newClient.physioBodyArea || ''}
                      onChange={e => setNewClient({ ...newClient, physioBodyArea: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                      Case Status
                    </label>
                    <select
                      value={newClient.physioCaseStatus || 'Active Treatment'}
                      onChange={e => setNewClient({ ...newClient, physioCaseStatus: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      {clinicalSettings.customStatuses.map(st => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Scan / Image Upload */}
                <div className={`p-3.5 rounded-2xl border border-dashed flex items-center justify-between gap-3 ${
                  isDarkMode ? 'border-zinc-700 bg-[#05070A]' : 'border-slate-300 bg-slate-50'
                }`}>
                  <div className="text-xs">
                    <div className={`font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>Scan / X-Ray / MRI Upload (Optional)</div>
                    <div className="text-[11px] text-zinc-500">
                      {newClient.scanImageName ? `Attached: ${newClient.scanImageName}` : 'Attach diagnostic image or PDF'}
                    </div>
                  </div>
                  <label className="cursor-pointer px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-bold text-[#00B8C8] flex items-center gap-1.5">
                    <Upload size={14} /> Upload Scan
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setNewClient(prev => ({
                            ...prev,
                            scanImageUrl: reader.result as string,
                            scanImageName: file.name
                          }));
                        };
                        reader.readAsDataURL(file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                    Clinical SOAP Notes & Medical History (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={newClient.physioSoapNotes || newClient.medicalHistory || ''}
                    onChange={e =>
                      setNewClient({
                        ...newClient,
                        physioSoapNotes: e.target.value,
                        medicalHistory: e.target.value
                      })
                    }
                    className={`w-full p-2.5 rounded-xl border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsClientModalOpen(false);
                      setEditingItem(null);
                      setNewClient({});
                      setClientTherapistSearch('');
                    }}
                    className="flex-1 py-2.5 rounded-xl font-bold bg-zinc-800 text-zinc-200 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl font-bold bg-[#00B8C8] text-[#05070A] text-xs"
                  >
                    {editingItem ? 'Update Patient Case' : 'Save Patient Case'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Schedule Appointment Modal (With Room & Therapist Collision Detection + Clinical Fields) */}
      {isBookingModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`w-full max-w-4xl rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col md:flex-row gap-6 max-h-[90vh] overflow-y-auto ${
              isDarkMode ? 'bg-[#101622] border border-zinc-800 text-zinc-100' : 'bg-white'
            }`}
          >
            {/* Left Column: Patient Selection & Active Packages */}
            <div className="flex-1 space-y-4">
              <h2 className="text-lg font-bold">Patient & Clinical Case</h2>

              {!selectedBookingMember && !isQuickAddMember ? (
                <div className="space-y-3">
                  <div
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${
                      isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <Search size={16} className="text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search central member by name or phone..."
                      value={memberSearchQuery}
                      onChange={e => setMemberSearchQuery(e.target.value)}
                      className="bg-transparent border-none focus:ring-0 w-full text-xs outline-none"
                    />
                  </div>

                  <div className="space-y-2 pr-1">
                    {clients
                      .filter(
                        m =>
                          m.id !== 'walk_in' &&
                          m.id !== 'free_lance' &&
                          m.id !== 'free_lance_member' &&
                          (`${m.firstName} ${m.lastName}`
                            .toLowerCase()
                            .includes(memberSearchQuery.toLowerCase()) ||
                            m.phone?.includes(memberSearchQuery))
                      )
                      .slice(0, 10)
                      .map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedBookingMember(m);
                            setNewBooking(prev => ({
                              ...prev,
                              injury: m.physioDiagnosis || prev.injury || '',
                              bodyArea: m.physioBodyArea || prev.bodyArea || '',
                              estimatedSessions: m.physioEstimatedSessions || prev.estimatedSessions || 10,
                              therapistId: m.physioAssignedTherapistId || prev.therapistId || ''
                            }));
                          }}
                          className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                            isDarkMode
                              ? 'bg-[#0B0F17] border-zinc-800 hover:border-[#00B8C8]/50'
                              : 'bg-white border-slate-200 hover:border-[#00B8C8]/50'
                          }`}
                        >
                          <div>
                            <p className="font-bold text-xs">
                              {m.firstName} {m.lastName}
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              {m.phone || 'No phone'}
                              {m.physioDiagnosis ? ` · ${m.physioDiagnosis}` : ''}
                            </p>
                          </div>
                          <ChevronRight size={14} className="text-zinc-500" />
                        </button>
                      ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsQuickAddMember(true)}
                    className={`w-full py-3 rounded-xl border border-dashed flex items-center justify-center gap-2 text-xs font-bold ${
                      isDarkMode
                        ? 'border-zinc-700 text-zinc-400 hover:border-[#00B8C8] hover:text-[#00B8C8]'
                        : 'border-slate-300 text-slate-600'
                    }`}
                  >
                    <UserPlus size={16} /> + Walk-in / New Guest Patient
                  </button>
                </div>
              ) : selectedBookingMember ? (
                <div
                  className={`p-4 rounded-2xl border relative space-y-3 ${
                    isDarkMode
                      ? 'bg-[#00B8C8]/5 border-[#00B8C8]/30'
                      : 'bg-[#00B8C8]/10 border-[#00B8C8]/30'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedBookingMember(null)}
                    className="absolute top-3 right-3 text-zinc-400 hover:text-rose-500"
                  >
                    <XCircle size={18} />
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#00B8C8] text-[#05070A] flex items-center justify-center font-black text-sm">
                      {selectedBookingMember.firstName[0]}
                      {selectedBookingMember.lastName[0]}
                    </div>
                    <div>
                      <h3 className="text-sm font-black">
                        {selectedBookingMember.firstName} {selectedBookingMember.lastName}
                      </h3>
                      <p className="text-xs text-[#00B8C8] font-mono">
                        {selectedBookingMember.phone} · Completed:{' '}
                        {selectedBookingMember.physioCompletedSessions || 0}/
                        {selectedBookingMember.physioEstimatedSessions || 10}
                      </p>
                    </div>
                  </div>

                  {(selectedBookingMember.physioActivePackages || []).filter(
                    p => p.status === 'active'
                  ).length > 0 && (
                    <div className="pt-2 border-t border-[#00B8C8]/20">
                      <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                        Deduct From Active Physio Package (On Check-In)
                      </label>
                      <select
                        value={newBooking.patientPackageSubId || ''}
                        onChange={e =>
                          setNewBooking({ ...newBooking, patientPackageSubId: e.target.value })
                        }
                        className={`w-full p-2 rounded-lg border text-xs ${
                          isDarkMode
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                            : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                        }`}
                      >
                        <option value="">Auto-deduct active package</option>
                        {(selectedBookingMember.physioActivePackages || [])
                          .filter(p => p.status === 'active')
                          .map(sub => (
                            <option key={sub.id} value={sub.id}>
                              {sub.packageName} ({sub.usedSessions}/{sub.totalSessions} used)
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 space-y-3 relative">
                  <button
                    type="button"
                    onClick={() => setIsQuickAddMember(false)}
                    className="absolute top-3 right-3 text-zinc-400 hover:text-rose-500"
                  >
                    <XCircle size={18} />
                  </button>
                  <h3 className="text-sm font-bold">Quick Walk-In Patient</h3>
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={guestName}
                    onChange={e => setGuestName(e.target.value)}
                    className={`w-full p-2.5 rounded-lg border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={guestPhone}
                    onChange={e => setGuestPhone(e.target.value)}
                    className={`w-full p-2.5 rounded-lg border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
              )}

              {/* Clinical Case Fields */}
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                      Injury / Diagnosis
                    </label>
                    <select
                      value={newBooking.injury || ''}
                      onChange={e => setNewBooking({ ...newBooking, injury: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      <option value="">Select Diagnosis...</option>
                      {clinicalSettings.injuryCategories.map(cat => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                      Body Area
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Right Knee, Shoulder"
                      value={newBooking.bodyArea || ''}
                      onChange={e => setNewBooking({ ...newBooking, bodyArea: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                      }`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                      Case Status
                    </label>
                    <select
                      value={newBooking.caseStatus || 'Active Treatment'}
                      onChange={e => setNewBooking({ ...newBooking, caseStatus: e.target.value })}
                      className={`w-full p-2 rounded-xl border text-xs ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      {clinicalSettings.customStatuses.map(st => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                      Est. Total Sessions
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={newBooking.estimatedSessions || 10}
                      onChange={e =>
                        setNewBooking({
                          ...newBooking,
                          estimatedSessions: parseInt(e.target.value) || 1
                        })
                      }
                      className={`w-full p-2 rounded-xl border text-xs font-mono ${
                        isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                      }`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                    Clinical / SOAP Notes
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Subjective / Objective / Assessment / Plan notes..."
                    value={newBooking.soapNotes || ''}
                    onChange={e => setNewBooking({ ...newBooking, soapNotes: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${
                      isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Room, Therapist, Time & Billing */}
            <div className="flex-1 space-y-4 md:border-l md:pl-6 border-zinc-800">
              <h2 className="text-lg font-bold">Room, Schedule & Billing</h2>
              <form onSubmit={handleAddBooking} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Treatment Room
                    </label>
                    <select
                      required
                      value={newBooking.roomId || ''}
                      onChange={e => setNewBooking({ ...newBooking, roomId: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs font-bold ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      {activeRooms.map(r => (
                        <option key={r.id} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Session Type
                    </label>
                    <select
                      required
                      value={newBooking.sessionType || ''}
                      onChange={e => {
                        const chosen = clinicalSettings.sessionTypes.find(
                          st => st.name === e.target.value
                        );
                        const nextEnd = chosen
                          ? addMinutesToTime(
                              newBooking.startTime || '10:00',
                              chosen.defaultDurationMinutes
                            )
                          : newBooking.endTime;
                        setNewBooking({
                          ...newBooking,
                          sessionType: e.target.value,
                          type: e.target.value,
                          endTime: nextEnd,
                          cost: chosen ? chosen.defaultPrice : newBooking.cost
                        });
                      }}
                      className={`w-full p-2.5 rounded-xl border text-xs font-bold ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      {clinicalSettings.sessionTypes.map(st => (
                        <option key={st.id} value={st.name}>
                          {st.name} ({st.defaultDurationMinutes}m · ${st.defaultPrice})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Assigned Physiotherapist
                    </label>
                    <select
                      value={newBooking.therapistId || ''}
                      onChange={e => setNewBooking({ ...newBooking, therapistId: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs font-bold ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      <option value="">Select Physiotherapist...</option>
                      {therapists.map(t => (
                        <option key={t.id} value={t.id}>
                          Dr. {t.firstName} {t.lastName} ({t.specialization})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Patient Lead Source (B2B)
                    </label>
                    <select
                      value={newBooking.leadSource || 'facility_client'}
                      onChange={e =>
                        setNewBooking({ ...newBooking, leadSource: e.target.value as any })
                      }
                      className={`w-full p-2.5 rounded-xl border text-xs font-bold ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      <option value="facility_client">Facility-Sourced Patient</option>
                      <option value="partner_client">Partner-Sourced Patient</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Date
                    </label>
                    <input
                      required
                      type="date"
                      value={newBooking.date || ''}
                      onChange={e => setNewBooking({ ...newBooking, date: e.target.value })}
                      className={`w-full p-2 rounded-xl border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Start Time
                    </label>
                    <input
                      required
                      type="time"
                      value={newBooking.startTime || ''}
                      onChange={e => setNewBooking({ ...newBooking, startTime: e.target.value })}
                      className={`w-full p-2 rounded-xl border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      End Time
                    </label>
                    <input
                      required
                      type="time"
                      value={newBooking.endTime || ''}
                      onChange={e => setNewBooking({ ...newBooking, endTime: e.target.value })}
                      className={`w-full p-2 rounded-xl border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    />
                  </div>
                </div>

                {/* Recurring Multi-Session Plan Option */}
                {!editingItem && (
                  <div className={`p-3 rounded-xl border grid grid-cols-2 gap-3 ${
                    isDarkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-[#00B8C8] mb-1 flex items-center gap-1">
                        <Repeat size={11} /> Repeat Sessions Count
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={recurringCount}
                        onChange={e => setRecurringCount(parseInt(e.target.value) || 1)}
                        className={`w-full p-2 rounded-lg border text-xs font-mono ${
                          isDarkMode
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                            : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                        Interval (Every N Days)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="14"
                        value={recurringIntervalDays}
                        onChange={e => setRecurringIntervalDays(parseInt(e.target.value) || 2)}
                        className={`w-full p-2 rounded-lg border text-xs font-mono ${
                          isDarkMode
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                            : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                        }`}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Session Price / Override ($)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newBooking.cost || 0}
                      onChange={e =>
                        setNewBooking({ ...newBooking, cost: parseFloat(e.target.value) || 0 })
                      }
                      className={`w-full p-2.5 rounded-xl border font-mono font-bold text-xs ${
                        isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Payment Status
                    </label>
                    <select
                      value={newBooking.paymentStatus || 'pending'}
                      onChange={e =>
                        setNewBooking({
                          ...newBooking,
                          paymentStatus: e.target.value as 'pending' | 'paid'
                        })
                      }
                      className={`w-full p-2.5 rounded-xl border font-bold text-xs ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    >
                      <option value="pending">Pending</option>
                      <option value="paid">Paid Immediately</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsBookingModalOpen(false);
                      setEditingItem(null);
                      setSelectedBookingMember(null);
                    }}
                    className="flex-1 py-3 rounded-xl font-bold text-xs bg-zinc-800 text-zinc-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 rounded-xl font-bold text-xs bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A]"
                  >
                    {editingItem ? 'Save Changes' : 'Schedule Session(s)'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}

      {/* Payment Confirmation Modal */}
      {paymentModalBooking &&
        (() => {
          const client = clients.find(c => c.id === paymentModalBooking.clientId);
          const baseCost = Number(paymentModalBooking.cost) || 0;
          const appliedCoupon = getAppliedPhysioCoupon(physioCouponInput);
          const couponDisc = appliedCoupon
            ? appliedCoupon.discountType === 'percentage'
              ? baseCost * ((appliedCoupon.discountValue || 0) / 100)
              : appliedCoupon.discountValue || 0
            : 0;
          const netTotal = Math.max(0, baseCost - couponDisc);

          return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div
                className={`w-full max-w-md rounded-2xl p-6 space-y-5 border shadow-2xl ${
                  isDarkMode ? 'bg-[#101622] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-black">Confirm Physio Payment</h2>
                  <button
                    onClick={() => setPaymentModalBooking(null)}
                    className="text-zinc-400 hover:text-rose-500"
                  >
                    <XCircle size={20} />
                  </button>
                </div>

                <div
                  className={`p-4 rounded-xl border space-y-2 ${
                    isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400 font-bold uppercase text-xs">Patient</span>
                    <span className="font-bold">
                      {client ? `${client.firstName} ${client.lastName}` : 'Patient'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400 font-bold uppercase text-xs">Session</span>
                    <span className="font-bold">
                      {paymentModalBooking.sessionType || paymentModalBooking.type} (
                      {paymentModalBooking.date})
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400 font-bold uppercase text-xs">Session Price</span>
                    <span className="font-bold font-mono">{formatCurrency(baseCost)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(['cash', 'card', 'member_balance'] as const).map(method => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPhysioPaymentMethod(method)}
                      className={`py-2.5 rounded-xl text-xs font-bold uppercase border transition-all ${
                        physioPaymentMethod === method
                          ? 'bg-[#00B8C8] border-[#00B8C8] text-slate-950'
                          : isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-400'
                          : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                    >
                      {method === 'member_balance' ? 'Wallet' : method}
                    </button>
                  ))}
                </div>

                <div className="flex justify-between items-center p-4 rounded-xl bg-[#00B8C8]/10 border border-[#00B8C8]/25">
                  <span className="text-xs font-black uppercase text-[#00B8C8]">Total to Pay</span>
                  <span className="text-2xl font-black font-mono text-[#00B8C8]">
                    {formatCurrency(netTotal)}
                  </span>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentModalBooking(null)}
                    className="flex-1 py-3 rounded-xl font-bold bg-zinc-800 text-zinc-300 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await executePhysioCustomerPayment(
                          paymentModalBooking,
                          physioPaymentMethod,
                          physioCouponInput,
                          physioCashbackInput
                        );
                        toast.success('Payment confirmed & posted to accounting ledger');
                        setPaymentModalBooking(null);
                      } catch (err: any) {
                        toast.error(err.message || 'Failed to process payment');
                      }
                    }}
                    className="flex-1 py-3 rounded-xl font-bold bg-[#00B8C8] text-[#05070A] text-xs"
                  >
                    Confirm & Pay
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Program Modal */}
      {isProgramModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl p-6 ${
              isDarkMode ? 'bg-[#101622] border border-zinc-800 text-zinc-100' : 'bg-white text-slate-900'
            }`}
          >
            <h2 className="text-xl font-bold mb-4">Treatment Program</h2>
            <form onSubmit={handleAddProgram} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                  Program Name
                </label>
                <input
                  required
                  type="text"
                  value={newProgram.name || ''}
                  onChange={e => setNewProgram({ ...newProgram, name: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    isDarkMode
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                  Total Sessions
                </label>
                <input
                  required
                  type="number"
                  min="1"
                  value={newProgram.totalSessions || ''}
                  onChange={e =>
                    setNewProgram({ ...newProgram, totalSessions: parseInt(e.target.value) })
                  }
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    isDarkMode
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  type="date"
                  value={newProgram.startDate || ''}
                  onChange={e => setNewProgram({ ...newProgram, startDate: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    isDarkMode
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
                <input
                  required
                  type="date"
                  value={newProgram.endDate || ''}
                  onChange={e => setNewProgram({ ...newProgram, endDate: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    isDarkMode
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsProgramModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#00B8C8] text-[#05070A] text-xs font-bold"
                >
                  Save Program
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Prescription Modal */}
      {isPrescriptionModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl p-6 ${
              isDarkMode ? 'bg-[#101622] border border-zinc-800 text-zinc-100' : 'bg-white text-slate-900'
            }`}
          >
            <h2 className="text-xl font-bold mb-4">Exercise Prescription</h2>
            <form onSubmit={handleAddPrescription} className="space-y-4">
              <input
                required
                type="date"
                value={newPrescription.date || ''}
                onChange={e => setNewPrescription({ ...newPrescription, date: e.target.value })}
                className={`w-full p-2.5 rounded-xl border text-xs ${
                  isDarkMode
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                    : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                }`}
              />
              <textarea
                required
                rows={3}
                placeholder="Clinical details..."
                value={newPrescription.details || ''}
                onChange={e => setNewPrescription({ ...newPrescription, details: e.target.value })}
                className={`w-full p-2.5 rounded-xl border text-xs ${
                  isDarkMode
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                    : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                }`}
              />
              <textarea
                rows={2}
                placeholder="Exercises (comma-separated)"
                value={newPrescription.exercises?.join(', ') || ''}
                onChange={e =>
                  setNewPrescription({
                    ...newPrescription,
                    exercises: e.target.value
                      .split(',')
                      .map(s => s.trim())
                      .filter(Boolean)
                  })
                }
                className={`w-full p-2.5 rounded-xl border text-xs ${
                  isDarkMode
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                    : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                }`}
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsPrescriptionModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#00B8C8] text-[#05070A] text-xs font-bold"
                >
                  Save Prescription
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Physiotherapist Modal */}
      {isTherapistModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl p-6 ${
              isDarkMode ? 'bg-[#101622] border border-zinc-800 text-zinc-100' : 'bg-white text-slate-900'
            }`}
          >
            <h2 className="text-xl font-bold mb-4">
              {editingItem ? 'Edit Physiotherapist' : 'Add Physiotherapist'}
            </h2>
            <form onSubmit={handleAddTherapist} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                    First Name
                  </label>
                  <input
                    required
                    type="text"
                    value={newTherapist.firstName || ''}
                    onChange={e => setNewTherapist({ ...newTherapist, firstName: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                    Last Name
                  </label>
                  <input
                    required
                    type="text"
                    value={newTherapist.lastName || ''}
                    onChange={e => setNewTherapist({ ...newTherapist, lastName: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                  Specialization
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Orthopedic & Sports Rehab"
                  value={newTherapist.specialization || ''}
                  onChange={e =>
                    setNewTherapist({ ...newTherapist, specialization: e.target.value })
                  }
                  className={`w-full p-2.5 rounded-xl border text-xs ${
                    isDarkMode
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={newTherapist.phone || ''}
                    onChange={e => setNewTherapist({ ...newTherapist, phone: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={newTherapist.email || ''}
                    onChange={e => setNewTherapist({ ...newTherapist, email: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                    Fee Per Session ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={newTherapist.feePerSession || 0}
                    onChange={e =>
                      setNewTherapist({
                        ...newTherapist,
                        feePerSession: parseFloat(e.target.value) || 0
                      })
                    }
                    className={`w-full p-2.5 rounded-xl border text-xs font-mono ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">
                    Commission (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={newTherapist.commissionPercent || 0}
                    onChange={e =>
                      setNewTherapist({
                        ...newTherapist,
                        commissionPercent: parseFloat(e.target.value) || 0
                      })
                    }
                    className="w-full p-2.5 rounded-xl border bg-zinc-900 border-zinc-700 text-xs font-mono"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsTherapistModalOpen(false);
                    setEditingItem(null);
                    setNewTherapist({});
                  }}
                  className="flex-1 py-2.5 rounded-xl font-bold bg-zinc-800 text-zinc-300 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl font-bold bg-[#00B8C8] text-[#05070A] text-xs"
                >
                  {editingItem ? 'Update Therapist' : 'Save Therapist'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
