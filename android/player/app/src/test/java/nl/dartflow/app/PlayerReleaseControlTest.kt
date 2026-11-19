package nl.dartflow.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlayerReleaseControlTest {
    private val id = "00000000-0000-4000-8000-000000000301"
    @Test fun seasonDelegationRequiresItsExactCapabilityAndInactiveManagersAreOnlyRemovable() {
        val season = json("capabilities" to json("canDelegate" to false), "managerIds" to JSONArray(listOf("inactive")), "delegationCandidates" to JSONArray(listOf(json("id" to "active", "active" to true), json("id" to "inactive", "active" to false))))
        assertTrue(playerSeasonDelegationCandidates(season, false).isEmpty()); season.obj("capabilities").put("canDelegate", true)
        assertEquals(listOf("active"), playerSeasonDelegationCandidates(season, false).map { it.text("id") }); assertEquals(listOf("inactive"), playerSeasonDelegationCandidates(season, true).map { it.text("id") })
    }
    @Test fun consolationHasItsOwnExplicitTitleAndOnlySingleEliminationCanEnableIt() {
        val draft = PlayerOrganizerDraft.sanitize(json("name" to "Cup", "date" to "2026-11-20", "format" to "knockout", "consolation" to true, "consolationTitle" to "Tweede Kans"))
        val action = PlayerOrganizerDraft.command(draft)
        assertTrue(action.getBoolean("consolation")); assertEquals("Tweede Kans", action.getString("consolationTitle"))
        assertTrue(playerPlanningQuery(draft).contains("consolation=true")); assertTrue(playerPlanningSettings(draft).getBoolean("consolation"))
        assertFalse(PlayerOrganizerDraft.command(JSONObject(draft.toString()).put("format", "swiss")).getBoolean("consolation"))
        assertTrue(PlayerOrganizerDraft.errors(JSONObject(draft.toString()).put("consolationTitle", " ")).containsKey("consolationTitle"))
    }
    @Test fun phaseProfilesContainOnlyExplicitSettingsAndValidateTheirInheritedCap() {
        val values = json("phase" to "knockout", "round" to "2", "bestOfLegs" to "7", "startProcedure" to "server-lot", "legTwoDifference" to true, "legMaximum" to "9", "winnerId" to "forged")
        val rule = playerTournamentRuleOverride(values, json("startScore" to 501, "bestOfLegs" to 3, "bestOfSets" to 1))!!
        assertEquals("knockout", rule.getString("phase")); assertEquals(2, rule.getInt("round")); assertEquals(7, rule.getJSONObject("settings").getInt("bestOfLegs")); assertFalse(rule.getJSONObject("settings").has("startScore")); assertFalse(rule.toString().contains("forged"))
        assertNull(playerTournamentRuleOverride(JSONObject(values.toString()).put("legMaximum", "5"), JSONObject()))
        assertNull(playerTournamentRuleOverride(JSONObject(values.toString()).put("round", "257"), JSONObject()))
        assertNull(playerTournamentRuleOverride(json("phase" to "pool"), JSONObject()))
    }
    @Test fun expiredPushBindingNeverFollowsAnotherLoginOrEnvironment() {
        val binding = json("enabled" to true, "actorId" to "a", "origin" to "https://dartflow.nl")
        assertTrue(playerPushBindingAllowed(binding, json("userId" to "a", "accessToken" to "opaque"), "a", "https://dartflow.nl", true))
        assertFalse(playerPushBindingAllowed(binding, json("userId" to "b", "accessToken" to "opaque"), "a", "https://dartflow.nl", true))
        assertFalse(playerPushBindingAllowed(binding, JSONObject(), "a", "https://dartflow.nl", true))
        assertFalse(playerPushBindingAllowed(binding, json("userId" to "a", "accessToken" to "opaque"), "a", "https://staging.dartflow.nl", true))
        assertFalse(playerPushBindingAllowed(binding, json("userId" to "a", "accessToken" to "opaque"), "a", "https://dartflow.nl", false))
    }
    @Test fun selectedGuestUsesOnlyFreshServerCapabilitiesWithoutChangingActualAccount() {
        val raw = json("id" to id, "permissions" to json("canManage" to true, "canScore" to false), "guestOperators" to JSONArray(listOf(json("id" to "guest1", "name" to "Guest", "permissions" to json("canScore" to true, "canConfirm" to false)))))
        val state = PlayerUiState(profile = PlayerProfile("manager", "Manager"), match = PlayerMatch.parse(raw), guestOperatorId = "guest1")
        val rendering = playerGuestOperatorState(state)
        assertTrue(rendering.match!!.permissions.getBoolean("canScore")); assertFalse(rendering.match!!.permissions.getBoolean("canConfirm")); assertEquals("manager", rendering.profile!!.id); assertFalse(state.match!!.permissions.getBoolean("canScore"))
        assertFalse(playerGuestOperatorState(state.copy(guestOperatorId = "forged")).match!!.permissions.getBoolean("canScore"))
        assertEquals("Bediening voor gast Guest", playerGuestOperatorLabel(state)); assertNull(playerGuestOperatorLabel(state.copy(guestOperatorId = "forged")))
        assertFalse(playerGuestOperatorState(state.copy(match = PlayerMatch.parse(JSONObject(raw.toString()).put("guestOperators", JSONArray())))).match!!.permissions.getBoolean("canScore"))
        assertEquals("", applyPlayerMatchSnapshot(state, JSONObject(raw.toString()).put("id", "another-match")).guestOperatorId)
        assertEquals("", applyPlayerMatchSnapshot(state, JSONObject(raw.toString()).put("guestOperators", JSONArray())).guestOperatorId)
    }
    @Test fun hybridFixtureRequiresAnExplicitAcceptedModeBeforeBoardStart() {
        val hybrid = json("settings" to json("playMode" to "hybrid"))
        assertNull(playerSeasonFixtureMode(hybrid, JSONObject()))
        assertNull(playerSeasonFixtureMode(hybrid, json("playModeProposal" to json("mode" to "remote"))))
        assertEquals("remote", playerSeasonFixtureMode(hybrid, json("playMode" to "remote")))
        assertEquals("local", playerSeasonFixtureMode(hybrid, json("playMode" to "local")))
        assertEquals("remote", playerSeasonFixtureMode(json("settings" to json("playMode" to "remote")), JSONObject()))
    }
    @Test fun twoClearNeedsAnExplicitOddCapAndIsExcludedFromFixedOrNationalEditor() {
        val values = json("legTwoDifference" to true, "legMaximum" to "9", "setTwoDifference" to true, "setMaximum" to "5")
        assertEquals(9, playerStartSettings(values).getJSONObject("legWinByTwo").getInt("maximum")); assertEquals(5, playerStartSettings(values).getJSONObject("setWinByTwo").getInt("maximum"))
        assertFalse(playerStartSettings(values, fixedLegs = true).has("legWinByTwo")); assertFalse(playerStartSettings(values, allowDifference = false).has("setWinByTwo"))
        val draft = PlayerOrganizerDraft.sanitize(values.put("name", "Two Clear").put("date", "2026-11-20").put("bestOfLegs", "11"))
        assertTrue(PlayerOrganizerDraft.errors(draft).containsKey("legMaximum")); assertTrue(PlayerOrganizerDraft.errors(draft.put("legMaximum", "12")).containsKey("legMaximum")); assertFalse(PlayerOrganizerDraft.errors(draft.put("legMaximum", "15")).containsKey("legMaximum"))
        assertFalse(playerSeasonRulesValid(json("legTwoDifference" to true, "legMaximum" to "3"), baseLegs = 5))
        assertFalse(playerSeasonRuleSettings(values, fixedLegs = true).has("legWinByTwo"))
    }
    @Test fun offlineRetryPreservesLogicalIdentityAndAcceptedRevision() {
        val original = NativePlayerCommand.create("/matches/$id/actions", json("matchId" to id, "expectedRevision" to 42, "action" to json("type" to "score", "score" to 100, "darts" to 3)))
        val retry = original.forOfflineRetry()
        assertEquals(original.requestId, retry.requestId); assertEquals(42, retry.body.getInt("expectedRevision")); assertTrue(retry.body.getBoolean("offline")); assertEquals(original.body.getJSONObject("action").toString(), retry.body.getJSONObject("action").toString()); assertFalse(original.body.has("offline"))
        val nonScore = NativePlayerCommand.create("/matches/$id/actions", json("action" to json("type" to "confirm"))).forOfflineRetry(); assertFalse(nonScore.body.has("offline"))
    }
    @Test fun newFormsPublishExplicitBullAndFixedLegsCannotUseSetsOrRebull() {
        assertEquals("bull", playerStartSettings(JSONObject()).getString("startProcedure"))
        val fixed = playerStartSettings(json("bestOfSets" to "5", "decidingLeg" to "rebull", "startProcedure" to "server-lot"), fixedLegs = true)
        assertEquals(1, fixed.getInt("bestOfSets")); assertEquals("continue", fixed.getString("decidingLeg")); assertEquals("server-lot", fixed.getString("startProcedure"))
    }
    @Test fun scoreConsoleWaitsForBothBullSignaturesAndServerDraw() {
        fun match(procedure: String, bull: JSONObject = JSONObject(), decision: JSONObject = JSONObject()) = PlayerMatch.parse(json("id" to id, "status" to "live", "settings" to json("startProcedure" to procedure), "bull" to bull, "startDecision" to decision))
        assertFalse(playerStartResolved(match("bull", json("status" to "confirming", "confirmed" to JSONArray(listOf(true,false))))))
        assertFalse(playerStartResolved(match("bull", json("status" to "complete", "confirmed" to JSONArray(listOf(true,false))))))
        assertTrue(playerStartResolved(match("bull", json("status" to "complete", "confirmed" to JSONArray(listOf(true,true))))))
        assertFalse(playerStartResolved(match("server-lot"))); assertTrue(playerStartResolved(match("server-lot", decision = json("starter" to 1))))
        assertTrue(playerStartResolved(match("home-first")))
    }
    @Test fun planningUsesEnvironmentBoundReadQueryAndRetainsOnlyKnownInputs() {
        val draft = PlayerOrganizerDraft.sanitize(json("capacity" to "16", "poolCount" to "4", "boards" to "4", "format" to "pools-knockout", "planEnabled" to true, "planMatchMinutes" to "30", "planDeadline" to "2026-11-20T23:00:00+01:00", "apiKey" to "secret"))
        val query = playerPlanningQuery(draft); assertTrue(query.startsWith("/organizer-planning?")); assertTrue(query.contains("format=pools-ko")); assertTrue(query.contains("matchMinutes=30")); assertFalse(query.contains("secret"))
        assertEquals("2026-11-20T23:00:00+01:00", playerPlanningSettings(draft).getString("deadline"))
    }
    @Test fun tournamentCreationPersistsPlanningButNeverAcceptsDeadlineImplicitly() {
        val draft = PlayerOrganizerDraft.sanitize(json("name" to "Planned Cup", "date" to "2026-11-20", "planEnabled" to true, "bronze" to true))
        val action = PlayerOrganizerDraft.command(draft); assertTrue(action.has("planning")); assertFalse(action.getBoolean("acceptPlanningWarnings")); assertTrue(action.getBoolean("bronze")); assertEquals("bull", action.getString("startProcedure"))
        assertTrue(PlayerOrganizerDraft.command(draft.put("planAcknowledged", true)).getBoolean("acceptPlanningWarnings"))
    }
    @Test fun pushPayloadAcceptsOnlyOpaqueAllowlistedData() {
        val message = mapOf("id" to id, "deviceId" to "00000000-0000-4000-8000-000000000302", "category" to "Competitie")
        assertEquals(id, playerPushPayload(message)?.first); assertNull(playerPushPayload(message + ("playerName" to "Private Name"))); assertNull(playerPushPayload(message + ("id" to "https://bad.invalid"))); assertNull(playerPushPayload(message + ("category" to "Chat: private text")))
        assertTrue(playerPushBody("Competitie").contains("Open DartFlow")); assertFalse(playerPushBody("Competitie").contains(id))
    }
    @Test fun perSlotRulesPreserveActualHandicapAndValidateOddBestOfWithoutInventedScores() {
        val values = json("inRule" to "double", "outRule" to "master", "handicap" to true, "homeStart" to "301", "awayStart" to "701", "legs" to "5", "sets" to "3")
        assertTrue(playerSeasonRulesValid(values)); val settings = playerSeasonRuleSettings(values); assertEquals(listOf(301,701), settings.getJSONArray("sideStartScores").ints()); assertEquals(5, settings.getInt("bestOfLegs")); assertEquals(3, settings.getInt("bestOfSets"))
        assertFalse(playerSeasonRulesValid(JSONObject(values.toString()).put("legs", "6"))); assertFalse(playerSeasonRulesValid(JSONObject(values.toString()).put("homeStart", "1"))); assertFalse(settings.has("winnerId"))
    }
}
