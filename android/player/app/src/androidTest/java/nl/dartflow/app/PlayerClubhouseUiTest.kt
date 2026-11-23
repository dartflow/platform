package nl.dartflow.app

import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import android.view.KeyEvent
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/** Synthetic native fixtures. No hosted account, physical handset or push delivery is used. */
class PlayerClubhouseUiTest {
    @get:Rule val compose = createComposeRule()
    private val club = "00000000-0000-4000-8000-000000000501"
    private val board = "00000000-0000-4000-8000-000000000502"
    private fun state(page: String = "overview", resource: JSONObject = view(page)) = PlayerUiState(loading = false, session = PlayerSession("clubhouse-fixture", "fixture@example.test", Long.MAX_VALUE, true), profile = PlayerProfile("clubhouse-fixture", "Noor", "noor", "Noor", true, true, true), screen = PlayerScreen.CLUBHOUSE, activeId = playerClubId(club, page), resource = resource, safety = json("requiresAcceptance" to false))
    private fun theme(primary: String = "#2563EB", secondary: String = "#C026D3", light: Boolean = false) = json("preference" to json("mode" to "club", "clubId" to club, "colorMode" to if (light) "light" else "dark", "revision" to 1), "effective" to json("clubId" to club, "name" to "Dartclub Noord", "validUntil" to Instant.now().plusSeconds(240).toString(), "tokens" to json("light" to playerPreviewThemeTokens(primary, secondary, false), "dark" to playerPreviewThemeTokens(primary, secondary, true))))
    private fun view(page: String = "overview") = json("page" to page, "club" to json("id" to club, "name" to "Dartclub Noord", "members" to JSONArray()), "pages" to JSONArray(playerClubPages.keys), "permissions" to JSONArray(), "theme" to theme(), "metrics" to json("basis" to "confirmed_results", "period" to json("from" to "2026-11-01T00:00:00Z", "to" to "2026-12-01T00:00:00Z"), "members" to 24, "activeTeams" to 3, "individualMatches" to 12, "teamMatches" to 4))
    private fun wizardConfig() = playerWizardDefaults().put("title", "Clubwinter 2026").put("season", "2026/2027").put("organizerName", "Dartclub Noord").put("playerIds", JSONArray(listOf("p1", "p2"))).put("boardIds", JSONArray(listOf(board)))
    private fun wizardContext(config: JSONObject = wizardConfig()) = json("club" to json("id" to club, "name" to "Dartclub Noord"), "canManage" to true, "players" to JSONArray(listOf(json("id" to "p1", "name" to "Noor", "eligible" to true), json("id" to "p2", "name" to "Sam", "eligible" to true))), "formats" to JSONArray(listOf(json("variant" to "singles", "systems" to JSONArray(listOf("round-robin", "knockout"))))), "locations" to JSONArray(listOf(json("id" to "location", "name" to "Eigen clubhuis", "boards" to JSONArray(listOf(json("id" to board, "name" to "Club-baan 1")))))), "drafts" to JSONArray(listOf(json("id" to "00000000-0000-4000-8000-000000000503", "clubId" to club, "revision" to 1, "step" to 1, "status" to "draft", "config" to config))))
    private fun screenshot(name: String, tag: String = "clubhouse-fixture") {
        require(name in setOf("clubhouse-premium-dark.png", "clubhouse-premium-light-large-font.png", "clubhouse-wizard-review.png", "clubhouse-theme-dartflow-dark.png", "clubhouse-theme-dartflow-light.png", "clubhouse-theme-blue-dark.png", "clubhouse-theme-blue-light.png", "clubhouse-theme-magenta-dark.png", "clubhouse-theme-magenta-light.png"))
        val bitmap = compose.onNodeWithTag(tag).captureToImage().asAndroidBitmap(); val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p /data/local/tmp/dartflow-ui-fixtures")).use { it.readBytes() }
        val pipes = automation.executeShellCommandRw("dd of=/data/local/tmp/dartflow-ui-fixtures/$name")
        // This API returns stdout and stdin only. Closing stdin completes dd;
        // consuming stdout to EOF waits until the shell-owned PNG is durable.
        ParcelFileDescriptor.AutoCloseInputStream(pipes[0]).use { result ->
            ParcelFileDescriptor.AutoCloseOutputStream(pipes[1]).use { output ->
                assertTrue("Could not export synthetic UI screenshot $name", bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
            }
            assertTrue("PNG export produced unexpected stdout", result.readBytes().isEmpty())
        }
    }
    @Test fun expandedMoreMenuKeepsListFlingAfterNotificationsBackAndReopen() {
        var current by mutableStateOf(state().copy(screen = PlayerScreen.HOME, resource = JSONObject()))
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp)) { DartFlowPlayerTheme { PlayerApp(current, PlayerActions(navigate = { screen, id -> current = current.copy(screen = screen, activeId = id, resource = JSONObject()) }, back = { current = current.copy(screen = PlayerScreen.HOME, activeId = null) })) } } }
        compose.onNodeWithText("Meer").performClick(); compose.onNodeWithTag("more-group-Jouw account").performScrollTo().performClick(); compose.onNodeWithText("Meldingen").performScrollTo().performClick(); compose.onNodeWithTag("more-menu-scroll").assertDoesNotExist()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK); compose.onNodeWithText("Meer").performClick(); compose.onNodeWithTag("more-group-Spelen & voortgang").performScrollTo().performClick(); compose.onNodeWithTag("more-group-Community & evenementen").performScrollTo().performClick(); compose.onNodeWithTag("more-group-Jouw account").performScrollTo().performClick(); compose.onNodeWithText("Profiel & instellingen").performScrollTo(); compose.waitForIdle()
        val menu = compose.onNodeWithTag("more-menu-scroll"); val range = { menu.fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange] }
        menu.performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, -range().maxValue()) }
        compose.waitForIdle()
        assertEquals(0f, range().value(), .5f); val top = menu.getUnclippedBoundsInRoot().top
        compose.mainClock.autoAdvance = false
        try {
            menu.performTouchInput { swipeWithVelocity(Offset(center.x, height * .75f), Offset(center.x, height * .55f), endVelocity = 1500f) }
            val released = range().value(); assertTrue("Gesture must leave room for a real fling", range().maxValue() - released > 20f)
            compose.mainClock.advanceTimeBy(96); compose.waitForIdle()
            assertTrue("List must continue moving after finger release", range().value() > released + 2f)
            assertEquals("List fling must not move its sheet anchor", top.value, menu.getUnclippedBoundsInRoot().top.value, 1f)
        } finally { compose.mainClock.autoAdvance = true }
    }
    @Test fun premiumThemeChangesHeaderNavigationFormsAndReturnsToDefault() {
        var active by mutableStateOf<JSONObject?>(theme()); var displayed by mutableStateOf(state()); var observed = emptyMap<String, String>()
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("clubhouse-fixture")) { DartFlowPlayerTheme(active) { val tokens = LocalPlayerTokens.current; SideEffect { observed = tokens }; PlayerApp(displayed, PlayerActions()) } } }
        compose.onNodeWithText("DARTCLUB NOORD").assertExists(); compose.onNodeWithText("Vandaag").assertIsDisplayed(); compose.onNodeWithText("Meer").assertIsDisplayed()
        compose.runOnIdle { assertEquals(theme().obj("effective").obj("tokens").obj("dark").text("primary"), observed["primary"]) }; screenshot("clubhouse-premium-dark.png")
        val management = view("manage").put("permissions", JSONArray(listOf("settings.edit")))
        for ((name, primary, secondary) in listOf(Triple("dartflow", "#C7F36A", "#8EA7EC"), Triple("blue", "#2563EB", "#C026D3"), Triple("magenta", "#FF00CC", "#FFD800"))) {
            for (light in listOf(false, true)) {
                val palette = theme(primary, secondary, light)
                if (name == "dartflow") palette.obj("effective").put("clubId", JSONObject.NULL).put("name", "DartFlow")
                compose.runOnIdle { active = palette; displayed = state("manage", management) }
                compose.onNodeWithText("Verenigingsnaam").performScrollTo().assertIsDisplayed().assertIsEnabled()
                val viewport = compose.onNodeWithTag("clubhouse-fixture").getUnclippedBoundsInRoot()
                val field = compose.onNodeWithText("Verenigingsnaam").getUnclippedBoundsInRoot()
                assertTrue("The real native form must fit inside its viewport", field.left >= viewport.left && field.right <= viewport.right && field.top >= viewport.top && field.bottom <= viewport.bottom)
                compose.onNodeWithContentDescription("Meldingen").assertIsDisplayed()
                for (label in listOf("Vandaag", "Spelen", "Competities", "Toernooien", "Meer")) {
                    val footer = compose.onNodeWithText(label).assertIsDisplayed().getUnclippedBoundsInRoot()
                    assertTrue("Footer $label must remain reachable in $name", footer.left >= viewport.left && footer.right <= viewport.right && footer.top >= viewport.top && footer.bottom <= viewport.bottom)
                }
                val expected = if (name == "dartflow") JSONObject(if (light) playerDefaultLight else playerDefaultDark) else palette.obj("effective").obj("tokens").obj(if (light) "light" else "dark")
                compose.runOnIdle { for (key in playerThemeKeys) assertEquals("$name / $light / $key", expected.text(key), observed[key]); assertTrue(playerContrast(observed.getValue("text"), observed.getValue("surface")) >= 4.5); assertTrue(playerContrast(observed.getValue("primary"), observed.getValue("onPrimary")) >= 4.5) }
                val wordmark = compose.onNodeWithContentDescription("DartFlow").assertIsDisplayed().captureToImage().asAndroidBitmap()
                if (light) {
                    val pixels = IntArray(wordmark.width * wordmark.height); wordmark.getPixels(pixels, 0, wordmark.width, 0, 0, wordmark.width, wordmark.height)
                    val ink = android.graphics.Color.parseColor(requireNotNull(playerWordmarkTint(observed)))
                    assertTrue("The real logo must use readable ink on the light $name header", pixels.count { (it and 0x00FFFFFF) == (ink and 0x00FFFFFF) && android.graphics.Color.alpha(it) > 240 } > 20)
                }
                screenshot("clubhouse-theme-$name-${if (light) "light" else "dark"}.png")
            }
        }
        compose.runOnIdle { active = null }; compose.runOnIdle { assertEquals(playerDefaultDark["primary"], observed["primary"]) }
    }
    @Test fun lightPremiumWithLargeFontKeepsFooterAndContrast() {
        val light = theme(light = true); var observed = emptyMap<String, String>()
        compose.setContent { val density = LocalDensity.current; CompositionLocalProvider(LocalDensity provides Density(density.density, 1.6f)) { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("clubhouse-fixture")) { DartFlowPlayerTheme(light) { val tokens = LocalPlayerTokens.current; SideEffect { observed = tokens }; PlayerApp(state(), PlayerActions()) } } } }
        compose.onNodeWithText("Vandaag").assertIsDisplayed(); compose.onNodeWithText("Meer").assertIsDisplayed()
        compose.runOnIdle { assertTrue(playerContrast(observed.getValue("text"), observed.getValue("surface")) >= 4.5); assertEquals(light.obj("effective").obj("tokens").obj("light").text("background"), observed["background"]) }
        screenshot("clubhouse-premium-light-large-font.png")
    }
    @Test fun clubhousePagesRespectPageAccessAndShowHonestEmptyDues() {
        var current by mutableStateOf(state("dues")); var moderation: JSONObject? = null
        compose.setContent { DartFlowPlayerTheme { PlayerApp(current, PlayerActions(command = { _, body -> moderation = body })) } }
        compose.onNodeWithText("Nog geen contributieadministratie gekoppeld.").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { current = state("manage", view("manage").put("pages", JSONArray(listOf("overview")))) }
        compose.onNodeWithText("Je hebt geen toegang tot dit verenigingsonderdeel.").assertExists(); compose.onNodeWithText("Huisstijlconcept opslaan").assertDoesNotExist()
        for (page in listOf("calendar", "members", "teams", "competitions", "matches", "locations", "tasks", "feed", "overview")) { compose.runOnIdle { current = state(page) }; assertTrue(compose.onAllNodesWithText(playerClubPages.getValue(page), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) }
        val moderatorView = view("manage").put("permissions", JSONArray(listOf("chat.moderate"))).put("reports", JSONArray(listOf(json("id" to "report-a", "status" to "open", "category" to "Bericht", "reason" to "Te beoordelen clubbericht", "reporterName" to "Sam"))))
        compose.runOnIdle { current = state("manage", moderatorView) }
        compose.onNodeWithText("Motivering moderatiebesluit").performScrollTo().performTextInput("Beoordeeld met context")
        compose.onNodeWithText("Moderatiebesluit vastleggen").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("report.resolve", moderation?.obj("action")?.text("type")); assertEquals("report-a", moderation?.obj("action")?.text("reportId")) }
    }
    @Test fun sixStepWizardSavesPreviewAndPublishesThroughCanonicalContract() {
        val context = wizardContext(); val calls = mutableListOf<JSONObject>(); var destination: PlayerScreen? = null
        val fixture = state(resource = context).copy(screen = PlayerScreen.CLUB_COMPETITION_WIZARD, activeId = playerClubId(club))
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("clubhouse-fixture")) { DartFlowPlayerTheme { PlayerClubCompetitionWizard(fixture, PlayerActions(request = { _, body -> calls.add(JSONObject(body.toString())); val a = body.obj("action"); when (a.text("type")) { "wizard.save" -> json("ok" to true, "draft" to json("id" to a.text("id"), "clubId" to club, "revision" to a.optInt("expectedRevision") + 1, "step" to a.optInt("step"), "config" to a.obj("config"))); "wizard.preview" -> json("ok" to true, "preview" to json("draftId" to a.text("id"), "revision" to a.optInt("expectedRevision"), "configurationHash" to "fixture-hash", "canPublish" to true, "warnings" to JSONArray(), "issues" to JSONArray(), "fixtures" to JSONArray(), "rounds" to JSONArray(), "totalMatches" to 1, "participantCount" to 2)); else -> json("ok" to true, "seasonId" to "published-season") } }, navigate = { screen, _ -> destination = screen })) } } }
        compose.onNodeWithText("Hervat Clubwinter 2026 · versie 1").performScrollTo().performClick()
        repeat(5) { compose.onNodeWithTag("club-wizard-next").assertIsDisplayed().performClick() }
        compose.onNodeWithText("Bewaar en bereken roosterpreview").performScrollTo().performClick(); compose.waitUntil { calls.any { it.obj("action").text("type") == "wizard.preview" } }
        compose.onNodeWithText("Competitie publiceren").performScrollTo().assertIsEnabled(); screenshot("clubhouse-wizard-review.png")
        compose.onNodeWithText("Competitie publiceren").performClick(); compose.onNodeWithText("Publicatie bevestigen").performClick()
        compose.waitUntil { destination == PlayerScreen.SEASON }
        assertEquals("fixture-hash", calls.last().obj("action").text("configurationHash")); assertEquals(1, calls.count { it.obj("action").text("type") == "wizard.publish" })
    }
    @Test fun wizardOnlyShowsOwnLinkedBoardsAndKeepsStaleSelectionsExplicit() {
        val config = wizardConfig().put("boardIds", JSONArray(listOf("foreign")))
        var screen by mutableStateOf("boards"); var home by mutableStateOf(false); var themeCommand: JSONObject? = null
        val locations = listOf(json("locationId" to "own", "canManageScreens" to true, "brandingClubs" to JSONArray(listOf(json("id" to "club-a", "name" to "Blauwe club")))), json("locationId" to "foreign", "canManageScreens" to true, "brandingClubs" to JSONArray(listOf(json("id" to "club-b", "name" to "Andere club")))))
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) {
            if (screen == "boards") PlayerWizardBoards(config, wizardContext(), state(), PlayerActions(), true, {})
            else PlayerDeviceThemeChoice(json("id" to "display", "scope" to if (home) "home" else "location", "locationId" to "own", "theme" to "dartflow"), locations, state(), PlayerActions(command = { _, body -> themeCommand = body }))
        } } }
        compose.onNodeWithText("Club-baan 1").assertExists(); compose.onNodeWithText("1 eerder gekozen banen zijn niet meer gekoppeld.", substring = true).assertExists(); compose.onNodeWithText("foreign").assertDoesNotExist(); compose.onNodeWithText("Vervallen selecties verwijderen").assertExists()
        compose.runOnIdle { screen = "device" }; compose.onNodeWithText("DartFlow").performClick()
        compose.onNodeWithText("Clubstijl · Andere club").assertDoesNotExist()
        compose.onNodeWithText("Clubstijl · Blauwe club").performClick()
        compose.runOnIdle { assertEquals("club", themeCommand?.text("theme")); assertEquals("club-a", themeCommand?.text("clubId")); home = true }
        compose.onNodeWithText("DartFlow").performClick(); compose.onNodeWithText("Clubstijl · Blauwe club").assertDoesNotExist()
    }
    @Test fun richFeedShowsPollAndNeverOffersAnotherAuthorsEdit() {
        val poll = json("id" to "poll", "endsAt" to "2027-01-01T12:00:00Z", "multiple" to true, "allowChange" to true, "closed" to false, "totalVoters" to 1, "myOptionIds" to JSONArray(), "options" to JSONArray(listOf(json("id" to "option-a", "label" to "Dinsdag", "votes" to 1))))
        val post = json("id" to "post", "scopeKind" to "club", "scopeId" to club, "extras" to json("canEdit" to false, "canPin" to false, "revision" to 1, "poll" to poll))
        var vote: JSONObject? = null
        compose.setContent { DartFlowPlayerTheme { Column(Modifier.verticalScroll(rememberScrollState())) { PlayerFeedExtras(post, state(), PlayerActions(command = { _, body -> vote = body })) } } }
        compose.onNodeWithText("Dinsdag · 1 stemmen").assertIsOff().performClick(); compose.onNodeWithText("Dinsdag · 1 stemmen").assertIsOn(); compose.onNodeWithText("Mijn stem opslaan").assertIsEnabled().performClick(); compose.runOnIdle { assertEquals("poll.vote", vote?.obj("action")?.text("type")); assertEquals(listOf("option-a"), vote?.obj("action")?.optJSONArray("optionIds")?.strings()) }
        compose.onNodeWithText("Bericht bewerken").assertDoesNotExist(); compose.onNodeWithText("Peiling sluiten").assertDoesNotExist()
    }
    @Test fun privateChatRefusesMissingChannelAndDoesNotRenderStaleMessages() {
        val privateData = json("channel" to json("id" to "different-channel", "name" to "Bestuur"), "messages" to JSONArray(listOf(json("id" to "private", "body" to "Verborgen inhoud"))))
        val current = state(resource = privateData).copy(screen = PlayerScreen.CLUB_CHAT, activeId = playerClubId(club, item = "own-channel"))
        compose.setContent { DartFlowPlayerTheme { PlayerClubChat(current, PlayerActions()) } }
        compose.onNodeWithText("Je hebt geen actuele toegang", substring = true).assertExists(); compose.onNodeWithText("Verborgen inhoud").assertDoesNotExist(); compose.onNodeWithText("Bericht verzenden").assertDoesNotExist()
    }
}
