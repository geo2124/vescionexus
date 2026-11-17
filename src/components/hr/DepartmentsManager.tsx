import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Department {
  id: string;
  name: string;
  description?: string;
}

export const DepartmentsManager: React.FC = () => {
  const { user, handleFirestoreError } = useFirebase();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'staff_departments'), snap => {
      setDepartments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Department)));
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'staff_departments');
    });
    return () => unsub();
  }, [user, handleFirestoreError]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptName.trim()) return;
    try {
      await addDoc(collection(db, 'staff_departments'), {
        name: newDeptName.trim()
      });
      setNewDeptName('');
      toast.success('Department created');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'staff_departments');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingName.trim() || !editingId) return;
    try {
      await updateDoc(doc(db, 'staff_departments', editingId), {
        name: editingName.trim()
      });
      setEditingId(null);
      setEditingName('');
      toast.success('Department updated');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'staff_departments');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this department?')) return;
    try {
      await deleteDoc(doc(db, 'staff_departments', id));
      toast.success('Department deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'staff_departments');
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          required
          placeholder="New Department Name"
          value={newDeptName}
          onChange={(e) => setNewDeptName(e.target.value)}
          className="flex-1 px-3 py-2 border rounded-lg bg-transparent border-zinc-300 dark:border-zinc-700 text-sm focus:border-[#00B8C8] outline-none"
        />
        <button type="submit" className="px-3 py-2 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-lg font-bold transition-colors"><Plus size={16} /></button>
      </form>
      
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {departments.map(dept => (
          <div key={dept.id} className="flex items-center justify-between p-2 border border-slate-200 dark:border-zinc-800 rounded-lg">
            {editingId === dept.id ? (
              <form onSubmit={handleEdit} className="flex gap-2 flex-1 mr-2">
                <input
                  autoFocus
                  required
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="flex-1 px-2 py-1 border rounded bg-transparent border-zinc-300 dark:border-zinc-700 text-sm focus:border-[#00B8C8] outline-none"
                />
                <button type="submit" className="text-[#00B8C8] font-bold text-xs">Save</button>
                <button type="button" onClick={() => setEditingId(null)} className="text-zinc-500 font-bold text-xs">Cancel</button>
              </form>
            ) : (
              <>
                <span className="text-sm font-medium">{dept.name}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setEditingId(dept.id); setEditingName(dept.name); }} className="text-[#00B8C8] hover:text-[#0099A8]"><Edit2 size={14} /></button>
                  <button type="button" onClick={() => handleDelete(dept.id)} className="text-red-500 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </>
            )}
          </div>
        ))}
        {departments.length === 0 && <p className="text-xs text-zinc-500">No departments configured.</p>}
      </div>
    </div>
  );
};
