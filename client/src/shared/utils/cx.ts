/** Joins class names, skipping falsy entries so conditions can be written inline. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
