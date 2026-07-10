const AUTOSTART_QUERY_KEYS = ['start', 'map', 'seed', 'ai', 'ai-style', 'combat', 'armies', 'sides', 'debug'];

export function shouldAutostartFromUrl(params: URLSearchParams): boolean {
  return AUTOSTART_QUERY_KEYS.some((key) => params.has(key));
}
