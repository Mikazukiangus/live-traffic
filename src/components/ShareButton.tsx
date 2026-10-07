import React, { useState } from 'react';

interface ShareButtonProps {
  title: string;
  className?: string;
}

/** Shares the current address (the phone's share sheet where there is one), else copies it. */
export const ShareButton: React.FC<ShareButtonProps> = ({ title, className = '' }) => {
  const [copied, setCopied] = useState(false);

  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = window.location.href;
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title, url });
      } catch {
        // Share sheet dismissed
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  return (
    <button
      onClick={share}
      aria-label={copied ? 'Link copied' : 'Share link to this view'}
      title={copied ? 'Link copied' : 'Copy a link to this view'}
      className={`h-10 rounded-full bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs ${
        copied ? 'px-3 text-emerald-700' : 'w-10'
      } ${className}`}
    >
      <span className="material-symbols-outlined text-xl">{copied ? 'check' : 'share'}</span>
      {copied && <span className="text-xs font-semibold">Copied</span>}
    </button>
  );
};
