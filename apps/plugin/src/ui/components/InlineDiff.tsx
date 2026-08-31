import { useMemo, type ReactNode } from 'react';

export type DiffSegment = {
  value: string;
  changed: boolean;
};

export type TextDiff = {
  current: DiffSegment[];
  next: DiffSegment[];
};

const TOKEN_PATTERN =
  /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}\p{M}_]+|[^\s\p{L}\p{N}\p{M}_]/gu;
const MAX_LCS_CELLS = 30_000;

function tokenize(value: string): string[] {
  return value.match(TOKEN_PATTERN) ?? [];
}

function appendSegment(segments: DiffSegment[], value: string, changed: boolean): void {
  if (!value) return;
  const previous = segments.at(-1);
  if (previous?.changed === changed) previous.value += value;
  else segments.push({ value, changed });
}

/** Return aligned, readable spans for both sides of a small text comparison. */
export function diffText(current: string, next: string): TextDiff {
  if (current === next)
    return {
      current: current ? [{ value: current, changed: false }] : [],
      next: next ? [{ value: next, changed: false }] : [],
    };

  const oldTokens = tokenize(current);
  const newTokens = tokenize(next);

  // ponytail: cap LCS at 30k cells; whole replacement keeps plugin copy responsive.
  if (oldTokens.length * newTokens.length > MAX_LCS_CELLS)
    return {
      current: current ? [{ value: current, changed: true }] : [],
      next: next ? [{ value: next, changed: true }] : [],
    };

  const lcs = Array.from(
    { length: oldTokens.length + 1 },
    () => new Uint16Array(newTokens.length + 1),
  );
  for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
      lcs[oldIndex]![newIndex] =
        oldTokens[oldIndex] === newTokens[newIndex]
          ? lcs[oldIndex + 1]![newIndex + 1]! + 1
          : Math.max(lcs[oldIndex + 1]![newIndex]!, lcs[oldIndex]![newIndex + 1]!);
    }
  }

  const oldSegments: DiffSegment[] = [];
  const newSegments: DiffSegment[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldTokens.length && newIndex < newTokens.length) {
    if (oldTokens[oldIndex] === newTokens[newIndex]) {
      appendSegment(oldSegments, oldTokens[oldIndex]!, false);
      appendSegment(newSegments, newTokens[newIndex]!, false);
      oldIndex += 1;
      newIndex += 1;
    } else if (lcs[oldIndex + 1]![newIndex]! >= lcs[oldIndex]![newIndex + 1]!) {
      appendSegment(oldSegments, oldTokens[oldIndex]!, true);
      oldIndex += 1;
    } else {
      appendSegment(newSegments, newTokens[newIndex]!, true);
      newIndex += 1;
    }
  }
  while (oldIndex < oldTokens.length) {
    appendSegment(oldSegments, oldTokens[oldIndex]!, true);
    oldIndex += 1;
  }
  while (newIndex < newTokens.length) {
    appendSegment(newSegments, newTokens[newIndex]!, true);
    newIndex += 1;
  }
  return { current: oldSegments, next: newSegments };
}

function renderSegments(segments: DiffSegment[], side: 'current' | 'next'): ReactNode {
  return segments.map((segment, index) =>
    segment.changed ? (
      <span className={`diff-mark diff-mark-${side}`} data-diff="changed" key={index}>
        {segment.value}
      </span>
    ) : (
      <span key={index}>{segment.value}</span>
    ),
  );
}

export function InlineDiff({
  current,
  next,
  side,
}: {
  current: string;
  next: string;
  side: 'current' | 'next';
}) {
  const diff = useMemo(() => diffText(current, next), [current, next]);
  if (current === next) return <>{side === 'current' ? current : next}</>;
  return <>{renderSegments(side === 'current' ? diff.current : diff.next, side)}</>;
}
