/** Defaults for a new selection only; never normalize a stored legacy game. */
export function freshX01InRule(startScore: number | string): 'single' | 'double' {
  return Number(startScore) === 301 ? 'double' : 'single';
}
