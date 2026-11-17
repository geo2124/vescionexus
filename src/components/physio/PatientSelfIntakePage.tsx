import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { stripUndefined } from '../../lib/transaction-engine';
import { Activity, CheckCircle2, Upload, FileText, ShieldCheck, Search, HeartPulse, Phone, User, Calendar } from 'lucide-react';
import { toast } from 'sonner';

interface TherapistOption {
  id: string;
  firstName: string;
  lastName: string;
  specialty?: string;
}

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'] as const;
const VISIT_TYPES = ['Initial Session', 'Assessment', 'Follow up', 'Rehab Session'] as const;
const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed'] as const;

export const PatientSelfIntakePage: React.FC = () => {
  const { token } = useParams<{ token?: string }>();
  const [therapists, setTherapists] = useState<TherapistOption[]>([]);
  const [therapistSearch, setTherapistSearch] = useState('');
  const [isTherapistDropdownOpen, setIsTherapistDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    address: '',
    dob: '',
    maritalStatus: '',
    occupation: '',
    assignedPhysiotherapistId: '',
    assignedPhysiotherapistName: '',
    referringPhysician: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
    isInsured: false,
    insuranceCompanyName: '',
    visitType: 'Initial Session',
    numberOfSessions: 1,
    bloodType: 'O+',
    scanImageUrl: '',
    scanImageName: '',
    physioDiagnosis: '',
    medicalHistory: ''
  });

  useEffect(() => {
    const loadTherapists = async () => {
      try {
        const snap = await getDocs(collection(db, 'physiotherapists'));
        const list = snap.docs.map(d => ({
          id: d.id,
          ...(d.data() as any)
        }));
        setTherapists(list);
      } catch (err) {
        console.warn('Could not load therapists list:', err);
      }
    };
    loadTherapists();
  }, []);

  const filteredTherapists = useMemo(() => {
    const q = therapistSearch.trim().toLowerCase();
    if (!q) return therapists;
    return therapists.filter(t => {
      const fullName = `Dr. ${t.firstName || ''} ${t.lastName || ''} ${t.specialty || ''}`.toLowerCase();
      return fullName.includes(q);
    });
  }, [therapists, therapistSearch]);

  const handleScanUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error('Please upload an image or PDF smaller than 4 MB');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData(prev => ({
        ...prev,
        scanImageUrl: reader.result as string,
        scanImageName: file.name
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firstName.trim() || !formData.lastName.trim() || !formData.phone.trim()) {
      toast.error('First Name, Last Name, and Phone Number are mandatory.');
      return;
    }
    if (!formData.dob) {
      toast.error('Date of Birth is mandatory.');
      return;
    }
    const chosenTherapistName = formData.assignedPhysiotherapistName.trim() || therapistSearch.trim();
    if (!chosenTherapistName) {
      toast.error('Please select or enter an Assigned Physiotherapist.');
      return;
    }
    if (!formData.visitType) {
      toast.error('Visit Type is mandatory.');
      return;
    }
    if (!formData.numberOfSessions || Number(formData.numberOfSessions) < 1) {
      toast.error('Number of Sessions must be at least 1.');
      return;
    }
    if (!formData.bloodType) {
      toast.error('Blood Type is mandatory.');
      return;
    }

    setIsSubmitting(true);
    try {
      const newId = `PAT-${Date.now()}`;
      const nowIso = new Date().toISOString();
      const payload = stripUndefined({
        id: newId,
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        address: formData.address.trim() || undefined,
        dob: formData.dob,
        gender: '',
        nationality: 'Lebanon',
        level: 'Novice',
        height: '',
        weight: '',
        allergies: '',
        healthProblems: formData.medicalHistory.trim(),
        maritalStatus: formData.maritalStatus || undefined,
        occupation: formData.occupation.trim() || undefined,
        assignedPhysiotherapistId: formData.assignedPhysiotherapistId || undefined,
        assignedPhysiotherapistName: chosenTherapistName,
        physioAssignedTherapistId: formData.assignedPhysiotherapistId || undefined,
        referringPhysician: formData.referringPhysician.trim() || undefined,
        emergencyContactName: formData.emergencyContactName.trim() || undefined,
        emergencyContactPhone: formData.emergencyContactPhone.trim() || undefined,
        emergencyContactRelationship: formData.emergencyContactRelationship.trim() || undefined,
        isInsured: Boolean(formData.isInsured),
        insuranceCompanyName: formData.isInsured ? formData.insuranceCompanyName.trim() : undefined,
        visitType: formData.visitType,
        numberOfSessions: Number(formData.numberOfSessions) || 1,
        physioEstimatedSessions: Number(formData.numberOfSessions) || 1,
        physioCompletedSessions: 0,
        bloodType: formData.bloodType,
        scanImageUrl: formData.scanImageUrl || undefined,
        scanImageName: formData.scanImageName || undefined,
        physioDiagnosis: formData.physioDiagnosis.trim() || formData.visitType,
        medicalHistory: formData.medicalHistory.trim() || undefined,
        physioCaseStatus: 'Active Treatment',
        isPhysioPatient: true,
        intakeSource: 'self_link',
        intakeToken: token || 'physio',
        memberType: 'full',
        status: 'active',
        balance: 0,
        qrCode: `MEM-${newId}`,
        checkIns: [],
        createdAt: nowIso,
        updatedAt: nowIso
      });

      await setDoc(doc(db, 'members', newId), payload);
      await setDoc(doc(db, 'physio_intake_submissions', newId), {
        ...payload,
        submittedAt: nowIso
      });

      setIsSubmitted(true);
      toast.success('Registration submitted! Reception has received your clinical profile.');
    } catch (error: any) {
      console.error('Failed to submit self-intake:', error);
      toast.error('Could not submit registration. Please check your connection or ask reception for assistance.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="dark [color-scheme:dark] min-h-screen bg-[#05070A] text-zinc-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#0B0F17] border border-zinc-800 rounded-3xl p-8 text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
            <CheckCircle2 size={34} />
          </div>
          <div className="space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#00B8C8]">
              Vescio Nexus Clinical Intake
            </span>
            <h1 className="text-2xl font-black tracking-tight text-white">
              Registration Complete
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Thank you, <span className="text-white font-bold">{formData.firstName} {formData.lastName}</span>. Your Physiotherapy & Clinical Intake File has been securely transmitted to our reception desk and your assigned physiotherapist.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-[#05070A] border border-zinc-800/80 text-left text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-zinc-500">Assigned Physiotherapist:</span>
              <span className="font-bold text-[#00B8C8]">{formData.assignedPhysiotherapistName || therapistSearch}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Visit Type:</span>
              <span className="font-bold text-zinc-200">{formData.visitType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Planned Sessions:</span>
              <span className="font-bold font-mono text-zinc-200">{formData.numberOfSessions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Blood Type:</span>
              <span className="font-bold font-mono text-rose-400">{formData.bloodType}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dark [color-scheme:dark] min-h-screen bg-[#05070A] text-zinc-100 py-8 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header Card */}
        <div className="bg-[#0B0F17] border border-zinc-800/90 rounded-3xl p-6 sm:p-8 shadow-xl">
          <div className="flex items-center gap-3.5 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-[#00B8C8]/15 border border-[#00B8C8]/30 flex items-center justify-center text-[#00B8C8] shrink-0">
              <Activity size={24} />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#00B8C8]">
                Physiotherapy & Sports Rehabilitation Clinic
              </span>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                Patient Clinical Registration Form
              </h1>
            </div>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Please complete your clinical registration details below. Fields marked with <span className="text-rose-400 font-bold">*</span> are mandatory.
          </p>
        </div>

        {/* Intake Form */}
        <form onSubmit={handleSubmit} className="bg-[#0B0F17] border border-zinc-800/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl">
          {/* 1. Personal Identity */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
              <User size={15} className="text-[#00B8C8]" />
              <h2 className="text-xs font-black uppercase tracking-wider text-[#00B8C8]">
                1. Patient Personal Information
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  First Name <span className="text-rose-400">*</span>
                </label>
                <input
                  required
                  type="text"
                  placeholder="Enter first name"
                  value={formData.firstName}
                  onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Last Name <span className="text-rose-400">*</span>
                </label>
                <input
                  required
                  type="text"
                  placeholder="Enter last name"
                  value={formData.lastName}
                  onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Phone Number <span className="text-rose-400">*</span>
                </label>
                <input
                  required
                  type="tel"
                  placeholder="+961 70 000 000"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Email Address <span className="text-zinc-500 font-normal">(Optional)</span>
                </label>
                <input
                  type="email"
                  placeholder="patient@example.com"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                Residential Address <span className="text-zinc-500 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                placeholder="City, Street, Building..."
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
                className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Date of Birth <span className="text-rose-400">*</span>
                </label>
                <input
                  required
                  type="date"
                  value={formData.dob}
                  onChange={e => setFormData({ ...formData, dob: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-sm [color-scheme:dark] focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Marital Status <span className="text-zinc-500 font-normal">(Optional)</span>
                </label>
                <select
                  value={formData.maritalStatus}
                  onChange={e => setFormData({ ...formData, maritalStatus: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-100 [color-scheme:dark] text-sm focus:outline-none focus:border-[#00B8C8]"
                >
                  <option value="">Select Status...</option>
                  {MARITAL_STATUSES.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Occupation <span className="text-zinc-500 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Engineer, Athlete"
                  value={formData.occupation}
                  onChange={e => setFormData({ ...formData, occupation: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
            </div>
          </div>

          {/* 2. Clinical & Visit Details */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
              <HeartPulse size={15} className="text-[#00B8C8]" />
              <h2 className="text-xs font-black uppercase tracking-wider text-[#00B8C8]">
                2. Clinical Assignment & Visit Details
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Autocomplete Physiotherapist */}
              <div className="relative">
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Assigned Physiotherapist <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    required
                    type="text"
                    placeholder="Type physiotherapist name..."
                    value={therapistSearch}
                    onFocus={() => setIsTherapistDropdownOpen(true)}
                    onChange={e => {
                      setTherapistSearch(e.target.value);
                      setFormData(prev => ({
                        ...prev,
                        assignedPhysiotherapistName: e.target.value,
                        assignedPhysiotherapistId: ''
                      }));
                      setIsTherapistDropdownOpen(true);
                    }}
                    className="w-full pl-9 pr-3 py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                  />
                </div>
                {isTherapistDropdownOpen && filteredTherapists.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl max-h-48 overflow-y-auto divide-y divide-zinc-800">
                    {filteredTherapists.map(t => {
                      const fullLabel = `Dr. ${t.firstName} ${t.lastName}`;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setTherapistSearch(fullLabel);
                            setFormData(prev => ({
                              ...prev,
                              assignedPhysiotherapistId: t.id,
                              assignedPhysiotherapistName: fullLabel
                            }));
                            setIsTherapistDropdownOpen(false);
                          }}
                          className="w-full px-3.5 py-2.5 text-left text-xs hover:bg-[#00B8C8]/15 flex items-center justify-between text-zinc-100"
                        >
                          <span className="font-bold">{fullLabel}</span>
                          {t.specialty && <span className="text-[10px] text-[#00B8C8]">{t.specialty}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Referring Physician <span className="text-zinc-500 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Dr. Name (if referred)"
                  value={formData.referringPhysician}
                  onChange={e => setFormData({ ...formData, referringPhysician: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Visit Type <span className="text-rose-400">*</span>
                </label>
                <select
                  required
                  value={formData.visitType}
                  onChange={e => setFormData({ ...formData, visitType: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-100 [color-scheme:dark] text-sm focus:outline-none focus:border-[#00B8C8]"
                >
                  {VISIT_TYPES.map(vt => (
                    <option key={vt} value={vt}>{vt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Number of Sessions <span className="text-rose-400">*</span>
                </label>
                <input
                  required
                  type="number"
                  min={1}
                  max={200}
                  value={formData.numberOfSessions}
                  onChange={e => setFormData({ ...formData, numberOfSessions: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white font-mono text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Blood Type <span className="text-rose-400">*</span>
                </label>
                <select
                  required
                  value={formData.bloodType}
                  onChange={e => setFormData({ ...formData, bloodType: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-100 [color-scheme:dark] font-mono text-sm focus:outline-none focus:border-[#00B8C8]"
                >
                  {BLOOD_TYPES.map(bt => (
                    <option key={bt} value={bt}>{bt}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 3. Insurance & Emergency Contact */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
              <ShieldCheck size={15} className="text-[#00B8C8]" />
              <h2 className="text-xs font-black uppercase tracking-wider text-[#00B8C8]">
                3. Emergency Contact & Insurance Coverage (Optional)
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Emergency Contact Name
                </label>
                <input
                  type="text"
                  placeholder="Full Name"
                  value={formData.emergencyContactName}
                  onChange={e => setFormData({ ...formData, emergencyContactName: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Emergency Contact Phone
                </label>
                <input
                  type="tel"
                  placeholder="+961 ..."
                  value={formData.emergencyContactPhone}
                  onChange={e => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                  Relationship
                </label>
                <input
                  type="text"
                  placeholder="e.g. Spouse, Parent, Sibling"
                  value={formData.emergencyContactRelationship}
                  onChange={e => setFormData({ ...formData, emergencyContactRelationship: e.target.value })}
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                />
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#05070A] border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-zinc-200">Medical Insurance Coverage</div>
                  <div className="text-[11px] text-zinc-500">Is the patient covered by a health insurance provider?</div>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, isInsured: !prev.isInsured }))}
                  className={`px-4 py-1.5 rounded-xl text-xs font-bold uppercase transition-all border ${
                    formData.isInsured
                      ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8]'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                  }`}
                >
                  {formData.isInsured ? 'Insured: YES' : 'Insured: NO'}
                </button>
              </div>
              {formData.isInsured && (
                <div>
                  <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1.5">
                    Insurance Company Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Bankers, MedGulf, Allianz SNA, GlobeMed..."
                    value={formData.insuranceCompanyName}
                    onChange={e => setFormData({ ...formData, insuranceCompanyName: e.target.value })}
                    className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:border-[#00B8C8]"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 4. Scan / X-Ray Upload */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
              <FileText size={15} className="text-[#00B8C8]" />
              <h2 className="text-xs font-black uppercase tracking-wider text-[#00B8C8]">
                4. Diagnostic Scan / X-Ray / MRI Image (Optional)
              </h2>
            </div>

            <div className="p-4 rounded-2xl border border-dashed border-zinc-700 bg-[#05070A] text-center space-y-3">
              <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-bold text-[#00B8C8] transition-all">
                <Upload size={15} />
                <span>{formData.scanImageName ? 'Replace Scan / Image' : 'Upload Scan Image or PDF'}</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleScanUpload}
                  className="hidden"
                />
              </label>
              {formData.scanImageName && (
                <div className="space-y-2">
                  <div className="text-xs text-emerald-400 font-bold">
                    Attached: {formData.scanImageName}
                  </div>
                  {formData.scanImageUrl.startsWith('data:image') && (
                    <img
                      src={formData.scanImageUrl}
                      alt="Scan preview"
                      className="max-h-48 mx-auto rounded-xl border border-zinc-800 object-contain"
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-2xl bg-[#00B8C8] hover:bg-[#0099A8] disabled:opacity-50 text-slate-950 font-black text-sm uppercase tracking-wider transition-all shadow-lg shadow-cyan-500/20"
          >
            {isSubmitting ? 'Submitting Clinical Profile...' : 'Submit Patient Registration'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PatientSelfIntakePage;
