import { collection, doc, getDocs, setDoc, addDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { HREmployee, Coach, Member, Booking } from '../types';
import { processLedgerTransaction } from './transaction-engine';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PayrollBreakdown {
  employeeId: string;
  employeeName: string;
  role: string;
  department: string;
  month: string;
  baseSalary: number;
  gymSessionsCount: number;
  gymCommission: number;
  courtSessionsCount: number;
  courtCommission: number;
  physioSessionsCount: number;
  physioCommission: number;
  totalCommissions: number;
  overtimeHours: number;
  hourlyOvertimeRate: number;
  overtimePay: number;
  bonuses: number;
  unpaidLeaveDays: number;
  unpaidLeaveDeduction: number;
  manualDeductions: number;
  advancesRecovery: number;
  nssfContribution: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
}

export const normalizeHREmployee = (id: string, raw: any): HREmployee => {
  const salaryVal = Number(raw.salary ?? raw.baseSalary ?? 0);
  return {
    id,
    name: raw.name || `${raw.firstName || ''} ${raw.lastName || ''}`.trim() || 'Unnamed Employee',
    role: raw.role || 'Staff',
    department: raw.department || 'General',
    email: raw.email || '',
    phone: raw.phone || raw.phoneNumber || '',
    salary: salaryVal,
    baseSalary: salaryVal,
    hourlyOvertimeRate: Number(raw.hourlyOvertimeRate ?? Number(((salaryVal / 160) * 1.5).toFixed(2))),
    nssfContribution: Number(raw.nssfContribution ?? 0),
    commissionRatePerSession: Number(raw.commissionRatePerSession ?? 0),
    commissionPercent: Number(raw.commissionPercent ?? 0),
    linkedCoachId: raw.linkedCoachId || '',
    linkedTherapistId: raw.linkedTherapistId || '',
    joinDate: raw.joinDate || (raw.createdAt && typeof raw.createdAt === 'string' ? raw.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
    status: raw.status === 'on_leave' || raw.status === 'terminated' ? raw.status : 'active',
    advances: Number(raw.advances ?? 0),
    bonuses: Number(raw.bonuses ?? 0),
    deductions: Number(raw.deductions ?? 0),
    lastPayrollPaidMonth: raw.lastPayrollPaidMonth || '',
    payrollRecurrence: raw.payrollRecurrence || 'monthly',
    uid: raw.uid || '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  };
};

let migrationAttempted = false;

export const migrateLegacyEmployeesToHR = async (uid: string) => {
  if (migrationAttempted) return;
  migrationAttempted = true;
  try {
    const [hrSnap, legacyEmpSnap, staffSnap] = await Promise.all([
      getDocs(collection(db, 'hr_employees')),
      getDocs(collection(db, 'employees')),
      getDocs(collection(db, 'staff'))
    ]);

    const existingNames = new Set(
      hrSnap.docs.map(d => String(d.data().name || '').trim().toLowerCase()).filter(Boolean)
    );
    const existingIds = new Set(hrSnap.docs.map(d => d.id));

    for (const d of legacyEmpSnap.docs) {
      const data = d.data();
      const nameLower = String(data.name || '').trim().toLowerCase();
      if (!existingIds.has(d.id) && (!nameLower || !existingNames.has(nameLower))) {
        const normalized = normalizeHREmployee(d.id, { ...data, uid });
        await setDoc(doc(db, 'hr_employees', d.id), normalized, { merge: true });
        existingIds.add(d.id);
        if (nameLower) existingNames.add(nameLower);
      }
    }

    for (const d of staffSnap.docs) {
      const data = d.data();
      // Only migrate staff docs that were created via the old HR form (which had baseSalary/payrollRecurrence and not RBAC permissions)
      if (data.baseSalary !== undefined && !data.permissions) {
        const nameLower = String(data.name || '').trim().toLowerCase();
        if (!existingIds.has(d.id) && (!nameLower || !existingNames.has(nameLower))) {
          const normalized = normalizeHREmployee(d.id, { ...data, uid });
          await setDoc(doc(db, 'hr_employees', d.id), normalized, { merge: true });
          existingIds.add(d.id);
          if (nameLower) existingNames.add(nameLower);
        }
      }
    }
  } catch (err) {
    console.warn('Legacy employee migration check skipped:', err);
  }
};

export const calculateEmployeeMonthlyPayroll = (
  emp: HREmployee,
  month: string, // YYYY-MM
  context: {
    coaches: Coach[];
    members: Member[];
    bookings: Booking[];
    physioBookings: any[];
    therapists: any[];
    attendances: any[];
    leaves: any[];
  }
): PayrollBreakdown => {
  const baseSalary = Number(emp.salary ?? emp.baseSalary ?? 0);
  const empNameLower = (emp.name || '').trim().toLowerCase();

  // 1. Gym Coach Commission
  const linkedCoach = context.coaches.find(
    c => (emp.linkedCoachId && c.id === emp.linkedCoachId) ||
         `${c.firstName} ${c.lastName}`.trim().toLowerCase() === empNameLower
  );

  let gymSessionsCount = 0;
  if (linkedCoach) {
    const coachFullNameLower = `${linkedCoach.firstName} ${linkedCoach.lastName}`.trim().toLowerCase();
    const seenSessionKeys = new Set<string>();

    // Check coach's own checkIns array
    (linkedCoach.checkIns || []).forEach(ci => {
      if (ci.timestamp && ci.timestamp.startsWith(month)) {
        seenSessionKeys.add(ci.id || ci.timestamp);
      }
    });

    // Check member checkIns assigned to this coach
    context.members.forEach(m => {
      (m.checkIns || []).forEach(ci => {
        if (ci.date && ci.date.startsWith(month)) {
          const matchesCoach =
            (ci.coachId && ci.coachId === linkedCoach.id) ||
            (ci.coach && ci.coach.trim().toLowerCase() === coachFullNameLower);
          if (matchesCoach) {
            seenSessionKeys.add(ci.id || `${m.id}_${ci.date}`);
          }
        }
      });
    });

    gymSessionsCount = seenSessionKeys.size;
  }

  const gymRate = emp.commissionRatePerSession || linkedCoach?.hourRate || 0;
  const gymCommission = Number((gymSessionsCount * gymRate).toFixed(2));

  // 2. Court Reservations Commission ('private' & 'hustle' cashed-in sessions)
  let courtSessionsCount = 0;
  let courtRevenue = 0;
  context.bookings.forEach(b => {
    if (!b.date || !b.date.startsWith(month)) return;
    if (b.status !== 'cashed-in' && b.status !== 'cashed_in') return;
    if (b.category !== 'private' && b.category !== 'hustle') return;

    const bNameLower = (b.name || '').toLowerCase();
    const isCoachMatch =
      (empNameLower && bNameLower.includes(empNameLower)) ||
      (linkedCoach && bNameLower.includes(linkedCoach.firstName.toLowerCase()));

    if (isCoachMatch) {
      courtSessionsCount++;
      courtRevenue += Number(b.price ?? b.rateApplied ?? 0);
    }
  });

  const courtCommission = Number(
    (
      courtSessionsCount * (emp.commissionRatePerSession || 0) +
      courtRevenue * ((emp.commissionPercent || 0) / 100)
    ).toFixed(2)
  );

  // 3. Physiotherapy Commission ('physioBookings')
  const linkedTherapist = context.therapists.find(
    t => (emp.linkedTherapistId && t.id === emp.linkedTherapistId) ||
         `${t.firstName} ${t.lastName}`.trim().toLowerCase() === empNameLower ||
         `dr. ${t.firstName} ${t.lastName}`.trim().toLowerCase() === empNameLower
  );

  let physioSessionsCount = 0;
  let physioRevenue = 0;
  if (linkedTherapist) {
    context.physioBookings.forEach(pb => {
      if (!pb.date || !pb.date.startsWith(month)) return;
      if (pb.therapistId !== linkedTherapist.id) return;
      if (pb.status === 'completed' || pb.paymentStatus === 'paid') {
        physioSessionsCount++;
        physioRevenue += Number(pb.amountPaid ?? pb.cost ?? 0);
      }
    });
  }

  const physioSessionFee = emp.commissionRatePerSession || linkedTherapist?.feePerSession || 0;
  const physioCommission = Number(
    (
      physioSessionsCount * physioSessionFee +
      physioRevenue * ((emp.commissionPercent || 0) / 100)
    ).toFixed(2)
  );

  const totalCommissions = Number((gymCommission + courtCommission + physioCommission).toFixed(2));

  // 4. Attendance Overtime ('staff_attendance')
  let overtimeHours = 0;
  const empAttendances = context.attendances
    .filter(a => {
      if (a.employeeId !== emp.id) return false;
      const dStr = a.dateStr || (a.timestamp?.seconds ? new Date(a.timestamp.seconds * 1000).toISOString().split('T')[0] : '');
      return dStr.startsWith(month);
    })
    .sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

  let openOvertimeStart: number | null = null;
  empAttendances.forEach(a => {
    if (typeof a.overtimeHours === 'number' && a.overtimeHours > 0) {
      overtimeHours += a.overtimeHours;
    }
    if (a.type === 'overtime_start' && a.timestamp?.seconds) {
      openOvertimeStart = a.timestamp.seconds;
    } else if (a.type === 'overtime_end' && a.timestamp?.seconds && openOvertimeStart) {
      const diffHours = Math.max(0, (a.timestamp.seconds - openOvertimeStart) / 3600);
      overtimeHours += diffHours;
      openOvertimeStart = null;
    }
  });
  overtimeHours = Number(overtimeHours.toFixed(2));

  const hourlyOvertimeRate = Number(emp.hourlyOvertimeRate ?? Number(((baseSalary / 160) * 1.5).toFixed(2)));
  const overtimePay = Number((overtimeHours * hourlyOvertimeRate).toFixed(2));

  // 5. Unpaid Leave Deductions ('staff_leaves')
  const [yearNum, monthNum] = month.split('-').map(Number);
  const monthStart = new Date(yearNum, (monthNum || 1) - 1, 1);
  const monthEnd = new Date(yearNum, monthNum || 1, 0);
  const monthStartStr = monthStart.toISOString().split('T')[0];
  const monthEndStr = monthEnd.toISOString().split('T')[0];

  let unpaidLeaveDays = 0;
  context.leaves.forEach(lv => {
    if (lv.employeeId !== emp.id) return;
    if (lv.status !== 'approved' || lv.type !== 'unpaid') return;
    if (!lv.startDate || !lv.endDate) return;
    if (lv.startDate > monthEndStr || lv.endDate < monthStartStr) return;

    const s = new Date(Math.max(new Date(lv.startDate).getTime(), monthStart.getTime()));
    const e = new Date(Math.min(new Date(lv.endDate).getTime(), monthEnd.getTime()));
    const days = Math.ceil(Math.abs(e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (days > 0) unpaidLeaveDays += days;
  });

  const dailyRate = baseSalary / 30;
  const unpaidLeaveDeduction = Number((unpaidLeaveDays * dailyRate).toFixed(2));

  // 6. Adjustments & Statutory NSSF
  const bonuses = Number(emp.bonuses || 0);
  const manualDeductions = Number(emp.deductions || 0);
  const advancesRecovery = Number(emp.advances || 0);
  const nssfContribution = Number(emp.nssfContribution || 0);

  const grossPay = Number((baseSalary + totalCommissions + overtimePay + bonuses).toFixed(2));
  const totalDeductions = Number((unpaidLeaveDeduction + manualDeductions + advancesRecovery + nssfContribution).toFixed(2));
  const netPay = Math.max(0, Number((grossPay - totalDeductions).toFixed(2)));

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    role: emp.role,
    department: emp.department,
    month,
    baseSalary,
    gymSessionsCount,
    gymCommission,
    courtSessionsCount,
    courtCommission,
    physioSessionsCount,
    physioCommission,
    totalCommissions,
    overtimeHours,
    hourlyOvertimeRate,
    overtimePay,
    bonuses,
    unpaidLeaveDays,
    unpaidLeaveDeduction,
    manualDeductions,
    advancesRecovery,
    nssfContribution,
    grossPay,
    totalDeductions,
    netPay
  };
};

export const executeEmployeePayrollRun = async (
  breakdown: PayrollBreakdown,
  cashierId: string,
  payImmediately: boolean = true,
  paymentMethod: 'cash' | 'bank_transfer' = 'cash'
) => {
  // 1. Create Payroll Record in 'payrolls'
  const payrollDocRef = await addDoc(collection(db, 'payrolls'), {
    ...breakdown,
    bonus: breakdown.bonuses,
    deduction: breakdown.totalDeductions,
    netAmount: breakdown.netPay,
    status: payImmediately ? 'paid' : 'pending',
    paymentMethod: payImmediately ? paymentMethod : 'accrued',
    date: new Date().toISOString(),
    uid: cashierId
  });

  // 2. Post Net Salary Payout / Accrual to Both Real-Time ('transactions') & Posting Mode ('advanced_transactions') via processLedgerTransaction
  if (breakdown.netPay > 0) {
    const creditAccount = payImmediately
      ? (paymentMethod === 'cash' ? '531 - Cash Drawer / Register (Caisse)' : '512 - Bank Accounts (Fresh USD / LBP)')
      : '421 - Personnel — Salaries Payable';
    await processLedgerTransaction({
      amount: breakdown.netPay,
      subtotal: breakdown.grossPay,
      discount: breakdown.totalDeductions,
      paymentMethod: payImmediately ? paymentMethod : 'system',
      memberId: breakdown.employeeId,
      sourceModule: 'payroll',
      cashierId,
      transactionType: payImmediately ? 'payroll_payout' : 'payroll_accrual',
      direction: payImmediately ? 'outflow' : 'audit',
      sourceAccount: '641 - Salaries & Wages Expense',
      destinationAccount: creditAccount,
      referenceId: payrollDocRef.id,
      relatedIds: [breakdown.employeeId],
      notes: `Payroll (${breakdown.month}) for ${breakdown.employeeName} — Gross: $${breakdown.grossPay.toFixed(2)}, Net: $${breakdown.netPay.toFixed(2)}`
    });
  }

  // 3. Post NSSF Liability Entry if NSSF > 0
  if (breakdown.nssfContribution > 0) {
    await processLedgerTransaction({
      amount: breakdown.nssfContribution,
      paymentMethod: 'system',
      memberId: breakdown.employeeId,
      sourceModule: 'payroll',
      cashierId,
      transactionType: 'nssf_payable',
      direction: 'audit',
      sourceAccount: '645 - NSSF Employer Contributions',
      destinationAccount: '431 - Social Security (NSSF / CNSS)',
      referenceId: payrollDocRef.id,
      relatedIds: [breakdown.employeeId],
      notes: `Lebanese NSSF Contribution (${breakdown.month}) for ${breakdown.employeeName}`
    });
  }

  // 4. Post Advance Recovery Entry if Advances > 0
  if (breakdown.advancesRecovery > 0) {
    await processLedgerTransaction({
      amount: breakdown.advancesRecovery,
      paymentMethod: 'system',
      memberId: breakdown.employeeId,
      sourceModule: 'payroll',
      cashierId,
      transactionType: 'advances_recovery',
      direction: 'audit',
      sourceAccount: '421 - Personnel — Salaries Payable',
      destinationAccount: '4211 - Staff Advances & Loans',
      referenceId: payrollDocRef.id,
      relatedIds: [breakdown.employeeId],
      notes: `Salary Advance Recovery (${breakdown.month}) for ${breakdown.employeeName}`
    });
  }

  // 5. Update employee document on 'hr_employees' (mark month paid and reset cycle advances/bonuses/deductions)
  await updateDoc(doc(db, 'hr_employees', breakdown.employeeId), {
    lastPayrollPaidMonth: breakdown.month,
    advances: 0,
    bonuses: 0,
    deductions: 0
  });

  if (payImmediately && breakdown.netPay > 0) {
    await addDoc(collection(db, 'staff_payments'), {
      employeeId: breakdown.employeeId,
      employeeName: breakdown.employeeName,
      amount: breakdown.netPay,
      type: 'payment',
      date: new Date().toISOString().split('T')[0],
      notes: `Payroll Settlement (${breakdown.month})`,
      payrollId: payrollDocRef.id,
      createdAt: new Date().toISOString()
    });
  }

  return payrollDocRef.id;
};

export const generatePayslipPDF = (
  breakdown: PayrollBreakdown,
  systemName: string,
  usdToLbpRate: number
) => {
  const pdf = new jsPDF();
  const rate = usdToLbpRate || 89500;

  pdf.setFillColor(11, 15, 23);
  pdf.rect(0, 0, 210, 38, 'F');
  pdf.setFillColor(0, 184, 200);
  pdf.rect(0, 38, 210, 1.5, 'F');

  pdf.setFontSize(16);
  pdf.setTextColor(255, 255, 255);
  pdf.text(`${systemName || 'Vescio Nexus'} — Official Employee Payslip`, 14, 14);
  pdf.setFontSize(9);
  pdf.setTextColor(0, 184, 200);
  pdf.text(`Pay Period: ${breakdown.month} | Generated: ${new Date().toLocaleDateString()}`, 14, 21);
  pdf.setTextColor(212, 212, 216);
  pdf.text(`Employee: ${breakdown.employeeName} (${breakdown.role} • ${breakdown.department})`, 14, 27);
  pdf.text(`Exchange Rate: 1 USD = ${rate.toLocaleString()} LBP`, 14, 33);

  const toLBP = (usd: number) => `${Math.round(usd * rate).toLocaleString()} LBP`;

  autoTable(pdf, {
    startY: 45,
    head: [['Earnings & Commissions', 'Details', 'Amount (USD)', 'Amount (LBP)']],
    body: [
      ['Base Monthly Salary', 'Standard Contract', `$${breakdown.baseSalary.toFixed(2)}`, toLBP(breakdown.baseSalary)],
      ['Gym Coaching Commission', `${breakdown.gymSessionsCount} sessions`, `+$${breakdown.gymCommission.toFixed(2)}`, toLBP(breakdown.gymCommission)],
      ['Court Private/Hustle Commission', `${breakdown.courtSessionsCount} sessions`, `+$${breakdown.courtCommission.toFixed(2)}`, toLBP(breakdown.courtCommission)],
      ['Physiotherapy Commission', `${breakdown.physioSessionsCount} sessions`, `+$${breakdown.physioCommission.toFixed(2)}`, toLBP(breakdown.physioCommission)],
      ['Overtime Pay', `${breakdown.overtimeHours} hrs @ $${breakdown.hourlyOvertimeRate.toFixed(2)}/hr`, `+$${breakdown.overtimePay.toFixed(2)}`, toLBP(breakdown.overtimePay)],
      ['Cycle Bonuses / Incentives', 'Performance Bonus', `+$${breakdown.bonuses.toFixed(2)}`, toLBP(breakdown.bonuses)],
      ['GROSS EARNINGS', '', `$${breakdown.grossPay.toFixed(2)}`, toLBP(breakdown.grossPay)]
    ],
    theme: 'grid',
    headStyles: { fillColor: [0, 184, 200], textColor: [11, 15, 23], fontStyle: 'bold' },
    styles: { fontSize: 9 }
  });

  const nextY = (pdf as any).lastAutoTable.finalY + 8;

  autoTable(pdf, {
    startY: nextY,
    head: [['Deductions & Withholdings', 'Details', 'Amount (USD)', 'Amount (LBP)']],
    body: [
      ['Unpaid Leave Deduction', `${breakdown.unpaidLeaveDays} days`, `-$${breakdown.unpaidLeaveDeduction.toFixed(2)}`, toLBP(breakdown.unpaidLeaveDeduction)],
      ['Salary Advance Recovery', 'Prior Cash Advances', `-$${breakdown.advancesRecovery.toFixed(2)}`, toLBP(breakdown.advancesRecovery)],
      ['Lebanese NSSF Contribution', 'Statutory Social Security', `-$${breakdown.nssfContribution.toFixed(2)}`, toLBP(breakdown.nssfContribution)],
      ['Other Cycle Deductions', 'Penalties / Adjustments', `-$${breakdown.manualDeductions.toFixed(2)}`, toLBP(breakdown.manualDeductions)],
      ['TOTAL DEDUCTIONS', '', `-$${breakdown.totalDeductions.toFixed(2)}`, toLBP(breakdown.totalDeductions)]
    ],
    theme: 'grid',
    headStyles: { fillColor: [11, 15, 23], textColor: [255, 255, 255], fontStyle: 'bold' },
    styles: { fontSize: 9 }
  });

  const summaryY = (pdf as any).lastAutoTable.finalY + 12;
  pdf.setFontSize(13);
  pdf.setTextColor(11, 15, 23);
  pdf.text(
    `NET TAKE-HOME PAY: $${breakdown.netPay.toFixed(2)} USD  (${toLBP(breakdown.netPay)})`,
    14,
    summaryY
  );

  pdf.setFontSize(8);
  pdf.setTextColor(120, 120, 130);
  pdf.text('Generated by Vescio Nexus ERP', 14, 288);

  pdf.save(`payslip_${breakdown.employeeName.replace(/\s+/g, '_').toLowerCase()}_${breakdown.month}.pdf`);
};
