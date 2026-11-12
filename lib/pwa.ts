import type { MetadataRoute } from 'next';

export const BOARD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SCOREBOARD_BINDING_KEY = 'dartflow-scorebord-fixed-board-v1';

function icons(kind: 'player' | 'scoreboard' | 'oche-live'): NonNullable<MetadataRoute.Manifest['icons']> {
  return [192, 512].flatMap(size => (['any', 'maskable'] as const).map(purpose => ({src: `/assets/pwa/${kind}-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose})));
}
const common = {lang: 'nl', display: 'standalone', background_color: '#121315', theme_color: '#121315', orientation: 'any'} as const;
export function playerManifest(): MetadataRoute.Manifest {
  return {...common, id: '/speler', name: 'DartFlow Speler', short_name: 'DartFlow Speler', description: 'Je eigen DartFlow-speelomgeving.', start_url: '/speler', scope: '/', icons: icons('player')};
}
export function scoreboardManifest(): MetadataRoute.Manifest {
  return {...common, id: '/scorebord', name: 'Oche Live', short_name: 'Oche Live', description: 'Een vast gekoppeld, alleen-lezen Oche Live-baanscherm.', start_url: '/scorebord', scope: '/scorebord', icons: icons('oche-live')};
}
export function boardManifest(boardId: string, boardName: string): MetadataRoute.Manifest {
  if (!BOARD_ID_PATTERN.test(boardId)) throw new Error('Ongeldig baan-ID.');
  const path = `/baanscherm/${boardId.toLowerCase()}`;
  const name = `Oche Live · ${boardName}`;
  return {...common, id: path, name, short_name: name, description: 'Het vaste, alleen-lezen Oche Live-baanscherm.', start_url: path, scope: path, icons: icons('oche-live')};
}
export function manifestForPath(path: string[]): string | undefined {
  if (path[0] === 'baanscherm' || path[0] === 'oche-live') return path.length === 2 && BOARD_ID_PATTERN.test(path[1]) ? `/api/board-screens/${path[1].toLowerCase()}/manifest.webmanifest` : undefined;
  if (path[0] === 'scorebord') return '/scorebord/manifest.webmanifest';
  if (path.length && !['scherm', 'cast', 'link-onbekend'].includes(path[0])) return '/speler/manifest.webmanifest';
  return undefined;
}
