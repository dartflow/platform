import { playerManifest } from '@/lib/pwa';
export function GET() {
  return Response.json(playerManifest(), {headers: {'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store'}});
}
