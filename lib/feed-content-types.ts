export type FeedAttachment={id:string;name:string;mime:'image/webp';data:string};
export type FeedPoll={id:string;endsAt:string;multiple:boolean;allowChange:boolean;options:{id:string;label:string;votes:number}[];myOptionIds:string[];totalVoters:number;closed:boolean};
export type FeedExtras={revision:number;canEdit:boolean;canPin:boolean;maxPinDays:number;pinUntil:string|null;attachments:FeedAttachment[];poll:FeedPoll|null};
