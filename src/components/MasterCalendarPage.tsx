import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar as CalendarIcon,
  Search,
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
  User,
  Dumbbell,
  Activity,
  Trophy,
  CheckCircle2,
  ArrowUpRight,
  Layers,
  Filter,
  MapPin,
  DollarSign,
  Palette,
  RotateCcw
} from 'lucide-react';
import {
  format,
  addDays,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth
} from 'date-fns';
import { collection, doc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { NotificationCenter } from './NotificationCenter';
import { TenantBrandLockup } from './VescioNexusLogo';
import { Modal } from './Modal';
import { openCommandPalette } from './CommandPalette';
import { stripUndefined } from '../lib/transaction-engine';
import {
  Booking,
  GymScheduledSession,
  PhysioRoom,
  Member,
  Coach,
  ThirdPartyGymContract,
  PhysioThirdPartyContract,
  CheckIn
} from '../types';
import { toast } from 'sonner';

type DepartmentType = 'basketball' | 'padel_tennis' | 'gym' | 'physio';
type CalendarViewMode = 'month' | 'week' | 'day';
type StatusFilterMode = 'all' | 'scheduled' | 'completed';

interface UnifiedCalendarEvent {
  id: string;
  department: DepartmentType;
  moduleLabel: string;
  title: string;
  subtitle: string;
  resourceName: string;
  date: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  participants: string[];
  staffName: string;
  category: string;
  price: number;
  rawStatus: string;
  isCompleted: boolean;
  targetPath: string;
  rawRecord: any;
  slotIds?: string[];
}

const addMinutesToTimeStr = (timeStr: string, minsToAdd: number): string => {
  const [hStr, mStr] = (timeStr || '09:00').split(':');
  const h = parseInt(hStr || '9', 10);
  const m = parseInt(mStr || '0', 10);
  const totalMins = h * 60 + m + minsToAdd;
  const nextH = Math.floor(totalMins / 60) % 24;
  const nextM = totalMins % 60;
  return `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
};

// Sort time helper where 00:00 - 01:45 are treated as late night (after 23:45)
const getSortableTimeMinutes = (timeStr: string): number => {
  const [hStr, mStr] = (timeStr || '09:00').split(':');
  const h = parseInt(hStr || '9', 10);
  const m = parseInt(mStr || '0', 10);
  const adjustedH = h < 5 ? h + 24 : h;
  return adjustedH * 60 + m;
};

const DEFAULT_CALENDAR_COLORS: Record<DepartmentType, string> = {
  basketball: '#00B8C8',
  padel_tennis: '#F59E0B',
  gym: '#8B5CF6',
  physio: '#10B981'
};

const ENTERPRISE_SWATCH_PALETTE: { hex: string; name: string }[] = [
  { hex: '#00B8C8', name: 'Vescio Cyan' },
  { hex: '#0EA5E9', name: 'Sky' },
  { hex: '#3B82F6', name: 'Royal Blue' },
  { hex: '#6366F1', name: 'Indigo' },
  { hex: '#8B5CF6', name: 'Violet' },
  { hex: '#A855F7', name: 'Purple' },
  { hex: '#D946EF', name: 'Fuchsia' },
  { hex: '#EC4899', name: 'Pink' },
  { hex: '#F43F5E', name: 'Rose' },
  { hex: '#EF4444', name: 'Red' },
  { hex: '#F97316', name: 'Orange' },
  { hex: '#F59E0B', name: 'Amber' },
  { hex: '#EAB308', name: 'Gold' },
  { hex: '#84CC16', name: 'Lime' },
  { hex: '#10B981', name: 'Emerald' },
  { hex: '#14B8A6', name: 'Teal' }
];

const isValidHexColor = (val: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(val.trim());

const MasterCalendarPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, systemName, systemLogo, formatCurrency } = useFirebase();
  const { isDarkMode, toggleDarkMode } = useTheme();

  // Calendar State
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [departmentFilter, setDepartmentFilter] = useState<'all' | DepartmentType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedEvent, setSelectedEvent] = useState<UnifiedCalendarEvent | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Dynamic Calendar Stream Colors State (Persisted in settings/master_calendar_colors + localStorage)
  const [isColorModalOpen, setIsColorModalOpen] = useState(false);
  const [calendarColors, setCalendarColors] = useState<Record<DepartmentType, string>>(() => {
    try {
      const saved = localStorage.getItem('vescio_master_calendar_colors');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_CALENDAR_COLORS, ...parsed };
      }
    } catch {}
    return { ...DEFAULT_CALENDAR_COLORS };
  });
  const [hexDrafts, setHexDrafts] = useState<Record<DepartmentType, string>>({
    ...DEFAULT_CALENDAR_COLORS
  });

  // Real-Time Firestore Collections
  const [courtBookings, setCourtBookings] = useState<Booking[]>([]);
  const [gymSessions, setGymSessions] = useState<GymScheduledSession[]>([]);
  const [physioBookings, setPhysioBookings] = useState<any[]>([]);
  const [physioRooms, setPhysioRooms] = useState<PhysioRoom[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [coachContracts, setCoachContracts] = useState<any[]>([]);
  const [physiotherapists, setPhysiotherapists] = useState<any[]>([]);
  const [gymThirdPartyContracts, setGymThirdPartyContracts] = useState<ThirdPartyGymContract[]>([]);
  const [physioThirdPartyContracts, setPhysioThirdPartyContracts] = useState<PhysioThirdPartyContract[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(
        doc(db, 'settings', 'master_calendar_colors'),
        snap => {
          if (snap.exists()) {
            const data = snap.data() as Record<string, unknown>;
            const validKeys: DepartmentType[] = ['basketball', 'padel_tennis', 'gym', 'physio'];
            const merged = {} as Record<DepartmentType, string>;
            for (const key of validKeys) {
              const rawVal = typeof data?.[key] === 'string' ? (data[key] as string).trim() : '';
              const match = /^#[0-9A-Fa-f]{6}$/.exec(rawVal);
              merged[key] = match ? match[0] : DEFAULT_CALENDAR_COLORS[key];
            }
            setCalendarColors(merged);
            setHexDrafts(merged);
            try {
              localStorage.setItem('vescio_master_calendar_colors', JSON.stringify(merged));
            } catch (err) {
              console.warn('Failed to cache calendar colors locally:', err);
            }
          }
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'bookings'),
        snap => {
          setCourtBookings(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Booking)));
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'gym_scheduled_sessions'),
        snap => {
          setGymSessions(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as GymScheduledSession)));
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'physioBookings'),
        snap => {
          setPhysioBookings(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'physio_rooms'),
        snap => {
          setPhysioRooms(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as PhysioRoom)));
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'members'),
        snap => {
          setMembers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Member)));
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'coaches'),
        snap => {
          setCoaches(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Coach)));
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'gym_third_party_contracts'),
        snap => {
          setGymThirdPartyContracts(
            snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as ThirdPartyGymContract))
          );
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'physio_third_party_contracts'),
        snap => {
          setPhysioThirdPartyContracts(
            snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as PhysioThirdPartyContract))
          );
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'coachContracts'),
        snap => {
          setCoachContracts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'physiotherapists'),
        snap => {
          setPhysiotherapists(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        },
        () => {}
      )
    );

    return () => unsubs.forEach(u => u());
  }, [user]);

  const roomMap = useMemo(() => {
    const map = new Map<string, string>();
    physioRooms.forEach(r => map.set(r.id, r.name));
    return map;
  }, [physioRooms]);

  // Aggregate All 3 Modules into UnifiedCalendarEvent[]
  const allUnifiedEvents = useMemo<UnifiedCalendarEvent[]>(() => {
    const events: UnifiedCalendarEvent[] = [];

    // 1. Court Reservations (Group contiguous 15-min slots by groupId or date+court+name+category)
    const activeCourtSlots = courtBookings.filter(
      (b: any) => !b.isDeleted && b.status !== 'cancelled' && b.category !== 'off'
    );

    const groupedCourts = new Map<string, Booking[]>();
    activeCourtSlots.forEach(slot => {
      const key = slot.groupId
        ? `grp_${slot.groupId}_${slot.date}_${slot.court}`
        : `single_${slot.id}`;
      const existing = groupedCourts.get(key) || [];
      existing.push(slot);
      groupedCourts.set(key, existing);
    });

    groupedCourts.forEach((slots, groupKey) => {
      const sorted = [...slots].sort(
        (a, b) => getSortableTimeMinutes(a.time) - getSortableTimeMinutes(b.time)
      );
      const first = sorted[0];
      const firstAny = first as any;
      const last = sorted[sorted.length - 1];
      const startTime = first.time || '09:00';
      const endTime = addMinutesToTimeStr(last.time || startTime, 15);

      const courtUpper = (first.court || '').toUpperCase();
      const isPadelOrTennis =
        courtUpper.includes('PADEL') || courtUpper.includes('TENNIS');
      const department: DepartmentType = isPadelOrTennis ? 'padel_tennis' : 'basketball';

      const totalGroupPrice = sorted.reduce((sum, s) => {
        const sAny = s as any;
        const hourlyRate = Number(s.rateApplied ?? sAny.price ?? 40);
        return sum + hourlyRate / 4;
      }, 0);

      const isCompleted = sorted.every(s => s.status === 'cashed_in');
      const catStr = String(first.category || 'public');
      const categoryLabel =
        catStr === 'private'
          ? 'Private Session'
          : catStr === 'academy'
          ? 'Academy'
          : catStr === 'hustle'
          ? 'Hustle Session'
          : catStr === 'tournament'
          ? 'Tournament'
          : catStr === 'event'
          ? 'Special Event'
          : 'Regular Booking';

      const courtDisplay =
        first.court === 'Full'
          ? 'Full Basketball Court'
          : first.court === 'HCA'
          ? 'Half Court A (HCA)'
          : first.court === 'HCB'
          ? 'Half Court B (HCB)'
          : first.court || 'Court';

      const playerCount = Number(firstAny.playersCount ?? firstAny.players ?? 1);

      events.push({
        id: `court_${groupKey}`,
        department,
        moduleLabel: isPadelOrTennis ? 'Padel & Tennis' : 'Basketball Courts',
        title: first.name || 'Court Reservation',
        subtitle: `${courtDisplay} • ${categoryLabel}`,
        resourceName: courtDisplay,
        date: first.date,
        startTime,
        endTime,
        participants: [
          `${first.name || 'Guest'}${playerCount > 1 ? ` (${playerCount} Players)` : ''}`
        ],
        staffName: firstAny.coachName || (catStr === 'private' ? 'Private Coach' : 'Court Facility'),
        category: categoryLabel,
        price: Number(totalGroupPrice.toFixed(2)),
        rawStatus: isCompleted ? 'cashed_in' : first.status || 'booked',
        isCompleted,
        targetPath: '/reservations',
        rawRecord: first,
        slotIds: sorted.map(s => s.id)
      });
    });

    // 2. Gym Scheduled & Checked-In Training Sessions
    gymSessions
      .filter(s => s.status !== 'cancelled')
      .forEach(sess => {
        const isCompleted = sess.status === 'checked_in';
        const participantList =
          sess.participantNames && sess.participantNames.length > 0
            ? sess.participantNames
            : [`${sess.clientCount || 1} Client(s)`];

        events.push({
          id: `gym_${sess.id}`,
          department: 'gym',
          moduleLabel: 'Gym Training',
          title: participantList.join(', '),
          subtitle: `Coach ${sess.coachName || 'Trainer'} • ${sess.clientCount || 1} Client(s)`,
          resourceName: sess.thirdPartyName
            ? `Gym Floor (${sess.thirdPartyName})`
            : `Gym Floor — Coach ${sess.coachName}`,
          date: sess.date,
          startTime: sess.startTime || '10:00',
          endTime: sess.endTime || addMinutesToTimeStr(sess.startTime || '10:00', 60),
          participants: participantList,
          staffName: sess.coachName || 'Gym Trainer',
          category: sess.thirdPartyName
            ? `3rd-Party Partner (${sess.thirdPartyName})`
            : sess.clientCount > 1
            ? `Multi-Client Training (${sess.clientCount})`
            : '1-on-1 Personal Training',
          price: Number(sess.finalSessionFee || sess.calculatedCoachFee || 0),
          rawStatus: sess.status || 'scheduled',
          isCompleted,
          targetPath: '/gym',
          rawRecord: sess
        });
      });

    // 3. Physiotherapy Clinical Appointments
    physioBookings
      .filter((pb: any) => !pb.isDeleted && pb.status !== 'cancelled')
      .forEach((pb: any) => {
        const isCompleted = pb.status === 'completed' || pb.status === 'checked_in';
        const roomLabel =
          pb.roomName ||
          (pb.roomId ? roomMap.get(pb.roomId) : '') ||
          'Treatment Room 1';
        const startTime = pb.time || pb.startTime || '10:00';
        const durationMins = Number(pb.duration || 60);
        const endTime = pb.endTime || addMinutesToTimeStr(startTime, durationMins);
        const patientName = pb.clientName || pb.patientName || 'Clinical Patient';
        const therapistName = pb.physiotherapistName || pb.therapistName || 'Physiotherapist';

        events.push({
          id: `physio_${pb.id}`,
          department: 'physio',
          moduleLabel: 'Physiotherapy',
          title: patientName,
          subtitle: `${roomLabel} • Dr./PT ${therapistName}`,
          resourceName: roomLabel,
          date: pb.date,
          startTime,
          endTime,
          participants: [patientName],
          staffName: therapistName,
          category: pb.sessionType || pb.serviceType || 'Clinical Physiotherapy',
          price: Number(pb.cost || pb.price || 0),
          rawStatus: pb.status || 'scheduled',
          isCompleted,
          targetPath: '/physio',
          rawRecord: pb
        });
      });

    return events.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        getSortableTimeMinutes(a.startTime) - getSortableTimeMinutes(b.startTime)
    );
  }, [courtBookings, gymSessions, physioBookings, roomMap]);

  // Apply Department, Status, and Search Filters
  const filteredEvents = useMemo(() => {
    return allUnifiedEvents.filter(ev => {
      if (departmentFilter !== 'all' && ev.department !== departmentFilter) {
        return false;
      }
      if (statusFilter === 'scheduled' && ev.isCompleted) {
        return false;
      }
      if (statusFilter === 'completed' && !ev.isCompleted) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${ev.title} ${ev.subtitle} ${ev.resourceName} ${ev.staffName} ${ev.category} ${ev.participants.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allUnifiedEvents, departmentFilter, statusFilter, searchQuery]);

  // Date Navigation Helpers
  const handleNavigatePrev = () => {
    if (viewMode === 'month') {
      setSelectedDate(prev => subMonths(prev, 1));
    } else if (viewMode === 'week') {
      setSelectedDate(prev => addDays(prev, -7));
    } else {
      setSelectedDate(prev => addDays(prev, -1));
    }
  };

  const handleNavigateNext = () => {
    if (viewMode === 'month') {
      setSelectedDate(prev => addMonths(prev, 1));
    } else if (viewMode === 'week') {
      setSelectedDate(prev => addDays(prev, 7));
    } else {
      setSelectedDate(prev => addDays(prev, 1));
    }
  };

  const handleNavigateToday = () => {
    setSelectedDate(new Date());
  };

  // Date Intervals for Month, Week, and Day Views
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [selectedDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [selectedDate]);

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');

  const dayEvents = useMemo(() => {
    return filteredEvents.filter(e => e.date === selectedDateStr);
  }, [filteredEvents, selectedDateStr]);

  const sanitizeCalendarColors = (
    rawColors: Record<string, unknown>,
    fallbackColors: Record<DepartmentType, string>
  ): Record<DepartmentType, string> => {
    const validKeys: DepartmentType[] = ['basketball', 'padel_tennis', 'gym', 'physio'];
    const sanitized = {} as Record<DepartmentType, string>;
    for (const key of validKeys) {
      const candidate = rawColors?.[key];
      const strVal = typeof candidate === 'string' ? candidate.trim() : '';
      const match = /^#[0-9A-Fa-f]{6}$/.exec(strVal);
      sanitized[key] = match ? match[0] : fallbackColors[key];
    }
    return sanitized;
  };

  const persistCalendarColors = async (nextColors: Record<DepartmentType, string>) => {
    const safeColors = sanitizeCalendarColors(nextColors, DEFAULT_CALENDAR_COLORS);
    setCalendarColors(safeColors);
    setHexDrafts(safeColors);
    try {
      localStorage.setItem('vescio_master_calendar_colors', JSON.stringify(safeColors));
    } catch (err) {
      console.warn('Failed to persist calendar colors locally:', err);
    }
    try {
      await setDoc(
        doc(db, 'settings', 'master_calendar_colors'),
        { ...safeColors, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (err) {
      console.warn('Failed to persist calendar colors to Firestore:', err);
    }
  };

  const handleUpdateDepartmentColor = async (dept: DepartmentType, rawHex: string) => {
    const clean = rawHex.trim().startsWith('#') ? rawHex.trim().toUpperCase() : `#${rawHex.trim().toUpperCase()}`;
    setHexDrafts(prev => ({ ...prev, [dept]: clean }));
    if (isValidHexColor(clean)) {
      const next = { ...calendarColors, [dept]: clean };
      await persistCalendarColors(next);
    }
  };

  const handleResetDefaultColors = async () => {
    await persistCalendarColors({ ...DEFAULT_CALENDAR_COLORS });
    toast.success('Master Calendar colors reset to default Vescio Nexus palette!');
  };

  // Department Dynamic Styling Helper
  const getDepartmentBadgeStyle = (dept: DepartmentType) => {
    const hex = isValidHexColor(calendarColors[dept] || '')
      ? calendarColors[dept]
      : DEFAULT_CALENDAR_COLORS[dept];
    const inlineStyle: React.CSSProperties = {
      backgroundColor: `${hex}22`,
      borderColor: `${hex}66`,
      color: hex
    };
    const activeFilterStyle: React.CSSProperties = {
      backgroundColor: `${hex}38`,
      borderColor: hex,
      color: hex,
      boxShadow: `0 0 0 1px ${hex}66`
    };
    switch (dept) {
      case 'basketball':
        return {
          hex,
          pill: 'border',
          inlineStyle,
          activeFilterStyle,
          label: 'Basketball',
          shortTag: 'BASKETBALL'
        };
      case 'padel_tennis':
        return {
          hex,
          pill: 'border',
          inlineStyle,
          activeFilterStyle,
          label: 'Padel & Tennis',
          shortTag: 'PADEL / TENNIS'
        };
      case 'gym':
        return {
          hex,
          pill: 'border',
          inlineStyle,
          activeFilterStyle,
          label: 'Gym Sessions',
          shortTag: 'GYM TRAINING'
        };
      case 'physio':
        return {
          hex,
          pill: 'border',
          inlineStyle,
          activeFilterStyle,
          label: 'Physiotherapy',
          shortTag: 'PHYSIOTHERAPY'
        };
    }
  };

  // Quick Action 1: Confirm Check-In for Gym Session
  const handleConfirmGymCheckIn = async (ev: UnifiedCalendarEvent) => {
    if (!user || isProcessingAction) return;
    const sess: GymScheduledSession = ev.rawRecord;
    if (!sess || sess.status === 'checked_in') {
      toast.info('Session is already checked in.');
      return;
    }

    setIsProcessingAction(true);
    try {
      const nowIso = new Date().toISOString();
      const memberIds = sess.participantMemberIds || [];

      for (const mId of memberIds) {
        const memberObj = members.find(m => m.id === mId);
        if (!memberObj) continue;
        const newCheckIn: CheckIn = stripUndefined({
          id: `${Date.now()}_${mId}`,
          memberId: mId,
          date: nowIso,
          coach: sess.coachId || sess.coachName,
          coachId: sess.coachId,
          clientName: `${memberObj.firstName} ${memberObj.lastName}`,
          clientCount: sess.clientCount || 1,
          sessionFee: sess.finalSessionFee || 0,
          leadSource: sess.leadSource || 'facility_client',
          thirdPartyContractId: sess.thirdPartyContractId || undefined
        });
        const updatedCheckIns = stripUndefined([...(memberObj.checkIns || []), newCheckIn]);
        const nextCount = (memberObj.currentCycleCheckIns ?? (memberObj.checkIns || []).length) + 1;
        await updateDoc(doc(db, 'members', mId), stripUndefined({
          checkIns: updatedCheckIns,
          currentCycleCheckIns: nextCount
        }));
        await setDoc(doc(db, `members/${mId}/checkIns`, newCheckIn.id), stripUndefined({
          memberId: mId,
          date: sess.date,
          time: sess.startTime,
          serviceType: 'gym',
          coachId: sess.coachId,
          createdAt: nowIso,
          createdBy: user.uid,
          source: 'master_calendar_checkin'
        }));
      }

      // Update Coach monthly session count, sessionLedger & deduct active coach contract remainingSessions
      const coachObj = sess.coachId
        ? coaches.find(c => c.id === sess.coachId)
        : coaches.find(
            c => `${c.firstName} ${c.lastName}`.trim().toLowerCase() === (sess.coachName || '').trim().toLowerCase()
          );
      if (coachObj) {
        const fee = Number(sess.finalSessionFee || 0);
        const ledgerEntry = stripUndefined({
          id: `SESS-${Date.now()}`,
          date: nowIso,
          clientNames: sess.participantNames || [],
          memberIds: sess.participantMemberIds || [],
          clientCount: sess.clientCount || 1,
          calculatedFee: fee,
          feeOverride: fee,
          leadSource: sess.leadSource || 'partner_client',
          thirdPartyContractId: sess.thirdPartyContractId || undefined,
          status: 'completed' as const
        });
        await updateDoc(doc(db, 'coaches', coachObj.id), stripUndefined({
          currentMonthlySessions: (coachObj.currentMonthlySessions || 0) + 1,
          sessionLedger: [ledgerEntry, ...(coachObj.sessionLedger || [])],
          accruedSessionFees: Number(((coachObj.accruedSessionFees || 0) + fee).toFixed(2))
        }));

        const activeCoachContract = coachContracts.find(cc => cc.coachId === coachObj.id);
        if (
          activeCoachContract &&
          activeCoachContract.contractMode !== 'session_bypass' &&
          (activeCoachContract.remainingSessions ?? activeCoachContract.sessions) > 0
        ) {
          const nextRem = Math.max(0, (activeCoachContract.remainingSessions ?? activeCoachContract.sessions) - 1);
          await updateDoc(doc(db, 'coachContracts', activeCoachContract.id), stripUndefined({
            remainingSessions: nextRem,
            accruedSessionFees: Number(((activeCoachContract.accruedSessionFees || 0) + fee).toFixed(2))
          }));
        }
      }

      // Update Third-Party B2B Gym Contract session counter & practitioner completedSessions if linked
      const targetCoachNameLower = (
        sess.coachName || (coachObj ? `${coachObj.firstName} ${coachObj.lastName}` : '')
      )
        .trim()
        .toLowerCase();
      const matchedContract = gymThirdPartyContracts.find(
        tp =>
          tp.id === sess.thirdPartyContractId ||
          (coachObj && ((tp.linkedCoachIds || []).includes(coachObj.id) || coachObj.thirdPartyContractId === tp.id)) ||
          (tp.practitioners || []).some(
            p =>
              p.id === sess.coachId ||
              (coachObj && (p.id === coachObj.id || p.linkedStaffId === coachObj.id)) ||
              (targetCoachNameLower && p.name.trim().toLowerCase() === targetCoachNameLower)
          )
      );
      if (matchedContract) {
        const updatedPractitioners = (matchedContract.practitioners || []).map(p => {
          const isMatch =
            p.id === sess.coachId ||
            (coachObj && (p.id === coachObj.id || p.linkedStaffId === coachObj.id)) ||
            (targetCoachNameLower && p.name.trim().toLowerCase() === targetCoachNameLower);
          return isMatch ? { ...p, completedSessions: (p.completedSessions || 0) + 1 } : p;
        });
        await updateDoc(doc(db, 'gym_third_party_contracts', matchedContract.id), stripUndefined({
          usedSessionsCurrentCycle: (matchedContract.usedSessionsCurrentCycle || 0) + 1,
          practitioners: updatedPractitioners
        }));
      }

      await updateDoc(doc(db, 'gym_scheduled_sessions', sess.id), {
        status: 'checked_in'
      });

      toast.success(`Checked in Gym Session (${sess.coachName})!`);
      setSelectedEvent(prev =>
        prev ? { ...prev, rawStatus: 'checked_in', isCompleted: true } : null
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to confirm Gym check-in');
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Quick Action 2: Mark Physiotherapy Appointment Completed
  const handleMarkPhysioCompleted = async (ev: UnifiedCalendarEvent) => {
    if (!user || isProcessingAction) return;
    const pb = ev.rawRecord;
    if (!pb || pb.status === 'completed') {
      toast.info('Physiotherapy session is already completed.');
      return;
    }

    setIsProcessingAction(true);
    try {
      await updateDoc(doc(db, 'physioBookings', pb.id), {
        status: 'completed',
        checkedInAt: new Date().toISOString()
      });

      const targetTherapistId = pb.therapistId || pb.physiotherapistId || '';
      const therapistNameLower = (pb.physiotherapistName || pb.therapistName || '')
        .trim()
        .toLowerCase();
      const matchedTherapist = targetTherapistId
        ? physiotherapists.find(t => t.id === targetTherapistId)
        : physiotherapists.find(
            t => `${t.firstName} ${t.lastName}`.trim().toLowerCase() === therapistNameLower
          );

      if (matchedTherapist) {
        const nextConducted = (Number(matchedTherapist.totalSessionsConducted) || 0) + 1;
        const quotaTotal = Number(matchedTherapist.quotaTotalSessions) || 0;
        const nextQuotaUsed =
          quotaTotal > 0
            ? (Number(matchedTherapist.quotaUsedSessions) || 0) + 1
            : Number(matchedTherapist.quotaUsedSessions) || 0;
        const nextRemaining = quotaTotal > 0 ? Math.max(0, quotaTotal - nextQuotaUsed) : undefined;
        await updateDoc(doc(db, 'physiotherapists', matchedTherapist.id), {
          totalSessionsConducted: nextConducted,
          quotaUsedSessions: nextQuotaUsed,
          ...(nextRemaining !== undefined ? { remainingSessions: nextRemaining } : {})
        });
      }

      const matchedTp = physioThirdPartyContracts.find(
        tp =>
          tp.id === pb.thirdPartyContractId ||
          (targetTherapistId && (tp.linkedTherapistIds || []).includes(targetTherapistId)) ||
          (tp.practitioners || []).some(
            p =>
              (targetTherapistId && (p.id === targetTherapistId || p.linkedStaffId === targetTherapistId)) ||
              (therapistNameLower && p.name.trim().toLowerCase() === therapistNameLower)
          )
      );
      if (matchedTp) {
        const updatedPractitioners = (matchedTp.practitioners || []).map(p => {
          const isMatch =
            (targetTherapistId && (p.id === targetTherapistId || p.linkedStaffId === targetTherapistId)) ||
            (therapistNameLower && p.name.trim().toLowerCase() === therapistNameLower);
          return isMatch ? { ...p, completedSessions: (p.completedSessions || 0) + 1 } : p;
        });
        await updateDoc(doc(db, 'physio_third_party_contracts', matchedTp.id), {
          usedSessionsCurrentCycle: (matchedTp.usedSessionsCurrentCycle || 0) + 1,
          practitioners: updatedPractitioners
        });
      }

      toast.success(`Physiotherapy session for ${ev.title} marked as completed!`);
      setSelectedEvent(prev =>
        prev ? { ...prev, rawStatus: 'completed', isCompleted: true } : null
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to complete Physiotherapy session');
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Department KPI summary counts for current filtered set
  const summaryCounts = useMemo(() => {
    return {
      total: filteredEvents.length,
      basketball: filteredEvents.filter(e => e.department === 'basketball').length,
      padelTennis: filteredEvents.filter(e => e.department === 'padel_tennis').length,
      gym: filteredEvents.filter(e => e.department === 'gym').length,
      physio: filteredEvents.filter(e => e.department === 'physio').length
    };
  }, [filteredEvents]);

  return (
    <div
      className={`min-h-screen transition-colors duration-300 flex flex-col ${
        isDarkMode ? 'bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'
      } font-sans`}
    >
      {/* 1-Row Enterprise Header Bar */}
      <header
        className={`sticky top-0 z-40 border-b transition-colors ${
          isDarkMode
            ? 'bg-[#05070A]/90 backdrop-blur-xl border-zinc-800/80'
            : 'bg-white/90 backdrop-blur-xl border-slate-200'
        } px-6 py-3`}
      >
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 shrink-0">
            <TenantBrandLockup
              systemName={systemName}
              systemLogo={systemLogo}
              size="sm"
              subtitle="Master Facility Calendar"
            />
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={openCommandPalette}
              className="hidden md:flex items-center gap-2 h-9 px-3 rounded-lg border text-xs font-bold transition-all bg-[#00B8C8]/10 border-[#00B8C8]/30 text-[#0099A8] dark:text-[#00B8C8] hover:bg-[#00B8C8]/20 whitespace-nowrap"
            >
              <Search size={13} />
              <span>Reception Desk</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white dark:bg-[#0B0F17] text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-800">
                Ctrl+K
              </kbd>
            </button>
            <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
            <NotificationCenter isDarkMode={isDarkMode} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-screen-2xl w-full mx-auto p-6 md:p-8 space-y-6">
        {/* Top Title & Calendar View Switcher Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-3">
              <CalendarIcon className="text-[#00B8C8]" size={26} />
              Unified Master Facility Schedule
            </h1>
            <p className={`text-xs md:text-sm mt-1 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
              Real-time synchronized timeline across Basketball, Padel & Tennis, Gym Training, and Physiotherapy Rooms.
            </p>
          </div>

          {/* View Mode Switcher & Date Navigation */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Month | Week | Day Switcher */}
            <div
              className={`inline-flex items-center p-1 rounded-xl border ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-100 border-slate-200'
              }`}
            >
              {(['month', 'week', 'day'] as CalendarViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap ${
                    viewMode === mode
                      ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                      : isDarkMode
                      ? 'text-zinc-400 hover:text-zinc-100'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {mode} View
                </button>
              ))}
            </div>

            {/* Prev / Today / Next */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleNavigatePrev}
                className={`h-9 px-3 rounded-xl border text-xs font-bold flex items-center gap-1 transition-colors ${
                  isDarkMode
                    ? 'bg-[#0B0F17] border-zinc-800 text-zinc-200 hover:border-[#00B8C8]/50'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-[#00B8C8]/50'
                }`}
              >
                <ChevronLeft size={15} />
                Prev
              </button>
              <button
                onClick={handleNavigateToday}
                className={`h-9 px-3.5 rounded-xl border text-xs font-bold transition-colors ${
                  isDarkMode
                    ? 'bg-[#00B8C8]/10 border-[#00B8C8]/30 text-[#00B8C8] hover:bg-[#00B8C8]/20'
                    : 'bg-cyan-50 border-cyan-200 text-[#0099A8] hover:bg-cyan-100'
                }`}
              >
                Today
              </button>
              <button
                onClick={handleNavigateNext}
                className={`h-9 px-3 rounded-xl border text-xs font-bold flex items-center gap-1 transition-colors ${
                  isDarkMode
                    ? 'bg-[#0B0F17] border-zinc-800 text-zinc-200 hover:border-[#00B8C8]/50'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-[#00B8C8]/50'
                }`}
              >
                Next
                <ChevronRight size={15} />
              </button>
            </div>

            <div
              className={`h-9 px-4 rounded-xl border flex items-center font-mono text-xs font-bold ${
                isDarkMode
                  ? 'bg-[#0B0F17] border-zinc-800 text-[#00B8C8]'
                  : 'bg-white border-slate-200 text-slate-800'
              }`}
            >
              {viewMode === 'month'
                ? format(selectedDate, 'MMMM yyyy')
                : viewMode === 'week'
                ? `${format(weekDays[0], 'MMM d')} – ${format(weekDays[6], 'MMM d, yyyy')}`
                : format(selectedDate, 'EEEE, MMM d, yyyy')}
            </div>
          </div>
        </div>

        {/* Filter & Visual Legend Bar */}
        <div
          className={`p-4 rounded-2xl border flex flex-col xl:flex-row xl:items-center justify-between gap-4 ${
            isDarkMode ? 'bg-[#0B0F17] border-zinc-800/90' : 'bg-white border-slate-200'
          }`}
        >
          {/* Department Filter Buttons with Dynamic Color Signage */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setDepartmentFilter('all')}
              className={`h-9 px-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap ${
                departmentFilter === 'all'
                  ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8] shadow-sm'
                  : isDarkMode
                  ? 'bg-[#101622] border-zinc-800 text-zinc-300 hover:border-zinc-700'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Layers size={14} />
              <span>All Modules</span>
              <span className="font-mono text-[11px] opacity-80">({summaryCounts.total})</span>
            </button>

            <button
              onClick={() => setDepartmentFilter('basketball')}
              style={
                departmentFilter === 'basketball'
                  ? getDepartmentBadgeStyle('basketball').activeFilterStyle
                  : getDepartmentBadgeStyle('basketball').inlineStyle
              }
              className="h-9 px-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap hover:opacity-90"
            >
              <Trophy size={14} />
              <span>Basketball</span>
              <span className="font-mono text-[11px]">({summaryCounts.basketball})</span>
            </button>

            <button
              onClick={() => setDepartmentFilter('padel_tennis')}
              style={
                departmentFilter === 'padel_tennis'
                  ? getDepartmentBadgeStyle('padel_tennis').activeFilterStyle
                  : getDepartmentBadgeStyle('padel_tennis').inlineStyle
              }
              className="h-9 px-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap hover:opacity-90"
            >
              <Trophy size={14} />
              <span>Padel & Tennis</span>
              <span className="font-mono text-[11px]">({summaryCounts.padelTennis})</span>
            </button>

            <button
              onClick={() => setDepartmentFilter('gym')}
              style={
                departmentFilter === 'gym'
                  ? getDepartmentBadgeStyle('gym').activeFilterStyle
                  : getDepartmentBadgeStyle('gym').inlineStyle
              }
              className="h-9 px-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap hover:opacity-90"
            >
              <Dumbbell size={14} />
              <span>Gym Sessions</span>
              <span className="font-mono text-[11px]">({summaryCounts.gym})</span>
            </button>

            <button
              onClick={() => setDepartmentFilter('physio')}
              style={
                departmentFilter === 'physio'
                  ? getDepartmentBadgeStyle('physio').activeFilterStyle
                  : getDepartmentBadgeStyle('physio').inlineStyle
              }
              className="h-9 px-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap hover:opacity-90"
            >
              <Activity size={14} />
              <span>Physiotherapy</span>
              <span className="font-mono text-[11px]">({summaryCounts.physio})</span>
            </button>
          </div>

          {/* Right Controls: Color Customizer, Status Filter & Live Search */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setIsColorModalOpen(true)}
              className={`h-9 px-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap ${
                isDarkMode
                  ? 'bg-[#101622] border-zinc-800 text-zinc-200 hover:border-[#00B8C8]/60 hover:text-[#00B8C8]'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-[#00B8C8]/60 hover:text-[#0099A8]'
              }`}
              title="Customize Calendar Stream Colors"
            >
              <Palette size={14} className="text-[#00B8C8]" />
              <span>Customize Calendar Colors</span>
              <span className="flex items-center gap-1 ml-0.5">
                {(['basketball', 'padel_tennis', 'gym', 'physio'] as DepartmentType[]).map(dept => (
                  <span
                    key={dept}
                    className="w-2.5 h-2.5 rounded-full border border-black/20"
                    style={{ backgroundColor: calendarColors[dept] }}
                  />
                ))}
              </span>
            </button>

            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-zinc-400" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as StatusFilterMode)}
                className={`h-9 px-3 rounded-xl border text-xs font-bold outline-none ${
                  isDarkMode
                    ? 'bg-[#101622] border-zinc-800 text-zinc-200'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <option value="all">All Statuses</option>
                <option value="scheduled">Scheduled / Booked</option>
                <option value="completed">Completed / Cashed-In</option>
              </select>
            </div>

            <div className="relative flex-1 sm:w-64">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search client, coach, court, room..."
                className={`w-full h-9 pl-9 pr-3 rounded-xl border text-xs outline-none transition-colors ${
                  isDarkMode
                    ? 'bg-[#101622] border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus:border-[#00B8C8]'
                    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#00B8C8]'
                }`}
              />
            </div>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* VIEW 1: MONTH VIEW (7-Column Mon–Sun Grid)                            */}
        {/* ===================================================================== */}
        {viewMode === 'month' && (
          <div
            className={`rounded-2xl border overflow-hidden ${
              isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            {/* Weekday Headers */}
            <div
              className={`grid grid-cols-7 border-b ${
                isDarkMode ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(dayLabel => (
                <div
                  key={dayLabel}
                  className="py-2.5 px-3 text-center text-xs font-bold uppercase tracking-wider text-zinc-400"
                >
                  {dayLabel}
                </div>
              ))}
            </div>

            {/* 7-Column Days Grid */}
            <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-zinc-800/80">
              {monthDays.map(day => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const cellEvents = filteredEvents.filter(e => e.date === dayStr);
                const isCurrMonth = isSameMonth(day, selectedDate);
                const isToday = isSameDay(day, new Date());

                return (
                  <div
                    key={dayStr}
                    className={`min-h-[150px] p-2.5 flex flex-col justify-between border-b border-slate-200 dark:border-zinc-800/80 transition-colors ${
                      !isCurrMonth
                        ? isDarkMode
                          ? 'bg-[#05070A]/60 opacity-45'
                          : 'bg-slate-50/70 opacity-50'
                        : isToday
                        ? isDarkMode
                          ? 'bg-[#00B8C8]/5'
                          : 'bg-cyan-50/40'
                        : ''
                    }`}
                  >
                    <div>
                      {/* Day Header */}
                      <div className="flex items-center justify-between mb-2">
                        <button
                          onClick={() => {
                            setSelectedDate(day);
                            setViewMode('day');
                          }}
                          className={`text-xs font-mono font-bold px-2 py-0.5 rounded-lg transition-colors ${
                            isToday
                              ? 'bg-[#00B8C8] text-slate-950'
                              : isDarkMode
                              ? 'text-zinc-300 hover:bg-zinc-800'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                          title="Switch to Day Resource View"
                        >
                          {format(day, 'd MMM')}
                        </button>
                        {cellEvents.length > 0 && (
                          <span className="text-[11px] font-mono text-zinc-400">
                            {cellEvents.length} {cellEvents.length === 1 ? 'event' : 'events'}
                          </span>
                        )}
                      </div>

                      {/* Event List inside Cell */}
                      <div className="space-y-1.5">
                        {cellEvents.slice(0, 4).map(ev => {
                          const style = getDepartmentBadgeStyle(ev.department);
                          return (
                            <button
                              key={ev.id}
                              onClick={() => setSelectedEvent(ev)}
                              style={style.inlineStyle}
                              className={`w-full text-left px-2 py-1 rounded-lg border text-[11px] transition-all hover:scale-[1.01] flex items-center justify-between gap-1.5 ${style.pill}`}
                            >
                              <div className="truncate font-semibold">
                                <span className="font-mono font-bold mr-1">{ev.startTime}</span>
                                <span>{ev.title}</span>
                              </div>
                              <span className="text-[9px] font-mono shrink-0 opacity-80">
                                {ev.resourceName.split(' ')[0]}
                              </span>
                            </button>
                          );
                        })}
                        {cellEvents.length > 4 && (
                          <button
                            onClick={() => {
                              setSelectedDate(day);
                              setViewMode('day');
                            }}
                            className="w-full text-center py-1 text-[10px] font-bold text-[#00B8C8] hover:underline"
                          >
                            +{cellEvents.length - 4} more — View Day
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* VIEW 2: WEEK VIEW (7-Day Chronological Columns)                       */}
        {/* ===================================================================== */}
        {viewMode === 'week' && (
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {weekDays.map(day => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const cellEvents = filteredEvents.filter(e => e.date === dayStr);
              const isToday = isSameDay(day, new Date());

              return (
                <div
                  key={dayStr}
                  className={`rounded-2xl border p-3 flex flex-col min-h-[380px] transition-all ${
                    isDarkMode
                      ? `bg-[#0B0F17] ${
                          isToday ? 'border-[#00B8C8]/70 ring-1 ring-[#00B8C8]/30' : 'border-zinc-800'
                        }`
                      : `bg-white ${
                          isToday ? 'border-[#00B8C8] ring-1 ring-[#00B8C8]/30' : 'border-slate-200'
                        }`
                  }`}
                >
                  {/* Column Day Header */}
                  <div
                    onClick={() => {
                      setSelectedDate(day);
                      setViewMode('day');
                    }}
                    className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-200 dark:border-zinc-800 cursor-pointer group"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                        {format(day, 'EEE')}
                      </span>
                      <span
                        className={`text-base font-extrabold group-hover:text-[#00B8C8] transition-colors ${
                          isToday ? 'text-[#00B8C8]' : ''
                        }`}
                      >
                        {format(day, 'MMM d')}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-zinc-400">
                      {cellEvents.length}
                    </span>
                  </div>

                  {/* Events in Day Column */}
                  <div className="space-y-2 flex-1">
                    {cellEvents.length === 0 ? (
                      <div className="h-32 flex items-center justify-center text-xs text-zinc-500 italic">
                        No scheduled events
                      </div>
                    ) : (
                      cellEvents.map(ev => {
                        const style = getDepartmentBadgeStyle(ev.department);
                        return (
                          <button
                            key={ev.id}
                            onClick={() => setSelectedEvent(ev)}
                            style={style.inlineStyle}
                            className={`w-full text-left p-2.5 rounded-xl border text-xs space-y-1.5 transition-all hover:scale-[1.01] ${style.pill}`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono font-bold text-[11px]">
                                {ev.startTime} – {ev.endTime}
                              </span>
                              <span className="text-[9px] font-mono uppercase opacity-85">
                                {ev.isCompleted ? 'DONE' : 'BOOKED'}
                              </span>
                            </div>
                            <div className="font-bold truncate text-slate-900 dark:text-zinc-100">
                              {ev.title}
                            </div>
                            <div className="text-[11px] opacity-85 truncate">
                              {ev.resourceName}
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-current/15 text-[10px] opacity-90">
                              <span className="truncate">{ev.staffName}</span>
                              <span className="font-mono font-bold">
                                {formatCurrency(ev.price)}
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ===================================================================== */}
        {/* VIEW 3: DAY RESOURCE SWIMLANE VIEW (Courts | Gym | Physio Rooms)      */}
        {/* ===================================================================== */}
        {viewMode === 'day' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Swimlane 1: Basketball, Padel & Tennis Courts */}
            <div
              className={`rounded-2xl border p-5 flex flex-col ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <Trophy
                    size={18}
                    style={{ color: getDepartmentBadgeStyle('basketball').hex }}
                  />
                  <div>
                    <h3 className="text-sm font-bold">Courts & Arena Swimlane</h3>
                    <p className="text-[11px] text-zinc-400">
                      Basketball (Full / HCA / HCB), Padel 1 & 2, Tennis
                    </p>
                  </div>
                </div>
                <span
                  className="text-xs font-mono font-bold"
                  style={{ color: getDepartmentBadgeStyle('basketball').hex }}
                >
                  {
                    dayEvents.filter(
                      e => e.department === 'basketball' || e.department === 'padel_tennis'
                    ).length
                  }{' '}
                  bookings
                </span>
              </div>

              <div className="space-y-2.5">
                {dayEvents.filter(
                  e => e.department === 'basketball' || e.department === 'padel_tennis'
                ).length === 0 ? (
                  <div className="py-12 text-center text-xs text-zinc-500">
                    No court reservations scheduled on {format(selectedDate, 'MMM d, yyyy')}.
                  </div>
                ) : (
                  dayEvents
                    .filter(
                      e => e.department === 'basketball' || e.department === 'padel_tennis'
                    )
                    .map(ev => {
                      const style = getDepartmentBadgeStyle(ev.department);
                      return (
                        <button
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          style={style.inlineStyle}
                          className={`w-full text-left p-3.5 rounded-xl border transition-all hover:scale-[1.01] space-y-1.5 ${style.pill}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-xs">
                              {ev.startTime} – {ev.endTime}
                            </span>
                            <span className="text-[10px] font-mono uppercase">
                              {ev.resourceName}
                            </span>
                          </div>
                          <div className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                            {ev.title}
                          </div>
                          <div className="flex items-center justify-between text-xs opacity-85">
                            <span>
                              {ev.category} · {ev.staffName}
                            </span>
                            <span className="font-mono font-bold">
                              {formatCurrency(ev.price)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                )}
              </div>
            </div>

            {/* Swimlane 2: Gym Coaches & Personal Training */}
            <div
              className={`rounded-2xl border p-5 flex flex-col ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <Dumbbell
                    size={18}
                    style={{ color: getDepartmentBadgeStyle('gym').hex }}
                  />
                  <div>
                    <h3 className="text-sm font-bold">Gym Coaches Swimlane</h3>
                    <p className="text-[11px] text-zinc-400">
                      1-on-1, Multi-Client Roster & B2B Partner Training
                    </p>
                  </div>
                </div>
                <span
                  className="text-xs font-mono font-bold"
                  style={{ color: getDepartmentBadgeStyle('gym').hex }}
                >
                  {dayEvents.filter(e => e.department === 'gym').length} sessions
                </span>
              </div>

              <div className="space-y-2.5">
                {dayEvents.filter(e => e.department === 'gym').length === 0 ? (
                  <div className="py-12 text-center text-xs text-zinc-500">
                    No gym training sessions scheduled on {format(selectedDate, 'MMM d, yyyy')}.
                  </div>
                ) : (
                  dayEvents
                    .filter(e => e.department === 'gym')
                    .map(ev => {
                      const style = getDepartmentBadgeStyle('gym');
                      return (
                        <button
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          style={style.inlineStyle}
                          className={`w-full text-left p-3.5 rounded-xl border transition-all hover:scale-[1.01] space-y-1.5 ${style.pill}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-xs">
                              {ev.startTime} – {ev.endTime}
                            </span>
                            <span className="text-[10px] font-mono uppercase">
                              {ev.isCompleted ? 'CHECKED IN' : 'SCHEDULED'}
                            </span>
                          </div>
                          <div className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                            Coach {ev.staffName}
                          </div>
                          <div className="text-xs opacity-90 truncate">
                            Clients: {ev.participants.join(', ')}
                          </div>
                          <div className="flex items-center justify-between text-xs opacity-85 pt-1 border-t border-current/15">
                            <span>{ev.category}</span>
                            <span className="font-mono font-bold">
                              Fee: {formatCurrency(ev.price)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                )}
              </div>
            </div>

            {/* Swimlane 3: Physiotherapy Rooms & Cabins */}
            <div
              className={`rounded-2xl border p-5 flex flex-col ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <Activity
                    size={18}
                    style={{ color: getDepartmentBadgeStyle('physio').hex }}
                  />
                  <div>
                    <h3 className="text-sm font-bold">Physiotherapy Rooms Swimlane</h3>
                    <p className="text-[11px] text-zinc-400">
                      Treatment Cabins, Rehab Gym & B2B Practitioner Cases
                    </p>
                  </div>
                </div>
                <span
                  className="text-xs font-mono font-bold"
                  style={{ color: getDepartmentBadgeStyle('physio').hex }}
                >
                  {dayEvents.filter(e => e.department === 'physio').length} appointments
                </span>
              </div>

              <div className="space-y-2.5">
                {dayEvents.filter(e => e.department === 'physio').length === 0 ? (
                  <div className="py-12 text-center text-xs text-zinc-500">
                    No physiotherapy appointments scheduled on {format(selectedDate, 'MMM d, yyyy')}.
                  </div>
                ) : (
                  dayEvents
                    .filter(e => e.department === 'physio')
                    .map(ev => {
                      const style = getDepartmentBadgeStyle('physio');
                      return (
                        <button
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          style={style.inlineStyle}
                          className={`w-full text-left p-3.5 rounded-xl border transition-all hover:scale-[1.01] space-y-1.5 ${style.pill}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-xs">
                              {ev.startTime} – {ev.endTime}
                            </span>
                            <span className="text-[10px] font-mono uppercase">
                              {ev.resourceName}
                            </span>
                          </div>
                          <div className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                            {ev.title}
                          </div>
                          <div className="flex items-center justify-between text-xs opacity-85">
                            <span>
                              {ev.category} · {ev.staffName}
                            </span>
                            <span className="font-mono font-bold">
                              {formatCurrency(ev.price)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Interactive Event Detail & Quick Action Modal */}
      <Modal
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent ? `${selectedEvent.moduleLabel} — Event Details` : 'Event Details'}
        theme={isDarkMode ? 'dark' : 'light'}
        maxWidth="max-w-lg"
      >
        {selectedEvent && (
          <div className="space-y-5">
            {/* Top Summary Banner */}
            <div
              style={getDepartmentBadgeStyle(selectedEvent.department).inlineStyle}
              className={`p-4 rounded-xl border ${
                getDepartmentBadgeStyle(selectedEvent.department).pill
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono mb-1">
                <span>{selectedEvent.moduleLabel.toUpperCase()}</span>
                <span>
                  {selectedEvent.date} · {selectedEvent.startTime} – {selectedEvent.endTime}
                </span>
              </div>
              <h4 className="text-lg font-extrabold text-slate-900 dark:text-zinc-100">
                {selectedEvent.title}
              </h4>
              <p className="text-xs opacity-90 mt-0.5">{selectedEvent.subtitle}</p>
            </div>

            {/* Structured Metadata Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div
                className={`p-3 rounded-xl border ${
                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <span className="text-zinc-400 block mb-1">Court / Room / Resource</span>
                <span className="font-bold flex items-center gap-1.5">
                  <MapPin size={13} className="text-[#00B8C8]" />
                  {selectedEvent.resourceName}
                </span>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <span className="text-zinc-400 block mb-1">Coach / Practitioner</span>
                <span className="font-bold flex items-center gap-1.5">
                  <User size={13} className="text-[#00B8C8]" />
                  {selectedEvent.staffName}
                </span>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <span className="text-zinc-400 block mb-1">Category & Rate</span>
                <span className="font-bold font-mono flex items-center gap-1.5">
                  <DollarSign size={13} className="text-[#00B8C8]" />
                  {selectedEvent.category} ({formatCurrency(selectedEvent.price)})
                </span>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <span className="text-zinc-400 block mb-1">Current Status</span>
                <span
                  className={`font-bold uppercase font-mono ${
                    selectedEvent.isCompleted ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {selectedEvent.rawStatus.replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* Participants List */}
            <div
              className={`p-3.5 rounded-xl border ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <span className="text-xs text-zinc-400 block mb-2">
                Client / Patient Roster ({selectedEvent.participants.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {selectedEvent.participants.map((p, idx) => (
                  <span
                    key={idx}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                      isDarkMode
                        ? 'bg-[#101622] border-zinc-800 text-zinc-200'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              {selectedEvent.department === 'gym' && !selectedEvent.isCompleted && (
                <button
                  onClick={() => handleConfirmGymCheckIn(selectedEvent)}
                  disabled={isProcessingAction}
                  className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 size={15} />
                  Confirm Check-In
                </button>
              )}

              {selectedEvent.department === 'physio' && !selectedEvent.isCompleted && (
                <button
                  onClick={() => handleMarkPhysioCompleted(selectedEvent)}
                  disabled={isProcessingAction}
                  className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 size={15} />
                  Mark Session Completed
                </button>
              )}

              <button
                onClick={() => {
                  const target = selectedEvent.targetPath;
                  setSelectedEvent(null);
                  navigate(target);
                }}
                className={`w-full sm:flex-1 py-2.5 px-4 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition-colors ${
                  isDarkMode
                    ? 'bg-[#101622] border-zinc-700 text-zinc-100 hover:border-[#00B8C8]'
                    : 'bg-slate-100 border-slate-300 text-slate-800 hover:border-[#00B8C8]'
                }`}
              >
                <span>Open in {selectedEvent.moduleLabel}</span>
                <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Advanced Color Customizer Modal */}
      <Modal
        isOpen={isColorModalOpen}
        onClose={() => setIsColorModalOpen(false)}
        title="Customize Master Calendar Stream Colors"
        theme={isDarkMode ? 'dark' : 'light'}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-zinc-800">
            <p className="text-xs text-zinc-400">
              Select a custom color using the interactive color wheel, enter any 6-digit HEX code, or pick from the high-contrast enterprise palette below. Changes apply immediately across Month, Week, and Day swimlanes.
            </p>
            <button
              type="button"
              onClick={handleResetDefaultColors}
              className={`px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors ${
                isDarkMode
                  ? 'bg-[#101622] border-zinc-800 text-zinc-300 hover:border-[#00B8C8] hover:text-[#00B8C8]'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:border-[#00B8C8] hover:text-[#0099A8]'
              }`}
            >
              <RotateCcw size={13} />
              <span>Reset to Default Vescio Colors</span>
            </button>
          </div>

          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            {(
              [
                {
                  dept: 'basketball' as DepartmentType,
                  title: 'Basketball Courts',
                  subtitle: 'Full Court, Half Court A, Half Court B',
                  defaultHex: DEFAULT_CALENDAR_COLORS.basketball,
                },
                {
                  dept: 'padel_tennis' as DepartmentType,
                  title: 'Padel & Tennis Courts',
                  subtitle: 'Padel Court 1, Padel Court 2, Tennis Court',
                  defaultHex: DEFAULT_CALENDAR_COLORS.padel_tennis,
                },
                {
                  dept: 'gym' as DepartmentType,
                  title: 'Gym Coach Sessions',
                  subtitle: '1-on-1 PT, Group Classes & B2B Coach Contracts',
                  defaultHex: DEFAULT_CALENDAR_COLORS.gym,
                },
                {
                  dept: 'physio' as DepartmentType,
                  title: 'Physiotherapy Appointments',
                  subtitle: 'Treatment Cabins, Rehab Gym & B2B Practitioners',
                  defaultHex: DEFAULT_CALENDAR_COLORS.physio,
                },
              ]
            ).map(item => {
              const currentHex = calendarColors[item.dept] || item.defaultHex;
              const draftVal = hexDrafts[item.dept] ?? currentHex;
              const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(draftVal.trim());

              return (
                <div
                  key={item.dept}
                  className={`p-4 rounded-2xl border space-y-3.5 ${
                    isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* 1. Interactive Native Color Wheel / Spectrum Picker */}
                      <label
                        className="relative w-11 h-11 rounded-full cursor-pointer shrink-0 flex items-center justify-center shadow-md border-2 border-white/20 transition-transform hover:scale-105"
                        style={{ backgroundColor: currentHex }}
                        title="Click to open interactive Color Wheel / Spectrum Picker"
                      >
                        <input
                          type="color"
                          value={/^#[0-9A-Fa-f]{6}$/.test(currentHex) ? currentHex : item.defaultHex}
                          onChange={e => handleUpdateDepartmentColor(item.dept, e.target.value)}
                          className="sr-only"
                        />
                        <Palette size={16} className="text-white drop-shadow" />
                      </label>

                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold">{item.title}</h4>
                          <span
                            className="px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold"
                            style={{
                              backgroundColor: `${currentHex}22`,
                              borderColor: `${currentHex}66`,
                              color: currentHex,
                            }}
                          >
                            LIVE PREVIEW
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400">{item.subtitle}</p>
                      </div>
                    </div>

                    {/* 2. Direct HEX Code Input (#RRGGBB) with live validation */}
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          type="text"
                          maxLength={7}
                          value={draftVal}
                          onChange={e => {
                            let val = e.target.value.toUpperCase();
                            if (val && !val.startsWith('#')) {
                              val = `#${val}`;
                            }
                            setHexDrafts(prev => ({ ...prev, [item.dept]: val }));
                            if (/^#[0-9A-F]{6}$/.test(val)) {
                              handleUpdateDepartmentColor(item.dept, val);
                            }
                          }}
                          placeholder="#00B8C8"
                          className={`w-28 h-9 px-3 rounded-xl border font-mono text-xs font-bold uppercase outline-none transition-colors ${
                            isValidHex
                              ? isDarkMode
                                ? 'bg-[#101622] border-zinc-700 text-zinc-100 focus:border-[#00B8C8]'
                                : 'bg-white border-slate-300 text-slate-900 focus:border-[#00B8C8]'
                              : 'border-rose-500 text-rose-500 bg-rose-500/10'
                          }`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 3. Curated High-Contrast Enterprise Swatch Palette (16 swatches) */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {ENTERPRISE_SWATCH_PALETTE.map(swatch => {
                      const isSelected = currentHex.toUpperCase() === swatch.hex.toUpperCase();
                      return (
                        <button
                          key={swatch.hex}
                          type="button"
                          onClick={() => handleUpdateDepartmentColor(item.dept, swatch.hex)}
                          className={`w-6 h-6 rounded-lg border transition-all flex items-center justify-center ${
                            isSelected
                              ? 'scale-110 ring-2 ring-offset-2 ring-[#00B8C8] dark:ring-offset-[#0B0F17] border-white'
                              : 'border-black/20 hover:scale-110 opacity-85 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: swatch.hex }}
                          title={`${swatch.name} (${swatch.hex})`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setIsColorModalOpen(false)}
              className="px-5 py-2.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-bold text-xs transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MasterCalendarPage;
