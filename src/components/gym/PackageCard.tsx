import React from 'react';
import { Trash2, Edit2 } from 'lucide-react';
import { GymPackage } from '../../types';

interface PackageCardProps {
  pkg: GymPackage;
  theme: 'dark' | 'light';
  onDelete: (id: string) => void;
  onEdit?: (pkg: GymPackage) => void;
  isDiscountValid: (pkg: GymPackage) => boolean;
}

export const PackageCard: React.FC<PackageCardProps> = ({ pkg, theme, onDelete, onEdit, isDiscountValid }) => {
  const effectivePrice = pkg.priceOverride !== undefined && pkg.priceOverride > 0
    ? pkg.priceOverride
    : isDiscountValid(pkg)
      ? Math.max(0, (pkg.price * (1 - (pkg.discountPercent || 0) / 100)) - (pkg.discountAmount || 0))
      : Math.max(0, pkg.price - (pkg.discountAmount || 0));

  const hasDiscount = effectivePrice < pkg.price;

  return (
    <div className={`p-6 rounded-xl border transition-all group ${
      theme === 'dark' ? 'bg-[#0B0F17]/90 border-zinc-800/80 hover:border-cyan-500/40' : 'bg-white border-slate-200 hover:border-cyan-500/40'
    }`}>
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          {pkg.image && (
            <div className="w-12 h-12 rounded-lg overflow-hidden border border-zinc-700">
              <img src={pkg.image} alt={pkg.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
          )}
          <div>
            <h3 className="text-lg font-bold">{pkg.name}</h3>
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{pkg.duration} Month{pkg.duration > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <button
              onClick={() => onEdit(pkg)}
              className="p-2 rounded-lg hover:bg-cyan-500/10 text-zinc-400 hover:text-[#00B8C8] transition-colors"
              title="Edit Package"
            >
              <Edit2 size={16} />
            </button>
          )}
          <button 
            onClick={() => onDelete(pkg.id)}
            className="p-2 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-500 transition-colors"
            title="Delete Package"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      
      <div className="mb-6">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-[#00B8C8]">
            ${effectivePrice.toFixed(0)}
          </span>
          {hasDiscount && (
            <span className="text-sm text-zinc-500 line-through">${pkg.price}</span>
          )}
          <span className="text-zinc-500 text-xs">/ package</span>
        </div>
        {hasDiscount && (
          <div className="flex flex-col gap-1 mt-1">
            <div className="inline-block self-start px-1.5 py-0.5 bg-green-500/10 text-green-500 text-[10px] font-bold rounded">
              {pkg.priceOverride ? 'CUSTOM PRICE OVERRIDE' : pkg.discountAmount ? `$${pkg.discountAmount} OFF` : `${pkg.discountPercent}% OFF`}
            </div>
            {pkg.discountExpiry && (
              <div className="text-[9px] text-zinc-500 font-medium">
                Expires: {new Date(pkg.discountExpiry).toLocaleDateString()}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Sessions</span>
          <span className={`font-bold ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>{pkg.sessions}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Type</span>
          <span className={`font-bold ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'} capitalize`}>{pkg.type}</span>
        </div>
        {pkg.type === 'group' && (
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Max People</span>
            <span className={`font-bold ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>{pkg.maxPeople}</span>
          </div>
        )}
      </div>

      {pkg.addons.length > 0 && (
        <div className={`mt-6 pt-6 border-t ${theme === 'dark' ? 'border-zinc-700' : 'border-zinc-100'}`}>
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest block mb-3">Add-ons Available</span>
          <div className="flex flex-wrap gap-2">
            {pkg.addons.map((addon, idx) => (
              <div 
                key={idx} 
                className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${
                  theme === 'dark' 
                    ? 'bg-zinc-900/50 text-zinc-300 border-zinc-800' 
                    : 'bg-zinc-100 text-zinc-700 border-zinc-200'
                }`}
              >
                {addon.name} (+${addon.price})
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
