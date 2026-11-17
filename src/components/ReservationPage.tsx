import React, { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, LogOut, Tag, DollarSign, CreditCard, User } from 'lucide-react';
import { Header } from './Header';
import { CourtTabs } from './CourtTabs';
import { WeeklyCalendar } from './WeeklyCalendar';
import { Modal } from './Modal';
import { useFirebase } from '../contexts/FirebaseContext';
import { useTheme } from '../contexts/ThemeContext';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, doc, setDoc, updateDoc, addDoc, deleteDoc, deleteField, runTransaction, serverTimestamp, getDocs } from 'firebase/firestore';
import { processLedgerTransaction, processReversalTransaction, stripUndefined } from '../lib/transaction-engine';
import { getOrCreateGhostMember } from '../lib/firestore-utils';
import { Coupon } from '../types';
import { toast } from 'sonner';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

const ReservationPage: React.FC = () => {
  const { user, login, logout, authLoading, formatCurrency, currency, convertFromBase, convertToBase } = useFirebase();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const theme: 'dark' | 'light' = isDarkMode ? 'dark' : 'light';
  const [activeCourt, setActiveCourt] = useState('basketball');
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [isRatesModalOpen, setIsRatesModalOpen] = useState(false);
  const [isOffDaysModalOpen, setIsOffDaysModalOpen] = useState(false);
  const [offDays, setOffDays] = useState<string[]>([]);
  const [newOffDay, setNewOffDay] = useState('');
  const [rates, setRates] = useState({
    public: { basketballFull: 60, basketballHalf: 35, padel: 40, tennis: 30 },
    academy: { basketballFull: 60, basketballHalf: 35, padel: 40, tennis: 30 },
    private: { basketballFull: 60, basketballHalf: 35, padel: 40, tennis: 30, perPlayer: 10 },
    hustle: { basketballFull: 60, basketballHalf: 35, padel: 40, tennis: 30, perPlayer: 0 }
  });
  const [tempRates, setTempRates] = useState(rates);
  const [ratesCategory, setRatesCategory] = useState<'public' | 'academy' | 'private' | 'hustle'>('public');
  
  const [bookings, setBookings] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [coaches, setCoaches] = useState<any[]>([]);
  const [coachContracts, setCoachContracts] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const message = error instanceof Error ? error.message : String(error);
    toast.error(`Operation failed: ${message}`);
    const errInfo = {
      error: message,
      authInfo: {
        userId: user?.uid,
        email: user?.email,
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  };

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, 'bookings'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setBookings(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'bookings'));

    const unsubMembers = onSnapshot(collection(db, 'members'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMembers(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'members'));

    const unsubCoaches = onSnapshot(collection(db, 'coaches'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCoaches(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'coaches'));

    const unsubCoachContracts = onSnapshot(collection(db, 'coachContracts'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCoachContracts(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'coachContracts'));

    const unsubCoupons = onSnapshot(collection(db, 'coupons'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Coupon));
      setCoupons(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'coupons'));

    return () => {
      unsubscribe();
      unsubMembers();
      unsubCoaches();
      unsubCoachContracts();
      unsubCoupons();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(doc(db, 'settings', 'court_config'), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        if (data.rates) {
          setRates(prev => ({
            ...prev,
            ...data.rates,
            hustle: data.rates.hustle || prev.hustle
          }));
        }
        if (data.offDays) setOffDays(data.offDays);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'settings/court_config'));

    return () => unsubscribe();
  }, [user]);

  const [allowPastDatesOverride, setAllowPastDatesOverride] = useState(false);

  const [newBooking, setNewBooking] = useState({
    name: '',
    phone: '',
    date: '',
    type: 'full',
    startTime: '',
    endTime: '',
    category: 'public' as 'public' | 'academy' | 'private' | 'hustle',
    numPlayers: 1,
    memberId: ''
  });

  const [bookingMode, setBookingMode] = useState<'walk-in' | 'fixed'>('walk-in');
  const [fixedWeeks, setFixedWeeks] = useState<number>(1);
  const [fixedDiscount, setFixedDiscount] = useState<number>(0);
  const [priceOverride, setPriceOverride] = useState<string>('');
  const [isIndividualAccess, setIsIndividualAccess] = useState<boolean>(false);
  const [individualAccessScope, setIndividualAccessScope] = useState<'Half Court' | 'Full Court'>('Half Court');
  const [individualAccessRate, setIndividualAccessRate] = useState<string>('');

  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [cashInAmount, setCashInAmount] = useState<string>('');
  const [cashInDiscount, setCashInDiscount] = useState<number>(0);
  const [extraFeeAmount, setExtraFeeAmount] = useState<number>(0);
  const [extraFeeDescription, setExtraFeeDescription] = useState<string>('');
  const [cashInPaymentMethod, setCashInPaymentMethod] = useState<'cash' | 'card' | 'member_balance'>('cash');
  const [couponCodeInput, setCouponCodeInput] = useState<string>('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [cashbackCodeInput, setCashbackCodeInput] = useState<string>('');

  const computeSessionHourlyRate = (
    court: string,
    courtType: string,
    category: string,
    players: number | null | undefined
  ) => {
    if (category === 'academy') {
      return { baseCourtOrPrivateRate: 0, extraPlayerRate: 0, extraPlayers: 0, hourlyRate: 0 };
    }
    const catRates = (rates as any)[category] || rates.public;
    let baseCourtOrPrivateRate = 0;
    if (court === 'basketball') {
      baseCourtOrPrivateRate = (courtType === 'HCA' || courtType === 'HCB')
        ? Number(catRates.basketballHalf ?? rates.public.basketballHalf ?? 0)
        : Number(catRates.basketballFull ?? rates.public.basketballFull ?? 0);
    } else if (court === 'padel1' || court === 'padel2') {
      baseCourtOrPrivateRate = Number(catRates.padel ?? rates.public.padel ?? 0);
    } else if (court === 'tennis') {
      baseCourtOrPrivateRate = Number(catRates.tennis ?? rates.public.tennis ?? 0);
    }

    const playerCount = Math.max(1, Number(players) || 1);
    const extraPlayers = Math.max(0, playerCount - 1);
    const extraPlayerRate = (category === 'private' || category === 'hustle')
      ? (Number(catRates.perPlayer) || 0)
      : 0;
    const hourlyRate = baseCourtOrPrivateRate + (extraPlayers * extraPlayerRate);

    return { baseCourtOrPrivateRate, extraPlayerRate, extraPlayers, hourlyRate };
  };

  const getBookingTotal = (booking: any) => {
    if (!booking) return 0;
    if (booking.category === 'academy') return 0;
    const matchingSlots = bookings.filter(b => {
      if (booking.groupId && b.groupId) {
        return b.groupId === booking.groupId;
      }
      return b.name === booking.name &&
        (b.date || b.day) === (booking.date || booking.day) &&
        b.type === booking.type &&
        (b.court || 'basketball') === (booking.court || 'basketball');
    });

    if (matchingSlots.length === 0) return 0;

    // Only use locked rateApplied if already cashed_in, individual access, or explicitly overridden with custom pricing
    if (booking.status === 'cashed_in' || booking.hasCustomPricing || booking.isIndividualAccess || booking.bookingSubType === 'individual_access') {
      if (booking.lockedTotalPrice !== undefined && Number(booking.lockedTotalPrice) >= 0 && booking.status !== 'cashed_in') {
        return Number(booking.lockedTotalPrice);
      }
      return matchingSlots.reduce((sum, b) => {
        const slotHourly = b.rateApplied !== undefined
          ? Number(b.rateApplied)
          : computeSessionHourlyRate(b.court || 'basketball', b.type || 'full', b.category || 'public', b.numPlayers).hourlyRate;
        return sum + (slotHourly / 4);
      }, 0);
    }

    const court = booking.court || 'basketball';
    const category = booking.category || 'public';
    const { hourlyRate } = computeSessionHourlyRate(court, booking.type || 'full', category, booking.numPlayers);
    const durationInHours = matchingSlots.length / 4;
    const totalSessionPrice = durationInHours * hourlyRate;
    return totalSessionPrice;
  };

  useEffect(() => {
    if (selectedBooking) {
      const total = getBookingTotal(selectedBooking) || 0;
      let discounted = total * (1 - (cashInDiscount || 0) / 100);

      const code = couponCodeInput.trim().toUpperCase();
      if (code) {
        const match = coupons.find(c => c.code?.toUpperCase() === code);
        const isExpired = match?.expiryDate && new Date(match.expiryDate).getTime() < Date.now();
        const isLimitReached = match && match.usageLimit > 0 && (match.usageCount || 0) >= match.usageLimit;
        const isModAllowed = match && (
          !match.applicableModules ||
          match.applicableModules.length === 0 ||
          match.applicableModules.includes('courts') ||
          match.applicableModules.includes('reservation')
        );
        if (match && match.isActive !== false && !isExpired && !isLimitReached && isModAllowed) {
          setAppliedCoupon(match);
          const discVal = match.discountValue ?? (match as any).value ?? 0;
          const couponDisc = match.discountType === 'percentage'
            ? discounted * (discVal / 100)
            : discVal;
          discounted = Math.max(0, discounted - couponDisc);
        } else {
          setAppliedCoupon(null);
        }
      } else {
        setAppliedCoupon(null);
      }

      const finalAmount = Math.max(0, discounted + (extraFeeAmount || 0));
      const displayAmount = convertFromBase(finalAmount);
      setCashInAmount(isNaN(displayAmount) ? '0' : Math.round(displayAmount).toString());
    } else {
      setCashInAmount('');
      setCashInDiscount(0);
      setExtraFeeAmount(0);
      setExtraFeeDescription('');
      setCashInPaymentMethod('cash');
      setCouponCodeInput('');
      setAppliedCoupon(null);
      setCashbackCodeInput('');
    }
  }, [selectedBooking, cashInDiscount, extraFeeAmount, couponCodeInput, coupons, bookings, rates]);

  const [cancelReason, setCancelReason] = useState<string>('');

  const handleCancel = async (bookingToCancel: any) => {
    if (!user) return;
    if (!cancelReason.trim()) {
      toast.error('Please enter a cancellation reason.');
      return;
    }
    
    console.log('Cancelling booking:', bookingToCancel);
    
    const reason = cancelReason.trim();

    const matchingSlots = bookings.filter(b => {
      if (bookingToCancel.groupId && b.groupId) {
        return b.groupId === bookingToCancel.groupId;
      }
      return b.name === bookingToCancel.name &&
        (b.date || b.day) === (bookingToCancel.date || bookingToCancel.day) &&
        b.type === bookingToCancel.type &&
        (b.court || 'basketball') === (bookingToCancel.court || 'basketball');
    });

    try {
      if (matchingSlots.some(b => b.status === 'cashed_in')) {
        const q = query(collection(db, 'transactions'), where('referenceId', '==', matchingSlots[0].id), where('transactionType', '==', 'court_booking_payment'));
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
            toast.error('All payments for this booking have already been reversed.');
            return;
          }

          await processReversalTransaction({
            originalTransactionIds: unreversedInflowIds,
            transactionType: 'court_booking_cancellation_refund',
            sourceModule: 'reservation',
            cashierId: user.uid,
            reason: reason,
            memberId: bookingToCancel.memberId || null,
            relatedIds: [matchingSlots[0].id]
          }, async (transaction) => {
            for (const b of matchingSlots) {
              transaction.update(doc(db, 'bookings', b.id), { status: 'cancelled' });
            }
          });
          console.log('Booking cancelled and refunded successfully');
          toast.success('Booking cancelled & refunded');
          setSelectedBooking(null);
          setCancelReason('');
          return;
        }
      }

      await Promise.all(matchingSlots.map(b => updateDoc(doc(db, 'bookings', b.id), { status: 'cancelled' })));
      console.log('Booking cancelled successfully');
      toast.success('Booking cancelled');
      setSelectedBooking(null);
      setCancelReason('');
    } catch (error) {
      console.error('Error cancelling booking:', error);
      handleFirestoreError(error, OperationType.UPDATE, 'bookings');
    }
  };

  const handleCashIn = async (bookingToCashIn: any) => {
    if (!user) return;
    if (couponCodeInput.trim() && !appliedCoupon) {
      toast.error('Invalid, expired, or inapplicable Coupon Code.');
      return;
    }

    const matchingSlots = bookings.filter(b => {
      if (bookingToCashIn.groupId && b.groupId) {
        return b.groupId === bookingToCashIn.groupId;
      }
      return b.name === bookingToCashIn.name &&
        (b.date || b.day) === (bookingToCashIn.date || bookingToCashIn.day) &&
        b.type === bookingToCashIn.type &&
        (b.court || 'basketball') === (bookingToCashIn.court || 'basketball');
    });

    const parsedAmount = convertToBase(parseFloat(cashInAmount));
    const baseTotal = getBookingTotal(bookingToCashIn) + (extraFeeAmount || 0);
    const finalNetAmount = isNaN(parsedAmount) ? 0 : parsedAmount;
    const newRateApplied = !isNaN(parsedAmount) && matchingSlots.length > 0 
      ? (parsedAmount / matchingSlots.length) * 4 
      : undefined;

    try {
      let resolvedMemberId = bookingToCashIn.memberId || null;
      if (!resolvedMemberId && bookingToCashIn.phone && bookingToCashIn.category !== 'academy') {
        const ghostRes = await getOrCreateGhostMember(bookingToCashIn.phone, bookingToCashIn.name || 'Court Guest', user.uid);
        resolvedMemberId = ghostRes.memberId;
      }

      if (cashInPaymentMethod === 'member_balance') {
        if (!resolvedMemberId) {
          throw new Error('Cannot pay with Member Wallet: no member linked to this booking.');
        }
        const linkedMember = members.find(m => m.id === resolvedMemberId);
        if ((linkedMember?.balance || 0) < finalNetAmount) {
          throw new Error('Insufficient Member Wallet balance.');
        }
      }

      let resolvedCodeId: string | null = null;
      let cashbackCodeString: string | null = null;

      if (cashbackCodeInput.trim() && finalNetAmount > 0) {
        const q = query(collection(db, 'cashbackCodes'), where('code', '==', cashbackCodeInput.trim().toUpperCase()));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
          const cbDoc = snap.docs[0];
          const cbData = cbDoc.data();
          
          if (!cbData.isActive) throw new Error('This code is inactive.');
          if (cbData.expiryDate && new Date(cbData.expiryDate).getTime() < Date.now()) throw new Error('This code has expired.');
          if (cbData.maxUses > 0 && (cbData.usageCount || 0) >= cbData.maxUses) throw new Error('Usage limit reached.');
          if (cbData.memberId && cbData.memberId !== resolvedMemberId) throw new Error('This code is for another member.');
          if (cbData.applicableModules && cbData.applicableModules.length > 0 && !cbData.applicableModules.includes('courts') && !cbData.applicableModules.includes('reservation')) {
            throw new Error('This code is not applicable to Court Reservations.');
          }

          resolvedCodeId = cbDoc.id;
          cashbackCodeString = cbData.code;
        } else {
          throw new Error('Invalid Cashback Code.');
        }
      }

      const isIndAccess = Boolean(
        bookingToCashIn.isIndividualAccess ||
        bookingToCashIn.bookingSubType === 'individual_access' ||
        matchingSlots.some(s => s.isIndividualAccess || s.bookingSubType === 'individual_access')
      );
      const resolvedScope = isIndAccess
        ? (bookingToCashIn.individualAccessScope || ((bookingToCashIn.type === 'HCA' || bookingToCashIn.type === 'HCB') ? 'Half Court' : 'Full Court'))
        : undefined;

      await processLedgerTransaction({
        amount: finalNetAmount,
        subtotal: baseTotal,
        discount: Math.max(0, baseTotal - finalNetAmount),
        paymentMethod: cashInPaymentMethod,
        memberId: resolvedMemberId,
        sourceModule: 'reservation',
        cashierId: user.uid,
        transactionType: 'court_booking_payment',
        destinationAccount: isIndAccess
          ? '70621 - Court Individual Access Revenue'
          : '7062 - Court Reservation Revenue',
        category: isIndAccess ? 'Court Individual Access' : (bookingToCashIn.category || 'public'),
        bookingSubType: isIndAccess ? 'individual_access' : 'standard',
        individualAccessScope: resolvedScope,
        court: bookingToCashIn.court || 'basketball',
        referenceId: matchingSlots[0].id,
        notes: `${isIndAccess ? `[Individual Access - ${resolvedScope}] ` : ''}Cash in for ${bookingToCashIn.name} on ${bookingToCashIn.date}${appliedCoupon ? ` (Coupon: ${appliedCoupon.code})` : ''}`,
        couponId: appliedCoupon?.id || null,
        couponCode: appliedCoupon?.code || cashbackCodeString,
        cashbackCodeId: resolvedCodeId
      }, async (transaction) => {
        for (const b of matchingSlots) {
          transaction.update(doc(db, 'bookings', b.id), { 
            status: 'cashed_in',
            ...(resolvedMemberId ? { memberId: resolvedMemberId } : {}),
            ...(newRateApplied !== undefined ? { rateApplied: newRateApplied } : {}),
            ...(extraFeeDescription ? { extraFeeDescription } : {})
          });
        }
      });

      toast.success('Cashed in successfully!');
      setSelectedBooking(null);
      setCouponCodeInput('');
      setAppliedCoupon(null);
      setCashbackCodeInput('');
    } catch (error: any) {
      toast.error(error.message || 'Action failed');
    }
  };

  const handleUnCashIn = async (bookingToUnCashIn: any) => {
    if (!user) return;
    console.log('Un-cashing in booking:', bookingToUnCashIn);
    const matchingSlots = bookings.filter(b => {
      if (bookingToUnCashIn.groupId && b.groupId) {
        return b.groupId === bookingToUnCashIn.groupId;
      }
      return b.name === bookingToUnCashIn.name &&
        (b.date || b.day) === (bookingToUnCashIn.date || bookingToUnCashIn.day) &&
        b.type === bookingToUnCashIn.type &&
        (b.court || 'basketball') === (bookingToUnCashIn.court || 'basketball');
    });

    try {
      if (matchingSlots.some(b => b.status === 'cashed_in')) {
        // Find existing transaction to reverse it
        const q = query(collection(db, 'transactions'), where('referenceId', '==', matchingSlots[0].id), where('transactionType', '==', 'court_booking_payment'));
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
            toast.error('All payments for this booking have already been reversed.');
            return;
          }

          await processReversalTransaction({
            originalTransactionIds: unreversedInflowIds,
            transactionType: 'court_booking_refund',
            sourceModule: 'reservation',
            cashierId: user.uid,
            reason: 'Booking un-cashed in',
            memberId: bookingToUnCashIn.memberId || null,
            relatedIds: [matchingSlots[0].id]
          }, async (transaction) => {
            for (const b of matchingSlots) {
              transaction.update(doc(db, 'bookings', b.id), { 
                status: 'booked',
                rateApplied: deleteField(),
                extraFeeDescription: deleteField()
              });
            }
          });
          console.log('Booking un-cashed in successfully (reversal created)');
          setSelectedBooking(null);
          return;
        }
      }

      // Fallback if not cashed_in or no transaction found
      await Promise.all(matchingSlots.map(b => 
        updateDoc(doc(db, 'bookings', b.id), { 
          status: 'booked',
          rateApplied: deleteField(),
          extraFeeDescription: deleteField()
        })
      ));
      console.log('Booking un-cashed in successfully');
      setSelectedBooking(null);
    } catch (error) {
      console.error('Error un-cashing in booking:', error);
      handleFirestoreError(error, OperationType.UPDATE, 'bookings');
    }
  };

  const calculateNet = () => {
    let daily = 0;
    let monthly = 0;
    let dailyIndividualAccess = 0;
    let monthlyIndividualAccess = 0;
    let monthlyIndividualHalf = 0;
    let monthlyIndividualFull = 0;
    let monthlyStandardRental = 0;
    let monthlyPrivate = 0;
    let monthlyHustle = 0;
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    bookings.forEach(b => {
      if (b.status === 'cashed_in' && b.category !== 'academy') {
        const rate = b.rateApplied !== undefined
          ? Number(b.rateApplied)
          : computeSessionHourlyRate(b.court || 'basketball', b.type || 'full', b.category || 'public', b.numPlayers).hourlyRate;
        
        const costPerSlot = rate / 4;
        const isInd = Boolean(b.isIndividualAccess || b.bookingSubType === 'individual_access');
        const scope = b.individualAccessScope || ((b.type === 'HCA' || b.type === 'HCB') ? 'Half Court' : 'Full Court');
        
        if (b.date === todayStr) {
          daily += costPerSlot;
          if (isInd) dailyIndividualAccess += costPerSlot;
        }
        if (b.date && b.date.startsWith(currentMonthStr)) {
          monthly += costPerSlot;
          if (isInd) {
            monthlyIndividualAccess += costPerSlot;
            if (scope === 'Half Court') monthlyIndividualHalf += costPerSlot;
            else monthlyIndividualFull += costPerSlot;
          } else if (b.category === 'private') {
            monthlyPrivate += costPerSlot;
          } else if (b.category === 'hustle') {
            monthlyHustle += costPerSlot;
          } else {
            monthlyStandardRental += costPerSlot;
          }
        }
      }
    });

    return {
      daily,
      monthly,
      dailyIndividualAccess,
      monthlyIndividualAccess,
      monthlyIndividualHalf,
      monthlyIndividualFull,
      monthlyStandardRental,
      monthlyPrivate,
      monthlyHustle
    };
  };

  const adjustTime = (field: 'startTime' | 'endTime', delta: number) => {
    const time = newBooking[field];
    if (!time) return;
    const [h, m] = time.split(':').map(Number);
    const date = new Date(2000, 0, 1, h, m + delta);
    const newTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    setNewBooking(prev => ({ ...prev, [field]: newTime }));
  };

  const calculateNewBookingPrice = () => {
    if (!newBooking.startTime || !newBooking.endTime) return 0;
    if (newBooking.category === 'academy') return 0;

    if (newBooking.category === 'public' && bookingMode === 'walk-in' && isIndividualAccess) {
      const manualRate = parseFloat(individualAccessRate);
      return isNaN(manualRate) ? 0 : Math.max(0, manualRate);
    }
    
    let current = new Date(`2000-01-01T${newBooking.startTime}`);
    const end = new Date(`2000-01-01T${newBooking.endTime}`);
    if (current >= end) return 0;

    const actualType = activeCourt === 'basketball' ? newBooking.type : 'full';
    const category = newBooking.category;

    let slotsPerSession = 0;
    while (current < end) {
      slotsPerSession++;
      current.setMinutes(current.getMinutes() + 15);
    }

    const weeksToBook = bookingMode === 'fixed' ? Math.max(1, fixedWeeks) : 1;
    const totalSlots = slotsPerSession * weeksToBook;
    const durationInHours = totalSlots / 4;

    const playerCount = Math.max(1, Number(newBooking.numPlayers) || 1);
    const { baseCourtOrPrivateRate, extraPlayerRate } = computeSessionHourlyRate(
      activeCourt,
      actualType,
      category,
      playerCount
    );
    const extraPlayers = Math.max(0, playerCount - 1);
    const hourlyRate = baseCourtOrPrivateRate + (extraPlayers * extraPlayerRate);
    const totalSessionPrice = durationInHours * hourlyRate;
    
    if (priceOverride !== '' && !isNaN(parseFloat(priceOverride))) {
      return Math.max(0, parseFloat(priceOverride));
    }
    
    return bookingMode === 'fixed' ? Math.max(0, totalSessionPrice * (1 - fixedDiscount / 100)) : totalSessionPrice;
  };

  const {
    daily: dailyNet,
    monthly: monthlyNet,
    dailyIndividualAccess,
    monthlyIndividualAccess,
    monthlyIndividualHalf,
    monthlyIndividualFull,
    monthlyStandardRental,
    monthlyPrivate,
    monthlyHustle
  } = calculateNet();

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      const grouped = bookings.reduce((acc, b) => {
        if (b.status === 'cashed_in') return acc;
        if (b.date !== todayStr) return acc;
        
        const key = `${b.name}-${b.date}-${b.court}-${b.type}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(b);
        return acc;
      }, {} as Record<string, any[]>);

      for (const key in grouped) {
        const slots = grouped[key];
        slots.sort((a, b) => a.time.localeCompare(b.time));
        const lastSlot = slots[slots.length - 1];
        
        if (lastSlot.prompted) continue;

        const [h, m] = lastSlot.time.split(':').map(Number);
        const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m + 15);
        
        if (now >= endDate && !selectedBooking) {
          const updatedBookings = bookings.map(b => {
             if (b.name === lastSlot.name && b.date === lastSlot.date && b.court === lastSlot.court && b.type === lastSlot.type) {
               return { ...b, prompted: true };
             }
             return b;
          });
          setBookings(updatedBookings);
          setSelectedBooking(lastSlot);
          break;
        }
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [bookings, selectedBooking]);

  const handleSaveRates = async () => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'settings', 'court_config'), { rates: tempRates, uid: user.uid }, { merge: true });
      setRates(tempRates);
      setIsRatesModalOpen(false);
      toast.success('Rates updated successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/court_config');
    }
  };

  const handleAddOffDay = async () => {
    if (newOffDay && !offDays.includes(newOffDay) && user) {
      const newOffDays = [...offDays, newOffDay].sort();
      try {
        await setDoc(doc(db, 'settings', 'court_config'), { offDays: newOffDays, uid: user.uid }, { merge: true });
        setOffDays(newOffDays);
        setNewOffDay('');
        toast.success('Off day added successfully');
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'settings/court_config');
      }
    }
  };

  const handleRemoveOffDay = async (date: string) => {
    if (!user) return;
    const newOffDays = offDays.filter(d => d !== date);
    try {
      await setDoc(doc(db, 'settings', 'court_config'), { offDays: newOffDays, uid: user.uid }, { merge: true });
      setOffDays(newOffDays);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/court_config');
    }
  };

  const handleOpenRates = () => {
    setTempRates(rates);
    setIsRatesModalOpen(true);
  };

  const handleTimeSelected = (dayName: string, startTime: string, endTime: string, type: string, fullDate: string) => {
    setNewBooking({
      name: '',
      phone: '',
      date: fullDate,
      startTime,
      endTime,
      type: type === 'HCA' || type === 'HCB' ? type : 'full',
      category: 'public',
      numPlayers: 1,
      memberId: ''
    });
    setIndividualAccessScope(type === 'HCA' || type === 'HCB' ? 'Half Court' : 'Full Court');
    setIsIndividualAccess(false);
    setIndividualAccessRate('');
    setIsBookModalOpen(true);
  };

  const handleBookSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBooking.name || !newBooking.date || !newBooking.startTime || !newBooking.endTime || !user) return;

    const [year, month, day] = newBooking.date.split('-');
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day));

    const newBookingsData = [];
    let current = new Date(`2000-01-01T${newBooking.startTime}`);
    const end = new Date(`2000-01-01T${newBooking.endTime}`);

    if (current >= end) return;

    const actualType = activeCourt === 'basketball' ? newBooking.type : 'full';
    const category = newBooking.category;

    const weeksToBook = bookingMode === 'fixed' ? Math.max(1, fixedWeeks) : 1;
    let slotsPerSession = 0;
    let tempCurrent = new Date(current);
    while (tempCurrent < end) {
      slotsPerSession++;
      tempCurrent.setMinutes(tempCurrent.getMinutes() + 15);
    }

    const isIndMode = category === 'public' && bookingMode === 'walk-in' && isIndividualAccess;
    if (isIndMode) {
      const parsedIndRate = parseFloat(individualAccessRate);
      if (isNaN(parsedIndRate) || parsedIndRate < 0) {
        toast.error('Please enter a valid manual rate for Individual Access.');
        return;
      }
    }

    const totalSlots = slotsPerSession * weeksToBook;
    const durationInHours = totalSlots / 4;
    const playerCount = Math.max(1, Number(newBooking.numPlayers) || 1);
    const { baseCourtOrPrivateRate, extraPlayerRate } = computeSessionHourlyRate(
      activeCourt,
      actualType,
      category,
      playerCount
    );
    const extraPlayers = Math.max(0, playerCount - 1);
    const hourlyRate = baseCourtOrPrivateRate + (extraPlayers * extraPlayerRate);
    const totalSessionPrice = durationInHours * hourlyRate;
    
    let finalTotal = bookingMode === 'fixed' ? Math.max(0, totalSessionPrice * (1 - fixedDiscount / 100)) : totalSessionPrice;
    let hasCustomOverride = (priceOverride !== '' && !isNaN(parseFloat(priceOverride))) || (bookingMode === 'fixed' && fixedDiscount > 0);
    if (isIndMode) {
      finalTotal = Math.max(0, parseFloat(individualAccessRate) || 0);
      hasCustomOverride = true;
    } else if (priceOverride !== '' && !isNaN(parseFloat(priceOverride))) {
      finalTotal = Math.max(0, parseFloat(priceOverride));
    }
    
    const finalRateApplied = (finalTotal / totalSlots) * 4;
    const resolvedIndScope: 'Half Court' | 'Full Court' | undefined = isIndMode
      ? individualAccessScope
      : undefined;
    const groupId = Date.now().toString() + Math.random().toString(36).substring(2, 9);

    // Deterministic Collision & Off-Day Check across all requested weeks and 15-min slots
    for (let w = 0; w < weeksToBook; w++) {
      const checkWeekDateObj = new Date(dateObj);
      checkWeekDateObj.setDate(checkWeekDateObj.getDate() + (w * 7));
      const wYear = checkWeekDateObj.getFullYear();
      const wMonth = String(checkWeekDateObj.getMonth() + 1).padStart(2, '0');
      const wDay = String(checkWeekDateObj.getDate()).padStart(2, '0');
      const wDateStr = `${wYear}-${wMonth}-${wDay}`;

      if (offDays.includes(wDateStr)) {
        toast.error(`Cannot book on ${wDateStr}: Facility is closed (Scheduled Off Day).`);
        return;
      }

      let slotCheck = new Date(`2000-01-01T${newBooking.startTime}`);
      const slotCheckEnd = new Date(`2000-01-01T${newBooking.endTime}`);

      while (slotCheck < slotCheckEnd) {
        const hrs = slotCheck.getHours().toString().padStart(2, '0');
        const mins = slotCheck.getMinutes().toString().padStart(2, '0');
        const tStr = `${hrs}:${mins}`;

        const conflictingBooking = bookings.find(b => {
          if (b.status === 'cancelled') return false;
          const bCourt = b.court || 'basketball';
          if (bCourt !== activeCourt) return false;
          if ((b.date || '') !== wDateStr) return false;
          if (b.time !== tStr) return false;

          if (activeCourt === 'basketball') {
            const existingType = b.type || 'full';
            // Full Court collides with Full, HCA, and HCB
            if (actualType === 'full' || existingType === 'full') return true;
            // Half Court collides with the same Half Court (leaving the other Half Court open)
            return actualType === existingType;
          }
          return true;
        });

        if (conflictingBooking) {
          const courtLabel = activeCourt === 'basketball'
            ? `Basketball (${actualType === 'full' ? 'Full Court' : actualType})`
            : activeCourt.toUpperCase();
          const conflictUnit = activeCourt === 'basketball'
            ? ` [${conflictingBooking.type === 'full' ? 'Full Court' : conflictingBooking.type}]`
            : '';
          toast.error(
            `Court collision on ${wDateStr} at ${tStr}! ${courtLabel} is already booked by "${conflictingBooking.name}"${conflictUnit}.`
          );
          return;
        }

        slotCheck.setMinutes(slotCheck.getMinutes() + 15);
      }
    }
    
    // Support coach matching for freelance packages
    let targetCoachContract: any = null;
    let targetCoachId = '';
    if (newBooking.category === 'private') {
      const matchedCoach = coaches.find(c => 
        newBooking.name.toLowerCase().includes(c.firstName.toLowerCase()) && 
        newBooking.name.toLowerCase().includes(c.lastName.toLowerCase())
      );
      if (matchedCoach) {
        // Find their active freelance contract prioritizing one with sessions > 0 or remainingSessions > 0
        const contracts = coachContracts.filter(c => c.coachId === matchedCoach.id && c.type === 'freelance');
        targetCoachContract = contracts.find(c => (c.remainingSessions ?? c.sessions) > 0);
        
        if (!targetCoachContract) {
          toast.error("Coach has no remaining package sessions available.");
          return;
        }
        targetCoachId = matchedCoach.id;
      }
    }

    // Auto-link non-academy bookings to Central Members when memberId isn't explicitly chosen
    let resolvedBookingMemberId = newBooking.memberId || null;
    if (!resolvedBookingMemberId && newBooking.category !== 'academy' && !targetCoachContract && newBooking.phone.trim()) {
      try {
        const ghostRes = await getOrCreateGhostMember(newBooking.phone.trim(), newBooking.name.trim(), user.uid);
        resolvedBookingMemberId = ghostRes.memberId;
      } catch (err) {
        console.warn('Could not auto-link booking member:', err);
      }
    }

    for (let w = 0; w < weeksToBook; w++) {
      const currentWeekDateObj = new Date(dateObj);
      currentWeekDateObj.setDate(currentWeekDateObj.getDate() + (w * 7));
      
      const weekYear = currentWeekDateObj.getFullYear();
      const weekMonth = String(currentWeekDateObj.getMonth() + 1).padStart(2, '0');
      const weekDay = String(currentWeekDateObj.getDate()).padStart(2, '0');
      const weekDateStr = `${weekYear}-${weekMonth}-${weekDay}`;
      const weekDayName = currentWeekDateObj.toLocaleDateString('en-US', { weekday: 'short' });

      let sessionCurrent = new Date(`2000-01-01T${newBooking.startTime}`);
      const sessionEnd = new Date(`2000-01-01T${newBooking.endTime}`);

      while (sessionCurrent < sessionEnd) {
        const hours = sessionCurrent.getHours().toString().padStart(2, '0');
        const minutes = sessionCurrent.getMinutes().toString().padStart(2, '0');
        const timeString = `${hours}:${minutes}`;

        newBookingsData.push(stripUndefined({
          day: weekDayName,
          date: weekDateStr,
          time: timeString,
          name: newBooking.name,
          phone: newBooking.phone,
          type: actualType,
          court: activeCourt,
          status: 'booked',
          price: finalRateApplied,
          rateApplied: finalRateApplied,
          lockedTotalPrice: isIndMode ? finalTotal : undefined,
          hasCustomPricing: hasCustomOverride,
          isIndividualAccess: isIndMode ? true : undefined,
          bookingSubType: isIndMode ? 'individual_access' : 'standard',
          individualAccessScope: resolvedIndScope,
          category: newBooking.category,
          numPlayers: (newBooking.category === 'private' || newBooking.category === 'hustle') ? Math.max(1, Number(newBooking.numPlayers) || 1) : null,
          uid: user.uid,
          groupId: groupId,
          memberId: resolvedBookingMemberId
        }));

        sessionCurrent.setMinutes(sessionCurrent.getMinutes() + 15);
      }
    }

    try {
      if (targetCoachContract && newBooking.category === 'private' && !newBooking.memberId) {
        await processLedgerTransaction({
          amount: 0,
          paymentMethod: 'system',
          memberId: newBooking.memberId || null,
          sourceModule: 'reservation',
          cashierId: user.uid,
          transactionType: 'coach_session_consumed',
          sourceAccount: 'coach_package_sessions',
          destinationAccount: 'facility_usage',
          referenceId: groupId,
        }, async (transaction, currentRemaining) => {
          const contractRef = doc(db, 'coachContracts', targetCoachContract.id);
          transaction.update(contractRef, { 
            remainingSessions: currentRemaining - 1 
          });
          
          for (const b of newBookingsData) {
            const bRef = doc(collection(db, 'bookings'));
            transaction.set(bRef, stripUndefined(b));
          }
        }, async (transaction) => {
          const contractRef = doc(db, 'coachContracts', targetCoachContract.id);
          const contractSnap = await transaction.get(contractRef);
          
          if (!contractSnap.exists()) {
            throw new Error('Coach contract not found');
          }
          
          const contractData = contractSnap.data();
          const currentRemaining = contractData.remainingSessions !== undefined ? contractData.remainingSessions : contractData.sessions;
          
          if (currentRemaining <= 0) {
            throw new Error('Coach has no remaining package sessions available');
          }
          return currentRemaining;
        });
        toast.success(`Booking created and 1 session deducted from coach package`);
      } else {
        // Normal booking without freelance coach package consumption
        await Promise.all(newBookingsData.map(b => addDoc(collection(db, 'bookings'), stripUndefined(b))));
        toast.success(`Booking created successfully`);
      }

      setIsBookModalOpen(false);
      setNewBooking({ name: '', phone: '', date: '', type: 'full', startTime: '', endTime: '', category: 'public', numPlayers: 1, memberId: '' });
      setBookingMode('walk-in');
      setFixedWeeks(1);
      setFixedDiscount(0);
      setPriceOverride('');
      setIsIndividualAccess(false);
      setIndividualAccessRate('');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'bookings');
      toast.error(error.message || 'Failed to create booking');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center shadow-2xl">
          <h1 className="text-3xl font-bold text-white mb-2">Elite Sports Management</h1>
          <p className="text-zinc-400 mb-8 text-sm">Please sign in to access the court reservation system.</p>
          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-3 bg-white text-black font-semibold py-3 px-6 rounded-xl hover:bg-zinc-200 transition-all active:scale-95 shadow-lg"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors ${theme === 'dark' ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans selection:bg-cyan-500/30`}>
      <Header 
        onOpenRates={handleOpenRates} 
        onOpenBook={() => setIsBookModalOpen(true)} 
        onOpenOffDays={() => setIsOffDaysModalOpen(true)}
        dailyNet={dailyNet} 
        monthlyNet={monthlyNet}
        theme={theme}
        onToggleTheme={toggleDarkMode}
      />
      {/* Independent Court Revenue Segmentation KPI Bar (Standard Rental vs Individual Access Half/Full vs Private/Hustle) */}
      <div className={`px-6 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 text-xs ${
        theme === 'dark' ? 'bg-[#0B0F17]/90 border-zinc-800/80' : 'bg-white border-slate-200'
      }`}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Monthly Standard Rentals (7062):</span>
            <span className="font-mono font-bold text-zinc-300 dark:text-zinc-200">{formatCurrency(monthlyStandardRental)}</span>
          </div>
          <div className={`h-4 w-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-slate-200'}`} />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#00B8C8]">⚡ Individual Access (70621):</span>
            <span className="font-mono font-black text-[#00B8C8]">{formatCurrency(monthlyIndividualAccess)}</span>
            <span className="text-[10px] font-mono text-zinc-500">
              (Half Court: {formatCurrency(monthlyIndividualHalf)} • Full Court: {formatCurrency(monthlyIndividualFull)} • Today: {formatCurrency(dailyIndividualAccess)})
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Private Sessions:</span>
            <span className="font-mono font-bold text-emerald-500">{formatCurrency(monthlyPrivate)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Hustle Sessions:</span>
            <span className="font-mono font-bold text-amber-500">{formatCurrency(monthlyHustle)}</span>
          </div>
        </div>
      </div>
      <CourtTabs activeCourt={activeCourt} onCourtChange={setActiveCourt} theme={theme} />
      <WeeklyCalendar 
        activeCourt={activeCourt} 
        bookings={bookings.filter(b => b.status !== 'cancelled' && (b.court || 'basketball') === activeCourt)} 
        offDays={offDays}
        onBookingClick={setSelectedBooking} 
        onTimeSelected={handleTimeSelected} 
        theme={theme}
        allowPastDatesOverride={allowPastDatesOverride}
        onTogglePastDatesOverride={setAllowPastDatesOverride}
      />
      
      <Modal isOpen={isBookModalOpen} onClose={() => setIsBookModalOpen(false)} title="Book Court" theme={theme}>
        <form className="space-y-5" onSubmit={handleBookSubmit}>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Booking Category</label>
                <select 
                  value={newBooking.category}
                  onChange={e => setNewBooking({...newBooking, category: e.target.value as any})}
                  className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all appearance-none ${
                    theme === 'dark' 
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50' 
                      : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30'
                  }`}
                >
                  <option value="public">Public (Standard Rental)</option>
                  <option value="academy">Academy Session</option>
                  <option value="private">Private Session</option>
                  <option value="hustle">Hustle Session</option>
                </select>
              </div>

              <div className={`flex p-1 rounded-lg border transition-colors ${
                theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-zinc-100 border-zinc-200'
              }`}>
                <button
                  type="button"
                  onClick={() => setBookingMode('walk-in')}
                  className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                    bookingMode === 'walk-in' 
                      ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Walk In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBookingMode('fixed');
                    setIsIndividualAccess(false);
                  }}
                  className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                    bookingMode === 'fixed' 
                      ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Fixed Booking
                </button>
              </div>

              {newBooking.category === 'public' && bookingMode === 'walk-in' && (
                <div className={`p-3.5 rounded-xl border space-y-3 transition-all ${
                  isIndividualAccess
                    ? 'bg-[#00B8C8]/10 border-[#00B8C8]/40'
                    : theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}>
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider text-[#00B8C8] block">
                        ⚡ Individual Access (Manual Rate Override)
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        Book Half Court or Full Court for individual player access with custom manual rate (LCOA 70621)
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isIndividualAccess}
                      onChange={e => {
                        const checked = e.target.checked;
                        setIsIndividualAccess(checked);
                        if (checked) {
                          setIndividualAccessScope(
                            newBooking.type === 'HCA' || newBooking.type === 'HCB' ? 'Half Court' : 'Full Court'
                          );
                        }
                      }}
                      className="w-4 h-4 accent-[#00B8C8] rounded cursor-pointer"
                    />
                  </label>

                  {isIndividualAccess && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#00B8C8]/20">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">
                          Court Scope
                        </label>
                        <select
                          value={individualAccessScope}
                          onChange={e => {
                            const scope = e.target.value as 'Half Court' | 'Full Court';
                            setIndividualAccessScope(scope);
                            if (activeCourt === 'basketball') {
                              if (scope === 'Full Court') {
                                setNewBooking(prev => ({ ...prev, type: 'full' }));
                              } else if (newBooking.type === 'full') {
                                setNewBooking(prev => ({ ...prev, type: 'HCA' }));
                              }
                            }
                          }}
                          className={`w-full p-2 text-xs font-bold border rounded-lg focus:outline-none ${
                            theme === 'dark' ? 'bg-[#05070A] border-zinc-700 text-zinc-100' : 'bg-white border-slate-300 text-slate-900'
                          }`}
                        >
                          <option value="Half Court">Half Court (HCA / HCB)</option>
                          <option value="Full Court">Full Court</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-[#00B8C8] mb-1">
                          Manual Rate ($ USD) *
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required={isIndividualAccess}
                          placeholder="Enter exact rate ($)"
                          value={individualAccessRate}
                          onChange={e => setIndividualAccessRate(e.target.value)}
                          className={`w-full p-2 text-xs font-mono font-black border rounded-lg focus:outline-none ${
                            theme === 'dark' ? 'bg-[#05070A] border-[#00B8C8]/50 text-zinc-100' : 'bg-white border-[#00B8C8] text-slate-900'
                          }`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {newBooking.category !== 'academy' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Link Central Member (Optional)</label>
                  <select
                    value={newBooking.memberId || ''}
                    onChange={(e) => {
                      const memberId = e.target.value;
                      const member = members.find(m => m.id === memberId);
                      setNewBooking({
                        ...newBooking,
                        memberId,
                        name: member ? `${member.firstName} ${member.lastName}` : newBooking.name,
                        phone: member ? member.phone : newBooking.phone
                      });
                    }}
                    className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all appearance-none ${
                      theme === 'dark' 
                        ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50' 
                        : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30'
                    }`}
                  >
                    <option value="">Select Member...</option>
                    {members
                      .filter(m => m.id !== 'walk_in' && m.id !== 'system_walk_in' && !m.isSystemWalkIn && m.packageId !== 'walk-in')
                      .map(m => (
                        <option key={m.id} value={m.id}>{m.firstName} {m.lastName} - {m.phone}</option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                  {newBooking.category === 'public' ? 'Customer Name' : newBooking.category === 'academy' ? 'Team / Academy Group' : newBooking.category === 'hustle' ? 'Hustle Organizer / Group' : 'Coach / Client Name'}
                </label>
                <input 
                  type="text" 
                  placeholder={newBooking.category === 'public' ? 'Enter full name' : newBooking.category === 'academy' ? 'Enter team name' : newBooking.category === 'hustle' ? 'Enter hustle session organizer' : 'Enter coach name'}
                  value={newBooking.name}
                  onChange={e => setNewBooking({...newBooking, name: e.target.value})}
                  required
                  className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' 
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:ring-cyan-500/50' 
                      : 'bg-white border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:ring-cyan-500/30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                  {newBooking.category === 'academy' ? 'Coach' : 'Phone Number'}
                </label>
                <input 
                  type="text" 
                  placeholder={newBooking.category === 'academy' ? 'Enter coach name' : 'Enter phone number'}
                  value={newBooking.phone}
                  onChange={e => setNewBooking({...newBooking, phone: e.target.value})}
                  className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' 
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:ring-cyan-500/50' 
                      : 'bg-white border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:ring-cyan-500/30'
                  }`}
                />
              </div>

              {(newBooking.category === 'private' || newBooking.category === 'hustle') && (() => {
                const actualType = activeCourt === 'basketball' ? newBooking.type : 'full';
                const { baseCourtOrPrivateRate, extraPlayerRate, extraPlayers, hourlyRate } = computeSessionHourlyRate(
                  activeCourt,
                  actualType,
                  newBooking.category,
                  newBooking.numPlayers
                );
                return (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Number of Players</label>
                    <input 
                      type="number" 
                      min="1"
                      value={newBooking.numPlayers}
                      onChange={e => setNewBooking({...newBooking, numPlayers: Math.max(1, parseInt(e.target.value) || 1)})}
                      className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all font-mono ${
                        theme === 'dark' 
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50' 
                          : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30'
                      }`}
                    />
                    <div className={`p-2.5 rounded-lg border text-[11px] font-mono flex flex-wrap items-center justify-between gap-2 ${
                      theme === 'dark' ? 'bg-zinc-900/60 border-zinc-800 text-zinc-400' : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}>
                      <span>Base (1st Player Incl.): <strong className="text-cyan-400">{formatCurrency(baseCourtOrPrivateRate)}/hr</strong></span>
                      <span>+ Extra Players ({extraPlayers} × {formatCurrency(extraPlayerRate)}): <strong className="text-cyan-400">{formatCurrency(extraPlayers * extraPlayerRate)}/hr</strong></span>
                      <span>= Hourly Rate: <strong className="text-emerald-400">{formatCurrency(hourlyRate)}/hr</strong></span>
                    </div>
                  </div>
                );
              })()}

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider">Date</label>
                  <button 
                    type="button"
                    onClick={() => {
                      const today = new Date();
                      const yyyy = today.getFullYear();
                      const mm = String(today.getMonth() + 1).padStart(2, '0');
                      const dd = String(today.getDate()).padStart(2, '0');
                      setNewBooking({...newBooking, date: `${yyyy}-${mm}-${dd}`});
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded transition-colors font-semibold ${
                      theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-700'
                    }`}
                  >
                    TODAY
                  </button>
                </div>
                <input 
                  type="date" 
                  value={newBooking.date}
                  onChange={e => setNewBooking({...newBooking, date: e.target.value})}
                  required
                  className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                    theme === 'dark' 
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50 [color-scheme:dark]' 
                      : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30 [color-scheme:light]'
                  }`}
                />
              </div>
              {activeCourt === 'basketball' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Court Type</label>
                  <select 
                    value={newBooking.type}
                    onChange={e => setNewBooking({...newBooking, type: e.target.value})}
                    className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all appearance-none ${
                      theme === 'dark' 
                        ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50' 
                        : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30'
                    }`}
                  >
                    <option value="full">Full Court</option>
                    <option value="HCA">HCA</option>
                    <option value="HCB">HCB</option>
                  </select>
                </div>
              )}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Start Time</label>
                  <div className="relative">
                    <input 
                      type="time" 
                      step="300"
                      value={newBooking.startTime}
                      onChange={e => setNewBooking({...newBooking, startTime: e.target.value})}
                      required
                      className={`w-full p-2.5 pr-10 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                        theme === 'dark' 
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50 [color-scheme:dark]' 
                          : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30 [color-scheme:light]'
                      }`}
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                      <button 
                        type="button" 
                        onClick={() => adjustTime('startTime', 5)}
                        className={`p-0.5 rounded transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900'}`}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button 
                        type="button" 
                        onClick={() => adjustTime('startTime', -5)}
                        className={`p-0.5 rounded transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900'}`}
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">End Time</label>
                  <div className="relative">
                    <input 
                      type="time" 
                      step="300"
                      value={newBooking.endTime}
                      onChange={e => setNewBooking({...newBooking, endTime: e.target.value})}
                      required
                      className={`w-full p-2.5 pr-10 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                        theme === 'dark' 
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50 [color-scheme:dark]' 
                          : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30 [color-scheme:light]'
                      }`}
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                      <button 
                        type="button" 
                        onClick={() => adjustTime('endTime', 5)}
                        className={`p-0.5 rounded transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900'}`}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button 
                        type="button" 
                        onClick={() => adjustTime('endTime', -5)}
                        className={`p-0.5 rounded transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900'}`}
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {bookingMode === 'fixed' && (
              <div className={`space-y-4 pt-4 border-t transition-colors ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Number of Weeks</label>
                    <input 
                      type="number" 
                      min="1"
                      max="52"
                      value={fixedWeeks === 0 ? '' : fixedWeeks}
                      onChange={e => setFixedWeeks(e.target.value === '' ? 0 : Math.max(1, parseInt(e.target.value) || 1))}
                      className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all font-mono ${
                        theme === 'dark' 
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50' 
                          : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30'
                      }`}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className={`space-y-4 pt-4 border-t transition-colors ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Discount (%)</label>
                  <input 
                    type="number" 
                    min="0"
                    max="100"
                    value={fixedDiscount === 0 ? '' : fixedDiscount}
                    onChange={e => {
                      setFixedDiscount(e.target.value === '' ? 0 : Math.min(100, Math.max(0, parseInt(e.target.value) || 0)));
                      if (e.target.value !== '') setPriceOverride(''); // clear override if discount is used
                    }}
                    className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all font-mono ${
                      theme === 'dark' 
                        ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50' 
                        : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30'
                    }`}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Amount Override</label>
                  <input 
                    type="number" 
                    min="0"
                    value={priceOverride}
                    onChange={e => {
                      setPriceOverride(e.target.value);
                      if (e.target.value !== '') setFixedDiscount(0); // clear discount if override is used
                    }}
                    className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all font-mono ${
                      theme === 'dark' 
                        ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 focus:ring-cyan-500/50' 
                        : 'bg-white border-zinc-200 text-zinc-900 focus:ring-cyan-500/30'
                    }`}
                  />
                </div>
              </div>
              <div className="bg-cyan-500/10 border border-cyan-500/25 p-3 rounded-xl flex justify-between items-center">
                <span className="text-sm font-bold text-[#00B8C8]">Final Price:</span>
                <span className="text-lg font-extrabold text-[#00B8C8] font-mono">{formatCurrency(calculateNewBookingPrice())}</span>
              </div>
            </div>

            <div className="pt-2">
              <button type="submit" className="w-full p-3 bg-[#00B8C8] text-slate-950 font-bold rounded-xl hover:bg-[#0099A8] focus:ring-4 focus:ring-cyan-500/20 transition-all shadow-sm shadow-cyan-500/20">Confirm Booking</button>
            </div>
          </form>
      </Modal>
      
      <Modal isOpen={!!selectedBooking} onClose={() => setSelectedBooking(null)} title="Booking Options" theme={theme}>
        {selectedBooking && (
          <div className="py-2">
            <div className={`p-4 rounded-lg border mb-6 transition-colors ${
              theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
            }`}>
              <h3 className={`text-lg font-medium mb-1 transition-colors ${
                theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'
              }`}>{selectedBooking.name}</h3>
              <p className="text-sm text-zinc-400">
                {selectedBooking.date || selectedBooking.day} • {selectedBooking.court === 'basketball' ? 'Basketball' : selectedBooking.court === 'padel1' ? 'Padel 1' : selectedBooking.court === 'padel2' ? 'Padel 2' : 'Tennis'} ({selectedBooking.type === 'full' ? 'Full Court' : selectedBooking.type})
              </p>
              {selectedBooking.phone && (
                <p className="text-sm text-zinc-400 mt-1">📞 {selectedBooking.phone}</p>
              )}
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              {selectedBooking.status === 'cashed_in' && (
                <div className="bg-emerald-500/10 text-emerald-500 p-3.5 rounded-lg border border-emerald-500/20 text-center font-medium">
                  ✓ Cashed In ({formatCurrency(getBookingTotal(selectedBooking))})
                </div>
              )}

              {selectedBooking.status !== 'cashed_in' && (
                <div className="space-y-4">
                  {selectedBooking.category !== 'academy' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Discount (%)</label>
                        <input 
                          type="number" 
                          min="0"
                          max="100"
                          value={cashInDiscount === 0 ? '' : (cashInDiscount || 0)}
                          onChange={e => setCashInDiscount(e.target.value === '' ? 0 : Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                          className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all font-mono ${
                            theme === 'dark' 
                              ? 'bg-zinc-900/50 border-zinc-800 text-zinc-100 focus:ring-blue-500/50' 
                              : 'bg-white border-zinc-200 text-zinc-900 focus:ring-blue-500/30'
                          }`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Amount to Cash In ({currency === 'LBP' ? 'ل.ل' : '$'})</label>
                        <input 
                          type="number" 
                          value={cashInAmount || ''}
                          onChange={e => setCashInAmount(e.target.value)}
                          className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all font-mono ${
                            theme === 'dark' 
                              ? 'bg-zinc-900/50 border-zinc-800 text-zinc-100 focus:ring-emerald-500/50' 
                              : 'bg-white border-zinc-200 text-zinc-900 focus:ring-emerald-500/30'
                          }`}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                        Extra Fee Description {extraFeeAmount > 0 && <span className="text-red-500">*</span>}
                      </label>
                      <input 
                        type="text" 
                        placeholder="e.g. Extra balls"
                        value={extraFeeDescription}
                        onChange={e => setExtraFeeDescription(e.target.value)}
                        required={extraFeeAmount > 0}
                        className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                          theme === 'dark' 
                            ? 'bg-zinc-900/50 border-zinc-800 text-zinc-100 focus:ring-blue-500/50' 
                            : 'bg-white border-zinc-200 text-zinc-900 focus:ring-blue-500/30'
                        } ${extraFeeAmount > 0 && !extraFeeDescription ? 'border-red-500/50' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Extra Amount</label>
                      <input 
                        type="number" 
                        min="0"
                        value={extraFeeAmount === 0 ? '' : extraFeeAmount}
                        onChange={e => setExtraFeeAmount(parseFloat(e.target.value) || 0)}
                        className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all font-mono ${
                          theme === 'dark' 
                            ? 'bg-zinc-900/50 border-zinc-800 text-zinc-100 focus:ring-blue-500/50' 
                            : 'bg-white border-zinc-200 text-zinc-900 focus:ring-blue-500/30'
                        }`}
                      />
                    </div>
                  </div>

                  {selectedBooking.category !== 'academy' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider">Coupon Code</label>
                          <div className="relative">
                            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                            <input 
                              type="text" 
                              placeholder="PROMO CODE"
                              value={couponCodeInput}
                              onChange={e => setCouponCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                              className={`w-full pl-9 pr-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all uppercase font-bold text-xs ${
                                appliedCoupon
                                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                                  : theme === 'dark' 
                                    ? 'bg-zinc-900/50 border-zinc-800 text-zinc-100 focus:ring-blue-500/50' 
                                    : 'bg-white border-zinc-200 text-zinc-900 focus:ring-blue-500/30'
                              }`}
                            />
                          </div>
                          {appliedCoupon && (
                            <p className="text-[11px] font-bold text-emerald-500">
                              ✓ Applied: -{appliedCoupon.discountType === 'percentage' ? `${appliedCoupon.discountValue ?? (appliedCoupon as any).value}%` : formatCurrency(appliedCoupon.discountValue ?? (appliedCoupon as any).value)}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider">Reward Code</label>
                          <div className="relative">
                            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                            <input 
                              type="text" 
                              placeholder="CASHBACK CODE"
                              value={cashbackCodeInput}
                              onChange={e => setCashbackCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                              className={`w-full pl-9 pr-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all uppercase font-bold text-xs ${
                                theme === 'dark' 
                                  ? 'bg-zinc-900/50 border-zinc-800 text-zinc-100 focus:ring-blue-500/50' 
                                  : 'bg-white border-zinc-200 text-zinc-900 focus:ring-blue-500/30'
                              }`}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider">Payment Method</label>
                        <div className="grid grid-cols-3 gap-2">
                          {(['cash', 'card', 'member_balance'] as const).map(method => (
                            <button
                              key={method}
                              type="button"
                              onClick={() => setCashInPaymentMethod(method)}
                              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all ${
                                cashInPaymentMethod === method
                                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                                  : theme === 'dark'
                                    ? 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                                    : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'
                              }`}
                            >
                              {method === 'cash' && <DollarSign size={14} />}
                              {method === 'card' && <CreditCard size={14} />}
                              {method === 'member_balance' && <User size={14} />}
                              {method === 'member_balance' ? 'Wallet' : method}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <button 
                    onClick={() => handleCashIn(selectedBooking)} 
                    disabled={extraFeeAmount > 0 && !extraFeeDescription.trim()}
                    className={`w-full p-3.5 text-white font-semibold rounded-lg transition-all shadow-sm flex items-center justify-center gap-2 ${
                      extraFeeAmount > 0 && !extraFeeDescription.trim()
                        ? 'bg-zinc-600 cursor-not-allowed opacity-50'
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {selectedBooking.category === 'academy' ? '✓ Confirm Session' : '💰 Cash In'}
                  </button>
                </div>
              )}

              {selectedBooking.status === 'cashed_in' && (
                <button 
                  onClick={() => handleUnCashIn(selectedBooking)} 
                  className={`w-full p-3.5 border font-medium rounded-lg transition-all flex items-center justify-center gap-2 mb-2 ${
                    theme === 'dark' 
                      ? 'bg-zinc-800 text-red-400 border-zinc-700 hover:bg-zinc-700' 
                      : 'bg-zinc-100 text-red-600 border-zinc-200 hover:bg-zinc-200'
                  }`}
                >
                  ↩️ {selectedBooking.category === 'academy' ? 'Un-Confirm Session' : 'Un-Cash In'}
                </button>
              )}

              <button 
                onClick={() => handleCancel(selectedBooking)} 
                className={`w-full p-3.5 border font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
                  theme === 'dark' 
                    ? 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700' 
                    : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200'
                }`}
              >
                ❌ {selectedBooking.category === 'academy' ? 'Cancel Session' : 'Cancel Booking'}
              </button>
              
              <div className="mt-4">
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Cancellation Reason (Required)</label>
                  <input 
                    type="text" 
                    placeholder="Enter reason..." 
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                      theme === 'dark' 
                        ? 'bg-zinc-900/50 border-zinc-800 text-zinc-100 focus:ring-red-500/50' 
                        : 'bg-white border-zinc-200 text-zinc-900 focus:ring-red-500/30'
                    }`}
                  />
              </div>
            </div>
          </div>
        )}
      </Modal>
      
      <Modal isOpen={isRatesModalOpen} onClose={() => setIsRatesModalOpen(false)} title="Hourly Rates Configuration" theme={theme}>
        <div className="space-y-6">
          <div className={`flex p-1 rounded-lg border transition-colors ${
            theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800' : 'bg-zinc-100 border-zinc-200'
          }`}>
            {(['public', 'academy', 'private', 'hustle'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setRatesCategory(cat)}
                className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${
                  ratesCategory === cat 
                    ? theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-400'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {[
              { label: 'Basketball Full Court', key: 'basketballFull' },
              { label: 'Basketball Half Court', key: 'basketballHalf' },
              { label: 'Padel Court', key: 'padel' },
              { label: 'Tennis Court', key: 'tennis' },
            ].map(rate => (
              <div key={rate.key} className="flex items-center justify-between group">
                <label className={`text-sm font-medium transition-colors ${
                  theme === 'dark' ? 'text-zinc-400 group-hover:text-zinc-300' : 'text-zinc-500 group-hover:text-zinc-700'
                }`}>{rate.label}</label>
                <div className={`flex items-center gap-2 border rounded-lg px-3 py-1.5 focus-within:ring-2 transition-all ${
                  theme === 'dark' 
                    ? 'bg-zinc-900/50 border-zinc-800 focus-within:ring-blue-500/50 focus-within:border-blue-500' 
                    : 'bg-zinc-50 border-zinc-200 focus-within:ring-blue-500/30 focus-within:border-blue-500'
                }`}>
                  <span className="text-zinc-500 font-medium">{currency === 'USD' ? '$' : 'ل.ل'}</span>
                  <input 
                    type="number" 
                    value={Math.round(convertFromBase(((tempRates as any)[ratesCategory]?.[rate.key]) || 0))}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      const newRates = {
                        ...tempRates,
                        [ratesCategory]: {
                          ...((tempRates as any)[ratesCategory] || {}),
                          [rate.key]: convertToBase(val)
                        }
                      };
                      setTempRates(newRates);
                    }}
                    className={`w-24 bg-transparent text-right focus:outline-none font-medium ${
                      theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'
                    }`}
                  />
                  <span className="text-zinc-600 text-xs font-medium uppercase tracking-wider">/hr</span>
                </div>
              </div>
            ))}

            {(ratesCategory === 'private' || ratesCategory === 'hustle') && (
              <div className="flex items-center justify-between group pt-2 border-t border-zinc-800/50">
                <div>
                  <label className={`text-sm font-bold block transition-colors ${
                    theme === 'dark' ? 'text-cyan-400 group-hover:text-cyan-300' : 'text-cyan-600 group-hover:text-cyan-700'
                  }`}>Extra Player Fee (2nd+ Player)</label>
                  <span className="text-[10px] text-zinc-500">1st player is included in the base court rate</span>
                </div>
                <div className={`flex items-center gap-2 border rounded-lg px-3 py-1.5 focus-within:ring-2 transition-all ${
                  theme === 'dark' 
                    ? 'bg-zinc-900/50 border-zinc-800 focus-within:ring-blue-500/50 focus-within:border-blue-500' 
                    : 'bg-zinc-50 border-zinc-200 focus-within:ring-blue-500/30 focus-within:border-blue-500'
                }`}>
                  <span className="text-zinc-500 font-medium">{currency === 'USD' ? '$' : 'ل.ل'}</span>
                  <input 
                    type="number" 
                    value={Math.round(convertFromBase(((tempRates as any)[ratesCategory]?.perPlayer) || 0))}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      const newRates = {
                        ...tempRates,
                        [ratesCategory]: {
                          ...((tempRates as any)[ratesCategory] || {}),
                          perPlayer: convertToBase(val)
                        }
                      };
                      setTempRates(newRates);
                    }}
                    className={`w-24 bg-transparent text-right focus:outline-none font-medium ${
                      theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'
                    }`}
                  />
                  <span className="text-zinc-600 text-xs font-medium uppercase tracking-wider">/extra/hr</span>
                </div>
              </div>
            )}
          </div>
          <div className={`pt-4 border-t transition-colors ${theme === 'dark' ? 'border-zinc-800/50' : 'border-zinc-200'}`}>
            <button 
              onClick={handleSaveRates} 
              className={`w-full p-3 font-semibold rounded-lg transition-all shadow-sm ${
                theme === 'dark' ? 'bg-zinc-100 text-zinc-900 hover:bg-white' : 'bg-zinc-900 text-white hover:bg-zinc-800'
              }`}
            >Save Changes</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isOffDaysModalOpen} onClose={() => setIsOffDaysModalOpen(false)} title="Off Days Management" theme={theme}>
        <div className="space-y-6">
          <div className="flex gap-2">
            <input 
              type="date" 
              value={newOffDay}
              onChange={(e) => setNewOffDay(e.target.value)}
              className={`flex-1 p-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                theme === 'dark' 
                  ? 'bg-zinc-900/50 border-zinc-800 text-zinc-100 focus:ring-blue-500/50 [color-scheme:dark]' 
                  : 'bg-white border-zinc-200 text-zinc-900 focus:ring-blue-500/30 [color-scheme:light]'
              }`}
            />
            <button 
              onClick={handleAddOffDay}
              className="px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-sm"
            >
              Add Date
            </button>
          </div>

          <div className="space-y-2 pr-2">
            {offDays.length === 0 ? (
              <p className="text-center py-8 text-zinc-500 text-sm">No off days scheduled</p>
            ) : (
              offDays.map(date => (
                <div 
                  key={date} 
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    theme === 'dark' ? 'bg-zinc-900/30 border-zinc-800' : 'bg-zinc-50 border-zinc-100'
                  }`}
                >
                  <span className={`font-mono ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}`}>
                    {new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                  <button 
                    onClick={() => handleRemoveOffDay(date)}
                    className="p-1.5 text-zinc-500 hover:text-red-500 transition-colors"
                  >
                    <span className="text-lg font-bold">×</span>
                  </button>
                </div>
              ))
            )}
          </div>

          <div className={`pt-4 border-t transition-colors ${theme === 'dark' ? 'border-zinc-800/50' : 'border-zinc-200'}`}>
            <button 
              onClick={() => setIsOffDaysModalOpen(false)} 
              className={`w-full p-3 font-semibold rounded-lg transition-all shadow-sm ${
                theme === 'dark' ? 'bg-zinc-100 text-zinc-900 hover:bg-white' : 'bg-zinc-900 text-white hover:bg-zinc-800'
              }`}
            >
              Update
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ReservationPage;
