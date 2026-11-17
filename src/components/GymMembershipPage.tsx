import React, { useState, useEffect, useRef } from 'react';
import { Plus, Users, Package, CreditCard, Search, Filter, MoreVertical, Trash2, Edit2, CheckCircle2, XCircle, Clock, Home, Download, QrCode, Calendar, Scan, UserMinus, AlertTriangle, Eye, ShieldCheck, Moon, Sun, FileText, LogIn, LogOut, Tag, ArrowLeft, DollarSign, User, Snowflake, Play, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Modal } from './Modal';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, differenceInDays, isBefore, addDays } from 'date-fns';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { DynamicQRImage } from './gym/DynamicQRImage';
import { collection, onSnapshot, query, addDoc, updateDoc, deleteDoc, doc, getDocs, setDoc, where, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { processLedgerTransaction, processReversalTransaction, stripUndefined } from '../lib/transaction-engine';
import { normalizePhone } from '../lib/firestore-utils';
import { useFirebase } from '../contexts/FirebaseContext';
import { useTheme } from '../contexts/ThemeContext';
import { NotificationCenter } from './NotificationCenter';
import { 
  GymPackage, Member, CoachPackage, CoachContract, Coach, Coupon,
  OperationType, FirestoreErrorInfo, COUNTRIES, CheckIn,
  GroupParticipant, CoachSessionLedgerEntry, GymScheduledSession, ThirdPartyGymContract
} from '../types';
import { PackageCard } from './gym/PackageCard';
import { MemberRow } from './gym/MemberRow';
import { CoachRow } from './gym/CoachRow';
import { QRCard } from './gym/QRCard';
import { Coach360Modal } from './gym/Coach360Modal';
import { GymSessionCalendarTab } from './gym/GymSessionCalendarTab';
import { ThirdPartyContractsTab } from './gym/ThirdPartyContractsTab';
import { TenantBrandLockup } from './VescioNexusLogo';

const GymMembershipPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, login, logout, loading: authLoading, currency, formatCurrency, convertFromBase, convertToBase, handleFirestoreError, systemName, systemLogo } = useFirebase();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const theme: 'dark' | 'light' = isDarkMode ? 'dark' : 'light';

  const [activeTab, setActiveTab] = useState<'members' | 'packages' | 'qr-codes' | 'coaches' | 'schedule' | 'partners'>('members');
  
  // Modals
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [isEditPackageModalOpen, setIsEditPackageModalOpen] = useState(false);
  const [selectedPackageForEdit, setSelectedPackageForEdit] = useState<GymPackage | null>(null);
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [isCoachModalOpen, setIsCoachModalOpen] = useState(false);
  const [isCoachPackageModalOpen, setIsCoachPackageModalOpen] = useState(false);
  const [isEditCoachPackageModalOpen, setIsEditCoachPackageModalOpen] = useState(false);
  const [selectedCoachPackageForEdit, setSelectedCoachPackageForEdit] = useState<CoachPackage | null>(null);
  const [isCoachContractModalOpen, setIsCoachContractModalOpen] = useState(false);
  const [selectedCoachForView, setSelectedCoachForView] = useState<Coach | null>(null);
  const [isCoachViewModalOpen, setIsCoachViewModalOpen] = useState(false);
  const [selectedCoachContract, setSelectedCoachContract] = useState<CoachContract | null>(null);
  const [isEditCoachContractModalOpen, setIsEditCoachContractModalOpen] = useState(false);

  const [newCoachPackage, setNewCoachPackage] = useState<Partial<CoachPackage>>({
    name: '',
    lengthInWeeks: 4,
    sessions: 10,
    cost: 0,
    discountPercent: 0,
    discountAmount: 0,
    priceOverride: undefined
  });

  const [newCoachContract, setNewCoachContract] = useState<Partial<CoachContract>>({
    coachId: '',
    type: 'inhouse',
    contractMode: 'package',
    packageId: '',
    price: 0,
    discountPercent: 0,
    discountAmount: 0,
    priceOverride: undefined,
    sessions: 0,
    baseFeeOneClient: 10,
    extraClientFee: 5,
    maxClientsPerSession: 5,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [isCoachBillingModalOpen, setIsCoachBillingModalOpen] = useState(false);
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isOffDaysModalOpen, setIsOffDaysModalOpen] = useState(false);
  const [isEditMemberModalOpen, setIsEditMemberModalOpen] = useState(false);
  const [isMemberDetailsModalOpen, setIsMemberDetailsModalOpen] = useState(false);
  const [isEditCoachModalOpen, setIsEditCoachModalOpen] = useState(false);
  const [isCoachDetailsModalOpen, setIsCoachDetailsModalOpen] = useState(false);
  const [isDateLogsModalOpen, setIsDateLogsModalOpen] = useState(false);
  const [selectedDateForLogs, setSelectedDateForLogs] = useState<Date | null>(null);
  const [coachSessionsStartDate, setCoachSessionsStartDate] = useState<string>('');
  const [coachSessionsEndDate, setCoachSessionsEndDate] = useState<string>('');
  const [selectedMemberForBilling, setSelectedMemberForBilling] = useState<Member | null>(null);
  const [selectedCoachForBilling, setSelectedCoachForBilling] = useState<Coach | null>(null);
  const [selectedMemberForEdit, setSelectedMemberForEdit] = useState<Member | null>(null);
  const [selectedMemberForDetails, setSelectedMemberForDetails] = useState<Member | null>(null);
  const [selectedCoachForEdit, setSelectedCoachForEdit] = useState<Coach | null>(null);
  const [selectedCoachForDetails, setSelectedCoachForDetails] = useState<Coach | null>(null);
  const [selectedMemberForCheckIn, setSelectedMemberForCheckIn] = useState<Member | null>(null);
  const [checkInType, setCheckInType] = useState<'member' | 'walk-in' | 'free-lance'>('member');
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInFee, setWalkInFee] = useState('');
  const [walkInCoach, setWalkInCoach] = useState('');
  const [freeLanceCoachName, setFreeLanceCoachName] = useState('');
  const [trainerGuestName, setTrainerGuestName] = useState('');
  const [editingCheckIn, setEditingCheckIn] = useState<{ memberId: string, checkInId: string } | null>(null);
  const [billingDiscount, setBillingDiscount] = useState(0);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [cashbackCodeInput, setCashbackCodeInput] = useState('');
  const [billingPaymentMethod, setBillingPaymentMethod] = useState<'cash' | 'card' | 'transfer' | 'member_balance'>('cash');
  const [billingPaymentAmount, setBillingPaymentAmount] = useState<string>('');
  const [memberForRenewal, setMemberForRenewal] = useState<Member | null>(null);
  const [renewPackageId, setRenewPackageId] = useState<string>('');
  const [renewCoachId, setRenewCoachId] = useState<string>('');
  const [checkInCoach, setCheckInCoach] = useState('');
  const [checkInDate, setCheckInDate] = useState(new Date().toISOString().slice(0, 16));
  const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());
  const [offDays, setOffDays] = useState<string[]>([]);
  const [newOffDay, setNewOffDay] = useState('');
  const [manualCoachType, setManualCoachType] = useState<'inhouse' | 'freelance' | 'third_party'>('freelance');
  const [selectedMultiMemberIds, setSelectedMultiMemberIds] = useState<string[]>([]);
  const [multiGuestNames, setMultiGuestNames] = useState<string>('');
  const [sessionFeeOverrideInput, setSessionFeeOverrideInput] = useState<string>('');
  const [checkInLeadSource, setCheckInLeadSource] = useState<'partner_client' | 'facility_client'>('partner_client');
  const [mergeModeChoice, setMergeModeChoice] = useState<'ask' | 'merge' | 'separate'>('ask');
  const [selectedGroupParticipantCount, setSelectedGroupParticipantCount] = useState<number>(1);

  const [packages, setPackages] = useState<GymPackage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [coachPackages, setCoachPackages] = useState<CoachPackage[]>([]);
  const [coachContracts, setCoachContracts] = useState<CoachContract[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [scheduledSessions, setScheduledSessions] = useState<GymScheduledSession[]>([]);
  const [thirdPartyContracts, setThirdPartyContracts] = useState<ThirdPartyGymContract[]>([]);

  const getPrimaryGroupHolder = (member: Member): Member => {
    if (member.primaryGroupMemberId && member.primaryGroupMemberId !== member.id) {
      const primary = members.find(m => m.id === member.primaryGroupMemberId);
      if (primary) return primary;
    }
    return member;
  };

  const getCycleUsedSessions = (member: Member): number => {
    const holder = getPrimaryGroupHolder(member);
    if (holder.currentCycleCheckIns !== undefined) return holder.currentCycleCheckIns;
    return (holder.checkIns || []).filter(ci => !holder.startDate || ci.date >= holder.startDate).length;
  };

  const getStatus = (expiryDate?: string, currentStatus?: 'active' | 'inactive', packageId?: string, isFrozen?: boolean) => {
    if (isFrozen) return 'frozen';
    if (currentStatus === 'inactive') return 'inactive';
    if (packageId === 'walk-in') return 'active';
    if (!expiryDate) return 'inactive';
    const now = new Date();
    const expiry = new Date(expiryDate);
    if (now > expiry) return 'expired';
    
    // Check if expiring soon (within 5 days)
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays <= 5) return 'expire soon';
    
    return 'active';
  };

  // Firestore Syncing
  useEffect(() => {
    if (!user) return;

    const unsubMembers = onSnapshot(collection(db, 'members'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member));
      setMembers(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'members'));

    const unsubPackages = onSnapshot(collection(db, 'packages'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GymPackage));
      setPackages(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'packages'));

    const unsubCoaches = onSnapshot(collection(db, 'coaches'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Coach));
      setCoaches(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'coaches'));

    const unsubCoachPackages = onSnapshot(collection(db, 'coachPackages'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CoachPackage));
      setCoachPackages(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'coachPackages'));

    const unsubCoachContracts = onSnapshot(collection(db, 'coachContracts'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CoachContract));
      setCoachContracts(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'coachContracts'));

    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        if (data.offDays) setOffDays(data.offDays);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'settings/global'));

    const unsubCoupons = onSnapshot(collection(db, 'coupons'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Coupon));
      setCoupons(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'coupons'));

    const unsubScheduled = onSnapshot(collection(db, 'gym_scheduled_sessions'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GymScheduledSession));
      setScheduledSessions(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'gym_scheduled_sessions'));

    const unsubThirdParty = onSnapshot(collection(db, 'gym_third_party_contracts'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ThirdPartyGymContract));
      setThirdPartyContracts(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'gym_third_party_contracts'));

    return () => {
      unsubMembers();
      unsubPackages();
      unsubCoaches();
      unsubCoachPackages();
      unsubCoachContracts();
      unsubSettings();
      unsubCoupons();
      unsubScheduled();
      unsubThirdParty();
    };
  }, [user]);

  const getAppliedGymCoupon = (codeRaw: string): Coupon | null => {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return null;
    const match = coupons.find(c => c.code?.toUpperCase() === code);
    if (!match) return null;
    const isExpired = match.expiryDate && new Date(match.expiryDate).getTime() < Date.now();
    const isLimitReached = match.usageLimit > 0 && (match.usageCount || 0) >= match.usageLimit;
    const isModAllowed =
      !match.applicableModules ||
      match.applicableModules.length === 0 ||
      match.applicableModules.includes('gym');
    if (match.isActive !== false && !isExpired && !isLimitReached && isModAllowed) {
      return match;
    }
    return null;
  };

  const membersRef = useRef(members);
  useEffect(() => { membersRef.current = members; }, [members]);

  const coachesRef = useRef(coaches);
  useEffect(() => { coachesRef.current = coaches; }, [coaches]);

  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;
    if (isScannerOpen && isCheckInModalOpen) {
      scanner = new Html5QrcodeScanner(
        "qr-reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );

      scanner.render((decodedText) => {
        try {
          if (decodedText.startsWith('MEMBER:')) {
            const id = decodedText.split(':')[1];
            const member = membersRef.current.find(m => m.id === id);
            if (member) {
              if (member.isFrozen) {
                toast.error('Membership is currently frozen. Please unfreeze first.');
                return;
              }
              const st = getStatus(member.expiryDate, member.status, member.packageId, member.isFrozen);
              if (st !== 'active' && st !== 'expire soon') {
                toast.error('Membership is inactive or expired');
                return;
              }
              setSelectedMemberForCheckIn(member);
              setCheckInCoach(member.assignedCoachName || '');
              setIsScannerOpen(false);
              if (scanner) scanner.clear();
            } else {
              toast.error('Member not found');
            }
          } else if (decodedText.startsWith('COACH:')) {
            const id = decodedText.split(':')[1];
            const coach = coachesRef.current.find(c => c.id === id);
            if (coach) {
              setSelectedMemberForCheckIn({ id: 'free_lance', firstName: 'Free', lastName: 'Lance' } as Member);
              setFreeLanceCoachName(`${coach.firstName} ${coach.lastName}`);
              setIsScannerOpen(false);
              if (scanner) scanner.clear();
              toast.success(`Coach ${coach.firstName} recognized.`);
            } else {
              toast.error('Coach not found');
            }
          } else {
            // Legacy JSON fallback
            const data = JSON.parse(decodedText);
            if (data.id) {
              const member = membersRef.current.find(m => m.id === data.id);
              if (member) {
                if (member.isFrozen) {
                  toast.error('Membership is currently frozen. Please unfreeze first.');
                  return;
                }
                const st = getStatus(member.expiryDate, member.status, member.packageId, member.isFrozen);
                if (st !== 'active' && st !== 'expire soon') {
                  toast.error('Membership is inactive or expired');
                  return;
                }
                setSelectedMemberForCheckIn(member);
                setCheckInCoach(member.assignedCoachName || '');
                setIsScannerOpen(false);
                if (scanner) scanner.clear();
              } else {
                toast.error('Member not found');
              }
            }
          }
        } catch (e) {
          console.error('Failed to parse QR code', e);
        }
      }, (error) => {
        // Silent error for scanning
      });
    }

    return () => {
      if (scanner) {
        scanner.clear().catch(error => console.error("Failed to clear scanner", error));
      }
    };
  }, [isScannerOpen, isCheckInModalOpen]);

  // Billing Renewal Logic
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const updatedMembers = members.map(member => {
      // If today is renewal date or later, and it was paid, mark as unpaid for the new period
      if (member.expiryDate && today >= member.expiryDate && member.billingStatus === 'paid') {
        return { ...member, billingStatus: 'unpaid' as const };
      }
      return member;
    });

    const hasChanges = JSON.stringify(updatedMembers) !== JSON.stringify(members);
    if (hasChanges) {
      setMembers(updatedMembers);
    }
  }, [members]);

  // Form States
  const [newPackage, setNewPackage] = useState<Partial<GymPackage>>({
    name: '',
    duration: 1,
    price: 0,
    discountPercent: 0,
    discountAmount: 0,
    priceOverride: undefined,
    discountExpiry: '',
    sessions: 1,
    type: 'solo',
    maxPeople: 1,
    addons: []
  });
  const [addonType, setAddonType] = useState<'custom' | 'Recovery session' | 'Dietitian session'>('custom');
  const [newAddon, setNewAddon] = useState({ name: '', price: 0 });

  const [newMember, setNewMember] = useState<Partial<Member>>({
    firstName: '',
    lastName: '',
    dob: '',
    gender: '',
    nationality: 'Lebanon',
    level: 'Novice',
    height: '',
    weight: '',
    allergies: '',
    healthProblems: '',
    phone: '',
    email: '',
    packageId: '',
    assignedCoachId: '',
    assignedCoachName: '',
    groupMembers: [],
    discountPercent: 0,
    discountAmount: 0,
    priceOverride: undefined,
    startDate: new Date().toISOString().split('T')[0],
    addons: []
  });

  const [newCoach, setNewCoach] = useState<Partial<Coach>>({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    email: '',
    dob: '',
    gender: '',
    yearsOfExperience: 0,
    lastWorkPlace: '',
    specialties: [],
    hourRate: 0,
    type: 'inhouse',
    contractMode: 'package',
    baseFeeOneClient: 10,
    extraClientFee: 5,
    maxClientsPerSession: 5,
    monthlySessionCapacity: 0,
    currentMonthlySessions: 0,
    photo: '',
    nationality: ''
  });
  const [specialtyInput, setSpecialtyInput] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [countrySearch, setCountrySearch] = useState('');
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const idCardRef = useRef<HTMLDivElement>(null);
  const [selectedMemberForCard, setSelectedMemberForCard] = useState<Member | null>(null);

  // Calculations
  const isDiscountValid = (pkg: GymPackage) => {
    if ((!pkg.discountPercent || pkg.discountPercent <= 0) && (!pkg.discountAmount || pkg.discountAmount <= 0)) return false;
    if (!pkg.discountExpiry) return true;
    return new Date(pkg.discountExpiry) >= new Date();
  };

  const getEffectivePackagePrice = (pkg: GymPackage, memberOverrides?: Partial<Member>) => {
    if (memberOverrides?.priceOverride !== undefined && memberOverrides.priceOverride !== null && Number(memberOverrides.priceOverride) > 0) {
      return Number(memberOverrides.priceOverride);
    }
    let base = pkg.priceOverride !== undefined && pkg.priceOverride !== null && pkg.priceOverride > 0 ? pkg.priceOverride : pkg.price;
    if (isDiscountValid(pkg) && !pkg.priceOverride) {
      if (pkg.discountPercent && pkg.discountPercent > 0) {
        base = base * (1 - pkg.discountPercent / 100);
      }
      if (pkg.discountAmount && pkg.discountAmount > 0) {
        base = Math.max(0, base - pkg.discountAmount);
      }
    }
    if (memberOverrides?.discountPercent && memberOverrides.discountPercent > 0) {
      base = base * (1 - memberOverrides.discountPercent / 100);
    }
    if (memberOverrides?.discountAmount && memberOverrides.discountAmount > 0) {
      base = Math.max(0, base - memberOverrides.discountAmount);
    }
    return Number(Math.max(0, base).toFixed(2));
  };

  const getEffectiveCoachPackagePrice = (cpkg: CoachPackage): number => {
    if (cpkg.priceOverride !== undefined && cpkg.priceOverride !== null && Number(cpkg.priceOverride) > 0) {
      return Number(cpkg.priceOverride);
    }
    let base = Number(cpkg.cost || 0);
    if (cpkg.discountPercent && cpkg.discountPercent > 0) {
      base = base * (1 - cpkg.discountPercent / 100);
    }
    if (cpkg.discountAmount && cpkg.discountAmount > 0) {
      base = Math.max(0, base - cpkg.discountAmount);
    }
    return Number(Math.max(0, base).toFixed(2));
  };

  const calculateExpiry = (startDate: string, durationMonths: number) => {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + durationMonths);
    return date.toISOString().split('T')[0];
  };

  // Handlers
  const handleAddPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPackage.name || !newPackage.duration || !newPackage.price || !user) return;
    
    const pkgData = {
      name: newPackage.name!,
      duration: newPackage.duration!,
      price: newPackage.price!,
      discountPercent: newPackage.discountPercent || 0,
      discountAmount: newPackage.discountAmount || 0,
      priceOverride: newPackage.priceOverride !== undefined && Number(newPackage.priceOverride) > 0 ? Number(newPackage.priceOverride) : null,
      discountExpiry: newPackage.discountExpiry || '',
      sessions: newPackage.sessions || 1,
      image: newPackage.image || '',
      type: newPackage.type || 'solo',
      maxPeople: newPackage.type === 'group' ? (newPackage.maxPeople || 2) : null,
      addons: newPackage.addons || [],
      uid: user.uid
    };
    
    try {
      await addDoc(collection(db, 'packages'), stripUndefined(pkgData));
      setIsPackageModalOpen(false);
      setNewPackage({ name: '', duration: 1, price: 0, discountPercent: 0, discountAmount: 0, priceOverride: undefined, discountExpiry: '', sessions: 1, type: 'solo', maxPeople: 1, addons: [] });
      toast.success('Package added successfully');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'packages');
      toast.error(error.message || 'Failed to add package');
    }
  };

  const handleUpdatePackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackageForEdit || !user) return;
    try {
      const { id, ...rest } = selectedPackageForEdit;
      await updateDoc(doc(db, 'packages', id), stripUndefined({
        ...rest,
        maxPeople: selectedPackageForEdit.type === 'group' ? (selectedPackageForEdit.maxPeople || 2) : null,
        discountPercent: Number(selectedPackageForEdit.discountPercent) || 0,
        discountAmount: Number(selectedPackageForEdit.discountAmount) || 0,
        priceOverride: selectedPackageForEdit.priceOverride !== undefined && Number(selectedPackageForEdit.priceOverride) > 0
          ? Number(selectedPackageForEdit.priceOverride)
          : null,
      }));
      setIsEditPackageModalOpen(false);
      setSelectedPackageForEdit(null);
      toast.success('Client package updated successfully');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `packages/${selectedPackageForEdit.id}`);
      toast.error(error.message || 'Failed to update package');
    }
  };

  const handleAddOffDay = async () => {
    if (!newOffDay || !user) return;
    if (offDays.includes(newOffDay)) {
      toast.error('This date is already an off day');
      return;
    }
    
    const newOffDays = [...offDays, newOffDay].sort((a, b) => a.localeCompare(b));
    try {
      await setDoc(doc(db, 'settings', 'global'), { offDays: newOffDays, uid: user.uid }, { merge: true });
      setNewOffDay('');
      toast.success('Off day added successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/global');
    }
  };

  const handleRemoveOffDay = async (date: string) => {
    if (!user) return;
    const newOffDays = offDays.filter(d => d !== date);
    try {
      await setDoc(doc(db, 'settings', 'global'), { offDays: newOffDays, uid: user.uid }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/global');
    }
  };

  const calculateCoachTieredFee = (coach: Coach | undefined, contract: CoachContract | undefined, clientCount: number): number => {
    if (!coach || clientCount <= 0) return 0;
    const baseOne = contract?.baseFeeOneClient ?? coach.baseFeeOneClient ?? coach.hourRate ?? 0;
    const extraFee = contract?.extraClientFee ?? coach.extraClientFee ?? 0;
    if (baseOne <= 0 && extraFee <= 0) return 0;
    return Number((baseOne + Math.max(0, clientCount - 1) * extraFee).toFixed(2));
  };

  // Detect if the selected coach has an active session within the last 60 minutes today
  const findSameTimeframeCoachSession = (coachNameOrId: string): {
    coach: Coach;
    ledgerEntry: CoachSessionLedgerEntry;
    minutesAgo: number;
  } | null => {
    if (!coachNameOrId || coachNameOrId === 'None') return null;
    const matchedCoach = coaches.find(
      c => c.id === coachNameOrId || `${c.firstName} ${c.lastName}` === coachNameOrId
    );
    if (!matchedCoach) return null;
    const nowMs = Date.now();
    const recentLedger = (matchedCoach.sessionLedger || []).find(entry => {
      if (entry.status === 'cancelled') return false;
      const entryMs = new Date(entry.date).getTime();
      if (isNaN(entryMs)) return false;
      const diffMinutes = Math.abs(nowMs - entryMs) / (1000 * 60);
      return isSameDay(new Date(entryMs), new Date()) && diffMinutes <= 60;
    });
    if (!recentLedger) return null;
    const minutesAgo = Math.max(0, Math.round((nowMs - new Date(recentLedger.date).getTime()) / (1000 * 60)));
    return { coach: matchedCoach, ledgerEntry: recentLedger, minutesAgo };
  };

  const executeMultiClientCheckIn = async (params: {
    coachId: string;
    coachName: string;
    memberIds: string[];
    guestNames: string[];
    sessionFeeOverride?: number | null;
    leadSource?: 'partner_client' | 'facility_client';
    thirdPartyContractId?: string;
    sessionRevenue?: number;
    scheduledSessionId?: string;
    sessionDateIso?: string;
    mergeIntoSessionGroupId?: string;
    groupPoolDeductionOverride?: number;
  }) => {
    if (!user) return;
    const nowIso = params.sessionDateIso || new Date().toISOString();
    const dayStr = nowIso.split('T')[0];

    if (offDays.includes(dayStr)) {
      toast.error('Selected date is an OFF day. Check-ins are not allowed.');
      return;
    }

    const validMembers = params.memberIds
      .map(id => members.find(m => m.id === id))
      .filter((m): m is Member => !!m);

    // Group members by their primary shared package holder so family members sharing a pool deduct accurately
    const holderDeductionMap = new Map<string, { holder: Member; participants: Member[]; sessionsToDeduct: number }>();

    for (const m of validMembers) {
      if (m.isFrozen) {
        toast.error(`${m.firstName} ${m.lastName}'s membership is frozen. Unfreeze first.`);
        return;
      }
      const holder = getPrimaryGroupHolder(m);
      const existing = holderDeductionMap.get(holder.id);
      const addCount =
        validMembers.length === 1 && params.groupPoolDeductionOverride && params.groupPoolDeductionOverride > 1
          ? params.groupPoolDeductionOverride
          : 1;
      if (existing) {
        existing.participants.push(m);
        existing.sessionsToDeduct += addCount;
      } else {
        holderDeductionMap.set(holder.id, {
          holder,
          participants: [m],
          sessionsToDeduct: addCount
        });
      }
    }

    // Validate package quota for each holder pool
    for (const [, pool] of holderDeductionMap.entries()) {
      const pkg = packages.find(p => p.id === pool.holder.packageId);
      const used = getCycleUsedSessions(pool.holder);
      if (pkg && used + pool.sessionsToDeduct > pkg.sessions) {
        toast.error(
          `${pool.holder.firstName} ${pool.holder.lastName}'s package only has ${Math.max(0, pkg.sessions - used)} session(s) left (${used}/${pkg.sessions}). Cannot deduct ${pool.sessionsToDeduct}.`
        );
        return;
      }
    }

    const matchedCoach = params.coachId
      ? coaches.find(c => c.id === params.coachId)
      : coaches.find(c => `${c.firstName} ${c.lastName}` === params.coachName);
    const activeContract = matchedCoach
      ? coachContracts.find(c => c.coachId === matchedCoach.id)
      : undefined;

    const extraFamilySpots =
      validMembers.length === 1 && params.groupPoolDeductionOverride && params.groupPoolDeductionOverride > 1
        ? Array.from({ length: params.groupPoolDeductionOverride - 1 }).map(
            (_, idx) =>
              validMembers[0].groupMembers?.[idx]?.name ||
              `${validMembers[0].firstName} Family #${idx + 2}`
          )
        : [];

    const allParticipantNames = [
      ...validMembers.map(m => `${m.firstName} ${m.lastName}`),
      ...extraFamilySpots,
      ...params.guestNames.filter(Boolean)
    ];
    const newClientsCount = Math.max(1, allParticipantNames.length);

    // Check if we are merging into an existing coach session in the same timeframe
    const existingLedgerToMerge =
      params.mergeIntoSessionGroupId && matchedCoach
        ? (matchedCoach.sessionLedger || []).find(e => e.id === params.mergeIntoSessionGroupId)
        : undefined;

    const sessionGroupId = existingLedgerToMerge ? existingLedgerToMerge.id : `SESS-${Date.now()}`;

    const combinedParticipantNames = existingLedgerToMerge
      ? Array.from(new Set([...(existingLedgerToMerge.clientNames || []), ...allParticipantNames]))
      : allParticipantNames;
    const combinedMemberIds = existingLedgerToMerge
      ? Array.from(new Set([...(existingLedgerToMerge.memberIds || []), ...validMembers.map(vm => vm.id)]))
      : validMembers.map(vm => vm.id);
    const totalClientCount = existingLedgerToMerge
      ? Math.max(existingLedgerToMerge.clientCount + newClientsCount, combinedParticipantNames.length)
      : newClientsCount;

    const autoCoachFee = calculateCoachTieredFee(matchedCoach, activeContract, totalClientCount);
    const finalSessionFee =
      params.sessionFeeOverride !== undefined && params.sessionFeeOverride !== null
        ? Number(params.sessionFeeOverride)
        : autoCoachFee;

    const previousSessionFee = existingLedgerToMerge
      ? (existingLedgerToMerge.feeOverride !== undefined ? existingLedgerToMerge.feeOverride : existingLedgerToMerge.calculatedFee)
      : 0;
    const feeDelta = existingLedgerToMerge
      ? Math.max(0, Number((finalSessionFee - previousSessionFee).toFixed(2)))
      : finalSessionFee;

    const matchedThirdPartyByPractitioner = thirdPartyContracts.find(tp => {
      if (tp.status !== 'active') return false;
      if (matchedCoach && (tp.linkedCoachIds || []).includes(matchedCoach.id)) return true;
      const targetName = (params.coachName || (matchedCoach ? `${matchedCoach.firstName} ${matchedCoach.lastName}` : '')).trim().toLowerCase();
      return (tp.practitioners || []).some(
        p => (matchedCoach && p.id === matchedCoach.id) || (targetName && p.name.trim().toLowerCase() === targetName)
      );
    });
    const resolvedThirdPartyId =
      params.thirdPartyContractId ||
      matchedCoach?.thirdPartyContractId ||
      activeContract?.thirdPartyContractId ||
      matchedThirdPartyByPractitioner?.id ||
      '';

    // 1. Deduct sessions from each subscribed member / shared family pool
    for (const [, pool] of holderDeductionMap.entries()) {
      const holderUsed = getCycleUsedSessions(pool.holder);
      const nextHolderUsed = holderUsed + pool.sessionsToDeduct;

      for (const m of pool.participants) {
        const checkInId = `${Date.now()}_${m.id}`;
        const newCheckIn: CheckIn = stripUndefined({
          id: checkInId,
          memberId: m.id,
          date: nowIso,
          coach: params.coachName || m.assignedCoachName || 'None',
          coachId: matchedCoach?.id || m.assignedCoachId || '',
          sessionGroupId,
          participantIds: combinedMemberIds,
          participantNames: combinedParticipantNames,
          clientCount: totalClientCount,
          sessionFee: finalSessionFee,
          leadSource: params.leadSource || 'partner_client',
          thirdPartyContractId: resolvedThirdPartyId || undefined
        });

        const updatedCheckIns = stripUndefined([...(m.checkIns || []), newCheckIn]);
        const updatedActiveSubs = Array.isArray(m.activeSubscriptions)
          ? m.activeSubscriptions.map(sub =>
              sub.module === 'gym' && sub.status === 'active'
                ? {
                    ...sub,
                    usedSessions: nextHolderUsed,
                    remainingSessions: Math.max(0, sub.totalSessions - nextHolderUsed)
                  }
                : sub
            )
          : undefined;

        await updateDoc(doc(db, 'members', m.id), stripUndefined({
          checkIns: updatedCheckIns,
          currentCycleCheckIns: nextHolderUsed,
          ...(updatedActiveSubs ? { activeSubscriptions: updatedActiveSubs } : {})
        }));

        await setDoc(doc(db, `members/${m.id}/checkIns`, checkInId), stripUndefined({
          memberId: m.id,
          date: nowIso.split('T')[0],
          time: nowIso.split('T')[1]?.slice(0, 5) || '10:00',
          serviceType: 'gym',
          coachId: matchedCoach?.id || params.coachName || null,
          sessionGroupId,
          clientCount: totalClientCount,
          sessionFee: finalSessionFee,
          sessionsDeducted: pool.sessionsToDeduct,
          mergedIntoExistingSession: !!existingLedgerToMerge,
          createdAt: new Date().toISOString(),
          createdBy: user.uid,
          source: 'gym_checkin'
        }));
      }

      // Synchronize shared family/group pool across primary holder and all linked group members
      const allSharedGroupIds = Array.from(
        new Set([
          pool.holder.id,
          ...(pool.holder.sharedGroupMemberIds || []),
          ...members
            .filter(mem => mem.primaryGroupMemberId === pool.holder.id)
            .map(mem => mem.id)
        ])
      ).filter(id => !pool.participants.some(p => p.id === id));

      for (const linkedMemberId of allSharedGroupIds) {
        const linkedMem = members.find(mem => mem.id === linkedMemberId);
        if (!linkedMem) continue;
        const syncedSubs = Array.isArray(linkedMem.activeSubscriptions)
          ? linkedMem.activeSubscriptions.map(sub =>
              sub.module === 'gym' && sub.status === 'active'
                ? {
                    ...sub,
                    usedSessions: nextHolderUsed,
                    remainingSessions: Math.max(0, sub.totalSessions - nextHolderUsed)
                  }
                : sub
            )
          : undefined;
        await updateDoc(doc(db, 'members', linkedMemberId), stripUndefined({
          currentCycleCheckIns: nextHolderUsed,
          ...(syncedSubs ? { activeSubscriptions: syncedSubs } : {})
        }));
      }
    }

    // 2. Update Coach session ledger, accrued fees, and package/monthly counters
    if (matchedCoach) {
      if (existingLedgerToMerge) {
        // MERGE into the same timeframe session: update the existing ledger & checkIn entry and add ONLY feeDelta
        const updatedLedger = (matchedCoach.sessionLedger || []).map(entry =>
          entry.id === existingLedgerToMerge.id
            ? stripUndefined({
                ...entry,
                clientNames: combinedParticipantNames,
                memberIds: combinedMemberIds,
                clientCount: totalClientCount,
                calculatedFee: autoCoachFee,
                feeOverride:
                  params.sessionFeeOverride !== undefined && params.sessionFeeOverride !== null
                    ? Number(params.sessionFeeOverride)
                    : entry.feeOverride
              })
            : entry
        );

        const updatedCoachCheckIns = (matchedCoach.checkIns || []).map(ci =>
          ci.id === existingLedgerToMerge.id
            ? stripUndefined({
                ...ci,
                participantNames: combinedParticipantNames,
                participantIds: combinedMemberIds,
                clientCount: totalClientCount,
                sessionFee: finalSessionFee
              })
            : ci
        );

        await updateDoc(doc(db, 'coaches', matchedCoach.id), stripUndefined({
          sessionLedger: updatedLedger,
          checkIns: updatedCoachCheckIns,
          accruedSessionFees: Number(((matchedCoach.accruedSessionFees || 0) + feeDelta).toFixed(2))
        }));

        if (activeContract && feeDelta > 0) {
          await updateDoc(doc(db, 'coachContracts', activeContract.id), stripUndefined({
            accruedSessionFees: Number(((activeContract.accruedSessionFees || 0) + feeDelta).toFixed(2))
          }));
        }
      } else {
        // NEW independent coach session
        const ledgerEntry: CoachSessionLedgerEntry = stripUndefined({
          id: sessionGroupId,
          date: nowIso,
          clientNames: combinedParticipantNames.length > 0 ? combinedParticipantNames : ['Standalone Session'],
          memberIds: combinedMemberIds,
          clientCount: totalClientCount,
          calculatedFee: autoCoachFee,
          feeOverride: params.sessionFeeOverride !== undefined && params.sessionFeeOverride !== null ? Number(params.sessionFeeOverride) : undefined,
          leadSource: params.leadSource || 'partner_client',
          thirdPartyContractId: resolvedThirdPartyId || undefined,
          status: 'completed'
        });

        const coachCheckInEntry = stripUndefined({
          id: sessionGroupId,
          timestamp: nowIso,
          coachId: matchedCoach.id,
          coachName: `${matchedCoach.firstName} ${matchedCoach.lastName}`,
          guestClientName: params.guestNames.join(', '),
          participantNames: combinedParticipantNames,
          participantIds: combinedMemberIds,
          clientCount: totalClientCount,
          sessionFee: finalSessionFee,
          leadSource: params.leadSource || 'partner_client',
          thirdPartyContractId: resolvedThirdPartyId || undefined,
          contractId: activeContract?.id || ''
        });

        const currentMonth = nowIso.slice(0, 7);
        let newMonthlyUsed = (matchedCoach.currentMonthlySessions || 0) + 1;
        let lastReset = matchedCoach.lastResetDate;
        if (!lastReset || !lastReset.startsWith(currentMonth)) {
          newMonthlyUsed = 1;
          lastReset = currentMonth;
        }

        await updateDoc(doc(db, 'coaches', matchedCoach.id), stripUndefined({
          sessionLedger: [ledgerEntry, ...(matchedCoach.sessionLedger || [])],
          checkIns: [...(matchedCoach.checkIns || []), coachCheckInEntry],
          accruedSessionFees: Number(((matchedCoach.accruedSessionFees || 0) + finalSessionFee).toFixed(2)),
          currentMonthlySessions: newMonthlyUsed,
          lastResetDate: lastReset
        }));

        if (activeContract && activeContract.contractMode !== 'session_bypass' && (activeContract.remainingSessions ?? activeContract.sessions) > 0) {
          const nextRem = Math.max(0, (activeContract.remainingSessions ?? activeContract.sessions) - 1);
          await updateDoc(doc(db, 'coachContracts', activeContract.id), stripUndefined({
            remainingSessions: nextRem,
            accruedSessionFees: Number(((activeContract.accruedSessionFees || 0) + finalSessionFee).toFixed(2))
          }));
        } else if (activeContract) {
          await updateDoc(doc(db, 'coachContracts', activeContract.id), stripUndefined({
            accruedSessionFees: Number(((activeContract.accruedSessionFees || 0) + finalSessionFee).toFixed(2))
          }));
        }

        // 3. If linked to a 3rd-party B2B partner contract, increment usedSessionsCurrentCycle AND practitioner's completedSessions
        if (resolvedThirdPartyId) {
          const tp = thirdPartyContracts.find(t => t.id === resolvedThirdPartyId);
          if (tp) {
            const targetCoachNameLower = (
              params.coachName ||
              (matchedCoach ? `${matchedCoach.firstName} ${matchedCoach.lastName}` : '')
            )
              .trim()
              .toLowerCase();
            const updatedPractitioners = (tp.practitioners || []).map(p => {
              const isMatch =
                (matchedCoach && (p.id === matchedCoach.id || p.linkedStaffId === matchedCoach.id)) ||
                (targetCoachNameLower && p.name.trim().toLowerCase() === targetCoachNameLower);
              return isMatch
                ? { ...p, completedSessions: (p.completedSessions || 0) + 1 }
                : p;
            });
            const nextUsedCycle = (tp.usedSessionsCurrentCycle || 0) + 1;
            await updateDoc(doc(db, 'gym_third_party_contracts', tp.id), stripUndefined({
              usedSessionsCurrentCycle: nextUsedCycle,
              practitioners: updatedPractitioners
            }));
          }
        }
      }
    }

    // 4. If triggered from a scheduled calendar session, mark it checked_in
    if (params.scheduledSessionId) {
      await updateDoc(doc(db, 'gym_scheduled_sessions', params.scheduledSessionId), stripUndefined({
        status: 'checked_in',
        checkedInAt: new Date().toISOString(),
        finalSessionFee
      }));
    }

    if (existingLedgerToMerge && matchedCoach) {
      toast.success(
        `Grouped into ${matchedCoach.firstName}'s active session (${totalClientCount} clients total • +${formatCurrency(feeDelta)} extra client fee added, Total: ${formatCurrency(finalSessionFee)})!`
      );
    } else {
      toast.success(
        `Checked in ${newClientsCount} client(s)${matchedCoach ? ` with ${matchedCoach.firstName} (Session Fee: ${formatCurrency(finalSessionFee)})` : ''}!`
      );
    }
  };

  const trackCoachSession = async (coachName: string, isStandAlone: boolean = false, guestClientName?: string) => {
    if (!coachName || coachName === 'None') return;
    const coach = coaches.find(c => `${c.firstName} ${c.lastName}` === coachName);
    if (!coach) return;
    await executeMultiClientCheckIn({
      coachId: coach.id,
      coachName: `${coach.firstName} ${coach.lastName}`,
      memberIds: [],
      guestNames: guestClientName ? [guestClientName] : [],
      sessionFeeOverride: sessionFeeOverrideInput !== '' ? Number(sessionFeeOverrideInput) : null,
      leadSource: checkInLeadSource
    });
  };

  const handleConfirmCheckIn = async () => {
    if (!selectedMemberForCheckIn && selectedMultiMemberIds.length === 0) return;
    if (!user) return;

    const todayStr = new Date().toISOString().split('T')[0];
    if (offDays.includes(todayStr)) {
      toast.error('Today is an OFF day. Check-ins are not allowed.');
      return;
    }

    try {
      if (selectedMemberForCheckIn?.id === 'walk_in') {
        if (!walkInName || !walkInPhone) {
          toast.error('Please enter name and phone for walk-in');
          return;
        }
        
        const normPhone = normalizePhone(walkInPhone);
        const existingRealMember = normPhone
          ? members.find(m =>
              m.id !== 'walk_in' &&
              m.id !== 'system_walk_in' &&
              !m.isSystemWalkIn &&
              m.packageId !== 'walk-in' &&
              normalizePhone(m.phone) === normPhone
            )
          : undefined;

        const targetWalkInContainer = existingRealMember || members.find(m => m.id === 'system_walk_in' || m.isSystemWalkIn);
        const targetDocId = existingRealMember ? existingRealMember.id : 'system_walk_in';
        const fee = Number(walkInFee) || 0;
        
        // Audit log for Walk-in Fee
        if (fee > 0) {
          await processLedgerTransaction({
            amount: fee,
            paymentMethod: 'cash',
            sourceModule: 'gym',
            cashierId: user?.uid || 'system',
            transactionType: 'walkin_fee',
            memberId: existingRealMember ? existingRealMember.id : null,
            notes: `Walk-in fee for ${walkInName} (${walkInPhone})`,
          });
        }

        const newCheckIn: CheckIn = {
          id: Date.now().toString(),
          memberId: targetDocId,
          date: new Date().toISOString(),
          coach: walkInCoach || 'None',
          clientName: `${walkInName} (${walkInPhone})`
        };

        const newPayment = fee > 0 ? {
          id: Date.now().toString() + '_pay',
          amount: fee,
          date: new Date().toISOString(),
          packageId: 'walk-in'
        } : null;

        if (targetWalkInContainer) {
          const updatedMember = stripUndefined({ 
            ...targetWalkInContainer, 
            checkIns: [...(targetWalkInContainer.checkIns || []), newCheckIn],
            paymentHistory: newPayment ? [...(targetWalkInContainer.paymentHistory || []), newPayment] : (targetWalkInContainer.paymentHistory || []),
            totalPaid: (targetWalkInContainer.totalPaid || 0) + fee,
            expectedFee: (targetWalkInContainer.expectedFee || 0) + fee,
            ...(existingRealMember ? {} : { isSystemWalkIn: true, billingStatus: 'paid' as const })
          });
          await setDoc(doc(db, 'members', targetDocId), stripUndefined({ ...updatedMember, uid: user.uid }), { merge: true });
        } else {
          const systemWalkInDoc: Member = {
            id: 'system_walk_in',
            firstName: 'Gym',
            lastName: 'Walk-In',
            phone: walkInPhone,
            packageId: 'walk-in',
            status: 'active',
            billingStatus: 'paid',
            isSystemWalkIn: true,
            startDate: new Date().toISOString(),
            expiryDate: new Date().toISOString(),
            checkIns: [newCheckIn],
            paymentHistory: newPayment ? [newPayment] : [],
            dob: '', gender: '', nationality: '', level: 'Novice', height: '', weight: '', allergies: '', healthProblems: '', email: '', qrCode: '',
            addons: [],
            expectedFee: fee,
            totalPaid: fee
          };
          await setDoc(doc(db, 'members', 'system_walk_in'), stripUndefined({ ...systemWalkInDoc, uid: user.uid }));
        }

        await setDoc(doc(db, `members/${targetDocId}/checkIns`, newCheckIn.id), stripUndefined({
          memberId: targetDocId,
          guestName: walkInName,
          guestPhone: walkInPhone,
          date: newCheckIn.date.split('T')[0],
          time: newCheckIn.date.split('T')[1].slice(0, 5),
          serviceType: 'gym',
          coachId: newCheckIn.coach || null,
          createdAt: new Date().toISOString(),
          createdBy: user.uid,
          source: 'gym_checkin'
        }));
        
        if (walkInCoach && walkInCoach !== 'None') {
          await trackCoachSession(walkInCoach, false, walkInName);
        }

        toast.success('Walk-in check-in successful!');
        setWalkInName('');
        setWalkInPhone('');
        setWalkInFee('');
        setWalkInCoach('');
        setSelectedMemberForCheckIn(null);
        return;
      }

      if (selectedMemberForCheckIn?.id === 'free_lance') {
        if (!freeLanceCoachName) {
          toast.error('Please select coach for standalone check-in');
          return;
        }
        
        let checkingInCoach = coaches.find(c => `${c.firstName} ${c.lastName}` === freeLanceCoachName);
        
        if (!checkingInCoach) {
          const [firstName, ...lastNameParts] = freeLanceCoachName.split(' ');
          const lastName = lastNameParts.join(' ') || '(Added instantly)';
          const newId = Date.now().toString();
          const newCoachData: Coach = {
            id: newId,
            firstName,
            lastName,
            email: 'added-instantly@system.com',
            phoneNumber: 'N/A',
            type: manualCoachType,
            nationality: 'Unknown',
            dob: new Date().toISOString().split('T')[0],
            gender: 'Other',
            yearsOfExperience: 0,
            lastWorkPlace: 'N/A',
            specialties: [],
            hourRate: 0,
            monthlySessionCapacity: 30,
            currentMonthlySessions: 0,
            qrCode: `COACH:${newId}`,
            photo: '',
            checkIns: []
          };
          
          await setDoc(doc(db, 'coaches', newId), stripUndefined({ ...newCoachData, uid: user.uid }));
          checkingInCoach = newCoachData;
          toast.success(`New ${manualCoachType} coach created: ${freeLanceCoachName}`);
        }

        const guestClients = trainerGuestName.split(',').map(s => s.trim()).filter(Boolean);
        await executeMultiClientCheckIn({
          coachId: checkingInCoach.id,
          coachName: `${checkingInCoach.firstName} ${checkingInCoach.lastName}`,
          memberIds: selectedMultiMemberIds,
          guestNames: guestClients,
          sessionFeeOverride: sessionFeeOverrideInput !== '' ? Number(sessionFeeOverrideInput) : null,
          leadSource: checkInLeadSource
        });
        
        await processLedgerTransaction({
          amount: 0,
          paymentMethod: 'system',
          sourceModule: 'gym',
          cashierId: user?.uid || 'system',
          transactionType: 'coach_standalone_checkin',
          notes: `Coach check-in for ${freeLanceCoachName} (${checkingInCoach.type})${trainerGuestName ? ` - Clients: ${trainerGuestName}` : ''}`,
        });

        setFreeLanceCoachName('');
        setTrainerGuestName('');
        setSelectedMultiMemberIds([]);
        setSessionFeeOverrideInput('');
        setSelectedMemberForCheckIn(null);
        return;
      }

      if (editingCheckIn && selectedMemberForCheckIn) {
        const memberToUpdate = members.find(m => m.id === editingCheckIn.memberId);
        if (memberToUpdate) {
          const updatedCheckIns = (memberToUpdate.checkIns || []).map(ci => 
            ci.id === editingCheckIn.checkInId 
              ? { ...ci, coach: checkInCoach || 'None', date: checkInDate, memberId: selectedMemberForCheckIn.id } 
              : ci
          );
          await updateDoc(doc(db, 'members', editingCheckIn.memberId), stripUndefined({ checkIns: updatedCheckIns }));
        }
        setEditingCheckIn(null);
        toast.success('Check-in updated!');
      } else {
        // Multi-client or single-member check-in
        const targetMemberIds = Array.from(
          new Set([
            ...(selectedMemberForCheckIn && selectedMemberForCheckIn.id !== 'walk_in' && selectedMemberForCheckIn.id !== 'free_lance'
              ? [selectedMemberForCheckIn.id]
              : []),
            ...selectedMultiMemberIds
          ])
        );
        const primaryMember = members.find(m => m.id === targetMemberIds[0]);
        const effectiveCoachName = checkInCoach || primaryMember?.assignedCoachName || 'None';
        const matchedCoach = coaches.find(c => `${c.firstName} ${c.lastName}` === effectiveCoachName);
        const parsedGuests = multiGuestNames.split(',').map(s => s.trim()).filter(Boolean);

        // Check if there is an active same-timeframe session for this coach
        const sameTimeframeMatch = findSameTimeframeCoachSession(matchedCoach?.id || effectiveCoachName);

        await executeMultiClientCheckIn({
          coachId: matchedCoach?.id || primaryMember?.assignedCoachId || '',
          coachName: effectiveCoachName,
          memberIds: targetMemberIds,
          guestNames: parsedGuests,
          sessionFeeOverride: sessionFeeOverrideInput !== '' ? Number(sessionFeeOverrideInput) : null,
          leadSource: checkInLeadSource,
          mergeIntoSessionGroupId:
            sameTimeframeMatch && mergeModeChoice === 'merge'
              ? sameTimeframeMatch.ledgerEntry.id
              : undefined,
          groupPoolDeductionOverride: selectedGroupParticipantCount > 1 ? selectedGroupParticipantCount : 1
        });
      }
      
      setCheckInCoach('');
      setCheckInDate(new Date().toISOString().slice(0, 16));
      setSelectedMemberForCheckIn(null);
      setSelectedMultiMemberIds([]);
      setMultiGuestNames('');
      setSessionFeeOverrideInput('');
      setMergeModeChoice('ask');
      setSelectedGroupParticipantCount(1);
      setIsCheckInModalOpen(false);
      setIsScannerOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `members/${selectedMemberForCheckIn?.id || 'multi'}`);
    }
  };

  const startEditCheckIn = (memberId: string, checkIn: CheckIn) => {
    const member = members.find(m => m.id === memberId);
    if (!member) return;
    setSelectedMemberForCheckIn(member);
    setEditingCheckIn({ memberId, checkInId: checkIn.id });
    setCheckInCoach(checkIn.coach || '');
    setCheckInDate(new Date(checkIn.date).toISOString().slice(0, 16));
    setIsCheckInModalOpen(true);
  };

  const handleDeleteCheckIn = async (memberId: string, checkInId: string) => {
    if (!window.confirm('Are you sure you want to delete this check-in?')) return;
    const member = members.find(m => m.id === memberId);
    if (!member) return;
    
    const updatedCheckIns = (member.checkIns || []).filter(ci => ci.id !== checkInId);
    const nextCycleCount = Math.max(0, getCycleUsedSessions(member) - 1);
    try {
      await updateDoc(doc(db, 'members', memberId), {
        checkIns: updatedCheckIns,
        currentCycleCheckIns: nextCycleCount
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `members/${memberId}`);
    }
  };

  const handleRenewMembership = (memberId: string) => {
    const member = members.find(m => m.id === memberId);
    if (!member || !user) return;
    setMemberForRenewal(member);
    setRenewPackageId(member.packageId || '');
    setRenewCoachId(member.assignedCoachId || '');
  };

  const handleConfirmRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberForRenewal || !user) return;
    const pkg = packages.find(p => p.id === (renewPackageId || memberForRenewal.packageId));
    if (!pkg) {
      toast.error('Please select a valid package for renewal.');
      return;
    }

    const cycleCheckIns = (memberForRenewal.checkIns || []).filter(
      ci => !memberForRenewal.startDate || ci.date >= memberForRenewal.startDate
    );

    const newHistoryItem = {
      id: Date.now().toString(),
      startDate: memberForRenewal.startDate || new Date().toISOString().split('T')[0],
      expiryDate: memberForRenewal.expiryDate || new Date().toISOString().split('T')[0],
      packageId: memberForRenewal.packageId || pkg.id,
      totalPaid: memberForRenewal.totalPaid || 0,
      checkIns: cycleCheckIns
    };

    const newStartDate = new Date().toISOString().split('T')[0];
    const newExpiryDate = addMonths(new Date(newStartDate), pkg.duration).toISOString().split('T')[0];
    const assignedCoach = coaches.find(c => c.id === renewCoachId);

    try {
      await updateDoc(doc(db, 'members', memberForRenewal.id), stripUndefined({ 
        packageId: pkg.id,
        assignedCoachId: assignedCoach ? assignedCoach.id : '',
        assignedCoachName: assignedCoach ? `${assignedCoach.firstName} ${assignedCoach.lastName}` : '',
        startDate: newStartDate,
        expiryDate: newExpiryDate,
        currentCycleCheckIns: 0,
        status: 'active',
        isFrozen: false,
        freezeStartDate: null,
        billingStatus: 'unpaid',
        expectedFee: pkg.price,
        totalPaid: 0,
        membershipHistory: [...(memberForRenewal.membershipHistory || []), newHistoryItem]
      }));
      toast.success(`Membership renewed under ${pkg.name}! Session quota reset to 0/${pkg.sessions}.`);
      setMemberForRenewal(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `members/${memberForRenewal.id}`);
    }
  };

  const handleToggleFreezeMember = async (member: Member) => {
    if (!user) return;
    try {
      if (!member.isFrozen) {
        const nowIso = new Date().toISOString();
        await updateDoc(doc(db, 'members', member.id), {
          isFrozen: true,
          freezeStartDate: nowIso,
          status: 'inactive'
        });
        toast.info(`${member.firstName}'s membership is now FROZEN. Expiry date will be extended when unfrozen.`);
      } else {
        const freezeStart = member.freezeStartDate ? new Date(member.freezeStartDate) : new Date();
        const frozenDays = Math.max(1, differenceInDays(new Date(), freezeStart));
        const baseExpiry = member.expiryDate ? new Date(member.expiryDate) : new Date();
        const newExpiryDate = addDays(baseExpiry, frozenDays).toISOString().split('T')[0];

        await updateDoc(doc(db, 'members', member.id), {
          isFrozen: false,
          freezeStartDate: null,
          totalFrozenDays: (member.totalFrozenDays || 0) + frozenDays,
          expiryDate: newExpiryDate,
          status: 'active'
        });
        toast.success(`Membership unfrozen! Expiry extended by ${frozenDays} day(s) to ${newExpiryDate}.`);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `members/${member.id}`);
    }
  };

  const syncSharedGroupParticipants = async (
    primaryMemberId: string,
    primaryFullName: string,
    pkg: GymPackage,
    startDate: string,
    expiryDate: string,
    assignedCoachId: string,
    assignedCoachName: string,
    currentCycleCheckIns: number,
    groupParticipants: GroupParticipant[]
  ): Promise<string[]> => {
    if (pkg.type !== 'group' || groupParticipants.length === 0 || !user) return [];
    const linkedIds: string[] = [];
    const sharedSubId = `SHARED-GYM-${primaryMemberId}`;

    for (let i = 0; i < groupParticipants.length; i++) {
      const gp = groupParticipants[i];
      const fullName = (gp.name || '').trim();
      if (!fullName) continue;
      const nameParts = fullName.split(/\s+/);
      const firstName = nameParts[0] || 'Family';
      const lastName = nameParts.slice(1).join(' ') || 'Member';
      const gpNormPhone = normalizePhone(gp.phone || '');

      const matchedExisting = members.find(m => {
        if (m.id === primaryMemberId || m.id === 'walk_in' || m.id === 'system_walk_in' || m.isSystemWalkIn) return false;
        if (gpNormPhone && normalizePhone(m.phone) === gpNormPhone) return true;
        return (
          (m.firstName || '').trim().toLowerCase() === firstName.toLowerCase() &&
          (m.lastName || '').trim().toLowerCase() === lastName.toLowerCase()
        );
      });

      const participantId = matchedExisting ? matchedExisting.id : `${primaryMemberId}_fam_${i + 2}`;
      linkedIds.push(participantId);

      const participantSub = stripUndefined({
        id: sharedSubId,
        module: 'gym' as const,
        packageId: pkg.id,
        packageName: `${pkg.name} (Shared w/ ${primaryFullName})`,
        totalSessions: pkg.sessions,
        usedSessions: currentCycleCheckIns,
        remainingSessions: Math.max(0, pkg.sessions - currentCycleCheckIns),
        startDate,
        expiryDate,
        price: 0,
        paidAmount: 0,
        assignedStaffId: assignedCoachId || undefined,
        assignedStaffName: assignedCoachName || undefined,
        status: 'active' as const,
        isSharedGroup: true,
        maxSharedPeople: pkg.maxPeople || 2
      });

      const existingSubs = Array.isArray(matchedExisting?.activeSubscriptions)
        ? matchedExisting!.activeSubscriptions.filter(s => s.id !== sharedSubId)
        : [];

      await setDoc(
        doc(db, 'members', participantId),
        stripUndefined({
          ...(matchedExisting || {}),
          id: participantId,
          firstName: matchedExisting?.firstName || firstName,
          lastName: matchedExisting?.lastName || lastName,
          phone: gp.phone || matchedExisting?.phone || '',
          email: matchedExisting?.email || '',
          dob: matchedExisting?.dob || '',
          gender: matchedExisting?.gender || '',
          nationality: matchedExisting?.nationality || 'Lebanon',
          level: matchedExisting?.level || 'Novice',
          height: matchedExisting?.height || '',
          weight: matchedExisting?.weight || '',
          allergies: matchedExisting?.allergies || '',
          healthProblems: matchedExisting?.healthProblems || '',
          packageId: pkg.id,
          assignedCoachId,
          assignedCoachName,
          primaryGroupMemberId: primaryMemberId,
          sharedSubscriptionId: sharedSubId,
          currentCycleCheckIns,
          startDate,
          expiryDate,
          status: 'active' as const,
          billingStatus: 'paid' as const,
          expectedFee: 0,
          totalPaid: 0,
          qrCode: matchedExisting?.qrCode || `MEMBER:${participantId}`,
          checkIns: matchedExisting?.checkIns || [],
          addons: matchedExisting?.addons || [],
          activeSubscriptions: [...existingSubs, participantSub],
          isGymMember: true,
          memberType: 'full' as const,
          uid: user.uid
        }),
        { merge: true }
      );
    }

    return linkedIds;
  };

  const handleEditMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberForEdit || !user) return;
    
    const pkg = packages.find(p => p.id === selectedMemberForEdit.packageId);
    if (!pkg) return;

    const expiryDate = calculateExpiry(selectedMemberForEdit.startDate || new Date().toISOString().split('T')[0], pkg.duration);
    const assignedCoach = coaches.find(c => c.id === selectedMemberForEdit.assignedCoachId);
    const assignedCoachId = assignedCoach ? assignedCoach.id : '';
    const assignedCoachName = assignedCoach ? `${assignedCoach.firstName} ${assignedCoach.lastName}` : '';
    const computedExpectedFee = getEffectivePackagePrice(pkg, selectedMemberForEdit);
    const cleanedGroupMembers = pkg.type === 'group'
      ? (selectedMemberForEdit.groupMembers || []).filter(gm => gm.name && gm.name.trim() !== '')
      : [];
    
    const qrCode = selectedMemberForEdit.qrCode || `MEMBER:${selectedMemberForEdit.id}`;

    try {
      const linkedGroupIds = await syncSharedGroupParticipants(
        selectedMemberForEdit.id,
        `${selectedMemberForEdit.firstName} ${selectedMemberForEdit.lastName}`,
        pkg,
        selectedMemberForEdit.startDate || new Date().toISOString().split('T')[0],
        expiryDate,
        assignedCoachId,
        assignedCoachName,
        selectedMemberForEdit.currentCycleCheckIns || 0,
        cleanedGroupMembers
      );

      await updateDoc(doc(db, 'members', selectedMemberForEdit.id), stripUndefined({
        ...selectedMemberForEdit,
        assignedCoachId,
        assignedCoachName,
        groupMembers: cleanedGroupMembers,
        sharedGroupMemberIds: linkedGroupIds,
        expectedFee: computedExpectedFee,
        priceOverride: selectedMemberForEdit.priceOverride !== undefined && Number(selectedMemberForEdit.priceOverride) > 0
          ? Number(selectedMemberForEdit.priceOverride)
          : null,
        expiryDate,
        qrCode
      }));
      setIsEditMemberModalOpen(false);
      setSelectedMemberForEdit(null);
      toast.success(
        linkedGroupIds.length > 0
          ? `Member & ${linkedGroupIds.length} shared family/group profile(s) updated!`
          : 'Member updated successfully'
      );
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, `members/${selectedMemberForEdit.id}`);
      toast.error(error.message || 'Failed to update member');
    }
  };

  const handleEditCoach = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCoachForEdit || !user) return;

    const qrCode = selectedCoachForEdit.qrCode || `COACH:${selectedCoachForEdit.id}`;

    try {
      await updateDoc(doc(db, 'coaches', selectedCoachForEdit.id), stripUndefined({ ...selectedCoachForEdit, qrCode }));
      setIsEditCoachModalOpen(false);
      setSelectedCoachForEdit(null);
      toast.success('Coach updated successfully');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, `coaches/${selectedCoachForEdit.id}`);
      toast.error(error.message || 'Failed to update coach');
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMember.firstName || !newMember.lastName || !newMember.packageId || !newMember.startDate || !user) return;
    
    const pkg = packages.find(p => p.id === newMember.packageId);
    if (!pkg) return;

    const expiryDate = calculateExpiry(newMember.startDate!, pkg.duration);
    const normPhone = normalizePhone(newMember.phone);
    const existingMember = members.find(m => {
      if (m.id === 'walk_in' || m.id === 'system_walk_in' || m.isSystemWalkIn || m.packageId === 'walk-in') return false;
      if (normPhone && normalizePhone(m.phone) === normPhone) return true;
      if (!normPhone &&
          (m.firstName || '').trim().toLowerCase() === (newMember.firstName || '').trim().toLowerCase() &&
          (m.lastName || '').trim().toLowerCase() === (newMember.lastName || '').trim().toLowerCase()) {
        return true;
      }
      return false;
    });

    const memberId = existingMember ? existingMember.id : Date.now().toString();
    const qrCode = existingMember?.qrCode || `MEMBER:${memberId}`;
    const assignedCoach = coaches.find(c => c.id === newMember.assignedCoachId);
    const computedExpectedFee = getEffectivePackagePrice(pkg, newMember);
    const cleanedGroupMembers = pkg.type === 'group'
      ? (newMember.groupMembers || []).filter(gm => gm.name && gm.name.trim() !== '')
      : [];

    try {
      const linkedGroupIds = await syncSharedGroupParticipants(
        memberId,
        `${newMember.firstName} ${newMember.lastName}`,
        pkg,
        newMember.startDate!,
        expiryDate,
        assignedCoach ? assignedCoach.id : (existingMember?.assignedCoachId || ''),
        assignedCoach ? `${assignedCoach.firstName} ${assignedCoach.lastName}` : (existingMember?.assignedCoachName || ''),
        0,
        cleanedGroupMembers
      );

      const newGymSub = stripUndefined({
        id: pkg.type === 'group' ? `SHARED-GYM-${memberId}` : `GYM-${Date.now()}`,
        module: 'gym' as const,
        packageId: pkg.id,
        packageName: pkg.name,
        totalSessions: pkg.sessions,
        usedSessions: 0,
        remainingSessions: pkg.sessions,
        startDate: newMember.startDate!,
        expiryDate,
        price: computedExpectedFee,
        paidAmount: 0,
        assignedStaffId: assignedCoach ? assignedCoach.id : undefined,
        assignedStaffName: assignedCoach ? `${assignedCoach.firstName} ${assignedCoach.lastName}` : undefined,
        status: 'active' as const,
        isSharedGroup: pkg.type === 'group',
        maxSharedPeople: pkg.type === 'group' ? (pkg.maxPeople || 2) : 1,
        sharedMemberIds: linkedGroupIds
      });

      const prevSubs = Array.isArray(existingMember?.activeSubscriptions)
        ? existingMember!.activeSubscriptions
        : [];

      const memberData = stripUndefined({
        ...(existingMember || {}),
        firstName: newMember.firstName!,
        lastName: newMember.lastName!,
        dob: newMember.dob || existingMember?.dob || '',
        gender: newMember.gender || existingMember?.gender || '',
        nationality: newMember.nationality || existingMember?.nationality || 'Lebanon',
        level: (newMember.level as any) || existingMember?.level || 'Novice',
        height: newMember.height || existingMember?.height || '',
        weight: newMember.weight || existingMember?.weight || '',
        allergies: newMember.allergies || existingMember?.allergies || '',
        healthProblems: newMember.healthProblems || existingMember?.healthProblems || '',
        phone: newMember.phone || existingMember?.phone || '',
        email: newMember.email || existingMember?.email || '',
        packageId: newMember.packageId!,
        assignedCoachId: assignedCoach ? assignedCoach.id : (existingMember?.assignedCoachId || ''),
        assignedCoachName: assignedCoach ? `${assignedCoach.firstName} ${assignedCoach.lastName}` : (existingMember?.assignedCoachName || ''),
        groupMembers: cleanedGroupMembers,
        sharedGroupMemberIds: linkedGroupIds,
        activeSubscriptions: [...prevSubs, newGymSub],
        discountPercent: Number(newMember.discountPercent) || 0,
        discountAmount: Number(newMember.discountAmount) || 0,
        priceOverride: newMember.priceOverride !== undefined && Number(newMember.priceOverride) > 0 ? Number(newMember.priceOverride) : null,
        currentCycleCheckIns: 0,
        isFrozen: false,
        freezeStartDate: null,
        startDate: newMember.startDate!,
        expiryDate,
        status: 'active' as const,
        billingStatus: 'unpaid' as const,
        addons: newMember.addons || existingMember?.addons || [],
        expectedFee: computedExpectedFee,
        totalPaid: 0,
        qrCode,
        checkIns: existingMember?.checkIns || [],
        isGymMember: true,
        memberType: 'full' as const,
        uid: user.uid
      });

      await setDoc(doc(db, 'members', memberId), memberData, { merge: true });
      setIsMemberModalOpen(false);
      toast.success(
        linkedGroupIds.length > 0
          ? `Member registered & ${linkedGroupIds.length} shared family/group member profile(s) linked!`
          : existingMember
            ? 'Existing Central Member linked to Gym package!'
            : 'Member added successfully'
      );
      setNewMember({
        firstName: '',
        lastName: '',
        dob: '',
        gender: '',
        nationality: 'Lebanon',
        level: 'Novice',
        height: '',
        weight: '',
        allergies: '',
        healthProblems: '',
        phone: '',
        email: '',
        packageId: '',
        assignedCoachId: '',
        assignedCoachName: '',
        groupMembers: [],
        discountPercent: 0,
        discountAmount: 0,
        priceOverride: undefined,
        startDate: new Date().toISOString().split('T')[0],
        addons: []
      });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'members');
      toast.error(error.message || 'Failed to add member');
    }
  };

  const downloadMemberCard = async (member: Member) => {
    setSelectedMemberForCard(member);
    setIsGeneratingPdf(true);
    
    // Small delay to ensure the hidden card is rendered
    setTimeout(async () => {
      if (idCardRef.current) {
        try {
          const canvas = await html2canvas(idCardRef.current, {
            scale: 2,
            backgroundColor: null,
            logging: false,
            useCORS: true
          });
          const imgData = canvas.toDataURL('image/png');
          const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: [85, 54] // Standard ID card size
          });
          
          pdf.addImage(imgData, 'PNG', 0, 0, 85, 54);
          pdf.save(`${member.firstName}_${member.lastName}_ID_Card.pdf`);
        } catch (error) {
          console.error('PDF generation failed', error);
        } finally {
          setIsGeneratingPdf(false);
          setSelectedMemberForCard(null);
        }
      }
    }, 500);
  };

  const toggleMemberStatus = async (id: string) => {
    const member = members.find(m => m.id === id);
    if (!member) return;
    try {
      await updateDoc(doc(db, 'members', id), { status: member.status === 'active' ? 'inactive' : 'active' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `members/${id}`);
    }
  };

  const deleteMember = async (id: string) => {
    if (!user) return;
    
    // Safety Audit: Check for financial impact
    const member = members.find(m => m.id === id);
    if (member && (member.billingStatus === 'paid' || (member.totalPaid || 0) > 0)) {
      toast.error('Cannot delete a member with active financial records. Please unpay/refund the membership first.');
      return;
    }

    console.log('Deleting member:', id);
    if (window.confirm('Are you sure you want to delete this member?')) {
      try {
        await deleteDoc(doc(db, 'members', id));
        console.log('Member deleted successfully');
        toast.success('Member deleted successfully');
      } catch (error) {
        console.error('Error deleting member:', error);
        handleFirestoreError(error, OperationType.DELETE, `members/${id}`);
      }
    }
  };

  const deletePackage = async (id: string) => {
    if (!user) return;
    console.log('Deleting package:', id);
    if (window.confirm('Are you sure you want to delete this package?')) {
      try {
        await deleteDoc(doc(db, 'packages', id));
        console.log('Package deleted successfully');
      } catch (error) {
        console.error('Error deleting package:', error);
        handleFirestoreError(error, OperationType.DELETE, `packages/${id}`);
      }
    }
  };

  const handleUnpayMember = async (id: string) => {
    if (!user) return;
    console.log('Unpaying member:', id);
    
    const reason = window.prompt('Are you sure you want to unpay this member? Please enter a reason for the reversal:');
    if (!reason || reason.trim() === '') return;

    try {
      const q = query(collection(db, 'transactions'), where('referenceId', '==', id), where('transactionType', '==', 'membership_payment'));
      const snap = await getDocs(q);
      
      const memberDoc = await getDocFromServer(doc(db, 'members', id));
      const mData = memberDoc.data();
      const lastPayment = mData?.paymentHistory?.[mData.paymentHistory.length - 1];
      const amountToReverse = lastPayment?.amount || 0;

      if (!snap.empty && amountToReverse > 0) {
        // Collect all valid inflows to reverse exact amounts instead of arbitrary assumptions
        const allInflows = snap.docs.filter(d => !d.data().isReversal && d.data().direction === 'inflow');
        const unreversedInflowIds: string[] = [];

        for (const inflow of allInflows) {
           const revQ = query(collection(db, 'transactions'), where('referenceId', '==', inflow.id), where('isReversal', '==', true));
           const revSnap = await getDocs(revQ);
           if (revSnap.empty) {
             unreversedInflowIds.push(inflow.id);
           }
        }

        if (unreversedInflowIds.length === 0) {
          toast.error('All payments for this member have already been reversed.');
          return;
        }

        await processReversalTransaction({
          originalTransactionIds: unreversedInflowIds,
          transactionType: 'membership_unpay_reversal',
          sourceModule: 'gym',
          cashierId: user.uid,
          reason: reason.trim(),
          memberId: id,
          relatedIds: [id]
        }, async (transaction) => {
          transaction.update(doc(db, 'members', id), { 
            billingStatus: 'unpaid',
            totalPaid: Math.max(0, (mData?.totalPaid || 0) - amountToReverse),
            paymentHistory: mData?.paymentHistory?.slice(0, -1) || [] // remove last payment
          });
        });
        console.log('Member marked as unpaid and transaction reversed');
        toast.success("Membership unpaid & refunded");
        return;
      }

      // Fallback
      await updateDoc(doc(db, 'members', id), { 
        billingStatus: 'unpaid',
        totalPaid: 0,
        paymentHistory: []
      });
      console.log('Member marked as unpaid');
      toast.success("Membership unpaid");
    } catch (error) {
      console.error('Error unpaying member:', error);
      handleFirestoreError(error, OperationType.WRITE, `members/${id}`);
    }
  };

  const handleUnpayCoach = async (contractId: string) => {
    if (!user) return;
    console.log('Unpaying coach contract:', contractId);
    
    const reason = window.prompt('Are you sure you want to mark this contract as unpaid? Please enter a reason for the reversal:');
    if (!reason || reason.trim() === '') return;

    try {
      const contract = coachContracts.find(c => c.id === contractId || c.coachId === contractId);
      if (!contract) return;
      
      const lastPayment = contract?.paymentHistory?.[contract.paymentHistory.length - 1];
      const amountToReverse = lastPayment?.amount || 0;

      if (amountToReverse > 0) {
        const q = query(collection(db, 'transactions'), where('referenceId', '==', contract.id), where('transactionType', '==', 'coach_payment'));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
          const allInflows = snap.docs.filter(d => !d.data().isReversal && d.data().direction === 'inflow');
          const unreversedInflowIds: string[] = [];

          for (const inflow of allInflows) {
             const revQ = query(collection(db, 'transactions'), where('referenceId', '==', inflow.id), where('isReversal', '==', true));
             const revSnap = await getDocs(revQ);
             if (revSnap.empty) {
               unreversedInflowIds.push(inflow.id);
             }
          }

          if (unreversedInflowIds.length === 0) {
            toast.error('All payments for this coach contract have already been reversed.');
            return;
          }

          await processReversalTransaction({
            originalTransactionIds: unreversedInflowIds,
            transactionType: 'coach_unpay_reversal',
            sourceModule: 'gym',
            cashierId: user.uid,
            reason: reason.trim(),
            relatedIds: [contract.id, contract.coachId]
          }, async (transaction) => {
            transaction.update(doc(db, 'coachContracts', contract.id), { 
              billingStatus: 'unpaid',
              paymentHistory: contract?.paymentHistory?.slice(0, -1) || []
            });
          });
          console.log('Coach contract marked as unpaid and transaction reversed');
          toast.success("Coach contract unpaid & refunded");
          return;
        }
      }

      await updateDoc(doc(db, 'coachContracts', contract.id), { 
        billingStatus: 'unpaid',
        paymentHistory: []
      });
      console.log('Coach contract marked as unpaid');
      toast.success("Coach contract unpaid");
    } catch (error) {
      console.error('Error unpaying coach contract:', error);
      handleFirestoreError(error, OperationType.WRITE, `coachContracts/${contractId}`);
    }
  };

  const handleConfirmPayment = async () => {
    if (!selectedMemberForBilling || !user) return;
    
    let packageFullPrice = 0;
    let pkgId = '';
    
    if (selectedMemberForBilling.packageId === 'walk-in') {
      packageFullPrice = selectedMemberForBilling.expectedFee || 0;
      pkgId = 'walk-in';
    } else {
      const pkg = packages.find(p => p.id === selectedMemberForBilling.packageId);
      if (!pkg) return;
      packageFullPrice = selectedMemberForBilling.expectedFee || pkg.price;
      pkgId = pkg.id;
    }

    const alreadyPaid = selectedMemberForBilling.totalPaid || 0;
    const remainingBeforeDiscount = Math.max(0, packageFullPrice - alreadyPaid);

    const appliedCoupon = getAppliedGymCoupon(couponCodeInput);
    if (couponCodeInput.trim() && !appliedCoupon) {
      toast.error('Invalid, expired, or inapplicable Coupon Code.');
      return;
    }

    const afterManualDiscount = remainingBeforeDiscount * (1 - billingDiscount / 100);
    const couponDisc = appliedCoupon
      ? (appliedCoupon.discountType === 'percentage'
          ? afterManualDiscount * ((appliedCoupon.discountValue ?? (appliedCoupon as any).value ?? 0) / 100)
          : (appliedCoupon.discountValue ?? (appliedCoupon as any).value ?? 0))
      : 0;
    const netPayable = Math.max(0, afterManualDiscount - couponDisc);
    const finalAmount = billingPaymentAmount !== '' ? Number(billingPaymentAmount) : netPayable;

    if (isNaN(finalAmount) || finalAmount <= 0) {
      toast.error('Please enter a valid payment amount greater than 0.');
      return;
    }
    if (finalAmount > netPayable + 0.01) {
      toast.error(`Payment amount cannot exceed remaining net balance (${formatCurrency(netPayable)}).`);
      return;
    }

    if (billingPaymentMethod === 'member_balance') {
      if ((selectedMemberForBilling.balance || 0) < finalAmount) {
        toast.error('Insufficient Member Wallet balance.');
        return;
      }
    }

    try {
      let rewardAmount = 0;
      let resolvedCodeId: string | null = null;
      let cashbackCodeString: string | null = null;

      if (cashbackCodeInput.trim()) {
        const q = query(collection(db, 'cashbackCodes'), where('code', '==', cashbackCodeInput.trim().toUpperCase()));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
          const cbDoc = snap.docs[0];
          const cbData = cbDoc.data();
          
          if (!cbData.isActive) throw new Error('This code is inactive.');
          if (cbData.expiryDate && new Date(cbData.expiryDate).getTime() < Date.now()) throw new Error('This code has expired.');
          if (cbData.maxUses > 0 && (cbData.usageCount || 0) >= cbData.maxUses) throw new Error('Usage limit reached.');
          if (cbData.memberId && cbData.memberId !== selectedMemberForBilling.id) throw new Error('This code is for another member.');
          if (cbData.applicableModules && cbData.applicableModules.length > 0 && !cbData.applicableModules.includes('gym')) {
            throw new Error('This code is not applicable to Gym module.');
          }

          resolvedCodeId = cbDoc.id;
          cashbackCodeString = cbData.code;
          if (cbData.cashbackType === 'percentage') {
            rewardAmount = finalAmount * ((cbData.value || 0) / 100);
          } else {
            rewardAmount = cbData.value || 0;
          }
        } else {
          throw new Error('Invalid Cashback Code.');
        }
      }

      const memberRef = doc(db, 'members', selectedMemberForBilling.id);
      const updatedExpectedFee = alreadyPaid + netPayable;
      const isFullSettlement = (alreadyPaid + finalAmount) >= (updatedExpectedFee - 0.01);

      await processLedgerTransaction({
        amount: finalAmount,
        subtotal: remainingBeforeDiscount,
        discount: Math.max(0, remainingBeforeDiscount - netPayable),
        paymentMethod: billingPaymentMethod,
        memberId: selectedMemberForBilling.id,
        sourceModule: 'gym',
        cashierId: user.uid,
        transactionType: 'membership_payment',
        referenceId: selectedMemberForBilling.id,
        couponId: appliedCoupon?.id || null,
        couponCode: appliedCoupon?.code || cashbackCodeString,
        cashbackCodeId: resolvedCodeId,
        rewardAmount,
        notes: `${isFullSettlement ? 'Full' : 'Partial'} membership payment for ${selectedMemberForBilling.firstName} ${selectedMemberForBilling.lastName}${appliedCoupon ? ` (Coupon: ${appliedCoupon.code})` : ''}`
      }, async (transaction, mData) => {
        const currentPaid = mData.totalPaid || 0;
        const nextTotalPaid = currentPaid + finalAmount;
        
        const newPayment = {
          id: Date.now().toString(),
          date: new Date().toISOString(),
          amount: finalAmount,
          packageId: pkgId,
          cashbackCodeId: resolvedCodeId,
          rewardAmount: rewardAmount
        };

        transaction.update(memberRef, {
          billingStatus: nextTotalPaid >= (updatedExpectedFee - 0.01) ? 'paid' : 'unpaid',
          expectedFee: updatedExpectedFee,
          totalPaid: nextTotalPaid,
          paymentHistory: [...(mData.paymentHistory || []), newPayment]
        });
      }, async (transaction) => {
        const memberSnap = await transaction.get(memberRef);
        if (!memberSnap.exists()) throw new Error('Member not found');
        return memberSnap.data();
      });

      toast.success(isFullSettlement ? 'Payment confirmed in full!' : `Partial payment of ${formatCurrency(finalAmount)} recorded! Remaining: ${formatCurrency(Math.max(0, updatedExpectedFee - (alreadyPaid + finalAmount)))}`);
      setIsBillingModalOpen(false);
      setSelectedMemberForBilling(null);
      setBillingDiscount(0);
      setBillingPaymentAmount('');
      setCouponCodeInput('');
      setCashbackCodeInput('');
      setBillingPaymentMethod('cash');
    } catch (error: any) {
      toast.error(error.message || 'Payment failed');
      handleFirestoreError(error, OperationType.WRITE, `members/${selectedMemberForBilling.id}`, user);
    }
  };

  const handleConfirmCoachPayment = async () => {
    if (!selectedCoachForBilling || !user) return;
    
    const contract = coachContracts.find(c => c.coachId === selectedCoachForBilling.id);
    if (!contract) return;

    try {
      await processLedgerTransaction({
        amount: contract.price,
        paymentMethod: 'cash',
        sourceModule: 'gym',
        cashierId: user.uid,
        transactionType: 'coach_payment',
        referenceId: contract.id,
        notes: `Coach package payment`
      }, async (transaction) => {
        const newPayment = {
          id: Date.now().toString(),
          date: new Date().toISOString(),
          amount: contract.price
        };
        transaction.update(doc(db, 'coachContracts', contract.id), { 
          billingStatus: 'paid', 
          paymentHistory: [...(contract.paymentHistory || []), newPayment] 
        });
      });
      toast.success('Coach payment confirmed');
      setIsCoachBillingModalOpen(false);
      setSelectedCoachForBilling(null);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, `coachContracts/${contract.id}`);
      toast.error(error.message || 'Payment failed');
    }
  };

  const handleResetCoachSessions = async (coachId: string) => {
    if (!window.confirm('Reset this coach monthly sessions to zero?')) return;
    try {
      await updateDoc(doc(db, 'coaches', coachId), {
        currentMonthlySessions: 0,
        lastResetDate: new Date().toISOString().slice(0, 7)
      });
      toast.success('Sessions reset successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `coaches/${coachId}`);
    }
  };

  const addCoach = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const coachId = Math.random().toString(36).substr(2, 9);
    const coachData = stripUndefined({
      ...newCoach as Coach,
      qrCode: `COACH:${coachId}`,
      uid: user.uid,
      currentMonthlySessions: 0,
      lastResetDate: new Date().toISOString().slice(0, 7)
    });
    try {
      await setDoc(doc(db, 'coaches', coachId), stripUndefined(coachData));
      setIsCoachModalOpen(false);
      toast.success('Coach added successfully');
      setNewCoach({
        firstName: '',
        lastName: '',
        phoneNumber: '',
        email: '',
        dob: '',
        gender: '',
        yearsOfExperience: 0,
        lastWorkPlace: '',
        specialties: [],
        hourRate: 0,
        type: 'inhouse',
        monthlySessionCapacity: 0,
        currentMonthlySessions: 0,
        photo: '',
        nationality: ''
      });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'coaches');
      toast.error(error.message || 'Failed to add coach');
    }
  };

  const deleteCoach = async (id: string) => {
    if (!user) return;
    
    // Safety Audit: Check for financial impact
    const contract = coachContracts.find(c => c.coachId === id || c.id === id);
    if (contract && contract.billingStatus === 'paid') {
      toast.error('Cannot delete a coach with active financial records. Please mark the contract as unpaid/refunded first.');
      return;
    }

    console.log('Deleting coach:', id);
    if (window.confirm('Are you sure you want to delete this coach?')) {
      try {
        await deleteDoc(doc(db, 'coaches', id));
        if (contract) {
          await deleteDoc(doc(db, 'coachContracts', contract.id));
        }
        console.log('Coach and associated contract deleted successfully');
        toast.success('Coach deleted successfully');
      } catch (error) {
        console.error('Error deleting coach:', error);
        handleFirestoreError(error, OperationType.DELETE, `coaches/${id}`);
      }
    }
  };

  const addCoachPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const pkgId = Date.now().toString();
    const pkgData = stripUndefined({
      ...newCoachPackage as CoachPackage,
      id: pkgId,
      discountPercent: Number(newCoachPackage.discountPercent) || 0,
      discountAmount: Number(newCoachPackage.discountAmount) || 0,
      priceOverride: newCoachPackage.priceOverride !== undefined && Number(newCoachPackage.priceOverride) > 0
        ? Number(newCoachPackage.priceOverride)
        : null,
      uid: user.uid
    });
    try {
      await setDoc(doc(db, 'coachPackages', pkgId), stripUndefined(pkgData));
      setIsCoachPackageModalOpen(false);
      toast.success('Coach package added successfully');
      setNewCoachPackage({ name: '', lengthInWeeks: 4, sessions: 10, cost: 0, discountPercent: 0, discountAmount: 0, priceOverride: undefined });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'coachPackages');
      toast.error(error.message || 'Failed to add coach package');
    }
  };

  const handleUpdateCoachPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCoachPackageForEdit || !user) return;
    try {
      const { id, ...rest } = selectedCoachPackageForEdit;
      await updateDoc(doc(db, 'coachPackages', id), stripUndefined({
        ...rest,
        discountPercent: Number(selectedCoachPackageForEdit.discountPercent) || 0,
        discountAmount: Number(selectedCoachPackageForEdit.discountAmount) || 0,
        priceOverride: selectedCoachPackageForEdit.priceOverride !== undefined && Number(selectedCoachPackageForEdit.priceOverride) > 0
          ? Number(selectedCoachPackageForEdit.priceOverride)
          : null,
      }));
      setIsEditCoachPackageModalOpen(false);
      setSelectedCoachPackageForEdit(null);
      toast.success('Coach package updated successfully');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `coachPackages/${selectedCoachPackageForEdit.id}`);
      toast.error(error.message || 'Failed to update coach package');
    }
  };

  const deleteCoachPackage = async (id: string) => {
    if (!user) return;
    if (!window.confirm('Are you sure you want to delete this Coach Package?')) return;
    try {
      await deleteDoc(doc(db, 'coachPackages', id));
      toast.success('Coach package deleted');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, `coachPackages/${id}`);
    }
  };

  const addCoachContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const contractId = Date.now().toString();
    const contractData = stripUndefined({
      ...newCoachContract as CoachContract,
      id: contractId,
      remainingSessions: newCoachContract.sessions || 0,
      uid: user.uid
    });
    try {
      await setDoc(doc(db, 'coachContracts', contractId), stripUndefined(contractData));
      if (newCoachContract.coachId) {
        await updateDoc(doc(db, 'coaches', newCoachContract.coachId), stripUndefined({
          contractMode: newCoachContract.contractMode || 'package',
          baseFeeOneClient: Number(newCoachContract.baseFeeOneClient) || 0,
          extraClientFee: Number(newCoachContract.extraClientFee) || 0,
          maxClientsPerSession: Number(newCoachContract.maxClientsPerSession) || 5
        }));
      }
      setIsCoachContractModalOpen(false);
      toast.success('Coach contract added successfully');
      setNewCoachContract({
        coachId: '',
        type: 'inhouse',
        contractMode: 'package',
        packageId: '',
        price: 0,
        discountPercent: 0,
        discountAmount: 0,
        priceOverride: undefined,
        sessions: 0,
        baseFeeOneClient: 10,
        extraClientFee: 5,
        maxClientsPerSession: 5,
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'coachContracts');
      toast.error(error.message || 'Failed to add coach contract');
    }
  };

  const updateCoachContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCoachContract || !user) return;
    try {
      await updateDoc(doc(db, 'coachContracts', selectedCoachContract.id), stripUndefined({ ...selectedCoachContract }));
      if (selectedCoachContract.coachId) {
        await updateDoc(doc(db, 'coaches', selectedCoachContract.coachId), stripUndefined({
          contractMode: selectedCoachContract.contractMode || 'package',
          baseFeeOneClient: Number(selectedCoachContract.baseFeeOneClient) || 0,
          extraClientFee: Number(selectedCoachContract.extraClientFee) || 0,
          maxClientsPerSession: Number(selectedCoachContract.maxClientsPerSession) || 5
        }));
      }
      setIsEditCoachContractModalOpen(false);
      setSelectedCoachContract(null);
      toast.success('Coach contract updated successfully');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, `coachContracts/${selectedCoachContract.id}`);
      toast.error(error.message || 'Failed to update coach contract');
    }
  };

  const handleSaveThirdPartyContract = async (contractData: Omit<ThirdPartyGymContract, 'id'>, existingId?: string) => {
    if (!user) return;
    const id = existingId || `TP-${Date.now()}`;
    await setDoc(doc(db, 'gym_third_party_contracts', id), stripUndefined({ ...contractData, id, uid: user.uid }), { merge: true });
  };

  const handleDeleteThirdPartyContract = async (id: string) => {
    if (!user) return;
    if (!window.confirm('Delete this 3rd-Party B2B Contract?')) return;
    await deleteDoc(doc(db, 'gym_third_party_contracts', id));
    toast.success('3rd-Party B2B Contract deleted');
  };

  const handleUpdateCoachFields = async (coachId: string, updates: Partial<Coach>) => {
    await updateDoc(doc(db, 'coaches', coachId), stripUndefined(updates) as any);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'cvFile' | 'idFiles' | 'crcFile', isEdit = false) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (field === 'idFiles') {
      const filePromises = Array.from(files).map((file: File) => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      });
      Promise.all(filePromises).then(results => {
        if (isEdit) {
          setSelectedCoachForEdit(prev => prev ? { ...prev, idFiles: [...(prev.idFiles || []), ...results] } : null);
        } else {
          setNewCoach(prev => ({ ...prev, idFiles: [...(prev.idFiles || []), ...results] }));
        }
      });
    } else {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (isEdit) {
          setSelectedCoachForEdit(prev => prev ? { ...prev, [field]: reader.result as string } : null);
        } else {
          setNewCoach(prev => ({ ...prev, [field]: reader.result as string }));
        }
      };
      reader.readAsDataURL(files[0]);
    }
  };

  const filteredMembers = members.filter(m => 
    m.id !== 'free_lance_member' && (
    m.firstName.toLowerCase().includes(searchQuery.toLowerCase()) || 
    m.lastName.toLowerCase().includes(searchQuery.toLowerCase()) || 
    m.phone.includes(searchQuery)
    )
  );

  const filteredCoaches = coaches.filter(c =>
    `${c.firstName} ${c.lastName}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`min-h-screen transition-colors ${theme === 'dark' ? 'dark bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans`}>
      {/* Header */}
      <header className={`px-6 py-3 border-b backdrop-blur-xl sticky top-0 z-40 transition-colors ${
        theme === 'dark' ? 'bg-[#0B0F17]/95 border-zinc-800/80' : 'bg-white/95 border-slate-200/80'
      }`}>
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Left: Clickable Vescio Nexus Brand Lockup */}
          <div className="flex items-center shrink-0">
            <TenantBrandLockup
              systemName={systemName}
              systemLogo={systemLogo}
              size="sm"
              subtitle="Gym Management"
            />
          </div>

          {/* Center: Compact Segmented Navigation Tabs */}
          <div className="el-segmented overflow-x-auto max-w-full">
            <button 
              onClick={() => setActiveTab('members')}
              className={`h-9 px-3 text-xs font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5 transition-all ${activeTab === 'members' ? 'el-segmented-item-active' : 'el-segmented-item'}`}
            >
              <Users size={14} /> Members
            </button>
            <button 
              onClick={() => setActiveTab('schedule')}
              className={`h-9 px-3 text-xs font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5 transition-all ${activeTab === 'schedule' ? 'el-segmented-item-active' : 'el-segmented-item'}`}
            >
              <Calendar size={14} /> Schedule
            </button>
            <button 
              onClick={() => setActiveTab('coaches')}
              className={`h-9 px-3 text-xs font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5 transition-all ${activeTab === 'coaches' ? 'el-segmented-item-active' : 'el-segmented-item'}`}
            >
              <Users size={14} /> Coaches
            </button>
            <button 
              onClick={() => setActiveTab('packages')}
              className={`h-9 px-3 text-xs font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5 transition-all ${activeTab === 'packages' ? 'el-segmented-item-active' : 'el-segmented-item'}`}
            >
              <Package size={14} /> Packages
            </button>
            <button 
              onClick={() => setActiveTab('partners')}
              className={`h-9 px-3 text-xs font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5 transition-all ${activeTab === 'partners' ? 'el-segmented-item-active' : 'el-segmented-item'}`}
            >
              <Building2 size={14} /> 3rd-Party B2B
            </button>
            <button 
              onClick={() => setActiveTab('qr-codes')}
              className={`h-9 px-3 text-xs font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5 transition-all ${activeTab === 'qr-codes' ? 'el-segmented-item-active' : 'el-segmented-item'}`}
            >
              <QrCode size={14} /> QR Codes
            </button>
          </div>

          {/* Right: Action Buttons & Utility Controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button 
              onClick={() => setIsCheckInModalOpen(true)}
              className="el-btn-secondary h-9 px-3.5 text-xs font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5"
            >
              <Calendar size={14} /> Check In
            </button>
            <button 
              onClick={() => {
                if (activeTab === 'members') setIsMemberModalOpen(true);
                else if (activeTab === 'packages') setIsPackageModalOpen(true);
                else if (activeTab === 'coaches') setIsCoachModalOpen(true);
                else if (activeTab === 'schedule') setIsCheckInModalOpen(true);
                else setIsMemberModalOpen(true);
              }}
              className="el-btn-primary h-9 px-3.5 text-xs font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5"
            >
              <Plus size={14} /> {
                activeTab === 'members' ? 'Add Member' : 
                activeTab === 'packages' ? 'New Package' : 
                activeTab === 'coaches' ? 'Add Coach' : 'Add Member'
              }
            </button>
            <div className={`w-px h-6 mx-0.5 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-slate-200'}`} />
            <NotificationCenter isDarkMode={isDarkMode} />
            <button 
              onClick={toggleDarkMode}
              className={`h-9 w-9 flex items-center justify-center rounded-lg border transition-all ${
                theme === 'dark' ? 'bg-[#101622] border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-cyan-500/40' : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button 
              onClick={logout}
              className={`h-9 w-9 flex items-center justify-center rounded-lg border transition-all ${
                theme === 'dark' ? 'bg-[#101622] border-zinc-800 text-zinc-400 hover:text-rose-400 hover:border-rose-500/40' : 'bg-slate-100 border-slate-200 text-slate-500 hover:text-rose-500'
              }`}
              title="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      <main className="p-8">
        {activeTab === 'members' ? (
          <div className="space-y-6">
            {/* Search & Stats */}
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                <input 
                  type="text" 
                  placeholder="Search members by name or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="el-input !pl-10"
                />
              </div>
              <div className="flex gap-4">
                <div className={`px-4 py-2 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                  <span className="text-[10px] text-zinc-400 uppercase font-bold block">Total Members</span>
                  <span className="text-xl font-bold">{members.length}</span>
                </div>
                <div className={`px-4 py-2 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                  <span className="text-[10px] text-zinc-400 uppercase font-bold block">Active Now</span>
                  <span className="text-xl font-bold text-green-500">
                    {members.filter(m => {
                      const s = getStatus(m.expiryDate, m.status, m.packageId, m.isFrozen);
                      return s === 'active' || s === 'expire soon';
                    }).length}
                  </span>
                </div>
                <div className={`px-4 py-2 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                  <span className="text-[10px] text-zinc-400 uppercase font-bold block">Inactive / Frozen</span>
                  <span className="text-xl font-bold text-red-500">
                    {members.filter(m => {
                      const s = getStatus(m.expiryDate, m.status, m.packageId, m.isFrozen);
                      return s === 'inactive' || s === 'expired' || s === 'frozen';
                    }).length}
                  </span>
                </div>
              </div>
            </div>

            {/* Members Table */}
            <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-zinc-950/50' : 'border-zinc-200 bg-white'}`}>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`border-b ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-100 bg-zinc-50'}`}>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Member</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400 text-center">Level</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400 text-center">Package</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400 text-center">Status</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Amount</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Billing</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Expiry</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filteredMembers.map(member => {
                    const pkg = packages.find(p => p.id === member.packageId);
                    const status = getStatus(member.expiryDate, member.status, member.packageId, member.isFrozen);
                    return (
                      <MemberRow
                        key={member.id}
                        member={member}
                        pkg={pkg}
                        status={status}
                        theme={theme}
                        onEdit={(m) => {
                          setSelectedMemberForEdit(m);
                          setIsEditMemberModalOpen(true);
                        }}
                        onBilling={(m) => {
                          setSelectedMemberForBilling(m);
                          setIsBillingModalOpen(true);
                          setBillingDiscount(0);
                          setBillingPaymentAmount('');
                        }}
                        onUnpay={handleUnpayMember}
                        onDownloadCard={downloadMemberCard}
                        onToggleStatus={toggleMemberStatus}
                        onToggleFreeze={handleToggleFreezeMember}
                        onDelete={deleteMember}
                        onRenew={handleRenewMembership}
                        onViewDetails={(m) => {
                          setSelectedMemberForDetails(m);
                          setIsMemberDetailsModalOpen(true);
                        }}
                      />
                    );
                  })}
                  {filteredMembers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-zinc-400 text-sm">
                        No members found. Add your first member to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'schedule' ? (
          <GymSessionCalendarTab
            scheduledSessions={scheduledSessions}
            coaches={coaches}
            coachContracts={coachContracts}
            members={members}
            packages={packages}
            thirdPartyContracts={thirdPartyContracts}
            theme={theme}
            formatCurrency={formatCurrency}
            userUid={user?.uid}
            onExecuteMultiClientCheckIn={executeMultiClientCheckIn}
          />
        ) : activeTab === 'partners' ? (
          <ThirdPartyContractsTab
            contracts={thirdPartyContracts}
            coaches={coaches}
            members={members}
            systemName={systemName}
            userUid={user?.uid}
            onSaveContract={handleSaveThirdPartyContract}
            onDeleteContract={handleDeleteThirdPartyContract}
            onUpdateCoach={handleUpdateCoachFields}
          />
        ) : activeTab === 'coaches' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                <input 
                  type="text" 
                  placeholder="Search coaches by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="el-input !pl-10"
                />
              </div>
              <div className="flex gap-3 items-center">
                <button 
                  onClick={() => setIsCoachPackageModalOpen(true)}
                  className="px-3.5 py-2 bg-[#101622] border border-slate-700 text-white rounded-xl hover:border-[#00B8C8]/50 transition-all text-xs font-bold"
                >
                  + Coach Package
                </button>
                <button 
                  onClick={() => setIsCoachContractModalOpen(true)}
                  className="px-3.5 py-2 bg-[#00B8C8] text-[#05070A] rounded-xl hover:bg-[#00B8C8]/90 transition-all text-xs font-bold"
                >
                  + New Coach Contract
                </button>
                <div className={`px-4 py-2 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                  <span className="text-[10px] text-zinc-400 uppercase font-bold block">Total Coaches</span>
                  <span className="text-xl font-bold">{coaches.length}</span>
                </div>
                <div className={`px-4 py-2 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                  <span className="text-[10px] text-zinc-400 uppercase font-bold block">In House</span>
                  <span className="text-xl font-bold text-[#00B8C8]">{coaches.filter(c => c.type === 'inhouse').length}</span>
                </div>
              </div>
            </div>

            <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-white'}`}>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`border-b ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-100 bg-zinc-50'}`}>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Coach</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Type & Contract Mode</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Package / Tiered Pricing</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Sessions</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Start Date</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Status</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Financials</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Billing</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filteredCoaches.map(coach => {
                    const contract = coachContracts.find(c => c.coachId === coach.id);
                    const pkg = contract && coachPackages.find(p => p.id === contract.packageId);
                    
                    let sessionsMade = 0;
                    let maxSessions = 0;

                    if (coach.type === 'inhouse') {
                      sessionsMade = coach.currentMonthlySessions || 0;
                      maxSessions = coach.monthlySessionCapacity || 0;
                    } else {
                      sessionsMade = contract ? (contract.sessions - (contract.remainingSessions ?? contract.sessions)) : (coach.sessionLedger?.length || 0);
                      maxSessions = contract?.sessions || 0;
                    }

                    const status = coach.type === 'inhouse' || coach.contractMode === 'session_bypass' || coach.contractMode === 'third_party'
                      ? 'active'
                      : (contract ? (new Date() >= new Date(contract.startDate) && new Date() <= new Date(contract.endDate) ? 'active' : 'inactive') : 'active');
                    
                    return (
                      <CoachRow
                        key={coach.id}
                        coach={coach}
                        contract={contract}
                        pkg={pkg}
                        sessionsMade={sessionsMade}
                        maxSessions={maxSessions}
                        status={status}
                        theme={theme}
                        onEdit={(c) => {
                          setSelectedCoachForEdit(c);
                          setIsEditCoachModalOpen(true);
                        }}
                        onBilling={(c) => {
                          setSelectedCoachForBilling(c);
                          setIsCoachBillingModalOpen(true);
                        }}
                        onUnpay={handleUnpayCoach}
                        onDelete={deleteCoach}
                        onEditContract={(c) => {
                          setSelectedCoachContract(c);
                          setIsEditCoachContractModalOpen(true);
                        }}
                        onViewDetails={(c) => {
                          setSelectedCoachForDetails(c);
                          setIsCoachDetailsModalOpen(true);
                        }}
                        onResetSessions={() => handleResetCoachSessions(coach.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'qr-codes' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                <input 
                  type="text" 
                  placeholder="Search members or coaches for QR codes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full pl-10 pr-4 py-2 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 focus:ring-red-500/50' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-red-500/30'
                  }`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {[
                ...members.map(m => ({ ...m, role: 'member' })),
                ...coaches.map(c => ({
                  ...c,
                  id: c.id,
                  firstName: c.firstName,
                  lastName: c.lastName,
                  phone: c.phoneNumber,
                  dob: c.dob || '',
                  qrCode: c.qrCode,
                  role: 'coach',
                  startDate: '',
                  packageId: ''
                } as unknown as Member))
              ].filter(p => p.id !== 'free_lance_member' && (p.firstName.toLowerCase().includes(searchQuery.toLowerCase()) || p.lastName.toLowerCase().includes(searchQuery.toLowerCase()))).map(person => (
                <QRCard
                  key={`qr-${person.id}`}
                  member={person}
                  theme={theme}
                  onDownloadCard={downloadMemberCard}
                />
              ))}
              {[
                ...members,
                ...coaches.map(c => ({ firstName: c.firstName, lastName: c.lastName, id: c.id }))
              ].filter(p => p.id !== 'free_lance_member' && (p.firstName.toLowerCase().includes(searchQuery.toLowerCase()) || p.lastName.toLowerCase().includes(searchQuery.toLowerCase()))).length === 0 && (
                <div className="col-span-full py-12 text-center text-zinc-400 text-sm">
                  No records found matching your search.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            {/* Section 1: Client Membership Packages */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold tracking-tight">Client Membership Packages (Solo & Group)</h2>
                  <p className="text-xs text-zinc-400">Packages available for Gym Members, including Solo and Multi-Person Group rosters</p>
                </div>
                <button
                  onClick={() => setIsPackageModalOpen(true)}
                  className="px-4 py-2 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs flex items-center gap-1.5"
                >
                  <Plus size={14} /> New Client Package
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {packages.map(pkg => (
                  <PackageCard
                    key={pkg.id}
                    pkg={pkg}
                    theme={theme}
                    onDelete={deletePackage}
                    onEdit={(p) => {
                      setSelectedPackageForEdit(p);
                      setIsEditPackageModalOpen(true);
                    }}
                    isDiscountValid={isDiscountValid}
                  />
                ))}
              </div>
            </div>

            {/* Section 2: Coach / Trainer B2B Packages (Point 4 & Point 6) */}
            <div className="space-y-4 pt-6 border-t border-zinc-800/80">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-[#00B8C8]">Coach & Freelance Trainer Packages</h2>
                  <p className="text-xs text-zinc-400">Packages assignable to Freelance or Partner Coaches (or bypassable via Per-Session Tiered Contracts)</p>
                </div>
                <button
                  onClick={() => setIsCoachPackageModalOpen(true)}
                  className="px-4 py-2 rounded-xl bg-[#101622] border border-[#00B8C8]/40 text-[#00B8C8] hover:bg-[#00B8C8] hover:text-[#05070A] font-bold text-xs flex items-center gap-1.5 transition-all"
                >
                  <Plus size={14} /> New Coach Package
                </button>
              </div>

              {coachPackages.length === 0 ? (
                <div className={`p-8 rounded-2xl border text-center ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-zinc-200'}`}>
                  <p className="text-sm font-semibold mb-1">No Coach Packages Created Yet</p>
                  <p className="text-xs text-zinc-400 mb-4">Create a Coach Package to bundle trainer sessions or use Direct Per-Session Tiered Pricing on Coach Contracts.</p>
                  <button
                    onClick={() => setIsCoachPackageModalOpen(true)}
                    className="px-4 py-2 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs inline-flex items-center gap-1.5"
                  >
                    <Plus size={14} /> Create Coach Package
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {coachPackages.map(cpkg => {
                    const effectiveCost =
                      cpkg.priceOverride !== undefined && cpkg.priceOverride !== null && cpkg.priceOverride > 0
                        ? cpkg.priceOverride
                        : Math.max(
                            0,
                            cpkg.cost * (1 - (cpkg.discountPercent || 0) / 100) - (cpkg.discountAmount || 0)
                          );
                    return (
                      <div
                        key={cpkg.id}
                        className={`p-6 rounded-2xl border flex flex-col justify-between transition-all ${
                          theme === 'dark'
                            ? 'bg-[#0B0F17] border-zinc-800 hover:border-[#00B8C8]/50'
                            : 'bg-white border-zinc-200 hover:border-[#00B8C8]'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/30">
                                Coach Package
                              </span>
                              <h3 className="text-lg font-bold mt-1.5">{cpkg.name}</h3>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setSelectedCoachPackageForEdit(cpkg);
                                  setIsEditCoachPackageModalOpen(true);
                                }}
                                className="p-2 rounded-lg text-zinc-400 hover:text-[#00B8C8] hover:bg-[#00B8C8]/10 transition-colors"
                                title="Edit Coach Package"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => deleteCoachPackage(cpkg.id)}
                                className="p-2 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                                title="Delete Coach Package"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 my-4">
                            <div className={`p-3 rounded-xl border ${theme === 'dark' ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                              <span className="text-[10px] uppercase text-zinc-400 font-bold block">Duration</span>
                              <span className="text-sm font-bold">{cpkg.lengthInWeeks} Weeks</span>
                            </div>
                            <div className={`p-3 rounded-xl border ${theme === 'dark' ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                              <span className="text-[10px] uppercase text-zinc-400 font-bold block">Allowed Sessions</span>
                              <span className="text-sm font-bold text-[#00B8C8]">{cpkg.sessions} Sessions</span>
                            </div>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-zinc-800/60 flex items-end justify-between">
                          <div>
                            <span className="text-[10px] uppercase text-zinc-400 font-bold block">Package Fee</span>
                            <div className="flex items-baseline gap-2">
                              <span className="text-2xl font-black text-[#00B8C8] tabular-nums">
                                {formatCurrency(effectiveCost)}
                              </span>
                              {effectiveCost !== cpkg.cost && (
                                <span className="text-xs line-through text-zinc-500 tabular-nums">
                                  {formatCurrency(cpkg.cost)}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setNewCoachContract(prev => ({
                                ...prev,
                                type: 'freelance',
                                contractMode: 'package',
                                packageId: cpkg.id,
                                price: effectiveCost,
                                sessions: cpkg.sessions,
                                remainingSessions: cpkg.sessions
                              }));
                              setIsCoachContractModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-[#00B8C8]/15 text-[#00B8C8] hover:bg-[#00B8C8] hover:text-[#05070A] font-bold text-xs transition-all"
                          >
                            Assign to Coach
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {/* Coach Modal */}
      <Coach360Modal
        isOpen={isCoachDetailsModalOpen}
        onClose={() => setIsCoachDetailsModalOpen(false)}
        coach={selectedCoachForDetails ? (coaches.find(c => c.id === selectedCoachForDetails.id) || selectedCoachForDetails) : null}
        members={members}
        coachContracts={coachContracts}
        coachPackages={coachPackages}
        thirdPartyContracts={thirdPartyContracts}
        theme={theme}
        formatCurrency={formatCurrency}
        userUid={user?.uid || 'system'}
        systemName={systemName}
        onUpdateCoach={handleUpdateCoachFields}
        onResetMonthlyCapacity={handleResetCoachSessions}
        onAssignContract={(c) => {
          setIsCoachDetailsModalOpen(false);
          setNewCoachContract({
            ...newCoachContract,
            coachId: c.id,
            type: c.type,
            contractMode: c.contractMode || 'package',
            baseFeeOneClient: c.baseFeeOneClient ?? 10,
            extraClientFee: c.extraClientFee ?? 5,
            maxClientsPerSession: c.maxClientsPerSession ?? 5
          });
          setIsCoachContractModalOpen(true);
        }}
        onEditCoach={(c) => {
          setIsCoachDetailsModalOpen(false);
          setSelectedCoachForEdit(c);
          setIsEditCoachModalOpen(true);
        }}
      />

      <Modal isOpen={isEditCoachModalOpen} onClose={() => setIsEditCoachModalOpen(false)} title="Edit Coach Profile" theme={theme} maxWidth="max-w-xl">
        {selectedCoachForEdit && (
          <form onSubmit={handleEditCoach} className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-800 border border-zinc-700">
              <div>
                <h4 className="text-sm font-bold">Coach Type</h4>
                <p className="text-xs text-zinc-400">Is this coach In House or Freelance?</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedCoachForEdit({...selectedCoachForEdit, type: 'inhouse'})}
                  className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${selectedCoachForEdit.type === 'inhouse' ? 'bg-red-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}
                >
                  In House
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCoachForEdit({...selectedCoachForEdit, type: 'freelance'})}
                  className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${selectedCoachForEdit.type === 'freelance' ? 'bg-red-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}
                >
                  Freelance
                </button>
              </div>
            </div>

            <div className={`p-4 rounded-xl border space-y-3 ${theme === 'dark' ? 'bg-zinc-800/80 border-zinc-700' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#00B8C8]">Contract & Billing Mode</h4>
                  <p className="text-[11px] text-zinc-400">Package-based, Per-Session Tiered (Package Bypass), or 3rd-Party B2B</p>
                </div>
                <select
                  value={selectedCoachForEdit.contractMode || 'package'}
                  onChange={e => setSelectedCoachForEdit({ ...selectedCoachForEdit, contractMode: e.target.value as any })}
                  className={`p-2 rounded-lg border text-xs font-bold ${
                    theme === 'dark'
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="package">Coach Package</option>
                  <option value="session_bypass">Direct Per-Session Tiered (Bypass Package)</option>
                  <option value="third_party">3rd-Party B2B Partner</option>
                </select>
              </div>
              <div className={`grid grid-cols-3 gap-3 pt-2 border-t ${theme === 'dark' ? 'border-zinc-700/60' : 'border-slate-200'}`}>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">1st Client Fee ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={selectedCoachForEdit.baseFeeOneClient ?? 10}
                    onChange={e => setSelectedCoachForEdit({ ...selectedCoachForEdit, baseFeeOneClient: parseFloat(e.target.value) || 0 })}
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">+ Extra Client Fee ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={selectedCoachForEdit.extraClientFee ?? 5}
                    onChange={e => setSelectedCoachForEdit({ ...selectedCoachForEdit, extraClientFee: parseFloat(e.target.value) || 0 })}
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Max Clients / Session</label>
                  <input
                    type="number"
                    min="1"
                    max="25"
                    value={selectedCoachForEdit.maxClientsPerSession ?? 5}
                    onChange={e => setSelectedCoachForEdit({ ...selectedCoachForEdit, maxClientsPerSession: parseInt(e.target.value) || 5 })}
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">First Name</label>
                <input 
                  type="text" 
                  required
                  value={selectedCoachForEdit.firstName}
                  onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, firstName: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Last Name</label>
                <input 
                  type="text" 
                  required
                  value={selectedCoachForEdit.lastName}
                  onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, lastName: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Nationality</label>
                <select 
                  required
                  value={selectedCoachForEdit.nationality}
                  onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, nationality: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                  }`}
                >
                  <option value="">Select Nationality</option>
                  {COUNTRIES.map(c => (
                    <option key={c.name} value={c.name}>{c.flag} {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Photo</label>
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        setSelectedCoachForEdit({...selectedCoachForEdit, photo: reader.result as string});
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-300 focus:ring-red-500/50' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-red-500/30'
                  }`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Phone Number</label>
                <input 
                  type="tel" 
                  required
                  value={selectedCoachForEdit.phoneNumber}
                  onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, phoneNumber: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Email</label>
                <input 
                  type="email" 
                  required
                  value={selectedCoachForEdit.email}
                  onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, email: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Date of Birth</label>
                <input 
                  type="date" 
                  required
                  value={selectedCoachForEdit.dob}
                  onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, dob: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Gender</label>
                <select 
                  required
                  value={selectedCoachForEdit.gender}
                  onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, gender: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                  }`}
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Years of Experience</label>
                <input 
                  type="number" 
                  min="0"
                  required
                  value={selectedCoachForEdit.yearsOfExperience || 0}
                  onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, yearsOfExperience: parseInt(e.target.value) || 0})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Monthly Session Capacity</label>
                <input 
                  type="number" 
                  min="0"
                  required={selectedCoachForEdit.type === 'inhouse'}
                  disabled={selectedCoachForEdit.type !== 'inhouse'}
                  value={selectedCoachForEdit.monthlySessionCapacity || 0}
                  onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, monthlySessionCapacity: parseInt(e.target.value) || 0})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all disabled:opacity-30 ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Last Work Place</label>
              <input 
                type="text" 
                required
                value={selectedCoachForEdit.lastWorkPlace}
                onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, lastWorkPlace: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Specialties</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {selectedCoachForEdit.specialties?.map((s, i) => (
                  <span key={i} className="px-2 py-1 bg-red-500/10 text-red-500 text-xs rounded-lg flex items-center gap-1">
                    {s}
                    <button type="button" onClick={() => setSelectedCoachForEdit({...selectedCoachForEdit, specialties: selectedCoachForEdit.specialties?.filter((_, idx) => idx !== i)})}>
                      <XCircle size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={specialtyInput}
                  onChange={e => setSpecialtyInput(e.target.value)}
                  placeholder="Add specialty (e.g. Yoga, Crossfit)"
                  className={`flex-1 p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                  onKeyPress={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (specialtyInput.trim()) {
                        setSelectedCoachForEdit({...selectedCoachForEdit, specialties: [...(selectedCoachForEdit.specialties || []), specialtyInput.trim()]});
                        setSpecialtyInput('');
                      }
                    }
                  }}
                />
                <button 
                  type="button"
                  onClick={() => {
                    if (specialtyInput.trim()) {
                      setSelectedCoachForEdit({...selectedCoachForEdit, specialties: [...(selectedCoachForEdit.specialties || []), specialtyInput.trim()]});
                      setSpecialtyInput('');
                    }
                  }}
                  className="px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-all"
                >
                  Add
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Hourly Rate ($)</label>
              <input 
                type="number" 
                min="0"
                required
                value={selectedCoachForEdit.hourRate || 0}
                onChange={e => setSelectedCoachForEdit({...selectedCoachForEdit, hourRate: parseInt(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Documents</h4>
              
              <div className="grid grid-cols-1 gap-4">
                <div className={`p-4 rounded-xl border border-dashed ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-2">CV (Word or PDF)</label>
                  <input 
                    type="file" 
                    accept=".doc,.docx,.pdf"
                    onChange={e => handleFileUpload(e, 'cvFile', true)}
                    className="w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700 cursor-pointer"
                  />
                  {selectedCoachForEdit.cvFile && <p className="text-[10px] text-green-500 mt-2 flex items-center gap-1"><CheckCircle2 size={10} /> CV Uploaded</p>}
                </div>

                <div className={`p-4 rounded-xl border border-dashed ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-2">ID (JPG or PDF - Front & Back)</label>
                  <input 
                    type="file" 
                    multiple
                    accept=".jpg,.jpeg,.pdf"
                    onChange={e => handleFileUpload(e, 'idFiles', true)}
                    className="w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700 cursor-pointer"
                  />
                  {selectedCoachForEdit.idFiles && selectedCoachForEdit.idFiles.length > 0 && (
                    <p className="text-[10px] text-green-500 mt-2 flex items-center gap-1">
                      <CheckCircle2 size={10} /> {selectedCoachForEdit.idFiles.length} ID File(s) Uploaded
                    </p>
                  )}
                </div>

                <div className={`p-4 rounded-xl border border-dashed ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-2">Criminal Record Check (PDF)</label>
                  <input 
                    type="file" 
                    accept=".pdf"
                    onChange={e => handleFileUpload(e, 'crcFile', true)}
                    className="w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700 cursor-pointer"
                  />
                  {selectedCoachForEdit.crcFile && <p className="text-[10px] text-green-500 mt-2 flex items-center gap-1"><CheckCircle2 size={10} /> CRC Uploaded</p>}
                </div>
              </div>
            </div>

            <button 
              type="submit"
              className="el-btn-primary w-full py-3"
            >
              Save Changes
            </button>
          </form>
        )}
      </Modal>

      <Modal isOpen={isCoachModalOpen} onClose={() => setIsCoachModalOpen(false)} title="Add New Coach" theme={theme} maxWidth="max-w-xl">
        <form onSubmit={addCoach} className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-800 border border-zinc-700">
            <div>
              <h4 className="text-sm font-bold">Coach Type</h4>
              <p className="text-xs text-zinc-400">Is this coach In House or Freelance?</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNewCoach({...newCoach, type: 'inhouse'})}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${newCoach.type === 'inhouse' ? 'bg-red-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}
              >
                In House
              </button>
              <button
                type="button"
                onClick={() => setNewCoach({...newCoach, type: 'freelance'})}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${newCoach.type === 'freelance' ? 'bg-red-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}
              >
                Freelance
              </button>
            </div>
          </div>

          <div className={`p-4 rounded-xl border space-y-3 ${theme === 'dark' ? 'bg-zinc-800/80 border-zinc-700' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#00B8C8]">Contract & Billing Mode</h4>
                <p className="text-[11px] text-zinc-400">Package-based, Per-Session Tiered (Bypass), or 3rd-Party B2B</p>
              </div>
              <select
                value={newCoach.contractMode || 'package'}
                onChange={e => setNewCoach({ ...newCoach, contractMode: e.target.value as any })}
                className={`p-2 rounded-lg border text-xs font-bold ${
                  theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                    : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                }`}
              >
                <option value="package">Coach Package</option>
                <option value="session_bypass">Direct Per-Session Tiered (Bypass Package)</option>
                <option value="third_party">3rd-Party B2B Partner</option>
              </select>
            </div>
            <div className={`grid grid-cols-3 gap-3 pt-2 border-t ${theme === 'dark' ? 'border-zinc-700/60' : 'border-slate-200'}`}>
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">1st Client Fee ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={newCoach.baseFeeOneClient ?? 10}
                  onChange={e => setNewCoach({ ...newCoach, baseFeeOneClient: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2 rounded-lg border text-xs font-mono ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                  }`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">+ Extra Client Fee ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={newCoach.extraClientFee ?? 5}
                  onChange={e => setNewCoach({ ...newCoach, extraClientFee: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2 rounded-lg border text-xs font-mono ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                  }`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Max Clients / Session</label>
                <input
                  type="number"
                  min="1"
                  max="25"
                  value={newCoach.maxClientsPerSession ?? 5}
                  onChange={e => setNewCoach({ ...newCoach, maxClientsPerSession: parseInt(e.target.value) || 5 })}
                  className={`w-full p-2 rounded-lg border text-xs font-mono ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                  }`}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">First Name</label>
              <input 
                type="text" 
                required
                value={newCoach.firstName}
                onChange={e => setNewCoach({...newCoach, firstName: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Last Name</label>
              <input 
                type="text" 
                required
                value={newCoach.lastName}
                onChange={e => setNewCoach({...newCoach, lastName: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Nationality</label>
              <select 
                required
                value={newCoach.nationality}
                onChange={e => setNewCoach({...newCoach, nationality: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                }`}
              >
                <option value="">Select Nationality</option>
                {COUNTRIES.map(c => (
                  <option key={c.name} value={c.name}>{c.flag} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Photo</label>
              <input 
                type="file" 
                accept="image/*"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setNewCoach({...newCoach, photo: reader.result as string});
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-300 focus:ring-red-500/50' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-red-500/30'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Phone Number</label>
              <input 
                type="tel" 
                required
                value={newCoach.phoneNumber}
                onChange={e => setNewCoach({...newCoach, phoneNumber: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Email</label>
              <input 
                type="email" 
                required
                value={newCoach.email}
                onChange={e => setNewCoach({...newCoach, email: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Date of Birth</label>
              <input 
                type="date" 
                required
                value={newCoach.dob}
                onChange={e => setNewCoach({...newCoach, dob: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Gender</label>
              <select 
                required
                value={newCoach.gender}
                onChange={e => setNewCoach({...newCoach, gender: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                }`}
              >
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Years of Experience</label>
              <input 
                type="number" 
                min="0"
                required
                value={newCoach.yearsOfExperience || 0}
                onChange={e => setNewCoach({...newCoach, yearsOfExperience: parseInt(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Monthly Session Capacity</label>
              <input 
                type="number" 
                min="0"
                required={newCoach.type === 'inhouse'}
                disabled={newCoach.type !== 'inhouse'}
                value={newCoach.monthlySessionCapacity || 0}
                onChange={e => setNewCoach({...newCoach, monthlySessionCapacity: parseInt(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all disabled:opacity-30 ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Last Work Place</label>
            <input 
              type="text" 
              required
              value={newCoach.lastWorkPlace}
              onChange={e => setNewCoach({...newCoach, lastWorkPlace: e.target.value})}
              className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
              }`}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Specialties</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {newCoach.specialties?.map((s, i) => (
                <span key={i} className="px-2 py-1 bg-red-500/10 text-red-500 text-xs rounded-lg flex items-center gap-1">
                  {s}
                  <button type="button" onClick={() => setNewCoach({...newCoach, specialties: newCoach.specialties?.filter((_, idx) => idx !== i)})}>
                    <XCircle size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={specialtyInput}
                onChange={e => setSpecialtyInput(e.target.value)}
                placeholder="Add specialty (e.g. Yoga, Crossfit)"
                className={`flex-1 p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
                onKeyPress={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (specialtyInput.trim()) {
                      setNewCoach({...newCoach, specialties: [...(newCoach.specialties || []), specialtyInput.trim()]});
                      setSpecialtyInput('');
                    }
                  }
                }}
              />
              <button 
                type="button"
                onClick={() => {
                  if (specialtyInput.trim()) {
                    setNewCoach({...newCoach, specialties: [...(newCoach.specialties || []), specialtyInput.trim()]});
                    setSpecialtyInput('');
                  }
                }}
                className="px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-all"
              >
                Add
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Hourly Rate ($)</label>
            <input 
              type="number" 
              min="0"
              required
              value={newCoach.hourRate || 0}
              onChange={e => setNewCoach({...newCoach, hourRate: parseInt(e.target.value) || 0})}
              className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
              }`}
            />
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Documents</h4>
            
            <div className="grid grid-cols-1 gap-4">
              <div className={`p-4 rounded-xl border border-dashed ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-zinc-50'}`}>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-2">CV (Word or PDF)</label>
                <input 
                  type="file" 
                  accept=".doc,.docx,.pdf"
                  onChange={e => handleFileUpload(e, 'cvFile')}
                  className="w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700 cursor-pointer"
                />
                {newCoach.cvFile && <p className="text-[10px] text-green-500 mt-2 flex items-center gap-1"><CheckCircle2 size={10} /> CV Uploaded</p>}
              </div>

              <div className={`p-4 rounded-xl border border-dashed ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-zinc-50'}`}>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-2">ID (JPG or PDF - Front & Back)</label>
                <input 
                  type="file" 
                  multiple
                  accept=".jpg,.jpeg,.pdf"
                  onChange={e => handleFileUpload(e, 'idFiles')}
                  className="w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700 cursor-pointer"
                />
                {newCoach.idFiles && newCoach.idFiles.length > 0 && (
                  <p className="text-[10px] text-green-500 mt-2 flex items-center gap-1">
                    <CheckCircle2 size={10} /> {newCoach.idFiles.length} ID File(s) Uploaded
                  </p>
                )}
              </div>

              <div className={`p-4 rounded-xl border border-dashed ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-zinc-50'}`}>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-2">CRC (JPG or PDF)</label>
                <input 
                  type="file" 
                  accept=".jpg,.jpeg,.pdf"
                  onChange={e => handleFileUpload(e, 'crcFile')}
                  className="w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700 cursor-pointer"
                />
                {newCoach.crcFile && <p className="text-[10px] text-green-500 mt-2 flex items-center gap-1"><CheckCircle2 size={10} /> CRC Uploaded</p>}
              </div>
            </div>
          </div>

          <button 
            type="submit"
            className="el-btn-primary w-full py-3"
          >
            Add Coach
          </button>
        </form>
      </Modal>

      <Modal isOpen={isCoachPackageModalOpen} onClose={() => setIsCoachPackageModalOpen(false)} title="Create Coach Package" theme={theme} maxWidth="max-w-xl">
        <form onSubmit={addCoachPackage} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Package Name</label>
            <input 
              type="text" 
              required
              value={newCoachPackage.name}
              onChange={e => setNewCoachPackage({...newCoachPackage, name: e.target.value})}
              className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
              }`}
              placeholder="e.g. Freelance 20-Session Pack"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Length (weeks)</label>
              <input 
                type="number" 
                min="1"
                required
                value={newCoachPackage.lengthInWeeks || 0}
                onChange={e => setNewCoachPackage({...newCoachPackage, lengthInWeeks: parseInt(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Sessions</label>
              <input 
                type="number" 
                min="1"
                required
                value={newCoachPackage.sessions || 0}
                onChange={e => setNewCoachPackage({...newCoachPackage, sessions: parseInt(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Base Cost ($)</label>
              <input 
                type="number" 
                min="0"
                required
                value={newCoachPackage.cost || 0}
                onChange={e => setNewCoachPackage({...newCoachPackage, cost: parseFloat(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Discount (%)</label>
              <input 
                type="number" 
                min="0"
                max="100"
                value={newCoachPackage.discountPercent || 0}
                onChange={e => setNewCoachPackage({...newCoachPackage, discountPercent: parseFloat(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Discount ($)</label>
              <input 
                type="number" 
                min="0"
                value={newCoachPackage.discountAmount || 0}
                onChange={e => setNewCoachPackage({...newCoachPackage, discountAmount: parseFloat(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Price Override ($)</label>
              <input 
                type="number" 
                min="0"
                placeholder="Optional"
                value={newCoachPackage.priceOverride ?? ''}
                onChange={e => setNewCoachPackage({...newCoachPackage, priceOverride: e.target.value !== '' ? parseFloat(e.target.value) : undefined})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
          </div>
          <button 
            type="submit"
            className="el-btn-primary w-full py-3"
          >
            Create Coach Package
          </button>
        </form>
      </Modal>

      <Modal isOpen={isEditCoachPackageModalOpen} onClose={() => { setIsEditCoachPackageModalOpen(false); setSelectedCoachPackageForEdit(null); }} title="Edit Coach Package" theme={theme} maxWidth="max-w-xl">
        {selectedCoachPackageForEdit && (
          <form onSubmit={handleUpdateCoachPackage} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Package Name</label>
              <input 
                type="text" 
                required
                value={selectedCoachPackageForEdit.name}
                onChange={e => setSelectedCoachPackageForEdit({...selectedCoachPackageForEdit, name: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Length (weeks)</label>
                <input 
                  type="number" 
                  min="1"
                  required
                  value={selectedCoachPackageForEdit.lengthInWeeks || 0}
                  onChange={e => setSelectedCoachPackageForEdit({...selectedCoachPackageForEdit, lengthInWeeks: parseInt(e.target.value) || 0})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Sessions</label>
                <input 
                  type="number" 
                  min="1"
                  required
                  value={selectedCoachPackageForEdit.sessions || 0}
                  onChange={e => setSelectedCoachPackageForEdit({...selectedCoachPackageForEdit, sessions: parseInt(e.target.value) || 0})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Base Cost ($)</label>
                <input 
                  type="number" 
                  min="0"
                  required
                  value={selectedCoachPackageForEdit.cost || 0}
                  onChange={e => setSelectedCoachPackageForEdit({...selectedCoachPackageForEdit, cost: parseFloat(e.target.value) || 0})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                  }`}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Discount (%)</label>
                <input 
                  type="number" 
                  min="0"
                  max="100"
                  value={selectedCoachPackageForEdit.discountPercent || 0}
                  onChange={e => setSelectedCoachPackageForEdit({...selectedCoachPackageForEdit, discountPercent: parseFloat(e.target.value) || 0})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Discount ($)</label>
                <input 
                  type="number" 
                  min="0"
                  value={selectedCoachPackageForEdit.discountAmount || 0}
                  onChange={e => setSelectedCoachPackageForEdit({...selectedCoachPackageForEdit, discountAmount: parseFloat(e.target.value) || 0})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Price Override ($)</label>
                <input 
                  type="number" 
                  min="0"
                  placeholder="Optional"
                  value={selectedCoachPackageForEdit.priceOverride ?? ''}
                  onChange={e => setSelectedCoachPackageForEdit({...selectedCoachPackageForEdit, priceOverride: e.target.value !== '' ? parseFloat(e.target.value) : undefined})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                  }`}
                />
              </div>
            </div>
            <button type="submit" className="el-btn-primary w-full py-3">
              Save Coach Package Changes
            </button>
          </form>
        )}
      </Modal>

      <Modal isOpen={isCoachContractModalOpen} onClose={() => setIsCoachContractModalOpen(false)} title="New Coach Contract" theme={theme} maxWidth="max-w-xl">
        <form onSubmit={addCoachContract} className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-800 border border-zinc-700">
            <div>
              <h4 className="text-sm font-bold">Coach Type</h4>
              <p className="text-xs text-zinc-400">Is this coach In House or Freelance?</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNewCoachContract({...newCoachContract, type: 'inhouse'})}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${newCoachContract.type === 'inhouse' ? 'bg-[#00B8C8] text-[#05070A]' : 'bg-zinc-700 text-zinc-300'}`}
              >
                In House
              </button>
              <button
                type="button"
                onClick={() => setNewCoachContract({...newCoachContract, type: 'freelance'})}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${newCoachContract.type === 'freelance' ? 'bg-[#00B8C8] text-[#05070A]' : 'bg-zinc-700 text-zinc-300'}`}
              >
                Freelance
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Contract Mode</label>
            <select
              value={newCoachContract.contractMode || 'package'}
              onChange={e => setNewCoachContract({ ...newCoachContract, contractMode: e.target.value as any })}
              className={`w-full p-2.5 rounded-lg border text-xs font-bold ${
                theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark]' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light]'
              }`}
            >
              <option value="package">Coach Package Contract (Prepaid / Quota)</option>
              <option value="session_bypass">Direct Per-Session Tiered Contract (Bypass Package)</option>
              <option value="third_party">3rd-Party B2B Partner Contract</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Coach Name</label>
            <select 
              required
              value={newCoachContract.coachId}
              onChange={e => {
                if (e.target.value === 'add_new') {
                  setIsCoachModalOpen(true);
                } else {
                  const chosen = coaches.find(c => c.id === e.target.value);
                  setNewCoachContract({
                    ...newCoachContract,
                    coachId: e.target.value,
                    baseFeeOneClient: chosen?.baseFeeOneClient ?? newCoachContract.baseFeeOneClient ?? 10,
                    extraClientFee: chosen?.extraClientFee ?? newCoachContract.extraClientFee ?? 5,
                    maxClientsPerSession: chosen?.maxClientsPerSession ?? newCoachContract.maxClientsPerSession ?? 5
                  });
                }
              }}
              className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-cyan-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-cyan-500/30'
              }`}
            >
              <option value="">Select a coach...</option>
              {coaches.map(c => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
              <option value="add_new" className="font-bold text-[#00B8C8]">+ Add New Coach</option>
            </select>
          </div>

          {newCoachContract.contractMode === 'package' && (
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Coach Package (Optional)</label>
              <select 
                value={newCoachContract.packageId}
                onChange={e => {
                  if (e.target.value === 'add_new') {
                    setIsCoachPackageModalOpen(true);
                    return;
                  }
                  const pkg = coachPackages.find(p => p.id === e.target.value);
                  const updates: Partial<CoachContract> = { packageId: e.target.value };
                  if (pkg) {
                    const startDate = new Date(newCoachContract.startDate || new Date().toISOString().split('T')[0]);
                    const endDate = new Date(startDate);
                    endDate.setDate(endDate.getDate() + (pkg.lengthInWeeks * 7));
                    updates.endDate = endDate.toISOString().split('T')[0];
                    updates.price = getEffectiveCoachPackagePrice(pkg);
                    updates.sessions = pkg.sessions;
                    updates.remainingSessions = pkg.sessions;
                  }
                  setNewCoachContract({...newCoachContract, ...updates});
                }}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-cyan-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-cyan-500/30'
                }`}
              >
                <option value="">No Package / Custom Terms</option>
                {coachPackages.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({formatCurrency(getEffectiveCoachPackagePrice(p))} • {p.sessions} sessions)</option>
                ))}
                <option value="add_new" className="font-bold text-[#00B8C8]">+ Add New Coach Package</option>
              </select>
            </div>
          )}

          <div className={`p-3.5 rounded-xl border space-y-2 ${theme === 'dark' ? 'bg-zinc-800/60 border-zinc-700' : 'bg-slate-50 border-slate-200'}`}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#00B8C8]">
              Dynamic Per-Session Multi-Client Tiered Pricing
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">1st Client Fee ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={newCoachContract.baseFeeOneClient ?? 10}
                  onChange={e => setNewCoachContract({ ...newCoachContract, baseFeeOneClient: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2 rounded-lg border text-xs font-mono ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                  }`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">+ Extra Client ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={newCoachContract.extraClientFee ?? 5}
                  onChange={e => setNewCoachContract({ ...newCoachContract, extraClientFee: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2 rounded-lg border text-xs font-mono ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                  }`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Max Clients</label>
                <input
                  type="number"
                  min="1"
                  max="25"
                  value={newCoachContract.maxClientsPerSession ?? 5}
                  onChange={e => setNewCoachContract({ ...newCoachContract, maxClientsPerSession: parseInt(e.target.value) || 5 })}
                  className={`w-full p-2 rounded-lg border text-xs font-mono ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                  }`}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">Base Price ($)</label>
              <input 
                type="number" 
                min="0"
                value={newCoachContract.price || 0}
                onChange={e => setNewCoachContract({...newCoachContract, price: parseFloat(e.target.value) || 0})}
                className={`w-full p-2 rounded-lg border text-xs ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                }`}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">Discount (%)</label>
              <input 
                type="number" 
                min="0"
                max="100"
                value={newCoachContract.discountPercent || 0}
                onChange={e => setNewCoachContract({...newCoachContract, discountPercent: parseFloat(e.target.value) || 0})}
                className={`w-full p-2 rounded-lg border text-xs ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                }`}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">Discount ($)</label>
              <input 
                type="number" 
                min="0"
                value={newCoachContract.discountAmount || 0}
                onChange={e => setNewCoachContract({...newCoachContract, discountAmount: parseFloat(e.target.value) || 0})}
                className={`w-full p-2 rounded-lg border text-xs ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                }`}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">Sessions</label>
              <input 
                type="number" 
                min="0"
                value={newCoachContract.sessions || 0}
                onChange={e => setNewCoachContract({...newCoachContract, sessions: parseInt(e.target.value) || 0})}
                className={`w-full p-2 rounded-lg border text-xs ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                }`}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Start Date</label>
              <input 
                type="date" 
                required
                value={newCoachContract.startDate}
                onChange={e => setNewCoachContract({...newCoachContract, startDate: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">End Date</label>
              <input 
                type="date" 
                required
                value={newCoachContract.endDate}
                onChange={e => setNewCoachContract({...newCoachContract, endDate: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
          </div>
          <button 
            type="submit"
            className="el-btn-primary w-full py-3"
          >
            Create Contract
          </button>
        </form>
      </Modal>

      <Modal isOpen={isEditCoachContractModalOpen} onClose={() => setIsEditCoachContractModalOpen(false)} title="Edit Coach Contract" theme={theme} maxWidth="max-w-xl">
        <form onSubmit={updateCoachContract} className="space-y-4">
          {selectedCoachContract && (
            <>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Contract Mode</label>
                <select
                  value={selectedCoachContract.contractMode || 'package'}
                  onChange={e => setSelectedCoachContract({ ...selectedCoachContract, contractMode: e.target.value as any })}
                  className={`w-full p-2.5 rounded-lg border text-xs font-bold ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark]' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="package">Coach Package Contract</option>
                  <option value="session_bypass">Direct Per-Session Tiered Contract (Bypass Package)</option>
                  <option value="third_party">3rd-Party B2B Partner Contract</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Price ($)</label>
                  <input 
                    type="number" 
                    min="0"
                    required
                    value={selectedCoachContract.price || 0}
                    onChange={e => setSelectedCoachContract({...selectedCoachContract, price: parseFloat(e.target.value) || 0})}
                    className={`w-full p-2.5 rounded-lg border ${
                      theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-200 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Sessions</label>
                  <input 
                    type="number" 
                    min="0"
                    value={selectedCoachContract.sessions || 0}
                    onChange={e => setSelectedCoachContract({...selectedCoachContract, sessions: parseInt(e.target.value) || 0})}
                    className={`w-full p-2.5 rounded-lg border ${
                      theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-200 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Remaining</label>
                  <input 
                    type="number" 
                    min="0"
                    value={selectedCoachContract.remainingSessions || 0}
                    onChange={e => setSelectedCoachContract({...selectedCoachContract, remainingSessions: parseInt(e.target.value) || 0})}
                    className={`w-full p-2.5 rounded-lg border ${
                      theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-200 text-slate-900'
                    }`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">1st Client Fee ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={selectedCoachContract.baseFeeOneClient ?? 10}
                    onChange={e => setSelectedCoachContract({ ...selectedCoachContract, baseFeeOneClient: parseFloat(e.target.value) || 0 })}
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">+ Extra Client ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={selectedCoachContract.extraClientFee ?? 5}
                    onChange={e => setSelectedCoachContract({ ...selectedCoachContract, extraClientFee: parseFloat(e.target.value) || 0 })}
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Max Clients</label>
                  <input
                    type="number"
                    min="1"
                    max="25"
                    value={selectedCoachContract.maxClientsPerSession ?? 5}
                    onChange={e => setSelectedCoachContract({ ...selectedCoachContract, maxClientsPerSession: parseInt(e.target.value) || 5 })}
                    className={`w-full p-2 rounded-lg border text-xs font-mono ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={selectedCoachContract.startDate}
                    onChange={e => setSelectedCoachContract({ ...selectedCoachContract, startDate: e.target.value })}
                    className={`w-full p-2.5 rounded-lg border text-xs ${
                      theme === 'dark'
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={selectedCoachContract.endDate}
                    onChange={e => setSelectedCoachContract({ ...selectedCoachContract, endDate: e.target.value })}
                    className={`w-full p-2.5 rounded-lg border text-xs ${
                      theme === 'dark'
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
              </div>
              <button 
                type="submit"
                className="el-btn-primary w-full py-3"
              >
                Update Contract
              </button>
            </>
          )}
        </form>
      </Modal>

      <Modal isOpen={isPackageModalOpen} onClose={() => setIsPackageModalOpen(false)} title="Create New Package" theme={theme} maxWidth="max-w-xl">
        <form onSubmit={handleAddPackage} className="space-y-4">
          <div className="flex items-center gap-4 mb-4">
            <div className={`w-16 h-16 rounded-xl border-2 border-dashed flex items-center justify-center overflow-hidden relative ${
              theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-200'
            }`}>
              {newPackage.image ? (
                <img src={newPackage.image} alt="Package" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <Plus size={20} className="text-zinc-400" />
              )}
              <input 
                type="file" 
                accept="image/*"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setNewPackage({...newPackage, image: reader.result as string});
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Package Name</label>
              <input 
                type="text" 
                required
                value={newPackage.name}
                onChange={e => setNewPackage({...newPackage, name: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
                placeholder="e.g. Monthly Basic"
              />
            </div>
          </div>

          <div className="flex p-1 rounded-lg border mb-4 bg-zinc-800 border-zinc-700">
            <button 
              type="button"
              onClick={() => setNewPackage({...newPackage, type: 'solo'})}
              className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${
                newPackage.type === 'solo' ? 'bg-[#00B8C8] text-[#05070A] shadow-sm' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              Solo
            </button>
            <button 
              type="button"
              onClick={() => setNewPackage({...newPackage, type: 'group', maxPeople: newPackage.maxPeople || 2})}
              className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${
                newPackage.type === 'group' ? 'bg-[#00B8C8] text-[#05070A] shadow-sm' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              Group
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Duration (Months)</label>
              <input 
                type="number" 
                min="1"
                required
                value={newPackage.duration || 0}
                onChange={e => setNewPackage({...newPackage, duration: parseInt(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Number of Sessions</label>
              <input 
                type="number" 
                min="1"
                required
                value={newPackage.sessions || 0}
                onChange={e => setNewPackage({...newPackage, sessions: parseInt(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Discount (%)</label>
              <input 
                type="number" 
                min="0"
                max="100"
                value={newPackage.discountPercent || 0}
                onChange={e => setNewPackage({...newPackage, discountPercent: parseFloat(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Discount ($)</label>
              <input 
                type="number" 
                min="0"
                value={newPackage.discountAmount || 0}
                onChange={e => setNewPackage({...newPackage, discountAmount: parseFloat(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Discount Expiry</label>
              <input 
                type="date" 
                value={newPackage.discountExpiry}
                onChange={e => setNewPackage({...newPackage, discountExpiry: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Base Price ($)</label>
              <input 
                type="number" 
                min="0"
                required
                value={newPackage.price || 0}
                onChange={e => setNewPackage({...newPackage, price: parseFloat(e.target.value) || 0})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Price Override ($)</label>
              <input 
                type="number" 
                min="0"
                placeholder="Optional"
                value={newPackage.priceOverride ?? ''}
                onChange={e => setNewPackage({...newPackage, priceOverride: e.target.value !== '' ? parseFloat(e.target.value) : undefined})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                }`}
              />
            </div>
            {newPackage.type === 'group' && (
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Max People</label>
                <input 
                  type="number" 
                  min="2"
                  required
                  value={newPackage.maxPeople || 2}
                  onChange={e => setNewPackage({...newPackage, maxPeople: parseInt(e.target.value) || 2})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                  }`}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Addons</label>
            <div className="flex flex-col gap-2 mb-2">
              <div className="flex gap-2">
                <select 
                  value={addonType}
                  onChange={e => {
                    const val = e.target.value as any;
                    setAddonType(val);
                    if (val !== 'custom') {
                      setNewAddon({...newAddon, name: val});
                    } else {
                      setNewAddon({...newAddon, name: ''});
                    }
                  }}
                  className={`flex-1 p-2 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-cyan-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-cyan-500/30'
                  }`}
                >
                  <option value="custom">Custom Text</option>
                  <option value="Recovery session">Recovery session</option>
                  <option value="Dietitian session">Dietitian session</option>
                </select>
                <input 
                  type="number" 
                  placeholder="Price ($)"
                  value={newAddon.price || ''}
                  onChange={e => setNewAddon({...newAddon, price: parseInt(e.target.value) || 0})}
                  className={`w-24 p-2 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                  }`}
                />
                <button 
                  type="button"
                  onClick={() => {
                    if (newAddon.name) {
                      setNewPackage({...newPackage, addons: [...(newPackage.addons || []), { ...newAddon }]});
                      setNewAddon({ name: '', price: 0 });
                      setAddonType('custom');
                    }
                  }}
                  className="px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 font-bold text-xs uppercase"
                >
                  Add
                </button>
              </div>
              {addonType === 'custom' && (
                <input 
                  type="text" 
                  value={newAddon.name}
                  onChange={e => setNewAddon({...newAddon, name: e.target.value})}
                  className={`w-full p-2 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 focus:ring-cyan-500/30'
                  }`}
                  placeholder="Enter custom addon name..."
                />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {newPackage.addons?.map((addon, i) => (
                <span key={i} className="px-2 py-1 bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase rounded flex items-center gap-1">
                  {addon.name} {addon.price > 0 && `(${formatCurrency(addon.price)})`}
                  <button type="button" onClick={() => setNewPackage({...newPackage, addons: newPackage.addons?.filter((_, j) => i !== j)})} className="hover:text-red-500">
                    <Trash2 size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <button type="submit" className="el-btn-primary w-full py-3 mt-4">
            Create Package
          </button>
        </form>
      </Modal>

      <Modal isOpen={isEditPackageModalOpen} onClose={() => { setIsEditPackageModalOpen(false); setSelectedPackageForEdit(null); }} title="Edit Client Membership Package" theme={theme} maxWidth="max-w-xl">
        {selectedPackageForEdit && (
          <form onSubmit={handleUpdatePackage} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Package Name</label>
              <input
                type="text"
                required
                value={selectedPackageForEdit.name}
                onChange={e => setSelectedPackageForEdit({ ...selectedPackageForEdit, name: e.target.value })}
                className={`w-full p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}
              />
            </div>
            <div className="flex p-1 rounded-lg border bg-zinc-800 border-zinc-700">
              <button
                type="button"
                onClick={() => setSelectedPackageForEdit({ ...selectedPackageForEdit, type: 'solo' })}
                className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${
                  selectedPackageForEdit.type === 'solo' ? 'bg-[#00B8C8] text-[#05070A]' : 'text-zinc-400'
                }`}
              >
                Solo
              </button>
              <button
                type="button"
                onClick={() => setSelectedPackageForEdit({ ...selectedPackageForEdit, type: 'group', maxPeople: selectedPackageForEdit.maxPeople || 2 })}
                className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${
                  selectedPackageForEdit.type === 'group' ? 'bg-[#00B8C8] text-[#05070A]' : 'text-zinc-400'
                }`}
              >
                Group
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Duration (Months)</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={selectedPackageForEdit.duration || 1}
                  onChange={e => setSelectedPackageForEdit({ ...selectedPackageForEdit, duration: parseInt(e.target.value) || 1 })}
                  className={`w-full p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Number of Sessions</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={selectedPackageForEdit.sessions || 1}
                  onChange={e => setSelectedPackageForEdit({ ...selectedPackageForEdit, sessions: parseInt(e.target.value) || 1 })}
                  className={`w-full p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Base Price ($)</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={selectedPackageForEdit.price || 0}
                  onChange={e => setSelectedPackageForEdit({ ...selectedPackageForEdit, price: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Discount (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={selectedPackageForEdit.discountPercent || 0}
                  onChange={e => setSelectedPackageForEdit({ ...selectedPackageForEdit, discountPercent: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Discount ($)</label>
                <input
                  type="number"
                  min="0"
                  value={selectedPackageForEdit.discountAmount || 0}
                  onChange={e => setSelectedPackageForEdit({ ...selectedPackageForEdit, discountAmount: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Direct Price Override ($)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="Optional"
                  value={selectedPackageForEdit.priceOverride ?? ''}
                  onChange={e => setSelectedPackageForEdit({ ...selectedPackageForEdit, priceOverride: e.target.value !== '' ? parseFloat(e.target.value) : undefined })}
                  className={`w-full p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}
                />
              </div>
              {selectedPackageForEdit.type === 'group' && (
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Max People</label>
                  <input
                    type="number"
                    min="2"
                    value={selectedPackageForEdit.maxPeople || 2}
                    onChange={e => setSelectedPackageForEdit({ ...selectedPackageForEdit, maxPeople: parseInt(e.target.value) || 2 })}
                    className={`w-full p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}
                  />
                </div>
              )}
            </div>
            <button type="submit" className="el-btn-primary w-full py-3">
              Save Package Changes
            </button>
          </form>
        )}
      </Modal>

      <Modal isOpen={isCoachViewModalOpen} onClose={() => setIsCoachViewModalOpen(false)} title="Coach Profile" theme={theme} maxWidth="max-w-2xl">
        {selectedCoachForView && (
          <div className="space-y-6">
            <div className="flex items-center gap-6">
              <div className={`w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold ${
                theme === 'dark' ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-100 text-zinc-900'
              }`}>
                {selectedCoachForView.firstName[0]}{selectedCoachForView.lastName[0]}
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-black uppercase tracking-tight">{selectedCoachForView.firstName} {selectedCoachForView.lastName}</h2>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${
                    selectedCoachForView.isInHouse ? 'bg-blue-500/10 text-blue-500' : 'bg-zinc-500/10 text-zinc-400'
                  }`}>
                    {selectedCoachForView.isInHouse ? 'In House' : 'External'}
                  </span>
                  <span className="text-xs font-bold uppercase px-2 py-1 rounded bg-red-500/10 text-red-500">
                    {selectedCoachForView.yearsOfExperience}Y Experience
                  </span>
                  <span className="text-xs font-bold uppercase px-2 py-1 rounded bg-zinc-500/10 text-zinc-400">
                    {selectedCoachForView.gender}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                <h4 className="text-[10px] font-bold text-zinc-400 uppercase mb-3">Personal Details</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">DOB</span>
                    <span className="font-medium">{selectedCoachForView.dob}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Last Work Place</span>
                    <span className="font-medium">{selectedCoachForView.lastWorkPlace}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Hourly Rate</span>
                    <span className="font-bold text-red-500">{formatCurrency(selectedCoachForView.hourRate)}/hr</span>
                  </div>
                </div>
              </div>

              <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                <h4 className="text-[10px] font-bold text-zinc-400 uppercase mb-3">Specialties</h4>
                <div className="flex flex-wrap gap-1.5">
                  {selectedCoachForView.specialties.map((s, i) => (
                    <span key={i} className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${
                      theme === 'dark' ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-600'
                    }`}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Documents</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {selectedCoachForView.cvFile && (
                  <div className={`p-4 rounded-xl border text-center ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                    <Download className="mx-auto mb-2 text-red-500" size={24} />
                    <div className="text-[10px] font-bold uppercase mb-2">CV / Resume</div>
                    <a 
                      href={selectedCoachForView.cvFile} 
                      download={`${selectedCoachForView.firstName}_${selectedCoachForView.lastName}_CV`}
                      className="block w-full py-1.5 bg-zinc-800 text-white text-[10px] font-bold uppercase rounded hover:bg-zinc-700 transition-all"
                    >
                      Download
                    </a>
                  </div>
                )}
                {selectedCoachForView.idFiles && selectedCoachForView.idFiles.length > 0 && (
                  <div className={`p-4 rounded-xl border text-center ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                    <CreditCard className="mx-auto mb-2 text-blue-500" size={24} />
                    <div className="text-[10px] font-bold uppercase mb-2">ID Document</div>
                    <div className="flex flex-col gap-1">
                      {selectedCoachForView.idFiles.map((file, i) => (
                        <a 
                          key={i}
                          href={file} 
                          download={`${selectedCoachForView.firstName}_${selectedCoachForView.lastName}_ID_${i+1}`}
                          className="block w-full py-1.5 bg-zinc-800 text-white text-[10px] font-bold uppercase rounded hover:bg-zinc-700 transition-all"
                        >
                          Download {i === 0 ? 'Front' : 'Back'}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {selectedCoachForView.crcFile && (
                  <div className={`p-4 rounded-xl border text-center ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                    <ShieldCheck className="mx-auto mb-2 text-green-500" size={24} />
                    <div className="text-[10px] font-bold uppercase mb-2">CRC Document</div>
                    <a 
                      href={selectedCoachForView.crcFile} 
                      download={`${selectedCoachForView.firstName}_${selectedCoachForView.lastName}_CRC`}
                      className="block w-full py-1.5 bg-zinc-800 text-white text-[10px] font-bold uppercase rounded hover:bg-zinc-700 transition-all"
                    >
                      Download
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
      <Modal isOpen={isMemberDetailsModalOpen} onClose={() => setIsMemberDetailsModalOpen(false)} title="Member Details" theme={theme} maxWidth="max-w-2xl">
        {selectedMemberForDetails && (
          <div className="space-y-6">
            <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800/80 border-zinc-700' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-[#00B8C8]/15 border border-[#00B8C8]/30 flex items-center justify-center text-[#00B8C8] text-2xl font-bold shrink-0">
                    {selectedMemberForDetails.firstName[0]}{selectedMemberForDetails.lastName[0]}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">{selectedMemberForDetails.firstName} {selectedMemberForDetails.lastName}</h3>
                    <p className="text-sm text-zinc-400">{selectedMemberForDetails.email || 'No email'} • {selectedMemberForDetails.phone || 'No phone'}</p>
                  </div>
                </div>
                {(() => {
                  const status = getStatus(selectedMemberForDetails.expiryDate, selectedMemberForDetails.status, selectedMemberForDetails.packageId, selectedMemberForDetails.isFrozen);
                  const pkg = packages.find(p => p.id === selectedMemberForDetails.packageId);
                  const usedInCycle = getCycleUsedSessions(selectedMemberForDetails);
                  const isRenewable = status !== 'active' || (pkg && usedInCycle >= pkg.sessions);
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsMemberDetailsModalOpen(false);
                          navigate(`/members/${selectedMemberForDetails.id}`);
                        }}
                        className="px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all shrink-0 bg-zinc-800 hover:bg-zinc-700 text-[#00B8C8] border border-[#00B8C8]/40 cursor-pointer"
                      >
                        360° Profile & Packages
                      </button>
                      <button
                        onClick={() => isRenewable && handleRenewMembership(selectedMemberForDetails.id)}
                        disabled={!isRenewable}
                        className={`px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all shrink-0 ${
                          isRenewable
                            ? 'bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 shadow-sm shadow-cyan-500/20 cursor-pointer'
                            : 'bg-zinc-700/60 text-zinc-400 cursor-not-allowed opacity-60'
                        }`}
                      >
                        Renew Membership
                      </button>
                    </div>
                  );
                })()}
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
                <div className={`p-3 rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#0B0F17]' : 'bg-white'} border ${theme === 'dark' ? 'border-zinc-700/80' : 'border-slate-200'}`}>
                  <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider mb-1 truncate">Status</p>
                  {(() => {
                    const computedModalStatus = getStatus(
                      selectedMemberForDetails.expiryDate,
                      selectedMemberForDetails.status,
                      selectedMemberForDetails.packageId,
                      selectedMemberForDetails.isFrozen
                    );
                    const statusColorClass =
                      computedModalStatus === 'frozen'
                        ? 'text-cyan-400'
                        : computedModalStatus === 'active'
                          ? 'text-emerald-500'
                          : computedModalStatus === 'expire soon'
                            ? 'text-amber-500'
                            : computedModalStatus === 'expired'
                              ? 'text-rose-500'
                              : 'text-zinc-400';
                    return (
                      <p className={`text-sm font-bold truncate ${statusColorClass}`}>
                        {computedModalStatus.toUpperCase()}
                      </p>
                    );
                  })()}
                </div>
                <div className={`p-3 rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#0B0F17]' : 'bg-white'} border ${theme === 'dark' ? 'border-zinc-700/80' : 'border-slate-200'}`}>
                  <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider mb-1 truncate">Days to Renewal</p>
                  <p className="text-sm font-bold truncate">
                    {(() => {
                      const daysLeft =
                        selectedMemberForDetails.packageId !== 'walk-in' &&
                        selectedMemberForDetails.expiryDate &&
                        !isNaN(new Date(selectedMemberForDetails.expiryDate).getTime())
                          ? Math.max(0, Math.ceil((new Date(selectedMemberForDetails.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                          : null;
                      return daysLeft !== null ? `${daysLeft} days` : 'N/A';
                    })()}
                  </p>
                </div>
                <div className={`p-3 rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#0B0F17]' : 'bg-white'} border ${theme === 'dark' ? 'border-zinc-700/80' : 'border-slate-200'}`}>
                  <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider mb-1 truncate">Cycle Sessions</p>
                  <p className="text-sm font-bold truncate">
                    {getCycleUsedSessions(selectedMemberForDetails)} <span className="text-[10px] text-zinc-500 font-normal">({(selectedMemberForDetails.checkIns || []).length} total)</span>
                  </p>
                </div>
                <div className={`p-3 rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#0B0F17]' : 'bg-white'} border ${theme === 'dark' ? 'border-zinc-700/80' : 'border-slate-200'}`}>
                  <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider mb-1 truncate">Sessions Left</p>
                  <p className="text-sm font-bold truncate">
                    {(() => {
                      if (selectedMemberForDetails.packageId === 'walk-in') return 'N/A';
                      const pkg = packages.find(p => p.id === selectedMemberForDetails.packageId);
                      return pkg ? Math.max(0, pkg.sessions - getCycleUsedSessions(selectedMemberForDetails)) : 'N/A';
                    })()}
                  </p>
                </div>
                <div className={`p-3 rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#0B0F17]' : 'bg-white'} border ${theme === 'dark' ? 'border-zinc-700/80' : 'border-slate-200'}`}>
                  <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider mb-1 truncate">Total Paid</p>
                  <p className="text-sm font-bold text-emerald-500 truncate">{formatCurrency(selectedMemberForDetails.totalPaid || 0)}</p>
                </div>
              </div>

              {selectedMemberForDetails.groupMembers && selectedMemberForDetails.groupMembers.length > 0 && (
                <div className="mt-4 p-3 rounded-xl border border-[#00B8C8]/30 bg-[#00B8C8]/5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#00B8C8] mb-2">
                    Group Package Roster ({selectedMemberForDetails.groupMembers.length + 1} Members — Main Contact: {selectedMemberForDetails.firstName} {selectedMemberForDetails.lastName})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#00B8C8]/20 text-[#00B8C8] border border-[#00B8C8]/30">
                      1. {selectedMemberForDetails.firstName} {selectedMemberForDetails.lastName} (Main Contact / Payer)
                    </span>
                    {selectedMemberForDetails.groupMembers.map((gm, idx) => (
                      <span key={idx} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700">
                        {idx + 2}. {gm.name} {gm.phone ? `• ${gm.phone}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
                <Clock size={16} className="text-red-500" />
                Check-in Logs
              </h4>
              <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-700' : 'border-zinc-200'}`}>
                <table className="w-full text-left text-sm">
                  <thead className={theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-50'}>
                    <tr>
                      <th className="p-3 font-bold text-zinc-400">Date & Time</th>
                      <th className="p-3 font-bold text-zinc-400">Assigned Coach</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {selectedMemberForDetails.checkIns.length > 0 ? (
                      selectedMemberForDetails.checkIns.map(checkIn => (
                        <tr key={checkIn.id} className={`transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50'}`}>
                          <td className="p-3">{format(new Date(checkIn.date), 'MMM d, yyyy h:mm a')}</td>
                          <td className="p-3">{checkIn.coach || 'None'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="p-4 text-center text-zinc-400">No check-ins recorded yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedMemberForDetails.membershipHistory && selectedMemberForDetails.membershipHistory.length > 0 && (
              <div>
                <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
                  <Package size={16} className="text-blue-500" />
                  Membership History
                </h4>
                <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-700' : 'border-zinc-200'}`}>
                  <table className="w-full text-left text-sm">
                    <thead className={theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-50'}>
                      <tr>
                        <th className="p-3 font-bold text-zinc-400">Period</th>
                        <th className="p-3 font-bold text-zinc-400">Package</th>
                        <th className="p-3 font-bold text-zinc-400">Paid</th>
                        <th className="p-3 font-bold text-zinc-400">Sessions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {selectedMemberForDetails.membershipHistory.map(history => (
                        <tr key={history.id} className={`transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50'}`}>
                          <td className="p-3">
                            <div className="text-xs">
                              {format(new Date(history.startDate), 'MMM d, yyyy')} - {format(new Date(history.expiryDate), 'MMM d, yyyy')}
                            </div>
                          </td>
                          <td className="p-3">
                            {packages.find(p => p.id === history.packageId)?.name || 'Unknown'}
                          </td>
                          <td className="p-3 text-green-500 font-bold">{formatCurrency(history.totalPaid)}</td>
                          <td className="p-3">{history.checkIns.length} sessions</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
                <CreditCard size={16} className="text-red-500" />
                Payment History
              </h4>
              <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-700' : 'border-zinc-200'}`}>
                <table className="w-full text-left text-sm">
                  <thead className={theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-50'}>
                    <tr>
                      <th className="p-3 font-bold text-zinc-400">Date</th>
                      <th className="p-3 font-bold text-zinc-400">Package</th>
                      <th className="p-3 font-bold text-zinc-400">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {selectedMemberForDetails.paymentHistory && selectedMemberForDetails.paymentHistory.length > 0 ? (
                      selectedMemberForDetails.paymentHistory.map(payment => {
                        const pkg = packages.find(p => p.id === payment.packageId);
                        return (
                          <tr key={payment.id} className={`transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50'}`}>
                            <td className="p-3">{format(new Date(payment.date), 'MMM d, yyyy')}</td>
                            <td className="p-3">{payment.packageId === 'walk-in' ? 'Walk-in Fee' : (pkg ? pkg.name : 'Unknown Package')}</td>
                            <td className="p-3 font-bold text-green-500">{formatCurrency(payment.amount)}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={3} className="p-4 text-center text-zinc-400">No payments recorded yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={isEditMemberModalOpen} onClose={() => setIsEditMemberModalOpen(false)} title="Edit Member Profile" theme={theme} maxWidth="max-w-xl">
        {selectedMemberForEdit && (
          <form onSubmit={handleEditMember} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">First Name</label>
                <input 
                  type="text" 
                  required
                  value={selectedMemberForEdit.firstName}
                  onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, firstName: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                  placeholder="John"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Last Name</label>
                <input 
                  type="text" 
                  required
                  value={selectedMemberForEdit.lastName}
                  onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, lastName: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                  placeholder="Doe"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Date of Birth</label>
                <input 
                  type="date" 
                  value={selectedMemberForEdit.dob}
                  onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, dob: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Gender</label>
                <select 
                  value={selectedMemberForEdit.gender}
                  onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, gender: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                  }`}
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="relative">
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Nationality</label>
                <button 
                  type="button"
                  onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                  className={`w-full p-2.5 rounded-lg border text-left flex items-center justify-between transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-lg">{COUNTRIES.find(c => c.name === selectedMemberForEdit.nationality)?.flag}</span>
                    {selectedMemberForEdit.nationality}
                  </span>
                  <Filter size={14} className="text-zinc-400" />
                </button>
                
                {isCountryDropdownOpen && (
                  <div className={`absolute top-full left-0 w-full mt-1 rounded-xl border shadow-xl z-50 overflow-hidden ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                  }`}>
                    <div className="p-2 border-b border-zinc-700">
                      <input 
                        type="text" 
                        placeholder="Search country..."
                        value={countrySearch}
                        onChange={e => setCountrySearch(e.target.value)}
                        className={`w-full p-1.5 text-xs rounded-md border focus:outline-none ${
                          theme === 'dark' ? 'bg-zinc-950 border-zinc-700' : 'bg-zinc-50 border-zinc-200'
                        }`}
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {COUNTRIES.filter(c => c.name.toLowerCase().includes(countrySearch.toLowerCase())).map(country => (
                        <button
                          key={country.code}
                          type="button"
                          onClick={() => {
                            setSelectedMemberForEdit({...selectedMemberForEdit, nationality: country.name});
                            setIsCountryDropdownOpen(false);
                            setCountrySearch('');
                          }}
                          className={`w-full p-2 text-left text-xs flex items-center gap-2 hover:bg-red-500/10 transition-colors ${
                            selectedMemberForEdit.nationality === country.name ? 'bg-red-500/5 text-red-500' : ''
                          }`}
                        >
                          <span className="text-lg">{country.flag}</span>
                          {country.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Level</label>
                <select 
                  value={selectedMemberForEdit.level}
                  onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, level: e.target.value as any})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                  }`}
                >
                  <option value="Novice">Novice</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Expert">Expert</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Height (cm)</label>
                  <input 
                    type="text" 
                    value={selectedMemberForEdit.height}
                    onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, height: e.target.value})}
                    className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                      theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                    }`}
                    placeholder="180"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Weight (kg)</label>
                  <input 
                    type="text" 
                    value={selectedMemberForEdit.weight}
                    onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, weight: e.target.value})}
                    className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                      theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                    }`}
                    placeholder="75"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Allergies</label>
              <input 
                type="text" 
                value={selectedMemberForEdit.allergies}
                onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, allergies: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
                placeholder="None or specify"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Health Problems</label>
              <textarea 
                value={selectedMemberForEdit.healthProblems}
                onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, healthProblems: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
                placeholder="None or specify"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Phone Number</label>
                <input 
                  type="text" 
                  value={selectedMemberForEdit.phone}
                  onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, phone: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                  placeholder="+1 234 567 890"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Email</label>
                <input 
                  type="email" 
                  value={selectedMemberForEdit.email}
                  onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, email: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                  placeholder="john@example.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Select Package</label>
                <select 
                  required
                  value={selectedMemberForEdit.packageId}
                  onChange={e => {
                    if (e.target.value === 'add_new') {
                      setIsPackageModalOpen(true);
                    } else {
                      setSelectedMemberForEdit({...selectedMemberForEdit, packageId: e.target.value});
                    }
                  }}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                  }`}
                >
                  <option value="">Select a package...</option>
                  {packages.map(pkg => (
                    <option key={pkg.id} value={pkg.id}>{pkg.name} ({formatCurrency(pkg.price)} - {pkg.duration}mo)</option>
                  ))}
                  <option value="add_new" className="font-bold text-red-500">+ Add New Package</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Start Date</label>
                <input 
                  type="date" 
                  required
                  value={selectedMemberForEdit.startDate}
                  onChange={e => setSelectedMemberForEdit({...selectedMemberForEdit, startDate: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 focus:ring-red-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 text-slate-900 focus:ring-red-500/30 [color-scheme:light]'
                  }`}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Assigned Trainer (Optional)</label>
              <select
                value={selectedMemberForEdit.assignedCoachId || ''}
                onChange={e => {
                  const coach = coaches.find(c => c.id === e.target.value);
                  setSelectedMemberForEdit({
                    ...selectedMemberForEdit,
                    assignedCoachId: coach ? coach.id : '',
                    assignedCoachName: coach ? `${coach.firstName} ${coach.lastName}` : ''
                  });
                }}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                }`}
              >
                <option value="">No Assigned Trainer</option>
                {coaches.map(c => (
                  <option key={c.id} value={c.id}>{c.firstName} {c.lastName} ({c.type === 'inhouse' ? 'In-House' : 'Freelance'})</option>
                ))}
              </select>
            </div>

            {(() => {
              const selPkg = packages.find(p => p.id === selectedMemberForEdit.packageId);
              if (!selPkg) return null;
              const maxExtra = Math.max(0, (selPkg.maxPeople || 2) - 1);
              const currentGroup = selectedMemberForEdit.groupMembers || [];
              return (
                <div className="space-y-3">
                  {selPkg.type === 'group' && (
                    <div className="p-3.5 rounded-xl border border-[#00B8C8]/30 bg-[#00B8C8]/5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-bold text-[#00B8C8] uppercase tracking-wider">
                            Group Package Participants ({currentGroup.filter(g => g.name.trim()).length + 1} / {selPkg.maxPeople || 2})
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            Participant #1 (Main Contact & Payer): {selectedMemberForEdit.firstName} {selectedMemberForEdit.lastName}
                          </div>
                        </div>
                        {currentGroup.length < maxExtra && (
                          <button
                            type="button"
                            onClick={() => setSelectedMemberForEdit({
                              ...selectedMemberForEdit,
                              groupMembers: [...currentGroup, { name: '', phone: '' }]
                            })}
                            className="px-2.5 py-1 rounded-lg bg-[#00B8C8]/20 text-[#00B8C8] border border-[#00B8C8]/30 text-[10px] font-bold uppercase"
                          >
                            + Add Participant
                          </button>
                        )}
                      </div>
                      {Array.from({ length: Math.max(currentGroup.length, maxExtra) }).slice(0, maxExtra).map((_, idx) => {
                        const gm = currentGroup[idx] || { name: '', phone: '' };
                        return (
                          <div key={idx} className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              placeholder={`Participant #${idx + 2} Full Name`}
                              value={gm.name}
                              onChange={e => {
                                const next = [...currentGroup];
                                while (next.length <= idx) next.push({ name: '', phone: '' });
                                next[idx] = { ...next[idx], name: e.target.value };
                                setSelectedMemberForEdit({ ...selectedMemberForEdit, groupMembers: next });
                              }}
                              className={`p-2 rounded-lg border text-xs ${
                                theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                              }`}
                            />
                            <input
                              type="text"
                              placeholder={`Participant #${idx + 2} Phone (Optional)`}
                              value={gm.phone || ''}
                              onChange={e => {
                                const next = [...currentGroup];
                                while (next.length <= idx) next.push({ name: '', phone: '' });
                                next[idx] = { ...next[idx], phone: e.target.value };
                                setSelectedMemberForEdit({ ...selectedMemberForEdit, groupMembers: next });
                              }}
                              className={`p-2 rounded-lg border text-xs ${
                                theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className={`p-3.5 rounded-xl border space-y-2 ${theme === 'dark' ? 'bg-zinc-800/60 border-zinc-700' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Member-Level Discount / Price Override</span>
                      <span className="text-xs font-black font-mono text-[#00B8C8]">
                        Effective Fee: {formatCurrency(getEffectivePackagePrice(selPkg, selectedMemberForEdit))}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">Discount (%)</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={selectedMemberForEdit.discountPercent || 0}
                          onChange={e => setSelectedMemberForEdit({ ...selectedMemberForEdit, discountPercent: parseFloat(e.target.value) || 0 })}
                          className={`w-full p-2 rounded-lg border text-xs font-mono ${
                            theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                          }`}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">Discount ($)</label>
                        <input
                          type="number"
                          min="0"
                          value={selectedMemberForEdit.discountAmount || 0}
                          onChange={e => setSelectedMemberForEdit({ ...selectedMemberForEdit, discountAmount: parseFloat(e.target.value) || 0 })}
                          className={`w-full p-2 rounded-lg border text-xs font-mono ${
                            theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                          }`}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">Override ($)</label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Auto"
                          value={selectedMemberForEdit.priceOverride ?? ''}
                          onChange={e => setSelectedMemberForEdit({ ...selectedMemberForEdit, priceOverride: e.target.value !== '' ? parseFloat(e.target.value) : undefined })}
                          className={`w-full p-2 rounded-lg border text-xs font-mono ${
                            theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <button type="submit" className="el-btn-primary w-full py-3 mt-4">
              Save Changes
            </button>
          </form>
        )}
      </Modal>

      <Modal isOpen={isMemberModalOpen} onClose={() => setIsMemberModalOpen(false)} title="Register New Member" theme={theme} maxWidth="max-w-xl">
        <form onSubmit={handleAddMember} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">First Name</label>
              <input 
                type="text" 
                required
                value={newMember.firstName}
                onChange={e => setNewMember({...newMember, firstName: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
                placeholder="John"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Last Name</label>
              <input 
                type="text" 
                required
                value={newMember.lastName}
                onChange={e => setNewMember({...newMember, lastName: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
                placeholder="Doe"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Date of Birth</label>
              <input 
                type="date" 
                value={newMember.dob}
                onChange={e => setNewMember({...newMember, dob: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Gender</label>
              <select 
                value={newMember.gender}
                onChange={e => setNewMember({...newMember, gender: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                }`}
              >
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="relative">
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Nationality</label>
              <button 
                type="button"
                onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                className={`w-full p-2.5 rounded-lg border text-left flex items-center justify-between transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-lg">{COUNTRIES.find(c => c.name === newMember.nationality)?.flag}</span>
                  {newMember.nationality}
                </span>
                <Filter size={14} className="text-zinc-400" />
              </button>
              
              {isCountryDropdownOpen && (
                <div className={`absolute top-full left-0 w-full mt-1 rounded-xl border shadow-xl z-50 overflow-hidden ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                }`}>
                  <div className="p-2 border-b border-zinc-700">
                    <input 
                      type="text" 
                      placeholder="Search country..."
                      value={countrySearch}
                      onChange={e => setCountrySearch(e.target.value)}
                      className={`w-full p-1.5 text-xs rounded-md border focus:outline-none ${
                        theme === 'dark' ? 'bg-zinc-950 border-zinc-700' : 'bg-zinc-50 border-zinc-200'
                      }`}
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {COUNTRIES.filter(c => c.name.toLowerCase().includes(countrySearch.toLowerCase())).map(country => (
                      <button
                        key={country.code}
                        type="button"
                        onClick={() => {
                          setNewMember({...newMember, nationality: country.name});
                          setIsCountryDropdownOpen(false);
                          setCountrySearch('');
                        }}
                        className={`w-full p-2 text-left text-xs flex items-center gap-2 hover:bg-red-500/10 transition-colors ${
                          newMember.nationality === country.name ? 'bg-red-500/5 text-red-500' : ''
                        }`}
                      >
                        <span className="text-lg">{country.flag}</span>
                        {country.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Level</label>
              <select 
                value={newMember.level}
                onChange={e => setNewMember({...newMember, level: e.target.value as any})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                }`}
              >
                <option value="Novice">Novice</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Expert">Expert</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Height (cm)</label>
                <input 
                  type="text" 
                  value={newMember.height}
                  onChange={e => setNewMember({...newMember, height: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                  placeholder="180"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Weight (kg)</label>
                <input 
                  type="text" 
                  value={newMember.weight}
                  onChange={e => setNewMember({...newMember, weight: e.target.value})}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                  }`}
                  placeholder="75"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Allergies</label>
            <input 
              type="text" 
              value={newMember.allergies}
              onChange={e => setNewMember({...newMember, allergies: e.target.value})}
              className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
              }`}
              placeholder="None or specify"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Health Problems</label>
            <textarea 
              value={newMember.healthProblems}
              onChange={e => setNewMember({...newMember, healthProblems: e.target.value})}
              className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
              }`}
              placeholder="None or specify"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Phone Number</label>
              <input 
                type="text" 
                value={newMember.phone}
                onChange={e => setNewMember({...newMember, phone: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
                placeholder="+1 234 567 890"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Email</label>
              <input 
                type="email" 
                value={newMember.email}
                onChange={e => setNewMember({...newMember, email: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                }`}
                placeholder="john@example.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Select Package</label>
              <select 
                required
                value={newMember.packageId}
                onChange={e => {
                  if (e.target.value === 'add_new') {
                    setIsPackageModalOpen(true);
                  } else {
                    setNewMember({...newMember, packageId: e.target.value});
                  }
                }}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                }`}
              >
                <option value="">Select a package...</option>
                {packages.map(pkg => (
                  <option key={pkg.id} value={pkg.id}>{pkg.name} ({formatCurrency(pkg.price)} - {pkg.duration}mo)</option>
                ))}
                <option value="add_new" className="font-bold text-red-500">+ Add New Package</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Start Date</label>
              <input 
                type="date" 
                required
                value={newMember.startDate}
                onChange={e => setNewMember({...newMember, startDate: e.target.value})}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 focus:ring-red-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 text-slate-900 focus:ring-red-500/30 [color-scheme:light]'
                }`}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Assigned Trainer (Optional)</label>
            <select
              value={newMember.assignedCoachId || ''}
              onChange={e => {
                const coach = coaches.find(c => c.id === e.target.value);
                setNewMember({
                  ...newMember,
                  assignedCoachId: coach ? coach.id : '',
                  assignedCoachName: coach ? `${coach.firstName} ${coach.lastName}` : ''
                });
              }}
              className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
              }`}
            >
              <option value="">No Assigned Trainer</option>
              {coaches.map(c => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName} ({c.type === 'inhouse' ? 'In-House' : 'Freelance'})</option>
              ))}
            </select>
          </div>

          {(() => {
            const selPkg = packages.find(p => p.id === newMember.packageId);
            if (!selPkg) return null;
            const maxExtra = Math.max(0, (selPkg.maxPeople || 2) - 1);
            const currentGroup = newMember.groupMembers || [];
            return (
              <div className="space-y-3">
                {selPkg.type === 'group' && (
                  <div className="p-3.5 rounded-xl border border-[#00B8C8]/30 bg-[#00B8C8]/5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-[#00B8C8] uppercase tracking-wider">
                          Group Package Participants ({currentGroup.filter(g => g.name.trim()).length + 1} / {selPkg.maxPeople || 2})
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          Participant #1 (Main Contact & Payer): {newMember.firstName || 'Primary'} {newMember.lastName || 'Member'}
                        </div>
                      </div>
                    </div>
                    {Array.from({ length: maxExtra }).map((_, idx) => {
                      const gm = currentGroup[idx] || { name: '', phone: '' };
                      return (
                        <div key={idx} className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            placeholder={`Participant #${idx + 2} Full Name`}
                            value={gm.name}
                            onChange={e => {
                              const next = [...currentGroup];
                              while (next.length <= idx) next.push({ name: '', phone: '' });
                              next[idx] = { ...next[idx], name: e.target.value };
                              setNewMember({ ...newMember, groupMembers: next });
                            }}
                            className={`p-2 rounded-lg border text-xs ${
                              theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                            }`}
                          />
                          <input
                            type="text"
                            placeholder={`Participant #${idx + 2} Phone (Optional)`}
                            value={gm.phone || ''}
                            onChange={e => {
                              const next = [...currentGroup];
                              while (next.length <= idx) next.push({ name: '', phone: '' });
                              next[idx] = { ...next[idx], phone: e.target.value };
                              setNewMember({ ...newMember, groupMembers: next });
                            }}
                            className={`p-2 rounded-lg border text-xs ${
                              theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className={`p-3.5 rounded-xl border space-y-2 ${theme === 'dark' ? 'bg-zinc-800/60 border-zinc-700' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Member-Level Discount / Price Override</span>
                    <span className="text-xs font-black font-mono text-[#00B8C8]">
                      Effective Fee: {formatCurrency(getEffectivePackagePrice(selPkg, newMember))}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">Discount (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={newMember.discountPercent || 0}
                        onChange={e => setNewMember({ ...newMember, discountPercent: parseFloat(e.target.value) || 0 })}
                        className={`w-full p-2 rounded-lg border text-xs font-mono ${
                          theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">Discount ($)</label>
                      <input
                        type="number"
                        min="0"
                        value={newMember.discountAmount || 0}
                        onChange={e => setNewMember({ ...newMember, discountAmount: parseFloat(e.target.value) || 0 })}
                        className={`w-full p-2 rounded-lg border text-xs font-mono ${
                          theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">Override ($)</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="Auto"
                        value={newMember.priceOverride ?? ''}
                        onChange={e => setNewMember({ ...newMember, priceOverride: e.target.value !== '' ? parseFloat(e.target.value) : undefined })}
                        className={`w-full p-2 rounded-lg border text-xs font-mono ${
                          theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <button type="submit" className="el-btn-primary w-full py-3 mt-4">
            Register Member
          </button>
        </form>
      </Modal>

      {/* Check In Modal */}
      <Modal 
        isOpen={isCheckInModalOpen} 
        onClose={() => {
          setIsCheckInModalOpen(false);
          setIsScannerOpen(false);
          setSelectedMemberForCheckIn(null);
          setEditingCheckIn(null);
          setCheckInCoach('');
        }} 
        title="Check In Management" 
        theme={theme} 
        maxWidth="max-w-4xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Calendar Section */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">
                  {format(currentCalendarDate, 'MMMM yyyy')}
                </h3>
                <button 
                  onClick={() => setIsOffDaysModalOpen(true)}
                  className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border rounded transition-all ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200' : 'bg-white border-zinc-200 text-zinc-400 hover:text-zinc-700'
                  }`}
                >
                  <Calendar size={12} /> OFF Days
                </button>
              </div>
              <div className="flex gap-1">
                <button 
                  onClick={() => setCurrentCalendarDate(subMonths(currentCalendarDate, 1))}
                  className={`p-1 rounded hover:bg-zinc-800 transition-colors ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}
                >
                  <Filter size={14} className="rotate-90" />
                </button>
                <button 
                  onClick={() => setCurrentCalendarDate(addMonths(currentCalendarDate, 1))}
                  className={`p-1 rounded hover:bg-zinc-800 transition-colors ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}
                >
                  <Filter size={14} className="-rotate-90" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-[10px] font-bold text-center text-zinc-400 uppercase py-1">{day}</div>
              ))}
              {(() => {
                const monthStart = startOfMonth(currentCalendarDate);
                const monthEnd = endOfMonth(monthStart);
                const startDate = startOfWeek(monthStart);
                const endDate = endOfWeek(monthEnd);
                const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

                return calendarDays.map((day, idx) => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const isOffDay = offDays.includes(dayStr);
                  const checkInsOnDay = members.flatMap(m => m.checkIns || []).filter(ci => isSameDay(new Date(ci.date), day));
                  const isCurrentMonth = isSameMonth(day, monthStart);
                  const isToday = isSameDay(day, new Date());

                  return (
                    <div 
                      key={idx}
                      onClick={() => {
                        setSelectedDateForLogs(day);
                        setIsDateLogsModalOpen(true);
                      }}
                      className={`min-h-[60px] p-1 border rounded-lg transition-all relative cursor-pointer hover:ring-1 hover:ring-red-500/30 ${
                        isCurrentMonth 
                          ? theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-100'
                          : theme === 'dark' ? 'bg-transparent border-transparent opacity-20' : 'bg-transparent border-transparent opacity-20'
                      } ${isToday ? 'ring-1 ring-red-500/50' : ''} ${isOffDay ? 'opacity-50 grayscale' : ''}`}
                    >
                      {isOffDay && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                          <span className="text-[8px] font-bold uppercase rotate-45 border border-red-500 text-red-500 px-1">OFF</span>
                        </div>
                      )}
                      <div className={`text-[10px] font-bold mb-1 ${isToday ? 'text-red-500' : 'text-zinc-400'}`}>
                        {format(day, 'd')}
                      </div>
                      <div className="space-y-0.5">
                        {checkInsOnDay.slice(0, 3).map((ci, i) => {
                          const member = members.find(m => m.id === ci.memberId);
                          return (
                            <div key={i} className="text-[8px] px-1 py-0.5 rounded bg-red-500/10 text-red-500 truncate font-medium">
                              {member?.firstName}
                            </div>
                          );
                        })}
                        {checkInsOnDay.length > 3 && (
                          <div className="text-[8px] text-zinc-400 text-center">+{checkInsOnDay.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Action Section */}
          <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
                  {editingCheckIn ? 'Edit Check In' : 'New Check In'}
                </h3>
                {!editingCheckIn && (
                  <div className="flex gap-2 mb-4">
                    <button 
                      onClick={() => setIsScannerOpen(!isScannerOpen)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-bold transition-all ${
                        isScannerOpen 
                          ? 'bg-red-600 border-red-600 text-white' 
                          : theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                      }`}
                    >
                      <Scan size={14} /> {isScannerOpen ? 'Close Scanner' : 'Scan QR'}
                    </button>
                  </div>
                )}

                {isScannerOpen && (
                  <div id="qr-reader" className="mb-4 rounded-lg overflow-hidden border border-zinc-700 bg-black aspect-square"></div>
                )}

                  <div className="space-y-3">
                    <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => setSelectedMemberForCheckIn({ id: 'walk_in', firstName: 'Walk', lastName: 'In' } as Member)}
                      className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase transition-all border ${
                        selectedMemberForCheckIn?.id === 'walk_in'
                          ? 'bg-red-600 border-red-600 text-white'
                          : theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-800' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                      }`}
                    >
                      Walk In
                    </button>
                    <button
                      onClick={() => setSelectedMemberForCheckIn({ id: 'free_lance', firstName: 'Free', lastName: 'Lance' } as Member)}
                      className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase transition-all border ${
                        selectedMemberForCheckIn?.id === 'free_lance'
                          ? 'bg-red-600 border-red-600 text-white'
                          : theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-800' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                      }`}
                    >
                      Free Lance
                    </button>
                    </div>
                    {selectedMemberForCheckIn?.id !== 'free_lance' && (
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Primary Member</label>
                        <select 
                          value={selectedMemberForCheckIn && selectedMemberForCheckIn.id !== 'walk_in' && selectedMemberForCheckIn.id !== 'free_lance' ? selectedMemberForCheckIn.id : ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'add_new') {
                              setIsMemberModalOpen(true);
                            } else {
                              const member = members.find(m => m.id === val);
                              setSelectedMemberForCheckIn(member || null);
                              if (member) {
                                setCheckInCoach(member.assignedCoachName || checkInCoach || '');
                                if (!selectedMultiMemberIds.includes(member.id)) {
                                  setSelectedMultiMemberIds([member.id]);
                                }
                              }
                            }
                          }}
                          className={`w-full p-2 rounded-lg border text-xs focus:outline-none focus:ring-2 transition-all ${
                            theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-cyan-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-cyan-500/30'
                          }`}
                        >
                          <option value="">Choose primary member...</option>
                          {members.filter(m => m.packageId !== 'walk-in' && m.packageId !== 'free-lance').map(m => (
                            <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                          ))}
                          <option value="add_new" className="font-bold text-[#00B8C8]">+ Add New Member</option>
                        </select>

                        {!editingCheckIn && selectedMemberForCheckIn?.id !== 'walk_in' && (
                          <div className={`p-2.5 rounded-lg border space-y-2 ${theme === 'dark' ? 'bg-zinc-900/70 border-zinc-700/80' : 'bg-white border-slate-200'}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase text-[#00B8C8]">
                                Multi-Client Session Roster ({selectedMultiMemberIds.length} Subscribed)
                              </span>
                              {selectedMultiMemberIds.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedMultiMemberIds(selectedMemberForCheckIn ? [selectedMemberForCheckIn.id] : [])}
                                  className="text-[9px] text-zinc-400 hover:text-zinc-200 uppercase font-bold"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                            <p className="text-[9px] text-zinc-400 leading-tight">
                              Select additional subscribed members training in the same session (1 session deducted per selected member):
                            </p>
                            <div className="space-y-1 pr-1">
                              {members
                                .filter(m => m.packageId !== 'walk-in' && m.packageId !== 'free-lance' && m.status === 'active' && !m.isFrozen)
                                .map(m => {
                                  const isChecked = selectedMultiMemberIds.includes(m.id) || selectedMemberForCheckIn?.id === m.id;
                                  return (
                                    <label key={m.id} className={`flex items-center justify-between text-[11px] px-2 py-1 rounded cursor-pointer ${theme === 'dark' ? 'hover:bg-zinc-800/80' : 'hover:bg-slate-100'}`}>
                                      <span className="flex items-center gap-2 truncate">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              const next = Array.from(new Set([...selectedMultiMemberIds, m.id]));
                                              setSelectedMultiMemberIds(next);
                                              if (!selectedMemberForCheckIn) {
                                                setSelectedMemberForCheckIn(m);
                                                setCheckInCoach(m.assignedCoachName || checkInCoach || '');
                                              }
                                            } else {
                                              const next = selectedMultiMemberIds.filter(id => id !== m.id);
                                              setSelectedMultiMemberIds(next);
                                              if (selectedMemberForCheckIn?.id === m.id) {
                                                const fallback = members.find(mem => mem.id === next[0]) || null;
                                                setSelectedMemberForCheckIn(fallback);
                                              }
                                            }
                                          }}
                                          className="accent-[#00B8C8]"
                                        />
                                        <span className="truncate font-medium">{m.firstName} {m.lastName}</span>
                                      </span>
                                      <span className="text-[9px] font-mono text-zinc-400">
                                        {getCycleUsedSessions(m)}/{packages.find(p => p.id === m.packageId)?.sessions || 0}
                                      </span>
                                    </label>
                                  );
                                })}
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1">
                                + Additional Non-Subscribed Guests (Comma-Separated)
                              </label>
                              <input
                                type="text"
                                placeholder="e.g. Guest 1, Guest 2"
                                value={multiGuestNames}
                                onChange={e => setMultiGuestNames(e.target.value)}
                                className={`w-full p-1.5 rounded border text-[11px] ${
                                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'
                                }`}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  {selectedMemberForCheckIn?.id === 'walk_in' && (
                    <div className={`p-3 rounded-lg border space-y-3 ${theme === 'dark' ? 'bg-zinc-800/30 border-zinc-700' : 'bg-white border-slate-200'}`}>
                      <input type="text" placeholder="Name" value={walkInName} onChange={e => setWalkInName(e.target.value)} className={`w-full p-2 rounded border text-xs ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`} />
                      <input type="text" placeholder="Phone" value={walkInPhone} onChange={e => setWalkInPhone(e.target.value)} className={`w-full p-2 rounded border text-xs ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`} />
                      <input type="number" placeholder="Fee" value={walkInFee || ''} onChange={e => setWalkInFee(e.target.value)} className={`w-full p-2 rounded border text-xs ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`} />
                      <select 
                        value={walkInCoach} 
                        onChange={e => {
                          if (e.target.value === 'add_new') {
                            setIsCoachModalOpen(true);
                          } else {
                            setWalkInCoach(e.target.value);
                          }
                        }} 
                        className={`w-full p-2 rounded border text-xs ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark]' : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'}`}
                      >
                        <option value="">Select Coach</option>
                        {coaches.map(c => <option key={c.id} value={`${c.firstName} ${c.lastName}`}>{c.firstName} {c.lastName}</option>)}
                        <option value="add_new" className="font-bold text-red-500">+ Add New Coach</option>
                      </select>
                    </div>
                  )}

                  {selectedMemberForCheckIn?.id === 'free_lance' && (
                    <div className={`p-3 rounded-lg border space-y-3 ${theme === 'dark' ? 'bg-zinc-800/30 border-zinc-700' : 'bg-white border-slate-200'}`}>
                      <select 
                        value={coaches.some(c => `${c.firstName} ${c.lastName}` === freeLanceCoachName) ? freeLanceCoachName : (freeLanceCoachName ? 'Other' : '')} 
                        onChange={e => {
                          if (e.target.value === 'Other') {
                            setFreeLanceCoachName('Manual Entry');
                          } else {
                            setFreeLanceCoachName(e.target.value);
                          }
                        }} 
                        className={`w-full p-2 rounded border text-xs ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark]' : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'}`}
                      >
                        <option value="">Select Coach</option>
                        {coaches.map(c => <option key={c.id} value={`${c.firstName} ${c.lastName}`}>{c.firstName} {c.lastName}</option>)}
                        <option value="Other">Other / Manual</option>
                      </select>
                      
                      {(freeLanceCoachName === 'Manual Entry' || (freeLanceCoachName && !coaches.some(c => `${c.firstName} ${c.lastName}` === freeLanceCoachName))) && (
                        <div className="space-y-2">
                           <input 
                             type="text" 
                             placeholder="Enter coach name..."
                             value={freeLanceCoachName === 'Manual Entry' ? '' : freeLanceCoachName}
                             onChange={e => setFreeLanceCoachName(e.target.value)}
                             className={`w-full p-2 rounded border text-xs ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                           />
                           <div className="flex gap-2">
                              <button 
                                onClick={() => setManualCoachType('inhouse')}
                                className={`flex-1 py-1 rounded text-[8px] font-bold uppercase border transition-all ${manualCoachType === 'inhouse' ? 'bg-red-600 border-red-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                              >
                                In-House
                              </button>
                              <button 
                                onClick={() => setManualCoachType('freelance')}
                                className={`flex-1 py-1 rounded text-[8px] font-bold uppercase border transition-all ${manualCoachType === 'freelance' ? 'bg-red-600 border-red-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                              >
                                Freelance
                              </button>
                           </div>
                           <p className="text-[8px] text-zinc-500 italic">Coach will be created in database instantly on confirmation.</p>
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Guest / Client Name (Optional)</label>
                        <input
                          type="text"
                          placeholder="Client name brought by trainer..."
                          value={trainerGuestName}
                          onChange={e => setTrainerGuestName(e.target.value)}
                          className={`w-full p-2 rounded border text-xs ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                        />
                      </div>
                    </div>
                  )}
                  {selectedMemberForCheckIn && selectedMemberForCheckIn.id !== 'walk_in' && selectedMemberForCheckIn.id !== 'free_lance' && (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-zinc-400 uppercase font-bold">
                            {(() => {
                              const holder = getPrimaryGroupHolder(selectedMemberForCheckIn);
                              const pkg = packages.find(p => p.id === holder.packageId);
                              return pkg?.type === 'group' ? 'Shared Family / Group Pool' : 'Package Allowance';
                            })()}
                          </span>
                          {(() => {
                            const holder = getPrimaryGroupHolder(selectedMemberForCheckIn);
                            const pkg = packages.find(p => p.id === holder.packageId);
                            const used = getCycleUsedSessions(holder);
                            const total = pkg?.sessions || 0;
                            const remaining = Math.max(0, total - used);
                            const isLimitReached = used >= total;
                            return (
                              <div className="text-right">
                                <span className={`text-xs font-bold ${isLimitReached ? 'text-red-500' : 'text-green-500'}`}>
                                  {used} / {total}
                                </span>
                                <div className="text-[8px] text-zinc-400 uppercase font-bold">({remaining} left)</div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Shared Multi-Person / Family Package Pool Attendance Selector */}
                        {(() => {
                          const holder = getPrimaryGroupHolder(selectedMemberForCheckIn);
                          const pkg = packages.find(p => p.id === holder.packageId);
                          if (!pkg || pkg.type !== 'group' || selectedMultiMemberIds.length > 1) return null;
                          const maxPeople = Math.max(2, pkg.maxPeople || 2);
                          const familyNames = [
                            `${holder.firstName} ${holder.lastName}`,
                            ...(holder.groupMembers || []).map(g => g.name).filter(Boolean)
                          ];
                          return (
                            <div className="p-2.5 rounded-lg bg-[#00B8C8]/10 border border-[#00B8C8]/30 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase text-[#00B8C8]">
                                  Family / Group Shared Pool ({maxPeople} Max)
                                </span>
                                <span className="text-[9px] font-mono text-zinc-300">
                                  Deducting: -{selectedGroupParticipantCount} session(s)
                                </span>
                              </div>
                              {familyNames.length > 1 && (
                                <div className="text-[9px] text-zinc-400">
                                  Shared Roster: <span className="text-zinc-200 font-semibold">{familyNames.join(' • ')}</span>
                                </div>
                              )}
                              <div>
                                <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1">
                                  How many family/group members are attending now?
                                </label>
                                <div className="flex gap-1.5">
                                  {Array.from({ length: maxPeople }).map((_, idx) => {
                                    const countVal = idx + 1;
                                    const isSelected = selectedGroupParticipantCount === countVal;
                                    return (
                                      <button
                                        key={countVal}
                                        type="button"
                                        onClick={() => setSelectedGroupParticipantCount(countVal)}
                                        className={`flex-1 py-1 rounded text-[10px] font-bold uppercase border transition-all ${
                                          isSelected
                                            ? 'bg-[#00B8C8] border-[#00B8C8] text-slate-950'
                                            : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                                        }`}
                                      >
                                        {countVal} {countVal === 1 ? 'Person' : 'People'} (-{countVal})
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {selectedMemberForCheckIn.assignedCoachName && (
                          <div className="flex items-center justify-between text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-1 rounded">
                            <span className="font-bold uppercase">Assigned Trainer:</span>
                            <span className="font-bold">{selectedMemberForCheckIn.assignedCoachName}</span>
                          </div>
                        )}

                        {/* Notices */}
                        <div className="space-y-1">
                          {selectedMemberForCheckIn.isFrozen && (
                            <div className="flex items-center gap-1 text-[8px] font-bold text-cyan-400 uppercase bg-cyan-500/10 px-1.5 py-0.5 rounded">
                              <Snowflake size={8} /> Membership Frozen (Unfreeze to Check In)
                            </div>
                          )}
                          {selectedMemberForCheckIn.billingStatus === 'unpaid' && (
                            <div className="flex items-center gap-1 text-[8px] font-bold text-yellow-500 uppercase bg-yellow-500/10 px-1.5 py-0.5 rounded">
                              <AlertTriangle size={8} /> Still Unpaid
                            </div>
                          )}
                          {(() => {
                            const status = getStatus(selectedMemberForCheckIn.expiryDate, selectedMemberForCheckIn.status, selectedMemberForCheckIn.packageId, selectedMemberForCheckIn.isFrozen);
                            if (status === 'expire soon') {
                              return (
                                <div className="flex items-center gap-1 text-[8px] font-bold text-red-500 uppercase bg-red-500/10 px-1.5 py-0.5 rounded">
                                  <Clock size={8} /> Expiring in 5 days or less
                                </div>
                              );
                            }
                            if (status === 'expired') {
                              return (
                                <div className="flex items-center gap-1 text-[8px] font-bold text-red-600 uppercase bg-red-600/10 px-1.5 py-0.5 rounded">
                                  <XCircle size={8} /> Membership Expired
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </div>
                  )}

                      {selectedMemberForCheckIn && selectedMemberForCheckIn.id !== 'walk_in' && selectedMemberForCheckIn.id !== 'free_lance' && editingCheckIn && (
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Check In Time</label>
                          <input 
                            type="datetime-local" 
                            value={checkInDate}
                            onChange={(e) => setCheckInDate(e.target.value)}
                            className={`w-full p-2 rounded-lg border text-xs focus:outline-none focus:ring-2 transition-all ${
                              theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 focus:ring-red-500/50 [color-scheme:dark]' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-red-500/30'
                            }`}
                          />
                        </div>
                      )}
                      
                      {selectedMemberForCheckIn && selectedMemberForCheckIn.id !== 'walk_in' && selectedMemberForCheckIn.id !== 'free_lance' && (
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Coach Name</label>
                          <select 
                            value={coaches.some(c => `${c.firstName} ${c.lastName}` === checkInCoach) ? checkInCoach : (checkInCoach ? 'Other' : '')}
                            onChange={(e) => {
                              if (e.target.value === 'Other') {
                                setCheckInCoach('Manual Entry');
                              } else {
                                setCheckInCoach(e.target.value);
                              }
                            }}
                            className={`w-full p-2 rounded-lg border text-xs focus:outline-none focus:ring-2 transition-all ${
                              theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                            }`}
                          >
                            <option value="">Select a coach...</option>
                            {coaches.map(c => (
                              <option key={c.id} value={`${c.firstName} ${c.lastName}`}>{c.firstName} {c.lastName}</option>
                            ))}
                            <option value="Other">Other / Manual</option>
                          </select>
                          {(checkInCoach === 'Manual Entry' || (checkInCoach && !coaches.some(c => `${c.firstName} ${c.lastName}` === checkInCoach))) && (
                            <input 
                              type="text" 
                              placeholder="Enter coach name..."
                              value={checkInCoach === 'Manual Entry' ? '' : checkInCoach}
                              className={`w-full p-2 mt-2 rounded-lg border text-xs focus:outline-none focus:ring-2 transition-all ${
                                theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 focus:ring-cyan-500/50' : 'bg-white border-zinc-200 text-slate-900 focus:ring-cyan-500/30'
                              }`}
                              onChange={(e) => setCheckInCoach(e.target.value)}
                            />
                          )}

                          {(() => {
                            const coachObj = coaches.find(c => `${c.firstName} ${c.lastName}` === checkInCoach);
                            if (!coachObj) return null;
                            const contractObj = coachContracts.find(cc => cc.coachId === coachObj.id);
                            const baseSubCount = Math.max(
                              selectedMultiMemberIds.length,
                              selectedMemberForCheckIn && selectedMemberForCheckIn.id !== 'walk_in' && selectedMemberForCheckIn.id !== 'free_lance' ? 1 : 0
                            );
                            const effectiveSubCount =
                              baseSubCount === 1 && selectedGroupParticipantCount > 1
                                ? selectedGroupParticipantCount
                                : baseSubCount;
                            const guestCount = multiGuestNames.split(',').map(s => s.trim()).filter(Boolean).length;
                            const newClientsInThisCheckIn = Math.max(1, effectiveSubCount + guestCount);

                            // Check if this coach already checked in another client within the last 60 minutes today
                            const sameTimeframeMatch = !editingCheckIn ? findSameTimeframeCoachSession(coachObj.id) : null;
                            const prevClientsCount = sameTimeframeMatch ? sameTimeframeMatch.ledgerEntry.clientCount : 0;
                            const prevFee = sameTimeframeMatch
                              ? (sameTimeframeMatch.ledgerEntry.feeOverride !== undefined
                                  ? sameTimeframeMatch.ledgerEntry.feeOverride
                                  : sameTimeframeMatch.ledgerEntry.calculatedFee)
                              : 0;
                            const combinedClientsIfMerged = prevClientsCount + newClientsInThisCheckIn;
                            const mergedTotalFee = calculateCoachTieredFee(coachObj, contractObj, combinedClientsIfMerged);
                            const mergedDeltaFee = Math.max(0, Number((mergedTotalFee - prevFee).toFixed(2)));

                            const soloAutoFee = calculateCoachTieredFee(coachObj, contractObj, newClientsInThisCheckIn);
                            const isMerging = !!sameTimeframeMatch && mergeModeChoice === 'merge';
                            const displayedAutoFee = isMerging ? mergedTotalFee : soloAutoFee;

                            const coachFullNameLower = `${coachObj.firstName} ${coachObj.lastName}`.trim().toLowerCase();
                            const hasThirdParty = thirdPartyContracts.some(
                              tp =>
                                tp.status === 'active' &&
                                ((tp.linkedCoachIds || []).includes(coachObj.id) ||
                                  (tp.practitioners || []).some(
                                    p => p.id === coachObj.id || p.name.trim().toLowerCase() === coachFullNameLower
                                  ))
                            );
                            return (
                              <div className="mt-2 space-y-2">
                                {sameTimeframeMatch && (
                                  <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 space-y-2">
                                    <div className={`text-[11px] font-bold leading-snug ${theme === 'dark' ? 'text-amber-300' : 'text-amber-800'}`}>
                                      🔔 {(sameTimeframeMatch.ledgerEntry.clientNames || []).join(', ')} also checked in with Coach {coachObj.firstName} {coachObj.lastName} in this time slot ({format(new Date(sameTimeframeMatch.ledgerEntry.date), 'h:mm a')}, {sameTimeframeMatch.minutesAgo}m ago). Are they training together in the SAME session?
                                    </div>
                                    <div className="grid grid-cols-2 gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setMergeModeChoice('merge')}
                                        className={`py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase border transition-all ${
                                          mergeModeChoice === 'merge'
                                            ? 'bg-emerald-500 border-emerald-400 text-slate-950 shadow-sm'
                                            : theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-emerald-500/50' : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-500/50'
                                        }`}
                                      >
                                        Yes — Same Session (+{formatCurrency(mergedDeltaFee)})
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setMergeModeChoice('separate')}
                                        className={`py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase border transition-all ${
                                          mergeModeChoice === 'separate' || mergeModeChoice === 'ask'
                                            ? 'bg-[#00B8C8] border-[#00B8C8] text-slate-950 shadow-sm'
                                            : theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-cyan-500/50' : 'bg-white border-slate-200 text-slate-700 hover:border-cyan-500/50'
                                        }`}
                                      >
                                        No — Separate Session ({formatCurrency(soloAutoFee)})
                                      </button>
                                    </div>
                                  </div>
                                )}

                                <div className="p-2.5 rounded-lg bg-[#00B8C8]/10 border border-[#00B8C8]/30 space-y-2">
                                  <div className="flex items-center justify-between text-[10px]">
                                    <span className="font-bold uppercase text-[#00B8C8]">
                                      {isMerging
                                        ? `Merged Session (${combinedClientsIfMerged} Clients Total)`
                                        : `Tiered Coach Fee (${newClientsInThisCheckIn} ${newClientsInThisCheckIn === 1 ? 'Client' : 'Clients'})`}
                                    </span>
                                    <span className={`font-mono font-black ${theme === 'dark' ? 'text-zinc-100' : 'text-slate-900'}`}>
                                      {isMerging
                                        ? `+${formatCurrency(mergedDeltaFee)} Delta (Total ${formatCurrency(mergedTotalFee)})`
                                        : `Auto: ${formatCurrency(displayedAutoFee)}`}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-0.5">Session Fee Override ($)</label>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        placeholder={`Auto (${displayedAutoFee})`}
                                        value={sessionFeeOverrideInput}
                                        onChange={e => setSessionFeeOverrideInput(e.target.value)}
                                        className={`w-full p-1.5 rounded border text-xs font-mono ${
                                          theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
                                        }`}
                                      />
                                    </div>
                                    {hasThirdParty && (
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-0.5">3rd-Party Lead Source</label>
                                        <select
                                          value={checkInLeadSource}
                                          onChange={e => setCheckInLeadSource(e.target.value as any)}
                                          className={`w-full p-1.5 rounded border text-xs ${
                                            theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]' : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                                          }`}
                                        >
                                          <option value="facility">Facility Sourced</option>
                                          <option value="partner">Partner Sourced</option>
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      <div className="flex gap-2">
                        {editingCheckIn && (
                          <button 
                            onClick={() => {
                              setEditingCheckIn(null);
                              setSelectedMemberForCheckIn(null);
                              setCheckInCoach('');
                              setCheckInDate(new Date().toISOString().slice(0, 16));
                            }}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${
                              theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'bg-white border-zinc-200 text-zinc-400 hover:bg-zinc-50'
                            }`}
                          >
                            Cancel
                          </button>
                        )}
                        <button 
                          onClick={handleConfirmCheckIn}
                          className="el-btn-primary flex-[2] py-2 text-xs font-bold rounded-lg"
                        >
                          {editingCheckIn ? 'Update Check In' : 'Confirm Check In'}
                        </button>
                      </div>

                      <div className="pt-4 border-t border-zinc-700">
                        <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Today's Activity</h3>
                        <div className="space-y-2 pr-1">
                          {members.flatMap(m => (m.checkIns || []).map(ci => ({ ...ci, memberId: m.id })))
                            .filter(ci => isSameDay(new Date(ci.date), new Date()))
                            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                            .map(ci => {
                              const member = members.find(m => m.id === ci.memberId);
                              return (
                                <div key={ci.id} className="group flex items-center justify-between p-2 rounded bg-zinc-800/30 border border-zinc-700">
                                  <div>
                                    <div className="text-[10px] font-bold">{member?.firstName} {member?.lastName}</div>
                                    <div className="text-[8px] text-zinc-400">Coach: {ci.coach}</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="text-[8px] font-mono text-zinc-400">
                                      {format(new Date(ci.date), 'HH:mm')}
                                    </div>
                                    <button 
                                      onClick={() => startEditCheckIn(ci.memberId, ci as any)}
                                      className="p-1 text-zinc-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                      <Edit2 size={10} />
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteCheckIn(ci.memberId, ci.id)}
                                      className="p-1 text-zinc-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                      <Trash2 size={10} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Renew Membership Modal */}
      <Modal
        isOpen={!!memberForRenewal}
        onClose={() => setMemberForRenewal(null)}
        title={`Renew Membership — ${memberForRenewal?.firstName || ''} ${memberForRenewal?.lastName || ''}`}
        theme={theme}
        maxWidth="max-w-md"
      >
        {memberForRenewal && (
          <form onSubmit={handleConfirmRenewal} className="space-y-4">
            <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${theme === 'dark' ? 'bg-zinc-800/60 border-zinc-700 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'}`}>
              <div className="flex justify-between">
                <span className="text-zinc-400 font-bold uppercase">Previous Cycle:</span>
                <span>{memberForRenewal.startDate} → {memberForRenewal.expiryDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400 font-bold uppercase">Sessions Used in Cycle:</span>
                <span className="font-bold">{getCycleUsedSessions(memberForRenewal)} sessions (will archive & reset to 0)</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Renewal Package</label>
              <select
                required
                value={renewPackageId}
                onChange={e => setRenewPackageId(e.target.value)}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                }`}
              >
                <option value="">Select package...</option>
                {packages.map(pkg => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} ({formatCurrency(pkg.price)} • {pkg.duration} mo • {pkg.sessions} sessions)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1.5">Assigned Trainer (Optional)</label>
              <select
                value={renewCoachId}
                onChange={e => setRenewCoachId(e.target.value)}
                className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  theme === 'dark' ? 'bg-zinc-800 border-zinc-700 text-zinc-100 [color-scheme:dark] focus:ring-red-500/50' : 'bg-white border-zinc-200 text-slate-900 [color-scheme:light] focus:ring-red-500/30'
                }`}
              >
                <option value="">No Assigned Trainer</option>
                {coaches.map(c => (
                  <option key={c.id} value={c.id}>{c.firstName} {c.lastName} ({c.type === 'inhouse' ? 'In-House' : 'Freelance'})</option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-600/20"
            >
              Confirm Renewal & Reset Session Quota
            </button>
          </form>
        )}
      </Modal>

      {/* Date Logs Modal */}
      <Modal 
        isOpen={isDateLogsModalOpen} 
        onClose={() => setIsDateLogsModalOpen(false)} 
        title={`Logs for ${selectedDateForLogs ? format(selectedDateForLogs, 'MMM d, yyyy') : ''}`} 
        theme={theme} 
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          {selectedDateForLogs && (() => {
            const logs = members.flatMap(m => (m.checkIns || []).map(ci => ({ ...ci, memberName: `${m.firstName} ${m.lastName}`, memberId: m.id })))
              .filter(ci => isSameDay(new Date(ci.date), selectedDateForLogs))
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            if (logs.length === 0) return <div className="text-center py-8 text-zinc-400 text-sm">No check-ins for this day.</div>;

            return (
              <div className="space-y-2">
                {logs.map(log => (
                  <div key={log.id} className={`p-3 rounded-lg border flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                    <div>
                      <div className="text-xs font-bold">{log.memberName}</div>
                      <div className="text-[10px] text-zinc-400">{format(new Date(log.date), 'h:mm a')} • Coach: {log.coach || 'None'}</div>
                    </div>
                    <div className="flex gap-1">
                      <button 
                        onClick={() => startEditCheckIn(log.memberId, log as any)}
                        className={`p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-500 transition-colors`}
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button 
                        onClick={() => handleDeleteCheckIn(log.memberId, log.id)}
                        className={`p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-500 transition-colors`}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </Modal>

      {/* Off Days Modal */}
      <Modal isOpen={isOffDaysModalOpen} onClose={() => setIsOffDaysModalOpen(false)} title="Off Days Management" theme={theme}>
        <div className="space-y-6">
          <div className="flex gap-2">
            <input 
              type="date" 
              value={newOffDay}
              onChange={(e) => setNewOffDay(e.target.value)}
              className={`flex-1 p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                theme === 'dark' 
                  ? 'bg-zinc-800 border-zinc-700 text-zinc-100 focus:ring-red-500/50 [color-scheme:dark]' 
                  : 'bg-white border-zinc-200 text-zinc-900 focus:ring-red-500/30 [color-scheme:light]'
              }`}
            />
            <button 
              onClick={handleAddOffDay}
              className="px-4 py-2.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all shadow-sm"
            >
              Add Date
            </button>
          </div>

          <div className="space-y-2 pr-2">
            {offDays.length === 0 ? (
              <p className="text-center py-8 text-zinc-400 text-sm">No off days scheduled</p>
            ) : (
              offDays.map(date => (
                <div 
                  key={date} 
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-100'
                  }`}
                >
                  <span className={`font-mono text-xs ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}`}>
                    {format(new Date(date), 'EEEE, MMMM do, yyyy')}
                  </span>
                  <button 
                    onClick={() => handleRemoveOffDay(date)}
                    className="p-1.5 text-zinc-500 hover:text-red-500 transition-colors"
                  >
                    <XCircle size={16} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className={`pt-4 border-t transition-colors ${theme === 'dark' ? 'border-zinc-700/50' : 'border-zinc-200'}`}>
            <button 
              onClick={() => setIsOffDaysModalOpen(false)} 
              className={`w-full p-3 font-semibold rounded-lg transition-all shadow-sm ${
                theme === 'dark' ? 'bg-zinc-100 text-zinc-900 hover:bg-white' : 'bg-zinc-800 text-white hover:bg-zinc-800'
              }`}
            >
              Update
            </button>
          </div>
        </div>
      </Modal>

      {/* Billing Modal */}
      <Modal isOpen={isBillingModalOpen} onClose={() => setIsBillingModalOpen(false)} title="Confirm Payment" theme={theme} maxWidth="max-w-md">
        {selectedMemberForBilling && (() => {
          const packageFullPrice = selectedMemberForBilling.packageId === 'walk-in'
            ? (selectedMemberForBilling.expectedFee || 0)
            : (selectedMemberForBilling.expectedFee || packages.find(p => p.id === selectedMemberForBilling.packageId)?.price || 0);
          const alreadyPaid = selectedMemberForBilling.totalPaid || 0;
          const remainingBeforeDiscount = Math.max(0, packageFullPrice - alreadyPaid);
          const afterManualDiscount = remainingBeforeDiscount * (1 - billingDiscount / 100);
          const appliedCoupon = getAppliedGymCoupon(couponCodeInput);
          const couponDisc = appliedCoupon
            ? (appliedCoupon.discountType === 'percentage'
                ? afterManualDiscount * ((appliedCoupon.discountValue ?? (appliedCoupon as any).value ?? 0) / 100)
                : (appliedCoupon.discountValue ?? (appliedCoupon as any).value ?? 0))
            : 0;
          const netPayable = Math.max(0, afterManualDiscount - couponDisc);

          return (
            <div className="space-y-6">
              <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-zinc-400 uppercase">Member</span>
                  <span className="font-bold">{selectedMemberForBilling.firstName} {selectedMemberForBilling.lastName}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-zinc-400 uppercase">{selectedMemberForBilling.packageId === 'walk-in' ? 'Walk-in Fee' : 'Total Package Fee'}</span>
                  <span className="font-bold">{formatCurrency(packageFullPrice)}</span>
                </div>
                {alreadyPaid > 0 && (
                  <div className="flex justify-between items-center mb-2 text-amber-500">
                    <span className="text-xs font-bold uppercase">Already Paid</span>
                    <span className="font-bold">{formatCurrency(alreadyPaid)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-zinc-400 uppercase">Remaining Balance</span>
                  <span className="font-bold text-red-500">{formatCurrency(remainingBeforeDiscount)}</span>
                </div>
                <div className="flex justify-between items-center mb-4 pb-3 border-b border-zinc-700/40">
                  <span className="text-xs font-bold text-zinc-400 uppercase">Wallet Credit</span>
                  <span className="font-bold text-emerald-500">{formatCurrency(selectedMemberForBilling.balance || 0)}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-zinc-400 uppercase">Discount %</label>
                    <input 
                      type="number" 
                      value={billingDiscount || 0}
                      onChange={e => setBillingDiscount(Number(e.target.value) || 0)}
                      className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                        theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                      }`}
                      min="0"
                      max="100"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-zinc-400 uppercase">Amount to Pay Now</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={String(netPayable)}
                      value={billingPaymentAmount !== '' ? billingPaymentAmount : netPayable}
                      onChange={e => setBillingPaymentAmount(e.target.value)}
                      className={`w-full p-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all font-bold ${
                        theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                      }`}
                      min="0.01"
                      max={netPayable}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-zinc-400 uppercase">Coupon Code</label>
                    <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                      <input 
                        type="text" 
                        placeholder="PROMO"
                        value={couponCodeInput}
                        onChange={e => setCouponCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                        className={`w-full pl-9 pr-3 py-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all uppercase font-black text-xs ${
                          appliedCoupon
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                            : theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                        }`}
                      />
                    </div>
                    {appliedCoupon && (
                      <p className="text-[11px] font-bold text-emerald-500">
                        ✓ -{appliedCoupon.discountType === 'percentage' ? `${appliedCoupon.discountValue ?? (appliedCoupon as any).value}%` : formatCurrency(appliedCoupon.discountValue ?? (appliedCoupon as any).value)}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-zinc-400 uppercase">Reward Code</label>
                    <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                      <input 
                        type="text" 
                        placeholder="CASHBACK"
                        value={cashbackCodeInput}
                        onChange={e => setCashbackCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                        className={`w-full pl-9 pr-3 py-2.5 rounded-lg border focus:outline-none focus:ring-2 transition-all uppercase font-black text-xs ${
                          theme === 'dark' ? 'bg-zinc-800 border-zinc-700 focus:ring-red-500/50' : 'bg-white border-zinc-200 focus:ring-red-500/30'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 mt-4">
                  <label className="block text-xs font-bold text-zinc-400 uppercase">Payment Method</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['cash', 'card', 'transfer', 'member_balance'] as const).map(method => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setBillingPaymentMethod(method)}
                        className={`flex items-center justify-center gap-1 py-2.5 rounded-lg text-[10px] font-bold uppercase border transition-all ${
                          billingPaymentMethod === method
                            ? 'bg-[#00B8C8] border-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]'
                            : theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800 text-zinc-400 hover:border-cyan-500/40' : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        {method === 'cash' && <DollarSign size={12} />}
                        {method === 'card' && <CreditCard size={12} />}
                        {method === 'member_balance' && <User size={12} />}
                        {method === 'member_balance' ? 'Wallet' : method}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center p-4 bg-cyan-500/10 rounded-xl border border-cyan-500/30">
                <div>
                  <span className="text-sm font-bold text-[#00B8C8] uppercase block">Paying Now</span>
                  <span className="text-[10px] text-zinc-400">Net Balance Due: {formatCurrency(netPayable)}</span>
                </div>
                <span className="text-2xl font-black font-mono text-[#00B8C8]">
                  {formatCurrency(billingPaymentAmount !== '' ? Number(billingPaymentAmount) || 0 : netPayable)}
                </span>
              </div>

              <button 
                onClick={handleConfirmPayment}
                className="w-full py-3 bg-[#00B8C8] text-slate-950 font-bold rounded-xl hover:bg-[#0099A8] transition-all shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]"
              >
                Confirm Payment
              </button>
            </div>
          );
        })()}
      </Modal>

      {/* Coach Billing Modal */}
      <Modal isOpen={isCoachBillingModalOpen} onClose={() => setIsCoachBillingModalOpen(false)} title="Confirm Coach Payment" theme={theme} maxWidth="max-w-md">
        {selectedCoachForBilling && (
          <div className="space-y-6">
            <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-bold text-zinc-400 uppercase">Coach</span>
                <span className="font-bold">{selectedCoachForBilling.firstName} {selectedCoachForBilling.lastName}</span>
              </div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-bold text-zinc-400 uppercase">Contract Price</span>
                <span className="font-bold">{formatCurrency(coachContracts.find(c => c.coachId === selectedCoachForBilling.id)?.price || 0)}</span>
              </div>
            </div>

            <div className="flex justify-between items-center p-4 bg-cyan-500/10 rounded-xl border border-cyan-500/30">
              <span className="text-sm font-bold text-[#00B8C8] uppercase">Total to Pay</span>
              <span className="text-2xl font-black font-mono text-[#00B8C8]">
                {formatCurrency(coachContracts.find(c => c.coachId === selectedCoachForBilling.id)?.price || 0)}
              </span>
            </div>

            <button 
              onClick={handleConfirmCoachPayment}
              className="w-full py-3 bg-[#00B8C8] text-slate-950 font-bold rounded-xl hover:bg-[#0099A8] transition-all shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]"
            >
              Confirm & Mark as Paid
            </button>
          </div>
        )}
      </Modal>

      {/* Hidden ID Card for PDF Generation */}
      {selectedMemberForCard && (
        <div className="fixed -left-[9999px] top-0">
          <div 
            ref={idCardRef}
            className="w-[340px] h-[216px] p-6 rounded-none flex flex-col justify-between relative overflow-hidden border"
            style={{ 
              fontFamily: 'Inter, sans-serif',
              backgroundColor: '#0B0F17',
              color: '#ffffff',
              borderColor: 'rgba(0, 184, 200, 0.35)'
            }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', backgroundColor: '#00B8C8' }} />
            <div className="flex justify-between items-start relative z-10 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {systemLogo ? (
                    <img src={systemLogo} alt="Logo" className="w-4 h-4 object-contain brightness-0 invert" style={{ filter: 'brightness(0) invert(1)' }} />
                  ) : (
                    <CreditCard size={14} style={{ color: '#00B8C8' }} />
                  )}
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#00B8C8' }}>{systemName || 'Vescio Nexus'}</span>
                </div>
                <h2 className="text-xl font-black uppercase tracking-tight leading-none">Member Pass</h2>
              </div>
              <div className="text-right">
                <div className="text-[8px] font-bold uppercase tracking-widest" style={{ color: '#71717a' }}>Member ID</div>
                <div className="text-[10px] font-mono" style={{ color: '#00B8C8' }}>#{selectedMemberForCard.id.slice(-6)}</div>
              </div>
            </div>

            <div className="flex gap-6 items-start relative z-10 flex-1">
              <div className="w-24 h-24 p-1 rounded-lg shrink-0 flex flex-col items-center justify-center" style={{ backgroundColor: '#ffffff' }}>
                {selectedMemberForCard.qrCode && (
                  <DynamicQRImage value={selectedMemberForCard.qrCode} className="w-full h-full object-contain" />
                )}
              </div>
              <div className="flex-1 pt-1">
                <div className="mb-3">
                  <div className="text-[8px] font-bold uppercase tracking-widest mb-1" style={{ color: '#71717a' }}>Full Name</div>
                  <div className="text-base font-bold leading-tight">{selectedMemberForCard.firstName} {selectedMemberForCard.lastName}</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[8px] font-bold uppercase tracking-widest mb-1" style={{ color: '#71717a' }}>Date of Birth</div>
                    <div className="text-[10px] font-medium">{selectedMemberForCard.dob || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-[8px] font-bold uppercase tracking-widest mb-1" style={{ color: '#71717a' }}>Phone</div>
                    <div className="text-[10px] font-medium">{selectedMemberForCard.phone || 'N/A'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-end relative z-10 pt-3 border-t" style={{ borderTopColor: 'rgba(39, 39, 42, 0.5)' }}>
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-bold uppercase tracking-widest" style={{ color: '#71717a' }}>Valid Until</span>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#10b981' }}>{selectedMemberForCard.expiryDate}</span>
              </div>
              <div className="text-[8px] font-medium uppercase tracking-wider" style={{ color: '#00B8C8' }}>Generated by Vescio Nexus ERP</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GymMembershipPage;
