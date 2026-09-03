/** Tiny classname joiner. No dependency on clsx/tailwind-merge — keeps the component tree hand-built. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
