import React from 'react';
import { Edit2, CreditCard, XCircle, Trash2, Eye } from 'lucide-react';
import { Coach, CoachContract, CoachPackage } from '../../types';

interface CoachRowProps {
  coach: Coach;
  contract: CoachContract | undefined;
  pkg: CoachPackage | undefined;
  sessionsMade: number;
  maxSessions: number;
  status: string;
  theme: 'dark' | 'light';
  onEdit: (coach: Coach) => void;
  onBilling: (coach: Coach) => void;
  onUnpay: (id: string) => void;
  onDelete: (id: string) => void;
  onEditContract: (contract: CoachContract | null) => void;
  onViewDetails: (coach: Coach) => void;
  onResetSessions?: () => void;
}

export const CoachRow: React.FC<CoachRowProps> = ({ 
  coach, contract, pkg, sessionsMade, maxSessions, status, theme, onEdit, onBilling, onUnpay, onDelete, onEditContract, onViewDetails, onResetSessions
}) => {
  const mode = contract?.contractMode || coach.contractMode || (coach.thirdPartyContractId ? 'third_party' : pkg ? 'package' : 'session_bypass');
  const baseFee1 = contract?.baseFeeOneClient ?? coach.baseFeeOneClient ?? coach.hourRate ?? 0;
  const extraFee = contract?.extraClientFee ?? coach.extraClientFee ?? 0;
  const accrued = coach.accruedSessionFees || contract?.accruedSessionFees || 0;
  const paid = coach.totalPaidFees || (contract?.paymentHistory || []).reduce((s, p) => s + p.amount, 0) || 0;
  const totalLiabilityOrDue = mode === 'package' ? (contract?.price || 0) : accrued;

  return (
    <tr className="group hover:bg-zinc-100/50 dark:hover:bg-zinc-800/60 transition-colors">
      <td className="px-6 py-4 font-medium">
        <button 
          onClick={() => onViewDetails(coach)}
          className="hover:text-[#00B8C8] hover:underline text-left text-zinc-900 dark:text-zinc-100 font-bold flex items-center gap-2"
        >
          <span>{coach.firstName} {coach.lastName}</span>
        </button>
        {coach.thirdPartyName && (
          <div className="text-[10px] text-[#00B8C8] font-bold uppercase tracking-wider mt-0.5">
            Partner: {coach.thirdPartyName}
          </div>
        )}
      </td>
      <td className="px-6 py-4 text-xs">
        <span className={`el-badge transition-colors ${
          coach.type === 'inhouse' ? 'el-badge-info' :
          coach.type === 'third_party' || coach.thirdPartyContractId ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
          'bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/20'
        }`}>
          {coach.type === 'inhouse' ? 'In-House' : (coach.type === 'third_party' || coach.thirdPartyContractId) ? '3rd-Party' : 'Freelance'}
        </span>
      </td>
      <td className="px-6 py-4 text-xs">
        <div className="font-semibold text-zinc-200">
          {mode === 'package' && pkg ? pkg.name : mode === 'third_party' ? (coach.thirdPartyName || '3rd-Party B2B') : coach.type === 'inhouse' ? 'Staff Contract' : 'Per-Session Tiered'}
        </div>
        {(baseFee1 > 0 || extraFee > 0) && (
          <div className="text-[10px] text-zinc-500 mt-0.5">
            1st: ${baseFee1} {extraFee > 0 ? `| +$${extraFee}/extra` : ''}
          </div>
        )}
      </td>
      <td className="px-6 py-4 text-xs font-mono">
        {maxSessions > 0 ? `${sessionsMade} / ${maxSessions}` : `${sessionsMade} sessions`}
      </td>
      <td className="px-6 py-4 text-xs">{contract?.startDate || 'Active'}</td>
      <td className="px-6 py-4 text-xs">
        <span className={`el-badge transition-colors ${status === 'active' ? 'el-badge-success' : 'el-badge-neutral'}`}>
          {status}
        </span>
      </td>
      <td className="px-6 py-4 text-xs font-mono">
        <div className="font-bold text-zinc-200">${totalLiabilityOrDue.toFixed(2)}</div>
        {paid > 0 && (
          <div className="text-[10px] text-emerald-400">Paid: ${paid.toFixed(2)}</div>
        )}
      </td>
      <td className="px-6 py-4 text-xs">
        <span className={`el-badge transition-colors ${
          contract?.billingStatus === 'paid' || (totalLiabilityOrDue > 0 && paid >= totalLiabilityOrDue)
            ? 'el-badge-success'
            : 'el-badge-warning'
        }`}>
          {contract?.billingStatus === 'paid' || (totalLiabilityOrDue > 0 && paid >= totalLiabilityOrDue) ? 'Paid' : 'Open / Unpaid'}
        </span>
      </td>
      <td className="px-6 py-4 text-center">
        <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onViewDetails(coach)}
            className="el-btn-ghost text-[#00B8C8] hover:bg-cyan-500/10"
            title="Open 360° Coach Profile"
          >
            <Eye size={16} />
          </button>
          {coach.type === 'inhouse' && (
            <button 
              onClick={onResetSessions}
              className="el-btn-ghost text-[#00B8C8] hover:text-[#0099A8] hover:bg-cyan-500/10"
              title="Reset Monthly Sessions"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button 
            onClick={() => onEdit(coach)}
            className="el-btn-ghost"
            title="Edit Profile"
          >
            <Edit2 size={16} />
          </button>
          {coach.type !== 'inhouse' && (
            contract?.billingStatus === 'paid' ? (
              <button 
                onClick={() => onUnpay(contract.id)}
                className="el-btn-ghost text-red-500 hover:text-red-600 hover:bg-red-50"
                title="Unpay"
              >
                <XCircle size={16} />
              </button>
            ) : (
              <button 
                onClick={() => onBilling(coach)}
                className="el-btn-ghost text-emerald-400 hover:bg-emerald-500/10"
                title="Record Payment / Settlement"
              >
                <CreditCard size={16} />
              </button>
            )
          )}
          {coach.type !== 'inhouse' && (
            <button 
              onClick={() => onEditContract(contract || null)}
              className="el-btn-ghost"
              title="Configure Contract / Tiered Session Fees"
            >
              <Edit2 size={16} />
            </button>
          )}
          <button 
            onClick={() => onDelete(coach.id)}
            className="el-btn-ghost text-zinc-400 hover:text-red-500 hover:bg-red-50" 
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
};

