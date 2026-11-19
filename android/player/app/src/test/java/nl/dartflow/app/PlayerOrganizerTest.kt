package nl.dartflow.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlayerOrganizerTest {
    private fun draft() = PlayerOrganizerDraft.sanitize(JSONObject()).put("name", "Vrijdagcup").put("date", "2026-11-20")

    @Test fun aPersonalTournamentNeverCarriesAClubOrRankingDestination() {
        val input = draft().put("clubId", "forged-club").put("ranking", true).put("destinations", JSONArray(listOf("national")))
        val command = PlayerOrganizerDraft.command(input)
        assertEquals("personal", command.getString("ownership"))
        assertFalse(command.has("clubId"))
        assertFalse(command.has("ranking"))
        assertFalse(command.has("destinations"))
        assertEquals("tournament.create", command.getString("type"))
        assertTrue(command.getBoolean("drawCheckedInOnly"))
    }
    @Test fun wizardDoesNotPersistCredentialsOrArbitraryFields() {
        val safe = PlayerOrganizerDraft.sanitize(draft().put("pin", "012345").put("accessToken", "secret").put("ownerId", "somebody-else"))
        assertFalse(safe.has("pin"))
        assertFalse(safe.has("accessToken"))
        assertFalse(safe.has("ownerId"))
        assertFalse(safe.toString().contains("secret"))
        assertEquals("Vrijdagcup", safe.getString("name"))
    }
    @Test fun impossibleDateAndInvalidTournamentBoundsAreRejected() {
        val input = draft().put("date", "2026-02-30").put("capacity", "129").put("boards", "0").put("poolCount", "9").put("bestOfLegs", "4")
        assertEquals(setOf("date", "capacity", "boards", "poolCount", "bestOfLegs"), PlayerOrganizerDraft.errors(input).keys)
        assertThrows(IllegalArgumentException::class.java) { PlayerOrganizerDraft.command(input) }
    }
    @Test fun clubOnlyEntryRequiresClubOwnershipAndAnExplicitClub() {
        assertTrue(PlayerOrganizerDraft.errors(draft().put("eligibility", "club")).containsKey("eligibility"))
        assertTrue(PlayerOrganizerDraft.errors(draft().put("ownership", "club")).containsKey("clubId"))
        val input = draft().put("ownership", "club").put("clubId", "club-1").put("eligibility", "club")
        assertTrue(PlayerOrganizerDraft.errors(input).isEmpty())
        assertEquals("club-1", PlayerOrganizerDraft.command(input).getString("clubId"))
    }
    @Test fun organizerClubPickerUsesExactServerPermission() {
        val clubs = JSONArray(listOf(
            json("id" to "captain", "canManage" to true, "clubAccess" to json("permissions" to JSONArray(listOf("competitions.manage")))),
            json("id" to "tournament-official", "canManage" to false, "clubAccess" to json("permissions" to JSONArray(listOf("tournaments.manage")))),
            json("id" to "revoked", "canManage" to false, "clubAccess" to json("permissions" to JSONArray()))
        ))
        assertEquals(listOf("tournament-official"), PlayerOrganizerDraft.clubs(json("clubs" to clubs)).map { it.getString("id") })
    }
    @Test fun faqSearchFindsPublishedSynonymsAndAppliesCategory() {
        val page = json("version" to "2026.11.19", "items" to JSONArray(listOf(
            json("id" to "rating", "category" to "Rankings", "question" to "Hoe werkt plaatsing?", "answer" to "Je begint op 1500.", "keywords" to JSONArray(listOf("voorlopig"))),
            json("id" to "toernooi", "category" to "Toernooien", "question" to "Hoe loot ik?", "answer" to "Open wedstrijdleiding.")
        )))
        assertEquals(listOf("rating"), playerHelpItems(page, " VOORLOPIG ", "").map { it.text("id") })
        assertEquals(1, playerHelpItems(page, "1500", "Rankings").size)
        assertTrue(playerHelpItems(page, "1500", "Toernooien").isEmpty())
    }
    @Test fun helpQueriesAndArticleLinksAreEnvironmentBound() {
        assertEquals("rating", playerHelpQuery("id=rating&token=secret")["id"])
        assertFalse(playerHelpQuery("id=rating&token=secret").containsKey("token"))
        assertTrue(playerHelpQuery("id=rating&id=other").isEmpty())
        assertEquals(PlayerScreen.HELP, PlayerLinks.destination("/faq/rating", "https://dartflow.nl")?.screen)
        assertEquals("id=rating", PlayerLinks.destination("/faq/rating", "https://dartflow.nl")?.id)
        assertNull(PlayerLinks.destination("https://staging.dartflow.nl/faq/rating", "https://dartflow.nl"))
    }
    @Test fun releasedDestinationsStayNativeAcrossExistingAndCanonicalLinks() {
        for (path in listOf("/toernooien/event-1", "/app/tournaments/event-1", "/app#tournaments/event-1")) {
            assertEquals(path, PlayerDestination(PlayerScreen.EVENT, "event-1"), PlayerLinks.destination(path, "https://dartflow.nl"))
        }
        assertEquals(PlayerScreen.RANKINGS, PlayerLinks.destination("/rankings", "https://dartflow.nl")?.screen)
        assertEquals(PlayerScreen.CLUB, PlayerLinks.destination("/verenigingen/club-1", "https://dartflow.nl")?.screen)
        assertEquals(PlayerNavIcon.COMPETITIONS, playerNavigationSection(PlayerScreen.SEASON, "season-1"))
        assertEquals(PlayerNavIcon.EVENTS, playerNavigationSection(PlayerScreen.DIRECTOR, "event-1"))
    }
    @Test fun lineupUsesOnlyEligibleDistinctPlayersAndAllowsOneAdministrativeGap() {
        val roster = setOf("a", "b", "c", "d", "reserve")
        assertTrue(playerLineupValid(listOf("a", "b", "c", "d"), roster))
        assertTrue(playerLineupValid(listOf("a", "", "c", "d"), roster))
        assertFalse(playerLineupValid(listOf("a", "b", "c", "a"), roster))
        assertFalse(playerLineupValid(listOf("a", "b", "", ""), roster))
        assertFalse(playerLineupValid(listOf("a", "b", "c", "outsider"), roster))
    }
    @Test fun teamSummaryKeepsSinglesAndRealLegsSeparate() {
        val fixture = json("slots" to JSONArray(listOf(listOf(3, 1), listOf(2, 3), listOf(3, 1), listOf(1, 3)).map { score -> json("status" to "confirmed", "score" to JSONArray(score)) }))
        assertEquals(listOf(2, 2) to listOf(9, 8), playerSeasonTotals(fixture))
        val administrative = json("slots" to JSONArray(listOf(json("status" to "administrative", "administrative" to json("winner" to 0)), json("status" to "scheduled", "score" to JSONArray(listOf(3, 0))))))
        assertEquals(listOf(1, 0) to listOf(0, 0), playerSeasonTotals(administrative))
    }
    @Test fun faqMatchesAllWordsAcrossFieldsAndIgnoresAccentsLikeServer() {
        val page = json("items" to JSONArray(listOf(json("id" to "one", "category" to "Hulp", "question" to "Caféavond", "answer" to "Plaatsing op 1500"))))
        assertEquals(1, playerHelpItems(page, "1500 cafe", "").size)
        assertTrue(playerHelpItems(page, "1500 ontbreekt", "").isEmpty())
        assertEquals("q=1500+cafe", PlayerLinks.destination("/help?q=1500%20cafe", "https://dartflow.nl")?.id)
    }
    @Test fun rankingServerFiltersAreAllowlistedBeforeChoosingTheWindow() {
        assertEquals("?status=provisional&view=around", playerRankingsQuery("status=provisional&view=around"))
        assertEquals("", playerRankingsQuery("status=secret&view=arbitrary&token=hidden&limit=1000"))
        assertEquals("?limit=100", playerRankingsQuery("limit=100"))
    }
    @Test fun visibilityAndExtendedSupportedLegsRemainExplicit() {
        assertTrue(PlayerOrganizerDraft.errors(draft().put("bestOfLegs", "19")).isEmpty())
        assertTrue(PlayerOrganizerDraft.errors(draft().put("bestOfLegs", "21")).containsKey("bestOfLegs"))
        assertTrue(PlayerOrganizerDraft.errors(draft().put("visibility", "club")).containsKey("visibility"))
        assertEquals("private", PlayerOrganizerDraft.command(draft()).getString("visibility"))
    }

    @Test fun detailedDartEntryRecordsObservedHitsWithoutCalculatingAnOutcome() {
        val command = playerDartCommand(listOf("S20", "D20", "T19"))
        assertEquals(117, command.getInt("score"))
        assertEquals(3, command.getInt("darts"))
        assertEquals(listOf("S20", "D20", "T19"), command.getJSONArray("dartHits").strings())
        assertFalse(command.has("remaining"))
        assertFalse(command.has("winnerId"))
        assertEquals(75, playerDartCommand(listOf("SB", "DB", "MISS")).getInt("score"))
        assertThrows(IllegalArgumentException::class.java) { playerDartCommand(listOf("T25")) }
        assertThrows(IllegalArgumentException::class.java) { playerDartCommand(emptyList()) }
        assertTrue(playerNeedsDartDetail(json("inRule" to "double")))
        assertTrue(playerNeedsDartDetail(json("outRule" to "master")))
        assertFalse(playerNeedsDartDetail(json("sideStartScores" to JSONArray(listOf(301, 501)))))
    }
    @Test fun extendedRulesAndTournamentVariantsAreExplicitAndValidated() {
        val input = draft().put("inRule", "double").put("outRule", "master").put("handicap", true).put("leftStart", "301").put("rightStart", "501").put("format", "swiss").put("swissRounds", "4")
        val command = PlayerOrganizerDraft.command(input)
        assertEquals("master", command.getString("outRule"))
        assertEquals(listOf(301, 501), command.getJSONArray("sideStartScores").ints())
        assertEquals(4, command.getInt("swissRounds"))
        assertTrue(PlayerOrganizerDraft.errors(input.put("leftStart", "1002")).containsKey("leftStart"))
        for (format in listOf("double-elimination-reset", "double-elimination-single")) assertTrue(PlayerOrganizerDraft.errors(draft().put("format", format)).isEmpty())
        assertTrue(PlayerOrganizerDraft.errors(draft().put("format", "double-elimination")).containsKey("format"))
        assertEquals("?outRule=master-out&inRule=double&handicap=true", PlayerViewModel.statisticsQuery("outRule=master-out&inRule=double&handicap=true"))
    }

    @Test fun rankingListSelectionAndAdministrativeRetryRemainBoundToServerIdentities() {
        val listId = "10000000-0000-4000-8000-000000000002"
        assertEquals("?listId=$listId&view=around", playerRankingsQuery("listId=$listId&view=around"))
        assertEquals("", playerRankingsQuery("listId=arbitrary"))
        var path = ""
        var body = JSONObject()
        playerRankingAction(PlayerActions(command = { destination, input -> path = destination; body = input }), "source.decide", json("sourceId" to "source-1", "expectedRevision" to 7, "decision" to "void", "reason" to "Gecontroleerd bezwaar"))
        val command = NativePlayerCommand.create(path, body)
        val retry = NativePlayerCommand.restore(command.forStorage("p1", "https://dartflow.nl"), "p1", "https://dartflow.nl")!!
        assertEquals("/rankings/actions", retry.path)
        assertEquals(command.requestId, retry.requestId)
        assertEquals(7, retry.body.getJSONObject("action").getInt("expectedRevision"))
    }

    @Test fun eliminationPlacesNeverBecomeZeroCompetitionPoints() {
        val eliminated = json("position" to 3, "shared" to true, "points" to JSONObject.NULL)
        assertEquals("Eindplaats 3 · gedeeld", playerTournamentStandingSummary(eliminated))
        val swiss = json("position" to 2, "points" to 4, "played" to 3, "legsFor" to 7, "legsAgainst" to 5, "buchholz" to 8, "byes" to 1)
        assertTrue(playerTournamentStandingSummary(swiss).contains("4 punten"))
        assertTrue(playerTournamentStandingSummary(swiss).contains("Buchholz 8"))
    }

    @Test fun teamProjectionKeepsParticipantsAndCurrentThrowerSeparateFromSideAnchors() {
        val source = json("id" to "match-team", "players" to JSONArray(listOf(json("id" to "a", "name" to "Anna"), json("id" to "b", "name" to "Bas"))),
            "sideParticipants" to JSONArray(listOf(JSONArray(listOf(json("id" to "a", "name" to "Anna"), json("id" to "c", "name" to "Cleo"))), JSONArray(listOf(json("id" to "b", "name" to "Bas"), json("id" to "d", "name" to "Daan"))))),
            "sideNames" to JSONArray(listOf("Noord", "Zuid")), "currentThrower" to json("id" to "c", "name" to "Cleo"))
        val match = PlayerMatch.parse(source)
        assertEquals(listOf("a", "b"), match.players.map { it.id })
        assertEquals(listOf("a", "c", "b", "d"), match.participants.map { it.id })
        assertEquals("Noord", match.sideName(0))
        assertEquals("c", match.currentThrower?.id)
        source.remove("currentThrower"); source.remove("sideNames")
        val unknownThrower = PlayerMatch.parse(source)
        assertNull(unknownThrower.currentThrower)
        assertEquals("Anna & Cleo", unknownThrower.sideName(0))
        assertEquals(listOf("a", "b"), PlayerMatch.parse(json("players" to source.getJSONArray("players"))).participants.map { it.id })
    }

    @Test fun doublesAndSevenPartyLabelsRetainRealSideParticipants() {
        assertTrue(playerLineupValid(listOf("a", "b"), setOf("a", "b", "reserve"), 2))
        assertFalse(playerLineupValid(listOf("a", ""), setOf("a", "b"), 2))
        assertFalse(playerLineupValid(listOf("a", "a"), setOf("a", "b"), 2))
        val slot = json("index" to 4, "kind" to "double", "players" to JSONArray(listOf("a", "c")), "sidePlayerIds" to JSONArray(listOf(JSONArray(listOf("a", "b")), JSONArray(listOf("c", "d")))))
        assertEquals("Dubbel 1", playerSeasonSlotLabel(slot))
        assertEquals("Anna & Bas – Cleo & Daan", playerSeasonSlotNames(slot, listOf(json("id" to "a", "name" to "Anna"), json("id" to "b", "name" to "Bas"), json("id" to "c", "name" to "Cleo"), json("id" to "d", "name" to "Daan"))))
        assertEquals("Teamleg", playerSeasonSlotLabel(json("index" to 6, "kind" to "team")))
        assertEquals("Teamleg", playerSeasonSlotLabel(json("index" to 6), "teams", 7))
        assertEquals("Dubbel 2", playerSeasonSlotLabel(json("index" to 5), "teams", 7))
        assertEquals("Dubbel 1", playerSeasonSlotLabel(json("index" to 0), "doubles"))
        assertEquals(listOf("singles", "teams", "champions"), playerSeasonFormats("national").map { it.first })
        assertFalse(playerSeasonFormats("internal").any { it.first == "champions" })
    }
    @Test fun cricketMeasuresUseCreditedMarksAndCountedDartsWithoutMixingX01OrOtherSides() {
        val visits = listOf(json("playerIndex" to 0, "darts" to 3, "score" to 20, "cricket" to json("creditedMarks" to 5)), json("playerIndex" to 0, "darts" to 1, "score" to 0, "cricket" to json("creditedMarks" to 1)), json("playerIndex" to 1, "darts" to 3, "cricket" to json("creditedMarks" to 9)), json("playerIndex" to 0, "darts" to 3, "score" to 180))
        assertEquals(4.5, playerCricketMpr(visits, 0)!!, 0.0001)
        assertNull(playerCricketMpr(emptyList(), 0))
        assertEquals(listOf("–", "/", "X", "⊗", "⊗"), listOf(0, 1, 2, 3, 9).map(::playerCricketMark))
        assertTrue(playerNeedsDartDetail(json("discipline" to "cricket")))
        val command = PlayerOrganizerDraft.command(draft().put("discipline", "cricket").put("cricketMode", "no-score"))
        assertEquals("cricket", command.getString("discipline"))
        assertEquals("no-score", command.getString("cricketMode"))
        assertTrue(PlayerOrganizerDraft.errors(draft().put("discipline", "cricket").put("handicap", true)).containsKey("discipline"))
    }
    @Test fun accountDraftScopeIsDistinctForKindOwnerAndClub() {
        assertNotEquals(playerCloudDraftContext("tournament", "club", "a"), playerCloudDraftContext("tournament", "club", "b"))
        assertNotEquals(playerCloudDraftContext("tournament", "personal", ""), playerCloudDraftContext("season", "platform", ""))
        assertEquals(playerCloudDraftContext("tournament", "personal", ""), playerCloudDraftContext("tournament", "personal", "forged-club"))
        val training = playerTrainingMatch(json("id" to "training-1", "revision" to 5, "canManage" to true, "state" to json("game" to json("discipline" to "cricket", "cricketMode" to "no-score", "cricket" to json("points" to JSONArray(listOf(20, 0)))))), PlayerProfile("a", "Anna"))
        assertTrue(playerIsCricket(training))
        assertEquals("a", training.participants.single().id)
        assertTrue(training.permissions.getBoolean("canScore"))
        assertEquals(20, training.raw.getJSONObject("cricket").getJSONArray("points").getInt(0))
    }

    @Test fun divisionMetadataRetainsParallelGroupsAndPublishedTransitionPlaces() {
        val divisions = playerSeasonDivisions("Hoofdklasse A\nHoofdklasse B\nInstroom", json("0" to json("level" to 1, "targetSize" to 8, "promotionPlaces" to 0, "relegationPlaces" to 2), "1" to json("level" to 1, "targetSize" to 10), "2" to json("level" to 2, "targetSize" to 12)))
        assertEquals(listOf(1, 1, 2), divisions.objects().map { it.getInt("level") })
        assertEquals(listOf(8, 10, 12), divisions.objects().map { it.getInt("targetSize") })
        assertEquals(2, divisions.getJSONObject(0).getInt("relegationPlaces"))
        assertEquals(0, divisions.getJSONObject(0).getInt("promotionPlaces"))
        assertEquals("Cricket · zonder punten", playerRuleLabel(json("discipline" to "cricket", "cricketMode" to "no-score")))
        assertEquals("501 · master uit", playerRuleLabel(json("startScore" to 501, "outRule" to "master-out")))
    }

    @Test fun primaryCorrectionRetryKeepsTheReviewedMatchRevisionAndRequestIdentity() {
        var path = ""
        var body = JSONObject()
        playerPrimaryCorrectionCommand(PlayerActions(command = { target, input -> path = target; body = input }), "match-1", json("type" to "correction.request", "matchId" to "match-1", "expectedRevision" to 42, "undoCount" to 2, "reason" to "De laatste beurt is verkeerd ingevoerd"))
        val command = NativePlayerCommand.create(path, body)
        val retry = NativePlayerCommand.restore(command.forStorage("p1", "https://dartflow.nl"), "p1", "https://dartflow.nl")!!
        assertEquals("/matches/match-1/corrections/actions", retry.path)
        assertEquals(command.requestId, retry.requestId)
        assertEquals(42, retry.body.getJSONObject("action").getInt("expectedRevision"))
        assertEquals(2, retry.body.getJSONObject("action").getInt("undoCount"))
    }

    @Test fun copiedDefinitionCannotCarrySportResultsOrOldOfficialRightsAndRemoteRequiresDistinctBoards() {
        val copied = playerCompetitionCopyCommand("source-1", json("name" to "Nieuwe clubavond", "ownership" to "personal", "visibility" to "private", "clubId" to "forged-club", "members" to JSONArray(listOf("p1")), "fixtures" to JSONArray(listOf("old-result")), "rankingDestinations" to JSONArray(listOf("official-list"))))
        assertFalse(copied.has("clubId"))
        assertFalse(copied.has("members"))
        assertFalse(copied.has("fixtures"))
        assertFalse(copied.has("rankingDestinations"))
        assertEquals("source-1", copied.getString("id"))
        assertEquals("competition.copy", copied.getString("type"))
        val fixture = json("remoteAssignments" to json("home" to json("boardId" to "a", "writerId" to "p1"), "away" to json("boardId" to "b", "writerId" to "p2")))
        assertTrue(playerSeasonRemoteReady(fixture))
        fixture.getJSONObject("remoteAssignments").getJSONObject("away").put("writerId", "p1")
        assertFalse(playerSeasonRemoteReady(fixture))
        fixture.getJSONObject("remoteAssignments").getJSONObject("away").put("writerId", "p2").put("boardId", "a")
        assertFalse(playerSeasonRemoteReady(fixture))
        fixture.getJSONObject("remoteAssignments").getJSONObject("away").put("boardId", "b").remove("writerId")
        assertFalse(playerSeasonRemoteReady(fixture))
    }

    @Test fun locationTimesRespectTheChosenVenueZoneAndRejectAmbiguousClockChanges() {
        assertEquals("2026-11-20T18:30:00Z", playerLocationInstant("2026-11-20 19:30", "Europe/Amsterdam"))
        assertEquals("2026-07-20T17:30:00Z", playerLocationInstant("2026-07-20 19:30", "Europe/Amsterdam"))
        assertNull(playerLocationInstant("2026-03-29 02:30", "Europe/Amsterdam"))
        assertNull(playerLocationInstant("2026-10-25 02:30", "Europe/Amsterdam"))
        assertNull(playerLocationInstant("2026-02-30 19:30", "Europe/Amsterdam"))
        assertEquals(PlayerDestination(PlayerScreen.LOCATIONS), PlayerLinks.destination("/app/locations", "https://dartflow.nl"))
    }
    @Test fun forceReleaseRequiresExplicitCurrentGameBoardAndRemoteEffectConfirmation() {
        val board = json("id" to "board-1", "name" to "Cafébaan", "activity" to json("sessionId" to "session-1"), "activeGame" to json("id" to "match-1", "remote" to true))
        assertThrows(IllegalArgumentException::class.java) { playerForceReleaseCommand("loc-1", board, "Cafébaan", false, true, "Baan sluiten") }
        assertThrows(IllegalArgumentException::class.java) { playerForceReleaseCommand("loc-1", board, "Cafébaan", true, false, "Baan sluiten") }
        assertThrows(IllegalArgumentException::class.java) { playerForceReleaseCommand("loc-1", board, "Andere baan", true, true, "Baan sluiten") }
        val action = playerForceReleaseCommand("loc-1", board, " Cafe\u0301baan ", true, true, " Baan sluiten ")
        assertEquals("session-1", action.getString("expectedSessionId"))
        assertEquals("match-1", action.getString("confirmedSourceId"))
        assertTrue(action.getBoolean("confirmedRemoteEffect"))
        assertEquals("Baan sluiten", action.getString("reason"))
        var body = JSONObject()
        playerLocationAction(PlayerActions(command = { _, input -> body = input }), json("type" to "reservation.accept", "reservationId" to "r1", "boardIds" to JSONArray(listOf("board-1"))), 8)
        assertEquals(8, body.getInt("expectedRevision"))
        assertFalse(body.getJSONObject("action").has("expectedRevision"))
    }

    @Test fun rankingReconsentCarriesOnlyTheOwnPendingRosterVersionsThatWereDisplayed() {
        val changed = json("matchId" to "changed", "version" to 3, "accepted" to false, "players" to JSONArray(listOf(json("id" to "me"), json("id" to "new-opponent"))))
        val others = json("matchId" to "other", "version" to 7, "accepted" to false, "players" to JSONArray(listOf(json("id" to "other-a"), json("id" to "other-b"))))
        val already = json("matchId" to "accepted", "version" to 2, "accepted" to true, "players" to JSONArray(listOf(json("id" to "me"))))
        val event = json("entityId" to "season", "rosterReconfirmations" to JSONArray(listOf(changed, others, already)))
        val consent = playerRankingConsent(event, "me")
        val versions = consent.getJSONArray("rosterVersions")
        assertEquals(1, versions.length()); assertEquals("changed", versions.getJSONObject(0).getString("matchId")); assertEquals(3, versions.getJSONObject(0).getInt("version"))
        assertFalse(versions.getJSONObject(0).has("players"))
        assertFalse(playerRankingConsent(event, "manager").has("rosterVersions"))
        assertFalse(playerRankingConsent(json("entityId" to "season"), "me").has("rosterVersions"))
    }

    @Test fun ownPrecallIsOnlyAnExpectationAndDisappearsWhenTheFixtureReceivesAMatch() {
        val fixture = json("id" to "next", "status" to "scheduled", "players" to JSONArray(listOf("me", "opponent")))
        val body = json("fixtures" to JSONArray(listOf(fixture)), "preCalls" to json("board" to json("fixtureId" to "next", "writerId" to "writer")))
        val state = PlayerUiState(profile = PlayerProfile("me", "Speler"), platform = json("tournaments" to JSONArray(listOf(json("id" to "event", "name" to "Clubcup", "state" to body)))), overview = json("boards" to JSONArray(listOf(json("id" to "board", "name" to "Baan 3")))))
        state.platform.getJSONArray("tournaments").getJSONObject(0).put("members", JSONArray(listOf("me", "opponent", "writer").map { json("id" to it, "status" to "active", "attributes" to json("registered" to true, "available" to true)) }))
        assertEquals("Baan 3", playerOwnPreCalls(state).single().getString("boardName"))
        assertFalse(playerOwnPreCalls(state).single().has("matchId"))
        fixture.put("matchId", "actual-match"); assertTrue(playerOwnPreCalls(state).isEmpty())
        fixture.remove("matchId"); fixture.put("status", "bye"); assertTrue(playerOwnPreCalls(state).isEmpty())
        fixture.put("status", "scheduled"); body.put("paused", true); assertTrue(playerOwnPreCalls(state).isEmpty())
        body.put("paused", false)
        val event = state.platform.getJSONArray("tournaments").getJSONObject(0)
        event.getJSONArray("members").getJSONObject(1).getJSONObject("attributes").put("available", false)
        assertTrue(playerOwnPreCalls(state).isEmpty())
        event.getJSONArray("members").getJSONObject(1).getJSONObject("attributes").put("available", true)
        assertTrue(playerOwnPreCalls(state.copy(profile = PlayerProfile("unrelated", "Andere"))).isEmpty())
        assertTrue(playerOwnPreCalls(state.copy(profile = PlayerProfile("writer", "Schrijver"))).single().getBoolean("writer"))
    }

}
