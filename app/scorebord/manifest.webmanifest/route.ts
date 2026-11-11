import { scoreboardManifest } from '@/lib/pwa';
export function GET() {
  return Response.json(scoreboardManifest(), {headers: {'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store'}});
}
