import type {SeasonSettings,SeasonState,SeasonView} from './seasons-types';

export type CompetitionWizardStep=1|2|3|4|5|6;
export type CompetitionWizardVariant='singles'|'doubles'|'teams';
export type CompetitionWizardSystem='round-robin'|'knockout';
export type CompetitionWizardTeam={id:string;name:string;captainId:string;deputyId:string|null;playerIds:string[];reserveIds:string[]};
export type CompetitionWizardPlanning={startDate:string;endDate:string|null;weekdays:number[];startTime:string;endTime:string;timezone:string;matchMinutes:number;changeMinutes:number;breaks:{startTime:string;endTime:string}[];excludedDates:string[];roundGating:'manual'|'automatic';returnLegs:boolean;offsets:Record<string,string>};
export type CompetitionWizardConfig={version:1;title:string;season:string;description:string;organizerName:string;variant:CompetitionWizardVariant;system:CompetitionWizardSystem;playerIds:string[];teams:CompetitionWizardTeam[];rules:Partial<SeasonSettings>&{tiebreaks?:('points'|'leg-difference'|'legs-for'|'head-to-head')[]};boardIds:string[];planning:CompetitionWizardPlanning};
export type CompetitionWizardIssue={code:string;step:CompetitionWizardStep;path:string;message:string;fixtureId?:string;boardId?:string};
export type CompetitionWizardDraft={id:string;clubId:string;ownerId:string;revision:number;step:CompetitionWizardStep;status:'draft'|'published';config:CompetitionWizardConfig;publishedSeasonId:string|null;createdAt:string;updatedAt:string;canEdit:boolean};
export type CompetitionPlanningWindow={weekday:number;startTime:string;endTime:string};
export type CompetitionPlanningGrant={id:string;clubId:string;locationId:string;revision:number;status:'active'|'revoked';startsAt:string|null;endsAt:string|null;windows:CompetitionPlanningWindow[];boardIds:string[];reason:string;canManage:boolean};
export type CompetitionWizardLocation={id:string;name:string;timezone:string;grantId:string;grantRevision:number;boards:{id:string;name:string}[];windows:CompetitionPlanningWindow[];startsAt:string|null;endsAt:string|null};
export type CompetitionWizardContext={club:{id:string;name:string};canManage:boolean;players:{id:string;name:string;username:string|null;eligible:boolean;reason?:string}[];teams:CompetitionWizardTeam[];locations:CompetitionWizardLocation[];grants:CompetitionPlanningGrant[];managedLocations:{id:string;name:string;timezone:string;boards:{id:string;name:string;active:boolean}[]}[];drafts:CompetitionWizardDraft[];formats:{variant:CompetitionWizardVariant;systems:CompetitionWizardSystem[];minEntries:number;maxEntries:number;minPlayersPerTeam:number;maxPlayersPerTeam:number}[]};
export type CompetitionWizardFixture={id:string;round:number;homeId:string;awayId:string;homeName:string;awayName:string;startsAt:string;endsAt:string;boardId:string;locationId:string;offset:string;participantIds:string[];bracketFixtureId?:string};
export type CompetitionWizardPreview={draftId:string;revision:number;configurationHash:string;canPublish:boolean;issues:CompetitionWizardIssue[];warnings:CompetitionWizardIssue[];fixtures:CompetitionWizardFixture[];rounds:{number:number;startsAt:string;endsAt:string;released:boolean;byeIds:string[]}[];totalMatches:number;participantCount:number;regulation:string[]};
export type CompetitionWizardCommand={requestId:string;action:
 |{type:'wizard.save';clubId:string;id?:string;expectedRevision:number;step:CompetitionWizardStep;config:CompetitionWizardConfig}
 |{type:'wizard.copy';id:string;expectedRevision:number;clubId?:string}
 |{type:'wizard.preview';id:string;expectedRevision:number}
 |{type:'wizard.publish';id:string;expectedRevision:number;configurationHash:string;acknowledgedWarnings?:string[]}
 |{type:'planning.grant';clubId:string;locationId:string;expectedRevision:number;boardIds:string[];windows:CompetitionPlanningWindow[];startsAt?:string|null;endsAt?:string|null;reason:string}
 |{type:'planning.revoke';id:string;expectedRevision:number;reason:string}
};
export type CompetitionWizardResponse={ok:true;id:string;draft?:CompetitionWizardDraft;preview?:CompetitionWizardPreview;seasonId?:string;season?:SeasonView;grant?:CompetitionPlanningGrant};
/** The central season is authoritative after publication; this snapshot is audit metadata. */
export type PublishedCompetitionWizard={version:1;draftId:string;draftRevision:number;configurationHash:string;clubId:string;seasonLabel:string;description:string;organizerName:string;publishedBy:string;publishedAt:string;roster:{id:string;name:string;playerIds:string[];captainId?:string;reserveIds?:string[]}[];planning:CompetitionWizardPlanning;grants:{id:string;revision:number;boardIds:string[]}[];scheduleRevision:number;fixtures:CompetitionWizardFixture[]};
export type WizardSeasonState=SeasonState&{competitionWizard?:PublishedCompetitionWizard};
