import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Section({
  title,
  children,
  defaultOpen = true,
  right,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-3 h-8 select-none">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-400 hover:text-white transition-colors"
        >
          <span className={`transition-transform text-[8px] ${open ? 'rotate-90' : ''}`}>▶</span>
          {title}
        </button>
        {right}
      </div>
      {open && <div className="px-3 pb-3 pt-0.5">{children}</div>}
    </div>
  );
}

export function Slider({
  label,
  value,
  min = -1,
  max = 1,
  step = 0.01,
  onChange,
  format,
  resetTo = 0,
  disabled,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  resetTo?: number;
  disabled?: boolean;
}) {
  const shown = format ? format(value) : formatSigned(value, min, max);
  return (
    <div className={`mb-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-gray-400">{label}</span>
        <span className="font-mono text-gray-300 tabular-nums">{shown}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => onChange(resetTo)}
        className="w-full accent-accent h-1.5 cursor-pointer"
        title="Двойной клик — сбросить"
      />
    </div>
  );
}

function formatSigned(value: number, min: number, max: number): string {
  if (min === -1 && max === 1) {
    const pct = Math.round(value * 100);
    return `${pct > 0 ? '+' : ''}${pct}`;
  }
  return String(Math.round(value * 100) / 100);
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  disabled,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(fmtNum(value));
  }, [value]);

  const commit = () => {
    const n = parseFloat(draft.replace(',', '.'));
    if (Number.isFinite(n)) {
      let next = n;
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      onChange(next);
      setDraft(fmtNum(next));
    } else {
      setDraft(fmtNum(value));
    }
  };

  return (
    <label className={`flex items-center gap-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {label && <span className="text-[10px] text-gray-500 w-4 shrink-0">{label}</span>}
      <div className="relative flex-1 min-w-0">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
          onBlur={() => { focused.current = false; commit(); }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.currentTarget.blur(); }
            if (e.key === 'Escape') { setDraft(fmtNum(value)); e.currentTarget.blur(); }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              const n = parseFloat(draft.replace(',', '.'));
              const base = Number.isFinite(n) ? n : value;
              let next = base + delta;
              if (min !== undefined) next = Math.max(min, next);
              if (max !== undefined) next = Math.min(max, next);
              setDraft(fmtNum(next));
              onChange(next);
            }
          }}
          className="num-input"
        />
        {suffix && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-gray-600 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function fmtNum(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none py-0.5" title={hint}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent w-3 h-3"
      />
      <span className="text-gray-300">{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-panel-3 rounded-md p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          title={o.title}
          className={`flex-1 text-[10px] px-2 py-1 rounded transition-colors ${
            value === o.value ? 'bg-accent/20 text-accent' : 'text-gray-400 hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Colour input that also accepts `none`, `currentColor` and `url(#…)`. */
export function ColorField({
  label,
  value,
  onChange,
  allowNone = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowNone?: boolean;
}) {
  const isPaintServer = value.startsWith('url(');
  const isNone = !value || value === 'none';
  const hex = normalizeHex(value);

  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className="text-[10px] text-gray-500 w-10 shrink-0">{label}</span>
      <div className="relative w-6 h-6 shrink-0 rounded border border-border overflow-hidden checkerboard">
        {!isNone && !isPaintServer && (
          <input
            type="color"
            value={hex}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
          />
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: isNone ? 'transparent' : isPaintServer ? 'repeating-linear-gradient(45deg,#666,#666 3px,#999 3px,#999 6px)' : value }}
        />
        {isNone && (
          <div className="absolute inset-0 flex items-center justify-center text-[9px] text-gray-500">✕</div>
        )}
        {!isNone && !isPaintServer && (
          <input
            type="color"
            value={hex}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
          />
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="num-input flex-1 min-w-0"
        spellCheck={false}
      />
      {allowNone && (
        <button
          onClick={() => onChange(isNone ? '#000000' : 'none')}
          title={isNone ? 'Задать цвет' : 'Без заливки'}
          className={`w-5 h-5 rounded text-[10px] shrink-0 transition-colors ${
            isNone ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-white hover:bg-panel-3'
          }`}
        >
          ∅
        </button>
      )}
    </div>
  );
}

export function normalizeHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  // Let the browser resolve named colours and rgb()/hsl() forms.
  const probe = document.createElement('canvas').getContext('2d');
  if (probe) {
    probe.fillStyle = '#000000';
    probe.fillStyle = v;
    const resolved = probe.fillStyle;
    if (typeof resolved === 'string' && resolved.startsWith('#')) return resolved;
  }
  return '#000000';
}

export function ToolButton({
  active,
  onClick,
  title,
  children,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`tool-btn ${active ? 'tool-btn-active' : ''} ${disabled ? 'opacity-25 pointer-events-none' : ''}`}
    >
      {children}
    </button>
  );
}

export function Row({ children, gap = 1.5 }: { children: ReactNode; gap?: number }) {
  return <div className="flex items-center" style={{ gap: `${gap * 4}px` }}>{children}</div>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[10px] text-gray-600 leading-snug mt-1">{children}</p>;
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'ghost' | 'accent' | 'danger';
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const styles =
    variant === 'accent'
      ? 'bg-accent text-black hover:bg-accent/85'
      : variant === 'danger'
        ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
        : 'bg-panel-3 text-gray-300 hover:bg-panel-4 hover:text-white';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-30 disabled:pointer-events-none ${styles} ${className}`}
    >
      {children}
    </button>
  );
}
