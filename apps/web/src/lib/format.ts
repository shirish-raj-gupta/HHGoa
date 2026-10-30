/** "1d" → "The next day", "trip_end" → "After the trip": follow-up kinds come from the category configs. */
export function followupLabel(kind: string): string {
  const days = /^(\d+)d$/.exec(kind)?.[1];
  if (days) {
    const n = Number(days);
    if (n === 1) return 'The next day';
    if (n === 7) return 'A week on';
    if (n === 30) return 'A month on';
    if (n % 30 === 0) return `${n / 30} months on`;
    return `${n} days on`;
  }
  return { trip_end: 'After the trip', move_out: 'At move-out', return_window: 'After the return window', renewal: 'At renewal' }[kind] ?? kind.replace(/_/g, ' ');
}
