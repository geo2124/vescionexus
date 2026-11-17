import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Clock, Edit2, CreditCard, Download, Trash2, Plus, Snowflake, Play } from 'lucide-react';
import { Member, GymPackage, COUNTRIES } from '../../types';

interface MemberRowProps {
  member: Member;
  pkg: GymPackage | undefined;
  status: string;
  theme: 'dark' | 'light';
  onEdit: (member: Member) => void;
  onBilling: (member: Member) => void;
  onUnpay: (id: string) => void;
  onDownloadCard: (member: Member) => void;
  onToggleStatus: (id: string) => void;
  onToggleFreeze?: (member: Member) => void;
  onDelete: (id: string) => void;
  onRenew: (id: string) => void;
  onViewDetails: (member: Member) => void;
}

export const MemberRow: React.FC<MemberRowProps> = ({ 
  member, pkg, status, theme, onEdit, onBilling, onUnpay, onDownloadCard, onToggleStatus, onToggleFreeze, onDelete, onRenew, onViewDetails 
}) => {
  const expectedFee = member.packageId === 'walk-in' ? (member.expectedFee || 0) : (member.expectedFee || pkg?.price || 0);
  const totalPaid = member.totalPaid || 0;
  const remainingBalance = Math.max(0, expectedFee - totalPaid);

  const cycleUsedSessions = member.currentCycleCheckIns !== undefined
    ? member.currentCycleCheckIns
    : (member.checkIns || []).filter(ci => !member.startDate || ci.date >= member.startDate).length;
  const isQuotaExhausted = pkg && pkg.sessions > 0 && cycleUsedSessions >= pkg.sessions;
  const canRenew = status !== 'active' || isQuotaExhausted;

  return (
    <tr className="group hover:bg-zinc-100/50 dark:hover:bg-zinc-900/40 transition-colors">
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">{COUNTRIES.find(c => c.name === member.nationality)?.flag || '🏳️'}</span>
          <div>
            <button 
              onClick={() => onViewDetails(member)}
              className="font-medium hover:underline text-left"
            >
              {member.firstName} {member.lastName}
            </button>
            <div className="text-xs text-zinc-500">{member.phone}</div>
            {member.groupMembers && member.groupMembers.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/20">
                  Group ({member.groupMembers.length + 1})
                </span>
                {member.groupMembers.map((gm, idx) => (
                  <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-300 border border-zinc-700">
                    {gm.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className={`el-badge transition-colors ${
          member.level === 'Expert' ? 'bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/20' :
          member.level === 'Intermediate' ? 'el-badge-info' :
          'el-badge-neutral'
        }`}>
          {member.level}
        </span>
      </td>
      <td className="px-6 py-4 text-sm text-zinc-400">
        <div>{member.packageId === 'walk-in' ? 'Walk-in' : (pkg?.name || 'N/A')}</div>
        {member.assignedCoachName && (
          <div className="text-[11px] text-[#00B8C8] font-medium mt-0.5">
            Coach: {member.assignedCoachName}
          </div>
        )}
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <span className={`el-badge transition-colors ${
            member.isFrozen || status === 'frozen' ? 'bg-cyan-500/10 text-cyan-500 border border-cyan-500/20' :
            status === 'active' ? 'el-badge-success' : 
            status === 'expire soon' ? 'el-badge-warning animate-pulse' :
            status === 'expired' ? 'el-badge-danger' : 'el-badge-neutral'
          }`}>
            {member.isFrozen || status === 'frozen' ? <Snowflake size={10} /> :
             status === 'active' ? <CheckCircle2 size={10} /> : 
             status === 'expire soon' ? <AlertTriangle size={10} /> :
             <XCircle size={10} />}
            {member.isFrozen ? 'frozen' : status}
          </span>
          {member.packageId !== 'walk-in' && (
            <button
              onClick={() => onRenew(member.id)}
              disabled={!canRenew}
              className={`p-1.5 rounded-lg transition-all ${
                !canRenew 
                  ? 'text-zinc-600 cursor-not-allowed opacity-50' 
                  : 'text-[#00B8C8] hover:bg-cyan-500/10'
              }`}
              title="Renew Membership"
            >
              <Plus size={14} />
            </button>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-sm font-medium">
        <div>${expectedFee}</div>
        {totalPaid > 0 && remainingBalance > 0 && (
          <div className="text-[11px] text-amber-500 font-normal">
            Paid: ${totalPaid} (Due: ${remainingBalance})
          </div>
        )}
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          <span className={`el-badge transition-colors w-fit ${
            member.billingStatus === 'paid' ? 'el-badge-success' :
            totalPaid > 0 ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'el-badge-warning'
          }`}>
            {member.billingStatus === 'paid' ? <CheckCircle2 size={10} /> : <Clock size={10} />}
            {member.billingStatus === 'paid' ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid'}
          </span>
        </div>
      </td>
      <td className="px-6 py-4 text-sm">
        <div className="flex items-center gap-2 text-zinc-400">
          <Clock size={14} />
          {member.expiryDate ? new Date(member.expiryDate).toLocaleDateString() : 'N/A'}
        </div>
      </td>
      <td className="px-6 py-4 text-center">
        <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => onEdit(member)}
            className="el-btn-ghost"
            title="Edit Profile"
          >
            <Edit2 size={16} />
          </button>
          {member.billingStatus === 'paid' ? (
            <button 
              onClick={() => onUnpay(member.id)}
              className="el-btn-ghost text-red-500 hover:text-red-600 hover:bg-red-50"
              title="Unpay"
            >
              <XCircle size={16} />
            </button>
          ) : (
            <button 
              onClick={() => onBilling(member)}
              className="el-btn-ghost"
              title="Pay Now"
            >
              <CreditCard size={16} />
            </button>
          )}
          <button 
            onClick={() => onDownloadCard(member)}
            className="el-btn-ghost"
            title="Download ID Card"
          >
            <Download size={16} />
          </button>
          {onToggleFreeze && member.packageId !== 'walk-in' && (
            <button
              onClick={() => onToggleFreeze(member)}
              className={`el-btn-ghost ${member.isFrozen ? 'text-cyan-500 hover:text-cyan-600' : 'text-zinc-400 hover:text-cyan-500'}`}
              title={member.isFrozen ? 'Unfreeze Membership (Extends Expiry)' : 'Freeze Membership'}
            >
              {member.isFrozen ? <Play size={16} /> : <Snowflake size={16} />}
            </button>
          )}
          <button 
            onClick={() => onToggleStatus(member.id)}
            className="el-btn-ghost"
            title={member.status === 'active' ? 'Deactivate' : 'Activate'}
          >
            {member.status === 'active' ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          </button>
          <button 
            onClick={() => onDelete(member.id)}
            className="el-btn-ghost text-zinc-400 hover:text-red-500 hover:bg-red-50"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
};
