import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Clock } from 'lucide-react';

export const AttendanceModule: React.FC<{ isDarkMode: boolean; employees: any[] }> = ({ isDarkMode, employees }) => {
  const { user, handleFirestoreError } = useFirebase();
  const [attendances, setAttendances] = useState<any[]>([]);
  const [empId, setEmpId] = useState('');
  const [type, setType] = useState('check_in');
  const [overtimeHours, setOvertimeHours] = useState<string>('0');

  const [filterEmpId, setFilterEmpId] = useState('all');
  const [customDateFrom, setCustomDateFrom] = useState(format(new Date(new Date().setDate(1)), 'yyyy-MM-dd'));
  const [customDateTo, setCustomDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'staff_attendance'), snap => {
      setAttendances(snap.docs.map(d => ({id: d.id, ...d.data()})));
    }, err => handleFirestoreError(err, OperationType.LIST, 'staff_attendance'));
    return () => unsub();
  }, [user]);

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empId) return;
    const emp = employees.find(e => e.id === empId);
    const parsedOT = Math.max(0, parseFloat(overtimeHours) || 0);
    try {
      await addDoc(collection(db, 'staff_attendance'), {
        employeeId: empId,
        employeeName: emp?.name || 'Unknown',
        type,
        overtimeHours: parsedOT,
        timestamp: serverTimestamp(),
        dateStr: new Date().toISOString().split('T')[0]
      });
      toast.success('Attendance recorded');
      setEmpId('');
      setOvertimeHours('0');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'staff_attendance');
    }
  };

  const filteredAttendances = attendances.filter(att => {
    if (filterEmpId !== 'all' && att.employeeId !== filterEmpId) return false;
    if (att.dateStr && att.dateStr >= customDateFrom && att.dateStr <= customDateTo) return true;
    if (att.timestamp) {
       const d = format(new Date(att.timestamp.seconds * 1000), 'yyyy-MM-dd');
       return d >= customDateFrom && d <= customDateTo;
    }
    return false;
  }).sort((a,b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

  const uniqueDaysAttended = new Set(filteredAttendances.filter(a => a.type === 'check_in').map(a => a.dateStr || (a.timestamp ? format(new Date(a.timestamp.seconds * 1000), 'yyyy-MM-dd') : ''))).size;
  const totalOvertimeLogged = filteredAttendances.reduce((s, a) => s + (Number(a.overtimeHours) || 0), 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
       <div className="col-span-1 lg:col-span-1 space-y-6">
         <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm`}>
            <div className="flex items-center gap-3 mb-6">
              <Clock className="text-[#00B8C8]" />
              <h2 className="text-lg font-bold">Record Attendance / OT</h2>
            </div>
            <form onSubmit={handleRecord} className="space-y-4">
               <div>
                 <label className="block text-xs font-bold mb-1 uppercase text-zinc-500">Employee</label>
                 <select required value={empId} onChange={e => setEmpId(e.target.value)} className={`w-full px-3 py-2 rounded-lg border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`}>
                   <option value="">Select Employee...</option>
                   {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                 </select>
               </div>
               <div>
                 <label className="block text-xs font-bold mb-1 uppercase text-zinc-500">Action Type</label>
                 <select value={type} onChange={e => setType(e.target.value)} className={`w-full px-3 py-2 rounded-lg border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`}>
                   <option value="check_in">Check In</option>
                   <option value="check_out">Check Out</option>
                   <option value="overtime_start">Overtime Start</option>
                   <option value="overtime_end">Overtime End</option>
                 </select>
               </div>
               <div>
                 <label className="block text-xs font-bold mb-1 uppercase text-zinc-500">Overtime Hours (Optional)</label>
                 <input
                   type="number"
                   step="0.5"
                   min="0"
                   value={overtimeHours}
                   onChange={e => setOvertimeHours(e.target.value)}
                   className={`w-full px-3 py-2 rounded-lg border focus:border-[#00B8C8] outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-300'}`}
                 />
               </div>
               <button type="submit" className="w-full py-2.5 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg font-bold transition-colors">Record Attendance</button>
            </form>
         </div>
       </div>

       <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#0B0F17] border-zinc-800' : 'bg-white border-slate-200'} shadow-sm lg:col-span-3 overflow-hidden flex flex-col h-[700px]`}>
          <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-4 mb-6">
            <div>
              <h2 className="text-lg font-bold mb-1">Attendance & Overtime History</h2>
              <p className="text-sm text-zinc-500">
                Days attended: <strong className="text-[#0099A8] dark:text-[#00B8C8]">{uniqueDaysAttended} days</strong> • Explicit OT logged: <strong className="text-teal-500">{totalOvertimeLogged} hrs</strong>
              </p>
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
                   <th className="p-4">Action</th>
                   <th className="p-4">OT Hours</th>
                   <th className="p-4">Date</th>
                   <th className="p-4">Time</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-200 dark:divide-zinc-800/50">
                 {filteredAttendances.map(att => (
                   <tr key={att.id}>
                     <td className="p-4 font-bold">{att.employeeName}</td>
                     <td className="p-4">
                       <span className={`px-2 py-1 text-xs font-bold rounded-lg ${
                         att.type === 'check_in' ? 'bg-emerald-500/10 text-emerald-500' :
                         att.type === 'check_out' ? 'bg-rose-500/10 text-rose-500' :
                         'bg-[#00B8C8]/10 text-[#0099A8] dark:text-[#00B8C8]'
                       }`}>
                         {att.type.replace('_', ' ').toUpperCase()}
                       </span>
                     </td>
                     <td className="p-4 font-mono font-bold text-[#0099A8] dark:text-[#00B8C8]">{att.overtimeHours ? `+${att.overtimeHours}h` : '—'}</td>
                     <td className="p-4">{att.dateStr || (att.timestamp ? format(new Date(att.timestamp.seconds * 1000), 'yyyy-MM-dd') : '...')}</td>
                     <td className="p-4 text-zinc-500 font-mono">{att.timestamp ? format(new Date(att.timestamp.seconds * 1000), 'HH:mm:ss') : '...'}</td>
                   </tr>
                 ))}
                 {filteredAttendances.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-zinc-500">No records found.</td></tr>}
               </tbody>
             </table>
          </div>
       </div>
    </div>
  );
};
