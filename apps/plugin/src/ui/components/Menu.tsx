import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type MenuItem = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  checked?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
};

/**
 * Button with a dropdown list. Arrow keys move, Enter picks, Escape or a click
 * outside closes. Used for the product scope chip and the overflow menu.
 */
export function Menu(props: {
  trigger: (state: { open: boolean }) => ReactNode;
  triggerClassName?: string;
  triggerLabel: string;
  title?: ReactNode;
  items: readonly MenuItem[];
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const checked = props.items.findIndex((item) => item.checked);
    setActive(Math.max(0, checked));
    list.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
    // Items change while open only on data refresh; keep the highlight where it is.
  }, [open]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (item: MenuItem | undefined) => {
    if (!item || item.disabled) return;
    setOpen(false);
    item.onSelect();
  };

  const move = (delta: number) => {
    const count = props.items.length;
    let next = active;
    for (let step = 0; step < count; step += 1) {
      next = (next + delta + count) % count;
      if (!props.items[next]!.disabled) break;
    }
    setActive(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'ArrowDown') move(1);
    else if (event.key === 'ArrowUp') move(-1);
    else if (event.key === 'Enter' || event.key === ' ') pick(props.items[active]);
    else if (event.key === 'Escape' || event.key === 'Tab') setOpen(false);
    else return;
    event.preventDefault();
  };

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className={props.triggerClassName}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={props.triggerLabel}
        title={props.triggerLabel}
        onClick={() => setOpen((value) => !value)}
      >
        {props.trigger({ open })}
      </button>
      {open && (
        <div
          className={`menu__panel menu__panel--${props.align ?? 'start'}`}
          id={id}
          role="listbox"
          tabIndex={-1}
          ref={list}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onKeyDown}
        >
          {props.title && <div className="menu__title">{props.title}</div>}
          {props.items.map((item, i) => (
            <div key={item.id} className={item.separatorBefore ? 'menu__group' : undefined}>
              <div
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={item.checked ?? false}
                aria-disabled={item.disabled}
                className={`menu__item ${i === active ? 'is-active' : ''}`}
                onPointerMove={() => !item.disabled && setActive(i)}
                onClick={() => pick(item)}
              >
                <span className="menu__check">{item.checked ? '✓' : ''}</span>
                <span className="menu__label">{item.label}</span>
                {item.hint !== undefined && <span className="menu__hint">{item.hint}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
