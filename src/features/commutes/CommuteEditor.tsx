import React, { useState } from 'react';
import { TravelRoute } from '../../utils/ltaTravelTimes';
import { Commute, CommuteLeg, deleteCommute, saveCommute } from '../../utils/commutes';
import { forgetCommute } from '../../utils/commuteHistory';
import { LegEditor } from './LegEditor';
const UNPUBLISHED = ['KPE', 'MCE'];

export const CommuteEditor: React.FC<{ initial: Commute; routes: TravelRoute[]; onClose: () => void }> = ({
  initial,
  routes,
  onClose,
}) => {
  const [name, setName] = useState(initial.name);
  const [legs, setLegs] = useState<CommuteLeg[]>(
    initial.legs.length ? initial.legs : [{ code: '', direction: 0, from: '', to: '' }],
  );
  const isNew = !initial.legs.length;

  const update = (i: number, change: Partial<CommuteLeg>) =>
    setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, ...change } : l)));
  const complete = (l: CommuteLeg) => l.code && (UNPUBLISHED.includes(l.code) || (l.direction && l.from && l.to));
  const valid = name.trim() && legs.length > 0 && legs.every(complete);

  const save = () => {
    if (!valid) return;
    saveCommute({ ...initial, name: name.trim(), legs });
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isNew ? 'Add a commute' : 'Edit commute'}
        className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl p-5 flex flex-col gap-4 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{isNew ? 'Add a commute' : 'Edit commute'}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home to work"
            maxLength={40}
            className="h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          />
        </label>

        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-slate-700">Expressways, in the order you drive them</span>
          {legs.map((leg, i) => (
            <LegEditor
              key={i}
              index={i}
              leg={leg}
              routes={routes}
              onChange={(c) => update(i, c)}
              onRemove={legs.length > 1 ? () => setLegs((ls) => ls.filter((_, j) => j !== i)) : undefined}
            />
          ))}
          {legs.length < 4 && (
            <button
              onClick={() => setLegs((ls) => [...ls, { code: '', direction: 0, from: '', to: '' }])}
              className="self-start text-xs font-bold text-sky-700 hover:underline cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-base">add</span>Add another expressway
            </button>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Times are LTA's estimates for the stretches you pick. Your commutes are saved in this browser only.
        </p>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          {!isNew ? (
            <button
              onClick={() => {
                deleteCommute(initial.id);
                forgetCommute(initial.id);
                onClose();
              }}
              className="text-sm font-semibold text-red-700 hover:underline cursor-pointer"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={save}
            disabled={!valid}
            className="h-10 px-5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold disabled:opacity-40 cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
