/** Only implemented public pages; future demo routes must be admitted explicitly. */
export function isDemoPath(pathname: string): boolean {
  return pathname === '/demo' || pathname === '/en/demo';
}
