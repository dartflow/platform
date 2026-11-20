package nl.dartflow.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class PlayerIdentityLobbyUiTest {
    @get:Rule val compose = createComposeRule()
    private val profile = PlayerProfile("one", "Triple Danny", "danny", "Triple Danny", true, true, true, "Privé Volledige Naam", true)
    private fun state(screen: PlayerScreen) = PlayerUiState(profile = profile, session = PlayerSession("one", "private@example.test", Long.MAX_VALUE), screen = screen, loading = false)

    @Test fun privateAndPublicNamesRemainEditableWhileCommittedHandleHasNoEditAction() {
        var command = JSONObject()
        compose.setContent { DartFlowPlayerTheme { PlayerApp(state(PlayerScreen.PROFILE), PlayerActions(platformAction = { command = it })) } }
        compose.onNodeWithText("@danny").performScrollTo().assert(SemanticsMatcher.keyNotDefined(SemanticsActions.SetText))
        compose.onNodeWithText("Volledige naam").performScrollTo().performTextReplacement("Nieuwe Privénaam")
        compose.onNodeWithText("Displaynaam").performScrollTo().performTextReplacement("De Pijl")
        compose.onNodeWithText("Anderen zien: De Pijl · @danny").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Profiel opslaan").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("Nieuwe Privénaam", command.text("fullName")); assertEquals("De Pijl", command.text("displayName")); assertFalse(command.has("username")); assertFalse(command.has("name")); assertFalse(command.has("id")) }
    }

    @Test fun friendsSearchShowsDuplicateDisplayNamesWithDistinctHandlesAndNoPrivateSearchFallback() {
        val people = JSONArray(listOf(json("id" to "two", "displayName" to "Triple Danny", "username" to "danny2", "fullName" to "Verborgen Privénaam"), json("id" to "three", "displayName" to "Triple Danny", "username" to "danny3", "fullName" to "Andere Privénaam")))
        compose.setContent { DartFlowPlayerTheme { PlayerApp(state(PlayerScreen.FRIENDS), PlayerActions(read = { path -> val query = PlayerLinks.query(java.net.URI("https://native.invalid$path"))["search"].orEmpty(); json("players" to JSONArray(people.objects().filter { playerSearchMatches(it, query) }), "nextOffset" to JSONObject.NULL) })) } }
        compose.onNodeWithText("Displaynaam of gebruikersnaam").performScrollTo().performTextInput("Triple")
        compose.waitUntil(5000) { compose.onAllNodesWithText("@danny2").fetchSemanticsNodes().size == 1 }
        compose.onAllNodesWithText("Triple Danny").assertCountEquals(2)
        compose.onNodeWithText("@danny2").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("@danny3").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Verborgen Privénaam").assertDoesNotExist()
        compose.onNodeWithText("Displaynaam of gebruikersnaam").performScrollTo().performTextReplacement("Verborgen")
        compose.waitUntil(5000) { compose.onAllNodesWithText("Geen spelers gevonden.").fetchSemanticsNodes().size == 1 }
        compose.onNodeWithText("Geen spelers gevonden.").performScrollTo().assertIsDisplayed()
    }

    @Test fun boardSelectionPreservesBlockedPlanningAndOpensOnlySelectedCanonicalSource() {
        var command = JSONObject()
        val candidates = JSONArray(listOf(json("seasonId" to "season", "seasonName" to "Clubleague", "fixtureId" to "early", "slotId" to "slot-early", "round" to 1, "opponent" to json("displayName" to "Rick", "username" to "rick"), "canOpen" to false, "blockedReason" to "Deze speelronde is nog niet vrijgegeven.", "settings" to json("startScore" to 501)), json("seasonId" to "season", "seasonName" to "Clubleague", "fixtureId" to "ready", "slotId" to "slot-ready", "round" to 2, "opponent" to json("displayName" to "Noor", "username" to "noor"), "canOpen" to true, "settings" to json("startScore" to 501))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerCompetitionBoard(json("competition" to json("candidates" to candidates)), "board", state(PlayerScreen.BOARD), PlayerActions(command = { _, body -> command = body })) } } }
        compose.onNodeWithText("Deze speelronde is nog niet vrijgegeven.").performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("Ja, competitiewedstrijd starten")[0].performScrollTo().assertIsNotEnabled()
        compose.onAllNodesWithText("Ja, competitiewedstrijd starten")[1].performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { val action = command.obj("action"); assertEquals("open", action.text("type")); assertEquals("ready", action.text("fixtureId")); assertEquals("slot-ready", action.text("slotId")); assertFalse(action.has("players")); assertFalse(action.has("settings")) }
    }

    @Test fun plannedOpponentPinIsExplicitAndCannotChangeThePrimarySession() {
        var path = ""; var command = JSONObject()
        val lobby = json("id" to "lobby", "status" to "waiting", "expiresAt" to "2099-01-01T12:00:00Z", "seasonName" to "Clubleague", "round" to 1, "boardName" to "Baan 1", "canStart" to true, "writerName" to "Triple Danny", "writerDeviceLabel" to "Bediening met het account van de eerste speler", "players" to JSONArray(listOf(json("id" to "one", "displayName" to "Triple Danny", "username" to "danny", "confirmed" to true), json("id" to "two", "displayName" to "Noor", "username" to "noor", "confirmed" to false))))
        val current = state(PlayerScreen.BOARD)
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerCompetitionLobby(lobby, current, PlayerActions(command = { p, body -> path = p; command = body })) } } }
        compose.onNodeWithText("Ga met beide spelers naar de officiële partij").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("Tegenstander bevestigt op dit toestel met pincode").performScrollTo().performClick()
        compose.onNodeWithText("Bevestig geplande tegenstander").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("Eigen zescijferige spelerspincode").performScrollTo().performTextInput("012345")
        compose.onNodeWithText("Bevestig geplande tegenstander").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("/competition-lobbies/player-pin", path); assertEquals("noor", command.text("username")); assertEquals("012345", command.text("pin")); assertEquals("one", current.session?.userId); assertFalse(command.has("accessToken")); assertFalse(command.has("players")) }
    }
}
