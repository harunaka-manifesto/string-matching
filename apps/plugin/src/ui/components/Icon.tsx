/** 16px stroke icons drawn to match Figma's UI3 set. */
const PATHS = {
  back: 'M10 4 6 8l4 4',
  chevron: 'm5 6.5 3 3 3-3',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm3.2-1.3L13.5 13.5',
  close: 'm4.5 4.5 7 7m0-7-7 7',
  check: 'm3.5 8.5 3 3 6-7',
  flag: 'M4.5 13.5v-10m0 0h7l-1.5 2.75L11.5 9h-7',
  skip: 'M3.5 8h9',
  more: 'M4 8h.01M8 8h.01M12 8h.01',
  up: 'M8 12.5v-9m0 0L4.5 7M8 3.5 11.5 7',
  down: 'M8 3.5v9m0 0L4.5 9M8 12.5 11.5 9',
  refresh: 'M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 3v2.5H10',
  target: 'M8 12.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM8 1.5v2m0 9v2M1.5 8h2m9 0h2',
  unlink:
    'M6.5 9.5 9.5 6.5M5 8 3.8 9.2a2.5 2.5 0 0 0 3.5 3.5L8.5 11.5M11 8l1.2-1.2a2.5 2.5 0 0 0-3.5-3.5L7.5 4.5',
  undo: 'M5.5 6.5H10a3 3 0 0 1 0 6H6M5.5 6.5 8 4M5.5 6.5 8 9',
  arrow: 'M3.5 8h9m0 0L9 4.5M12.5 8 9 11.5',
  swap: 'M3.5 5.5h9m0 0-2.5-2.5m2.5 2.5L10 8M12.5 10.5h-9m0 0L6 8m-2.5 2.5L6 13',
  sparkle: 'M8 2.5 9.2 6.8 13.5 8 9.2 9.2 8 13.5 6.8 9.2 2.5 8 6.8 6.8 8 2.5Z',
  frame: 'M5.5 2.5v11m5-11v11m-8-8h11m-11 5h11',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 2.2 : 1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
