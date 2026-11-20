'use client';

import {useEffect, useRef} from 'react';
import {freshX01InRule} from '@/lib/x01-defaults';

/** Opt-in new-party defaults. Explicit choices survive until the startscore changes. */
export default function X01OpeningField({fresh = false, startScore}: {fresh?: boolean; startScore?: number | string}) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!fresh) return;
    const select = ref.current, form = select?.form;
    if (!select) return;
    const apply = () => {select.value = freshX01InRule(String(startScore ?? (form ? new FormData(form).get('startScore') : null) ?? 501));};
    apply();
    const changed = (event: Event) => {if ((event.target as HTMLSelectElement)?.name === 'startScore') apply();};
    form?.addEventListener('change', changed);
    return () => form?.removeEventListener('change', changed);
  }, [fresh, startScore]);
  return <label className="field">Openen<select name="inRule" ref={ref} defaultValue={freshX01InRule(fresh ? startScore ?? 501 : 501)}><option value="single">Open in</option><option value="double">Double in</option></select></label>;
}
