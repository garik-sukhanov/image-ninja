import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  /** A separator when omitted. */
  label?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
}

export interface MenuAnchor {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * Right-click menu. Positioned in viewport coordinates and flipped back inside
 * the window when it would overflow, so a click near the bottom-right edge
 * still shows the whole menu.
 */
export function ContextMenu({ anchor, onClose }: { anchor: MenuAnchor; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(anchor.x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(anchor.y, window.innerHeight - height - 4)),
    });
  }, [anchor.x, anchor.y, anchor.items]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // `capture` so the dismissing click doesn't also land on whatever is below.
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[190px] py-1 bg-panel-2 border border-border rounded-lg shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {anchor.items.map((item, i) =>
        item.label === undefined ? (
          <div key={i} className="h-px bg-border my-1" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.();
              onClose();
            }}
            className={`w-full flex items-center gap-3 px-3 py-1.5 text-[11px] text-left transition-colors disabled:opacity-30 disabled:pointer-events-none ${
              item.danger
                ? 'text-red-300 hover:bg-red-500/15'
                : 'text-gray-300 hover:bg-panel-3 hover:text-white'
            }`}
          >
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-gray-600 font-mono">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

/** Shared open/close state for a single menu instance. */
export function useContextMenu() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const open = (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => {
    e.preventDefault();
    setAnchor({ x: e.clientX, y: e.clientY, items });
  };
  return { anchor, open, close: () => setAnchor(null) };
}
