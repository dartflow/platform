package nl.dartflow.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Native route tests use isolated server projections and never mutate hosted data. */
class PlayerReleaseUiTest {
    @get:Rule val compose = createComposeRule()
    private fun signedIn() = PlayerUiState(loading = false, profile = PlayerProfile("p1", "Danny", "Danny", "Danny", true, true, true), session = PlayerSession("p1", "fixture@example.test", Long.MAX_VALUE))

    @Test fun personalOrganizerPublishesExplicitOwnershipAndChosenPrivacy() {
        var submitted: JSONObject? = null
        val draft = PlayerOrganizerDraft.sanitize(JSONObject()).put("step", 3).put("name", "Vriendenavond").put("date", "2026-11-20").put("visibility", "private")
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerOrganizerScreen(signedIn().copy(organizerDraft = draft), PlayerActions(platformAction = { submitted = it })) } } }
        compose.onNodeWithText("Persoonlijk evenement · geen officiële rankingpunten").assertExists()
        compose.onNodeWithText("Publiceer toernooi").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals("personal", submitted?.getString("ownership"))
            assertEquals("private", submitted?.getString("visibility"))
            assertFalse(submitted?.has("clubId") ?: true)
            assertFalse(submitted?.has("rankingDestinations") ?: true)
        }
    }

    @Test fun revokedDirectorPermissionOffersNoMutationControls() {
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) {
            PlayerDirectorScreen(signedIn().copy(activeId = "event-1", resource = json("entity" to json("id" to "event-1", "name" to "Clubevent", "canManage" to false))), PlayerActions())
        } } }
        compose.onNodeWithText("Je hebt geen actueel beheerrecht voor dit evenement.").assertExists()
        compose.onNodeWithText("Maak loting").assertDoesNotExist()
        compose.onNodeWithText("Beschikbare partijen oproepen").assertDoesNotExist()
    }

    @Test fun publicHelpNeedsNoLoginAndFindsThePublishedAnswer() {
        var destination: Pair<PlayerScreen, String?>? = null
        val help = json("version" to "2026.11.19", "publishedAt" to "2026-11-19", "items" to JSONArray(listOf(json("id" to "plaatsing", "category" to "Rankings", "question" to "Hoe werkt mijn voorlopige rating?", "answer" to "Je begint bij 1500."))))
        compose.setContent { DartFlowPlayerTheme { PlayerApp(PlayerUiState(loading = false, screen = PlayerScreen.HELP, resource = help), PlayerActions(navigate = { screen, id -> destination = screen to id })) } }
        compose.onNodeWithText("E-mailadres").assertDoesNotExist()
        compose.onNodeWithText("Zoek in vragen en antwoorden").performTextInput("1500")
        compose.onNodeWithText("Lees antwoord").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(PlayerScreen.HELP to "id=plaatsing", destination) }
    }

    @Test fun pendingPrivateInvitationDoesNotRequirePublicEventDiscovery() {
        var command: JSONObject? = null
        val invitation = json("id" to "event-1", "name" to "Besloten avond", "kind" to "tournament", "code" to "K7M2")
        compose.setContent { DartFlowPlayerTheme { PlayerApp(signedIn().copy(screen = PlayerScreen.EVENT, activeId = "event-1", invitation = invitation), PlayerActions(platformAction = { command = it })) } }
        compose.onNodeWithText("Inschrijven met deze uitnodiging").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals("competition.register", command?.getString("type"))
            assertEquals("event-1", command?.getString("id"))
            assertEquals("K7M2", command?.getString("code"))
        }
    }

    @Test fun captainSubmitsFourNativeSlotsAgainstTheDisplayedRevision() {
        var path: String? = null
        var body: JSONObject? = null
        val people = (1..4).map { json("id" to "p$it", "name" to "Speler $it") }
        val fixture = json("id" to "fixture-1", "round" to 1, "homeId" to "home", "awayId" to "away", "status" to "scheduled", "slots" to JSONArray(), "capabilities" to json("canLineupHome" to true), "lineups" to json("home" to json("players" to JSONArray(listOf("p1", "p2", "p3", "p4")), "submittedAt" to JSONObject.NULL)))
        val season = json("id" to "season-1", "revision" to 12, "name" to "Landelijk seizoen", "format" to "teams", "settings" to JSONObject(), "eligiblePlayers" to JSONArray(people), "teams" to JSONArray(listOf(json("id" to "home", "name" to "Ons team", "playerIds" to JSONArray(listOf("p1", "p2", "p3", "p4"))), json("id" to "away", "name" to "Uitteam", "playerIds" to JSONArray()))), "fixtures" to JSONArray(listOf(fixture)))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerSeasonDetail(signedIn().copy(resource = json("season" to season)), PlayerActions(command = { target, command -> path = target; body = command })) } } }
        compose.onNodeWithText("Open ontmoeting").performScrollTo().performClick()
        compose.onNodeWithText("Dien opstelling definitief in").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals("/seasons/actions", path)
            assertEquals(12, body?.getInt("expectedRevision"))
            assertEquals("home", body?.getJSONObject("action")?.getString("side"))
            assertEquals(listOf("p1", "p2", "p3", "p4"), body?.getJSONObject("action")?.getJSONArray("players")?.strings())
            assertTrue(body?.getJSONObject("action")?.getBoolean("submit") == true)
        }
    }
    @Test fun nativeDartEntrySubmitsObservedTargetsForServerRuleEvaluation() {
        var type: String? = null
        var command: JSONObject? = null
        val match = PlayerMatch.parse(json("id" to "match-1", "revision" to 3, "status" to "live", "players" to JSONArray(listOf(json("id" to "p1", "name" to "Danny"), json("id" to "p2", "name" to "Noor"))), "remaining" to JSONArray(listOf(501, 501)), "settings" to json("inRule" to "double", "outRule" to "master"), "permissions" to json("canScore" to true)))
        compose.setContent { DartFlowPlayerTheme { PlayerApp(signedIn().copy(screen = PlayerScreen.MATCH, match = match), PlayerActions(matchAction = { action, input -> type = action; command = input })) } }
        compose.onNodeWithTag("native-score-console").assertIsDisplayed()
        compose.onNodeWithText("Single").performClick()
        compose.onNodeWithText("Dubbel").performClick()
        compose.onNodeWithText("20").performScrollTo().performClick()
        compose.onNodeWithText("‹ Terug").performClick()
        compose.onNodeWithTag("native-score-console").assertDoesNotExist()
        compose.onNodeWithText("Open score-invoer").performScrollTo().performClick()
        compose.onNodeWithTag("entered-dart-hits").assertTextEquals("D20")
        compose.onNodeWithTag("confirm-dart-hits").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals("score", type)
            assertEquals(40, command?.getInt("score"))
            assertEquals(1, command?.getInt("darts"))
            assertEquals(listOf("D20"), command?.getJSONArray("dartHits")?.strings())
            assertFalse(command?.has("remaining") ?: true)
        }
    }

    @Test fun personalEventNeverOffersOfficialDeclarationOrFinalizationActions() {
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerEventRankingsScreen(signedIn().copy(resource = json("entityId" to "event-1", "ownership" to "personal", "name" to "Vriendenavond", "canRequest" to true, "canFinalize" to true)), PlayerActions()) } } }
        compose.onNodeWithText("Persoonlijk toernooi · geen officiële rating- of circuitpunten.").assertExists()
        compose.onNodeWithText("Dien erkenningsaanvraag in").assertDoesNotExist()
        compose.onNodeWithText("Controleer en publiceer circuiteindstand").assertDoesNotExist()
    }

    @Test fun sharedConceptResumeUsesTheDisplayedRevisionAndCurrentClubScope() {
        var resumed: JSONObject? = null
        var command: JSONObject? = null
        val draft = json("id" to "10000000-0000-4000-8000-000000000002", "kind" to "tournament", "ownership" to "club", "clubId" to "club-1", "name" to "Clubavond", "revision" to 7, "canEdit" to true, "values" to json("name" to "Clubavond"))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerCloudDraftPanel(signedIn().copy(resource = json("drafts" to JSONArray(listOf(draft)))), PlayerActions(command = { _, body -> command = body }), "tournament", "club", "club-1", "Clubavond", "2", json("name" to "Clubavond")) { resumed = it } } } }
        compose.onNodeWithText("Hervat Clubavond").performScrollTo().performClick()
        compose.onNodeWithText("Werk accountconcept bij").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals("Clubavond", resumed?.getString("name"))
            val action = command!!.getJSONObject("action")
            assertEquals(7, action.getInt("expectedRevision"))
            assertEquals("club-1", action.getString("clubId"))
            assertEquals(draft.getString("id"), action.getString("id"))
        }
    }
    @Test fun defenderAnswersTheRealPendingLadderChallenge() {
        var command: JSONObject? = null
        val season = json("id" to "season-1", "name" to "Ladder", "format" to "ladder", "status" to "active", "revision" to 9, "settings" to json("ladderDistance" to 3, "ladderAnswerHours" to 48, "ladderPlayDays" to 7), "participants" to JSONArray(listOf(json("id" to "p1", "name" to "Danny", "status" to "active"), json("id" to "p2", "name" to "Noor", "status" to "active"))), "ladder" to json("order" to JSONArray(listOf("p1", "p2")), "challenges" to JSONArray(listOf(json("id" to "challenge-7", "challengerId" to "p2", "defenderId" to "p1", "status" to "pending", "answerBy" to "2026-11-21T18:00:00Z")))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerSeasonFormatControls(season, signedIn(), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Accepteer uitdaging").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals(9, command?.getInt("expectedRevision"))
            assertEquals("challenge-7", command?.getJSONObject("action")?.getString("challengeId"))
            assertTrue(command?.getJSONObject("action")?.getBoolean("accept") == true)
        }
    }
    @Test fun cricketRendersAuthoritativePointsAndMarksWithoutX01Statistics() {
        val match = PlayerMatch.parse(json("id" to "cricket-1", "players" to JSONArray(listOf(json("id" to "p1", "name" to "Danny"), json("id" to "p2", "name" to "Noor"))), "settings" to json("discipline" to "cricket", "cricketMode" to "standard"), "cricket" to json("marks" to JSONArray(listOf(JSONArray(listOf(3, 2, 1, 0, 0, 0, 3)), JSONArray(listOf(0, 0, 0, 0, 0, 0, 0)))), "points" to JSONArray(listOf(40, 0)))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerCricketTable(match) } } }
        compose.onNodeWithText("Cricket · punten").assertExists()
        compose.onNodeWithText("Punten 40 – 0").assertExists()
        compose.onNodeWithText("AVG").assertDoesNotExist()
        compose.onNodeWithText("180's").assertDoesNotExist()
        compose.onNodeWithText("Hoogste finish").assertDoesNotExist()
    }
    @Test fun dropInPresenceUsesTheOwnParticipantWithoutAPlannedFixture() {
        var command: JSONObject? = null
        val season = json("id" to "season-inloop", "format" to "drop-in", "status" to "active", "revision" to 11, "participants" to JSONArray(listOf(json("id" to "p1", "name" to "Danny", "status" to "active", "checkedIn" to false, "available" to true))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerSeasonFormatControls(season, signedIn(), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onAllNodes(isToggleable())[0].performClick()
        compose.runOnIdle {
            assertEquals(11, command?.getInt("expectedRevision"))
            val action = command!!.getJSONObject("action")
            assertEquals("season.participant", action.getString("type"))
            assertEquals("p1", action.getString("playerId"))
            assertTrue(action.getBoolean("checkedIn"))
            assertFalse(action.has("fixtureId"))
        }
    }

    @Test fun faqPublicationUsesTheReviewedDraftAndPublicContentVersion() {
        var command: JSONObject? = null
        val item = json("id" to "rating", "question" to "Hoe werkt rating?", "answer" to "Lees het gepubliceerde reglement.", "category" to "Rankings", "keywords" to JSONArray(), "audience" to "player")
        val draft = json("id" to "draft-7", "questionId" to "rating", "revision" to 7, "item" to item)
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerFaqAdminScreen(signedIn().copy(canManagePlatform = true, resource = json("published" to json("version" to "published-v3", "items" to JSONArray()), "drafts" to JSONArray(listOf(draft)))), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Reden voor publicatie of herstel").performScrollTo().performTextInput("Gecontroleerde uitleg")
        compose.onNodeWithText("Publiceer rating").performScrollTo().performClick()
        compose.onNodeWithText("Bevestigen").performClick()
        compose.runOnIdle {
            val action = command!!.getJSONObject("action")
            assertEquals("faq.publish", action.getString("type"))
            assertEquals("draft-7", action.getString("draftId"))
            assertEquals(7, action.getInt("expectedRevision"))
            assertEquals("published-v3", action.getString("expectedVersion"))
        }
    }
    @Test fun revokedFaqEditorCannotSaveOrPublishEvenWhenOldDraftDataRemains() {
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerFaqAdminScreen(signedIn().copy(canManagePlatform = false, resource = json("drafts" to JSONArray(listOf(json("questionId" to "rating"))))), PlayerActions()) } } }
        compose.onNodeWithText("Je hebt geen actueel recht om de gedeelde hulp te publiceren.").assertExists()
        compose.onNodeWithText("Bewaar hulpconcept").assertDoesNotExist()
        compose.onNodeWithText("Publiceer rating").assertDoesNotExist()
    }

    @Test fun confirmedMatchCorrectionUsesTheCurrentServerRevisionAndRequiresExplicitReview() {
        var command: JSONObject? = null
        val match = PlayerMatch.parse(json("id" to "match-1", "revision" to 42, "status" to "confirmed", "players" to JSONArray(listOf(json("id" to "p1", "name" to "Danny"), json("id" to "p2", "name" to "Noor")))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerPrimaryCorrectionPanel(match, signedIn().copy(resource = json("corrections" to json("canRequest" to true, "maxUndoCount" to 5, "requests" to JSONArray()))), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Wat moet worden gecorrigeerd?").performScrollTo().performTextInput("De laatste beurt klopt niet")
        compose.onNodeWithText("Correctie ter beoordeling indienen").performScrollTo().performClick()
        compose.runOnIdle { assertNull(command) }
        compose.onNodeWithText("Bevestigen").performClick()
        compose.runOnIdle {
            val action = command!!.getJSONObject("action")
            assertEquals("correction.request", action.getString("type"))
            assertEquals(42, action.getInt("expectedRevision"))
            assertEquals(1, action.getInt("undoCount"))
            assertFalse(action.has("score"))
            assertFalse(action.has("winnerId"))
        }
    }

    @Test fun remoteBindingUsesOnlyTheServerAuthorizedSideAndOwnRegisteredHomeBoard() {
        var command: JSONObject? = null
        val season = json("id" to "remote-season", "revision" to 31, "settings" to json("playMode" to "remote"))
        val fixture = json("id" to "remote-fixture", "capabilities" to json("canBindHome" to true, "canBindAway" to false), "remoteAssignments" to json("home" to json("boardId" to "home-board", "writerId" to "p1")))
        val resource = json("locationContext" to json("locations" to JSONArray(listOf(json("boards" to JSONArray(listOf(json("id" to "home-board", "name" to "Mijn thuisbaan"))))))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerSeasonRemoteAssignments(season, fixture, signedIn().copy(resource = resource), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Koppel baan en schrijver · Uitzijde").assertDoesNotExist()
        compose.onNodeWithText("Koppel baan en schrijver · Thuiszijde").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle {
            val action = command!!.getJSONObject("action")
            assertEquals("season.remote-bind", action.getString("type"))
            assertEquals(31, command!!.getInt("expectedRevision"))
            assertEquals("home", action.getString("side"))
            assertEquals("home-board", action.getString("boardId"))
            assertEquals("p1", action.getString("writerId"))
        }
    }
    @Test fun aCoorganizerCannotGrantOtherCoorganizers() {
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerOrganizerSharing(json("id" to "event-1", "name" to "Clubavond", "ownerId" to "another-owner", "canManage" to true), signedIn(), PlayerActions()) } } }
        compose.onNodeWithText("Verleen evenementtoegang").assertDoesNotExist()
        compose.onNodeWithText("Trek evenementtoegang in").assertDoesNotExist()
        compose.onNodeWithText("Controleer lege kopie").assertExists()
    }

    @Test fun reservationApprovalCarriesTheReviewedRevisionAndExactAssignedBoard() {
        var command: JSONObject? = null
        val location = json("id" to "venue-1", "boards" to JSONArray(listOf(json("id" to "board-1", "name" to "Baan 1", "enabled" to true))))
        val currentRevision = androidx.compose.runtime.mutableStateOf(6)
        val reservation = json("id" to "reservation-1", "locationId" to "venue-1", "eventName" to "Clubavond", "locationName" to "Sportcafé", "status" to "pending", "revision" to 6, "boardCount" to 1, "preferredBoardId" to "board-1", "canDecide" to true)
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerReservationDecision(JSONObject(reservation.toString()).put("revision", currentRevision.value), signedIn().copy(resource = json("locations" to JSONArray(listOf(location)))), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Controleer toewijzing en goedkeuring").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertNull(command); currentRevision.value = 7 }
        compose.onNodeWithText("Bevestigen").performClick()
        compose.runOnIdle {
            assertEquals(6, command!!.getInt("expectedRevision"))
            val action = command!!.getJSONObject("action")
            assertEquals("reservation.accept", action.getString("type"))
            assertEquals(listOf("board-1"), action.getJSONArray("boardIds").strings())
        }
    }
    @Test fun forceReleaseRequiresBothConfirmationsAndTheCapturedBoardName() {
        var command: JSONObject? = null
        val board = json("id" to "board-1", "name" to "Baan Noord", "effectiveStatus" to "occupied", "activity" to json("sessionId" to "session-7", "phase" to "active"), "activeGame" to json("id" to "match-7", "kind" to "official", "label" to "Danny – Noor", "remote" to true, "boards" to JSONArray(listOf(json("id" to "board-1", "name" to "Baan Noord"), json("id" to "board-2", "name" to "Baan Zuid")))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerManagedLocationBoard(json("id" to "loc-1", "role" to "owner"), board, signedIn(), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Geforceerd vrijgeven · Baan Noord").performScrollTo().performClick()
        compose.onNodeWithText("Bevestigen en vrijgeven").assertIsNotEnabled()
        compose.onAllNodes(isToggleable())[0].performScrollTo().performClick()
        compose.onNodeWithText("Typ de baannaam ter bevestiging").performScrollTo().performTextInput("Baan Noord")
        compose.onNodeWithText("Reden voor vrijgave").performScrollTo().performTextInput("Locatie sluit")
        compose.onNodeWithText("Bevestigen en vrijgeven").assertIsNotEnabled()
        compose.onAllNodes(isToggleable())[1].performScrollTo().performClick()
        compose.onNodeWithText("Bevestigen en vrijgeven").assertIsEnabled().performClick()
        compose.runOnIdle {
            val action = command!!.getJSONObject("action")
            assertEquals("session-7", action.getString("expectedSessionId"))
            assertEquals("match-7", action.getString("confirmedSourceId"))
            assertTrue(action.getBoolean("confirmedRemoteEffect"))
        }
    }
    @Test fun revokedReservationDecisionRightsHideMutationControls() {
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerReservationDecision(json("id" to "r1", "eventName" to "Clubavond", "status" to "pending", "canDecide" to false, "canCancel" to false), signedIn(), PlayerActions()) } } }
        compose.onNodeWithText("Controleer toewijzing en goedkeuring").assertDoesNotExist()
        compose.onNodeWithText("Wijs reserveringsaanvraag af").assertDoesNotExist()
        compose.onNodeWithText("Annuleer reservering").assertDoesNotExist()
    }

    @Test fun seasonRankingConsentUsesCanonicalParticipantCapabilityWithoutPlatformMembership() {
        var command: JSONObject? = null
        val dossier = json("entityId" to "season-1", "name" to "Teamcompetitie", "ownership" to "club", "canAccept" to true, "declarations" to JSONArray(listOf(json("id" to "declaration", "status" to "approved", "accepted" to false, "listName" to "Clubrating"))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerEventRankingsScreen(signedIn().copy(resource = dossier), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Ik stem in met deze gepubliceerde gevolgen").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals("event.accept", command!!.getJSONObject("action").getString("type"))
            assertEquals("season-1", command!!.getJSONObject("action").getString("entityId"))
        }
    }
    @Test fun vacantDivisionPlaceConfirmsOnlyTheServerSelectedCaseAndReviewedRevision() {
        var command: JSONObject? = null
        val season = json("id" to "new-season", "revision" to 23, "canManage" to true, "promotionSource" to json("seasonId" to "old-season", "revision" to 19), "divisions" to JSONArray(listOf(json("id" to "top", "name" to "Hoofdklasse"))), "participants" to JSONArray(listOf(json("id" to "rightful", "name" to "Noor"))), "vacancies" to JSONArray(listOf(json("id" to "vacancy-1", "divisionId" to "top", "status" to "ready", "candidateId" to "rightful", "sourceRevision" to 19))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerSeasonVacancies(season, signedIn(), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Reden vrijgevallen plaats of besluit").performScrollTo().performTextInput("Voorganger is gestopt")
        compose.onNodeWithText("Bekrachtig rechthebbende · Hoofdklasse").performScrollTo().performClick()
        compose.runOnIdle { assertNull(command) }
        compose.onNodeWithText("Bevestigen").performClick()
        compose.runOnIdle {
            assertEquals(23, command!!.getInt("expectedRevision"))
            val action = command!!.getJSONObject("action")
            assertEquals("season.vacancy-confirm", action.getString("type"))
            assertEquals("vacancy-1", action.getString("vacancyId"))
            assertFalse(action.has("playerId")); assertFalse(action.has("winnerId"))
        }
    }

    @Test fun staleCircuitQualificationKeepsItsFinaleAndRequiresANewGenerationDecision() {
        var command: JSONObject? = null
        val resource = json("canCreateQualification" to true, "selectedList" to json("id" to "circuit", "kind" to "circuit", "generation" to "generation-new", "canManage" to true), "qualification" to json("id" to "qualification-old", "revision" to 7, "sourceGeneration" to "generation-old", "currentGeneration" to "generation-new", "stale" to true, "status" to "qualified", "canManage" to true, "finaleId" to "existing-finale"))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerCircuitQualification(signedIn().copy(resource = resource), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Open afzonderlijke circuitfinale").assertExists()
        compose.onNodeWithText("Controleer afzonderlijke knock-outfinale").assertDoesNotExist()
        compose.onNodeWithText("Reden kwalificatiebesluit").performScrollTo().performTextInput("Bronuitslag is gecorrigeerd")
        compose.onNodeWithText("Herbereken op actuele circuitgeneratie").performScrollTo().performClick()
        compose.runOnIdle { assertNull(command) }
        compose.onNodeWithText("Bevestigen").performClick()
        compose.runOnIdle {
            val action = command!!.getJSONObject("action")
            assertEquals("qualification.create", action.getString("type"))
            assertEquals("generation-new", action.getString("expectedGeneration"))
            assertFalse(action.has("winnerId")); assertFalse(action.has("qualified"))
        }
    }
    @Test fun integrityResponseCannotBypassTheCanonicalIndependentReviewGate() {
        var command: JSONObject? = null
        val match = PlayerMatch.parse(json("id" to "match-1", "status" to "confirmed", "revision" to 30))
        val request = json("id" to "case-1", "status" to "pending", "requestedByName" to "Noor", "reason" to "Controleer beurt", "canRespond" to true, "canReview" to false, "responseDueAt" to "2026-11-20T19:00:00Z")
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerPrimaryCorrectionPanel(match, signedIn().copy(resource = json("corrections" to json("requests" to JSONArray(listOf(request))))), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Onafhankelijk besluit vastleggen").assertDoesNotExist()
        compose.onNodeWithText("Motivering reactie, beroep of sluiting").performScrollTo().performTextInput("Ik herken de bedoelde beurt")
        compose.onNodeWithText("Aanvullende onderbouwing · optioneel").performScrollTo().performTextInput("Mijn aantekening van die leg")
        compose.onNodeWithText("Voeg mijn reactie toe").performScrollTo().performClick()
        compose.runOnIdle { assertNull(command) }
        compose.onNodeWithText("Bevestigen").performClick()
        compose.runOnIdle {
            val action = command!!.getJSONObject("action")
            assertEquals("correction.respond", action.getString("type"))
            assertEquals("case-1", action.getString("correctionId"))
            assertEquals("Mijn aantekening van die leg", action.getString("evidenceText"))
            assertFalse(action.has("decision")); assertFalse(action.has("score"))
        }
    }

    @Test fun aHistoricalMomentThatDisappearsDuringRefreshRequiresAnExplicitNewChoice() {
        val moment = json("visitIndex" to 5, "setNumber" to 1, "leg" to 2, "playerName" to "Noor", "score" to 45, "darts" to 3)
        val dossier = androidx.compose.runtime.mutableStateOf(json("canRequest" to true, "maxUndoCount" to 5, "moments" to JSONArray(listOf(moment))))
        val match = PlayerMatch.parse(json("id" to "match", "revision" to 31, "status" to "confirmed"))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerPrimaryCorrectionPanel(match, signedIn().copy(resource = json("corrections" to dossier.value)), PlayerActions()) } } }
        compose.onNodeWithText("Kies aantal laatste beurten").performScrollTo().performClick()
        compose.onNodeWithText("Set 1 · leg 2 · Noor · 45 punten / 3 darts").performClick()
        compose.onNodeWithText("Wat moet worden gecorrigeerd?").performScrollTo().performTextInput("Deze aangewezen beurt klopt niet")
        compose.onNodeWithText("Correctie ter beoordeling indienen").performScrollTo().assertIsEnabled()
        compose.runOnIdle { dossier.value = json("canRequest" to true, "maxUndoCount" to 5, "moments" to JSONArray()) }
        compose.onNodeWithText("Correctie ter beoordeling indienen").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("De gekozen beurt valt buiten de huidige herstelbare historie. Kies opnieuw voordat je het bezwaar indient.").assertExists()
    }

}
