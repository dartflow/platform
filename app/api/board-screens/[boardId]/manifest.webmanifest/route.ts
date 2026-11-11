import { cookies } from 'next/headers';
import { BOARD_ID_PATTERN, boardManifest } from '@/lib/pwa';
import { BOARD_SCREEN_COOKIE, getBoardScreen } from '@/lib/board-screens';
import { DomainError } from '@/lib/domain';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: {params: Promise<{boardId: string}>}) {
  const {boardId} = await context.params;
  if (!BOARD_ID_PATTERN.test(boardId)) return new Response(null, {status: 404});
  let name = `Baanscherm ${boardId.slice(0, 6)}`;
  try {
    const token = (await cookies()).get(BOARD_SCREEN_COOKIE)?.value;
    name = (await getBoardScreen(boardId, token)).board.name;
  } catch (cause) {
    // Unpaired private displays expose no club, tournament or player metadata.
    if (!(cause instanceof DomainError) || cause.status !== 403) {
      return new Response(null, {status: cause instanceof DomainError ? cause.status : 503, headers: {'Cache-Control': 'no-store'}});
    }
  }
  return Response.json(boardManifest(boardId, name), {headers: {'Content-Type': 'application/manifest+json', 'Cache-Control': 'private, no-store', 'Vary': 'Cookie'}});
}
