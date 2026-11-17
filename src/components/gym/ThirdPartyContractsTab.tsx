import React, { useState, useMemo } from 'react';
import {
  Building2, Plus, Edit3, Trash2, DollarSign, Users,
  CheckCircle2, Zap, X, UserCheck, Download
} from 'lucide-react';
import {
  ThirdPartyGymContract, ThirdPartyAddonExpense, ThirdPartySettlementRecord,
  ThirdPartyPractitioner, Coach, Member
} from '../../types';
import { processLedgerTransaction } from '../../lib/transaction-engine';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ThirdPartyContractsTabProps {
  contracts: ThirdPartyGymContract[];
  coaches: Coach[];
  members: Member[];
  systemName?: string;
  userUid?: string;
  onSaveContract: (contract: Omit<ThirdPartyGymContract, 'id'>, existingId?: string) => Promise<void>;
  onDeleteContract: (id: string) => Promise<void>;
  onUpdateCoach: (coachId: string, updates: Partial<Coach>) => Promise<void>;
}

export const ThirdPartyContractsTab: React.FC<ThirdPartyContractsTabProps> = ({
  contracts,
  coaches,
  members,
  systemName,
  userUid,
  onSaveContract,
  onDeleteContract,
  onUpdateCoach
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<ThirdPartyGymContract | null>(null);
  const [activeSettlementContract, setActiveSettlementContract] = useState<ThirdPartyGymContract | null>(null);
  const [activeAddonContract, setActiveAddonContract] = useState<ThirdPartyGymContract | null>(null);

  // Contract Form State
  const [partnerName, setPartnerName] = useState('One to One');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [modelType, setModelType] = useState<'revenue_split' | 'fixed_rent'>('revenue_split');
  const [billingCycleStart, setBillingCycleStart] = useState(new Date().toISOString().split('T')[0]);
  const [billingCycleEnd, setBillingCycleEnd] = useState(
    new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0]
  );

  // Model A: Dual Revenue Split
  const [partnerClientSplitPartnerPct, setPartnerClientSplitPartnerPct] = useState(65);
  const [facilityClientSplitFacilityPct, setFacilityClientSplitFacilityPct] = useState(60);
  const [defaultSessionPrice, setDefaultSessionPrice] = useState(30);

  // Model B: Fixed Rent + Quota (+ Hybrid Facility-Referred % Split)
  const [fixedMonthlyRent, setFixedMonthlyRent] = useState(1200);
  const [allowedSessionsQuota, setAllowedSessionsQuota] = useState(100);
  const [overageFeePerSession, setOverageFeePerSession] = useState(12);
  const [enableFacilityClientSplitOnFixedRent, setEnableFacilityClientSplitOnFixedRent] = useState(false);
  const [facilityClientSplitPercent, setFacilityClientSplitPercent] = useState(60);

  // Linked Coaches & Multi-Practitioner Roster
  const [linkedCoachIds, setLinkedCoachIds] = useState<string[]>([]);
  const [practitioners, setPractitioners] = useState<ThirdPartyPractitioner[]>([]);
  const [practNameInput, setPractNameInput] = useState('');
  const [practSpecialtyInput, setPractSpecialtyInput] = useState('');
  const [practPhoneInput, setPractPhoneInput] = useState('');
  const [practEmailInput, setPractEmailInput] = useState('');

  // Add-on Expense Modal State
  const [addonName, setAddonName] = useState('Electricity Share');
  const [addonType, setAddonType] = useState<'fixed' | 'percentage_of_bill'>('percentage_of_bill');
  const [addonFixedAmount, setAddonFixedAmount] = useState(100);
  const [addonBillTotalAmount, setAddonBillTotalAmount] = useState(800);
  const [addonPercentage, setAddonPercentage] = useState(10);
  const [addonDate, setAddonDate] = useState(new Date().toISOString().split('T')[0]);
  const [addonNotes, setAddonNotes] = useState('');

  // Settlement Modal State
  const [settlementStart, setSettlementStart] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  );
  const [settlementEnd, setSettlementEnd] = useState(new Date().toISOString().split('T')[0]);
  const [settlementMethod, setSettlementMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [manualAdjustment, setManualAdjustment] = useState(0);
  const [settlementNotes, setSettlementNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quick Log B2B Partner Session Modal State
  const [activeLogSessionContract, setActiveLogSessionContract] = useState<ThirdPartyGymContract | null>(null);
  const [logPractitionerId, setLogPractitionerId] = useState('');
  const [logClientName, setLogClientName] = useState('');
  const [logLeadSource, setLogLeadSource] = useState<'partner_client' | 'facility_client'>('partner_client');
  const [logSessionFee, setLogSessionFee] = useState(30);
  const [logSessionDate, setLogSessionDate] = useState(new Date().toISOString().split('T')[0]);

  const openCreateModal = () => {
    setEditingContract(null);
    setPartnerName('One to One');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setStatus('active');
    setModelType('revenue_split');
    setBillingCycleStart(new Date().toISOString().split('T')[0]);
    setBillingCycleEnd(new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0]);
    setPartnerClientSplitPartnerPct(65);
    setFacilityClientSplitFacilityPct(60);
    setDefaultSessionPrice(30);
    setFixedMonthlyRent(1200);
    setAllowedSessionsQuota(100);
    setOverageFeePerSession(12);
    setEnableFacilityClientSplitOnFixedRent(false);
    setFacilityClientSplitPercent(60);
    setLinkedCoachIds([]);
    setPractitioners([]);
    setPractNameInput('');
    setPractSpecialtyInput('');
    setPractPhoneInput('');
    setPractEmailInput('');
    setIsModalOpen(true);
  };

  const openEditModal = (contract: ThirdPartyGymContract) => {
    setEditingContract(contract);
    setPartnerName(contract.partnerName);
    setContactPerson(contract.contactPerson);
    setPhone(contract.phone);
    setEmail(contract.contactEmail || contract.email || '');
    setStatus(contract.status);
    setModelType(contract.modelType);
    setBillingCycleStart(contract.billingCycleStart || new Date().toISOString().split('T')[0]);
    setBillingCycleEnd(
      contract.billingCycleEnd ||
        new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0]
    );
    setPartnerClientSplitPartnerPct(contract.partnerClientSplitPartnerPct ?? 65);
    setFacilityClientSplitFacilityPct(contract.facilityClientSplitFacilityPct ?? 60);
    setDefaultSessionPrice(contract.defaultSessionPrice ?? 30);
    setFixedMonthlyRent(contract.fixedMonthlyRent ?? 1200);
    setAllowedSessionsQuota(contract.allowedSessionsQuota ?? 100);
    setOverageFeePerSession(contract.overageFeePerSession ?? 12);
    setEnableFacilityClientSplitOnFixedRent(Boolean(contract.enableFacilityClientSplitOnFixedRent));
    setFacilityClientSplitPercent(contract.facilityClientSplitPercent ?? contract.facilityClientSplitFacilityPct ?? 60);
    setLinkedCoachIds(contract.linkedCoachIds || []);
    setPractitioners(contract.practitioners || []);
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
    setPractitioners(prev => [...prev, newPract]);
    setPractNameInput('');
    setPractSpecialtyInput('');
    setPractPhoneInput('');
    setPractEmailInput('');
  };

  const handleSaveContractForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerName.trim()) return;
    setIsSubmitting(true);
    try {
      const partnerClientSplitFacilityPct = Math.max(0, 100 - Number(partnerClientSplitPartnerPct));
      const facilityClientSplitPartnerPct = Math.max(0, 100 - Number(facilityClientSplitFacilityPct));

      const payload: Omit<ThirdPartyGymContract, 'id'> = {
        partnerName: partnerName.trim(),
        contactPerson: contactPerson.trim(),
        phone: phone.trim(),
        email: email.trim(),
        contactEmail: email.trim(),
        status,
        modelType,
        billingCycleStart,
        billingCycleEnd,
        partnerClientSplitPartnerPct: Number(partnerClientSplitPartnerPct),
        partnerClientSplitFacilityPct,
        facilityClientSplitFacilityPct: Number(facilityClientSplitFacilityPct),
        facilityClientSplitPartnerPct,
        defaultSessionPrice: Number(defaultSessionPrice),
        fixedMonthlyRent: Number(fixedMonthlyRent),
        allowedSessionsQuota: Number(allowedSessionsQuota),
        usedSessionsCurrentCycle: editingContract?.usedSessionsCurrentCycle || 0,
        overageFeePerSession: Number(overageFeePerSession),
        enableFacilityClientSplitOnFixedRent,
        facilityClientSplitPercent: Number(facilityClientSplitPercent),
        linkedCoachIds,
        practitioners,
        addonExpenses: editingContract?.addonExpenses || [],
        settlements: editingContract?.settlements || [],
        createdAt: editingContract?.createdAt || new Date().toISOString(),
        uid: userUid
      };

      await onSaveContract(payload, editingContract?.id);

      // Sync linked coaches
      for (const coach of coaches) {
        const shouldBeLinked = linkedCoachIds.includes(coach.id);
        if (shouldBeLinked) {
          await onUpdateCoach(coach.id, {
            type: 'third_party',
            contractMode: 'third_party',
            thirdPartyName: partnerName.trim(),
            ...(editingContract?.id ? { thirdPartyContractId: editingContract.id } : {})
          });
        }
      }

      toast.success(editingContract ? 'B2B Partner Contract updated!' : 'B2B Partner Contract created!');
      setIsModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAddonContract) return;
    setIsSubmitting(true);
    try {
      const calculatedAmount = addonType === 'fixed'
        ? Number(addonFixedAmount)
        : Number(((Number(addonBillTotalAmount) * Number(addonPercentage)) / 100).toFixed(2));

      const newExpense: ThirdPartyAddonExpense = {
        id: `EXP-${Date.now()}`,
        name: addonName.trim(),
        type: addonType,
        fixedAmount: addonType === 'fixed' ? Number(addonFixedAmount) : undefined,
        billTotalAmount: addonType === 'percentage_of_bill' ? Number(addonBillTotalAmount) : undefined,
        percentage: addonType === 'percentage_of_bill' ? Number(addonPercentage) : undefined,
        calculatedAmount,
        date: addonDate,
        notes: addonNotes.trim()
      };

      const { id, ...rest } = activeAddonContract;
      const updatedExpenses = [newExpense, ...(activeAddonContract.addonExpenses || [])];
      await onSaveContract({ ...rest, addonExpenses: updatedExpenses }, id);
      setActiveAddonContract({ ...activeAddonContract, addonExpenses: updatedExpenses });
      setAddonName('Electricity Share');
      setAddonNotes('');
      toast.success('Utility / Operational Expense added to B2B ledger!');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveExpense = async (contract: ThirdPartyGymContract, expenseId: string) => {
    const { id, ...rest } = contract;
    const updated = (contract.addonExpenses || []).filter(e => e.id !== expenseId);
    await onSaveContract({ ...rest, addonExpenses: updated }, id);
    if (activeAddonContract?.id === id) {
      setActiveAddonContract({ ...contract, addonExpenses: updated });
    }
  };

  // Gather all sessions for a given contract across linked coaches, multi-practitioners & member check-ins
  const getContractSessions = (c: ThirdPartyGymContract) => {
    const linkedSet = new Set(c.linkedCoachIds || []);
    const practitionerNames = new Set(
      (c.practitioners || []).map(p => p.name.trim().toLowerCase()).filter(Boolean)
    );
    const practitionerIds = new Set((c.practitioners || []).map(p => p.id));
    const sessionMap = new Map<
      string,
      {
        date: string;
        fee: number;
        leadSource: 'partner_client' | 'facility_client';
        practitionerKey: string;
        practitionerName: string;
      }
    >();

    coaches.forEach(coach => {
      const coachFullName = `${coach.firstName} ${coach.lastName}`.trim();
      const coachFullNameLower = coachFullName.toLowerCase();
      if (
        linkedSet.has(coach.id) ||
        coach.thirdPartyContractId === c.id ||
        practitionerIds.has(coach.id) ||
        practitionerNames.has(coachFullNameLower)
      ) {
        (coach.sessionLedger || []).forEach(entry => {
          sessionMap.set(entry.id, {
            date: entry.date.split('T')[0],
            fee: entry.feeOverride ?? entry.calculatedFee ?? c.defaultSessionPrice ?? 30,
            leadSource: entry.leadSource || 'partner_client',
            practitionerKey: coach.id,
            practitionerName: coachFullName
          });
        });
        (coach.checkIns || []).forEach(ci => {
          if (!sessionMap.has(ci.id)) {
            sessionMap.set(ci.id, {
              date: ci.timestamp.split('T')[0],
              fee: ci.sessionFee ?? c.defaultSessionPrice ?? 30,
              leadSource: ci.leadSource || 'partner_client',
              practitionerKey: coach.id,
              practitionerName: coachFullName
            });
          }
        });
      }
    });

    members.forEach(m => {
      (m.checkIns || []).forEach(ci => {
        const ciCoachName = (ci.coach || '').trim();
        const ciCoachNameLower = ciCoachName.toLowerCase();
        if (
          ci.thirdPartyContractId === c.id ||
          (ci.coachId && (linkedSet.has(ci.coachId) || practitionerIds.has(ci.coachId))) ||
          (ciCoachNameLower && practitionerNames.has(ciCoachNameLower))
        ) {
          const key = ci.sessionGroupId || ci.id;
          if (!sessionMap.has(key)) {
            const matchedCoach = coaches.find(
              co => co.id === ci.coachId || `${co.firstName} ${co.lastName}`.trim().toLowerCase() === ciCoachNameLower
            );
            sessionMap.set(key, {
              date: ci.date.split('T')[0],
              fee: ci.sessionFee ?? c.defaultSessionPrice ?? 30,
              leadSource: ci.leadSource || 'partner_client',
              practitionerKey: matchedCoach?.id || ci.coachId || ciCoachNameLower || 'partner',
              practitionerName: matchedCoach
                ? `${matchedCoach.firstName} ${matchedCoach.lastName}`.trim()
                : ciCoachName || c.partnerName
            });
          }
        }
      });
    });

    return Array.from(sessionMap.values());
  };

  // Compute per-practitioner session breakdown for a contract
  const getPractitionerBreakdown = (c: ThirdPartyGymContract, allContractSessions: ReturnType<typeof getContractSessions>) => {
    const breakdownMap = new Map<
      string,
      { id: string; name: string; role: string; loggedSessions: number; manualSessions: number; totalSessions: number }
    >();

    // 1. Seed with linked coaches
    coaches
      .filter(co => (c.linkedCoachIds || []).includes(co.id) || co.thirdPartyContractId === c.id)
      .forEach(co => {
        const fullName = `${co.firstName} ${co.lastName}`.trim();
        breakdownMap.set(co.id, {
          id: co.id,
          name: fullName,
          role: co.specialties?.[0] || 'Linked Coach',
          loggedSessions: 0,
          manualSessions: 0,
          totalSessions: 0
        });
      });

    // 2. Seed with sub-practitioners defined on the contract
    (c.practitioners || []).forEach(p => {
      const existingByName = Array.from(breakdownMap.values()).find(
        b => b.name.trim().toLowerCase() === p.name.trim().toLowerCase()
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

    // 3. Attribute logged sessions to matching practitioner/coach
    allContractSessions.forEach(s => {
      let entry = breakdownMap.get(s.practitionerKey);
      if (!entry) {
        entry = Array.from(breakdownMap.values()).find(
          b => b.name.trim().toLowerCase() === s.practitionerName.trim().toLowerCase()
        );
      }
      if (entry) {
        entry.loggedSessions += 1;
      } else {
        breakdownMap.set(s.practitionerKey, {
          id: s.practitionerKey,
          name: s.practitionerName,
          role: 'Partner Coach',
          loggedSessions: 1,
          manualSessions: 0,
          totalSessions: 1
        });
      }
    });

    return Array.from(breakdownMap.values()).map(item => ({
      ...item,
      totalSessions: Math.max(item.loggedSessions, item.manualSessions)
    }));
  };

  const calculateContractSettlement = (
    c: ThirdPartyGymContract,
    periodStartStr?: string,
    periodEndStr?: string,
    adjustment: number = 0
  ) => {
    const allContractSessions = getContractSessions(c);
    const periodSessions =
      periodStartStr && periodEndStr
        ? allContractSessions.filter(s => s.date >= periodStartStr && s.date <= periodEndStr)
        : allContractSessions;

    const practitionerBreakdown = getPractitionerBreakdown(c, periodSessions);
    const pooledPractitionerSessions = practitionerBreakdown.reduce((sum, p) => sum + p.totalSessions, 0);

    const partnerLeadSessions = periodSessions.filter(s => s.leadSource !== 'facility_client');
    const facilityLeadSessions = periodSessions.filter(s => s.leadSource === 'facility_client');

    const grossSessionRevenue = Number(
      periodSessions.reduce((sum, s) => sum + (s.fee || c.defaultSessionPrice || 30), 0).toFixed(2)
    );
    const facilityReferredGrossRevenue = Number(
      facilityLeadSessions.reduce((sum, s) => sum + (s.fee || c.defaultSessionPrice || 30), 0).toFixed(2)
    );

    const partnerFacilityPct = c.partnerClientSplitFacilityPct ?? (100 - (c.partnerClientSplitPartnerPct ?? 65));
    const facilityFacilityPct = c.facilityClientSplitFacilityPct ?? 60;

    let facilitySessionShare = 0;
    let partnerSessionShare = 0;
    let fixedRentCharge = 0;
    let overageSessionsCount = 0;
    let overageFeeCharge = 0;
    let facilityReferredSplitDue = 0;

    const totalSessionsCount = Math.max(
      periodSessions.length,
      pooledPractitionerSessions,
      !periodStartStr ? Number(c.usedSessionsCurrentCycle || 0) : periodSessions.length
    );
    const quota = Number(c.allowedSessionsQuota || 0);
    const remainingQuotaSessions = quota > 0 ? Math.max(0, quota - totalSessionsCount) : 0;

    if (c.modelType === 'revenue_split') {
      const fromPartnerLeads = partnerLeadSessions.reduce(
        (sum, s) => sum + ((s.fee || c.defaultSessionPrice || 30) * partnerFacilityPct) / 100,
        0
      );
      const fromFacilityLeads = facilityLeadSessions.reduce(
        (sum, s) => sum + ((s.fee || c.defaultSessionPrice || 30) * facilityFacilityPct) / 100,
        0
      );
      facilitySessionShare = Number((fromPartnerLeads + fromFacilityLeads).toFixed(2));
      partnerSessionShare = Number(Math.max(0, grossSessionRevenue - facilitySessionShare).toFixed(2));
      if (quota > 0 && totalSessionsCount > quota) {
        overageSessionsCount = Math.max(0, totalSessionsCount - quota);
        overageFeeCharge = Number((overageSessionsCount * Number(c.overageFeePerSession || 0)).toFixed(2));
      }
    } else {
      // Model B: Fixed Rent + Session Quota (+ Optional Hybrid Facility-Referred Lead Split)
      // Partner's own clients remain at 0% commission (covered by fixedMonthlyRent)
      fixedRentCharge = Number(c.fixedMonthlyRent || 0);
      overageSessionsCount = Math.max(0, totalSessionsCount - quota);
      overageFeeCharge = Number((overageSessionsCount * Number(c.overageFeePerSession || 0)).toFixed(2));

      if (c.enableFacilityClientSplitOnFixedRent) {
        const splitPct = Number(c.facilityClientSplitPercent ?? c.facilityClientSplitFacilityPct ?? 0);
        facilityReferredSplitDue = Number(((facilityReferredGrossRevenue * splitPct) / 100).toFixed(2));
        facilitySessionShare = facilityReferredSplitDue;
      }
      partnerSessionShare = Number(Math.max(0, grossSessionRevenue - facilityReferredSplitDue).toFixed(2));
    }

    const periodAddons =
      periodStartStr && periodEndStr
        ? (c.addonExpenses || []).filter(exp => exp.date >= periodStartStr && exp.date <= periodEndStr)
        : c.addonExpenses || [];
    const addonExpensesTotal = Number(
      periodAddons.reduce((sum, exp) => sum + exp.calculatedAmount, 0).toFixed(2)
    );

    const netDueToFacility =
      c.modelType === 'revenue_split'
        ? Number((facilitySessionShare + overageFeeCharge + addonExpensesTotal + Number(adjustment || 0)).toFixed(2))
        : Number(
            (
              fixedRentCharge +
              overageFeeCharge +
              facilityReferredSplitDue +
              addonExpensesTotal +
              Number(adjustment || 0)
            ).toFixed(2)
          );

    return {
      totalSessions: totalSessionsCount,
      remainingQuotaSessions,
      practitionerBreakdown,
      partnerLeadCount: partnerLeadSessions.length,
      facilityLeadCount: facilityLeadSessions.length,
      grossSessionRevenue,
      facilityReferredGrossRevenue,
      facilitySessionShare,
      partnerSessionShare,
      fixedRentCharge,
      overageSessionsCount,
      overageFeeCharge,
      facilityReferredSplitDue,
      periodAddons,
      addonExpensesTotal,
      netDueToFacility
    };
  };

  const handleLogPartnerSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLogSessionContract) return;
    setIsSubmitting(true);
    try {
      const c = activeLogSessionContract;
      const feeNum = Number(logSessionFee) || c.defaultSessionPrice || 30;
      const nowIso = logSessionDate ? `${logSessionDate}T12:00:00.000Z` : new Date().toISOString();

      // Check if selected practitioner is a linked Coach in 'coaches'
      const matchedCoach = coaches.find(co => co.id === logPractitionerId);
      const matchedPractitioner = (c.practitioners || []).find(p => p.id === logPractitionerId);
      const practitionerDisplayName = matchedCoach
        ? `${matchedCoach.firstName} ${matchedCoach.lastName}`
        : matchedPractitioner?.name || c.partnerName;

      if (matchedCoach) {
        const ledgerEntry = {
          id: `B2B-SESS-${Date.now()}`,
          date: nowIso,
          clientNames: [logClientName.trim() || 'Partner Client'],
          clientCount: 1,
          calculatedFee: feeNum,
          feeOverride: feeNum,
          leadSource: logLeadSource,
          thirdPartyContractId: c.id,
          status: 'completed' as const,
          notes: `Logged via B2B Contract (${c.partnerName})`
        };
        await onUpdateCoach(matchedCoach.id, {
          sessionLedger: [ledgerEntry, ...(matchedCoach.sessionLedger || [])],
          currentMonthlySessions: (matchedCoach.currentMonthlySessions || 0) + 1,
          accruedSessionFees: Number(((matchedCoach.accruedSessionFees || 0) + feeNum).toFixed(2))
        });
      }

      // Increment practitioner completedSessions and parent B2B contract usedSessionsCurrentCycle
      const updatedPractitioners = (c.practitioners || []).map(p => {
        const isMatch =
          p.id === logPractitionerId ||
          (matchedCoach && p.name.trim().toLowerCase() === `${matchedCoach.firstName} ${matchedCoach.lastName}`.trim().toLowerCase());
        return isMatch ? { ...p, completedSessions: (p.completedSessions || 0) + 1 } : p;
      });

      const nextUsed = (c.usedSessionsCurrentCycle || 0) + 1;
      const { id, ...rest } = c;
      await onSaveContract(
        {
          ...rest,
          usedSessionsCurrentCycle: nextUsed,
          practitioners: updatedPractitioners
        },
        id
      );

      const quota = Number(c.allowedSessionsQuota || 0);
      if (quota > 0 && nextUsed > quota) {
        toast.warning(
          `Session logged for ${practitionerDisplayName}! Contract "${c.partnerName}" is now in OVERAGE (${nextUsed}/${quota} sessions used, +$${c.overageFeePerSession || 0}/extra session).`
        );
      } else {
        toast.success(
          `Session logged for ${practitionerDisplayName} under "${c.partnerName}" (${nextUsed}${quota > 0 ? `/${quota}` : ''} cycle sessions used)!`
        );
      }

      setActiveLogSessionContract(null);
      setLogClientName('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const settlementBreakdown = useMemo(() => {
    if (!activeSettlementContract) return null;
    return calculateContractSettlement(
      activeSettlementContract,
      settlementStart,
      settlementEnd,
      manualAdjustment
    );
  }, [activeSettlementContract, coaches, members, settlementStart, settlementEnd, manualAdjustment]);

  const exportB2BStatementPDF = (contract: ThirdPartyGymContract, settlement: ThirdPartySettlementRecord) => {
    const doc = new jsPDF();
    const sysTitle = systemName || 'Vescio Nexus ERP';

    doc.setFillColor(5, 7, 10);
    doc.rect(0, 0, 210, 38, 'F');
    doc.setTextColor(0, 184, 200);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(sysTitle.toUpperCase(), 14, 16);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.text('B2B THIRD-PARTY PARTNER SETTLEMENT STATEMENT', 14, 25);
    doc.setFontSize(9);
    doc.setTextColor(180, 190, 205);
    doc.text(`Statement Ref: ${settlement.id} | Settled Date: ${settlement.date}`, 14, 32);

    doc.setTextColor(20, 25, 35);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Partner Entity: ${contract.partnerName}`, 14, 48);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Contact: ${contract.contactPerson || 'N/A'} | Phone: ${contract.phone || 'N/A'} | Email: ${contract.contactEmail || contract.email || 'N/A'}`,
      14,
      54
    );
    doc.text(
      `Contract Model: ${contract.modelType === 'revenue_split' ? 'Dual Revenue Split (%)' : 'Fixed Rent + Session Quota'}`,
      14,
      60
    );
    doc.text(`Settlement Period: ${settlement.periodStart} to ${settlement.periodEnd}`, 14, 66);

    const rows: (string | number)[][] = [];
    if (contract.modelType === 'revenue_split') {
      rows.push([
        'Facility Revenue Share from Partner & Facility Sessions',
        `${settlement.sessionsCount} total sessions (Gross $${settlement.grossSessionRevenue.toFixed(2)})`,
        `$${settlement.facilitySessionShare.toFixed(2)}`
      ]);
      rows.push([
        'Partner Retained Revenue Share',
        `Partner Share`,
        `$${settlement.partnerSessionShare.toFixed(2)}`
      ]);
    } else {
      rows.push([
        'Base Monthly / Period Rent',
        `Quota: ${contract.allowedSessionsQuota || 0} sessions (${settlement.sessionsCount} used)`,
        `$${settlement.fixedRentCharge.toFixed(2)}`
      ]);
      rows.push([
        'Session Overage Fee',
        `${settlement.overageSessionsCount} extra sessions @ $${contract.overageFeePerSession || 0}/session`,
        `$${settlement.overageFeeCharge.toFixed(2)}`
      ]);
      if (contract.enableFacilityClientSplitOnFixedRent || (settlement.facilityReferredSplitDue || 0) > 0) {
        rows.push([
          'Facility-Referred Lead Split ($)',
          `${contract.facilityClientSplitPercent ?? 60}% Facility Share on Facility-Referred Clients`,
          `$${(settlement.facilityReferredSplitDue || 0).toFixed(2)}`
        ]);
      }
    }

    rows.push([
      'Utility & Operational Add-On Expenses',
      'Electricity / Water / Facility operational shares',
      `$${settlement.addonExpensesTotal.toFixed(2)}`
    ]);

    rows.push([
      'TOTAL SETTLED TO FACILITY',
      `Payment Method: ${settlement.paymentMethod.toUpperCase()}`,
      `$${settlement.amountSettled.toFixed(2)}`
    ]);

    autoTable(doc, {
      startY: 74,
      head: [['Line Item', 'Details / Formula', 'Amount (USD)']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [0, 184, 200], textColor: [5, 7, 10], fontStyle: 'bold' },
      styles: { fontSize: 9 }
    });

    doc.save(`${contract.partnerName.replace(/\s+/g, '_')}_B2B_Settlement_${settlement.id}.pdf`);
  };

  const handleExecuteSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSettlementContract || !settlementBreakdown) return;
    setIsSubmitting(true);
    try {
      const c = activeSettlementContract;
      const settlementRecord: ThirdPartySettlementRecord = {
        id: `B2B-STL-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        periodStart: settlementStart,
        periodEnd: settlementEnd,
        sessionsCount: settlementBreakdown.totalSessions,
        grossSessionRevenue: settlementBreakdown.grossSessionRevenue,
        facilitySessionShare: settlementBreakdown.facilitySessionShare,
        partnerSessionShare: settlementBreakdown.partnerSessionShare,
        fixedRentCharge: settlementBreakdown.fixedRentCharge,
        overageSessionsCount: settlementBreakdown.overageSessionsCount,
        overageFeeCharge: settlementBreakdown.overageFeeCharge,
        facilityReferredSplitDue: settlementBreakdown.facilityReferredSplitDue,
        addonExpensesTotal: settlementBreakdown.addonExpensesTotal,
        netDueToFacility: settlementBreakdown.netDueToFacility,
        amountSettled: settlementBreakdown.netDueToFacility,
        paymentMethod: settlementMethod,
        notes: settlementNotes.trim()
      };

      const updatedSettlements = [settlementRecord, ...(c.settlements || [])];
      const { id, ...rest } = c;
      await onSaveContract(
        {
          ...rest,
          settlements: updatedSettlements,
          usedSessionsCurrentCycle: 0
        },
        id
      );

      // Post to Dual-Mode Accounting (Real-Time + Posting Mode via processLedgerTransaction)
      if (settlementBreakdown.netDueToFacility > 0) {
        const addonPortion = Math.max(0, Math.min(settlementBreakdown.addonExpensesTotal || 0, settlementBreakdown.netDueToFacility));
        const facilityRevPortion = Math.max(0, Number((settlementBreakdown.netDueToFacility - addonPortion).toFixed(2)));
        const debitAcc = settlementMethod === 'cash'
          ? '531 - Cash Drawer / Register (Caisse)'
          : settlementMethod === 'card'
          ? '512 - Bank / Card Terminal'
          : '512 - Bank Accounts (Fresh USD / LBP)';

        if (facilityRevPortion > 0) {
          await processLedgerTransaction({
            amount: facilityRevPortion,
            paymentMethod: settlementMethod,
            sourceModule: 'gym',
            cashierId: userUid || 'system',
            transactionType: 'b2b_partner_settlement',
            sourceAccount: debitAcc,
            destinationAccount: '7061 - Gym Membership & Training Revenue',
            referenceId: settlementRecord.id,
            notes: `B2B Partner Facility Share (${c.modelType === 'revenue_split' ? 'Revenue Split' : 'Fixed Rent + Quota'}): ${c.partnerName} (${settlementStart} to ${settlementEnd}) - ${settlementBreakdown.totalSessions} sessions`
          });
        }

        if (addonPortion > 0) {
          await processLedgerTransaction({
            amount: Number(addonPortion.toFixed(2)),
            paymentMethod: settlementMethod,
            sourceModule: 'gym',
            cashierId: userUid || 'system',
            transactionType: 'b2b_utility_recovery',
            sourceAccount: debitAcc,
            destinationAccount: '708 - Ancillary Facility & Utility Recovery',
            referenceId: settlementRecord.id,
            notes: `B2B Utility & Operational Expense Recovery: ${c.partnerName} (${(c.addonExpenses || []).map(e => e.name).join(', ') || 'Utility Share'})`
          });
        }
      }

      exportB2BStatementPDF(c, settlementRecord);
      toast.success(`B2B Settlement for ${c.partnerName} posted to Accounting & PDF downloaded!`);
      setActiveSettlementContract(null);
      setManualAdjustment(0);
      setSettlementNotes('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-[#0B0F17] border border-slate-800/80 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#00B8C8]/10 border border-[#00B8C8]/30 flex items-center justify-center text-[#00B8C8]">
            <Building2 size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              3rd-Party B2B Gym Contracts & Partner Entities
            </h2>
            <p className="text-xs text-slate-400">
              Manage external training partners (e.g. &ldquo;One to One&rdquo;), Dual Lead-Source Revenue Splits, Fixed Rent + Session Quotas, Utility Shares & Financial Settlements
            </p>
          </div>
        </div>
        <button
          onClick={openCreateModal}
          className="px-4 py-2.5 rounded-xl bg-[#00B8C8] hover:bg-[#00B8C8]/90 text-[#05070A] font-bold text-xs flex items-center gap-2 transition-all shadow-lg shadow-[#00B8C8]/20 self-start lg:self-auto"
        >
          <Plus size={16} /> New 3rd-Party B2B Contract
        </button>
      </div>

      {/* Contracts Grid */}
      {contracts.length === 0 ? (
        <div className="bg-[#0B0F17] border border-slate-800/80 rounded-2xl p-12 text-center">
          <Building2 size={36} className="mx-auto text-[#00B8C8]/50 mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No 3rd-Party B2B Contracts Configured</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-5">
            Create a B2B contract for external fitness organizations like &ldquo;One to One&rdquo; to track Partner vs Facility client splits, fixed rent quotas, and utility expense shares.
          </p>
          <button
            onClick={openCreateModal}
            className="px-4 py-2.5 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs inline-flex items-center gap-2"
          >
            <Plus size={15} /> Create &ldquo;One to One&rdquo; Partner Contract
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {contracts.map(contract => {
            const linkedCoaches = coaches.filter(
              c => (contract.linkedCoachIds || []).includes(c.id) || c.thirdPartyContractId === contract.id
            );
            const cardCalc = calculateContractSettlement(contract);
            const partnerLeads = cardCalc.partnerLeadCount;
            const facilityLeads = cardCalc.facilityLeadCount;
            const addonTotal = cardCalc.addonExpensesTotal;
            const customPractitioners = contract.practitioners || [];

            return (
              <div
                key={contract.id}
                className="bg-[#0B0F17] border border-slate-800/80 hover:border-[#00B8C8]/40 rounded-2xl p-6 flex flex-col justify-between transition-all"
              >
                <div>
                  {/* Top Row */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-bold text-white">{contract.partnerName}</span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                            contract.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {contract.status}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase bg-[#00B8C8]/10 text-[#00B8C8] border border-[#00B8C8]/30">
                          {contract.modelType === 'revenue_split'
                            ? 'Model A: Dual Revenue Split'
                            : contract.enableFacilityClientSplitOnFixedRent
                              ? 'Model B: Hybrid Fixed Rent + Lead Split'
                              : 'Model B: Fixed Rent + Quota'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Contact: <span className="text-slate-200 font-medium">{contract.contactPerson || 'N/A'}</span> •{' '}
                        {contract.phone || 'No phone'}
                        {(contract.contactEmail || contract.email) && ` • ${contract.contactEmail || contract.email}`} • Cycle:{' '}
                        {contract.billingCycleStart || 'N/A'} → {contract.billingCycleEnd || 'N/A'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openEditModal(contract)}
                        className="p-2 rounded-lg bg-[#101622] hover:bg-slate-800 text-slate-300 hover:text-[#00B8C8] border border-slate-800 transition-colors"
                        title="Edit Contract Terms"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => onDeleteContract(contract.id)}
                        className="p-2 rounded-lg bg-[#101622] hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors"
                        title="Delete Contract"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Financial Structure Box */}
                  {contract.modelType === 'revenue_split' ? (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-[#101622] border border-slate-800/80 rounded-xl p-3">
                        <div className="text-[11px] text-slate-400 font-medium mb-1">
                          Partner-Sourced Clients ({partnerLeads} sessions)
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-300">
                            Partner: <strong className="text-white">{contract.partnerClientSplitPartnerPct ?? 65}%</strong>
                          </span>
                          <span className="text-xs text-[#00B8C8] font-bold">
                            Facility: {contract.partnerClientSplitFacilityPct ?? 35}%
                          </span>
                        </div>
                      </div>
                      <div className="bg-[#101622] border border-slate-800/80 rounded-xl p-3">
                        <div className="text-[11px] text-slate-400 font-medium mb-1">
                          Facility-Sourced Clients ({facilityLeads} sessions)
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#00B8C8] font-bold">
                            Facility: {contract.facilityClientSplitFacilityPct ?? 60}%
                          </span>
                          <span className="text-xs text-slate-300">
                            Partner: <strong className="text-white">{contract.facilityClientSplitPartnerPct ?? 40}%</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5 mb-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-[#101622] border border-slate-800/80 rounded-xl p-3">
                          <div className="text-[10px] text-slate-400 uppercase">Fixed Rent / Cycle</div>
                          <div className="text-base font-bold text-white tabular-nums mt-0.5">
                            ${(contract.fixedMonthlyRent || 0).toLocaleString()}
                          </div>
                        </div>
                        <div className="bg-[#101622] border border-slate-800/80 rounded-xl p-3">
                          <div className="text-[10px] text-slate-400 uppercase">Session Quota</div>
                          <div className="text-base font-bold text-[#00B8C8] tabular-nums mt-0.5">
                            {cardCalc.totalSessions} / {contract.allowedSessionsQuota || 0}
                          </div>
                        </div>
                        <div className="bg-[#101622] border border-slate-800/80 rounded-xl p-3">
                          <div className="text-[10px] text-slate-400 uppercase">Overage Rate</div>
                          <div className="text-base font-bold text-amber-400 tabular-nums mt-0.5">
                            +${contract.overageFeePerSession || 0}/sess
                          </div>
                        </div>
                      </div>
                      {contract.enableFacilityClientSplitOnFixedRent && (
                        <div className="bg-[#00B8C8]/10 border border-[#00B8C8]/30 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
                          <div className="text-xs text-slate-200">
                            <span className="font-bold text-[#00B8C8]">Facility-Referred Lead Split:</span>{' '}
                            {contract.facilityClientSplitPercent ?? 60}% Facility /{' '}
                            {Math.max(0, 100 - (contract.facilityClientSplitPercent ?? 60))}% Partner ({facilityLeads} facility sessions)
                          </div>
                          <div className="text-xs font-bold text-[#00B8C8] tabular-nums">
                            +${cardCalc.facilityReferredSplitDue.toFixed(2)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Shared Business Session Pool & Per-Practitioner Breakdown */}
                  <div className="mb-4 bg-[#101622]/90 border border-slate-800/80 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Users size={13} className="text-[#00B8C8]" />
                        Multi-Practitioner Shared Pool ({linkedCoaches.length + customPractitioners.length} Practitioners)
                      </div>
                      <div className="flex items-center gap-2">
                        {(contract.allowedSessionsQuota || 0) > 0 && (
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                              cardCalc.overageSessionsCount > 0
                                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {cardCalc.overageSessionsCount > 0
                              ? `OVERAGE: +${cardCalc.overageSessionsCount} Sess (+$${cardCalc.overageFeeCharge.toFixed(2)})`
                              : `${cardCalc.remainingQuotaSessions} / ${contract.allowedSessionsQuota} Remaining`}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-md bg-[#00B8C8]/15 border border-[#00B8C8]/30 text-[10px] font-bold text-[#00B8C8] tabular-nums">
                          Total Used: {cardCalc.totalSessions} Sess
                        </span>
                      </div>
                    </div>

                    {cardCalc.practitionerBreakdown.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">
                        No trainers linked yet. Edit contract to assign trainers or practitioners under {contract.partnerName}.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {cardCalc.practitionerBreakdown.map(pb => (
                          <div
                            key={pb.id}
                            className="px-2.5 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-800/90 flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <UserCheck size={12} className="text-[#00B8C8] shrink-0" />
                              <div className="truncate">
                                <span className="text-xs font-semibold text-white">{pb.name}</span>
                                <span className="text-[10px] text-slate-400 ml-1">({pb.role})</span>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded bg-[#00B8C8]/10 text-[#00B8C8] text-[10px] font-bold tabular-nums shrink-0">
                              {pb.totalSessions} sess
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Utility / Add-on Expenses Summary */}
                  <div className="bg-[#101622]/90 border border-slate-800/80 rounded-xl p-3 mb-4 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <Zap size={13} className="text-amber-400" />
                        Add-On Utility & Operational Expenses ({(contract.addonExpenses || []).length} logged)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Electricity, Water, Internet & Maintenance shares billed to {contract.partnerName}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-amber-400 tabular-nums">
                        ${addonTotal.toFixed(2)}
                      </div>
                      <button
                        onClick={() => setActiveAddonContract(contract)}
                        className="text-[11px] text-[#00B8C8] hover:underline font-medium"
                      >
                        Manage Add-Ons →
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bottom Action Footer */}
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] text-slate-400">
                    Past Settlements: <strong className="text-white">{(contract.settlements || []).length}</strong>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        setActiveLogSessionContract(contract);
                        const firstCoach = linkedCoaches[0]?.id || customPractitioners[0]?.id || '';
                        setLogPractitionerId(firstCoach);
                        setLogSessionFee(contract.defaultSessionPrice || 30);
                        setLogLeadSource('partner_client');
                        setLogClientName('');
                      }}
                      className="px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <UserCheck size={13} /> + Log Session
                    </button>
                    <button
                      onClick={() => setActiveAddonContract(contract)}
                      className="px-3 py-2 rounded-xl bg-[#101622] hover:bg-slate-800 text-slate-200 border border-slate-700/80 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <Zap size={13} className="text-[#00B8C8]" /> + Utility / Expense
                    </button>
                    <button
                      onClick={() => setActiveSettlementContract(contract)}
                      className="px-3.5 py-2 rounded-xl bg-[#00B8C8] hover:bg-[#00B8C8]/90 text-[#05070A] font-bold text-xs flex items-center gap-1.5 transition-all"
                    >
                      <DollarSign size={14} /> Execute Settlement
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE / EDIT CONTRACT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0B0F17] border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <Building2 className="text-[#00B8C8]" size={20} />
                <h3 className="text-base font-bold text-white">
                  {editingContract ? `Edit B2B Contract — ${editingContract.partnerName}` : 'New 3rd-Party B2B Gym Contract'}
                </h3>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveContractForm} className="space-y-4 [color-scheme:dark]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Partner Organization Name *</label>
                  <input
                    type="text"
                    required
                    value={partnerName}
                    onChange={e => setPartnerName(e.target.value)}
                    placeholder="e.g., One to One"
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm focus:border-[#00B8C8] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Primary Contact Person</label>
                  <input
                    type="text"
                    value={contactPerson}
                    onChange={e => setContactPerson(e.target.value)}
                    placeholder="Managing Director / Lead Coordinator"
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm focus:border-[#00B8C8] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+961 ..."
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm focus:border-[#00B8C8] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Contact Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="partner@organization.com"
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm focus:border-[#00B8C8] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Contract Status</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as 'active' | 'inactive')}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm focus:border-[#00B8C8] focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Cycle Start Date</label>
                  <input
                    type="date"
                    value={billingCycleStart}
                    onChange={e => setBillingCycleStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm focus:border-[#00B8C8] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Cycle End Date</label>
                  <input
                    type="date"
                    value={billingCycleEnd}
                    onChange={e => setBillingCycleEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm focus:border-[#00B8C8] focus:outline-none"
                  />
                </div>
              </div>

              {/* Financial Structure Selector */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  B2B Financial Model (Editable Anytime for Future Renewals)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setModelType('revenue_split')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      modelType === 'revenue_split'
                        ? 'bg-[#00B8C8]/10 border-[#00B8C8] text-white'
                        : 'bg-[#101622] border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="text-xs font-bold text-white flex items-center justify-between">
                      <span>Model A: Dual Revenue Split (%)</span>
                      {modelType === 'revenue_split' && <CheckCircle2 size={14} className="text-[#00B8C8]" />}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Separate % splits depending on whether the client lead came from {partnerName || 'Partner'} or our Facility.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModelType('fixed_rent')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      modelType === 'fixed_rent'
                        ? 'bg-[#00B8C8]/10 border-[#00B8C8] text-white'
                        : 'bg-[#101622] border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="text-xs font-bold text-white flex items-center justify-between">
                      <span>Model B: Fixed Rent + Session Quota</span>
                      {modelType === 'fixed_rent' && <CheckCircle2 size={14} className="text-[#00B8C8]" />}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Fixed monthly/period rent for an allowed session quota plus optional % split on Facility-referred leads.
                    </p>
                  </button>
                </div>
              </div>

              {modelType === 'revenue_split' ? (
                <div className="bg-[#101622] border border-slate-800 rounded-xl p-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Partner-Sourced Lead: Partner %
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={partnerClientSplitPartnerPct}
                        onChange={e => setPartnerClientSplitPartnerPct(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm tabular-nums"
                      />
                      <span className="text-[10px] text-[#00B8C8] mt-1 block">
                        Facility Share: {Math.max(0, 100 - partnerClientSplitPartnerPct)}%
                      </span>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Facility-Sourced Lead: Facility %
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={facilityClientSplitFacilityPct}
                        onChange={e => setFacilityClientSplitFacilityPct(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm tabular-nums"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Partner Share: {Math.max(0, 100 - facilityClientSplitFacilityPct)}%
                      </span>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Default Session Gross Price ($)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={defaultSessionPrice}
                        onChange={e => setDefaultSessionPrice(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-[#101622] border border-slate-800 rounded-xl p-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">Fixed Rent ($)</label>
                      <input
                        type="number"
                        min={0}
                        value={fixedMonthlyRent}
                        onChange={e => setFixedMonthlyRent(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">Allowed Sessions Quota</label>
                      <input
                        type="number"
                        min={0}
                        value={allowedSessionsQuota}
                        onChange={e => setAllowedSessionsQuota(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">Overage Fee ($/Sess)</label>
                      <input
                        type="number"
                        min={0}
                        value={overageFeePerSession}
                        onChange={e => setOverageFeePerSession(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  {/* Hybrid Model B Option: Facility-Referred Lead Split */}
                  <div className="pt-3 border-t border-slate-800/80 space-y-3">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <span className="text-xs font-bold text-white block">
                          Enable Hybrid Facility-Referred Lead Split (%) on Fixed Rent
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Partner&apos;s own clients remain at 0% commission (covered by Fixed Rent), while Facility-referred clients apply a % revenue split.
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={enableFacilityClientSplitOnFixedRent}
                        onChange={e => setEnableFacilityClientSplitOnFixedRent(e.target.checked)}
                        className="w-4 h-4 accent-[#00B8C8]"
                      />
                    </label>

                    {enableFacilityClientSplitOnFixedRent && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-[#0B0F17] border border-[#00B8C8]/30">
                        <div>
                          <label className="block text-[11px] font-semibold text-[#00B8C8] mb-1">
                            Facility-Referred Lead: Facility Share (%)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={facilityClientSplitPercent}
                            onChange={e => setFacilityClientSplitPercent(Math.min(100, Math.max(0, Number(e.target.value))))}
                            className="w-full px-3 py-1.5 rounded-lg bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs tabular-nums"
                          />
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            Partner Retain: {Math.max(0, 100 - facilityClientSplitPercent)}% • Partner Own Clients: 0% Facility Fee
                          </span>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Default Session Gross Price ($)
                          </label>
                          <input
                            type="number"
                            min={0}
                            step="0.5"
                            value={defaultSessionPrice}
                            onChange={e => setDefaultSessionPrice(Number(e.target.value))}
                            className="w-full px-3 py-1.5 rounded-lg bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs tabular-nums"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Linked Trainers */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Link Existing System Trainers Operating Under {partnerName || 'This Partner'}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 rounded-xl bg-[#101622] border border-slate-800">
                  {coaches.map(coach => {
                    const checked = linkedCoachIds.includes(coach.id);
                    return (
                      <label
                        key={coach.id}
                        className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs border transition-colors ${
                          checked
                            ? 'bg-[#00B8C8]/15 border-[#00B8C8]/40 text-white font-semibold'
                            : 'bg-[#0B0F17] border-slate-800 text-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setLinkedCoachIds(prev =>
                              checked ? prev.filter(id => id !== coach.id) : [...prev, coach.id]
                            )
                          }
                          className="accent-[#00B8C8]"
                        />
                        <span className="truncate">{coach.firstName} {coach.lastName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Multi-Practitioner Roster Builder */}
              <div className="p-3.5 rounded-xl bg-[#101622] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#00B8C8]">
                    Contract Practitioners Roster ({practitioners.length})
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Any check-in by these practitioners deducts from this contract&apos;s session quota
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input
                    type="text"
                    placeholder="Practitioner Name *"
                    value={practNameInput}
                    onChange={e => setPractNameInput(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Specialty / Role"
                    value={practSpecialtyInput}
                    onChange={e => setPractSpecialtyInput(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Phone"
                    value={practPhoneInput}
                    onChange={e => setPractPhoneInput(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddPractitionerToForm}
                    className="px-3 py-1.5 rounded-lg bg-[#00B8C8] text-[#05070A] font-bold text-xs"
                  >
                    + Add Practitioner
                  </button>
                </div>
                {practitioners.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {practitioners.map(p => (
                      <span
                        key={p.id}
                        className="px-2.5 py-1 rounded-lg bg-[#0B0F17] border border-slate-800 text-xs text-slate-200 flex items-center gap-2"
                      >
                        <span>
                          <strong>{p.name}</strong>
                          {p.specialty ? ` • ${p.specialty}` : ''}
                          {p.phone ? ` • ${p.phone}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPractitioners(prev => prev.filter(item => item.id !== p.id))}
                          className="text-slate-500 hover:text-rose-400"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#101622] text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs"
                >
                  {isSubmitting ? 'Saving...' : editingContract ? 'Update B2B Contract' : 'Create B2B Contract'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD-ON UTILITY & OPERATIONAL EXPENSES MODAL */}
      {activeAddonContract && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0B0F17] border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto [color-scheme:dark]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Utility & Operational Expenses — {activeAddonContract.partnerName}
                </h3>
                <p className="text-xs text-slate-400">
                  Attach fixed dollar charges or a percentage share of facility utility bills (Electricity, Water, Wi-Fi)
                </p>
              </div>
              <button onClick={() => setActiveAddonContract(null)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddExpense} className="bg-[#101622] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Expense Title</label>
                  <input
                    type="text"
                    required
                    value={addonName}
                    onChange={e => setAddonName(e.target.value)}
                    placeholder="e.g., Monthly Electricity Share"
                    className="w-full px-3 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Billing Date</label>
                  <input
                    type="date"
                    value={addonDate}
                    onChange={e => setAddonDate(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAddonType('percentage_of_bill')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border ${
                    addonType === 'percentage_of_bill'
                      ? 'bg-[#00B8C8]/15 border-[#00B8C8] text-[#00B8C8]'
                      : 'bg-[#0B0F17] border-slate-800 text-slate-400'
                  }`}
                >
                  % Share of Total Utility Bill
                </button>
                <button
                  type="button"
                  onClick={() => setAddonType('fixed')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border ${
                    addonType === 'fixed'
                      ? 'bg-[#00B8C8]/15 border-[#00B8C8] text-[#00B8C8]'
                      : 'bg-[#0B0F17] border-slate-800 text-slate-400'
                  }`}
                >
                  Fixed Dollar Amount ($)
                </button>
              </div>

              {addonType === 'percentage_of_bill' ? (
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Total Facility Bill ($)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={addonBillTotalAmount}
                      onChange={e => setAddonBillTotalAmount(Number(e.target.value))}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Partner Share (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={addonPercentage}
                      onChange={e => setAddonPercentage(Number(e.target.value))}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs tabular-nums"
                    />
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-1.5 text-right">
                    <span className="text-[10px] text-slate-400 block">Computed Charge</span>
                    <span className="text-sm font-bold text-[#00B8C8] tabular-nums">
                      ${((addonBillTotalAmount * addonPercentage) / 100).toFixed(2)}
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Fixed Charge Amount ($)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={addonFixedAmount}
                    onChange={e => setAddonFixedAmount(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs tabular-nums"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs"
              >
                + Add Expense to Partner Ledger
              </button>
            </form>

            {/* Expense History List */}
            <div className="space-y-2">
              {(activeAddonContract.addonExpenses || []).length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">No utility or operational expenses logged yet.</p>
              ) : (
                (activeAddonContract.addonExpenses || []).map(exp => (
                  <div
                    key={exp.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-[#101622] border border-slate-800 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-white">{exp.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {exp.date} •{' '}
                        {exp.type === 'percentage_of_bill'
                          ? `${exp.percentage}% of $${exp.billTotalAmount} bill`
                          : 'Fixed Charge'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-white tabular-nums">${exp.calculatedAmount.toFixed(2)}</span>
                      <button
                        onClick={() => handleRemoveExpense(activeAddonContract, exp.id)}
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* B2B PERIOD SETTLEMENT EXECUTION MODAL */}
      {activeSettlementContract && settlementBreakdown && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0B0F17] border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 max-h-[92vh] overflow-y-auto [color-scheme:dark]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Execute B2B Financial Settlement — {activeSettlementContract.partnerName}
                </h3>
                <p className="text-xs text-slate-400">
                  Posts directly to Dual-Mode Accounting (Real-Time & Posting Ledgers) and generates an official PDF Statement
                </p>
              </div>
              <button onClick={() => setActiveSettlementContract(null)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleExecuteSettlement} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Period Start</label>
                  <input
                    type="date"
                    value={settlementStart}
                    onChange={e => setSettlementStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Period End</label>
                  <input
                    type="date"
                    value={settlementEnd}
                    onChange={e => setSettlementEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  />
                </div>
              </div>

              {/* Breakdown Box */}
              <div className="bg-[#101622] border border-slate-800 rounded-xl p-4 space-y-2.5 text-xs">
                <div className="flex justify-between text-slate-300">
                  <span>Total Partner Sessions in Period:</span>
                  <strong className="text-white tabular-nums">
                    {settlementBreakdown.totalSessions} ({settlementBreakdown.partnerLeadCount} Partner /{' '}
                    {settlementBreakdown.facilityLeadCount} Facility)
                  </strong>
                </div>

                {activeSettlementContract.modelType === 'revenue_split' ? (
                  <div className="flex justify-between text-slate-300">
                    <span>Facility Revenue Share from Sessions:</span>
                    <strong className="text-[#00B8C8] tabular-nums">
                      ${settlementBreakdown.facilitySessionShare.toFixed(2)}
                    </strong>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-slate-300">
                      <span>Base Period Rent:</span>
                      <strong className="text-white tabular-nums">${settlementBreakdown.fixedRentCharge.toFixed(2)}</strong>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Overage Sessions ({settlementBreakdown.overageSessionsCount} extra):</span>
                      <strong className="text-amber-400 tabular-nums">
                        +${settlementBreakdown.overageFeeCharge.toFixed(2)}
                      </strong>
                    </div>
                    {activeSettlementContract.enableFacilityClientSplitOnFixedRent && (
                      <div className="flex justify-between text-slate-300">
                        <span>
                          Facility-Referred Lead Split ({activeSettlementContract.facilityClientSplitPercent ?? 60}% of $
                          {settlementBreakdown.facilityReferredGrossRevenue.toFixed(2)}):
                        </span>
                        <strong className="text-[#00B8C8] tabular-nums">
                          +${settlementBreakdown.facilityReferredSplitDue.toFixed(2)}
                        </strong>
                      </div>
                    )}
                  </>
                )}

                <div className="flex justify-between text-slate-300">
                  <span>Utility & Operational Add-On Expenses ({settlementBreakdown.periodAddons.length}):</span>
                  <strong className="text-amber-400 tabular-nums">+${settlementBreakdown.addonExpensesTotal.toFixed(2)}</strong>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="font-bold text-white text-sm">Net Settlement Due to Facility:</span>
                  <span className="text-lg font-extrabold text-[#00B8C8] tabular-nums">
                    ${settlementBreakdown.netDueToFacility.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Manual Adjustment ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualAdjustment}
                    onChange={e => setManualAdjustment(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Payment Method</label>
                  <select
                    value={settlementMethod}
                    onChange={e => setSettlementMethod(e.target.value as 'cash' | 'card' | 'transfer')}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="transfer">Bank Transfer</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveSettlementContract(null)}
                  className="px-4 py-2 rounded-xl bg-[#101622] text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs flex items-center gap-1.5"
                >
                  <Download size={14} />
                  {isSubmitting ? 'Posting & Generating PDF...' : 'Post Settlement & Download PDF'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK LOG B2B PARTNER SESSION MODAL */}
      {activeLogSessionContract && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0B0F17] border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 [color-scheme:dark]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <UserCheck size={18} className="text-[#00B8C8]" />
                  Log Partner Session — {activeLogSessionContract.partnerName}
                </h3>
                <p className="text-xs text-slate-400">
                  Deducts 1 session from the shared B2B allowance & increments the practitioner&apos;s personal count
                </p>
              </div>
              <button onClick={() => setActiveLogSessionContract(null)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleLogPartnerSession} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Coach / Practitioner Conducting Session *
                </label>
                <select
                  value={logPractitionerId}
                  onChange={e => setLogPractitionerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                >
                  <option value="">-- General Partner Pool ({activeLogSessionContract.partnerName}) --</option>
                  {coaches
                    .filter(
                      co =>
                        (activeLogSessionContract.linkedCoachIds || []).includes(co.id) ||
                        co.thirdPartyContractId === activeLogSessionContract.id
                    )
                    .map(co => (
                      <option key={co.id} value={co.id}>
                        {co.firstName} {co.lastName} (Linked Coach)
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
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Client Name</label>
                  <input
                    type="text"
                    value={logClientName}
                    onChange={e => setLogClientName(e.target.value)}
                    placeholder="e.g., Rami K."
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Session Date</label>
                  <input
                    type="date"
                    value={logSessionDate}
                    onChange={e => setLogSessionDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Client Lead Source</label>
                  <select
                    value={logLeadSource}
                    onChange={e => setLogLeadSource(e.target.value as 'partner_client' | 'facility_client')}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs"
                  >
                    <option value="partner_client">Partner&apos;s Own Client</option>
                    <option value="facility_client">Facility-Referred Client</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Session Gross Fee ($)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={logSessionFee}
                    onChange={e => setLogSessionFee(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-[#101622] border border-slate-800 text-zinc-100 [color-scheme:dark] text-xs tabular-nums"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveLogSessionContract(null)}
                  className="px-4 py-2 rounded-xl bg-[#101622] text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#00B8C8] text-[#05070A] font-bold text-xs"
                >
                  {isSubmitting ? 'Logging...' : 'Confirm & Deduct Allowance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
