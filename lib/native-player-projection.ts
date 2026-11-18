import type {PlatformEntity} from './platform-types';

/** Native phones submit undo commands to the server; they never restore a game
 * themselves. Keep the complete undo chain in storage/receipts while returning
 * only the accepted game and the capability count needed by the phone. */
export function nativePlayerTrainingProjection(source:PlatformEntity):PlatformEntity {
  if(source.kind!=='training')return source;
  const {undo,...state}=source.state;
  return {...source,state:{...state,undoCount:undo?.length??0,...(state.game?{game:{...state.game,history:[]}}:{})}};
}
