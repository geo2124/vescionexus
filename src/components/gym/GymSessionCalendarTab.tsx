import React, { useState, useMemo } from 'react';
import {
  Calendar, Plus, CheckCircle2, XCircle, Clock, Users, User, DollarSign, Trash2, Edit2
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
import { toast } from 'sonner';
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Modal } from '../Modal';
import {
  GymScheduledSession, Coach, CoachContract, Member, GymPackage, ThirdPartyGymContract
} from '../../types';

interface GymSessionCalendarTabProps {
  scheduledSessions: GymScheduledSession[];
  coaches: Coach[];
  coachContracts: CoachContract[];
  members: Member[];
  packages: GymPackage[];
  thirdPartyContracts: ThirdPartyGymContract[];
  theme: 'dark' | 'light';
  formatCurrency: (amount: number) => string;
  userUid?: string;
  onExecuteMultiClientCheckIn: (params: {
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
  }) => Promise<void>;
}

export const GymSessionCalendarTab: React.FC<GymSessionCalendarTabProps> = ({
  scheduledSessions,
  coaches,
  coachContracts,
  members,
  packages,
  thirdPartyContracts,
  theme,
  formatCurrency,
  userUid,
  onExecuteMultiClientCheckIn,
}) => {
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewFilterCoachId, setViewFilterCoachId] = useState<string>('all');
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedSessionForDetails, setSelectedSessionForDetails] = useState<GymScheduledSession | null>(null);

  // Schedule Session Form State
  const [formDate, setFormDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [formStartTime, setFormStartTime] = useState<string>('10:00');
  const [formEndTime, setFormEndTime] = useState<string>('11:00');
  const [formCoachId, setFormCoachId] = useState<string>('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [guestNameInput, setGuestNameInput] = useState<string>('');
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [feeOverrideInput, setFeeOverrideInput] = useState<string>('');
  const [sessionRevenueInput, setSessionRevenueInput] = useState<string>('');
  const [leadSource, setLeadSource] = useState<'partner_client' | 'facility_client'>('partner_client');
  const [notes, setNotes] = useState<string>('');
  const [memberSearch, setMemberSearch] = useState<string>('');

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [selectedDate]);

  const selectedCoach = useMemo(
    () => coaches.find(c => c.id === formCoachId),
    [coaches, formCoachId]
  );

  const selectedCoachContract = useMemo(
    () => coachContracts.find(c => c.coachId === formCoachId),
    [coachContracts, formCoachId]
  );

  const linkedThirdParty = useMemo(() => {
    const tpId = selectedCoach?.thirdPartyContractId || selectedCoachContract?.thirdPartyContractId;
    if (!tpId) return undefined;
    return thirdPartyContracts.find(tp => tp.id === tpId);
  }, [selectedCoach, selectedCoachContract, thirdPartyContracts]);

  const totalClientCount = selectedMemberIds.length + guestNames.length;

  // Dynamic Tiered Session Fee Calculation
  const calculatedCoachFee = useMemo(() => {
    if (!selectedCoach || totalClientCount === 0) return 0;
    const base1 = selectedCoachContract?.baseFeeOneClient ?? selectedCoach.baseFeeOneClient ?? selectedCoach.hourRate ?? 0;
    const extra = selectedCoachContract?.extraClientFee ?? selectedCoach.extraClientFee ?? 0;
    const tierOverride = selectedCoachContract?.tierFees?.[totalClientCount] ?? selectedCoach.tierFees?.[totalClientCount];
    if (tierOverride !== undefined) return tierOverride;
    return base1 + Math.max(0, totalClientCount - 1) * extra;
  }, [selectedCoach, selectedCoachContract, totalClientCount]);

  const finalSessionFee = feeOverrideInput !== '' && !isNaN(parseFloat(feeOverrideInput))
    ? Math.max(0, parseFloat(feeOverrideInput))
    : calculatedCoachFee;

  const filteredScheduled = useMemo(() => {
    return scheduledSessions
      .filter(s => viewFilterCoachId === 'all' || s.coachId === viewFilterCoachId)
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  }, [scheduledSessions, viewFilterCoachId]);

  const activeGymMembers = useMemo(() => {
    return members.filter(m =>
      m.id !== 'system_walk_in' &&
      !m.isSystemWalkIn &&
      m.packageId !== 'walk-in' &&
      m.packageId !== 'free-lance' &&
      (!memberSearch.trim() ||
        `${m.firstName} ${m.lastName}`.toLowerCase().includes(memberSearch.toLowerCase()) ||
        (m.phone || '').includes(memberSearch))
    );
  }, [members, memberSearch]);

  const handleToggleMember = (memberId: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    );
  };

  const handleAddGuest = () => {
    if (!guestNameInput.trim()) return;
    setGuestNames(prev => [...prev, guestNameInput.trim()]);
    setGuestNameInput('');
  };

  const handleCreateScheduledSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCoachId || !selectedCoach) {
      toast.error('Please select a Coach for this session.');
      return;
    }
    if (totalClientCount === 0) {
      toast.error('Please select at least 1 Member or add a Guest client.');
      return;
    }

    const memberNames = selectedMemberIds.map(id => {
      const m = members.find(x => x.id === id);
      return m ? `${m.firstName} ${m.lastName}` : id;
    });

    const allParticipantNames = [...memberNames, ...guestNames.map(g => `${g} (Guest)`)];

    try {
      const payload: Omit<GymScheduledSession, 'id'> = {
        date: formDate,
        startTime: formStartTime,
        endTime: formEndTime,
        coachId: selectedCoach.id,
        coachName: `${selectedCoach.firstName} ${selectedCoach.lastName}`,
        participantMemberIds: selectedMemberIds,
        participantNames: allParticipantNames,
        guestNames,
        clientCount: totalClientCount,
        calculatedCoachFee,
        feeOverride: feeOverrideInput !== '' ? parseFloat(feeOverrideInput) : null,
        finalSessionFee,
        sessionRevenue: sessionRevenueInput !== '' ? parseFloat(sessionRevenueInput) : (linkedThirdParty?.defaultSessionPrice || 0),
        leadSource: linkedThirdParty ? leadSource : 'facility_client',
        thirdPartyContractId: linkedThirdParty?.id || '',
        thirdPartyName: linkedThirdParty?.partnerName || '',
        status: 'scheduled',
        notes: notes.trim(),
        uid: userUid || 'system',
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'gym_scheduled_sessions'), payload);
      toast.success(`Scheduled session for ${selectedCoach.firstName} with ${totalClientCount} client(s) on ${formDate} at ${formStartTime}`);
      setIsScheduleModalOpen(false);
      setSelectedMemberIds([]);
      setGuestNames([]);
      setFeeOverrideInput('');
      setSessionRevenueInput('');
      setNotes('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to schedule session');
    }
  };

  const handleConfirmScheduledCheckIn = async (session: GymScheduledSession) => {
    if (session.status === 'checked_in') {
      toast.info('This session is already checked in.');
      return;
    }
    try {
      await onExecuteMultiClientCheckIn({
        coachId: session.coachId,
        coachName: session.coachName,
        memberIds: session.participantMemberIds || [],
        guestNames: session.guestNames || [],
        sessionFeeOverride: session.finalSessionFee,
        leadSource: session.leadSource,
        thirdPartyContractId: session.thirdPartyContractId,
        sessionRevenue: session.sessionRevenue,
        scheduledSessionId: session.id,
        sessionDateIso: new Date(`${session.date}T${session.startTime}:00`).toISOString(),
      });
      setSelectedSessionForDetails(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to confirm check-in');
    }
  };

  const handleCancelScheduled = async (session: GymScheduledSession) => {
    try {
      await updateDoc(doc(db, 'gym_scheduled_sessions', session.id), { status: 'cancelled' });
      toast.info('Scheduled session cancelled.');
      setSelectedSessionForDetails(null);
    } catch (err: any) {
      toast.error('Failed to cancel session');
    }
  };

  const handleDeleteScheduled = async (id: string) => {
    if (!window.confirm('Delete this scheduled session?')) return;
    try {
      await deleteDoc(doc(db, 'gym_scheduled_sessions', id));
      toast.success('Scheduled session deleted');
      setSelectedSessionForDetails(null);
    } catch (err: any) {
      toast.error('Failed to delete session');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
            <Calendar size={20} className="text-[#00B8C8]" />
            Gym Training Session Schedule & Multi-Client Check-In
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Schedule solo or multi-client training sessions ahead of time and execute 1-click check-ins with automatic package session deduction & coach fee calculation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Week View | Month View Switcher */}
          <div className={`inline-flex items-center p-1 rounded-xl border ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-100 border-slate-200'}`}>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                viewMode === 'week'
                  ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Week View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                viewMode === 'month'
                  ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Month View
            </button>
          </div>

          <select
            value={viewFilterCoachId}
            onChange={e => setViewFilterCoachId(e.target.value)}
            className="el-select text-xs py-2"
          >
            <option value="all">All Coaches ({coaches.length})</option>
            {coaches.map(c => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName} ({c.type})
              </option>
            ))}
          </select>

          <button
            onClick={() =>
              setSelectedDate(
                viewMode === 'month' ? subMonths(selectedDate, 1) : addDays(selectedDate, -7)
              )
            }
            className="px-3 py-2 rounded-xl border border-zinc-800 bg-[#101622] text-xs font-bold hover:border-cyan-500/40 whitespace-nowrap"
          >
            ← {viewMode === 'month' ? 'Prev Month' : 'Prev Week'}
          </button>
          <button
            onClick={() => setSelectedDate(new Date())}
            className="px-3 py-2 rounded-xl border border-zinc-800 bg-[#101622] text-xs font-bold text-[#00B8C8] whitespace-nowrap"
          >
            {viewMode === 'month' ? format(selectedDate, 'MMMM yyyy') : 'This Week'}
          </button>
          <button
            onClick={() =>
              setSelectedDate(
                viewMode === 'month' ? addMonths(selectedDate, 1) : addDays(selectedDate, 7)
              )
            }
            className="px-3 py-2 rounded-xl border border-zinc-800 bg-[#101622] text-xs font-bold hover:border-cyan-500/40 whitespace-nowrap"
          >
            {viewMode === 'month' ? 'Next Month' : 'Next Week'} →
          </button>

          <button
            onClick={() => {
              setFormDate(format(selectedDate, 'yyyy-MM-dd'));
              setIsScheduleModalOpen(true);
            }}
            className="el-btn-primary text-xs py-2.5 px-4 whitespace-nowrap"
          >
            <Plus size={15} /> Schedule Session
          </button>
        </div>
      </div>

      {/* 7-Day Interactive Weekly Calendar Grid */}
      {viewMode === 'week' && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {weekDays.map(day => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const daySessions = filteredScheduled.filter(s => s.date === dayStr);
            const isToday = isSameDay(day, new Date());

            return (
              <div
                key={dayStr}
                className={`rounded-2xl border p-3 flex flex-col min-h-[260px] transition-all ${
                  theme === 'dark'
                    ? `bg-[#0B0F17]/90 ${isToday ? 'border-[#00B8C8]/60 ring-1 ring-[#00B8C8]/30' : 'border-zinc-800/80'}`
                    : `bg-white ${isToday ? 'border-[#00B8C8] ring-1 ring-[#00B8C8]/30' : 'border-slate-200'}`
                }`}
              >
                <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-zinc-800/60">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 block">
                      {format(day, 'EEE')}
                    </span>
                    <span className={`text-base font-black ${isToday ? 'text-[#00B8C8]' : ''}`}>
                      {format(day, 'MMM d')}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setFormDate(dayStr);
                      setIsScheduleModalOpen(true);
                    }}
                    className="p-1.5 rounded-lg bg-cyan-500/10 text-[#00B8C8] hover:bg-cyan-500/20 transition-all"
                    title={`Schedule session on ${dayStr}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <div className="space-y-2.5 flex-1">
                  {daySessions.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[11px] text-zinc-500 italic py-8">
                      No sessions
                    </div>
                  ) : (
                    daySessions.map(sess => (
                      <div
                        key={sess.id}
                        className={`p-2.5 rounded-xl border text-xs space-y-2 transition-all ${
                          sess.status === 'checked_in'
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : sess.status === 'cancelled'
                            ? 'bg-rose-500/5 border-rose-500/20 opacity-50'
                            : 'bg-[#101622] border-zinc-800 hover:border-cyan-500/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono font-black text-[11px] text-[#00B8C8]">
                            {sess.startTime} – {sess.endTime}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                            sess.status === 'checked_in'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : sess.status === 'cancelled'
                              ? 'bg-rose-500/20 text-rose-400'
                              : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {sess.status === 'checked_in' ? 'Checked In' : sess.status}
                          </span>
                        </div>

                        <div>
                          <div className="font-bold text-zinc-100 truncate">Coach: {sess.coachName}</div>
                          {sess.thirdPartyName && (
                            <div className="text-[10px] text-purple-400 font-semibold">
                              Partner: {sess.thirdPartyName} ({sess.leadSource === 'partner_client' ? 'Partner Lead' : 'Facility Lead'})
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {(sess.participantNames || []).map((pName, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 text-[10px] border border-zinc-700/80">
                              {pName}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/80 text-[10px]">
                          <span className="text-zinc-400 font-bold">{sess.clientCount} client(s)</span>
                          <span className="font-mono font-black text-[#00B8C8]">Fee: {formatCurrency(sess.finalSessionFee || 0)}</span>
                        </div>

                        {sess.status === 'scheduled' && (
                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              onClick={() => handleConfirmScheduledCheckIn(sess)}
                              className="flex-1 py-1.5 px-2 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-black text-[10px] uppercase flex items-center justify-center gap-1 shadow-sm transition-all"
                            >
                              <CheckCircle2 size={12} /> Confirm Check-In
                            </button>
                            <button
                              onClick={() => handleCancelScheduled(sess)}
                              className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-rose-400"
                              title="Cancel Session"
                            >
                              <XCircle size={13} />
                            </button>
                            <button
                              onClick={() => handleDeleteScheduled(sess.id)}
                              className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-rose-500"
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 7-Column Interactive Month Calendar Grid */}
      {viewMode === 'month' && (
        <div
          className={`rounded-2xl border overflow-hidden ${
            theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
          }`}
        >
          {/* Weekday Headers */}
          <div
            className={`grid grid-cols-7 border-b ${
              theme === 'dark' ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'
            }`}
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => (
              <div
                key={label}
                className="py-2.5 px-3 text-center text-xs font-bold uppercase tracking-wider text-zinc-400"
              >
                {label}
              </div>
            ))}
          </div>

          {/* Month Cells */}
          <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-zinc-800/80">
            {monthDays.map(day => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const daySessions = filteredScheduled.filter(s => s.date === dayStr);
              const isCurrMonth = isSameMonth(day, selectedDate);
              const isToday = isSameDay(day, new Date());

              return (
                <div
                  key={dayStr}
                  onClick={() => {
                    if (daySessions.length === 0) {
                      setFormDate(dayStr);
                      setIsScheduleModalOpen(true);
                    }
                  }}
                  className={`min-h-[140px] p-2.5 flex flex-col justify-between border-b border-slate-200 dark:border-zinc-800/80 transition-colors ${
                    !isCurrMonth
                      ? theme === 'dark'
                        ? 'bg-[#05070A]/60 opacity-45'
                        : 'bg-slate-50/70 opacity-50'
                      : isToday
                      ? theme === 'dark'
                        ? 'bg-[#00B8C8]/5'
                        : 'bg-cyan-50/40'
                      : ''
                  } ${daySessions.length === 0 ? 'cursor-pointer hover:bg-[#00B8C8]/5' : ''}`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`text-xs font-mono font-bold px-2 py-0.5 rounded-lg ${
                          isToday
                            ? 'bg-[#00B8C8] text-slate-950'
                            : theme === 'dark'
                            ? 'text-zinc-300'
                            : 'text-slate-700'
                        }`}
                      >
                        {format(day, 'd MMM')}
                      </span>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          setFormDate(dayStr);
                          setIsScheduleModalOpen(true);
                        }}
                        className="p-1 rounded-lg bg-cyan-500/10 text-[#00B8C8] hover:bg-cyan-500/20 transition-all"
                        title={`Schedule session on ${dayStr}`}
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      {daySessions.map(sess => (
                        <button
                          key={sess.id}
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedSessionForDetails(sess);
                          }}
                          className={`w-full text-left px-2 py-1.5 rounded-lg border text-[11px] transition-all hover:scale-[1.01] space-y-0.5 ${
                            sess.status === 'checked_in'
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                              : sess.status === 'cancelled'
                              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 opacity-60'
                              : 'bg-[#00B8C8]/15 border-[#00B8C8]/40 text-[#00B8C8]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 font-mono font-bold">
                            <span>{sess.startTime}</span>
                            <span className="text-[10px]">
                              {sess.clientCount} {sess.clientCount === 1 ? 'client' : 'clients'}
                            </span>
                          </div>
                          <div className="font-bold truncate text-slate-900 dark:text-zinc-100">
                            {sess.coachName}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Session Detail & Quick Check-In Modal (for Month View clicks) */}
      <Modal
        isOpen={!!selectedSessionForDetails}
        onClose={() => setSelectedSessionForDetails(null)}
        title="Training Session Details"
        theme={theme}
        maxWidth="max-w-md"
      >
        {selectedSessionForDetails && (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 rounded-xl border border-[#00B8C8]/30 bg-[#00B8C8]/10 space-y-1">
              <div className="flex items-center justify-between font-mono text-[#00B8C8] font-bold">
                <span>{selectedSessionForDetails.date}</span>
                <span>
                  {selectedSessionForDetails.startTime} – {selectedSessionForDetails.endTime}
                </span>
              </div>
              <div className="text-base font-extrabold text-slate-900 dark:text-zinc-100">
                Coach: {selectedSessionForDetails.coachName}
              </div>
              {selectedSessionForDetails.thirdPartyName && (
                <div className="text-[11px] text-purple-400 font-semibold">
                  3rd-Party Partner: {selectedSessionForDetails.thirdPartyName}
                </div>
              )}
            </div>

            <div className="p-3 rounded-xl border border-zinc-800 bg-[#0B0F17] space-y-2">
              <div className="flex items-center justify-between text-zinc-400">
                <span>Participants ({selectedSessionForDetails.clientCount} clients)</span>
                <span className="font-mono font-bold text-[#00B8C8]">
                  Session Fee: {formatCurrency(selectedSessionForDetails.finalSessionFee || 0)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(selectedSessionForDetails.participantNames || []).map((name, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 rounded-lg bg-[#101622] border border-zinc-800 text-zinc-200 font-semibold"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>

            {selectedSessionForDetails.status === 'scheduled' && (
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleConfirmScheduledCheckIn(selectedSessionForDetails)}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-bold flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 size={15} />
                  Confirm Check-In
                </button>
                <button
                  type="button"
                  onClick={() => handleCancelScheduled(selectedSessionForDetails)}
                  className="py-2.5 px-3 rounded-xl bg-zinc-800 text-zinc-300 hover:text-rose-400 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteScheduled(selectedSessionForDetails.id)}
                  className="py-2.5 px-3 rounded-xl bg-zinc-800 text-zinc-300 hover:text-rose-500 font-bold"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Schedule New Training Session Modal */}
      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        title="Schedule Multi-Client Training Session"
        theme={theme}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreateScheduledSession} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Date</label>
              <input
                type="date"
                required
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
                className="el-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Start Time</label>
              <input
                type="time"
                required
                value={formStartTime}
                onChange={e => setFormStartTime(e.target.value)}
                className="el-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">End Time</label>
              <input
                type="time"
                required
                value={formEndTime}
                onChange={e => setFormEndTime(e.target.value)}
                className="el-input"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Assign Coach / Trainer</label>
            <select
              required
              value={formCoachId}
              onChange={e => setFormCoachId(e.target.value)}
              className="el-select"
            >
              <option value="">Select Coach...</option>
              {coaches.map(c => {
                const cContract = coachContracts.find(ct => ct.coachId === c.id);
                const b1 = cContract?.baseFeeOneClient ?? c.baseFeeOneClient ?? c.hourRate ?? 0;
                const ex = cContract?.extraClientFee ?? c.extraClientFee ?? 0;
                return (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName} ({c.type.toUpperCase()} — 1st Client: ${b1}{ex > 0 ? ` | +$${ex}/extra` : ''})
                  </option>
                );
              })}
            </select>
          </div>

          {linkedThirdParty && (
            <div className="p-3.5 rounded-xl border border-purple-500/30 bg-purple-500/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-purple-300">
                  3rd-Party Partner Contract: {linkedThirdParty.partnerName} ({linkedThirdParty.modelType === 'revenue_split' ? 'Dual Revenue Split' : 'Fixed Rent + Quota'})
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-300 mb-1">Client Lead Source</label>
                  <select
                    value={leadSource}
                    onChange={e => setLeadSource(e.target.value as any)}
                    className="el-select text-xs py-2"
                  >
                    <option value="partner_client">
                      Brought by {linkedThirdParty.partnerName} ({linkedThirdParty.partnerClientSplitFacilityPct ?? 35}% Facility / {linkedThirdParty.partnerClientSplitPartnerPct ?? 65}% Partner)
                    </option>
                    <option value="facility_client">
                      Brought by Our Facility ({linkedThirdParty.facilityClientSplitFacilityPct ?? 60}% Facility / {linkedThirdParty.facilityClientSplitPartnerPct ?? 40}% Partner)
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-300 mb-1">Gross Session Value ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={String(linkedThirdParty.defaultSessionPrice || 30)}
                    value={sessionRevenueInput}
                    onChange={e => setSessionRevenueInput(e.target.value)}
                    className="el-input text-xs py-2 font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Multi-Client Subscribed Members Picker */}
          <div className={`p-3.5 rounded-xl border space-y-2.5 ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase tracking-wider text-[#00B8C8]">
                Select Participating Members ({selectedMemberIds.length} selected — 1 session deducted per member)
              </label>
            </div>
            <input
              type="text"
              placeholder="Search subscribed members by name or phone..."
              value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
              className="el-input text-xs py-2"
            />
            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
              {activeGymMembers.map(m => {
                const pkg = packages.find(p => p.id === m.packageId);
                const used = m.currentCycleCheckIns ?? (m.checkIns || []).length;
                const isSelected = selectedMemberIds.includes(m.id);
                return (
                  <label
                    key={m.id}
                    className={`p-2 rounded-lg border flex items-center justify-between cursor-pointer text-xs transition-all ${
                      isSelected
                        ? 'bg-cyan-500/15 border-[#00B8C8] text-zinc-100'
                        : 'bg-[#101622]/70 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleMember(m.id)}
                        className="rounded"
                      />
                      <div>
                        <span className="font-bold">{m.firstName} {m.lastName}</span>
                        {m.groupMembers && m.groupMembers.length > 0 && (
                          <span className="ml-2 text-[10px] text-[#00B8C8]">
                            [Group: {m.groupMembers.map(g => g.name).join(', ')}]
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-400">
                      {pkg?.name || 'Pkg'} ({used}/{pkg?.sessions || '∞'})
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* External / Guest Clients in the Same Session */}
          <div className={`p-3.5 rounded-xl border space-y-2.5 ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
            <label className="block text-xs font-black uppercase tracking-wider text-zinc-400">
              Additional Guest / Trainer Clients in Session ({guestNames.length})
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter guest or external client name..."
                value={guestNameInput}
                onChange={e => setGuestNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddGuest();
                  }
                }}
                className="el-input text-xs py-2 flex-1"
              />
              <button
                type="button"
                onClick={handleAddGuest}
                className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-[#00B8C8]"
              >
                + Add Guest
              </button>
            </div>
            {guestNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {guestNames.map((g, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-200 text-xs flex items-center gap-1.5">
                    {g}
                    <button
                      type="button"
                      onClick={() => setGuestNames(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Dynamic Tiered Session Fee Summary & Manual Override */}
          <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-[#00B8C8] block">
                Calculated Coach-to-Gym Session Fee ({totalClientCount} Client{totalClientCount === 1 ? '' : 's'})
              </span>
              <span className="text-2xl font-black font-mono text-[#00B8C8]">
                {formatCurrency(finalSessionFee)}
              </span>
              <span className="text-[10px] text-zinc-400 block mt-0.5">
                Auto-Tier Formula: {formatCurrency(calculatedCoachFee)} (Each member still only loses 1 package session)
              </span>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-300 mb-1">
                Manual Session Fee Override ($ Optional)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder={`Auto (${calculatedCoachFee.toFixed(2)})`}
                value={feeOverrideInput}
                onChange={e => setFeeOverrideInput(e.target.value)}
                className="el-input font-mono font-bold text-xs py-2"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-black text-sm uppercase tracking-wider shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)] transition-all"
          >
            Schedule Session ({totalClientCount} Client{totalClientCount === 1 ? '' : 's'})
          </button>
        </form>
      </Modal>
    </div>
  );
};
