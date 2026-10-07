import React, { useState } from 'react';

interface CallModalProps {
  isOpen: boolean;
  onClose: () => void;
  phone: string;
  recipientName: string;
}

export const CallModal: React.FC<CallModalProps> = ({
  isOpen,
  onClose,
  phone,
  recipientName,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-5 sm:p-6 flex flex-col gap-4 shadow-2xl relative">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-sky-600">
            <span className="material-symbols-outlined text-2xl text-red-600">phone_in_talk</span>
            <h3 className="text-base sm:text-lg text-slate-900 font-bold">Direct Emergency Connect</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="text-center py-2 flex flex-col items-center gap-1.5">
          <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
            Connecting to
          </span>
          <h4 className="text-lg font-bold text-slate-900">{recipientName}</h4>
          <div className="font-mono text-2xl font-extrabold text-sky-600 tracking-wider my-2">
            {phone}
          </div>
        </div>

        {/* Safety Notice */}
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-slate-700 flex items-start gap-2">
          <span className="material-symbols-outlined text-amber-700 text-base shrink-0 mt-0.5">
            shield
          </span>
          <p className="leading-relaxed">
            <strong>Expressway Safety Rule:</strong> If you are on an expressway shoulder, step
            safely behind the metal crash barrier before making this phone call.
          </p>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={handleCopy}
            className="w-full py-2.5 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">
              {copied ? 'check' : 'content_copy'}
            </span>
            <span>{copied ? 'Number Copied!' : 'Copy Number'}</span>
          </button>

          <a
            href={`tel:${phone}`}
            className="w-full py-2.5 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">call</span>
            <span>Call Now</span>
          </a>
        </div>
      </div>
    </div>
  );
};
