export const ROUTE_HASHES = {
  home: '#/',
  assets: '#/workshop/assets',
  yinghua: '#/workshop/yinghua',
  poster: '#/workshop/poster',
  gallery: '#/gallery',
  prompts: '#/prompts',
} as const;

export type AppRoute = keyof typeof ROUTE_HASHES;

export function routeFromHash(hash: string): AppRoute {
  if (hash === '#prompt-gallery' || hash === '#prompt-gallery-search') return 'prompts';
  return (Object.keys(ROUTE_HASHES) as AppRoute[]).find((route) => ROUTE_HASHES[route] === hash) ?? 'home';
}

export function navigateTo(route: AppRoute): void {
  window.location.hash = ROUTE_HASHES[route];
}

export function isWorkshopRoute(route: AppRoute): boolean {
  return route === 'assets' || route === 'yinghua' || route === 'poster';
}
