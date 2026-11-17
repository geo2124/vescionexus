import React, { useState, useMemo } from 'react';
import {
  X, Calendar, Users, Activity, CreditCard, Download, CheckCircle2, Stethoscope, Package
} from 'lucide-react';
import {
  Member,
  PhysioPackage,
  PhysioThirdPartyContract
} from '../../types';
import { processLedgerTransaction } from '../../lib/transaction-engine';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';

export interface PhysioTherapistRecord {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  specialization: string;
  feePerSession?: number;
  commissionPercent?: number;
  employmentType?: 'inhouse' | 'external_quota' | 'third_party';
  activeQuotaPackageId?: string;
  quotaPackageName?: string;
  quotaTotalSessions?: number;
  quotaUsedSessions?: number;
  totalSessionsConducted?: number;
  totalPaidOut?: number;
  paymentHistory?: { id: string; date: string; amount: number; notes?: string }[];
  uid: string;
}

export interface PhysioBookingRecord {
  id: string;
  clientId: string;
  therapistId: string;
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
  type: string;
  sessionType?: string;
  injury?: string;
  bodyArea?: string;
  caseStatus?: string;
  estimatedSessions?: number;
  completedSessionsSnapshot?: number;
  painScale?: number;
  soapNotes?: string;
  programId?: string;
  patientPackageSubId?: string;
  leadSource?: 'partner_client' | 'facility_client';
  thirdPartyContractId?: string;
  cost?: number;
  amountPaid?: number;
  paymentStatus?: 'pending' | 'paid';
  therapistPaidStatus?: 'pending' | 'paid';
  checkedInAt?: string;
  uid: string;
}

interface PhysioTherapist360ModalProps {
  isOpen: boolean;
  onClose: () => void;
  therapist: PhysioTherapistRecord | null;
  bookings: PhysioBookingRecord[];
  clients: Member[];
  packages: PhysioPackage[];
  thirdPartyContracts: PhysioThirdPartyContract[];
  isDarkMode: boolean;
  formatCurrency: (amount: number) => string;
  userUid: string;
  systemName?: string;
  onAssignQuotaPackage: (therapist: PhysioTherapistRecord, pkg: PhysioPackage) => Promise<void>;
}

export const PhysioTherapist360Modal: React.FC<PhysioTherapist360ModalProps> = ({
  isOpen,
  onClose,
  therapist,
  bookings,
  clients,
  packages,
  thirdPartyContracts,
  isDarkMode,
  formatCurrency,
  userUid,
  systemName = 'Vescio Nexus',
  onAssignQuotaPackage
}) => {
  const [activeTab, setActiveTab] = useState<'sessions' | 'patients' | 'breakdown' | 'ledger'>('sessions');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [payoutAmountInput, setPayoutAmountInput] = useState('');
  const [payoutNotesInput, setPayoutNotesInput] = useState('');
  const [selectedQuotaPkgId, setSelectedQuotaPkgId] = useState('');

  const therapistBookings = useMemo(() => {
    if (!therapist) return [];
    return bookings
      .filter(b => b.therapistId === therapist.id)
      .filter(b => {
        if (startDateFilter && b.date < startDateFilter) return false;
        if (endDateFilter && b.date > endDateFilter) return false;
        return true;
      })
      .sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`));
  }, [therapist, bookings, startDateFilter, endDateFilter]);

  const completedBookings = useMemo(
    () => therapistBookings.filter(b => b.status === 'checked_in' || b.status === 'completed'),
    [therapistBookings]
  );

  const activePatients = useMemo(() => {
    if (!therapist) return [];
    const clientIds = new Set(
      bookings.filter(b => b.therapistId === therapist.id).map(b => b.clientId)
    );
    clients.forEach(c => {
      if (c.physioAssignedTherapistId === therapist.id) clientIds.add(c.id);
    });
    return clients.filter(c => clientIds.has(c.id));
  }, [therapist, bookings, clients]);

  const sessionTypeBreakdown = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    completedBookings.forEach(b => {
      const key = b.sessionType || b.type || 'Manual Therapy';
      if (!map[key]) map[key] = { count: 0, revenue: 0 };
      map[key].count += 1;
      map[key].revenue += Number(b.cost) || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count);
  }, [completedBookings]);

  if (!isOpen || !therapist) return null;

  const getBookingPayout = (b: PhysioBookingRecord) => {
    if (therapist.commissionPercent && therapist.commissionPercent > 0) {
      return ((Number(b.cost) || 0) * therapist.commissionPercent) / 100;
    }
    return Number(therapist.feePerSession) || 0;
  };

  const pendingPayoutBookings = completedBookings.filter(b => b.therapistPaidStatus !== 'paid');
  const pendingAccruedAmount = pendingPayoutBookings.reduce((sum, b) => sum + getBookingPayout(b), 0);
  const totalHistoricalPaid =
    (therapist.paymentHistory || []).reduce((s, p) => s + (Number(p.amount) || 0), 0) ||
    completedBookings
      .filter(b => b.therapistPaidStatus === 'paid')
      .reduce((sum, b) => sum + getBookingPayout(b), 0);

  const linkedB2B = thirdPartyContracts.find(tp =>
    (tp.linkedTherapistIds || []).includes(therapist.id)
  );

  const handleSettleTherapistPayout = async () => {
    const amountToPay =
      payoutAmountInput !== '' ? parseFloat(payoutAmountInput) : pendingAccruedAmount;
    if (isNaN(amountToPay) || amountToPay <= 0) {
      toast.error('Enter a valid payout amount greater than $0');
      return;
    }

    try {
      const newPaymentEntry = {
        id: `PAY-${Date.now()}`,
        date: new Date().toISOString(),
        amount: amountToPay,
        notes:
          payoutNotesInput.trim() ||
          `Physiotherapist payout (${pendingPayoutBookings.length} completed sessions)`
      };

      await processLedgerTransaction(
        {
          amount: amountToPay,
          paymentMethod: 'cash',
          sourceModule: 'physio',
          cashierId: userUid,
          transactionType: 'physio_therapist_payout',
          direction: 'outflow',
          sourceAccount: '622 - Practitioner & Coach Commissions',
          destinationAccount: '531 - Cash Drawer / Register (Caisse)',
          referenceId: therapist.id,
          notes: `Physio Payout — Dr. ${therapist.firstName} ${therapist.lastName}: ${newPaymentEntry.notes}`
        },
        async transaction => {
          for (const b of pendingPayoutBookings) {
            transaction.update(doc(db, 'physioBookings', b.id), {
              therapistPaidStatus: 'paid'
            });
          }
          transaction.update(doc(db, 'physiotherapists', therapist.id), {
            totalPaidOut: (therapist.totalPaidOut || 0) + amountToPay,
            paymentHistory: [...(therapist.paymentHistory || []), newPaymentEntry]
          });
        }
      );

      setPayoutAmountInput('');
      setPayoutNotesInput('');
      toast.success(`Paid ${formatCurrency(amountToPay)} to Dr. ${therapist.lastName}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to settle therapist payout');
    }
  };

  const handleExportPDF = () => {
    const pdf = new jsPDF();
    pdf.setFillColor(5, 7, 10);
    pdf.rect(0, 0, 210, 36, 'F');
    pdf.setTextColor(0, 184, 200);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${systemName.toUpperCase()} — PHYSIOTHERAPIST 360 STATEMENT`, 14, 16);
    pdf.setTextColor(220, 225, 235);
    pdf.setFontSize(10);
    pdf.text(
      `Dr. ${therapist.firstName} ${therapist.lastName} (${therapist.specialization})  •  Generated: ${new Date().toLocaleDateString()}`,
      14,
      26
    );

    autoTable(pdf, {
      startY: 42,
      head: [['Metric', 'Value']],
      body: [
        ['Total Sessions Conducted (Filtered)', `${completedBookings.length}`],
        ['Active Assigned / Treated Patients', `${activePatients.length}`],
        ['Pending Unpaid Commission / Fee', formatCurrency(pendingAccruedAmount)],
        ['Total Historical Paid', formatCurrency(totalHistoricalPaid)],
        [
          'Contract / Quota Status',
          linkedB2B
            ? `3rd-Party Partner: ${linkedB2B.partnerName} (${linkedB2B.modelType})`
            : therapist.quotaPackageName
            ? `Quota Pack: ${therapist.quotaPackageName} (${therapist.quotaUsedSessions || 0}/${therapist.quotaTotalSessions || 0})`
            : 'Standard Per-Session / In-House'
        ]
      ],
      headStyles: { fillColor: [0, 184, 200], textColor: [5, 7, 10] }
    });

    autoTable(pdf, {
      startY: (pdf as any).lastAutoTable.finalY + 8,
      head: [['Date & Time', 'Patient', 'Room', 'Session Type', 'Diagnosis', 'Status', 'Fee']],
      body: therapistBookings.map(b => {
        const c = clients.find(cl => cl.id === b.clientId);
        return [
          `${b.date} ${b.startTime}`,
          c ? `${c.firstName} ${c.lastName}` : 'Walk-in',
          b.roomId,
          b.sessionType || b.type,
          b.injury || '-',
          b.status,
          formatCurrency(getBookingPayout(b))
        ];
      }),
      headStyles: { fillColor: [16, 22, 34], textColor: [0, 184, 200] },
      styles: { fontSize: 8 }
    });

    pdf.save(`Physio_Statement_Dr_${therapist.lastName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const therapistPackages = packages.filter(p => p.targetType === 'therapist');

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        className={`w-full max-w-5xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header */}
        <div
          className={`flex flex-wrap items-center justify-between gap-4 px-6 py-5 border-b ${
            isDarkMode ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#00B8C8]/15 border border-[#00B8C8]/30 flex items-center justify-center text-[#00B8C8] text-xl font-black">
              {therapist.firstName[0]}
              {therapist.lastName[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black tracking-tight">
                  Dr. {therapist.firstName} {therapist.lastName}
                </h2>
                <span className="text-xs text-[#00B8C8] font-bold">
                  · {therapist.specialization}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {therapist.phone || 'No phone'} · {therapist.email || 'No email'} · Base Session Fee:{' '}
                {formatCurrency(therapist.feePerSession || 0)}
                {therapist.commissionPercent ? ` (${therapist.commissionPercent}% Rev Split)` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPDF}
              className="px-3.5 py-2 rounded-xl bg-[#00B8C8]/15 hover:bg-[#00B8C8]/25 text-[#00B8C8] border border-[#00B8C8]/30 text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Download size={14} /> Statement PDF
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-400 hover:text-rose-500 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div
          className={`grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-3.5 border-b ${
            isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-100/70 border-slate-200'
          }`}
        >
          <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <div className="text-[10px] font-bold uppercase text-zinc-400">Sessions Conducted</div>
            <div className="text-xl font-black font-mono text-[#00B8C8] mt-0.5">
              {completedBookings.length}
            </div>
          </div>
          <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <div className="text-[10px] font-bold uppercase text-zinc-400">Active Patients</div>
            <div className="text-xl font-black font-mono mt-0.5">{activePatients.length}</div>
          </div>
          <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <div className="text-[10px] font-bold uppercase text-zinc-400">Accrued Unpaid Fee</div>
            <div className="text-xl font-black font-mono text-amber-400 mt-0.5">
              {formatCurrency(pendingAccruedAmount)}
            </div>
          </div>
          <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'}`}>
            <div className="text-[10px] font-bold uppercase text-zinc-400">Total Paid Out</div>
            <div className="text-xl font-black font-mono text-emerald-400 mt-0.5">
              {formatCurrency(totalHistoricalPaid)}
            </div>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div
          className={`flex gap-2 px-6 py-2.5 border-b overflow-x-auto ${
            isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
          }`}
        >
          {[
            { id: 'sessions', label: 'Session & Clinical History', icon: Calendar },
            { id: 'patients', label: `Assigned Patients (${activePatients.length})`, icon: Users },
            { id: 'breakdown', label: 'Session Type Breakdown & Quota', icon: Activity },
            { id: 'ledger', label: 'Financial Ledger & Payouts', icon: CreditCard }
          ].map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                  activeTab === t.id
                    ? 'bg-[#00B8C8] text-[#05070A]'
                    : isDarkMode
                    ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'sessions' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">From Date</label>
                  <input
                    type="date"
                    value={startDateFilter}
                    onChange={e => setStartDateFilter(e.target.value)}
                    className={`p-2 rounded-lg border text-xs ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700 [color-scheme:dark]' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">To Date</label>
                  <input
                    type="date"
                    value={endDateFilter}
                    onChange={e => setEndDateFilter(e.target.value)}
                    className={`p-2 rounded-lg border text-xs ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700 [color-scheme:dark]' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>
                {(startDateFilter || endDateFilter) && (
                  <button
                    onClick={() => {
                      setStartDateFilter('');
                      setEndDateFilter('');
                    }}
                    className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-bold"
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
                <table className="w-full text-left text-xs">
                  <thead className={isDarkMode ? 'bg-[#101622] text-zinc-400' : 'bg-slate-50 text-slate-500'}>
                    <tr>
                      <th className="p-3 font-bold uppercase">Date & Time</th>
                      <th className="p-3 font-bold uppercase">Patient</th>
                      <th className="p-3 font-bold uppercase">Room</th>
                      <th className="p-3 font-bold uppercase">Session Type</th>
                      <th className="p-3 font-bold uppercase">Injury / Diagnosis</th>
                      <th className="p-3 font-bold uppercase">Status</th>
                      <th className="p-3 font-bold uppercase text-right">Therapist Fee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {therapistBookings.map(b => {
                      const patient = clients.find(c => c.id === b.clientId);
                      return (
                        <tr key={b.id} className={isDarkMode ? 'hover:bg-zinc-900/50' : 'hover:bg-slate-50'}>
                          <td className="p-3 font-mono">
                            <div className="font-bold">{b.date}</div>
                            <div className="text-zinc-400">
                              {b.startTime} - {b.endTime}
                            </div>
                          </td>
                          <td className="p-3 font-bold">
                            {patient ? `${patient.firstName} ${patient.lastName}` : 'Walk-in Patient'}
                          </td>
                          <td className="p-3">{b.roomId}</td>
                          <td className="p-3 text-[#00B8C8] font-semibold">
                            {b.sessionType || b.type}
                          </td>
                          <td className="p-3 text-zinc-400">
                            {b.injury || patient?.physioDiagnosis || '—'}
                          </td>
                          <td className="p-3 uppercase font-bold text-[10px]">
                            {b.status === 'checked_in' || b.status === 'completed' ? (
                              <span className="text-emerald-400">Checked-In / Completed</span>
                            ) : b.status === 'cancelled' ? (
                              <span className="text-rose-400">Cancelled</span>
                            ) : (
                              <span className="text-[#00B8C8]">{b.status}</span>
                            )}
                          </td>
                          <td className="p-3 text-right font-mono font-bold">
                            {formatCurrency(getBookingPayout(b))}
                          </td>
                        </tr>
                      );
                    })}
                    {therapistBookings.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-zinc-500">
                          No physiotherapy sessions recorded for this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'patients' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activePatients.map(patient => {
                const est = patient.physioEstimatedSessions || 10;
                const comp =
                  patient.physioCompletedSessions ??
                  bookings.filter(
                    b =>
                      b.clientId === patient.id &&
                      (b.status === 'checked_in' || b.status === 'completed')
                  ).length;
                const pct = Math.min(100, Math.round((comp / Math.max(1, est)) * 100));
                return (
                  <div
                    key={patient.id}
                    className={`p-4 rounded-xl border space-y-2.5 ${
                      isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-sm">
                          {patient.firstName} {patient.lastName}
                        </div>
                        <div className="text-xs text-zinc-400">
                          {patient.phone} · {patient.physioCaseStatus || 'Active Treatment'}
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-[#00B8C8]">
                        {comp} / {est} Sessions
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-[#00B8C8] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-xs text-zinc-400 flex justify-between">
                      <span>Diagnosis: {patient.physioDiagnosis || 'General Rehab'}</span>
                      {(patient as any).visitType && (
                        <span>{(patient as any).visitType}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {activePatients.length === 0 && (
                <div className="col-span-2 p-8 text-center text-zinc-500 text-sm">
                  No patients assigned or treated yet.
                </div>
              )}
            </div>
          )}

          {activeTab === 'breakdown' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#00B8C8] flex items-center gap-2">
                  <Stethoscope size={14} /> Breakdown by Session Type
                </h3>
                {sessionTypeBreakdown.map(([type, stats]) => (
                  <div
                    key={type}
                    className="flex items-center justify-between py-2 border-b border-zinc-800/60 last:border-0 text-xs"
                  >
                    <span className="font-bold">{type}</span>
                    <span className="font-mono text-zinc-300">
                      {stats.count} sessions · {formatCurrency(stats.revenue)}
                    </span>
                  </div>
                ))}
                {sessionTypeBreakdown.length === 0 && (
                  <p className="text-xs text-zinc-500">No completed sessions yet.</p>
                )}
              </div>

              <div
                className={`p-4 rounded-xl border space-y-4 ${
                  isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#00B8C8] flex items-center gap-2">
                  <Package size={14} /> Therapist Quota Package & B2B Contract
                </h3>
                {therapist.quotaPackageName ? (
                  <div className="p-3.5 rounded-xl bg-[#00B8C8]/10 border border-[#00B8C8]/30 space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <span>{therapist.quotaPackageName}</span>
                      <span className="font-mono text-[#00B8C8]">
                        {therapist.quotaUsedSessions || 0} / {therapist.quotaTotalSessions || 0} Used
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-[#00B8C8]"
                        style={{
                          width: `${Math.min(
                            100,
                            ((therapist.quotaUsedSessions || 0) /
                              Math.max(1, therapist.quotaTotalSessions || 1)) *
                              100
                          )}%`
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">No active External Therapist Quota Package assigned.</p>
                )}

                {therapistPackages.length > 0 && (
                  <div className="flex gap-2">
                    <select
                      value={selectedQuotaPkgId}
                      onChange={e => setSelectedQuotaPkgId(e.target.value)}
                      className={`flex-1 p-2 rounded-lg border text-xs ${
                        isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    >
                      <option value="">Assign Therapist Quota Package...</option>
                      {therapistPackages.map(tp => (
                        <option key={tp.id} value={tp.id}>
                          {tp.name} ({tp.sessions} sessions · {formatCurrency(tp.priceOverride ?? tp.price)})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        const pkg = therapistPackages.find(p => p.id === selectedQuotaPkgId);
                        if (!pkg) return;
                        await onAssignQuotaPackage(therapist, pkg);
                        setSelectedQuotaPkgId('');
                      }}
                      className="px-3.5 py-2 rounded-lg bg-[#00B8C8] text-[#05070A] font-bold text-xs"
                    >
                      Assign
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'ledger' && (
            <div className="space-y-5">
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  isDarkMode ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#00B8C8]">
                      Execute Therapist Payout Settlement
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Posts directly to Dual-Mode Accounting (Real-Time & Posting Ledgers)
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase text-zinc-400 font-bold block">
                      Pending Unpaid ({pendingPayoutBookings.length} Sessions)
                    </span>
                    <span className="text-lg font-black font-mono text-amber-400">
                      {formatCurrency(pendingAccruedAmount)}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder={`Amount (Default: ${pendingAccruedAmount.toFixed(2)})`}
                    value={payoutAmountInput}
                    onChange={e => setPayoutAmountInput(e.target.value)}
                    className={`p-2.5 rounded-lg border text-xs font-mono ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                    }`}
                  />
                  <input
                    type="text"
                    placeholder="Settlement notes / reference..."
                    value={payoutNotesInput}
                    onChange={e => setPayoutNotesInput(e.target.value)}
                    className={`p-2.5 rounded-lg border text-xs ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleSettleTherapistPayout}
                    className="py-2.5 px-4 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 size={14} /> Settle & Post to Ledger
                  </button>
                </div>
              </div>

              <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
                <table className="w-full text-left text-xs">
                  <thead className={isDarkMode ? 'bg-[#101622] text-zinc-400' : 'bg-slate-50 text-slate-500'}>
                    <tr>
                      <th className="p-3 font-bold uppercase">Date</th>
                      <th className="p-3 font-bold uppercase">Notes</th>
                      <th className="p-3 font-bold uppercase text-right">Amount Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {(therapist.paymentHistory || []).map(p => (
                      <tr key={p.id}>
                        <td className="p-3 font-mono">{new Date(p.date).toLocaleDateString()}</td>
                        <td className="p-3">{p.notes || 'Therapist session payout'}</td>
                        <td className="p-3 text-right font-mono font-bold text-emerald-400">
                          {formatCurrency(p.amount)}
                        </td>
                      </tr>
                    ))}
                    {(!therapist.paymentHistory || therapist.paymentHistory.length === 0) && (
                      <tr>
                        <td colSpan={3} className="p-4 text-center text-zinc-500">
                          No payout transactions recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
