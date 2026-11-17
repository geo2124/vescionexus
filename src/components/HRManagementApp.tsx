import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, UserPlus, DollarSign, Calendar, Clock, Award, Briefcase,
  Search, Edit3, Trash2, CheckCircle, AlertCircle, TrendingUp,
  FileText, ArrowUpRight, ArrowDownRight, Shield, Building2, Download, Sparkles, Home
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { HREmployee, Coach, Member, Booking } from '../types';
import { processLedgerTransaction } from '../lib/transaction-engine';
import {
  normalizeHREmployee,
  migrateLegacyEmployeesToHR,
  calculateEmployeeMonthlyPayroll,
  executeEmployeePayrollRun,
  generatePayslipPDF,
  PayrollBreakdown
} from '../lib/payroll-engine';
import { AttendanceModule } from './hr/AttendanceModule';
import { LeavesModule } from './hr/LeavesModule';
import { DepartmentsManager } from './hr/DepartmentsManager';
import { TenantBrandLockup } from './VescioNexusLogo';

interface StaffPayment {
  id: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  type: 'payment' | 'advance' | 'bonus' | 'deduction';
  date: string;
  notes: string;
  createdAt: string;
}

export function HRManagementApp() {
  const navigate = useNavigate();
  const { user, globalSettings } = useFirebase();
  const [activeTab, setActiveTab] = useState<'directory' | 'payroll' | 'attendance' | 'leaves' | 'departments'>('directory');

  const [employees, setEmployees] = useState<HREmployee[]>([]);
  const [payments, setPayments] = useState<StaffPayment[]>([]);
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [physioBookings, setPhysioBookings] = useState<any[]>([]);
  const [therapists, setTherapists] = useState<any[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');

  // Employee Create/Edit Modal State
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<HREmployee | null>(null);
  const [empForm, setEmpForm] = useState({
    name: '',
    role: '',
    department: 'General',
    email: '',
    phone: '',
    salary: 0,
    hourlyOvertimeRate: 0,
    nssfContribution: 0,
    commissionRatePerSession: 0,
    commissionPercent: 0,
    linkedCoachId: '',
    linkedTherapistId: '',
    joinDate: new Date().toISOString().split('T')[0],
    status: 'active' as 'active' | 'on_leave' | 'terminated',
    advances: 0,
    bonuses: 0,
    deductions: 0
  });

  // Quick Adjustment / Advance Modal State
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({
    employeeId: '',
    amount: 0,
    type: 'advance' as 'advance' | 'bonus' | 'deduction',
    paymentMethod: 'cash' as 'cash' | 'bank_transfer',
    date: new Date().toISOString().split('T')[0],
    notes: ''
  });

  // Payroll Run Options
  const [payImmediately, setPayImmediately] = useState(true);
  const [payrollPaymentMethod, setPayrollPaymentMethod] = useState<'cash' | 'bank_transfer'>('cash');
  const [runningPayrollId, setRunningPayrollId] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!user) return;

    migrateLegacyEmployeesToHR(user.uid);

    const unsubHR = onSnapshot(collection(db, 'hr_employees'), (snap) => {
      const list = snap.docs.map(d => normalizeHREmployee(d.id, d.data()));
      setEmployees(list);
      setLoading(false);
    });

    const unsubPayments = onSnapshot(collection(db, 'staff_payments'), (snap) => {
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() } as StaffPayment)));
    });

    const unsubPayrolls = onSnapshot(collection(db, 'payrolls'), (snap) => {
      setPayrolls(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubDepts = onSnapshot(collection(db, 'staff_departments'), (snap) => {
      setDepartments(snap.docs.map(d => ({ id: d.id, name: d.data().name })));
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

    const unsubAttendance = onSnapshot(collection(db, 'staff_attendance'), (snap) => {
      setAttendances(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubLeaves = onSnapshot(collection(db, 'staff_leaves'), (snap) => {
      setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubHR();
      unsubPayments();
      unsubPayrolls();
      unsubDepts();
      unsubCoaches();
      unsubMembers();
      unsubBookings();
      unsubPhysioBookings();
      unsubTherapists();
      unsubAttendance();
      unsubLeaves();
    };
  }, [user]);

  const openAddEmployeeModal = () => {
    setEditingEmployee(null);
    setEmpForm({
      name: '',
      role: '',
      department: departments[0]?.name || 'General',
      email: '',
      phone: '',
      salary: 0,
      hourlyOvertimeRate: 0,
      nssfContribution: 0,
      commissionRatePerSession: 0,
      commissionPercent: 0,
      linkedCoachId: '',
      linkedTherapistId: '',
      joinDate: new Date().toISOString().split('T')[0],
      status: 'active',
      advances: 0,
      bonuses: 0,
      deductions: 0
    });
    setIsEmployeeModalOpen(true);
  };

  const openEditEmployeeModal = (emp: HREmployee) => {
    setEditingEmployee(emp);
    setEmpForm({
      name: emp.name,
      role: emp.role,
      department: emp.department || 'General',
      email: emp.email || '',
      phone: emp.phone || '',
      salary: Number(emp.salary ?? emp.baseSalary ?? 0),
      hourlyOvertimeRate: Number(emp.hourlyOvertimeRate ?? 0),
      nssfContribution: Number(emp.nssfContribution ?? 0),
      commissionRatePerSession: Number(emp.commissionRatePerSession ?? 0),
      commissionPercent: Number(emp.commissionPercent ?? 0),
      linkedCoachId: emp.linkedCoachId || '',
      linkedTherapistId: emp.linkedTherapistId || '',
      joinDate: emp.joinDate || new Date().toISOString().split('T')[0],
      status: emp.status || 'active',
      advances: Number(emp.advances ?? 0),
      bonuses: Number(emp.bonuses ?? 0),
      deductions: Number(emp.deductions ?? 0)
    });
    setIsEmployeeModalOpen(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      const salaryVal = Number(empForm.salary || 0);
      const defaultOT = Number(((salaryVal / 160) * 1.5).toFixed(2));
      const payload = {
        ...empForm,
        salary: salaryVal,
        baseSalary: salaryVal,
        hourlyOvertimeRate: Number(empForm.hourlyOvertimeRate || defaultOT),
        nssfContribution: Number(empForm.nssfContribution || 0),
        commissionRatePerSession: Number(empForm.commissionRatePerSession || 0),
        commissionPercent: Number(empForm.commissionPercent || 0),
        advances: Number(empForm.advances || 0),
        bonuses: Number(empForm.bonuses || 0),
        deductions: Number(empForm.deductions || 0),
        uid: user.uid
      };

      if (editingEmployee) {
        await updateDoc(doc(db, 'hr_employees', editingEmployee.id), payload);
        setStatusBanner({ type: 'success', message: `Updated ${empForm.name} in unified HR directory.` });
      } else {
        await addDoc(collection(db, 'hr_employees'), {
          ...payload,
          createdAt: new Date().toISOString()
        });
        setStatusBanner({ type: 'success', message: `Added ${empForm.name} to unified HR directory.` });
      }
      setIsEmployeeModalOpen(false);
      setEditingEmployee(null);
    } catch (error) {
      console.error('Error saving employee:', error);
      setStatusBanner({ type: 'error', message: 'Failed to save employee record.' });
    }
  };

  const handleDeleteEmployee = async (emp: HREmployee) => {
    try {
      await deleteDoc(doc(db, 'hr_employees', emp.id));
      setStatusBanner({ type: 'success', message: `Removed ${emp.name} from HR directory.` });
    } catch (err) {
      console.error('Error deleting employee:', err);
    }
  };

  const handleRecordAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !adjustmentForm.employeeId || adjustmentForm.amount <= 0) return;

    const emp = employees.find(x => x.id === adjustmentForm.employeeId);
    if (!emp) return;

    try {
      const amt = Number(adjustmentForm.amount);
      await addDoc(collection(db, 'staff_payments'), {
        employeeId: emp.id,
        employeeName: emp.name,
        amount: amt,
        type: adjustmentForm.type,
        date: adjustmentForm.date,
        notes: adjustmentForm.notes || `${adjustmentForm.type.toUpperCase()} adjustment`,
        createdAt: new Date().toISOString()
      });

      if (adjustmentForm.type === 'advance') {
        await updateDoc(doc(db, 'hr_employees', emp.id), {
          advances: Number(emp.advances || 0) + amt
        });

        await processLedgerTransaction({
          amount: amt,
          paymentMethod: adjustmentForm.paymentMethod,
          memberId: emp.id,
          sourceModule: 'payroll',
          cashierId: user.uid,
          transactionType: 'salary_advance',
          direction: 'outflow',
          sourceAccount: '4211 - Staff Advances & Loans',
          destinationAccount: adjustmentForm.paymentMethod === 'cash'
            ? '531 - Cash Drawer / Register (Caisse)'
            : '512 - Bank Accounts (Fresh USD / LBP)',
          referenceId: emp.id,
          relatedIds: [emp.id],
          notes: `Salary Advance issued to ${emp.name}: ${adjustmentForm.notes || 'Cash Advance'}`
        });
      } else if (adjustmentForm.type === 'bonus') {
        await updateDoc(doc(db, 'hr_employees', emp.id), {
          bonuses: Number(emp.bonuses || 0) + amt
        });
      } else if (adjustmentForm.type === 'deduction') {
        await updateDoc(doc(db, 'hr_employees', emp.id), {
          deductions: Number(emp.deductions || 0) + amt
        });
      }

      setStatusBanner({
        type: 'success',
        message: `Recorded $${amt.toFixed(2)} ${adjustmentForm.type} for ${emp.name}.`
      });
      setIsAdjustmentModalOpen(false);
      setAdjustmentForm({
        employeeId: '',
        amount: 0,
        type: 'advance',
        paymentMethod: 'cash',
        date: new Date().toISOString().split('T')[0],
        notes: ''
      });
    } catch (err) {
      console.error('Error recording adjustment:', err);
      setStatusBanner({ type: 'error', message: 'Failed to record adjustment.' });
    }
  };

  // Compute live monthly payroll breakdowns across all modules
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

  const handleRunSinglePayroll = async (emp: HREmployee) => {
    if (!user) return;
    const breakdown = monthlyBreakdowns[emp.id];
    if (!breakdown) return;

    setRunningPayrollId(emp.id);
    try {
      await executeEmployeePayrollRun(breakdown, user.uid, payImmediately, payrollPaymentMethod);
      setStatusBanner({
        type: 'success',
        message: `Executed ${selectedMonth} payroll for ${emp.name} ($${breakdown.netPay.toFixed(2)} Net Pay posted to Real-Time & Posting ledgers).`
      });
    } catch (err) {
      console.error('Error running payroll:', err);
      setStatusBanner({ type: 'error', message: `Failed to execute payroll for ${emp.name}.` });
    } finally {
      setRunningPayrollId(null);
    }
  };

  const handleRunBatchPayroll = async () => {
    if (!user) return;
    const unpaidActive = employees.filter(
      e => e.status === 'active' && e.lastPayrollPaidMonth !== selectedMonth
    );
    if (unpaidActive.length === 0) {
      setStatusBanner({ type: 'error', message: `All active employees have already been processed for ${selectedMonth}.` });
      return;
    }

    setRunningPayrollId('batch');
    try {
      for (const emp of unpaidActive) {
        const b = monthlyBreakdowns[emp.id];
        if (b) {
          await executeEmployeePayrollRun(b, user.uid, payImmediately, payrollPaymentMethod);
        }
      }
      setStatusBanner({
        type: 'success',
        message: `Batch executed ${selectedMonth} payroll for ${unpaidActive.length} employees.`
      });
    } catch (err) {
      console.error('Batch payroll error:', err);
      setStatusBanner({ type: 'error', message: 'Failed during batch payroll execution.' });
    } finally {
      setRunningPayrollId(null);
    }
  };

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch =
      (emp.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (emp.role?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (emp.email?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesDept = departmentFilter === 'All' || emp.department === departmentFilter;
    return matchesSearch && matchesDept;
  });

  const activeEmployees = employees.filter(e => e.status === 'active');
  const totalBasePayroll = activeEmployees.reduce((sum, e) => sum + Number(e.salary ?? e.baseSalary ?? 0), 0);
  const totalLiveCommissions = activeEmployees.reduce((sum, e) => sum + (monthlyBreakdowns[e.id]?.totalCommissions || 0), 0);
  const totalLiveNetPayroll = activeEmployees.reduce((sum, e) => sum + (monthlyBreakdowns[e.id]?.netPay || 0), 0);
  const totalOutstandingAdvances = employees.reduce((sum, e) => sum + Number(e.advances || 0), 0);
  const lbpRate = globalSettings?.usdToLbpRate || 89500;

  return (
    <div className="min-h-screen bg-[#05070A] text-zinc-100 font-sans selection:bg-[#00B8C8] selection:text-slate-950">
      {/* Sub-Navigation */}
      <div className="bg-[#0B0F17]/90 border-b border-zinc-800/80 px-8 py-4 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-40 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <TenantBrandLockup
            systemName={globalSettings?.systemName}
            systemLogo={globalSettings?.systemLogo}
            size="sm"
            subtitle="HR & Payroll"
          />
        </div>

        <div className="flex items-center space-x-2 bg-[#101622] p-1 rounded-xl border border-zinc-800">
          {[
            { id: 'directory', label: 'Staff Directory', icon: Users },
            { id: 'payroll', label: 'Payroll & Commissions', icon: DollarSign },
            { id: 'attendance', label: 'Attendance & Overtime', icon: Clock },
            { id: 'leaves', label: 'Leaves & Unpaid Days', icon: Calendar },
            { id: 'departments', label: 'Departments', icon: Building2 }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  activeTab === tab.id
                    ? 'bg-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <main className="p-8 max-w-7xl mx-auto space-y-8">
        {statusBanner && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between ${
              statusBanner.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}
          >
            <div className="flex items-center space-x-3 text-sm font-bold">
              {statusBanner.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              <span>{statusBanner.message}</span>
            </div>
            <button onClick={() => setStatusBanner(null)} className="text-xs underline opacity-75 hover:opacity-100">
              Dismiss
            </button>
          </div>
        )}

        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-[#111] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Active Staff (`hr_employees`)</span>
              <Users className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-3xl font-black text-white">{activeEmployees.length}</div>
            <p className="text-xs text-zinc-500 mt-1">Out of {employees.length} total records</p>
          </div>

          <div className="bg-[#111] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Base Monthly Salaries</span>
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-black text-white">${totalBasePayroll.toLocaleString()}</div>
            <p className="text-xs text-zinc-500 mt-1">
              {(totalBasePayroll * lbpRate).toLocaleString()} LBP
            </p>
          </div>

          <div className="bg-[#111] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                {selectedMonth} Synced Commissions
              </span>
              <Sparkles className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-3xl font-black text-purple-400">${totalLiveCommissions.toLocaleString()}</div>
            <p className="text-xs text-zinc-500 mt-1">Gym + Courts + Physiotherapy</p>
          </div>

          <div className="bg-[#111] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Projected Net Payroll ({selectedMonth})
              </span>
              <TrendingUp className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-3xl font-black text-amber-400">${totalLiveNetPayroll.toLocaleString()}</div>
            <p className="text-xs text-zinc-500 mt-1">
              Advances Recoverable: ${totalOutstandingAdvances.toLocaleString()}
            </p>
          </div>
        </div>

        {/* TAB 1: DIRECTORY */}
        {activeTab === 'directory' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111] p-4 rounded-2xl border border-white/5">
              <div className="flex items-center space-x-4 flex-1">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-5 h-5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search employees by name, role, or email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="All">All Departments</option>
                  <option value="General">General</option>
                  <option value="Gym">Gym</option>
                  <option value="Courts">Courts</option>
                  <option value="Physio">Physio</option>
                  <option value="Management">Management</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setIsAdjustmentModalOpen(true)}
                  className="flex items-center space-x-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>Issue Advance / Bonus</span>
                </button>
                  <button
                  onClick={openAddEmployeeModal}
                  className="flex items-center space-x-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Add Employee</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredEmployees.map(emp => {
                const b = monthlyBreakdowns[emp.id];
                const linkedCoach = coaches.find(c => c.id === emp.linkedCoachId);
                const linkedTherapist = therapists.find(t => t.id === emp.linkedTherapistId);

                return (
                  <div
                    key={emp.id}
                    className="bg-[#0B0F17]/90 border border-zinc-800/80 rounded-2xl p-6 hover:border-cyan-500/40 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-11 h-11 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-base font-black text-[#00B8C8]">
                            {emp.name ? emp.name.charAt(0).toUpperCase() : 'U'}
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-white">{emp.name}</h3>
                            <p className="text-xs text-[#00B8C8] font-medium">{emp.role} • {emp.department}</p>
                          </div>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                            emp.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : emp.status === 'on_leave'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {emp.status.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs bg-[#161616] p-3 rounded-xl border border-white/5 mb-4">
                        <div>
                          <span className="text-zinc-500 block">Base Salary</span>
                          <span className="font-bold text-white">${emp.salary.toLocaleString()}/mo</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block">Overtime Rate</span>
                          <span className="font-bold text-white">${(emp.hourlyOvertimeRate || 0).toFixed(2)}/hr</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block">Session Comm.</span>
                          <span className="font-bold text-purple-400">
                            ${emp.commissionRatePerSession || 0}/sess ({emp.commissionPercent || 0}%)
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block">NSSF Statutory</span>
                          <span className="font-bold text-amber-400">${(emp.nssfContribution || 0).toFixed(2)}</span>
                        </div>
                      </div>

                      {(linkedCoach || linkedTherapist) && (
                        <div className="flex flex-wrap gap-1.5 mb-4">
                          {linkedCoach && (
                            <span className="text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-md font-semibold">
                              Gym Coach: {linkedCoach.firstName} {linkedCoach.lastName}
                            </span>
                          )}
                          {linkedTherapist && (
                            <span className="text-[11px] bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2.5 py-0.5 rounded-md font-semibold">
                              Physio: Dr. {linkedTherapist.firstName} {linkedTherapist.lastName}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-white/5 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500 block">
                          {selectedMonth} Est. Net Pay
                        </span>
                        <span className="text-sm font-black text-emerald-400">
                          ${(b?.netPay ?? emp.salary).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => b && generatePayslipPDF(b, globalSettings?.systemName || 'Up ERP', lbpRate)}
                          title="Download Payslip PDF"
                          className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-300 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditEmployeeModal(emp)}
                          title="Edit Employee"
                          className="p-2 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg text-blue-400 transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteEmployee(emp)}
                          title="Delete Employee"
                          className="p-2 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: PAYROLL & CROSS-MODULE COMMISSIONS */}
        {activeTab === 'payroll' && (
          <div className="space-y-8">
            <div className="bg-[#111] border border-white/5 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Payroll Period (Month)
                  </label>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2 text-sm font-bold text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Execution Mode
                  </label>
                  <select
                    value={payImmediately ? 'paid' : 'accrued'}
                    onChange={(e) => setPayImmediately(e.target.value === 'paid')}
                    className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2 text-sm font-bold text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="paid">Pay Immediately (Cash/Bank Outflow)</option>
                    <option value="accrued">Accrue Liability (Salaries Payable)</option>
                  </select>
                </div>

                {payImmediately && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      Disbursement Method
                    </label>
                    <select
                      value={payrollPaymentMethod}
                      onChange={(e) => setPayrollPaymentMethod(e.target.value as any)}
                      className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2 text-sm font-bold text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="cash">Cash Drawer</option>
                      <option value="bank_transfer">Bank Transfer</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setIsAdjustmentModalOpen(true)}
                  className="flex items-center space-x-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>Record Advance / Bonus / Penalty</span>
                </button>
                <button
                  onClick={handleRunBatchPayroll}
                  disabled={runningPayrollId !== null}
                  className="flex items-center space-x-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-black px-5 py-2.5 rounded-xl text-sm font-black transition-all shadow-lg shadow-emerald-500/20"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{runningPayrollId === 'batch' ? 'Processing Batch...' : `Execute Batch Payroll (${selectedMonth})`}</span>
                </button>
              </div>
            </div>

            {/* Live Cross-Module Payroll Calculation Table */}
            <div className="bg-[#111] border border-white/5 rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-white uppercase tracking-tight">
                    Cross-Module Payroll & Commission Sheet ({selectedMonth})
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Auto-aggregates Gym Check-Ins, Court Private/Hustle Sessions, Physio Appointments, Attendance Overtime, and Unpaid Leaves
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#161616] border-b border-white/5 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                      <th className="p-4">Employee</th>
                      <th className="p-4">Base Salary</th>
                      <th className="p-4">Gym / Courts / Physio Comm.</th>
                      <th className="p-4">Overtime & Bonuses</th>
                      <th className="p-4">Unpaid Leave / Advances / NSSF</th>
                      <th className="p-4">Net Take-Home</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-sm">
                    {employees.map(emp => {
                      const b = monthlyBreakdowns[emp.id];
                      if (!b) return null;
                      const isPaidThisMonth = emp.lastPayrollPaidMonth === selectedMonth;

                      return (
                        <tr key={emp.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="p-4">
                            <div className="font-bold text-white">{emp.name}</div>
                            <div className="text-xs text-zinc-500">{emp.role} • {emp.department}</div>
                          </td>
                          <td className="p-4 font-semibold text-white">
                            ${b.baseSalary.toLocaleString()}
                          </td>
                          <td className="p-4">
                            <div className="font-bold text-purple-400">+${b.totalCommissions.toFixed(2)}</div>
                            <div className="text-[11px] text-zinc-500">
                              Gym: {b.gymSessionsCount} (${b.gymCommission}) • Court: {b.courtSessionsCount} (${b.courtCommission}) • Physio: {b.physioSessionsCount} (${b.physioCommission})
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="font-bold text-emerald-400">+${(b.overtimePay + b.bonuses).toFixed(2)}</div>
                            <div className="text-[11px] text-zinc-500">
                              OT: {b.overtimeHours}h (${b.overtimePay}) • Bonus: ${b.bonuses}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="font-bold text-rose-400">-${b.totalDeductions.toFixed(2)}</div>
                            <div className="text-[11px] text-zinc-500">
                              Unpaid: {b.unpaidLeaveDays}d (-${b.unpaidLeaveDeduction}) • Adv: -${b.advancesRecovery} • NSSF: -${b.nssfContribution}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="text-base font-black text-white">${b.netPay.toFixed(2)}</div>
                            <div className="text-[11px] text-zinc-500">
                              {Math.round(b.netPay * lbpRate).toLocaleString()} LBP
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => generatePayslipPDF(b, globalSettings?.systemName || 'Up ERP', lbpRate)}
                                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200 text-xs font-bold flex items-center space-x-1"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Payslip PDF</span>
                              </button>
                              {isPaidThisMonth ? (
                                <span className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
                                  Paid ({selectedMonth})
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleRunSinglePayroll(emp)}
                                  disabled={runningPayrollId !== null}
                                  className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-bold transition-all"
                                >
                                  {runningPayrollId === emp.id ? 'Posting...' : 'Run Payroll'}
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

            {/* Historical Payroll Runs & Adjustments Log */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[#111] border border-white/5 rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-white/5">
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">Executed Payroll Ledger (`payrolls`)</h3>
                </div>
                <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
                  {payrolls.length === 0 ? (
                    <div className="p-8 text-center text-zinc-500 text-sm">No payroll runs executed yet.</div>
                  ) : (
                    payrolls
                      .slice()
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map(pr => (
                        <div key={pr.id} className="p-4 flex items-center justify-between hover:bg-white/[0.02]">
                          <div>
                            <div className="font-bold text-white text-sm">
                              {pr.employeeName} <span className="text-xs text-blue-400">({pr.month || pr.date?.slice(0, 7)})</span>
                            </div>
                            <div className="text-xs text-zinc-500">
                              Gross: ${(pr.grossPay ?? pr.baseSalary ?? 0).toFixed(2)} • Ded: -${(pr.totalDeductions ?? pr.deduction ?? 0).toFixed(2)} • Status: {pr.status}
                            </div>
                          </div>
                          <div className="flex items-center space-x-3">
                            <span className="font-black text-emerald-400 text-sm">
                              ${Number(pr.netPay ?? pr.netAmount ?? 0).toFixed(2)}
                            </span>
                            {pr.grossPay !== undefined && (
                              <button
                                onClick={() => generatePayslipPDF(pr as PayrollBreakdown, globalSettings?.systemName || 'Up ERP', lbpRate)}
                                className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-300"
                                title="Download Payslip PDF"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>

              <div className="bg-[#111] border border-white/5 rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-white/5">
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">Advances, Bonuses & Adjustments (`staff_payments`)</h3>
                </div>
                <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
                  {payments.length === 0 ? (
                    <div className="p-8 text-center text-zinc-500 text-sm">No advances or adjustments logged yet.</div>
                  ) : (
                    payments
                      .slice()
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map(pm => (
                        <div key={pm.id} className="p-4 flex items-center justify-between hover:bg-white/[0.02]">
                          <div>
                            <div className="font-bold text-white text-sm">{pm.employeeName}</div>
                            <div className="text-xs text-zinc-500">
                              {pm.date} • {pm.type.toUpperCase()} • {pm.notes}
                            </div>
                          </div>
                          <span
                            className={`font-black text-sm ${
                              pm.type === 'deduction' ? 'text-rose-400' : pm.type === 'advance' ? 'text-amber-400' : 'text-emerald-400'
                            }`}
                          >
                            ${Number(pm.amount || 0).toFixed(2)}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ATTENDANCE */}
        {activeTab === 'attendance' && (
          <AttendanceModule isDarkMode={true} employees={employees.map(e => ({ id: e.id, name: e.name }))} />
        )}

        {/* TAB 4: LEAVES */}
        {activeTab === 'leaves' && (
          <LeavesModule isDarkMode={true} employees={employees.map(e => ({ id: e.id, name: e.name }))} />
        )}

        {/* TAB 5: DEPARTMENTS */}
        {activeTab === 'departments' && <DepartmentsManager />}
      </main>

      {/* ADD / EDIT EMPLOYEE MODAL */}
      {isEmployeeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-xl font-black text-white uppercase tracking-tight">
                {editingEmployee ? `Edit Employee — ${editingEmployee.name}` : 'Add Employee to Unified HR'}
              </h2>
              <button onClick={() => setIsEmployeeModalOpen(false)} className="text-zinc-500 hover:text-white">
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveEmployee} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={empForm.name}
                    onChange={e => setEmpForm({ ...empForm, name: e.target.value })}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Role / Title *</label>
                  <input
                    type="text"
                    required
                    value={empForm.role}
                    onChange={e => setEmpForm({ ...empForm, role: e.target.value })}
                    placeholder="e.g., Head Coach, Receptionist, Physiotherapist"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Department</label>
                  <select
                    value={empForm.department}
                    onChange={e => setEmpForm({ ...empForm, department: e.target.value })}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                  >
                    <option value="General">General</option>
                    <option value="Gym">Gym</option>
                    <option value="Courts">Courts</option>
                    <option value="Physio">Physio</option>
                    <option value="Management">Management</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Employment Status</label>
                  <select
                    value={empForm.status}
                    onChange={e => setEmpForm({ ...empForm, status: e.target.value as any })}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                  >
                    <option value="active">Active</option>
                    <option value="on_leave">On Leave</option>
                    <option value="terminated">Terminated</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Phone</label>
                  <input
                    type="tel"
                    value={empForm.phone}
                    onChange={e => setEmpForm({ ...empForm, phone: e.target.value })}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Email</label>
                  <input
                    type="email"
                    value={empForm.email}
                    onChange={e => setEmpForm({ ...empForm, email: e.target.value })}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                  />
                </div>
              </div>

              <div className="border-t border-white/10 pt-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-blue-400 mb-3">
                  Compensation, Overtime & Lebanese NSSF
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Base Monthly Salary ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={empForm.salary}
                      onChange={e => {
                        const sal = Number(e.target.value);
                        setEmpForm({
                          ...empForm,
                          salary: sal,
                          hourlyOvertimeRate: Number(((sal / 160) * 1.5).toFixed(2))
                        });
                      }}
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Hourly Overtime Rate ($/hr)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={empForm.hourlyOvertimeRate}
                      onChange={e => setEmpForm({ ...empForm, hourlyOvertimeRate: Number(e.target.value) })}
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Monthly NSSF Deduction ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={empForm.nssfContribution}
                      onChange={e => setEmpForm({ ...empForm, nssfContribution: Number(e.target.value) })}
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-white/10 pt-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-purple-400 mb-3">
                  Cross-Module Commission Sync (Gym, Courts & Physio)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Flat Commission ($ / Session)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={empForm.commissionRatePerSession}
                      onChange={e => setEmpForm({ ...empForm, commissionRatePerSession: Number(e.target.value) })}
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Revenue Share Commission (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={empForm.commissionPercent}
                      onChange={e => setEmpForm({ ...empForm, commissionPercent: Number(e.target.value) })}
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Link to Gym Coach Profile</label>
                    <select
                      value={empForm.linkedCoachId}
                      onChange={e => setEmpForm({ ...empForm, linkedCoachId: e.target.value })}
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                    >
                      <option value="">Auto-Match by Name / None</option>
                      {coaches.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.firstName} {c.lastName} (${c.hourRate || 0}/sess)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Link to Physiotherapist Profile</label>
                    <select
                      value={empForm.linkedTherapistId}
                      onChange={e => setEmpForm({ ...empForm, linkedTherapistId: e.target.value })}
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                    >
                      <option value="">Auto-Match by Name / None</option>
                      {therapists.map(t => (
                        <option key={t.id} value={t.id}>
                          Dr. {t.firstName} {t.lastName} (${t.feePerSession || 0}/sess)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsEmployeeModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-blue-500/20"
                >
                  {editingEmployee ? 'Save Changes' : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ISSUE ADVANCE / BONUS / DEDUCTION MODAL */}
      {isAdjustmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-lg font-black text-white uppercase tracking-tight">
                Record Advance, Bonus or Deduction
              </h2>
              <button onClick={() => setIsAdjustmentModalOpen(false)} className="text-zinc-500 hover:text-white">
                ✕
              </button>
            </div>
            <form onSubmit={handleRecordAdjustment} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Select Employee *</label>
                <select
                  required
                  value={adjustmentForm.employeeId}
                  onChange={e => setAdjustmentForm({ ...adjustmentForm, employeeId: e.target.value })}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                >
                  <option value="">Choose Employee...</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Adjustment Type</label>
                  <select
                    value={adjustmentForm.type}
                    onChange={e => setAdjustmentForm({ ...adjustmentForm, type: e.target.value as any })}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                  >
                    <option value="advance">Salary Advance (Loan)</option>
                    <option value="bonus">Cycle Bonus</option>
                    <option value="deduction">Penalty / Deduction</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Amount ($) *</label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={adjustmentForm.amount || ''}
                    onChange={e => setAdjustmentForm({ ...adjustmentForm, amount: Number(e.target.value) })}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                  />
                </div>
              </div>

              {adjustmentForm.type === 'advance' && (
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Disbursement Account</label>
                  <select
                    value={adjustmentForm.paymentMethod}
                    onChange={e => setAdjustmentForm({ ...adjustmentForm, paymentMethod: e.target.value as any })}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                  >
                    <option value="cash">Cash Drawer (Outflow)</option>
                    <option value="bank_transfer">Bank Transfer (Outflow)</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Notes / Reason</label>
                <input
                  type="text"
                  value={adjustmentForm.notes}
                  onChange={e => setAdjustmentForm({ ...adjustmentForm, notes: e.target.value })}
                  placeholder="Optional reference..."
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAdjustmentModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-amber-500 hover:bg-amber-600 text-black px-5 py-2 rounded-xl text-sm font-black"
                >
                  Save Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default HRManagementApp;
