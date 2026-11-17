import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode } from 'lucide-react';

export const DynamicQRImage: React.FC<{ value: string; className?: string }> = ({ value, className }) => {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (value) {
      if (value.startsWith('data:image/')) {
        setSrc(value);
      } else {
        QRCode.toDataURL(value).then(setSrc).catch(console.error);
      }
    }
  }, [value]);

  if (!src) {
    return (
      <div className={`flex flex-col items-center justify-center bg-zinc-100 ${className || 'w-full h-full'}`}>
        <QrCode size={24} className="text-zinc-400 mb-2" />
        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider text-center">Generating QR</span>
      </div>
    );
  }

  return <img src={src} alt="Generating QR Code..." className={className || 'w-full h-full object-contain'} />;
};
