// Verified v15 catalog; text data only. Auth OTP remains owned by Supabase.
export type MailFields = {subject:string;preheader:string;title:string;body:string;cta:string};
export type MailTemplate = {id:string;label:string;category:string;fields:MailFields;details:string[][];enabled:boolean;readOnly:boolean;trigger:string;variables:string[]};
export const MAIL_CATALOG: readonly MailTemplate[] = [
  {id:'club-invite',label:'Persoonlijke verenigingsuitnodiging',category:'Vereniging',fields:{subject:'{{actorName}} nodigt je uit voor {{clubName}}',preheader:'Je hebt een persoonlijke uitnodiging ontvangen.',title:'Kom bij de vereniging.',body:'Hoi {{name}},\n{{actorName}} heeft je uitgenodigd voor {{clubName}}. Open de vereniging om de uitnodiging te bekijken.',cta:'Bekijk uitnodiging'},details:[['Vereniging','{{clubName}}']],enabled:true,readOnly:false,trigger:'Een bevoegd verenigingslid nodigt een concrete speler uit.',variables:['name','actorName','clubName']},
  {id:'club-request-received',label:'Ontvangstbevestiging lidmaatschap',category:'Vereniging',fields:{subject:'Je aanvraag bij {{clubName}} is ontvangen',preheader:'Je aanvraag is veilig opgeslagen.',title:'We hebben je aanvraag ontvangen.',body:'Hoi {{name}},\nJe lidmaatschapsaanvraag voor {{clubName}} is ontvangen. Je kunt de actuele status bekijken in de vereniging.',cta:'Bekijk aanvraag'},details:[['Vereniging','{{clubName}}']],enabled:true,readOnly:false,trigger:'Een geldige aanvraag is opgeslagen.',variables:['name','clubName']},

  {
    "id": "auth-otp",
    "label": "Inlogcode",
    "category": "Account",
    "fields": {
      "subject": "{{otp}} is je DartFlow-inlogcode",
      "preheader": "Jouw persoonlijke toegang tot de oche.",
      "title": "Terug aan de oche.",
      "body": "Hoi {{name}},\nGebruik deze eenmalige code om veilig in te loggen bij DartFlow. Heb je deze code niet aangevraagd? Dan kun je deze mail negeren.",
      "cta": "Open DartFlow"
    },
    "details": [],
    "enabled": true,
    "readOnly": true,
    "trigger": "Een speler vraagt een e-mailcode aan.",
    "variables": [
      "otp",
      "name"
    ]
  },
  {
    "id": "welcome",
    "label": "Welkom bij DartFlow",
    "category": "Account",
    "fields": {
      "subject": "Welkom bij DartFlow, {{name}}",
      "preheader": "Jouw club, jouw tegenstanders, jouw volgende partij.",
      "title": "Jouw volgende partij begint hier.",
      "body": "Hoi {{name}},\nMooi dat je erbij bent. Sluit je aan bij een vereniging, daag een dartmaatje uit of scan de QR-code op een baan. Je wedstrijden en statistieken komen samen op één plek.",
      "cta": "Ontdek DartFlow"
    },
    "details": [
      [
        "Speler",
        "{{name}}"
      ],
      [
        "Start",
        "Club zoeken · oefenen · uitdagen"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een nieuw account is succesvol aangemaakt.",
    "variables": [
      "name"
    ]
  },
  {
    "id": "club-request",
    "label": "Nieuwe clublid-aanvraag",
    "category": "Vereniging",
    "fields": {
      "subject": "{{actorName}} wil lid worden van {{clubName}}",
      "preheader": "Er staat een nieuwe aanvraag klaar voor je club.",
      "title": "Een nieuwe speler voor je club.",
      "body": "Hoi {{name}},\n{{actorName}} heeft gevraagd om lid te worden van {{clubName}}. Bekijk het profiel en beoordeel de aanvraag in de clubomgeving.",
      "cta": "Bekijk aanvraag"
    },
    "details": [
      [
        "Aanvrager",
        "{{actorName}}"
      ],
      [
        "Vereniging",
        "{{clubName}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een speler vraagt lidmaatschap aan.",
    "variables": [
      "actorName",
      "clubName",
      "name"
    ]
  },
  {
    "id": "club-decision",
    "label": "Besluit clublidmaatschap",
    "category": "Vereniging",
    "fields": {
      "subject": "Je aanvraag bij {{clubName}}: {{status}}",
      "preheader": "Er is nieuws over je lidmaatschap.",
      "title": "Nieuws van je vereniging.",
      "body": "Hoi {{name}},\nJe aanvraag om lid te worden van {{clubName}} is beoordeeld. Hieronder vind je het besluit. Bekijk je clubomgeving voor de mogelijkheden.",
      "cta": "Bekijk je vereniging"
    },
    "details": [
      [
        "Vereniging",
        "{{clubName}}"
      ],
      [
        "Besluit",
        "{{status}}"
      ],
      ["Toelichting", "{{reason}}"]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een beheerder beoordeelt een aanvraag of de speler treedt direct toe.",
    "variables": [
      "clubName",
      "status",
      "name",
      "reason"
    ]
  },
  {
    "id": "club-role",
    "label": "Clubrol gewijzigd",
    "category": "Vereniging",
    "fields": {
      "subject": "Je rol bij {{clubName}} is gewijzigd",
      "preheader": "Je nieuwe rol staat klaar in de clubomgeving.",
      "title": "Samen dragen we de club.",
      "body": "Hoi {{name}},\nJe rol binnen {{clubName}} is aangepast. In de clubomgeving zie je welke mogelijkheden bij je nieuwe rol horen.",
      "cta": "Open clubomgeving"
    },
    "details": [
      [
        "Vereniging",
        "{{clubName}}"
      ],
      [
        "Nieuwe rol",
        "{{role}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een beheerder wijzigt daadwerkelijk een clubrol.",
    "variables": [
      "clubName",
      "name",
      "role"
    ]
  },
  {
    "id": "friend-request",
    "label": "Vriendschapsverzoek",
    "category": "Sociaal",
    "fields": {
      "subject": "{{actorName}} wil je toevoegen als dartmaatje",
      "preheader": "Een nieuwe verbinding, een volgende partij.",
      "title": "Een dartmaatje erbij?",
      "body": "Hoi {{name}},\n{{actorName}} wil je toevoegen als vriend op DartFlow. Bekijk het verzoek en spreek samen jullie volgende partij af.",
      "cta": "Bekijk vriendschapsverzoek"
    },
    "details": [
      [
        "Van",
        "{{actorName}}"
      ],
      [
        "Voor",
        "{{name}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een speler verstuurt een vriendschapsverzoek.",
    "variables": [
      "actorName",
      "name"
    ]
  },
  {
    "id": "friend-accepted",
    "label": "Dartmaatje toegevoegd",
    "category": "Sociaal",
    "fields": {
      "subject": "Je bent nu bevriend met {{actorName}}",
      "preheader": "Daag elkaar uit of ontmoet elkaar in de chat.",
      "title": "Jullie volgende partij wacht.",
      "body": "Hoi {{name}},\n{{actorName}} heeft je vriendschapsverzoek geaccepteerd. Jullie kunnen elkaar nu eenvoudig terugvinden en uitdagen.",
      "cta": "Naar je dartmaatjes"
    },
    "details": [
      [
        "Dartmaatje",
        "{{actorName}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een vriendschapsverzoek is geaccepteerd.",
    "variables": [
      "actorName",
      "name"
    ]
  },
  {
    "id": "challenge-invite",
    "label": "Uitdaging ontvangen",
    "category": "Wedstrijden",
    "fields": {
      "subject": "{{actorName}} daagt je uit voor een partij",
      "preheader": "De oche is vrij. Accepteer jij de uitdaging?",
      "title": "Laat je pijlen spreken.",
      "body": "Hoi {{name}},\n{{actorName}} daagt je uit voor een wedstrijd op DartFlow. Bekijk de spelinstellingen en accepteer als je klaar bent voor de eerste leg.",
      "cta": "Bekijk uitdaging"
    },
    "details": [
      [
        "Tegenstander",
        "{{actorName}}"
      ],
      [
        "Spel",
        "{{startScore}} · best of {{bestOf}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een gerichte uitdaging wordt verstuurd.",
    "variables": [
      "actorName",
      "name",
      "startScore",
      "bestOf"
    ]
  },
  {
    "id": "challenge-accepted",
    "label": "Uitdaging geaccepteerd",
    "category": "Wedstrijden",
    "fields": {
      "subject": "{{actorName}} heeft je uitdaging geaccepteerd",
      "preheader": "Jullie partij staat klaar.",
      "title": "Het is tijd voor jullie partij.",
      "body": "Hoi {{name}},\n{{actorName}} heeft je uitdaging geaccepteerd. Open de wedstrijd om samen te starten en controleer de afgesproken spelinstellingen.",
      "cta": "Open wedstrijd"
    },
    "details": [
      [
        "Tegenstander",
        "{{actorName}}"
      ],
      [
        "Spel",
        "{{startScore}} · best of {{bestOf}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "De tegenstander accepteert de uitdaging.",
    "variables": [
      "actorName",
      "name",
      "startScore",
      "bestOf"
    ]
  },
  {
    "id": "challenge-cancelled",
    "label": "Uitdaging ingetrokken",
    "category": "Wedstrijden",
    "fields": {
      "subject": "De uitdaging met {{opponentName}} is vervallen",
      "preheader": "Deze partij gaat niet door. Plan gerust een nieuwe.",
      "title": "Een andere keer aan de oche.",
      "body": "Hoi {{name}},\nDe openstaande uitdaging met {{opponentName}} is ingetrokken of afgewezen. Je vindt de actuele status in je wedstrijdoverzicht.",
      "cta": "Naar je wedstrijden"
    },
    "details": [
      [
        "Tegenstander",
        "{{opponentName}}"
      ],
      [
        "Status",
        "{{status}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een openstaande gerichte uitdaging wordt ingetrokken of afgewezen.",
    "variables": [
      "opponentName",
      "name",
      "status"
    ]
  },
  {
    "id": "fixture-scheduled",
    "label": "Speelmoment bevestigd",
    "category": "Competitie",
    "fields": {
      "subject": "Jullie wedstrijd op {{date}} is bevestigd",
      "preheader": "Het speelmoment staat vast in jullie programma.",
      "title": "Afgesproken. Tijd om te spelen.",
      "body": "Hoi {{name}},\nHet voorstel voor je wedstrijd tegen {{opponentName}} is geaccepteerd. Zet het speelmoment in je agenda en open de wedstrijd wanneer jullie klaar zijn.",
      "cta": "Bekijk wedstrijd"
    },
    "details": [
      [
        "Competitie",
        "{{eventName}}"
      ],
      [
        "Tegenstander",
        "{{opponentName}}"
      ],
      [
        "Wanneer",
        "{{date}} · {{time}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Beide spelers hebben het voorgestelde moment bevestigd.",
    "variables": [
      "date",
      "name",
      "opponentName",
      "eventName",
      "time"
    ]
  },
  {
    "id": "fixture-changed",
    "label": "Nieuw voorstel speelmoment",
    "category": "Competitie",
    "fields": {
      "subject": "Nieuw tijdvoorstel voor je partij met {{opponentName}}",
      "preheader": "Bekijk het voorstel en geef aan of je kunt spelen.",
      "title": "Past dit speelmoment?",
      "body": "Hoi {{name}},\n{{actorName}} heeft een nieuw speelmoment voorgesteld voor jullie wedstrijd. Het moment staat pas vast nadat het voorstel is geaccepteerd.",
      "cta": "Beoordeel voorstel"
    },
    "details": [
      [
        "Competitie",
        "{{eventName}}"
      ],
      [
        "Tegenstander",
        "{{opponentName}}"
      ],
      [
        "Voorstel",
        "{{date}} · {{time}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een speler stelt een nieuw wedstrijdmoment voor.",
    "variables": [
      "opponentName",
      "name",
      "actorName",
      "eventName",
      "date",
      "time"
    ]
  },
  {
    "id": "fixture-reminder",
    "label": "Wedstrijdherinnering",
    "category": "Competitie",
    "fields": {
      "subject": "Je speelt op {{date}} tegen {{opponentName}}",
      "preheader": "Je volgende competitiewedstrijd komt eraan.",
      "title": "Bijna tijd voor de eerste leg.",
      "body": "Hoi {{name}},\nJe wedstrijd tegen {{opponentName}} staat binnenkort op het programma. Controleer het afgesproken moment en zorg dat je klaar bent om te starten.",
      "cta": "Open je programma"
    },
    "details": [
      [
        "Competitie",
        "{{eventName}}"
      ],
      [
        "Tegenstander",
        "{{opponentName}}"
      ],
      [
        "Wanneer",
        "{{date}} · {{time}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een bevestigde wedstrijd bereikt het herinneringsmoment.",
    "variables": [
      "date",
      "opponentName",
      "name",
      "eventName",
      "time"
    ]
  },
  {
    "id": "competition-entry",
    "label": "Competitiedeelname bevestigd",
    "category": "Competitie",
    "fields": {
      "subject": "Je doet mee aan {{eventName}}",
      "preheader": "Je competitieprogramma staat voor je klaar.",
      "title": "Een seizoen vol mooie partijen.",
      "body": "Hoi {{name}},\nJe deelname aan {{eventName}} is verwerkt. In je competitieprogramma vind je je tegenstanders en kun je samen speelmomenten afspreken.",
      "cta": "Bekijk competitie"
    },
    "details": [
      [
        "Competitie",
        "{{eventName}}"
      ],
      [
        "Vereniging",
        "{{clubName}}"
      ],
      [
        "Startdatum",
        "{{date}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een speler wordt succesvol aan de competitie toegevoegd.",
    "variables": [
      "eventName",
      "name",
      "clubName",
      "date"
    ]
  },
  {
    "id": "tournament-entry",
    "label": "Toernooiaanmelding ontvangen",
    "category": "Toernooien",
    "fields": {
      "subject": "Je aanmelding voor {{eventName}} is ontvangen",
      "preheader": "Je vindt de status in je evenementenoverzicht.",
      "title": "Je staat op de lijst.",
      "body": "Hoi {{name}},\nWe hebben je aanmelding voor {{eventName}} ontvangen. De actuele inschrijfstatus staat hieronder. Je hoort het wanneer er iets verandert.",
      "cta": "Bekijk inschrijving"
    },
    "details": [
      [
        "Toernooi",
        "{{eventName}}"
      ],
      [
        "Vereniging",
        "{{clubName}}"
      ],
      [
        "Status",
        "{{status}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een speler schrijft zich succesvol in voor een toernooi.",
    "variables": [
      "eventName",
      "name",
      "clubName",
      "status"
    ]
  },
  {
    "id": "tournament-approved",
    "label": "Toernooideelname bevestigd",
    "category": "Toernooien",
    "fields": {
      "subject": "Je doet mee aan {{eventName}}",
      "preheader": "Je plek is bevestigd. Bekijk de toernooi-informatie.",
      "title": "Jouw plek is binnen.",
      "body": "Hoi {{name}},\nJe deelname aan {{eventName}} is bevestigd. Bekijk de praktische informatie en de incheckmogelijkheden in de toernooikamer.",
      "cta": "Open toernooi"
    },
    "details": [
      [
        "Toernooi",
        "{{eventName}}"
      ],
      [
        "Vereniging",
        "{{clubName}}"
      ],
      [
        "Status",
        "Bevestigd"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "De organisatie bevestigt een deelnemersplaats.",
    "variables": [
      "eventName",
      "name",
      "clubName"
    ]
  },
  {
    "id": "tournament-rejected",
    "label": "Toernooiaanmelding afgewezen",
    "category": "Toernooien",
    "fields": {
      "subject": "Je aanmelding voor {{eventName}} is beoordeeld",
      "preheader": "Er is een besluit genomen over je toernooiaanmelding.",
      "title": "Bericht van de organisatie.",
      "body": "Hoi {{name}},\nDe organisatie heeft je aanmelding voor {{eventName}} afgewezen. Je actuele inschrijfstatus staat bij het toernooi. Neem bij vragen contact op met de organisatie.",
      "cta": "Bekijk aanmelding"
    },
    "details": [
      [
        "Toernooi",
        "{{eventName}}"
      ],
      [
        "Vereniging",
        "{{clubName}}"
      ],
      [
        "Besluit",
        "Afgewezen"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "De organisatie wijst een toernooiaanmelding af.",
    "variables": [
      "eventName",
      "name",
      "clubName"
    ]
  },
  {
    "id": "tournament-changed",
    "label": "Toernooi-informatie gewijzigd",
    "category": "Toernooien",
    "fields": {
      "subject": "De gegevens van {{eventName}} zijn gewijzigd",
      "preheader": "Bekijk de bijgewerkte datum en locatie.",
      "title": "Nieuwe informatie voor je toernooi.",
      "body": "Hoi {{name}},\nDe organisatie heeft de datum of locatie van {{eventName}} aangepast. Hieronder vind je de bijgewerkte informatie. Controleer het toernooi voor de laatste details.",
      "cta": "Bekijk wijzigingen"
    },
    "details": [
      [
        "Toernooi",
        "{{eventName}}"
      ],
      [
        "Datum",
        "{{date}}"
      ],
      [
        "Locatie",
        "{{location}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een organisatie wijzigt de datum of locatie van een toernooi met inschrijvingen.",
    "variables": [
      "eventName",
      "name",
      "date",
      "location"
    ]
  },
  {
    "id": "tournament-waitlist",
    "label": "Plaats op de wachtlijst",
    "category": "Toernooien",
    "fields": {
      "subject": "Je staat op de wachtlijst voor {{eventName}}",
      "preheader": "Zodra er een plek vrijkomt, krijg je bericht.",
      "title": "Nog even in de wacht.",
      "body": "Hoi {{name}},\nHet deelnemersveld van {{eventName}} is op dit moment vol. Je aanmelding staat op de wachtlijst. Zodra je doorschuift, krijg je een nieuwe bevestiging.",
      "cta": "Bekijk wachtlijst"
    },
    "details": [
      [
        "Toernooi",
        "{{eventName}}"
      ],
      [
        "Vereniging",
        "{{clubName}}"
      ],
      [
        "Status",
        "Wachtlijst"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een inschrijving belandt op de wachtlijst.",
    "variables": [
      "eventName",
      "name",
      "clubName"
    ]
  },
  {
    "id": "tournament-promoted",
    "label": "Doorgeschoven van wachtlijst",
    "category": "Toernooien",
    "fields": {
      "subject": "Er is een plek voor je bij {{eventName}}",
      "preheader": "Je bent doorgeschoven. Bekijk je deelname.",
      "title": "De oche is voor jou.",
      "body": "Hoi {{name}},\nGoed nieuws: er is een plaats vrijgekomen bij {{eventName}} en je bent doorgeschoven van de wachtlijst naar het deelnemersveld. Bekijk je inschrijving en de praktische informatie.",
      "cta": "Bekijk je deelname"
    },
    "details": [
      [
        "Toernooi",
        "{{eventName}}"
      ],
      [
        "Vereniging",
        "{{clubName}}"
      ],
      [
        "Status",
        "Deelname bevestigd"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een wachtende speler krijgt een vrije deelnemersplaats.",
    "variables": [
      "eventName",
      "name",
      "clubName"
    ]
  },
  {
    "id": "tournament-withdrawn",
    "label": "Afmelding bevestigd",
    "category": "Toernooien",
    "fields": {
      "subject": "Je bent afgemeld voor {{eventName}}",
      "preheader": "Je afmelding is verwerkt in het deelnemersoverzicht.",
      "title": "Je afmelding is verwerkt.",
      "body": "Hoi {{name}},\nJe deelname aan {{eventName}} is ingetrokken. De deelnemerslijst is bijgewerkt. Hopelijk zien we je bij een volgende editie weer aan de oche.",
      "cta": "Bekijk evenementen"
    },
    "details": [
      [
        "Toernooi",
        "{{eventName}}"
      ],
      [
        "Status",
        "Afgemeld"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een ingeschreven speler meldt zich af.",
    "variables": [
      "eventName",
      "name"
    ]
  },
  {
    "id": "tournament-reminder",
    "label": "Toernooi- en incheckherinnering",
    "category": "Toernooien",
    "fields": {
      "subject": "Ben je klaar voor {{eventName}}?",
      "preheader": "Bekijk het incheckmoment en de laatste toernooi-informatie.",
      "title": "Morgen gaat het los.",
      "body": "Hoi {{name}},\n{{eventName}} komt eraan. Bekijk de actuele tijden en check op tijd in, zodat de organisatie de borden direct kan vullen.",
      "cta": "Bekijk incheckinformatie"
    },
    "details": [
      [
        "Toernooi",
        "{{eventName}}"
      ],
      [
        "Wanneer",
        "{{date}} · {{time}}"
      ],
      [
        "Vereniging",
        "{{clubName}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een toernooi bereikt het ingestelde herinneringsmoment.",
    "variables": [
      "eventName",
      "name",
      "date",
      "time",
      "clubName"
    ]
  },
  {
    "id": "board-call",
    "label": "Oproep naar de baan",
    "category": "Toernooien",
    "fields": {
      "subject": "{{boardName}} wacht op jou, {{name}}",
      "preheader": "Je volgende toernooiwedstrijd kan beginnen.",
      "title": "Jouw baan staat klaar.",
      "body": "Hoi {{name}},\nJe bent ingedeeld voor de volgende partij. Meld je bij de aangegeven baan en controleer de wedstrijd op je telefoon. Het live baanscherm toont altijd de actuele stand.",
      "cta": "Open je wedstrijd"
    },
    "details": [
      [
        "Toernooi",
        "{{eventName}}"
      ],
      [
        "Baan",
        "{{boardName}}"
      ],
      [
        "Tegenstander",
        "{{opponentName}}"
      ]
    ],
    "enabled": false,
    "readOnly": false,
    "trigger": "Een partij krijgt een baan toegewezen.",
    "variables": [
      "boardName",
      "name",
      "eventName",
      "opponentName"
    ]
  },
  {
    "id": "result-confirm",
    "label": "Uitslag ter bevestiging",
    "category": "Wedstrijden",
    "fields": {
      "subject": "Bevestig de uitslag tegen {{opponentName}}",
      "preheader": "Controleer de stand voordat deze definitief wordt.",
      "title": "Klopt de uitslag?",
      "body": "Hoi {{name}},\nEr is een uitslag ingevoerd voor je wedstrijd tegen {{opponentName}}. Controleer de stand en bevestig de uitslag, of geef aan wanneer er iets niet klopt.",
      "cta": "Controleer uitslag"
    },
    "details": [
      [
        "Wedstrijd",
        "{{name}} · {{opponentName}}"
      ],
      [
        "Uitslag",
        "{{score}}"
      ],
      [
        "Status",
        "Wacht op bevestiging"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een uitslag wacht op bevestiging door de andere speler.",
    "variables": [
      "opponentName",
      "name",
      "score"
    ]
  },
  {
    "id": "result-confirmed",
    "label": "Uitslag definitief",
    "category": "Wedstrijden",
    "fields": {
      "subject": "Uitslag bevestigd: {{score}} tegen {{opponentName}}",
      "preheader": "De uitslag staat in je wedstrijdhistorie.",
      "title": "Deze partij staat genoteerd.",
      "body": "Hoi {{name}},\nDe uitslag van je wedstrijd tegen {{opponentName}} is bevestigd. Je vindt de partij terug in je wedstrijdhistorie.",
      "cta": "Bekijk je wedstrijd"
    },
    "details": [
      [
        "Tegenstander",
        "{{opponentName}}"
      ],
      [
        "Uitslag",
        "{{score}}"
      ],
      [
        "Status",
        "Definitief"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "De uitslag is definitief bevestigd.",
    "variables": [
      "score",
      "opponentName",
      "name"
    ]
  },
  {
    "id": "result-disputed",
    "label": "Uitslag wordt beoordeeld",
    "category": "Wedstrijden",
    "fields": {
      "subject": "Een wedstrijduitslag wordt beoordeeld",
      "preheader": "De wedstrijdleiding kijkt naar de gemelde afwijking.",
      "title": "Samen naar de juiste uitslag.",
      "body": "Hoi {{name}},\nDe uitslag van {{actorName}} is betwist. De wedstrijdleiding kan de melding bekijken en een besluit vastleggen. Je ziet de voortgang bij de wedstrijd.",
      "cta": "Bekijk de melding"
    },
    "details": [
      [
        "Wedstrijd",
        "{{actorName}}"
      ],
      [
        "Gemelde uitslag",
        "{{score}}"
      ],
      [
        "Toelichting",
        "{{reason}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een speler betwist een ingevoerde uitslag.",
    "variables": [
      "name",
      "actorName",
      "score",
      "reason"
    ]
  },
  {
    "id": "result-resolved",
    "label": "Besluit over uitslag",
    "category": "Wedstrijden",
    "fields": {
      "subject": "Besluit over je wedstrijd tegen {{opponentName}}",
      "preheader": "De wedstrijdleiding heeft de melding afgehandeld.",
      "title": "De uitslag is beoordeeld.",
      "body": "Hoi {{name}},\nDe wedstrijdleiding heeft de melding over je wedstrijd tegen {{opponentName}} afgehandeld. Hieronder lees je het besluit.",
      "cta": "Bekijk het besluit"
    },
    "details": [
      [
        "Tegenstander",
        "{{opponentName}}"
      ],
      [
        "Vastgelegde uitslag",
        "{{score}}"
      ],
      [
        "Besluit",
        "{{reason}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "De wedstrijdleiding handelt een betwiste uitslag af.",
    "variables": [
      "opponentName",
      "name",
      "score",
      "reason"
    ]
  },
  {
    "id": "room-invite",
    "label": "Uitnodiging voor een kamer",
    "category": "Sociaal",
    "fields": {
      "subject": "{{actorName}} nodigt je uit voor {{roomName}}",
      "preheader": "Een plek om af te spreken, te praten en uit te dagen.",
      "title": "Schuif aan in de kamer.",
      "body": "Hoi {{name}},\n{{actorName}} heeft je uitgenodigd voor {{roomName}}. Open de kamer om je dartmaatjes te ontmoeten en samen een partij af te spreken.",
      "cta": "Open de kamer"
    },
    "details": [
      [
        "Kamer",
        "{{roomName}}"
      ],
      [
        "Uitgenodigd door",
        "{{actorName}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een nieuwe privékamer wordt met een geselecteerde vriend aangemaakt.",
    "variables": [
      "actorName",
      "roomName",
      "name"
    ]
  },
  {
    "id": "moderation-notice",
    "label": "Moderatiebesluit",
    "category": "Sociaal",
    "fields": {
      "subject": "Bericht van de moderatie van {{roomName}}",
      "preheader": "Er is een moderatiebesluit vastgelegd.",
      "title": "Bericht van de moderatie.",
      "body": "Hoi {{name}},\nDe moderatie heeft een besluit vastgelegd binnen {{roomName}}. Lees hieronder de toelichting. Je vindt de actuele status in je eigen omgeving.",
      "cta": "Bekijk de kamer"
    },
    "details": [
      [
        "Kamer",
        "{{roomName}}"
      ],
      [
        "Maatregel",
        "{{status}}"
      ],
      [
        "Toelichting",
        "{{reason}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een moderator neemt een maatregel tegen een kamerlid.",
    "variables": [
      "roomName",
      "name",
      "status",
      "reason"
    ]
  },
  {
    "id": "moderation-report",
    "label": "Nieuwe moderatiemelding",
    "category": "Sociaal",
    "fields": {
      "subject": "Nieuwe melding in {{roomName}}",
      "preheader": "Er staat een melding klaar om te beoordelen.",
      "title": "Een melding vraagt aandacht.",
      "body": "Hoi {{name}},\n{{actorName}} heeft een melding gedaan over {{roomName}}. Bekijk de context en leg een passende afhandeling vast in het meldingenoverzicht.",
      "cta": "Bekijk melding"
    },
    "details": [
      [
        "Kamer",
        "{{roomName}}"
      ],
      [
        "Melder",
        "{{actorName}}"
      ],
      [
        "Toelichting",
        "{{reason}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een speler meldt gedrag of een bericht.",
    "variables": [
      "roomName",
      "name",
      "actorName",
      "reason"
    ]
  },
  {
    "id": "registration-received",
    "label": "Spelersaanmelding ontvangen",
    "category": "Account",
    "fields": {
      "subject": "Je spelersaanmelding is ontvangen, {{name}}",
      "preheader": "De beheerder beoordeelt je aanmelding.",
      "title": "Bedankt voor je aanmelding.",
      "body": "Hoi {{name}},\nWe hebben je spelersaanmelding ontvangen. De beheerder beoordeelt deze en je ontvangt bericht zodra er een besluit is.",
      "cta": "Naar DartFlow"
    },
    "details": [
      [
        "Speler",
        "{{name}}"
      ],
      [
        "Status",
        "Wacht op beoordeling"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een bezoeker meldt zich als speler aan in het prototype.",
    "variables": [
      "name"
    ]
  },
  {
    "id": "registration-decision",
    "label": "Besluit spelersaanmelding",
    "category": "Account",
    "fields": {
      "subject": "Je spelersaanmelding: {{status}}",
      "preheader": "Er is een besluit genomen over je aanmelding.",
      "title": "Nieuws over je aanmelding.",
      "body": "Hoi {{name}},\nDe beheerder heeft je spelersaanmelding beoordeeld. Hieronder vind je het besluit.",
      "cta": "Open DartFlow"
    },
    "details": [
      [
        "Speler",
        "{{name}}"
      ],
      [
        "Besluit",
        "{{status}}"
      ]
    ],
    "enabled": true,
    "readOnly": false,
    "trigger": "Een beheerder keurt een spelersaanmelding goed of af.",
    "variables": [
      "status",
      "name"
    ]
  }
];
