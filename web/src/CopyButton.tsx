import { useEffect, useState } from 'react';
import { Check, Copy, CircleAlert } from 'lucide-react';

interface Props {
  value: string;
  label: string;
  compact?: boolean;
  className?: string;
}

/** Clipboard access requires HTTPS. Never auto-copy; only run after an explicit click. */
export default function CopyButton({ value, label, compact = false, className = '' }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => { setState('idle'); }, [value]);
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2600);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copy(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!value.trim()) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('error');
    }
  }

  const text = state === 'copied' ? 'تم النسخ' : state === 'error' ? 'تعذر النسخ' : `نسخ ${label}`;
  const Icon = state === 'copied' ? Check : state === 'error' ? CircleAlert : Copy;
  return (
    <button
      type="button"
      className={`copy-button ${compact ? 'compact' : ''} ${state} ${className}`.trim()}
      onClick={copy}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={text}
      title={text}
      disabled={!value.trim()}
    >
      <Icon size={compact ? 14 : 16} aria-hidden="true" />
      {!compact && <span>{state === 'idle' ? 'نسخ' : text}</span>}
      <span className="sr-only" aria-live="polite">{state === 'idle' ? '' : `${label}: ${text}`}</span>
    </button>
  );
}
