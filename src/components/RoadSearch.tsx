import React, { useEffect, useRef, useState } from 'react';
import { RoadSearchResult, searchRoadsAndCameras } from '../utils/roadSearch';

interface RoadSearchProps {
  onSelect: (result: RoadSearchResult) => void;
}

/** Native dialog keeps keyboard focus inside search and restores it to the trigger on close. */
export const RoadSearch: React.FC<RoadSearchProps> = ({ onSelect }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = searchRoadsAndCameras(query);

  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      input.current?.focus();
    } else {
      dialog.current?.close();
    }
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`road-search-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (result: RoadSearchResult) => {
    setOpen(false);
    onSelect(result);
  };

  return (
    <>
      <button
        onClick={() => { setQuery(''); setActive(0); setOpen(true); }}
        aria-label="Search roads and cameras"
        aria-haspopup="dialog"
        className="h-11 min-w-11 md:w-52 xl:w-56 px-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 flex items-center gap-2 shrink-0"
      >
        <span className="material-symbols-outlined text-xl" aria-hidden="true">search</span>
        <span className="hidden md:inline text-sm">Road or camera</span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="road-search-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
        onKeyDown={(event) => event.stopPropagation()}
        className="fixed inset-x-0 top-20 bottom-auto mx-auto my-0 w-[calc(100%_-_2rem)] max-w-lg max-h-[calc(100dvh_-_7rem)] rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-scrim/70"
      >
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 id="road-search-title" className="text-lg font-bold">Find a road or camera</h2>
            <button aria-label="Close search" onClick={() => setOpen(false)} className="w-11 h-11 rounded-lg text-slate-500 hover:bg-slate-100">
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
          <input
            ref={input}
            aria-label="Road or camera name"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="road-search-results"
            aria-activedescendant={results.length ? `road-search-${active}` : undefined}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (results.length) setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
              } else if (event.key === 'Enter' && results[active]) {
                event.preventDefault();
                choose(results[active]);
              }
            }}
            placeholder="PIE, Woodlands, Causeway, 2701…"
            className="w-full h-12 px-3 rounded-xl bg-slate-50 border border-slate-200 text-base focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <ul id="road-search-results" role="listbox" aria-label="Matching roads and cameras" className="max-h-[min(24rem,45dvh)] overflow-y-auto p-2">
          {results.map((result, index) => (
            <li key={result.id}>
              <button
                id={`road-search-${index}`}
                role="option"
                aria-selected={index === active}
                onClick={() => choose(result)}
                className={`w-full min-h-16 text-left p-3 rounded-xl flex items-center gap-3 ${index === active ? 'bg-sky-50 text-sky-800' : 'text-slate-800 hover:bg-slate-50'}`}
              >
                <span className="material-symbols-outlined text-xl shrink-0" aria-hidden="true">{result.kind === 'camera' ? 'videocam' : 'route'}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{result.label}</span>
                  <span className="block text-xs text-slate-500 mt-0.5">{result.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {results.length === 0 && <p role="status" className="p-5 text-sm text-slate-500">No matches. Try an expressway code, checkpoint or camera number.</p>}
      </dialog>
    </>
  );
};
