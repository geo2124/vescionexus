import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Calendar, Check, X } from 'lucide-react';

export const LeavesModule: React.FC<{ isDarkMode: boolean; employees: any[] }> = ({ isDarkMode, employees }) => {
  const { user, handleFirestoreError } = useFirebase();
  const [leaves, setLeaves] = useState<any[]>([]);
  const [empId, setEmpId] = useState('');
  const [leaveType, setLeaveType] = useState('annual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const [filterEmpId, setFilterEmpId] = useState('all');
  const [customDateFrom, setCustomDateFrom] = useState(format(new Date(new Date().setDate(1)), 'yyyy-MM-dd'));
  const [customDateTo, setCustomDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'staff_leaves'), snap => {
      setLeaves(snap.docs.map(d => ({id: d.id, ...d.data()})));
    }, err => handleFirestoreError(err, OperationType.LIST, 'staff_leaves'));
    return () => unsub();
  }, [user]);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empId) return;
    const emp = employees.find(e => e.id === empId);
    try {
      await addDoc(collection(db, 'staff_leaves'), {
        employeeId: empId,
        employeeName: emp?.name || 'Unknown',
        type: leaveType,
        startDate,
        endDate,
        reason,
        status: 'approved',
        appliedAt: serverTimestamp()
      });
      toast.success('Leave recorded successfully');
      setEmpId('');
      setStartDate('');
      setEndDate('');
      setReason('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'staff_leaves');
    }
  };

  const handleDeleteLeave = async (id: string) => {
    if (!window.confirm('Delete this leave record?')) return;
    try {
      await deleteDoc(doc(db, 'staff_leaves', id));
      toast.success('Leave record deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'staff_leaves');
    }
  };

  const filteredLeaves = leaves.filter(lv => {
    if (filterEmpId !== 'all' && lv.employeeId !== filterEmpId) return false;
    // check if it overlaps with the period
    if (lv.startDate > customDateTo || lv.endDate < customDateFrom) return false;
    return true;
  }).sort((a,b) => (b.appliedAt?.seconds || 0) - (a.appliedAt?.seconds || 0));

  let totalApprovedDays = 0;
  filteredLeaves.forEach(lv => {
      if (lv.status !== 'approved') return;
      const start = new Date(Math.max(new Date(lv.startDate).getTime(), new Date(customDateFrom).getTime()));
      const end = new Date(Math.min(new Date(lv.endDate).getTime(), new Date(customDateTo).getTime()));
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays > 0) totalApprovedDays += diffDays;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
       <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm lg:col-span-1`}>
          <div className="flex items-center gap-3 mb-6">
            <Calendar className="text-[#00B8C8]" />
            <h2 className="text-lg font-bold">Record Leave</h2>
          </div>
          <form onSubmit={handleApply} className="space-y-4">
             <div>
               <label className="block text-xs font-bold mb-1 uppercase text-zinc-500">Employee</label>
               <select required value={empId} onChange={e => setEmpId(e.target.value)} className={`w-full px-3 py-2 rounded-lg border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`}>
                 <option value="">Select Employee...</option>
                 {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
               </select>
             </div>
             <div>
               <label className="block text-xs font-bold mb-1 uppercase text-zinc-500">Leave Type</label>
               <select value={leaveType} onChange={e => setLeaveType(e.target.value)} className={`w-full px-3 py-2 rounded-lg border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`}>
                 <option value="annual">Annual Leave</option>
                 <option value="sick">Sick Leave</option>
                 <option value="unpaid">Unpaid Leave</option>
                 <option value="maternity">Maternity/Paternity</option>
               </select>
             </div>
             <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                 <div>
                   <label className="block text-xs font-bold mb-1 uppercase text-zinc-500">Start Date</label>
                   <input required type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`w-full px-2 py-2 text-sm rounded-lg border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`} />
                 </div>
                 <div>
                   <label className="block text-xs font-bold mb-1 uppercase text-zinc-500">End Date</label>
                   <input required type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={`w-full px-2 py-2 text-sm rounded-lg border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`} />
                 </div>
             </div>
             <div>
               <label className="block text-xs font-bold mb-1 uppercase text-zinc-500">Reason / Notes</label>
               <textarea value={reason} onChange={e => setReason(e.target.value)} className={`w-full px-3 py-2 rounded-lg border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`} rows={3}></textarea>
             </div>
             <button type="submit" className="w-full py-2.5 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg font-bold transition-colors">Record Leave</button>
          </form>
       </div>

       <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm lg:col-span-3 overflow-hidden flex flex-col h-[700px]`}>
          <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-4 mb-6">
            <div>
              <h2 className="text-lg font-bold mb-1">Leave Log & Stats</h2>
              <p className="text-sm text-zinc-500">Stats for period: <strong className="text-[#0099A8] dark:text-[#00B8C8]">{totalApprovedDays} days</strong> approved</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select value={filterEmpId} onChange={e => setFilterEmpId(e.target.value)} className={`px-3 py-1.5 text-sm rounded-lg border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`}>
                <option value="all">All Employees</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
              <input type="date" value={customDateFrom} onChange={e => setCustomDateFrom(e.target.value)} className={`px-2 py-1 text-sm rounded border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`} />
              <span className="text-zinc-500 text-sm">to</span>
              <input type="date" value={customDateTo} onChange={e => setCustomDateTo(e.target.value)} className={`px-2 py-1 text-sm rounded border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
             <table className="w-full text-sm text-left">
               <thead className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-zinc-500 bg-zinc-950/80 border-b border-zinc-800' : 'text-slate-500 bg-slate-50 border-b border-slate-200'} sticky top-0`}>
                 <tr>
                   <th className="p-4">Employee</th>
                   <th className="p-4">Details</th>
                   <th className="p-4">Status</th>
                   <th className="p-4 text-right">Actions</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-200 dark:divide-zinc-800/50">
                 {filteredLeaves.map(leave => (
                   <tr key={leave.id}>
                     <td className="p-4 font-bold">{leave.employeeName}</td>
                     <td className="p-4">
                        <div className="font-bold text-[#0099A8] dark:text-[#00B8C8] uppercase text-[10px] tracking-widest mb-1">{leave.type}</div>
                        <div className="text-zinc-500 text-xs">{leave.startDate} to {leave.endDate}</div>
                        {leave.reason && <div className="text-[10px] text-zinc-400 mt-1 truncate max-w-[150px]">{leave.reason}</div>}
                     </td>
                     <td className="p-4">
                       <span className={`px-2 py-1 text-xs font-bold rounded-lg ${
                         leave.status === 'approved' ? 'bg-emerald-500/10 text-emerald-500' :
                         leave.status === 'rejected' ? 'bg-rose-500/10 text-rose-500' :
                         'bg-amber-500/10 text-amber-500'
                       }`}>
                         {leave.status.toUpperCase()}
                       </span>
                     </td>
                     <td className="p-4 flex justify-end gap-2 text-right">
                       <button onClick={() => handleDeleteLeave(leave.id)} className="p-1.5 bg-rose-500/10 text-rose-500 rounded-lg hover:bg-rose-500 hover:text-white transition-colors"><X size={16} /></button>
                     </td>
                   </tr>
                 ))}
                 {filteredLeaves.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-zinc-500">No leave records found.</td></tr>}
               </tbody>
             </table>
          </div>
       </div>
    </div>
  );
};
