package nl.dartflow.app

import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/** Real Compose fixtures exercise navigation/commands; no hosted account or prototype mock is used. */
class PlayerRedesignUiTest {
    @get:Rule val compose = createComposeRule()
    private fun state(screen: PlayerScreen = PlayerScreen.HOME) = PlayerUiState(screen = screen, loading = false,
        session = PlayerSession("p1", "fixture@example.test", Long.MAX_VALUE, true),
        profile = PlayerProfile("p1", "Noor", "noor", "Noor", true, true, true))
    private fun capture(name: String, tag: String = "redesign-fixture") {
        require(name.matches(Regex("redesign-[a-z0-9-]+\\.png")))
        val fixture = compose.onNodeWithTag(tag)
        if (tag == "redesign-fixture") {
            val bounds = fixture.getUnclippedBoundsInRoot(); val root = compose.onRoot().getUnclippedBoundsInRoot()
            assertTrue(bounds.left >= root.left && bounds.right <= root.right && bounds.top >= root.top && bounds.bottom <= root.bottom)
        }
        val bitmap = fixture.captureToImage().asAndroidBitmap()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p /data/local/tmp/dartflow-ui-fixtures")).use { it.readBytes() }
        val descriptors = automation.executeShellCommandRw("dd of=/data/local/tmp/dartflow-ui-fixtures/$name")
        ParcelFileDescriptor.AutoCloseInputStream(descriptors[0]).use { output ->
            ParcelFileDescriptor.AutoCloseOutputStream(descriptors[1]).use { input -> assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, input)) }
            assertTrue(output.readBytes().isEmpty())
        }
    }
    @Test fun quickPresetsAreImmediateAndConfigurationPreservesSelectedRulesWhenReopened() {
        val commands = mutableListOf<JSONObject>()
        val current = mutableStateOf(state(PlayerScreen.PLAY))
        compose.setContent { Box(Modifier.requiredSize(360.dp, 760.dp).testTag("redesign-fixture")) { DartFlowPlayerTheme {
            PlayerApp(current.value, PlayerActions(playAction = { commands += it }, platformAction = { commands += it }))
        } } }
        compose.onNodeWithText("Start training").assertDoesNotExist()
        capture("redesign-play-closed-360.png")
        (0..2).forEach { compose.onNodeWithTag("quick-play-$it").performScrollTo().assertIsEnabled().performClick() }
        compose.runOnIdle { assertEquals(listOf("session.create", "training.create", "lobby.create"), commands.map { it.text("type") }); assertEquals(45, commands[1].optInt("botAverage")) }
        compose.runOnIdle { current.value = current.value.copy(play = PlayerPlayUi(error = "De uitkomst van je aanvraag is onzeker.", pendingOperation = "session.create")) }
        compose.onNodeWithText("De uitkomst van je aanvraag is onzeker.").performScrollTo().assertIsDisplayed()
        (0..2).forEach { compose.onNodeWithTag("quick-play-$it").performScrollTo().assertIsNotEnabled() }
        compose.onNodeWithText("Controleer bewaarde partijwijziging").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("local.retry-operation", commands.last().text("type")); assertFalse("The UI must reuse the coordinator's original request identity", commands.last().has("requestId")); current.value = current.value.copy(play = PlayerPlayUi()) }
        compose.onNodeWithTag("configuration-toggle-Configuratie").performScrollTo().performClick()
        compose.onNodeWithText("501").performScrollTo().performClick(); compose.onNodeWithText("701").performClick()
        capture("redesign-play-open-360.png")
        compose.onNodeWithTag("configuration-toggle-Configuratie").performScrollTo().performClick()
        compose.onNodeWithText("701").assertDoesNotExist()
        compose.onNodeWithTag("configuration-toggle-Configuratie").performScrollTo().performClick()
        compose.onNodeWithText("701").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Start training").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(701, commands.last().optInt("startScore")); assertEquals("single", commands.last().text("inRule")) }
    }
    @Test fun homeUsesOneFeaturedMatchAndDoesNotRepeatItInTheNextFixture() {
        var opened = ""
        val live = json("id" to "live", "players" to JSONArray(listOf("Noor", "Raymond")), "remaining" to JSONArray(listOf(181, 242)), "actionLabel" to "Hervat je partij", "href" to "/wedstrijd/live")
        val experience = json("resume" to JSONArray(listOf(json("id" to "result", "actionLabel" to "Bevestig de uitslag"), live)), "fixtures" to JSONArray(listOf(json("matchId" to "live", "href" to "/wedstrijd/live", "opponent" to "duplicate"), json("matchId" to "next", "opponent" to "Rico", "seasonName" to "Clubcompetitie", "startsAt" to "2026-11-24T19:30:00Z"))))
        compose.setContent { Box(Modifier.requiredSize(360.dp, 760.dp).testTag("redesign-fixture")) { DartFlowPlayerTheme {
            PlayerApp(state().copy(resource = experience), PlayerActions(openLink = { opened = it }))
        } } }
        compose.onNodeWithTag("home-featured-match").assertIsDisplayed()
        compose.onNodeWithText("181 – 242").assertIsDisplayed()
        compose.onNodeWithText("Tegen duplicate").assertDoesNotExist()
        capture("redesign-home-active-360.png")
        compose.onNodeWithText("Hervat je partij").performClick()
        compose.runOnIdle { assertEquals("/wedstrijd/live", opened) }
        compose.onNodeWithText("Tegen Rico").performScrollTo().assertIsDisplayed()
    }
    @Test fun profileSeparatesAccountScoreAndPreferencesWithoutLosingUnsavedIdentity() {
        compose.setContent { Box(Modifier.requiredSize(360.dp, 760.dp).testTag("redesign-fixture")) { DartFlowPlayerTheme { PlayerApp(state(PlayerScreen.PROFILE), PlayerActions()) } } }
        compose.onNodeWithText("Displaynaam").performScrollTo().performTextClearance()
        compose.onNodeWithText("Displaynaam").performTextInput("Noor nieuw")
        compose.onNodeWithText("Account").performScrollTo()
        capture("redesign-settings-account-360.png")
        compose.onNodeWithText("Score-invoer").performClick()
        compose.onNodeWithTag("score-input-x01-total").assertIsSelected()
        capture("redesign-settings-score-360.png")
        compose.onNodeWithText("Voorkeuren").performScrollTo().performClick()
        compose.onNodeWithText("Meldingen").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Voorkeuren").performScrollTo()
        capture("redesign-settings-preferences-360.png")
        compose.onNodeWithText("Account").performClick()
        compose.onNodeWithText("Noor nieuw").performScrollTo().assertIsDisplayed()
    }
    @Test fun lobbyKeepsRealInvitationAndReadyBeforeStartAndSettingsAreCollapsed() {
        var command = JSONObject()
        val lobby = json("id" to "lobby-one", "name" to "Lokaal 501", "ownerId" to "p1", "inviteCode" to "DF72", "revision" to 4,
            "state" to json("setup" to "localone", "ready" to json("p1" to false, "p2" to true), "settings" to json("startScore" to 501, "bestOfLegs" to 3)),
            "members" to JSONArray(listOf(json("id" to "p1", "name" to "Noor", "status" to "active"), json("id" to "p2", "name" to "Raymond", "status" to "active"))))
        compose.setContent { Box(Modifier.requiredSize(360.dp, 760.dp).testTag("redesign-fixture")) { DartFlowPlayerTheme {
            PlayerApp(state(PlayerScreen.LOBBY).copy(activeId = "lobby-one", resource = json("entity" to lobby)), PlayerActions(command = { _, value -> command = value }))
        } } }
        compose.onNodeWithText("DF72").assertIsDisplayed()
        compose.onNodeWithText("Deel korte link").assertIsDisplayed()
        compose.onNodeWithText("Eerste gooier").assertDoesNotExist()
        compose.onNodeWithText("Wedstrijd starten").performScrollTo().assertIsNotEnabled()
        capture("redesign-lobby-360.png")
        compose.onNodeWithText("Ik sta klaar aan het bord").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("lobby.ready", command.obj("action").text("type")); assertEquals(4, command.optInt("expectedRevision")) }
    }
    @Test fun moreHasVisibleCloseAndRetainsIndependentListFlingAndDestinations() {
        val current = mutableStateOf(state())
        compose.setContent { Box(Modifier.requiredSize(360.dp, 760.dp).testTag("redesign-fixture")) { DartFlowPlayerTheme { PlayerApp(current.value, PlayerActions()) } } }
        compose.onNodeWithText("Meer").performClick()
        compose.onNodeWithTag("more-close").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag("more-group-Spelen & voortgang").performScrollTo().performClick()
        compose.onNodeWithTag("more-menu-scroll").performTouchInput { swipeUp() }
        compose.onNodeWithText("Statistieken").performScrollTo().assertIsDisplayed()
        capture("redesign-more.png", "more-menu-scroll")
        compose.onNodeWithTag("more-close").performScrollTo().performClick()
        compose.onNodeWithTag("more-menu-scroll").assertDoesNotExist()
    }
    @Test fun pairingRemainsUsableAt320WithLightThemeAndLargeSystemText() {
        val theme = json("preference" to json("colorMode" to "light"), "effective" to json("validUntil" to Instant.now().plusSeconds(120).toString(), "tokens" to json("light" to JSONObject(playerDefaultLight), "dark" to JSONObject(playerDefaultDark))))
        compose.setContent { Box(Modifier.requiredSize(320.dp, 760.dp).testTag("redesign-fixture")) {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 1.3f)) { DartFlowPlayerTheme(theme) { PlayerApp(state(PlayerScreen.SCREENS), PlayerActions()) } }
        } }
        compose.onNodeWithText("Koppelcode").performScrollTo().performTextInput("ABCD1234")
        compose.onNodeWithContentDescription("Scan koppel-QR").assertIsDisplayed().assertWidthIsAtLeast(48.dp)
        compose.onNodeWithText("Schermnaam").performScrollTo().performTextInput("Mijn scherm")
        capture("redesign-pair-320-light-large.png")
        compose.onNodeWithText("Dit scherm koppelen").performScrollTo().assertIsNotEnabled()
    }
    @Test fun homeEmptyActionsStayReachableAt412WithVeryLargeSystemText() {
        compose.setContent { Box(Modifier.requiredSize(412.dp, 840.dp).testTag("redesign-fixture")) {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 1.6f)) { DartFlowPlayerTheme { PlayerApp(state(), PlayerActions()) } }
        } }
        listOf("home-scan-button", "home-play-button", "home-statistics", "home-history").forEach { compose.onNodeWithTag(it).performScrollTo().assertIsDisplayed().assertIsEnabled().assertHeightIsAtLeast(48.dp) }
        listOf("Vandaag", "Spelen", "Competities", "Toernooien", "Meer").forEach { label ->
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(label, useUnmergedTree = true).assertIsDisplayed().performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertEquals(1, layouts.size)
            assertFalse("Large system text keeps the complete navigation label: $label", layouts.single().hasVisualOverflow)
            assertTrue(layouts.single().lineCount <= 2)
        }
        compose.onNodeWithText("Hoi Noor.").performScrollTo()
        capture("redesign-home-empty-412-large.png")
    }
}
