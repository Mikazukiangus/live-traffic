import React, { useState } from 'react';
import { Commute, MAX_COMMUTES, useCommutes } from '../../utils/commutes';
import { MyCommuteProps } from './types';
import { CommuteCard } from './CommuteCard';
import { CommuteEditor } from './CommuteEditor';
export const MyCommute: React.FC<MyCommuteProps> = (props) => {
  const commutes = useCommutes();
  const [editing, setEditing] = useState<Commute | null>(null);

  return (
    <section id="commute" aria-label="My commute" className="flex flex-col gap-3 scroll-mt-24">
      {commutes.map((c) => (
        <CommuteCard key={c.id} commute={c} {...props} onEdit={() => setEditing(c)} />
      ))}
      {commutes.length < MAX_COMMUTES && (
        <button
          onClick={() => setEditing({ id: `c${Date.now()}`, name: '', legs: [], alerts: false })}
          className="self-start h-9 px-3 rounded-full border border-dashed border-slate-300 text-slate-600 hover:bg-white hover:border-sky-300 hover:text-sky-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <span className="material-symbols-outlined text-base">add_road</span>
          {commutes.length ? 'Add another commute' : 'Add my commute'}
        </button>
      )}
      {editing && <CommuteEditor initial={editing} routes={props.routes} onClose={() => setEditing(null)} />}
    </section>
  );
};
