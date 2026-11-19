package nl.dartflow.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class PlayerControlUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun seasonDelegationUsesOnlyServerCapabilityAndNeedsAReasonAndConfirmation() {
        val season = androidx.compose.runtime.mutableStateOf(json("id" to "season1", "name" to "Voorjaar", "revision" to 7, "canManage" to true, "capabilities" to json("canDelegate" to false), "delegationCandidates" to JSONArray(listOf(json("id" to "candidate", "name" to "Nieuwe leiding", "active" to true)))))
        var command = org.json.JSONObject()
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerSeasonDelegation(season.value, PlayerUiState(loading = false), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Leiding voor dit seizoen").assertDoesNotExist()
        compose.runOnIdle { season.value = org.json.JSONObject(season.value.toString()).put("capabilities", json("canDelegate" to true)) }
        compose.onNodeWithText("Kies bevoegd account").performClick(); compose.onNodeWithText("Nieuwe leiding").performClick()
        compose.onNodeWithText("Controleer seizoensdelegatie").assertIsNotEnabled()
        compose.onNodeWithText("Reden voor seizoensdelegatie").performTextInput("Beheer van dit ene seizoen overdragen.")
        compose.onNodeWithText("Controleer seizoensdelegatie").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(0, command.length()) }
        compose.onNodeWithText("Bevestigen").performClick()
        compose.runOnIdle { assertEquals(7, command.getInt("expectedRevision")); assertEquals("season.manager", command.getJSONObject("action").getString("type")); assertEquals("candidate", command.getJSONObject("action").getString("playerId")); assertFalse(command.getJSONObject("action").getBoolean("remove")); assertFalse(command.toString().contains("platform.role")) }
    }
    @Test fun consolationKeepsItsOwnTitleAndDoesNotReplaceTheMainPlacing() {
        val event = json("members" to JSONArray(listOf(json("id" to "main", "name" to "Hoofdwinnaar"), json("id" to "cup", "name" to "Troostwinnaar"))), "state" to json("completed" to true, "standings" to JSONArray(listOf(json("playerId" to "main", "position" to 1, "points" to org.json.JSONObject.NULL))), "consolation" to json("enabled" to true, "title" to "Tweede Kans", "completed" to true, "championId" to "cup", "placings" to JSONArray(listOf(json("playerId" to "cup", "position" to 1))))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerTournamentStandings(event) } } }
        compose.onNodeWithText("Tweede Kans").assertIsDisplayed()
        compose.onNodeWithText("Winnaar: Troostwinnaar").assertIsDisplayed()
        compose.onNodeWithText("Hoofdwinnaar").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Eindplaats 1").performScrollTo().assertIsDisplayed()
    }
    @Test fun drawnTournamentKeepsPublishedPhaseRulesVisibleWithoutAnEditAction() {
        val event = json("id" to "event1", "canManage" to true, "state" to json("fixtures" to JSONArray(listOf(json("id" to "fixture1"))), "tournamentRuleOverrides" to JSONArray(listOf(json("phase" to "knockout", "round" to 2, "settings" to json("bestOfLegs" to 7))))))
        compose.setContent { DartFlowPlayerTheme { Column { PlayerTournamentRules(event, PlayerUiState(loading = false), PlayerActions()) } } }
        compose.onNodeWithText("Best of 7").assertIsDisplayed()
        compose.onNodeWithText("Fase- en ronderegels worden vóór de loting vastgelegd.").assertIsDisplayed()
        compose.onNodeWithText("Faseprofiel toevoegen of vervangen").assertDoesNotExist()
        compose.onNodeWithText("Controleer vastleggen fase- en ronderegels").assertDoesNotExist()
    }
    @Test fun guestOperatorRequiresAnExplicitFreshSelection() {
        val match = PlayerMatch.parse(json("id" to "m1", "guestOperators" to JSONArray(listOf(json("id" to "guest1", "name" to "Bezoeker", "permissions" to json("canScore" to true))))))
        var selected = ""
        compose.setContent { DartFlowPlayerTheme { Column { PlayerGuestOperatorPicker(match, PlayerUiState(loading = false), PlayerActions(selectGuestOperator = { selected = it })) } } }
        compose.runOnIdle { assertEquals("", selected) }
        compose.onNodeWithText("Mijn eigen rol").performClick()
        compose.onNodeWithText("Bediening voor gast Bezoeker").performClick()
        compose.runOnIdle { assertEquals("guest1", selected) }
    }
    @Test fun hybridAcceptanceRequiresTheOtherSideAndASeparateConfirmation() {
        val fixture = json("id" to "fixture1", "capabilities" to json("canAcceptMode" to true), "playModeProposal" to json("mode" to "remote", "side" to "home"))
        val season = json("id" to "season1", "revision" to 7, "settings" to json("playMode" to "hybrid"))
        var command = org.json.JSONObject()
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerSeasonPlayMode(season, fixture, PlayerUiState(loading = false), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Hybride ontmoeting · speelwijze nog niet afgesproken").assertIsDisplayed()
        compose.onNodeWithText("Accepteer voorgestelde speelwijze").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(0, command.length()) }
        compose.onNodeWithText("Bevestigen").performClick()
        compose.runOnIdle { assertEquals("season.accept-play-mode", command.getJSONObject("action").getString("type")); assertEquals(7, command.getInt("expectedRevision")) }
    }
    @Test fun bullConfirmationIsExplicitForEachPlayerAndPinCompanion() {
        val match = PlayerMatch.parse(json("id" to "m1", "status" to "ready", "players" to JSONArray(listOf(json("id" to "p1", "name" to "Danny"), json("id" to "p2", "name" to "Noor"))), "settings" to json("startProcedure" to "bull"), "permissions" to json("canBullConfirm" to true, "canBullConfirmCompanion" to true), "bull" to json("status" to "confirming", "winner" to 0, "round" to 1, "confirmed" to JSONArray(listOf(false,false)))))
        val commands = mutableListOf<String>()
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerStartProcedure(match, PlayerUiState(loading = false), PlayerActions(matchAction = { type, _ -> commands.add(type) })) } } }
        compose.runOnIdle { assertTrue(commands.isEmpty()) }
        compose.onNodeWithText("Ik bevestig dit bullresultaat").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(listOf("bull-confirm"), commands) }
        compose.onNodeWithText("PINgekoppelde speler bevestigt bulluitslag").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(listOf("bull-confirm", "bull-confirm-companion"), commands) }
    }
    @Test fun offlineConflictNeedsManagerReasonAndFinalConfirmation() {
        val match = PlayerMatch.parse(json("id" to "m1", "revision" to 8, "permissions" to json("canManage" to true), "offlineConflict" to json("id" to "conflict1", "status" to "open", "expectedRevision" to 4, "canonicalRevision" to 7)))
        var type = ""
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerOfflineConflict(match, PlayerUiState(loading = false), PlayerActions(matchAction = { action, _ -> type = action })) } } }
        compose.onNodeWithText("Controleer verwerpen oude offline-actie").assertIsNotEnabled()
        compose.onNodeWithText("Reden voor behouden serverstand").performTextInput("De schriftelijke kaart bevestigt de actuele serverstand.")
        compose.onNodeWithText("Controleer verwerpen oude offline-actie").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("", type) }
        compose.onNodeWithText("Bevestigen").performClick()
        compose.runOnIdle { assertEquals("resolve-offline-conflict", type) }
    }
    @Test fun revisedPoolDecisionCannotAdvanceFromOldEvidence() {
        val event = json("id" to "e1", "canManage" to true, "state" to json("tournamentControl" to json("decisions" to JSONArray(listOf(json("id" to "d1", "pool" to "A", "phase" to "pool", "stale" to true, "playerIds" to JSONArray()))))))
        compose.setContent { DartFlowPlayerTheme { Column { PlayerTournamentPoolControl(event, PlayerUiState(loading = false), PlayerActions()) } } }
        compose.onNodeWithText("Bron herzien · oude beslissing vervallen").assertIsDisplayed()
        compose.onNodeWithText("Verwerk bevestigde beslisser · poule A").assertDoesNotExist()
    }
    @Test fun missingExternalPushConfigurationKeepsInboxReadableWithoutPermissionPrompt() {
        var prompted = false
        val state = PlayerUiState(loading = false, resource = json("push" to json("transportConfigured" to false, "items" to JSONArray(listOf(json("id" to "n1", "category" to "Wedstrijden", "body" to "Er is een wedstrijdmelding.", "available" to false))))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerPushControls(state, PlayerActions(pushConsent = { prompted = true })) } } }
        compose.onNodeWithText("Systeemmeldingen toestaan op dit toestel").assertIsDisplayed()
        compose.onNodeWithText("Er is een wedstrijdmelding.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Controleer en open actuele melding").assertIsNotEnabled()
        compose.runOnIdle { assertFalse(prompted) }
    }
}
