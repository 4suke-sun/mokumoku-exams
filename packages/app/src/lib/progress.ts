/** クリックで遷移が始まるリンクか。修飾キー・別タブ・同じページ・外部は対象外。 */
export function startsNavigation(
  a: { href: string; target: string; hasAttribute(name: string): boolean },
  event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  current: URL,
): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return false;
  let next: URL;
  try {
    next = new URL(a.href, current);
  } catch {
    return false;
  }
  if (next.origin !== current.origin) return false;
  return next.pathname !== current.pathname || next.search !== current.search;
}
