import type {SeasonFixture,SeasonState} from './seasons-types';

/** A hybrid policy requires an explicit encounter agreement before assigning a board. */
export function seasonFixturePlayMode(season:Pick<SeasonState,'settings'>,fixture:Pick<SeasonFixture,'playMode'>):'local'|'remote'|null {
 return season.settings.playMode==='hybrid'?fixture.playMode??null:season.settings.playMode;
}
export function seasonPlayModeMutable(fixture:Pick<SeasonFixture,'status'|'slots'|'remoteAssignments'>):boolean {
 return !['confirmed','administrative','canceled'].includes(fixture.status)&&!fixture.slots.some(slot=>slot.matchId)&&!fixture.remoteAssignments?.home&&!fixture.remoteAssignments?.away;
}
