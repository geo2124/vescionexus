import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, Plus, DollarSign, Calendar, CheckCircle2, Clock,
  FileText, Download, Sparkles, Edit3, AlertCircle
} from 'lucide-react';
import { collection, onSnapshot, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { HREmployee, Coach, Member, Booking } from '../../types';
import { processLedgerTransaction } from '../../lib/transaction-engine';
import {
  normalizeHREmployee,
  migrateLegacyEmployeesToHR,
  calculateEmployeeMonthlyPayroll,
  executeEmployeePayrollRun,
  generatePayslipPDF,
  PayrollBreakdown
} from '../../lib/payroll-engine';

export function PayrollModule() {
  const { user, globalSettings } = useFirebase();
  const [employees, setEmployees] = useState<HREmployee[]>([]);
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [physioBookings, setPhysioBookings] = useState<any[]>([]);
  const [therapists, setTherapists] = useState<any[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);

  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [payImmediately, setPayImmediately] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer'>('cash');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showAddEmpModal, setShowAddEmpModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<HREmployee | null>(null);
  const [empForm, setEmpForm] = useState({
    name: '',
    role: '',
    department: 'General',
    salary: '',
    hourlyOvertimeRate: '',
    nssfContribution: '',
    commissionRatePerSession: '',
    commissionPercent: '',
    advances: '',
    bonuses: '',
    deductions: ''
  });

  useEffect(() => {
    if (!user) return;

    migrateLegacyEmployeesToHR(user.uid);

    const unsubEmp = onSnapshot(collection(db, 'hr_employees'), (snap) => {
      setEmployees(snap.docs.map(d => normalizeHREmployee(d.id, d.data())));
    });
    const unsubPay = onSnapshot(collection(db, 'payrolls'), (snap) => {
      setPayrolls(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubCoaches = onSnapshot(collection(db, 'coaches'), (snap) => {
      setCoaches(snap.docs.map(d => ({ id: d.id, ...d.data() } as Coach)));
    });
    const unsubMembers = onSnapshot(collection(db, 'members'), (snap) => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Member)));
    });
    const unsubBookings = onSnapshot(collection(db, 'bookings'), (snap) => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() } as Booking)));
    });
    const unsubPhysioBookings = onSnapshot(collection(db, 'physioBookings'), (snap) => {
      setPhysioBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubTherapists = onSnapshot(collection(db, 'physiotherapists'), (snap) => {
      setTherapists(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubAtt = onSnapshot(collection(db, 'staff_attendance'), (snap) => {
      setAttendances(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubLeaves = onSnapshot(collection(db, 'staff_leaves'), (snap) => {
      setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubEmp();
      unsubPay();
      unsubCoaches();
      unsubMembers();
      unsubBookings();
      unsubPhysioBookings();
      unsubTherapists();
      unsubAtt();
      unsubLeaves();
    };
  }, [user]);

  const monthlyBreakdowns = useMemo(() => {
    const context = {
      coaches,
      members,
      bookings,
      physioBookings,
      therapists,
      attendances,
      leaves
    };
    const map: Record<string, PayrollBreakdown> = {};
    employees.forEach(emp => {
      map[emp.id] = calculateEmployeeMonthlyPayroll(emp, selectedMonth, context);
    });
    return map;
  }, [employees, selectedMonth, coaches, members, bookings, physioBookings, therapists, attendances, leaves]);

  const openNewEmployeeModal = () => {
    setEditingEmployee(null);
    setEmpForm({
      name: '',
      role: '',
      department: 'General',
      salary: '',
      hourlyOvertimeRate: '',
      nssfContribution: '',
      commissionRatePerSession: '',
      commissionPercent: '',
      advances: '0',
      bonuses: '0',
      deductions: '0'
    });
    setShowAddEmpModal(true);
  };

  const openEditModal = (emp: HREmployee) => {
    setEditingEmployee(emp);
    setEmpForm({
      name: emp.name,
      role: emp.role,
      department: emp.department || 'General',
      salary: String(emp.salary ?? 0),
      hourlyOvertimeRate: String(emp.hourlyOvertimeRate ?? 0),
      nssfContribution: String(emp.nssfContribution ?? 0),
      commissionRatePerSession: String(emp.commissionRatePerSession ?? 0),
      commissionPercent: String(emp.commissionPercent ?? 0),
      advances: String(emp.advances ?? 0),
      bonuses: String(emp.bonuses ?? 0),
      deductions: String(emp.deductions ?? 0)
    });
    setShowAddEmpModal(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      const salaryVal = Number(empForm.salary || 0);
      const defaultOT = Number(((salaryVal / 160) * 1.5).toFixed(2));
      const payload = {
        name: empForm.name,
        role: empForm.role,
        department: empForm.department || 'General',
        salary: salaryVal,
        baseSalary: salaryVal,
        hourlyOvertimeRate: Number(empForm.hourlyOvertimeRate || defaultOT),
        nssfContribution: Number(empForm.nssfContribution || 0),
        commissionRatePerSession: Number(empForm.commissionRatePerSession || 0),
        commissionPercent: Number(empForm.commissionPercent || 0),
        advances: Number(empForm.advances || 0),
        bonuses: Number(empForm.bonuses || 0),
        deductions: Number(empForm.deductions || 0),
        status: editingEmployee?.status || 'active',
        joinDate: editingEmployee?.joinDate || new Date().toISOString().split('T')[0],
        uid: user.uid
      };

      if (editingEmployee) {
        await updateDoc(doc(db, 'hr_employees', editingEmployee.id), payload);
        setBanner({ type: 'success', text: `Updated ${empForm.name} in unified hr_employees.` });
      } else {
        await addDoc(collection(db, 'hr_employees'), {
          ...payload,
          createdAt: new Date().toISOString()
        });
        setBanner({ type: 'success', text: `Added ${empForm.name} to unified hr_employees.` });
      }
      setShowAddEmpModal(false);
    } catch (error) {
      console.error('Error saving employee:', error);
      setBanner({ type: 'error', text: 'Failed to save employee.' });
    }
  };

  const handleExecuteEmployeePayroll = async (emp: HREmployee) => {
    if (!user) return;
    const b = monthlyBreakdowns[emp.id];
    if (!b) return;
    setRunningId(emp.id);
    try {
      await executeEmployeePayrollRun(b, user.uid, payImmediately, paymentMethod);
      setBanner({
        type: 'success',
        text: `Payroll executed for ${emp.name} ($${b.netPay.toFixed(2)} synced to Real-Time & Posting ledgers).`
      });
    } catch (err) {
      console.error('Error executing payroll:', err);
      setBanner({ type: 'error', text: 'Failed to execute payroll.' });
    } finally {
      setRunningId(null);
    }
  };

  const handleBatchExecute = async () => {
    if (!user) return;
    const pendingList = employees.filter(
      e => e.status === 'active' && e.lastPayrollPaidMonth !== selectedMonth
    );
    if (pendingList.length === 0) {
      setBanner({ type: 'error', text: `All active employees already paid for ${selectedMonth}.` });
      return;
    }
    setRunningId('batch');
    try {
      for (const emp of pendingList) {
        const b = monthlyBreakdowns[emp.id];
        if (b) {
          await executeEmployeePayrollRun(b, user.uid, payImmediately, paymentMethod);
        }
      }
      setBanner({
        type: 'success',
        text: `Batch executed ${selectedMonth} payroll for ${pendingList.length} employees.`
      });
    } catch (err) {
      console.error('Batch payroll error:', err);
      setBanner({ type: 'error', text: 'Failed during batch payroll run.' });
    } finally {
      setRunningId(null);
    }
  };

  const handleSettlePendingPayroll = async (pr: any) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'payrolls', pr.id), {
        status: 'paid',
        paymentMethod
      });
      const netVal = Number(pr.netPay ?? pr.netAmount ?? 0);
      if (netVal > 0) {
        await processLedgerTransaction({
          amount: netVal,
          paymentMethod,
          memberId: pr.employeeId,
          sourceModule: 'payroll',
          cashierId: user.uid,
          transactionType: 'payroll_settlement',
          direction: 'outflow',
          sourceAccount: '421 - Personnel — Salaries Payable',
          destinationAccount: paymentMethod === 'cash'
            ? '531 - Cash Drawer / Register (Caisse)'
            : '512 - Bank Accounts (Fresh USD / LBP)',
          referenceId: pr.id,
          relatedIds: [pr.employeeId],
          notes: `Settled Accrued Payroll (${pr.month || ''}) for ${pr.employeeName}`
        });
      }
      setBanner({ type: 'success', text: `Settled pending payroll for ${pr.employeeName}.` });
    } catch (err) {
      console.error('Error settling payroll:', err);
    }
  };

  const activeEmps = employees.filter(e => e.status === 'active');
  const totalBase = activeEmps.reduce((s, e) => s + Number(e.salary ?? 0), 0);
  const totalCommissions = activeEmps.reduce((s, e) => s + (monthlyBreakdowns[e.id]?.totalCommissions || 0), 0);
  const totalNSSFAndDeductions = activeEmps.reduce((s, e) => s + (monthlyBreakdowns[e.id]?.totalDeductions || 0), 0);
  const totalNet = activeEmps.reduce((s, e) => s + (monthlyBreakdowns[e.id]?.netPay || 0), 0);
  const lbpRate = globalSettings?.usdToLbpRate || 89500;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
            Unified Payroll, NSSF & Commission Accounting (`hr_employees`)
          </h2>
          <p className="text-xs text-zinc-400">
            Synchronized with HR Management, Gym Coaching, Court Private/Hustle Sessions & Physiotherapy
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
          />
          <select
            value={payImmediately ? 'paid' : 'accrued'}
            onChange={e => setPayImmediately(e.target.value === 'paid')}
            className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
          >
            <option value="paid">Immediate Payout (Outflow)</option>
            <option value="accrued">Accrue to Salaries Payable</option>
          </select>
          <select
            value={paymentMethod}
            onChange={e => setPaymentMethod(e.target.value as any)}
            className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
          >
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
          <button
            onClick={openNewEmployeeModal}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-900 dark:text-white text-xs font-bold border border-slate-200 dark:border-white/10 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Employee</span>
          </button>
          <button
            onClick={handleBatchExecute}
            disabled={runningId !== null}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] disabled:opacity-50 text-slate-950 text-xs font-bold shadow-sm shadow-cyan-500/20 transition-colors"
          >
            <DollarSign className="w-4 h-4" />
            <span>{runningId === 'batch' ? 'Running Batch...' : `Batch Run (${selectedMonth})`}</span>
          </button>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-bold ${
            banner.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="underline">Dismiss</button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Base Monthly Salaries</span>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">${totalBase.toLocaleString()}</div>
          <p className="text-xs text-zinc-500 mt-1">{activeEmps.length} active employees</p>
        </div>
        <div className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Cross-Module Commissions</span>
          <div className="text-2xl font-black text-[#00B8C8] mt-1">+${totalCommissions.toLocaleString()}</div>
          <p className="text-xs text-zinc-500 mt-1">Gym + Courts + Physio ({selectedMonth})</p>
        </div>
        <div className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">NSSF, Advances & Unpaid Leave</span>
          <div className="text-2xl font-black text-rose-400 mt-1">-${totalNSSFAndDeductions.toLocaleString()}</div>
          <p className="text-xs text-zinc-500 mt-1">Total cycle withholdings</p>
        </div>
        <div className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Net Payroll Liability</span>
          <div className="text-2xl font-black text-emerald-400 mt-1">${totalNet.toLocaleString()}</div>
          <p className="text-xs text-zinc-500 mt-1">{Math.round(totalNet * lbpRate).toLocaleString()} LBP</p>
        </div>
      </div>

      {/* Employee Breakdown Table */}
      <div className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
            Employee Payroll & Commission Breakdown ({selectedMonth})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-zinc-800 text-[11px] font-bold text-zinc-400 uppercase tracking-wider bg-slate-50 dark:bg-black/20">
                <th className="p-4">Employee</th>
                <th className="p-4">Base</th>
                <th className="p-4">Commissions</th>
                <th className="p-4">OT & Bonus</th>
                <th className="p-4">NSSF / Adv / Unpaid</th>
                <th className="p-4">Net Pay</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-zinc-800 text-sm">
              {employees.map(emp => {
                const b = monthlyBreakdowns[emp.id];
                if (!b) return null;
                const isPaid = emp.lastPayrollPaidMonth === selectedMonth;
                return (
                  <tr key={emp.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                    <td className="p-4">
                      <div className="font-bold text-slate-900 dark:text-white">{emp.name}</div>
                      <div className="text-xs text-zinc-500">{emp.role} • {emp.department}</div>
                    </td>
                    <td className="p-4 font-semibold text-slate-900 dark:text-white">${b.baseSalary.toFixed(2)}</td>
                    <td className="p-4">
                      <div className="font-bold text-[#0099A8] dark:text-[#00B8C8]">+${b.totalCommissions.toFixed(2)}</div>
                      <div className="text-[11px] text-zinc-500">
                        G:{b.gymSessionsCount} C:{b.courtSessionsCount} P:{b.physioSessionsCount}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-emerald-500 dark:text-emerald-400">+${(b.overtimePay + b.bonuses).toFixed(2)}</div>
                      <div className="text-[11px] text-zinc-500">{b.overtimeHours}h OT</div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-rose-500 dark:text-rose-400">-${b.totalDeductions.toFixed(2)}</div>
                      <div className="text-[11px] text-zinc-500">
                        NSSF: ${b.nssfContribution} • Adv: ${b.advancesRecovery}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="font-black text-slate-900 dark:text-white">${b.netPay.toFixed(2)}</div>
                      <div className="text-[11px] text-zinc-500">{Math.round(b.netPay * lbpRate).toLocaleString()} LBP</div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => openEditModal(emp)}
                          className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-zinc-300"
                          title="Edit Compensation / Adjustments"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => generatePayslipPDF(b, globalSettings?.systemName || 'Vescio Nexus', lbpRate)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-zinc-200 text-xs font-bold flex items-center space-x-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>
                        {isPaid ? (
                          <span className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 text-xs font-bold">
                            Paid
                          </span>
                        ) : (
                          <button
                            onClick={() => handleExecuteEmployeePayroll(emp)}
                            disabled={runningId !== null}
                            className="px-3 py-1.5 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-bold transition-colors"
                          >
                            {runningId === emp.id ? '...' : 'Run'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payroll History Table */}
      <div className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-zinc-800">
          <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Historical Payroll Ledger (`payrolls`)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-zinc-800 text-[11px] font-bold text-zinc-400 uppercase tracking-wider bg-slate-50 dark:bg-black/20">
                <th className="p-4">Date / Period</th>
                <th className="p-4">Employee</th>
                <th className="p-4">Gross Earnings</th>
                <th className="p-4">Deductions</th>
                <th className="p-4">Net Pay</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-zinc-800 text-sm">
              {payrolls
                .slice()
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map(pr => (
                  <tr key={pr.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                    <td className="p-4 text-zinc-400">
                      {pr.month || pr.date?.slice(0, 7)} <span className="text-xs block">{new Date(pr.date).toLocaleDateString()}</span>
                    </td>
                    <td className="p-4 font-bold text-slate-900 dark:text-white">{pr.employeeName}</td>
                    <td className="p-4 text-emerald-500 dark:text-emerald-400">${Number(pr.grossPay ?? pr.baseSalary ?? 0).toFixed(2)}</td>
                    <td className="p-4 text-rose-500 dark:text-rose-400">-${Number(pr.totalDeductions ?? pr.deduction ?? 0).toFixed(2)}</td>
                    <td className="p-4 font-black text-slate-900 dark:text-white">${Number(pr.netPay ?? pr.netAmount ?? 0).toFixed(2)}</td>
                    <td className="p-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          pr.status === 'paid' ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-500 dark:text-amber-400'
                        }`}
                      >
                        {pr.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        {pr.status === 'pending' && (
                          <button
                            onClick={() => handleSettlePendingPayroll(pr)}
                            className="px-3 py-1 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-bold transition-colors"
                          >
                            Mark Paid
                          </button>
                        )}
                        {pr.grossPay !== undefined && (
                          <button
                            onClick={() => generatePayslipPDF(pr as PayrollBreakdown, globalSettings?.systemName || 'Vescio Nexus', lbpRate)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-zinc-300 text-xs font-bold flex items-center space-x-1"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Payslip</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Employee Modal */}
      {showAddEmpModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#101622] border border-slate-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase">
              {editingEmployee ? `Edit ${editingEmployee.name}` : 'Add Employee to hr_employees'}
            </h3>
            <form onSubmit={handleSaveEmployee} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={empForm.name}
                    onChange={e => setEmpForm({ ...empForm, name: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Role *</label>
                  <input
                    type="text"
                    required
                    value={empForm.role}
                    onChange={e => setEmpForm({ ...empForm, role: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Base Salary ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={empForm.salary}
                    onChange={e => setEmpForm({ ...empForm, salary: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">NSSF Contribution ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={empForm.nssfContribution}
                    onChange={e => setEmpForm({ ...empForm, nssfContribution: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Commission ($ / Session)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={empForm.commissionRatePerSession}
                    onChange={e => setEmpForm({ ...empForm, commissionRatePerSession: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Commission (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={empForm.commissionPercent}
                    onChange={e => setEmpForm({ ...empForm, commissionPercent: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Cycle Advances ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={empForm.advances}
                    onChange={e => setEmpForm({ ...empForm, advances: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Cycle Bonuses ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={empForm.bonuses}
                    onChange={e => setEmpForm({ ...empForm, bonuses: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[#00B8C8] outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddEmpModal(false)}
                  className="px-4 py-2 rounded-xl text-sm text-zinc-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 transition-colors"
                >
                  Save Employee
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default PayrollModule;
