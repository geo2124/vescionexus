import React, { useState } from 'react';
import {
  X, Plus, Trash2, Edit2, Check, Settings, DoorOpen, Stethoscope, Activity, Tag
} from 'lucide-react';
import {
  PhysioRoom,
  PhysioClinicalSettings,
  PhysioSessionTypeOption
} from '../../types';
import { toast } from 'sonner';

interface PhysioClinicalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  rooms: PhysioRoom[];
  settings: PhysioClinicalSettings;
  onSaveRoom: (room: Omit<PhysioRoom, 'id'>, existingId?: string) => Promise<void>;
  onDeleteRoom: (roomId: string) => Promise<void>;
  onSaveSettings: (updated: PhysioClinicalSettings) => Promise<void>;
  formatCurrency: (val: number) => string;
}

export const PhysioClinicalSettingsModal: React.FC<PhysioClinicalSettingsModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
  rooms,
  settings,
  onSaveRoom,
  onDeleteRoom,
  onSaveSettings,
  formatCurrency
}) => {
  const [activeSection, setActiveSection] = useState<'rooms' | 'session_types' | 'injuries' | 'statuses'>('rooms');

  // Room State
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('');
  const [roomEquipmentInput, setRoomEquipmentInput] = useState('');
  const [roomIsActive, setRoomIsActive] = useState(true);

  // Session Type State
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [typeName, setTypeName] = useState('');
  const [typeDuration, setTypeDuration] = useState(45);
  const [typePrice, setTypePrice] = useState(50);

  // Injury Category State
  const [newInjuryCategory, setNewInjuryCategory] = useState('');
  const [editingInjuryIdx, setEditingInjuryIdx] = useState<number | null>(null);
  const [editingInjuryVal, setEditingInjuryVal] = useState('');

  // Custom Status State
  const [newStatusOption, setNewStatusOption] = useState('');
  const [editingStatusIdx, setEditingStatusIdx] = useState<number | null>(null);
  const [editingStatusVal, setEditingStatusVal] = useState('');

  if (!isOpen) return null;

  const handleRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) {
      toast.error('Please enter a room/cabin name');
      return;
    }
    const tags = roomEquipmentInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    await onSaveRoom(
      {
        name: roomName.trim(),
        equipmentTags: tags,
        isActive: roomIsActive
      },
      editingRoomId || undefined
    );
    setEditingRoomId(null);
    setRoomName('');
    setRoomEquipmentInput('');
    setRoomIsActive(true);
    toast.success(editingRoomId ? 'Treatment room updated' : 'Treatment room added');
  };

  const handleSessionTypeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeName.trim()) {
      toast.error('Please enter a session type name');
      return;
    }
    const nextItem: PhysioSessionTypeOption = {
      id: editingTypeId || `ST-${Date.now()}`,
      name: typeName.trim(),
      defaultDurationMinutes: Math.max(15, Number(typeDuration) || 45),
      defaultPrice: Math.max(0, Number(typePrice) || 0)
    };
    const nextTypes = editingTypeId
      ? settings.sessionTypes.map(st => (st.id === editingTypeId ? nextItem : st))
      : [...settings.sessionTypes, nextItem];
    await onSaveSettings({ ...settings, sessionTypes: nextTypes });
    setEditingTypeId(null);
    setTypeName('');
    setTypeDuration(45);
    setTypePrice(50);
    toast.success(editingTypeId ? 'Session type updated' : 'Session type added');
  };

  const handleDeleteSessionType = async (id: string) => {
    const nextTypes = settings.sessionTypes.filter(st => st.id !== id);
    await onSaveSettings({ ...settings, sessionTypes: nextTypes });
    toast.success('Session type removed');
  };

  const handleAddInjury = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInjuryCategory.trim()) return;
    if (settings.injuryCategories.includes(newInjuryCategory.trim())) {
      toast.error('Category already exists');
      return;
    }
    await onSaveSettings({
      ...settings,
      injuryCategories: [...settings.injuryCategories, newInjuryCategory.trim()]
    });
    setNewInjuryCategory('');
    toast.success('Injury/Diagnosis category added');
  };

  const handleAddStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatusOption.trim()) return;
    if (settings.customStatuses.includes(newStatusOption.trim())) {
      toast.error('Status already exists');
      return;
    }
    await onSaveSettings({
      ...settings,
      customStatuses: [...settings.customStatuses, newStatusOption.trim()]
    });
    setNewStatusOption('');
    toast.success('Custom case status added');
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        className={`w-full max-w-4xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[88vh] ${
          isDarkMode ? 'bg-[#0B0F17] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            isDarkMode ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#00B8C8]/15 border border-[#00B8C8]/30 flex items-center justify-center text-[#00B8C8]">
              <Settings size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Clinical Settings, Rooms & Custom Taxonomies</h2>
              <p className="text-xs text-zinc-400">
                Configure dynamic treatment rooms, session types, injury diagnoses, and custom case statuses
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-rose-500 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Sub-Tabs */}
        <div
          className={`flex gap-2 px-6 py-3 border-b overflow-x-auto ${
            isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-slate-100 border-slate-200'
          }`}
        >
          {[
            { id: 'rooms', label: `Treatment Rooms (${rooms.length})`, icon: DoorOpen },
            { id: 'session_types', label: `Session Types (${settings.sessionTypes.length})`, icon: Stethoscope },
            { id: 'injuries', label: `Injury / Diagnosis (${settings.injuryCategories.length})`, icon: Activity },
            { id: 'statuses', label: `Case Statuses (${settings.customStatuses.length})`, icon: Tag }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                  activeSection === tab.id
                    ? 'bg-[#00B8C8] text-[#05070A] shadow-sm'
                    : isDarkMode
                    ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeSection === 'rooms' && (
            <div className="space-y-6">
              <form
                onSubmit={handleRoomSubmit}
                className={`p-4 rounded-xl border space-y-4 ${
                  isDarkMode ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#00B8C8]">
                    {editingRoomId ? 'Edit Treatment Room / Cabin' : 'Add New Treatment Room / Cabin'}
                  </h3>
                  {editingRoomId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRoomId(null);
                        setRoomName('');
                        setRoomEquipmentInput('');
                        setRoomIsActive(true);
                      }}
                      className="text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                      Room / Cabin Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Room 1 - Manual Therapy"
                      value={roomName}
                      onChange={e => setRoomName(e.target.value)}
                      className={`w-full p-2.5 rounded-lg border text-xs ${
                        isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                      Equipment Tags (Comma-Separated)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Shockwave, Ultrasound, Dry Needling"
                      value={roomEquipmentInput}
                      onChange={e => setRoomEquipmentInput(e.target.value)}
                      className={`w-full p-2.5 rounded-lg border text-xs ${
                        isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <label className="flex items-center gap-2 text-xs font-bold cursor-pointer mb-2">
                      <input
                        type="checkbox"
                        checked={roomIsActive}
                        onChange={e => setRoomIsActive(e.target.checked)}
                        className="accent-[#00B8C8]"
                      />
                      Active on Calendar
                    </label>
                    <button
                      type="submit"
                      className="ml-auto px-4 py-2.5 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] font-bold text-xs flex items-center gap-1.5"
                    >
                      <Plus size={14} />
                      {editingRoomId ? 'Update Room' : 'Add Room'}
                    </button>
                  </div>
                </div>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rooms.map(room => (
                  <div
                    key={room.id}
                    className={`p-4 rounded-xl border flex items-center justify-between ${
                      isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{room.name}</span>
                        <span
                          className={`text-[10px] font-bold uppercase ${
                            room.isActive ? 'text-emerald-400' : 'text-zinc-500'
                          }`}
                        >
                          · {room.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1">
                        {room.equipmentTags && room.equipmentTags.length > 0
                          ? room.equipmentTags.join(' · ')
                          : 'Standard clinical cabin'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRoomId(room.id);
                          setRoomName(room.name);
                          setRoomEquipmentInput((room.equipmentTags || []).join(', '));
                          setRoomIsActive(room.isActive);
                        }}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-[#00B8C8]"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRoom(room.id)}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'session_types' && (
            <div className="space-y-6">
              <form
                onSubmit={handleSessionTypeSubmit}
                className={`p-4 rounded-xl border space-y-4 ${
                  isDarkMode ? 'bg-[#101622] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#00B8C8]">
                    {editingTypeId ? 'Edit Session Type' : 'Add Custom Session Type'}
                  </h3>
                  {editingTypeId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTypeId(null);
                        setTypeName('');
                        setTypeDuration(45);
                        setTypePrice(50);
                      }}
                      className="text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                      Session Type Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Dry Needling, Shockwave Therapy, Post-Op Rehab"
                      value={typeName}
                      onChange={e => setTypeName(e.target.value)}
                      className={`w-full p-2.5 rounded-lg border text-xs ${
                        isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                      Default Duration (Min)
                    </label>
                    <input
                      type="number"
                      min="15"
                      step="5"
                      required
                      value={typeDuration}
                      onChange={e => setTypeDuration(parseInt(e.target.value) || 45)}
                      className={`w-full p-2.5 rounded-lg border text-xs font-mono ${
                        isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1">
                        Default Price ($)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        required
                        value={typePrice}
                        onChange={e => setTypePrice(parseFloat(e.target.value) || 0)}
                        className={`w-full p-2.5 rounded-lg border text-xs font-mono ${
                          isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                        }`}
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-2.5 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] font-bold text-xs"
                    >
                      {editingTypeId ? 'Save' : 'Add'}
                    </button>
                  </div>
                </div>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {settings.sessionTypes.map(st => (
                  <div
                    key={st.id}
                    className={`p-3.5 rounded-xl border flex items-center justify-between ${
                      isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-sm">{st.name}</div>
                      <div className="text-xs text-zinc-400 mt-0.5 font-mono">
                        {st.defaultDurationMinutes} mins · Default Fee: {formatCurrency(st.defaultPrice)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTypeId(st.id);
                          setTypeName(st.name);
                          setTypeDuration(st.defaultDurationMinutes);
                          setTypePrice(st.defaultPrice);
                        }}
                        className="p-1.5 text-zinc-400 hover:text-[#00B8C8]"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSessionType(st.id)}
                        className="p-1.5 text-zinc-400 hover:text-rose-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'injuries' && (
            <div className="space-y-5">
              <form onSubmit={handleAddInjury} className="flex gap-3">
                <input
                  type="text"
                  placeholder="Add new injury or diagnosis category (e.g. ACL Reconstruction, Rotator Cuff Tear, Lumbar Disc Herniation)..."
                  value={newInjuryCategory}
                  onChange={e => setNewInjuryCategory(e.target.value)}
                  className={`flex-1 p-2.5 rounded-lg border text-xs ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                  }`}
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] font-bold text-xs flex items-center gap-1.5"
                >
                  <Plus size={14} /> Add Category
                </button>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {settings.injuryCategories.map((cat, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border flex items-center justify-between ${
                      isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    {editingInjuryIdx === idx ? (
                      <div className="flex items-center gap-2 flex-1 mr-2">
                        <input
                          type="text"
                          value={editingInjuryVal}
                          onChange={e => setEditingInjuryVal(e.target.value)}
                          className="flex-1 p-1.5 rounded bg-zinc-900 border border-zinc-700 text-xs"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (editingInjuryVal.trim()) {
                              const next = [...settings.injuryCategories];
                              next[idx] = editingInjuryVal.trim();
                              await onSaveSettings({ ...settings, injuryCategories: next });
                            }
                            setEditingInjuryIdx(null);
                          }}
                          className="p-1 text-emerald-400"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm font-medium">{cat}</span>
                    )}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingInjuryIdx(idx);
                          setEditingInjuryVal(cat);
                        }}
                        className="p-1 text-zinc-400 hover:text-[#00B8C8]"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = settings.injuryCategories.filter((_, i) => i !== idx);
                          await onSaveSettings({ ...settings, injuryCategories: next });
                        }}
                        className="p-1 text-zinc-400 hover:text-rose-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'statuses' && (
            <div className="space-y-5">
              <form onSubmit={handleAddStatus} className="flex gap-3">
                <input
                  type="text"
                  placeholder="Add custom clinical case status (e.g. Active Treatment, Assessment, On Hold, Discharged / Recovered)..."
                  value={newStatusOption}
                  onChange={e => setNewStatusOption(e.target.value)}
                  className={`flex-1 p-2.5 rounded-lg border text-xs ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                  }`}
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-[#05070A] font-bold text-xs flex items-center gap-1.5"
                >
                  <Plus size={14} /> Add Status
                </button>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {settings.customStatuses.map((st, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border flex items-center justify-between ${
                      isDarkMode ? 'bg-[#05070A] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    {editingStatusIdx === idx ? (
                      <div className="flex items-center gap-2 flex-1 mr-2">
                        <input
                          type="text"
                          value={editingStatusVal}
                          onChange={e => setEditingStatusVal(e.target.value)}
                          className="flex-1 p-1.5 rounded bg-zinc-900 border border-zinc-700 text-xs"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (editingStatusVal.trim()) {
                              const next = [...settings.customStatuses];
                              next[idx] = editingStatusVal.trim();
                              await onSaveSettings({ ...settings, customStatuses: next });
                            }
                            setEditingStatusIdx(null);
                          }}
                          className="p-1 text-emerald-400"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm font-medium">{st}</span>
                    )}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingStatusIdx(idx);
                          setEditingStatusVal(st);
                        }}
                        className="p-1 text-zinc-400 hover:text-[#00B8C8]"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = settings.customStatuses.filter((_, i) => i !== idx);
                          await onSaveSettings({ ...settings, customStatuses: next });
                        }}
                        className="p-1 text-zinc-400 hover:text-rose-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
