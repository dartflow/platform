# Dartflow · interactief prototype

Browser application based on the supplied demos and the black/gold reference. `npm run dev` serves the app and a local SQLite preview of the shared Baanmodus API. `npm run build` packages the app as a Sites Worker. `npm test` runs scoring, venue and multi-device integration tests.

Features: dashboard; four shared scoreboards; 301/501 scoring and double-out routes; bust validation; leg/match wins; undo; per-match statistics; tournament create/edit/filter; player management and profiles; demo registrations and approval; local entry requests; pool shuffle and example standings; a separate interactive knockout simulation; rankings; CSV export; example season charts; settings; responsive navigation; admin/player demo roles; browser-local persistence/reset.

The original platform screens keep their demo data in localStorage (`puinruimers-demo-v3`). Their role switch is demonstrative. Baanmodus stores shared board state, demo profiles and results in D1. The 9:16 display and player pages refresh the same server revision. The API accepts scores from the current writer only and records the revision and action ID together, so retried or competing actions cannot book a visit twice.

Open `#baan` to try a private-by-link test room with two demo player slots, or open the fixed Duindorp SV board. The two phone links support separate demo profiles in a single browser. For a fixture linked from Toernooiregie, both players confirm the shared result before an organizer retrieves it into the venue schedule.

Scoring engine: public/scoring.js. Exports createMatch, applyScore, undo, checkout. Validates attainable scores for selected dart count, double finish, majority legs and bust; updates immutable snapshots and visit statistics.

Validated: JavaScript syntax; 9 scoring scenarios (invalid totals, bust, checkout confirmation and dart count, highest finish, match completion, alternating leg starter, multi-step undo); desktop/mobile browser inspection; tournament creation; approval; checkout and undo flow.

Assets: original code-native SVG club emblem and dartboard, inspired by the supplied reference. Fonts use DM Sans and Barlow Condensed with system fallbacks.

## Dartflow identity

The crowned gold shield and central dart pair with a custom vector Dartflow wordmark in public/assets/dartflow-logo.svg. The shield is available separately as public/assets/dartflow-icon.svg for the favicon and interface. The app uses black, graphite and champagne gold. De Puinruimers remains the demo club.

## Dartflow platform expansion

The active plan is PLAN.md. Modules: portal.js (player home, friends, requests, reports), rooms.js (match lobby/game, local camera test), competitions.js (leagues and nested tournament hub), training.js, community.js (capacity, privacy, moderation and challenges), clubs.js (multiple memberships, role and club environment management). play.css styles the player views.

One global user account is represented by the Rick demo profile. activeClubId selects the platform scope (null) or a joined club. Legacy club 701 is De Puinruimers; club 702 is Dartflow Social Club. Platform examples include the Global League and World Series. Event ownership is retained on room/match records. The UI and data checks are a local prototype, not production tenant isolation.

Validation added: 15 scoring cases; room lifecycle and scope checks; 9 league/tournament cases; 17 community scenarios; 6 club membership/scope scenarios. Browser-checked challenge-to-room flow, score/turn handling and simulated disconnect; two same-origin tabs with separate player perspectives exchange real score updates via storage events.
