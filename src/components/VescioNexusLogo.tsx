import React from 'react';
import { useNavigate } from 'react-router-dom';

export interface VescioNexusLogoProps {
  variant?: 'horizontal' | 'stacked' | 'mark-only';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showVescioPrefix?: boolean;
  className?: string;
  onClick?: () => void;
}

export const VescioNexusLogo: React.FC<VescioNexusLogoProps> = ({
  variant = 'horizontal',
  size = 'md',
  showVescioPrefix = true,
  className = '',
  onClick,
}) => {
  const navigate = useNavigate();
  const handleLogoClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate('/');
    }
  };

  const sizeConfig = {
    sm: {
      svgWidth: 44,
      svgHeight: 22,
      vescioText: 'text-[10px] tracking-[0.22em]',
      nexusText: 'text-sm tracking-[0.24em]',
      stackedText: 'text-xs tracking-[0.26em]',
      gap: 'gap-2',
      stackedGap: 'mt-1',
    },
    md: {
      svgWidth: 56,
      svgHeight: 28,
      vescioText: 'text-[11px] tracking-[0.24em]',
      nexusText: 'text-base tracking-[0.25em]',
      stackedText: 'text-sm tracking-[0.26em]',
      gap: 'gap-2.5',
      stackedGap: 'mt-1.5',
    },
    lg: {
      svgWidth: 74,
      svgHeight: 37,
      vescioText: 'text-xs tracking-[0.26em]',
      nexusText: 'text-xl tracking-[0.26em]',
      stackedText: 'text-lg tracking-[0.28em]',
      gap: 'gap-3',
      stackedGap: 'mt-1.5',
    },
    xl: {
      svgWidth: 108,
      svgHeight: 54,
      vescioText: 'text-sm tracking-[0.28em]',
      nexusText: 'text-2xl tracking-[0.28em]',
      stackedText: 'text-xl tracking-[0.30em]',
      gap: 'gap-3.5',
      stackedGap: 'mt-2',
    },
  }[size];

  const renderMark = () => (
    <svg
      width={sizeConfig.svgWidth}
      height={sizeConfig.svgHeight}
      viewBox="0 0 120 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 select-none"
      aria-label="Vescio Nexus Icon Mark"
    >
      {/* Left Open Ring (centered at cx=34, cy=30, r=22, open on right side facing center) */}
      <path
        d="M 52.02 17.38 A 22 22 0 1 0 52.02 42.62"
        fill="none"
        stroke="#00B8C8"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      {/* Right Open Ring (centered at cx=86, cy=30, r=22, open on left side facing center) */}
      <path
        d="M 67.98 42.62 A 22 22 0 1 0 67.98 17.38"
        fill="none"
        stroke="#00B8C8"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      {/* Center Core Node (exact midpoint cx=60, cy=30, r=5) */}
      <circle
        cx="60"
        cy="30"
        r="5"
        className="fill-slate-900 dark:fill-white transition-colors"
        style={{ filter: 'drop-shadow(0 0 6px rgba(0,184,200,0.6))' }}
      />
    </svg>
  );

  if (variant === 'mark-only') {
    return (
      <div
        onClick={handleLogoClick}
        title="Return to Dashboard"
        className={`inline-flex items-center justify-center cursor-pointer hover:opacity-85 transition-opacity ${className}`}
      >
        {renderMark()}
      </div>
    );
  }

  if (variant === 'stacked') {
    return (
      <div
        onClick={handleLogoClick}
        title="Return to Dashboard"
        className={`inline-flex flex-col items-center justify-center select-none cursor-pointer hover:opacity-85 transition-opacity ${className}`}
      >
        {renderMark()}
        <div className={`flex flex-col items-center leading-none ${sizeConfig.stackedGap}`}>
          {showVescioPrefix && (
            <span
              className={`font-bold uppercase text-slate-900 dark:text-zinc-100 ${sizeConfig.vescioText} mb-0.5`}
            >
              VESCIO
            </span>
          )}
          <span
            className={`font-black uppercase text-[#00B8C8] ${sizeConfig.stackedText}`}
          >
            NEXUS
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={handleLogoClick}
      title="Return to Dashboard"
      className={`inline-flex items-center ${sizeConfig.gap} select-none cursor-pointer hover:opacity-85 transition-opacity ${className}`}
    >
      {renderMark()}
      <div className="flex flex-col justify-center leading-none">
        {showVescioPrefix && (
          <span
            className={`font-bold uppercase text-slate-900 dark:text-zinc-100 ${sizeConfig.vescioText} mb-0.5`}
          >
            VESCIO
          </span>
        )}
        <span
          className={`font-black uppercase text-[#00B8C8] ${sizeConfig.nexusText}`}
        >
          NEXUS
        </span>
      </div>
    </div>
  );
};

export interface TenantBrandLockupProps {
  systemName?: string;
  systemLogo?: string | null;
  size?: 'sm' | 'md' | 'lg';
  subtitle?: string;
  className?: string;
  onClick?: () => void;
}

export const TenantBrandLockup: React.FC<TenantBrandLockupProps> = ({
  systemName = 'Vescio Nexus',
  systemLogo,
  size = 'md',
  subtitle,
  className = '',
  onClick,
}) => {
  const navigate = useNavigate();
  const handleLockupClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate('/');
    }
  };

  const normalized = (systemName || '').trim().toLowerCase();
  const isDefaultBrand =
    !normalized ||
    normalized === 'vescio nexus' ||
    normalized === 'nexus' ||
    normalized === 'elite os' ||
    normalized === 'up erp';

  if (isDefaultBrand && !systemLogo) {
    return (
      <div
        onClick={handleLockupClick}
        title="Return to Dashboard"
        className={`inline-flex items-center gap-3 cursor-pointer hover:opacity-85 transition-opacity ${className}`}
      >
        <VescioNexusLogo variant="horizontal" size={size} showVescioPrefix={true} onClick={handleLockupClick} />
        {subtitle && (
          <>
            <div className="h-5 w-px bg-slate-200 dark:bg-zinc-800 hidden sm:block" />
            <span className="text-sm font-semibold tracking-wide text-slate-700 dark:text-zinc-200 whitespace-nowrap">
              {subtitle}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={handleLockupClick}
      title="Return to Dashboard"
      className={`inline-flex items-center gap-3 cursor-pointer hover:opacity-85 transition-opacity ${className}`}
    >
      <VescioNexusLogo variant="mark-only" size={size === 'lg' ? 'md' : 'sm'} onClick={handleLockupClick} />
      <div className="h-6 w-px bg-slate-200 dark:bg-zinc-800" />
      {systemLogo && (
        <img
          src={systemLogo}
          alt={systemName}
          className="h-8 w-8 rounded-lg object-contain bg-white/5 border border-slate-200/60 dark:border-zinc-800 p-0.5 shrink-0"
        />
      )}
      <div className="flex flex-col justify-center leading-tight">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-900 dark:text-zinc-100 tracking-tight text-sm sm:text-base whitespace-nowrap">
            {systemName}
          </span>
          {subtitle && (
            <span className="text-xs font-semibold text-[#00B8C8] whitespace-nowrap hidden md:inline-block">
              · {subtitle}
            </span>
          )}
        </div>
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#00B8C8]">
          Powered by VESCIO NEXUS
        </span>
      </div>
    </div>
  );
};

export default VescioNexusLogo;
