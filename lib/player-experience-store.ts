import {DomainError} from './domain';
import type {Client} from './platform-store';
import type {BoardGamePreference} from './player-experience-types';
export const defaultBoardGame:BoardGamePreference={mode:'solo',startScore:501,bestOfLegs:1};
export function boardGamePreference(input:Record<string,unknown>):BoardGamePreference{
 const mode=String(input.mode),startScore=Number(input.startScore),bestOfLegs=Number(input.bestOfLegs);
 if(!['solo','local','remote'].includes(mode)||![301,501,701].includes(startScore)||![1,3,5,7,9].includes(bestOfLegs))throw new DomainError('invalid_settings','Kies geldige spelinstellingen.');
 return{mode:mode as BoardGamePreference['mode'],startScore:startScore as BoardGamePreference['startScore'],bestOfLegs:(mode==='solo'?1:bestOfLegs) as BoardGamePreference['bestOfLegs']};
}
/** Written only after board.start succeeds, inside the same transaction. */
export async function rememberBoardGame(client:Client,actor:string,boardId:string,input:Record<string,unknown>):Promise<void>{
 const game=boardGamePreference(input);
 await client.query(`insert into dartflow_private.player_experience(user_id,last_games) values($1,jsonb_build_object($2::text,$3::jsonb))
 on conflict(user_id) do update set last_games=jsonb_set(dartflow_private.player_experience.last_games,array[$2::text],$3::jsonb),updated_at=now()`,[actor,boardId,JSON.stringify(game)]);
}
