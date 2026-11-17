import React, { useState, useMemo } from 'react';
import {
  Users, Calendar, Package, CreditCard, FileText, Download, Edit2,
  CheckCircle2, Clock, DollarSign, ShieldCheck, TrendingUp, Plus
} from 'lucide-react';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { processLedgerTransaction } from '../../lib/transaction-engine';
import { Modal } from '../Modal';
import {
  Coach, CoachContract, CoachPackage, Member, GymPackage, GymScheduledSession, ThirdPartyGymContract
} from '../../types';

interface Coach360ModalProps {
  isOpen: boolean;
  onClose: () => void;
  coach: Coach | null;
  coaches: Coach[];
  coachContracts: CoachContract[];
  coachPackages: CoachPackage[];
  members: Member[];
  packages: GymPackage[];
  scheduledSessions: GymScheduledSession[];
  thirdPartyContracts: ThirdPartyGymContract[];
  theme: 'dark' | 'light';
  systemName?: string;
  formatCurrency: (amount: number) => string;
  userUid?: string;
  onEditCoach: (coach: Coach) => void;
  onEditContract: (contract: CoachContract | null, coach: Coach) => void;
}

export const Coach360Modal: React.FC<Coach360ModalProps> = ({
  isOpen,
  onClose,
  coach,
  coachContracts,
  coachPackages,
  members,
  packages,
  scheduledSessions,
  thirdPartyContracts,
  theme,
  systemName,
  formatCurrency,
  userUid,
  onEditCoach,
  onEditContract,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'sessions' | 'clients' | 'contracts' | 'ledger'>('sessions');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDirection, setPaymentDirection] = useState<'inflow' | 'outflow'>('inflow');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  const coachFullName = coach ? `${coach.firstName} ${coach.lastName}` : '';

  const activeContract = useMemo(() => {
    if (!coach) return undefined;
    return coachContracts.find(c => c.coachId === coach.id);
  }, [coach, coachContracts]);

  const allCoachContracts = useMemo(() => {
    if (!coach) return [];
    return coachContracts.filter(c => c.coachId === coach.id);
  }, [coach, coachContracts]);

  const linkedPartner = useMemo(() => {
    if (!coach?.thirdPartyContractId) return undefined;
    return thirdPartyContracts.find(tp => tp.id === coach.thirdPartyContractId);
  }, [coach, thirdPartyContracts]);

  // Aggregate all sessions conducted by this coach across member check-ins, coach standalone check-ins, and coach sessionLedger
  const allSessions = useMemo(() => {
    if (!coach) return [];

    const sessionMap = new Map<string, {
      id: string;
      date: string;
      participants: string[];
      clientCount: number;
      sessionFee: number;
      leadSource?: string;
      sourceType: string;
    }>();

    // 1. From Coach's own sessionLedger (multi-client & tiered sessions)
    (coach.sessionLedger || []).forEach(entry => {
      sessionMap.set(entry.id, {
        id: entry.id,
        date: entry.date,
        participants: entry.clientNames || [],
        clientCount: entry.clientCount || (entry.clientNames?.length || 1),
        sessionFee: entry.feeOverride !== undefined ? entry.feeOverride : (entry.calculatedFee || 0),
        leadSource: entry.leadSource,
        sourceType: 'Session Ledger'
      });
    });

    // 2. From Coach's standalone checkIns array
    (coach.checkIns || []).forEach(ci => {
      if (sessionMap.has(ci.id)) return;
      const names = ci.participantNames && ci.participantNames.length > 0
        ? ci.participantNames
        : ci.guestClientName
        ? [ci.guestClientName]
        : ['Standalone Session'];
      sessionMap.set(ci.id, {
        id: ci.id,
        date: ci.timestamp,
        participants: names,
        clientCount: ci.clientCount || names.length,
        sessionFee: ci.sessionFee ?? 0,
        leadSource: ci.leadSource,
        sourceType: 'Trainer Check-In'
      });
    });

    // 3. From Members' checkIns where coach matches
    members.forEach(m => {
      (m.checkIns || []).forEach(ci => {
        if (ci.coach === coachFullName || ci.coachId === coach.id) {
          const groupKey = ci.sessionGroupId || ci.id;
          const existing = sessionMap.get(groupKey);
          const memberLabel = ci.clientName || `${m.firstName} ${m.lastName}`;
          if (existing) {
            if (!existing.participants.includes(memberLabel)) {
              existing.participants.push(memberLabel);
              existing.clientCount = Math.max(existing.clientCount, existing.participants.length);
            }
          } else {
            sessionMap.set(groupKey, {
              id: groupKey,
              date: ci.date,
              participants: ci.participantNames && ci.participantNames.length > 0 ? [...ci.participantNames] : [memberLabel],
              clientCount: ci.clientCount || 1,
              sessionFee: ci.sessionFee ?? 0,
              leadSource: ci.leadSource,
              sourceType: 'Member Check-In'
            });
          }
        }
      });
    });

    return Array.from(sessionMap.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [coach, coachFullName, members]);

  const filteredSessions = useMemo(() => {
    return allSessions.filter(s => {
      if (!startDateFilter && !endDateFilter) return true;
      const d = new Date(s.date);
      if (startDateFilter && d < new Date(startDateFilter)) return false;
      if (endDateFilter) {
        const end = new Date(endDateFilter);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
      return true;
    });
  }, [allSessions, startDateFilter, endDateFilter]);

  const assignedMembers = useMemo(() => {
    if (!coach) return [];
    return members.filter(
      m => m.id !== 'system_walk_in' && !m.isSystemWalkIn &&
      (m.assignedCoachId === coach.id || m.assignedCoachName === coachFullName)
    );
  }, [coach, coachFullName, members]);

  const upcomingScheduled = useMemo(() => {
    if (!coach) return [];
    return scheduledSessions.filter(s => s.coachId === coach.id && s.status === 'scheduled');
  }, [coach, scheduledSessions]);

  if (!coach) return null;

  const contractMode = activeContract?.contractMode || coach.contractMode || (coach.thirdPartyContractId ? 'third_party' : activeContract?.packageId ? 'package' : 'session_bypass');
  const baseFee1 = activeContract?.baseFeeOneClient ?? coach.baseFeeOneClient ?? coach.hourRate ?? 0;
  const extraFee = activeContract?.extraClientFee ?? coach.extraClientFee ?? 0;
  const maxClients = activeContract?.maxClientsPerSession ?? coach.maxClientsPerSession ?? 5;

  const totalSessionFeesAccrued = allSessions.reduce((sum, s) => sum + (s.sessionFee || 0), 0);
  const contractPackageFee = contractMode === 'package' ? (activeContract?.price || 0) : 0;
  const totalAccruedLiability = contractPackageFee + Math.max(coach.accruedSessionFees || 0, totalSessionFeesAccrued);

  const combinedPayments = [
    ...(activeContract?.paymentHistory || []).map(p => ({ ...p, source: 'Contract' })),
    ...(coach.paymentHistory || []).map(p => ({ ...p, source: 'Direct Ledger' }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalPaidAmount = combinedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const netBalanceDue = Math.max(0, totalAccruedLiability - totalPaidAmount);

  const uniqueParticipants = Array.from(
    new Set(allSessions.flatMap(s => s.participants))
  );

  const handleRecordCoachPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Enter a valid payment amount greater than 0.');
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const paymentEntry = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        amount: amt,
        direction: paymentDirection,
        notes: paymentNotes.trim() || (paymentDirection === 'inflow' ? 'Coach session/contract fee settlement' : 'Coach commission payout')
      };

      await processLedgerTransaction({
        amount: amt,
        paymentMethod,
        sourceModule: 'gym',
        cashierId: userUid || 'system',
        transactionType: paymentDirection === 'inflow' ? 'coach_payment' : 'coach_commission_payout',
        direction: paymentDirection,
        referenceId: activeContract?.id || coach.id,
        notes: `${paymentDirection === 'inflow' ? 'Payment received from' : 'Payout to'} Coach ${coachFullName}: ${paymentEntry.notes}`
      }, async (transaction) => {
        const coachRef = doc(db, 'coaches', coach.id);
        const nextCoachPayments = [...(coach.paymentHistory || []), paymentEntry];
        const nextTotalPaid = (coach.totalPaidFees || 0) + amt;
        transaction.update(coachRef, {
          paymentHistory: nextCoachPayments,
          totalPaidFees: nextTotalPaid
        });

        if (activeContract) {
          const contractRef = doc(db, 'coachContracts', activeContract.id);
          const nextContractPayments = [...(activeContract.paymentHistory || []), paymentEntry];
          const isSettled = (totalPaidAmount + amt) >= (totalAccruedLiability - 0.01);
          transaction.update(contractRef, {
            paymentHistory: nextContractPayments,
            billingStatus: isSettled ? 'paid' : 'unpaid'
          });
        }
      });

      toast.success(`Recorded ${formatCurrency(amt)} (${paymentDirection === 'inflow' ? 'Received from Coach' : 'Paid to Coach'})`);
      setPaymentAmount('');
      setPaymentNotes('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to record coach payment');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleDownloadCoachStatementPDF = () => {
    const pdf = new jsPDF();
    pdf.setFillColor(11, 15, 23);
    pdf.rect(0, 0, 210, 28, 'F');
    pdf.setFillColor(0, 184, 200);
    pdf.rect(0, 28, 210, 1.5, 'F');

    pdf.setFontSize(15);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`${systemName || 'Vescio Nexus'} — 360° Coach Financial & Session Statement`, 14, 13);
    pdf.setFontSize(9);
    pdf.setTextColor(0, 184, 200);
    pdf.text(
      `Coach: ${coachFullName} (${coach.type.toUpperCase()}) | Mode: ${contractMode.toUpperCase()} | Generated: ${new Date().toLocaleString('en-US')}`,
      14,
      21
    );

    autoTable(pdf, {
      startY: 34,
      head: [['Metric', 'Value']],
      body: [
        ['Coach Name & Contact', `${coachFullName} (${coach.phoneNumber || 'N/A'})`],
        ['Contract Mode', contractMode === 'package' ? 'Coach Package' : contractMode === 'third_party' ? `3rd-Party Partner (${linkedPartner?.partnerName || coach.thirdPartyName || 'B2B'})` : 'Direct Session-by-Session (Package Bypass)'],
        ['Tiered Session Fee Rule', `1st Client: $${baseFee1.toFixed(2)} | Extra Client: +$${extraFee.toFixed(2)} (Max ${maxClients} clients)`],
        ['Total Sessions Conducted', String(filteredSessions.length)],
        ['Unique Clients Trained', String(uniqueParticipants.length)],
        ['Total Accrued Package + Session Fees', `$${totalAccruedLiability.toFixed(2)}`],
        ['Total Paid / Settled', `$${totalPaidAmount.toFixed(2)}`],
        ['Net Balance Remaining', `$${netBalanceDue.toFixed(2)}`]
      ],
      theme: 'grid',
      headStyles: { fillColor: [0, 184, 200], textColor: [11, 15, 23], fontStyle: 'bold' },
      styles: { fontSize: 9 }
    });

    const afterSummaryY = (pdf as any).lastAutoTable.finalY + 8;
    pdf.setFontSize(11);
    pdf.setTextColor(11, 15, 23);
    pdf.text('Session & Multi-Client Check-In Ledger', 14, afterSummaryY);

    autoTable(pdf, {
      startY: afterSummaryY + 4,
      head: [['Date & Time', 'Participating Clients', 'Clients Count', 'Lead Source', 'Session Fee ($)']],
      body: filteredSessions.map(s => [
        format(new Date(s.date), 'yyyy-MM-dd HH:mm'),
        s.participants.join(', '),
        String(s.clientCount),
        s.leadSource ? s.leadSource.replace('_', ' ').toUpperCase() : 'STANDARD',
        `$${(s.sessionFee || 0).toFixed(2)}`
      ]),
      theme: 'striped',
      headStyles: { fillColor: [11, 15, 23], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 8 }
    });

    pdf.save(`Coach_Statement_${coach.firstName}_${coach.lastName}_${new Date().toISOString().split('T')[0]}.pdf`);
    toast.success('Coach 360° Statement PDF downloaded!');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`360° Coach Profile — ${coachFullName}`}
      theme={theme}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-6">
        {/* Top Coach Identity & Tiered Pricing Banner */}
        <div className={`p-5 rounded-2xl border ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {coach.photo ? (
                <img src={coach.photo} alt={coachFullName} className="w-16 h-16 rounded-2xl object-cover border border-cyan-500/30" />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-[#00B8C8] text-2xl font-black">
                  {coach.firstName[0]}{coach.lastName[0]}
                </div>
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-black tracking-tight">{coachFullName}</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-500/15 text-[#00B8C8] border border-cyan-500/30">
                    {coach.type === 'inhouse' ? 'In-House Staff' : coach.type === 'third_party' || coach.thirdPartyContractId ? '3rd-Party Partner Trainer' : 'Freelance Trainer'}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-500/15 text-purple-400 border border-purple-500/30">
                    {contractMode === 'package' ? 'Package Contract' : contractMode === 'third_party' ? `B2B: ${linkedPartner?.partnerName || coach.thirdPartyName || 'Partner'}` : 'Per-Session Tiered Contract'}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  {coach.email || 'No email'} • {coach.phoneNumber || 'No phone'} • {coach.yearsOfExperience || 0} yrs exp
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
                  <span className="px-2.5 py-1 rounded-lg bg-[#101622] border border-zinc-800 text-zinc-300 font-mono">
                    1 Client Base: <strong className="text-[#00B8C8]">${baseFee1}</strong>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-[#101622] border border-zinc-800 text-zinc-300 font-mono">
                    Extra Client (2–{maxClients}): <strong className="text-[#00B8C8]">+${extraFee}/client</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onEditCoach(coach)}
                className="px-3 py-2 rounded-xl border border-zinc-700 hover:border-cyan-500/40 text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <Edit2 size={14} /> Edit Profile
              </button>
              <button
                onClick={() => onEditContract(activeContract || null, coach)}
                className="px-3 py-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-[#00B8C8] hover:bg-cyan-500/20 text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <CreditCard size={14} /> Configure Contract & Fee Tiers
              </button>
              <button
                onClick={handleDownloadCoachStatementPDF}
                className="px-3.5 py-2 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)] transition-all"
              >
                <Download size={14} /> Statement PDF
              </button>
            </div>
          </div>

          {/* 5 KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5">
            <div className={`p-3.5 rounded-xl border ${theme === 'dark' ? 'bg-[#101622] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Sessions Conducted</span>
              <span className="text-xl font-black font-mono text-zinc-100 mt-1 block">{allSessions.length}</span>
              {upcomingScheduled.length > 0 && (
                <span className="text-[10px] text-[#00B8C8] font-bold">+{upcomingScheduled.length} scheduled</span>
              )}
            </div>
            <div className={`p-3.5 rounded-xl border ${theme === 'dark' ? 'bg-[#101622] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Clients Trained</span>
              <span className="text-xl font-black font-mono text-zinc-100 mt-1 block">{uniqueParticipants.length}</span>
              <span className="text-[10px] text-zinc-500 font-bold">{assignedMembers.length} assigned active</span>
            </div>
            <div className={`p-3.5 rounded-xl border ${theme === 'dark' ? 'bg-[#101622] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Accrued Fees</span>
              <span className="text-xl font-black font-mono text-[#00B8C8] mt-1 block">{formatCurrency(totalAccruedLiability)}</span>
              <span className="text-[10px] text-zinc-500">Package + Session Tiers</span>
            </div>
            <div className={`p-3.5 rounded-xl border ${theme === 'dark' ? 'bg-[#101622] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Total Settled</span>
              <span className="text-xl font-black font-mono text-emerald-400 mt-1 block">{formatCurrency(totalPaidAmount)}</span>
              <span className="text-[10px] text-zinc-500">{combinedPayments.length} payment(s)</span>
            </div>
            <div className={`p-3.5 rounded-xl border ${theme === 'dark' ? 'bg-[#101622] border-zinc-800' : 'bg-white border-slate-200'}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Net Balance Due</span>
              <span className={`text-xl font-black font-mono mt-1 block ${netBalanceDue > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {formatCurrency(netBalanceDue)}
              </span>
              <span className="text-[10px] text-zinc-500">{netBalanceDue <= 0 ? 'Fully Settled' : 'Open Balance'}</span>
            </div>
          </div>
        </div>

        {/* 4 Navigation Sub-Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-3">
          {([
            { id: 'sessions', label: `Session & Check-In History (${allSessions.length})`, icon: Clock },
            { id: 'clients', label: `Assigned Clients Roster (${assignedMembers.length})`, icon: Users },
            { id: 'contracts', label: `Packages, Contracts & Docs (${allCoachContracts.length})`, icon: Package },
            { id: 'ledger', label: `Payments & Financial Ledger (${combinedPayments.length})`, icon: DollarSign },
          ] as const).map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                  activeSubTab === tab.id
                    ? 'bg-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]'
                    : theme === 'dark'
                    ? 'bg-[#101622] text-zinc-400 hover:text-zinc-100 border border-zinc-800'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-950'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: SESSION & CHECK-IN HISTORY */}
        {activeSubTab === 'sessions' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 justify-between">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">From Date</label>
                  <input
                    type="date"
                    value={startDateFilter}
                    onChange={e => setStartDateFilter(e.target.value)}
                    className="el-input py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">To Date</label>
                  <input
                    type="date"
                    value={endDateFilter}
                    onChange={e => setEndDateFilter(e.target.value)}
                    className="el-input py-1.5 text-xs"
                  />
                </div>
                {(startDateFilter || endDateFilter) && (
                  <button
                    onClick={() => { setStartDateFilter(''); setEndDateFilter(''); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
              <div className="text-xs font-mono text-zinc-400">
                Showing <strong className="text-[#00B8C8]">{filteredSessions.length}</strong> session(s) • Accrued: <strong className="text-[#00B8C8]">{formatCurrency(filteredSessions.reduce((s, x) => s + (x.sessionFee || 0), 0))}</strong>
              </div>
            </div>

            <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-[#0B0F17]' : 'border-slate-200 bg-white'}`}>
              <table className="w-full text-left text-xs">
                <thead className={theme === 'dark' ? 'bg-[#101622] text-zinc-400' : 'bg-slate-50 text-slate-500'}>
                  <tr>
                    <th className="p-3.5 font-bold uppercase">Date & Time</th>
                    <th className="p-3.5 font-bold uppercase">Participating Clients</th>
                    <th className="p-3.5 font-bold uppercase text-center">Client Count</th>
                    <th className="p-3.5 font-bold uppercase">Lead / Mode</th>
                    <th className="p-3.5 font-bold uppercase text-right">Session Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredSessions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-zinc-500">
                        No training sessions recorded for this period.
                      </td>
                    </tr>
                  ) : (
                    filteredSessions.map(sess => (
                      <tr key={sess.id} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="p-3.5 font-mono text-zinc-300">
                          {format(new Date(sess.date), 'MMM d, yyyy h:mm a')}
                        </td>
                        <td className="p-3.5">
                          <div className="flex flex-wrap gap-1">
                            {sess.participants.map((pName, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/20 font-semibold"
                              >
                                {pName}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3.5 text-center font-mono font-bold">
                          {sess.clientCount} {sess.clientCount === 1 ? 'client' : 'clients'}
                        </td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-zinc-800 text-zinc-300">
                            {sess.leadSource ? sess.leadSource.replace('_', ' ') : sess.sourceType}
                          </span>
                        </td>
                        <td className="p-3.5 text-right font-mono font-bold text-[#00B8C8]">
                          {formatCurrency(sess.sessionFee || 0)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: ASSIGNED CLIENTS ROSTER */}
        {activeSubTab === 'clients' && (
          <div className="space-y-4">
            <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-[#0B0F17]' : 'border-slate-200 bg-white'}`}>
              <table className="w-full text-left text-xs">
                <thead className={theme === 'dark' ? 'bg-[#101622] text-zinc-400' : 'bg-slate-50 text-slate-500'}>
                  <tr>
                    <th className="p-3.5 font-bold uppercase">Member Name</th>
                    <th className="p-3.5 font-bold uppercase">Phone</th>
                    <th className="p-3.5 font-bold uppercase">Active Package</th>
                    <th className="p-3.5 font-bold uppercase text-center">Cycle Sessions Used</th>
                    <th className="p-3.5 font-bold uppercase">Expiry Date</th>
                    <th className="p-3.5 font-bold uppercase">Billing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {assignedMembers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-zinc-500">
                        No active Gym members are currently assigned to {coachFullName}.
                      </td>
                    </tr>
                  ) : (
                    assignedMembers.map(m => {
                      const pkg = packages.find(p => p.id === m.packageId);
                      const used = m.currentCycleCheckIns ?? (m.checkIns || []).length;
                      return (
                        <tr key={m.id} className="hover:bg-zinc-800/30">
                          <td className="p-3.5 font-bold">
                            {m.firstName} {m.lastName}
                            {m.groupMembers && m.groupMembers.length > 0 && (
                              <div className="text-[10px] text-[#00B8C8] font-normal mt-0.5">
                                Group: {m.groupMembers.map(g => g.name).join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="p-3.5 font-mono text-zinc-400">{m.phone}</td>
                          <td className="p-3.5">{pkg?.name || 'Custom'}</td>
                          <td className="p-3.5 text-center font-mono font-bold text-[#00B8C8]">
                            {used} / {pkg?.sessions || '∞'}
                          </td>
                          <td className="p-3.5 font-mono text-zinc-400">{m.expiryDate || 'N/A'}</td>
                          <td className="p-3.5">
                            <span className={`el-badge ${m.billingStatus === 'paid' ? 'el-badge-success' : 'el-badge-warning'}`}>
                              {m.billingStatus || 'unpaid'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: PACKAGES, CONTRACTS & DOCUMENTS */}
        {activeSubTab === 'contracts' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-[#00B8C8]">Active Contract & Tiered Fee Rules</h4>
                  <button
                    onClick={() => onEditContract(activeContract || null, coach)}
                    className="text-xs font-bold text-[#00B8C8] hover:underline flex items-center gap-1"
                  >
                    <Edit2 size={12} /> Edit Rules
                  </button>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Operating Mode:</span>
                    <span className="font-bold uppercase">{contractMode.replace('_', ' ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">1st Client Session Fee:</span>
                    <span className="font-mono font-bold text-[#00B8C8]">${baseFee1.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Each Additional Client Fee:</span>
                    <span className="font-mono font-bold text-[#00B8C8]">+${extraFee.toFixed(2)} / client</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Max Clients per Session:</span>
                    <span className="font-mono font-bold">{maxClients} clients</span>
                  </div>
                  {activeContract && (
                    <>
                      <div className="flex justify-between pt-2 border-t border-zinc-800">
                        <span className="text-zinc-400">Contract Period:</span>
                        <span className="font-mono">{activeContract.startDate} → {activeContract.endDate}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Package Quota Remaining:</span>
                        <span className="font-mono font-bold">
                          {activeContract.remainingSessions ?? activeContract.sessions} / {activeContract.sessions} sessions
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Uploaded Compliance Documents */}
              <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
                <h4 className="text-xs font-black uppercase tracking-wider text-zinc-400 mb-3">Compliance & HR Documents</h4>
                <div className="space-y-2.5 text-xs">
                  {coach.cvFile ? (
                    <a
                      href={coach.cvFile}
                      download={`CV_${coach.firstName}_${coach.lastName}`}
                      className="p-2.5 rounded-lg border border-zinc-800 bg-[#101622] flex items-center justify-between hover:border-cyan-500/40"
                    >
                      <span className="font-bold flex items-center gap-2"><FileText size={14} className="text-[#00B8C8]" /> CV / Resume Document</span>
                      <Download size={14} className="text-zinc-400" />
                    </a>
                  ) : (
                    <div className="p-2.5 rounded-lg border border-zinc-800/50 text-zinc-500">No CV Uploaded</div>
                  )}
                  {coach.crcFile ? (
                    <a
                      href={coach.crcFile}
                      download={`CRC_${coach.firstName}_${coach.lastName}`}
                      className="p-2.5 rounded-lg border border-zinc-800 bg-[#101622] flex items-center justify-between hover:border-cyan-500/40"
                    >
                      <span className="font-bold flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-400" /> Criminal Record Check (CRC)</span>
                      <Download size={14} className="text-zinc-400" />
                    </a>
                  ) : (
                    <div className="p-2.5 rounded-lg border border-zinc-800/50 text-zinc-500">No CRC Uploaded</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PAYMENTS & FINANCIAL LEDGER */}
        {activeSubTab === 'ledger' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <form
              onSubmit={handleRecordCoachPayment}
              className={`p-4 rounded-xl border space-y-4 ${theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}
            >
              <h4 className="text-xs font-black uppercase tracking-wider text-[#00B8C8]">
                Record Coach Payment / Settlement
              </h4>

              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Transaction Direction</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentDirection('inflow')}
                    className={`py-2 rounded-lg text-xs font-bold border transition-all ${
                      paymentDirection === 'inflow'
                        ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8]'
                        : 'bg-[#101622] text-zinc-400 border-zinc-800'
                    }`}
                  >
                    Coach Pays Gym (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentDirection('outflow')}
                    className={`py-2 rounded-lg text-xs font-bold border transition-all ${
                      paymentDirection === 'outflow'
                        ? 'bg-amber-500 text-slate-950 border-amber-500'
                        : 'bg-[#101622] text-zinc-400 border-zinc-800'
                    }`}
                  >
                    Gym Pays Coach (-)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Amount ($ USD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder={netBalanceDue > 0 ? String(netBalanceDue.toFixed(2)) : '0.00'}
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  className="el-input font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['cash', 'card', 'transfer'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`py-2 rounded-lg text-[10px] font-bold uppercase border ${
                        paymentMethod === m
                          ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8]'
                          : 'bg-[#101622] text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Notes / Reference</label>
                <input
                  type="text"
                  placeholder="e.g. October session fees settlement"
                  value={paymentNotes}
                  onChange={e => setPaymentNotes(e.target.value)}
                  className="el-input text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingPayment}
                className="w-full py-2.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]"
              >
                {isSubmittingPayment ? 'Posting to Ledger...' : 'Post Payment to Accounting'}
              </button>
            </form>

            <div className={`lg:col-span-2 rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-[#0B0F17]' : 'border-slate-200 bg-white'}`}>
              <table className="w-full text-left text-xs">
                <thead className={theme === 'dark' ? 'bg-[#101622] text-zinc-400' : 'bg-slate-50 text-slate-500'}>
                  <tr>
                    <th className="p-3.5 font-bold uppercase">Date</th>
                    <th className="p-3.5 font-bold uppercase">Direction</th>
                    <th className="p-3.5 font-bold uppercase">Notes</th>
                    <th className="p-3.5 font-bold uppercase text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {combinedPayments.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-zinc-500">
                        No financial settlements recorded for this coach yet.
                      </td>
                    </tr>
                  ) : (
                    combinedPayments.map(p => (
                      <tr key={p.id} className="hover:bg-zinc-800/30">
                        <td className="p-3.5 font-mono text-zinc-300">
                          {format(new Date(p.date), 'MMM d, yyyy h:mm a')}
                        </td>
                        <td className="p-3.5">
                          <span className={`el-badge ${p.direction === 'outflow' ? 'el-badge-warning' : 'el-badge-success'}`}>
                            {p.direction === 'outflow' ? 'Payout to Coach' : 'Received from Coach'}
                          </span>
                        </td>
                        <td className="p-3.5 text-zinc-400">{(p as any).notes || p.source}</td>
                        <td className="p-3.5 text-right font-mono font-bold text-emerald-400">
                          {formatCurrency(p.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
