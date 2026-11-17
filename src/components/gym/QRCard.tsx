import React from 'react';
import { QrCode, Download } from 'lucide-react';
import { Member } from '../../types';
import { DynamicQRImage } from './DynamicQRImage';

interface QRCardProps {
  member: Member;
  theme: 'dark' | 'light';
  onDownloadCard: (member: Member) => void;
}

export const QRCard: React.FC<QRCardProps> = ({ member, theme, onDownloadCard }) => {
  return (
    <div className={`p-4 rounded-2xl border transition-all flex flex-col items-center text-center group ${
      theme === 'dark' ? 'bg-[#0B0F17]/90 border-zinc-800/80 hover:border-cyan-500/40' : 'bg-white border-slate-200/80 hover:border-cyan-500/50'
    }`}>
      <div className="w-full aspect-square bg-white p-2 rounded-xl mb-4 relative overflow-hidden flex flex-col justify-center items-center border border-slate-100">
        {member.qrCode ? (
          <DynamicQRImage value={member.qrCode} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-300">
            <QrCode size={48} />
          </div>
        )}
        <div className="absolute inset-0 bg-[#05070A]/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button 
            onClick={() => onDownloadCard(member)}
            className="p-3 bg-[#00B8C8] text-slate-950 rounded-full hover:scale-110 transition-transform shadow-lg shadow-cyan-500/30"
            title="Download ID Card"
          >
            <Download size={20} />
          </button>
        </div>
      </div>
      <h3 className="font-bold text-sm truncate w-full">{member.firstName} {member.lastName}</h3>
      <p className="text-[10px] text-[#00B8C8] font-mono font-bold uppercase tracking-wider mt-1">#{member.id.slice(-6)}</p>
      <button 
        onClick={() => onDownloadCard(member)}
        className="mt-4 w-full py-2 bg-[#00B8C8]/15 border border-[#00B8C8]/30 text-[#00B8C8] text-[10px] font-bold uppercase rounded-xl hover:bg-[#00B8C8] hover:text-slate-950 transition-colors flex items-center justify-center gap-2"
      >
        <Download size={12} /> Download ID Card
      </button>
    </div>
  );
};

