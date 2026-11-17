import React, { useState } from 'react';
import {
  Building2, Plus, Edit2, Trash2, DollarSign, FileText, Zap, CheckCircle2, X, UserCheck
} from 'lucide-react';
import {
  PhysioThirdPartyContract,
  ThirdPartyAddonExpense,
  ThirdPartySettlementRecord,
  ThirdPartyPractitioner
} from '../../types';
import { PhysioTherapistRecord, PhysioBookingRecord } from './PhysioTherapist360Modal';
import { processLedgerTransaction, stripUndefined } from '../../lib/transaction-engine';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';

interface PhysioThirdPartyContractsTabProps {
  contracts: PhysioThirdPartyContract[];
  therapists: PhysioTherapistRecord[];
  bookings: PhysioBookingRecord[];
  isDarkMode: boolean;
  formatCurrency: (val: number) => string;
  userUid: string;
  systemName?: string;
  onSaveContract: (contract: Omit<PhysioThirdPartyContract, 'id'>, existingId?: string) => Promise<void>;
  onDeleteContract: (id: string) => Promise<void>;
}

export const PhysioThirdPartyContractsTab: React.FC<PhysioThirdPartyContractsTabProps> = ({
  contracts,
  therapists,
  bookings,
  isDarkMode,
  formatCurrency,
  userUid,
  systemName = 'Vescio Nexus',
  onSaveContract,
  onDeleteContract
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingContract, setEditingContract] = useState<PhysioThirdPartyContract | null>(null);
  const [settleModalContract, setSettleModalContract] = useState<PhysioThirdPartyContract | null>(null);

  const [form, setForm] = useState<Omit<PhysioThirdPartyContract, 'id'>>({
    partnerName: '',
    contactPerson: '',
    phone: '',
    email: '',
    contactEmail: '',
    modelType: 'revenue_split',
    partnerClientSplitPartnerPct: 65,
    partnerClientSplitFacilityPct: 35,
    facilityClientSplitFacilityPct: 60,
    facilityClientSplitPartnerPct: 40,
    defaultSessionPrice: 50,
    fixedMonthlyRent: 500,
    allowedSessionsQuota: 40,
    usedSessionsCurrentCycle: 0,
    overageFeePerSession: 15,
    enableFacilityClientSplitOnFixedRent: false,
    facilityClientSplitPercent: 60,
    billingCycleStart: new Date().toISOString().slice(0, 10),
    billingCycleEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    linkedTherapistIds: [],
    practitioners: [],
    addonExpenses: [],
    settlements: [],
    status: 'active',
    createdAt: new Date().toISOString()
  });

  // Inline Practitioner Builder state
  const [practNameInput, setPractNameInput] = useState('');
  const [practSpecialtyInput, setPractSpecialtyInput] = useState('');
  const [practPhoneInput, setPractPhoneInput] = useState('');
  const [practEmailInput, setPractEmailInput] = useState('');

  // Add-on Expense input state
  const [expenseName, setExpenseName] = useState('');
  const [expenseType, setExpenseType] = useState<'fixed' | 'percentage_of_bill'>('fixed');
  const [expenseFixedVal, setExpenseFixedVal] = useState(50);
  const [expenseBillTotal, setExpenseBillTotal] = useState(500);
  const [expensePctVal, setExpensePctVal] = useState(10);

  // Settlement modal state
  const [settlePaymentMethod, setSettlePaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [settleOverrideAmount, setSettleOverrideAmount] = useState('');
  const [settleNotes, setSettleNotes] = useState('');

  // Quick Log B2B Partner Session Modal State
  const [activeLogSessionContract, setActiveLogSessionContract] = useState<PhysioThirdPartyContract | null>(null);
  const [logPractitionerId, setLogPractitionerId] = useState('');
  const [logPatientName, setLogPatientName] = useState('');
  const [logLeadSource, setLogLeadSource] = useState<'partner_client' | 'facility_client'>('partner_client');
  const [logSessionFee, setLogSessionFee] = useState(50);
  const [logSessionDate, setLogSessionDate] = useState(new Date().toISOString().slice(0, 10));

  const openCreateModal = () => {
    setEditingContract(null);
    setForm({
      partnerName: '',
      contactPerson: '',
      phone: '',
      email: '',
      contactEmail: '',
      modelType: 'revenue_split',
      partnerClientSplitPartnerPct: 65,
      partnerClientSplitFacilityPct: 35,
      facilityClientSplitFacilityPct: 60,
      facilityClientSplitPartnerPct: 40,
      defaultSessionPrice: 50,
      fixedMonthlyRent: 500,
      allowedSessionsQuota: 40,
      usedSessionsCurrentCycle: 0,
      overageFeePerSession: 15,
      enableFacilityClientSplitOnFixedRent: false,
      facilityClientSplitPercent: 60,
      billingCycleStart: new Date().toISOString().slice(0, 10),
      billingCycleEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      linkedTherapistIds: [],
      practitioners: [],
      addonExpenses: [],
      settlements: [],
      status: 'active',
      createdAt: new Date().toISOString()
    });
    setPractNameInput('');
    setPractSpecialtyInput('');
    setPractPhoneInput('');
    setPractEmailInput('');
    setIsModalOpen(true);
  };

  const openEditModal = (contract: PhysioThirdPartyContract) => {
    setEditingContract(contract);
    const { id, ...rest } = contract;
    setForm({
      ...rest,
      email: contract.contactEmail || contract.email || '',
      contactEmail: contract.contactEmail || contract.email || '',
      enableFacilityClientSplitOnFixedRent: Boolean(contract.enableFacilityClientSplitOnFixedRent),
      facilityClientSplitPercent: contract.facilityClientSplitPercent ?? contract.facilityClientSplitFacilityPct ?? 60,
      practitioners: contract.practitioners || []
    });
    setPractNameInput('');
    setPractSpecialtyInput('');
    setPractPhoneInput('');
    setPractEmailInput('');
    setIsModalOpen(true);
  };

  const handleAddPractitionerToForm = () => {
    if (!practNameInput.trim()) {
      toast.error('Please enter practitioner name.');
      return;
    }
    const newPract: ThirdPartyPractitioner = {
      id: `PRACT-${Date.now()}`,
      name: practNameInput.trim(),
      specialty: practSpecialtyInput.trim() || undefined,
      phone: practPhoneInput.trim() || undefined,
      email: practEmailInput.trim() || undefined
    };
    setForm(prev => ({
      ...prev,
      practitioners: [...(prev.practitioners || []), newPract]
    }));
    setPractNameInput('');
    setPractSpecialtyInput('');
    setPractPhoneInput('');
    setPractEmailInput('');
  };

  const calculateContractSettlement = (contract: PhysioThirdPartyContract) => {
    const practitionerIds = new Set((contract.practitioners || []).map(p => p.id));
    const practitionerNames = new Set(
      (contract.practitioners || []).map(p => p.name.trim().toLowerCase()).filter(Boolean)
    );

    const cycleBookings = bookings.filter(b => {
      if (b.status !== 'checked_in' && b.status !== 'completed') return false;
      const therapistObj = therapists.find(t => t.id === b.therapistId);
      const therapistFullName = therapistObj
        ? `${therapistObj.firstName} ${therapistObj.lastName}`.trim().toLowerCase()
        : ((b as any).therapistName || '').trim().toLowerCase();

      const matchesContract =
        b.thirdPartyContractId === contract.id ||
        (contract.linkedTherapistIds || []).includes(b.therapistId) ||
        practitionerIds.has(b.therapistId) ||
        (therapistFullName && practitionerNames.has(therapistFullName));
      if (!matchesContract) return false;
      if (contract.billingCycleStart && b.date < contract.billingCycleStart) return false;
      if (contract.billingCycleEnd && b.date > contract.billingCycleEnd) return false;
      return true;
    });

    // Compute per-practitioner session breakdown
    const breakdownMap = new Map<
      string,
      { id: string; name: string; role: string; loggedSessions: number; manualSessions: number; totalSessions: number }
    >();

    therapists
      .filter(t => (contract.linkedTherapistIds || []).includes(t.id))
      .forEach(t => {
        const fullName = `Dr. ${t.firstName} ${t.lastName}`.trim();
        breakdownMap.set(t.id, {
          id: t.id,
          name: fullName,
          role: t.specialization || 'Linked Physiotherapist',
          loggedSessions: 0,
          manualSessions: 0,
          totalSessions: 0
        });
      });

    (contract.practitioners || []).forEach(p => {
      const existingByName = Array.from(breakdownMap.values()).find(
        b => b.name.replace(/^Dr\.\s*/i, '').trim().toLowerCase() === p.name.replace(/^Dr\.\s*/i, '').trim().toLowerCase()
      );
      if (existingByName) {
        existingByName.manualSessions += Number(p.completedSessions || 0);
      } else {
        breakdownMap.set(p.id, {
          id: p.id,
          name: p.name,
          role: p.specialty || p.roleOrSpecialty || 'Partner Practitioner',
          loggedSessions: 0,
          manualSessions: Number(p.completedSessions || 0),
          totalSessions: Number(p.completedSessions || 0)
        });
      }
    });

    cycleBookings.forEach(b => {
      const therapistObj = therapists.find(t => t.id === b.therapistId);
      const tName = therapistObj
        ? `Dr. ${therapistObj.firstName} ${therapistObj.lastName}`.trim()
        : ((b as any).therapistName || contract.partnerName).trim();
      let entry = breakdownMap.get(b.therapistId);
      if (!entry) {
        entry = Array.from(breakdownMap.values()).find(
          item =>
            item.name.replace(/^Dr\.\s*/i, '').trim().toLowerCase() ===
            tName.replace(/^Dr\.\s*/i, '').trim().toLowerCase()
        );
      }
      if (entry) {
        entry.loggedSessions += 1;
      } else {
        const key = b.therapistId || tName || 'partner';
        breakdownMap.set(key, {
          id: key,
          name: tName,
          role: 'Partner Physiotherapist',
          loggedSessions: 1,
          manualSessions: 0,
          totalSessions: 1
        });
      }
    });

    const practitionerBreakdown = Array.from(breakdownMap.values()).map(item => ({
      ...item,
      totalSessions: Math.max(item.loggedSessions, item.manualSessions)
    }));
    const pooledPractitionerSessions = practitionerBreakdown.reduce((sum, p) => sum + p.totalSessions, 0);

    const partnerBookings = cycleBookings.filter(b => b.leadSource === 'partner_client');
    const facilityBookings = cycleBookings.filter(b => b.leadSource !== 'partner_client');

    const partnerGross = partnerBookings.reduce(
      (s, b) => s + (Number(b.cost) || contract.defaultSessionPrice || 0),
      0
    );
    const facilityGross = facilityBookings.reduce(
      (s, b) => s + (Number(b.cost) || contract.defaultSessionPrice || 0),
      0
    );
    const grossSessionRevenue = partnerGross + facilityGross;

    let facilitySessionShare = 0;
    let partnerSessionShare = 0;
    let fixedRentCharge = 0;
    let overageSessionsCount = 0;
    let overageFeeCharge = 0;
    let facilityReferredSplitDue = 0;

    const totalSessionsCount = Math.max(
      cycleBookings.length,
      pooledPractitionerSessions,
      Number(contract.usedSessionsCurrentCycle) || 0
    );
    const allowed = Number(contract.allowedSessionsQuota) || 0;
    const remainingQuotaSessions = allowed > 0 ? Math.max(0, allowed - totalSessionsCount) : 0;

    if (contract.modelType === 'revenue_split') {
      const pFacPct = Number(contract.partnerClientSplitFacilityPct ?? 35) / 100;
      const fFacPct = Number(contract.facilityClientSplitFacilityPct ?? 60) / 100;
      facilitySessionShare = partnerGross * pFacPct + facilityGross * fFacPct;
      partnerSessionShare = grossSessionRevenue - facilitySessionShare;
      if (allowed > 0 && totalSessionsCount > allowed) {
        overageSessionsCount = Math.max(0, totalSessionsCount - allowed);
        overageFeeCharge = overageSessionsCount * (Number(contract.overageFeePerSession) || 0);
      }
    } else {
      // Model B: Fixed Rent + Session Quota (+ Optional Hybrid Facility-Referred Lead Split)
      // Partner's own patients remain at 0% commission (covered by fixedMonthlyRent)
      fixedRentCharge = Number(contract.fixedMonthlyRent) || 0;
      overageSessionsCount = Math.max(0, totalSessionsCount - allowed);
      overageFeeCharge = overageSessionsCount * (Number(contract.overageFeePerSession) || 0);

      if (contract.enableFacilityClientSplitOnFixedRent) {
        const splitPct = Number(contract.facilityClientSplitPercent ?? contract.facilityClientSplitFacilityPct ?? 0);
        facilityReferredSplitDue = Number(((facilityGross * splitPct) / 100).toFixed(2));
        facilitySessionShare = facilityReferredSplitDue;
      }
      partnerSessionShare = Math.max(0, grossSessionRevenue - facilityReferredSplitDue);
    }

    const addonExpensesTotal = (contract.addonExpenses || []).reduce(
      (s, e) => s + (Number(e.calculatedAmount) || 0),
      0
    );

    const netDueToFacility =
      contract.modelType === 'revenue_split'
        ? facilitySessionShare + overageFeeCharge + addonExpensesTotal
        : fixedRentCharge + overageFeeCharge + facilityReferredSplitDue + addonExpensesTotal;

    return {
      sessionsCount: totalSessionsCount,
      remainingQuotaSessions,
      practitionerBreakdown,
      partnerBookingsCount: partnerBookings.length,
      facilityBookingsCount: facilityBookings.length,
      grossSessionRevenue,
      facilityGrossRevenue: facilityGross,
      facilitySessionShare,
      partnerSessionShare,
      fixedRentCharge,
      overageSessionsCount,
      overageFeeCharge,
      facilityReferredSplitDue,
      addonExpensesTotal,
      netDueToFacility
    };
  };

  const handleLogPartnerSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLogSessionContract) return;
    const c = activeLogSessionContract;
    const matchedTherapist = therapists.find(t => t.id === logPractitionerId);
    const matchedPract = (c.practitioners || []).find(p => p.id === logPractitionerId);
    const displayPractName = matchedTherapist
      ? `Dr. ${matchedTherapist.firstName} ${matchedTherapist.lastName}`
      : matchedPract?.name || c.partnerName;

    const updatedPractitioners = (c.practitioners || []).map(p => {
      const isMatch =
        p.id === logPractitionerId ||
        (matchedTherapist &&
          p.name.replace(/^Dr\.\s*/i, '').trim().toLowerCase() ===
            `${matchedTherapist.firstName} ${matchedTherapist.lastName}`.trim().toLowerCase());
      return isMatch ? { ...p, completedSessions: (p.completedSessions || 0) + 1 } : p;
    });

    const nextUsed = (Number(c.usedSessionsCurrentCycle) || 0) + 1;
    const { id, ...rest } = c;
    await onSaveContract(
      {
        ...rest,
        usedSessionsCurrentCycle: nextUsed,
        practitioners: updatedPractitioners
      },
      id
    );

    const allowed = Number(c.allowedSessionsQuota) || 0;
    if (allowed > 0 && nextUsed > allowed) {
      toast.warning(
        `Session logged for ${displayPractName}! Clinic "${c.partnerName}" is now in OVERAGE (${nextUsed}/${allowed} sessions used, +${formatCurrency(c.overageFeePerSession || 0)}/extra session).`
      );
    } else {
      toast.success(
        `Session logged for ${displayPractName} under "${c.partnerName}" (${nextUsed}${allowed > 0 ? `/${allowed}` : ''} cycle sessions used)!`
      );
    }

    setActiveLogSessionContract(null);
    setLogPatientName('');
  };

  const computeContractMetrics = calculateContractSettlement;

  const handleAddExpenseToForm = () => {
    if (!expenseName.trim()) {
      toast.error('Enter an expense description (e.g., Electricity, Medical Consumables)');
      return;
    }
    const calc =
      expenseType === 'fixed'
        ? Number(expenseFixedVal) || 0
        : ((Number(expenseBillTotal) || 0) * (Number(expensePctVal) || 0)) / 100;

    const item: ThirdPartyAddonExpense = {
      id: `EXP-${Date.now()}`,
      name: expenseName.trim(),
      type: expenseType,
      fixedAmount: expenseType === 'fixed' ? Number(expenseFixedVal) || 0 : undefined,
      billTotalAmount: expenseType === 'percentage_of_bill' ? Number(expenseBillTotal) || 0 : undefined,
      percentage: expenseType === 'percentage_of_bill' ? Number(expensePctVal) || 0 : undefined,
      calculatedAmount: Number(calc.toFixed(2)),
      date: new Date().toISOString().slice(0, 10)
    };

    setForm(prev => ({
      ...prev,
      addonExpenses: [...(prev.addonExpenses || []), item]
    }));
    setExpenseName('');
  };

  const handleAddInstantExpenseInSettle = async () => {
    if (!settleModalContract || !expenseName.trim()) return;
    const calc =
      expenseType === 'fixed'
        ? Number(expenseFixedVal) || 0
        : ((Number(expenseBillTotal) || 0) * (Number(expensePctVal) || 0)) / 100;

    const item: ThirdPartyAddonExpense = {
      id: `EXP-${Date.now()}`,
      name: expenseName.trim(),
      type: expenseType,
      fixedAmount: expenseType === 'fixed' ? Number(expenseFixedVal) || 0 : undefined,
      billTotalAmount: expenseType === 'percentage_of_bill' ? Number(expenseBillTotal) || 0 : undefined,
      percentage: expenseType === 'percentage_of_bill' ? Number(expensePctVal) || 0 : undefined,
      calculatedAmount: Number(calc.toFixed(2)),
      date: new Date().toISOString().slice(0, 10)
    };

    const updated: PhysioThirdPartyContract = {
      ...settleModalContract,
      addonExpenses: [...(settleModalContract.addonExpenses || []), item]
    };
    const { id, ...rest } = updated;
    await onSaveContract(rest, id);
    setSettleModalContract(updated);
    setExpenseName('');
    toast.success('Add-on utility/operational expense attached to cycle');
  };

  const generateSettlementPDF = (
    contract: PhysioThirdPartyContract,
    settlement: ThirdPartySettlementRecord
  ) => {
    const pdf = new jsPDF();
    pdf.setFillColor(5, 7, 10);
    pdf.rect(0, 0, 210, 38, 'F');
    pdf.setTextColor(0, 184, 200);
    pdf.setFontSize(15);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${systemName.toUpperCase()} — PHYSIOTHERAPY B2B SETTLEMENT STATEMENT`, 14, 16);
    pdf.setTextColor(230, 235, 245);
    pdf.setFontSize(10);
    pdf.text(
      `Partner Clinic: ${contract.partnerName} (${contract.contactPerson})  |  Period: ${settlement.periodStart} to ${settlement.periodEnd}`,
      14,
      26
    );
    pdf.text(
      `Contract Mode: ${contract.modelType === 'revenue_split' ? 'Dual Revenue Split' : 'Fixed Rent + Session Quota'}  |  Date: ${new Date(settlement.date).toLocaleDateString()}`,
      14,
      33
    );

    autoTable(pdf, {
      startY: 45,
      head: [['Line Item', 'Details', 'Amount (USD)']],
      body: [
        ['Sessions Conducted in Cycle', `${settlement.sessionsCount} sessions`, '-'],
        ...(contract.modelType === 'revenue_split'
          ? [
              ['Gross Session Revenue', 'Partner + Facility Sourced Patients', formatCurrency(settlement.grossSessionRevenue)],
              ['Facility Revenue Share', 'Due to Facility', formatCurrency(settlement.facilitySessionShare)],
              ['Partner Revenue Share', 'Retained by Partner', formatCurrency(settlement.partnerSessionShare)]
            ]
          : [
              ['Fixed Periodic Rent', `Quota: ${contract.allowedSessionsQuota || 0} sessions`, formatCurrency(settlement.fixedRentCharge)],
              ['Overage Sessions Charge', `${settlement.overageSessionsCount} extra sessions`, formatCurrency(settlement.overageFeeCharge)],
              ...(contract.enableFacilityClientSplitOnFixedRent || (settlement.facilityReferredSplitDue || 0) > 0
                ? [
                    [
                      'Facility-Referred Lead Split ($)',
                      `${contract.facilityClientSplitPercent ?? 60}% Facility Share on Facility-Referred Patients`,
                      formatCurrency(settlement.facilityReferredSplitDue || 0)
                    ]
                  ]
                : [])
            ]),
        ['Add-On Utility & Operational Expenses', `${(contract.addonExpenses || []).length} item(s)`, formatCurrency(settlement.addonExpensesTotal)],
        ['NET DUE TO FACILITY', '', formatCurrency(settlement.netDueToFacility)],
        ['AMOUNT SETTLED & POSTED', `Method: ${settlement.paymentMethod.toUpperCase()}`, formatCurrency(settlement.amountSettled)]
      ],
      headStyles: { fillColor: [0, 184, 200], textColor: [5, 7, 10] }
    });

    if (contract.addonExpenses && contract.addonExpenses.length > 0) {
      autoTable(pdf, {
        startY: (pdf as any).lastAutoTable.finalY + 8,
        head: [['Add-On Utility / Expense', 'Calculation Basis', 'Charge']],
        body: contract.addonExpenses.map(e => [
          e.name,
          e.type === 'fixed'
            ? 'Fixed Charge'
            : `${e.percentage}% of ${formatCurrency(e.billTotalAmount || 0)} Bill`,
          formatCurrency(e.calculatedAmount)
        ]),
        headStyles: { fillColor: [16, 22, 34], textColor: [0, 184, 200] }
      });
    }

    pdf.save(`Physio_B2B_Settlement_${contract.partnerName.replace(/\s+/g, '_')}_${settlement.date.slice(0, 10)}.pdf`);
  };

  const handleExecuteSettlement = async () => {
    if (!settleModalContract) return;
    const metrics = computeContractMetrics(settleModalContract);
    const finalAmount =
      settleOverrideAmount !== '' ? parseFloat(settleOverrideAmount) : metrics.netDueToFacility;

    if (isNaN(finalAmount) || finalAmount < 0) {
      toast.error('Please enter a valid settlement amount');
      return;
    }

    const settlementRecord: ThirdPartySettlementRecord = {
      id: `SET-${Date.now()}`,
      date: new Date().toISOString(),
      periodStart: settleModalContract.billingCycleStart || new Date().toISOString().slice(0, 10),
      periodEnd: settleModalContract.billingCycleEnd || new Date().toISOString().slice(0, 10),
      sessionsCount: metrics.sessionsCount,
      grossSessionRevenue: metrics.grossSessionRevenue,
      facilitySessionShare: metrics.facilitySessionShare,
      partnerSessionShare: metrics.partnerSessionShare,
      fixedRentCharge: metrics.fixedRentCharge,
      overageSessionsCount: metrics.overageSessionsCount,
      overageFeeCharge: metrics.overageFeeCharge,
      facilityReferredSplitDue: metrics.facilityReferredSplitDue,
      addonExpensesTotal: metrics.addonExpensesTotal,
      netDueToFacility: metrics.netDueToFacility,
      amountSettled: finalAmount,
      paymentMethod: settlePaymentMethod,
      notes: settleNotes.trim() || `Physio B2B Settlement — ${settleModalContract.partnerName}`
    };

    try {
      const normalizedPm = settlePaymentMethod === 'transfer' ? 'card' : settlePaymentMethod;
      const debitAcc = settlePaymentMethod === 'cash'
        ? '531 - Cash Drawer / Register (Caisse)'
        : settlePaymentMethod === 'card'
        ? '512 - Bank / Card Terminal'
        : '512 - Bank Accounts (Fresh USD / LBP)';
      const addonPortion = Math.max(0, Math.min(metrics.addonExpensesTotal || 0, finalAmount));
      const facilityRevPortion = Math.max(0, Number((finalAmount - addonPortion).toFixed(2)));

      if (facilityRevPortion > 0) {
        await processLedgerTransaction({
          amount: facilityRevPortion,
          paymentMethod: normalizedPm,
          sourceModule: 'physio',
          cashierId: userUid,
          transactionType: 'physio_b2b_contract_settlement',
          direction: 'inflow',
          sourceAccount: debitAcc,
          destinationAccount: '7063 - Physiotherapy Clinical Revenue',
          referenceId: settleModalContract.id,
          notes: `Physio 3rd-Party B2B Facility Share (${settleModalContract.partnerName}) — Mode: ${settleModalContract.modelType}, Sessions: ${metrics.sessionsCount}`
        });
      }

      if (addonPortion > 0) {
        await processLedgerTransaction({
          amount: Number(addonPortion.toFixed(2)),
          paymentMethod: normalizedPm,
          sourceModule: 'physio',
          cashierId: userUid,
          transactionType: 'physio_b2b_utility_recovery',
          direction: 'inflow',
          sourceAccount: debitAcc,
          destinationAccount: '708 - Ancillary Facility & Utility Recovery',
          referenceId: settleModalContract.id,
          notes: `Physio 3rd-Party B2B Utility & Expense Recovery (${settleModalContract.partnerName}) — ${(settleModalContract.addonExpenses || []).map(e => e.name).join(', ') || 'Utility Share'}`
        });
      }

      const { id, ...rest } = settleModalContract;
      await onSaveContract(
        {
          ...rest,
          usedSessionsCurrentCycle: 0,
          addonExpenses: [],
          settlements: [settlementRecord, ...(settleModalContract.settlements || [])]
        },
        id
      );

      generateSettlementPDF(settleModalContract, settlementRecord);
      toast.success('B2B Physio Settlement posted to Dual-Mode Accounting & PDF downloaded');
      setSettleModalContract(null);
      setSettleOverrideAmount('');
      setSettleNotes('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to settle 3rd-party physiotherapy contract');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="text-[#00B8C8]" size={22} />
            3rd-Party Physiotherapy & Clinic Partner Contracts
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Dual Revenue Split (Partner vs Facility Patients) or Fixed Rent + Session Quota with Utility Add-On Expenses
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-4 py-2.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] font-bold text-xs flex items-center gap-2 shadow-sm shadow-cyan-500/20"
        >
          <Plus size={16} /> New 3rd-Party Clinic Contract
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {contracts.map(contract => {
          const metrics = computeContractMetrics(contract);
          const linkedDocs = therapists.filter(t => (contract.linkedTherapistIds || []).includes(t.id));
          const customPractitioners = contract.practitioners || [];

          return (
            <div
              key={contract.id}
              className={`p-6 rounded-2xl border space-y-5 ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-black">{contract.partnerName}</h3>
                    <span className="text-xs font-bold text-[#00B8C8]">
                      ·{' '}
                      {contract.modelType === 'revenue_split'
                        ? 'Dual Revenue Split'
                        : contract.enableFacilityClientSplitOnFixedRent
                          ? 'Hybrid Fixed Rent + Lead Split'
                          : 'Fixed Rent + Session Cap'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Contact: {contract.contactPerson} · {contract.phone}
                    {(contract.contactEmail || contract.email) && ` · ${contract.contactEmail || contract.email}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => openEditModal(contract)}
                    className="p-2 rounded-lg text-zinc-400 hover:text-[#00B8C8]"
                    title="Edit Contract Terms (Future Cycles)"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => onDeleteContract(contract.id)}
                    className="p-2 rounded-lg text-zinc-400 hover:text-rose-500"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {contract.modelType === 'revenue_split' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="text-[10px] font-bold uppercase text-zinc-400">Partner-Sourced Patient Split</div>
                    <div className="text-sm font-black font-mono text-[#00B8C8] mt-1">
                      {contract.partnerClientSplitPartnerPct}% Partner / {contract.partnerClientSplitFacilityPct}% Facility
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      {metrics.partnerBookingsCount} sessions in cycle
                    </div>
                  </div>
                  <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="text-[10px] font-bold uppercase text-zinc-400">Facility-Sourced Patient Split</div>
                    <div className="text-sm font-black font-mono text-emerald-400 mt-1">
                      {contract.facilityClientSplitFacilityPct}% Facility / {contract.facilityClientSplitPartnerPct}% Partner
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      {metrics.facilityBookingsCount} sessions in cycle
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`p-3.5 rounded-xl border space-y-2 ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex justify-between text-xs font-bold">
                    <span>Fixed Monthly Rent: {formatCurrency(contract.fixedMonthlyRent || 0)}</span>
                    <span className="font-mono text-[#00B8C8]">
                      Quota: {metrics.sessionsCount} / {contract.allowedSessionsQuota || 0} Sessions
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-[#00B8C8]"
                      style={{
                        width: `${Math.min(
                          100,
                          (metrics.sessionsCount / Math.max(1, contract.allowedSessionsQuota || 1)) * 100
                        )}%`
                      }}
                    />
                  </div>
                  {metrics.overageSessionsCount > 0 && (
                    <div className="text-[11px] text-amber-400 font-bold">
                      +{metrics.overageSessionsCount} Overage Sessions ({formatCurrency(metrics.overageFeeCharge)})
                    </div>
                  )}
                  {contract.enableFacilityClientSplitOnFixedRent && (
                    <div className="pt-1.5 border-t border-zinc-800/80 flex items-center justify-between text-[11px]">
                      <span className="text-zinc-300">
                        <strong className="text-[#00B8C8]">Facility-Referred Lead Split:</strong>{' '}
                        {contract.facilityClientSplitPercent ?? 60}% Facility ({metrics.facilityBookingsCount} facility sessions)
                      </span>
                      <span className="font-mono font-bold text-[#00B8C8]">
                        +{formatCurrency(metrics.facilityReferredSplitDue)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Shared Business Session Pool & Per-Practitioner Breakdown */}
              <div className={`p-3.5 rounded-xl border space-y-2.5 ${isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                    Multi-Practitioner Shared Pool ({linkedDocs.length + customPractitioners.length})
                  </span>
                  <div className="flex items-center gap-2">
                    {(contract.allowedSessionsQuota || 0) > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold font-mono ${
                          metrics.overageSessionsCount > 0
                            ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {metrics.overageSessionsCount > 0
                          ? `OVERAGE: +${metrics.overageSessionsCount} Sess (+${formatCurrency(metrics.overageFeeCharge)})`
                          : `${metrics.remainingQuotaSessions} / ${contract.allowedSessionsQuota} Remaining`}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-md bg-[#00B8C8]/15 border border-[#00B8C8]/30 text-[10px] font-bold font-mono text-[#00B8C8]">
                      Total Used: {metrics.sessionsCount} Sess
                    </span>
                  </div>
                </div>

                {metrics.practitionerBreakdown.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">
                    No physiotherapists linked yet. Edit contract to assign practitioners.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {metrics.practitionerBreakdown.map(pb => (
                      <div
                        key={pb.id}
                        className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2 ${
                          isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="truncate">
                          <span className="text-xs font-bold">{pb.name}</span>
                          <span className="text-[10px] text-zinc-400 ml-1">({pb.role})</span>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-[#00B8C8]/10 text-[#00B8C8] text-[10px] font-bold font-mono shrink-0">
                          {pb.totalSessions} sess
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-1.5 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-400">
                  <span>Utility & Operational Add-Ons:</span>
                  <strong className="text-amber-400 font-mono">{formatCurrency(metrics.addonExpensesTotal)}</strong>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-zinc-800 gap-2 flex-wrap">
                <div>
                  <span className="text-[10px] font-bold uppercase text-zinc-400 block">
                    Net Due to Facility (Current Cycle)
                  </span>
                  <span className="text-xl font-black font-mono text-[#00B8C8]">
                    {formatCurrency(metrics.netDueToFacility)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      setActiveLogSessionContract(contract);
                      const firstPract = linkedDocs[0]?.id || customPractitioners[0]?.id || '';
                      setLogPractitionerId(firstPract);
                      setLogSessionFee(contract.defaultSessionPrice || 50);
                      setLogLeadSource('partner_client');
                      setLogPatientName('');
                    }}
                    className="px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 font-bold text-xs flex items-center gap-1.5"
                  >
                    <CheckCircle2 size={14} /> + Log Session
                  </button>
                  <button
                    onClick={() => {
                      setSettleModalContract(contract);
                      setSettleOverrideAmount(metrics.netDueToFacility.toFixed(2));
                    }}
                    className="px-4 py-2 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] font-bold text-xs flex items-center gap-1.5"
                  >
                    <DollarSign size={14} /> Settle Cycle & PDF
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {contracts.length === 0 && (
          <div
            className={`col-span-2 p-10 rounded-2xl border text-center space-y-3 ${
              isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            <Building2 className="mx-auto text-[#00B8C8]" size={32} />
            <h3 className="text-base font-bold">No 3rd-Party Physiotherapy Partner Contracts Yet</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              Create a B2B Physiotherapy Partner contract with Dual Revenue Split or Fixed Monthly Rent + Allowed Session Quota and Utility Add-On Expenses.
            </p>
          </div>
        )}
      </div>

      {/* Create / Edit Contract Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-2xl rounded-2xl border p-6 max-h-[88vh] overflow-y-auto space-y-4 ${
              isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <h3 className="text-lg font-black">
              {editingContract ? 'Edit 3rd-Party Physiotherapy Contract' : 'New 3rd-Party Physiotherapy Contract'}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Partner / Clinic Name</label>
                <input
                  type="text"
                  required
                  value={form.partnerName}
                  onChange={e => setForm({ ...form, partnerName: e.target.value })}
                  placeholder="e.g. PhysioPro Clinic"
                  className={`w-full p-2.5 rounded-lg border text-xs ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                  }`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Contact Person</label>
                <input
                  type="text"
                  value={form.contactPerson}
                  onChange={e => setForm({ ...form, contactPerson: e.target.value })}
                  className={`w-full p-2.5 rounded-lg border text-xs ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                  }`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Phone</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  className={`w-full p-2.5 rounded-lg border text-xs ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                  }`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Contact Email</label>
                <input
                  type="email"
                  value={form.contactEmail || form.email || ''}
                  onChange={e => setForm({ ...form, email: e.target.value, contactEmail: e.target.value })}
                  placeholder="clinic@partner.com"
                  className={`w-full p-2.5 rounded-lg border text-xs ${
                    isDarkMode
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                      : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
              </div>
            </div>

            <div className="flex p-1 rounded-xl border bg-zinc-900 border-zinc-800">
              <button
                type="button"
                onClick={() => setForm({ ...form, modelType: 'revenue_split' })}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                  form.modelType === 'revenue_split' ? 'bg-[#00B8C8] text-[#05070A]' : 'text-zinc-400'
                }`}
              >
                Mode A: Dual Revenue Split (%)
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, modelType: 'fixed_rent' })}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                  form.modelType === 'fixed_rent' ? 'bg-[#00B8C8] text-[#05070A]' : 'text-zinc-400'
                }`}
              >
                Mode B: Fixed Rent + Session Quota
              </button>
            </div>

            {form.modelType === 'revenue_split' ? (
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl border ${
                isDarkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div>
                  <div className="text-xs font-bold text-[#00B8C8] mb-2">
                    Partner-Sourced Patients (Partner Brings Client)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-400 uppercase mb-1">Partner %</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={form.partnerClientSplitPartnerPct ?? 65}
                        onChange={e => {
                          const p = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                          setForm({
                            ...form,
                            partnerClientSplitPartnerPct: p,
                            partnerClientSplitFacilityPct: 100 - p
                          });
                        }}
                        className={`w-full p-2 rounded border text-xs font-mono ${
                          isDarkMode
                            ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                            : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 uppercase mb-1">Facility %</label>
                      <input
                        type="number"
                        readOnly
                        value={form.partnerClientSplitFacilityPct ?? 35}
                        className={`w-full p-2 rounded border text-xs font-mono ${
                          isDarkMode
                            ? 'bg-zinc-950 border-zinc-800 text-zinc-400 [color-scheme:dark]'
                            : 'bg-slate-100 border-slate-200 text-slate-600 [color-scheme:light]'
                        }`}
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-emerald-400 mb-2">
                    Facility-Sourced Patients (We Refer Client)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-400 uppercase mb-1">Facility %</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={form.facilityClientSplitFacilityPct ?? 60}
                        onChange={e => {
                          const f = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                          setForm({
                            ...form,
                            facilityClientSplitFacilityPct: f,
                            facilityClientSplitPartnerPct: 100 - f
                          });
                        }}
                        className={`w-full p-2 rounded border text-xs font-mono ${
                          isDarkMode
                            ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                            : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 uppercase mb-1">Partner %</label>
                      <input
                        type="number"
                        readOnly
                        value={form.facilityClientSplitPartnerPct ?? 40}
                        className={`w-full p-2 rounded border text-xs font-mono ${
                          isDarkMode
                            ? 'bg-zinc-950 border-zinc-800 text-zinc-400 [color-scheme:dark]'
                            : 'bg-slate-100 border-slate-200 text-slate-600 [color-scheme:light]'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`p-4 rounded-xl border space-y-4 ${
                isDarkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Fixed Monthly Rent ($)</label>
                    <input
                      type="number"
                      min="0"
                      value={form.fixedMonthlyRent ?? 500}
                      onChange={e => setForm({ ...form, fixedMonthlyRent: parseFloat(e.target.value) || 0 })}
                      className={`w-full p-2 rounded border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Allowed Session Cap</label>
                    <input
                      type="number"
                      min="1"
                      value={form.allowedSessionsQuota ?? 40}
                      onChange={e => setForm({ ...form, allowedSessionsQuota: parseInt(e.target.value) || 0 })}
                      className={`w-full p-2 rounded border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Overage Fee / Session ($)</label>
                    <input
                      type="number"
                      min="0"
                      value={form.overageFeePerSession ?? 15}
                      onChange={e => setForm({ ...form, overageFeePerSession: parseFloat(e.target.value) || 0 })}
                      className={`w-full p-2 rounded border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                </div>

                {/* Hybrid Model B Option: Facility-Referred Lead Split */}
                <div className="pt-3 border-t border-zinc-800 space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-xs font-bold block">
                        Enable Hybrid Facility-Referred Lead Split (%) on Fixed Rent
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        Partner&apos;s own patients remain at 0% commission (covered by Fixed Rent), while Facility-referred patients apply a % revenue split.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(form.enableFacilityClientSplitOnFixedRent)}
                      onChange={e =>
                        setForm({
                          ...form,
                          enableFacilityClientSplitOnFixedRent: e.target.checked
                        })
                      }
                      className="w-4 h-4 accent-[#00B8C8]"
                    />
                  </label>

                  {form.enableFacilityClientSplitOnFixedRent && (
                    <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg border border-[#00B8C8]/30 ${
                      isDarkMode ? 'bg-[#05070A]' : 'bg-white'
                    }`}>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-[#00B8C8] mb-1">
                          Facility-Referred Patient: Facility Share (%)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={form.facilityClientSplitPercent ?? 60}
                          onChange={e =>
                            setForm({
                              ...form,
                              facilityClientSplitPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0))
                            })
                          }
                          className={`w-full p-2 rounded border text-xs font-mono ${
                            isDarkMode
                              ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                              : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                          }`}
                        />
                        <span className="text-[10px] text-zinc-400 mt-1 block">
                          Partner Retain: {Math.max(0, 100 - (form.facilityClientSplitPercent ?? 60))}% • Partner Own Patients: 0% Facility Fee
                        </span>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                          Default Session Gross Price ($)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={form.defaultSessionPrice ?? 50}
                          onChange={e => setForm({ ...form, defaultSessionPrice: parseFloat(e.target.value) || 0 })}
                          className={`w-full p-2 rounded border text-xs font-mono ${
                            isDarkMode
                              ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                              : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                          }`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Linked Physiotherapists */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1.5">
                Linked Partner Physiotherapists
              </label>
              <div className="flex flex-wrap gap-2">
                {therapists.map(t => {
                  const selected = (form.linkedTherapistIds || []).includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        const next = selected
                          ? form.linkedTherapistIds.filter(id => id !== t.id)
                          : [...(form.linkedTherapistIds || []), t.id];
                        setForm({ ...form, linkedTherapistIds: next });
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                        selected
                          ? 'bg-[#00B8C8]/20 border-[#00B8C8] text-[#00B8C8]'
                          : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                      }`}
                    >
                      Dr. {t.firstName} {t.lastName}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Multi-Practitioner Roster Builder */}
            <div className={`p-3.5 rounded-xl border space-y-2.5 ${
              isDarkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#00B8C8]">
                  Contract Practitioners Roster ({(form.practitioners || []).length})
                </span>
                <span className="text-[10px] text-zinc-400">
                  Any check-in with these practitioners deducts from this contract&apos;s session quota
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input
                  type="text"
                  placeholder="Practitioner Name *"
                  value={practNameInput}
                  onChange={e => setPractNameInput(e.target.value)}
                  className={`p-2 rounded border text-xs ${
                    isDarkMode
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                      : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
                <input
                  type="text"
                  placeholder="Specialty"
                  value={practSpecialtyInput}
                  onChange={e => setPractSpecialtyInput(e.target.value)}
                  className={`p-2 rounded border text-xs ${
                    isDarkMode
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                      : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
                <input
                  type="text"
                  placeholder="Phone"
                  value={practPhoneInput}
                  onChange={e => setPractPhoneInput(e.target.value)}
                  className={`p-2 rounded border text-xs ${
                    isDarkMode
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                      : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleAddPractitionerToForm}
                  className="px-3 py-2 rounded bg-[#00B8C8] text-[#05070A] font-bold text-xs"
                >
                  + Add Practitioner
                </button>
              </div>
              {(form.practitioners || []).length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {(form.practitioners || []).map(p => (
                    <span
                      key={p.id}
                      className="px-2.5 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-xs flex items-center gap-2 text-zinc-100"
                    >
                      <UserCheck size={12} className="text-[#00B8C8]" />
                      <span>
                        <strong>{p.name}</strong>
                        {p.specialty ? ` • ${p.specialty}` : ''}
                        {p.phone ? ` • ${p.phone}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setForm(prev => ({
                            ...prev,
                            practitioners: (prev.practitioners || []).filter(item => item.id !== p.id)
                          }))
                        }
                        className="text-zinc-400 hover:text-rose-500"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Add-On Utility Expenses */}
            <div className={`p-4 rounded-xl border space-y-3 ${
              isDarkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="text-xs font-bold uppercase text-amber-400 flex items-center gap-1.5">
                <Zap size={14} /> Add-On Utility & Operational Expenses
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input
                  type="text"
                  placeholder="e.g. Electricity, Consumables"
                  value={expenseName}
                  onChange={e => setExpenseName(e.target.value)}
                  className={`p-2 rounded border text-xs ${
                    isDarkMode
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                      : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                />
                <select
                  value={expenseType}
                  onChange={e => setExpenseType(e.target.value as any)}
                  className={`p-2 rounded border text-xs ${
                    isDarkMode
                      ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                      : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="fixed">Fixed $ Amount</option>
                  <option value="percentage_of_bill">% of Utility Bill</option>
                </select>
                {expenseType === 'fixed' ? (
                  <input
                    type="number"
                    min="0"
                    placeholder="Amount ($)"
                    value={expenseFixedVal}
                    onChange={e => setExpenseFixedVal(parseFloat(e.target.value) || 0)}
                    className={`p-2 rounded border text-xs font-mono ${
                      isDarkMode
                        ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-1">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      placeholder="%"
                      value={expensePctVal}
                      onChange={e => setExpensePctVal(parseFloat(e.target.value) || 0)}
                      className={`p-2 rounded border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Bill $"
                      value={expenseBillTotal}
                      onChange={e => setExpenseBillTotal(parseFloat(e.target.value) || 0)}
                      className={`p-2 rounded border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                          : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                      }`}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleAddExpenseToForm}
                  className="px-3 py-2 rounded bg-[#00B8C8] text-[#05070A] font-bold text-xs"
                >
                  + Attach Expense
                </button>
              </div>
              {(form.addonExpenses || []).length > 0 && (
                <div className="space-y-1.5 pt-2">
                  {form.addonExpenses.map(exp => (
                    <div
                      key={exp.id}
                      className="flex items-center justify-between text-xs px-3 py-1.5 rounded bg-zinc-800/80 text-zinc-100"
                    >
                      <span>
                        {exp.name} (
                        {exp.type === 'fixed'
                          ? 'Fixed'
                          : `${exp.percentage}% of ${formatCurrency(exp.billTotalAmount || 0)}`}
                        )
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-amber-400">
                          {formatCurrency(exp.calculatedAmount)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              addonExpenses: form.addonExpenses.filter(e => e.id !== exp.id)
                            })
                          }
                          className="text-zinc-400 hover:text-rose-500"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={async () => {
                  if (!form.partnerName.trim()) {
                    toast.error('Partner / Clinic Name is required');
                    return;
                  }
                  setIsSubmitting(true);
                  try {
                    const finalPractitioners = [...(form.practitioners || [])];
                    if (practNameInput.trim()) {
                      finalPractitioners.push({
                        id: `PRACT-${Date.now()}`,
                        name: practNameInput.trim(),
                        specialty: practSpecialtyInput.trim() || undefined,
                        phone: practPhoneInput.trim() || undefined,
                        email: practEmailInput.trim() || undefined
                      });
                    }
                    const sanitizedPayload = stripUndefined({
                      ...form,
                      partnerName: form.partnerName.trim(),
                      contactPerson: (form.contactPerson || '').trim(),
                      phone: (form.phone || '').trim(),
                      email: (form.email || form.contactEmail || '').trim(),
                      contactEmail: (form.contactEmail || form.email || '').trim(),
                      practitioners: finalPractitioners.map(p => stripUndefined(p)),
                      addonExpenses: (form.addonExpenses || []).map(e => stripUndefined(e)),
                      settlements: (form.settlements || []).map(s => stripUndefined(s))
                    });
                    await onSaveContract(sanitizedPayload, editingContract?.id);
                    setIsModalOpen(false);
                    setEditingContract(null);
                    setPractNameInput('');
                    setPractSpecialtyInput('');
                    setPractPhoneInput('');
                    setPractEmailInput('');
                    toast.success('3rd-Party Physiotherapy Contract saved successfully');
                  } catch (error: any) {
                    console.error('Failed to save 3rd-party physiotherapy contract:', error);
                    toast.error(error?.message || 'Failed to save 3rd-Party Physiotherapy Contract');
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] disabled:opacity-50 text-[#05070A] font-bold text-xs transition-all"
              >
                {isSubmitting ? 'Saving Contract...' : editingContract ? 'Save Contract Changes' : 'Create Contract'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settle Payment Modal */}
      {settleModalContract && (() => {
        const metrics = computeContractMetrics(settleModalContract);
        return (
          <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div
              className={`w-full max-w-lg rounded-2xl border p-6 space-y-4 ${
                isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
              }`}
            >
              <h3 className="text-lg font-black">
                Settle B2B Contract — {settleModalContract.partnerName}
              </h3>

              <div className={`p-4 rounded-xl border space-y-2 text-xs ${
                isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Sessions Conducted in Cycle:</span>
                  <span className="font-mono font-bold">{metrics.sessionsCount}</span>
                </div>
                {settleModalContract.modelType === 'revenue_split' ? (
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Facility Revenue Share:</span>
                    <span className="font-mono font-bold text-[#00B8C8]">
                      {formatCurrency(metrics.facilitySessionShare)}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Fixed Monthly Rent:</span>
                      <span className="font-mono font-bold">{formatCurrency(metrics.fixedRentCharge)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Overage Charge ({metrics.overageSessionsCount} extra):</span>
                      <span className="font-mono font-bold">{formatCurrency(metrics.overageFeeCharge)}</span>
                    </div>
                    {settleModalContract.enableFacilityClientSplitOnFixedRent && (
                      <div className="flex justify-between">
                        <span className="text-zinc-400">
                          Facility-Referred Lead Split ({settleModalContract.facilityClientSplitPercent ?? 60}%):
                        </span>
                        <span className="font-mono font-bold text-[#00B8C8]">
                          +{formatCurrency(metrics.facilityReferredSplitDue)}
                        </span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-zinc-400">Add-On Utility & Operational Expenses:</span>
                  <span className="font-mono font-bold text-amber-400">
                    {formatCurrency(metrics.addonExpensesTotal)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-zinc-800 text-sm font-black">
                  <span>Total Net Due to Facility:</span>
                  <span className="font-mono text-[#00B8C8]">{formatCurrency(metrics.netDueToFacility)}</span>
                </div>
              </div>

              {/* Instant Add-On Expense in Settle Modal */}
              <div className={`p-3 rounded-xl border space-y-2 ${
                isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[10px] font-bold uppercase text-amber-400">
                  + Add Instant Utility / Bill Deduction Before Settlement
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Expense name"
                    value={expenseName}
                    onChange={e => setExpenseName(e.target.value)}
                    className={`p-2 rounded border text-xs ${
                      isDarkMode
                        ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Amount ($)"
                    value={expenseFixedVal}
                    onChange={e => {
                      setExpenseType('fixed');
                      setExpenseFixedVal(parseFloat(e.target.value) || 0);
                    }}
                    className={`p-2 rounded border text-xs font-mono ${
                      isDarkMode
                        ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleAddInstantExpenseInSettle}
                    className="px-3 py-2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold text-xs"
                  >
                    + Add to Bill
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                    Amount to Settle ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settleOverrideAmount}
                    onChange={e => setSettleOverrideAmount(e.target.value)}
                    className={`w-full p-2.5 rounded-lg border text-xs font-mono ${
                      isDarkMode
                        ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                        : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={settlePaymentMethod}
                    onChange={e => setSettlePaymentMethod(e.target.value as any)}
                    className={`w-full p-2.5 rounded-lg border text-xs font-bold ${
                      isDarkMode
                        ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100 [color-scheme:dark]'
                        : 'bg-slate-50 border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="transfer">Bank Transfer</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSettleModalContract(null)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteSettlement}
                  className="flex-1 py-2.5 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 size={15} /> Confirm Settlement & PDF
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* QUICK LOG B2B PARTNER SESSION MODAL */}
      {activeLogSessionContract && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 space-y-4 ${
              isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div>
              <h3 className="text-base font-black text-[#00B8C8]">
                Log Partner Session — {activeLogSessionContract.partnerName}
              </h3>
              <p className="text-xs text-zinc-400">
                Deducts 1 session from the shared B2B allowance & increments the practitioner&apos;s personal count
              </p>
            </div>

            <form onSubmit={handleLogPartnerSession} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                  Physiotherapist / Practitioner *
                </label>
                <select
                  value={logPractitionerId}
                  onChange={e => setLogPractitionerId(e.target.value)}
                  className={`w-full p-2.5 rounded-lg border text-xs ${
                    isDarkMode
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                      : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                  }`}
                >
                  <option value="">-- General Partner Pool ({activeLogSessionContract.partnerName}) --</option>
                  {therapists
                    .filter(t => (activeLogSessionContract.linkedTherapistIds || []).includes(t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        Dr. {t.firstName} {t.lastName} (Linked Therapist)
                      </option>
                    ))}
                  {(activeLogSessionContract.practitioners || []).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.specialty || 'Partner Practitioner'} • {p.completedSessions || 0} sess)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Patient Name</label>
                  <input
                    type="text"
                    value={logPatientName}
                    onChange={e => setLogPatientName(e.target.value)}
                    placeholder="e.g., Karim S."
                    className={`w-full p-2.5 rounded-lg border text-xs ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Session Date</label>
                  <input
                    type="date"
                    value={logSessionDate}
                    onChange={e => setLogSessionDate(e.target.value)}
                    className={`w-full p-2.5 rounded-lg border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Patient Lead Source</label>
                  <select
                    value={logLeadSource}
                    onChange={e => setLogLeadSource(e.target.value as 'partner_client' | 'facility_client')}
                    className={`w-full p-2.5 rounded-lg border text-xs ${
                      isDarkMode
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-100 [color-scheme:dark]'
                        : 'bg-white border-slate-200 text-slate-900 [color-scheme:light]'
                    }`}
                  >
                    <option value="partner_client">Partner&apos;s Own Patient</option>
                    <option value="facility_client">Facility-Referred Patient</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Session Fee ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={logSessionFee}
                    onChange={e => setLogSessionFee(parseFloat(e.target.value) || 0)}
                    className={`w-full p-2.5 rounded-lg border text-xs font-mono ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveLogSessionContract(null)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs"
                >
                  Confirm & Deduct Allowance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
