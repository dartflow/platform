package nl.dartflow.app

import android.graphics.Bitmap
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Isolated native UI fixtures; these tests neither log in nor connect to staging/production. */
class PlayerUiTest {
    @get:Rule val compose = createComposeRule()
    private fun profile(pin: Boolean = true, confirmed: Boolean = true) = PlayerProfile("p1", "Danny", "danny", "Danny", pin, pin && confirmed, confirmed)
    private fun signedIn(p: PlayerProfile = profile()) = PlayerUiState(loading = false, session = PlayerSession(p.id, "fixture@example.test", Long.MAX_VALUE, true), profile = p)
    private val homePostId = "00000000-0000-4000-8000-000000000201"
    private val homeClubId = "00000000-0000-4000-8000-000000000202"
    private val homePostBody = "Vanavond trainen we samen op baan 1."
    private fun homeFeed(withPost: Boolean = true) = JSONObject()
        .put("scopes", JSONArray(listOf(JSONObject().put("kind", "club").put("id", homeClubId).put("name", "Dartclub Test").put("canWrite", true))))
        .put("posts", JSONArray(if (withPost) listOf(JSONObject().put("id", homePostId).put("authorId", "p2").put("authorName", "Noor Testspeler")
            .put("scopeKind", "club").put("scopeId", homeClubId).put("scopeName", "Dartclub Test")
            .put("createdAt", "2026-11-18T18:00:00.000Z").put("body", homePostBody).put("likes", 2).put("liked", false).put("replyCount", 3).put("canDelete", false)) else emptyList<JSONObject>()))
        .put("nextCursor", JSONObject.NULL)
    private fun homeState(feed: JSONObject = homeFeed(), loading: Boolean = false, error: String? = null) = signedIn().copy(
        resource = JSONObject().put("resume", JSONArray()).put("fixtures", JSONArray()).put("actions", JSONArray()),
        homeFeed = feed, homeFeedLoading = loading, homeFeedError = error,
        safety = JSONObject().put("requiresAcceptance", false).put("rulesVersion", "2026-11-18"),
    )

    private fun assertHomeActionsFitNarrowViewport() {
        compose.onNodeWithTag("compact-fixture").assertWidthIsEqualTo(360.dp).assertHeightIsEqualTo(640.dp)
        val viewport = compose.onNodeWithTag("compact-fixture").getUnclippedBoundsInRoot()
        listOf("home-scan-button", "home-play-button").forEach { tag ->
            val bounds = compose.onNodeWithTag(tag).assertIsDisplayed().assertIsEnabled().assertHeightIsAtLeast(48.dp).getUnclippedBoundsInRoot()
            assertTrue("$tag must be fully reachable on first open without scrolling", bounds.top >= viewport.top && bounds.bottom <= viewport.bottom && bounds.left >= viewport.left && bounds.right <= viewport.right)
        }
    }

    private fun assertCompleteHomeShortcut(label: String, tag: String) {
        compose.onNodeWithTag(tag).assertIsDisplayed().assertIsEnabled().assertHeightIsAtLeast(48.dp)
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(label, useUnmergedTree = true).assertIsDisplayed()
            .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertEquals("$label exposes exactly one native text layout", 1, layouts.size)
        val layout = layouts.single()
        val measured = "size=${layout.size}, paragraph=${layout.multiParagraph.width}x${layout.multiParagraph.height}, " +
            "didOverflowWidth=${layout.didOverflowWidth}, didOverflowHeight=${layout.didOverflowHeight}, lines=${layout.lineCount}, " +
            "lineLeft=${layout.getLineLeft(0)}, lineRight=${layout.getLineRight(0)}, lineBottom=${layout.getLineBottom(0)}"
        assertEquals("$label must fit one line: $measured", 1, layout.lineCount)
        assertFalse("$label must remain complete: $measured", layout.hasVisualOverflow)
    }

    /** Check rendered glyphs, rather than a theme token which Text might not inherit. */
    private fun assertReadableText(text: String, background: Color) {
        val pixels = compose.onNodeWithText(text, useUnmergedTree = true).assertIsDisplayed().captureToImage().toPixelMap()
        val backgroundLuminance = background.luminance()
        var readablePixels = 0
        for (y in 0 until pixels.height) for (x in 0 until pixels.width) {
            val luminance = pixels[x, y].luminance()
            val contrast = (maxOf(luminance, backgroundLuminance) + .05f) / (minOf(luminance, backgroundLuminance) + .05f)
            if (contrast >= 4.5f) readablePixels++
        }
        assertTrue("$text must render visible, high-contrast glyphs on its dark background", readablePixels > pixels.width * pixels.height * .02f)
    }

    /** Export only these synthetic, offline fixtures for release-time visual inspection. */
    private fun saveFixtureScreenshot(filename: String) {
        require(filename in setOf("compact-login.png", "compact-screens.png", "compact-events.png", "score-status-default.png", "score-status-large-font.png", "compact-home-feed.png"))
        // CI runs API 36. Keep UI assertions usable on older supported devices.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val fixture = compose.onNodeWithTag("compact-fixture")
        val bounds = fixture.getUnclippedBoundsInRoot()
        val root = compose.onRoot().getUnclippedBoundsInRoot()
        assertTrue("The complete screenshot fixture must fit inside the physical Compose window", bounds.left >= root.left && bounds.right <= root.right && bounds.top >= root.top && bounds.bottom <= root.bottom)
        val bitmap = fixture.captureToImage().asAndroidBitmap()
        with(compose.density) {
            assertEquals("Screenshot must include the full fixture width", (bounds.right - bounds.left).roundToPx(), bitmap.width)
            assertEquals("Screenshot must include the full fixture height", (bounds.bottom - bounds.top).roundToPx(), bitmap.height)
        }
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val directory = "/data/local/tmp/dartflow-ui-fixtures"
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p $directory")).use { it.readBytes() }
        // Use shell-owned storage: Gradle uninstalls the fixture app after tests.
        // executeShellCommandRw returns stdout at index 0 and stdin at index 1.
        val descriptors = automation.executeShellCommandRw("dd of=$directory/$filename")
        ParcelFileDescriptor.AutoCloseInputStream(descriptors[0]).use { completion ->
            ParcelFileDescriptor.AutoCloseOutputStream(descriptors[1]).use { output ->
                assertTrue("Could not export synthetic UI screenshot $filename", bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
            }
            // Closing stdin lets dd finish; reading to EOF waits until it has done so.
            assertTrue("PNG export produced unexpected stdout", completion.readBytes().isEmpty())
        }
    }

    @Test fun loginHeadingsRenderReadableColorsOnDarkBackgrounds() {
        compose.setContent { DartFlowPlayerTheme { PlayerApp(PlayerUiState(loading = false), PlayerActions()) } }
        assertReadableText("Klaar voor jouw volgende leg?", PlayerInk)
        assertReadableText("Welkom bij DartFlow", PlayerPanel)
    }

    @Test fun loginGoogleActionFitsSmallPhoneWithoutScrolling() {
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(PlayerUiState(loading = false), PlayerActions())
        } } }
        compose.onNodeWithTag("compact-fixture").assertWidthIsEqualTo(360.dp).assertHeightIsEqualTo(640.dp)
        val viewport = compose.onNodeWithTag("compact-fixture").getUnclippedBoundsInRoot()
        val google = compose.onNodeWithText("Doorgaan met Google").assertIsDisplayed().assertIsEnabled().getUnclippedBoundsInRoot()
        assertTrue("Google sign-in must be fully visible at first open on a 360×640 phone", google.bottom <= viewport.bottom && google.top >= viewport.top)
        compose.onNodeWithText("Doorgaan met Google").assertHeightIsAtLeast(48.dp)
        saveFixtureScreenshot("compact-login.png")
    }

    @Test fun allNavigationLabelsFitOneLineOnNarrowPhone() {
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(signedIn().copy(screen = PlayerScreen.EVENTS), PlayerActions())
        } } }
        compose.onNodeWithTag("compact-fixture").assertWidthIsEqualTo(360.dp).assertHeightIsEqualTo(640.dp)
        listOf("Vandaag", "Spelen", "Competities", "Toernooien", "Meer").forEach { label ->
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(label, useUnmergedTree = true).assertIsDisplayed()
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertEquals("$label must expose one native text layout", 1, layouts.size)
            assertEquals("$label must not wrap in bottom navigation", 1, layouts.single().lineCount)
            assertFalse("$label must remain complete rather than ellipsized or clipped", layouts.single().hasVisualOverflow)
        }
        saveFixtureScreenshot("compact-events.png")
    }

    @Test fun screenPairingFieldsFitAboveNavigationOnSmallPhone() {
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(signedIn().copy(screen = PlayerScreen.SCREENS), PlayerActions())
        } } }
        compose.onNodeWithTag("compact-fixture").assertWidthIsEqualTo(360.dp).assertHeightIsEqualTo(640.dp)
        compose.onNodeWithText("Koppelcode").assertIsDisplayed()
        compose.onNodeWithText("Schermnaam").assertIsDisplayed()
        val name = compose.onNodeWithText("Schermnaam").getUnclippedBoundsInRoot()
        val navigation = compose.onNodeWithText("Vandaag", useUnmergedTree = true).getUnclippedBoundsInRoot()
        assertTrue("Screen-name entry must initially be visible above bottom navigation", name.bottom < navigation.top)
        assertReadableText("Oche Live-schermen", PlayerInk)
        assertReadableText("Scherm koppelen", PlayerPanel)
        saveFixtureScreenshot("compact-screens.png")
    }

    @Test fun homePlayScanAndRealCommunityPostFitNarrowPhone() {
        var scanned = false
        var destination: Pair<PlayerScreen, String?>? = null
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(homeState(), PlayerActions(scan = { scanned = true }, navigate = { screen, id -> destination = screen to id }))
        } } }
        assertHomeActionsFitNarrowViewport()
        compose.onNodeWithTag("home-feed-post-$homePostId").assertIsDisplayed()
        compose.onNodeWithText(homePostBody).assertIsDisplayed()
        compose.onNodeWithText("Noor Testspeler").assertIsDisplayed()
        // Keep visual evidence even if a strict text-layout assertion below finds a regression.
        saveFixtureScreenshot("compact-home-feed.png")
        assertCompleteHomeShortcut("Statistieken", "home-statistics")
        assertCompleteHomeShortcut("Historie", "home-history")
        compose.onNodeWithTag("home-scan-button").performClick()
        compose.runOnIdle { assertTrue(scanned) }
        compose.onNodeWithTag("home-play-button").performClick()
        compose.runOnIdle { assertEquals(PlayerScreen.PLAY to null, destination) }
    }

    @Test fun homeProgressShortcutsStayCompleteAndUsableWithLargeSystemText() {
        var destination: PlayerScreen? = null
        compose.setContent {
            Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) {
                val density = LocalDensity.current.density
                CompositionLocalProvider(LocalDensity provides Density(density, 1.6f)) {
                    DartFlowPlayerTheme {
                        PlayerApp(homeState(homeFeed(withPost = false)), PlayerActions(navigate = { screen, _ -> destination = screen }))
                    }
                }
            }
        }
        compose.onNodeWithTag("home-statistics").performScrollTo()
        assertCompleteHomeShortcut("Statistieken", "home-statistics")
        compose.onNodeWithTag("home-statistics").performClick()
        compose.runOnIdle { assertEquals(PlayerScreen.STATISTICS, destination) }
        compose.onNodeWithTag("home-history").performScrollTo()
        assertCompleteHomeShortcut("Historie", "home-history")
        compose.onNodeWithTag("home-history").performClick()
        compose.runOnIdle { assertEquals(PlayerScreen.HISTORY, destination) }
        val statistics = compose.onNodeWithTag("home-statistics").getUnclippedBoundsInRoot()
        val history = compose.onNodeWithTag("home-history").getUnclippedBoundsInRoot()
        assertTrue("Large system text puts the shortcuts on separate full-width rows", statistics.bottom <= history.top)
    }

    @Test fun homePostRepliesOpenExistingScopedCommunityRoute() {
        var destination: Pair<PlayerScreen, String?>? = null
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(homeState(), PlayerActions(navigate = { screen, id -> destination = screen to id }))
        } } }
        compose.onNodeWithTag("home-feed-replies-$homePostId").performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals(PlayerScreen.FEED, destination?.first)
            val parameters = PlayerLinks.query(java.net.URI("https://native.invalid/?${destination?.second.orEmpty()}"))
            assertEquals("club", parameters["kind"])
            assertEquals(homeClubId, parameters["id"])
            assertEquals(homePostId, parameters["parentId"])
        }
    }

    @Test fun emptyHomeFeedKeepsPlayAndQrScanAvailable() {
        var scanned = false
        var playing = false
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(homeState(homeFeed(withPost = false)), PlayerActions(scan = { scanned = true }, navigate = { screen, _ -> playing = screen == PlayerScreen.PLAY }))
        } } }
        assertHomeActionsFitNarrowViewport()
        compose.onNodeWithText("Nog geen berichten", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("home-scan-button").performScrollTo().performClick()
        compose.onNodeWithTag("home-play-button").performScrollTo().performClick()
        compose.runOnIdle { assertTrue(scanned); assertTrue(playing) }
    }

    @Test fun loadingHomeFeedDoesNotBlockPlayOrShowFalseEmptyState() {
        var scanned = false
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(homeState(homeFeed(withPost = false), loading = true), PlayerActions(scan = { scanned = true }))
        } } }
        assertHomeActionsFitNarrowViewport()
        compose.onNodeWithText("Nog geen berichten", substring = true).assertDoesNotExist()
        compose.onNodeWithTag("home-scan-button").performClick()
        compose.runOnIdle { assertTrue(scanned) }
    }

    @Test fun failedHomeFeedRetainsCachedPostAndQuickActionsAndOffersRetry() {
        var retries = 0
        val failure = "De community is tijdelijk niet bereikbaar."
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(homeState(error = failure), PlayerActions(refresh = { retries++ }))
        } } }
        assertHomeActionsFitNarrowViewport()
        compose.onNodeWithText(failure, substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("home-feed-retry").performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, retries) }
        compose.onNodeWithText(homePostBody).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("home-scan-button").performScrollTo().assertIsEnabled()
        compose.onNodeWithTag("home-play-button").performScrollTo().assertIsEnabled()
    }

    @Test fun moreMenuScrollsToAccountAndLastEntryAndOpensTheirScreens() {
        var destination: Pair<PlayerScreen, String?>? = null
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(homeState(homeFeed(withPost = false)), PlayerActions(navigate = { screen, id -> destination = screen to id }))
        } } }
        compose.onNodeWithTag("compact-fixture").assertWidthIsEqualTo(360.dp).assertHeightIsEqualTo(640.dp)
        compose.onNodeWithText("Meer").performClick()
        // A swipe also expands a partially opened native sheet before scrolling
        // its list; account entries must remain reachable without shrinking text.
        compose.onNode(hasScrollAction() and hasAnyDescendant(hasText("Profiel & instellingen"))).performTouchInput { swipeUp() }
        compose.onNodeWithText("Profiel & instellingen").performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(PlayerScreen.PROFILE to null, destination) }
        compose.onNodeWithText("Profiel & instellingen").assertDoesNotExist()
        compose.onNodeWithText("Meer").performClick()
        compose.onNode(hasScrollAction() and hasAnyDescendant(hasText("Profiel & instellingen"))).performTouchInput { swipeUp() }
        compose.onNodeWithText("Meldingen").performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(PlayerScreen.NOTIFICATIONS to null, destination) }
    }

    @Test fun eventDetailKeepsEventsTabSelectedAndCanReturnToItsParent() {
        var destination: Pair<PlayerScreen, String?>? = null
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("compact-fixture")) { DartFlowPlayerTheme {
            PlayerApp(signedIn().copy(screen = PlayerScreen.EVENT, activeId = "00000000-0000-4000-8000-000000000203"), PlayerActions(navigate = { screen, id -> destination = screen to id }))
        } } }
        compose.onNodeWithText("Toernooien").assertIsDisplayed().assertIsSelected()
        compose.onNodeWithText("Vandaag").assertIsNotSelected()
        compose.onNodeWithText("Meer").assertIsNotSelected()
        compose.onNodeWithText("Toernooien").performClick()
        compose.runOnIdle { assertEquals(PlayerScreen.EVENTS to null, destination) }
    }

    @Test fun loginUsesNativeEmailCodeAndGoogleControls() {
        var email: String? = null; var google = false
        compose.setContent { DartFlowPlayerTheme { PlayerApp(PlayerUiState(loading = false), PlayerActions(requestOtp = { email = it }, google = { google = true })) } }
        compose.onNodeWithText("E-mailadres").performTextInput("darter@example.test")
        // The IME can reduce the viewport: exercise the visible, enabled button after scrolling.
        compose.onNodeWithText("Stuur mij een inlogcode").performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals("darter@example.test", email) }
        compose.onNodeWithText("Doorgaan met Google").performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()
        compose.runOnIdle { assertTrue(google) }
    }

    @Test fun existingPinlessAccountCanStillOpenItsPlayerEnvironment() {
        compose.setContent { DartFlowPlayerTheme { PlayerApp(signedIn(profile(pin = false)), PlayerActions()) } }
        compose.onNodeWithText("Hoi Danny.").assertIsDisplayed()
        compose.onNodeWithText("Dit ben jij op het scorebord").assertDoesNotExist()
        compose.onNodeWithText("Pincode instellen").performScrollTo().assertIsDisplayed()
    }

    @Test fun onboardingRequiresNamesAndSixAsciiDigitsWithConfirmation() {
        var saved: List<String>? = null
        compose.setContent { DartFlowPlayerTheme { PlayerApp(signedIn(profile(false, false)), PlayerActions(completeProfile = { u, d, p, c -> saved = listOf(u, d, p, c) })) } }
        compose.onNodeWithText("Begin met spelen").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("Spelerspincode").performScrollTo().performTextInput("012345")
        compose.onNodeWithText("Herhaal spelerspincode").performScrollTo().performTextInput("012344")
        compose.onNodeWithText("Begin met spelen").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("Herhaal spelerspincode").performScrollTo().performTextClearance()
        compose.onNodeWithText("Herhaal spelerspincode").performTextInput("012345")
        compose.onNodeWithText("Begin met spelen").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(listOf("danny", "Danny", "012345", "012345"), saved) }
    }

    @Test fun scoreKeypadAndConfirmFit360By640WithoutScrolling() {
        var score: Int? = null
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("score-fixture")) { DartFlowPlayerTheme {
            PlayerScoreConsole("Set 1 · Leg 1", listOf(ScorePlayer("p1", "Danny", 148), ScorePlayer("p2", "Rick", 188)), 0, true, false, false, "T20 D20", null, "m1:1", { s, _, _, _ -> score = s }, {}, {})
        } } }
        compose.onNodeWithTag("score-fixture").assertWidthIsEqualTo(360.dp).assertHeightIsEqualTo(640.dp)
        compose.onNodeWithTag("score-key-6").performClick()
        compose.onNodeWithTag("score-key-0").performClick()
        compose.onNodeWithTag("confirm-score").assertIsDisplayed().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(60, score) }
        val console = compose.onNodeWithTag("native-score-console").getUnclippedBoundsInRoot()
        val confirm = compose.onNodeWithTag("confirm-score").getUnclippedBoundsInRoot()
        val bottomKey = compose.onNodeWithTag("score-key-0").getUnclippedBoundsInRoot()
        assertTrue("Bevestigen must remain inside score console", confirm.bottom <= console.bottom)
        assertTrue("Bottom keypad row must remain visible", bottomKey.bottom < confirm.top)
    }

    private fun assertScoreHeaderFitsViewport(width: Dp, height: Dp, fontScale: Float, screenshot: String) {
        compose.setContent {
            Box(Modifier.requiredSize(width, height).testTag("compact-fixture")) {
                val density = LocalDensity.current.density
                CompositionLocalProvider(LocalDensity provides Density(density, fontScale)) {
                    DartFlowPlayerTheme {
                        PlayerScoreConsole("Dartbot", listOf(ScorePlayer("p1", "Danny G", 501), ScorePlayer("p2", "Dartbot", 501)), 0, true, false, false, null, null, "m1:1", { _, _, _, _ -> }, {}, {})
                    }
                }
            }
        }
        compose.onNodeWithTag("compact-fixture").assertWidthIsEqualTo(width).assertHeightIsEqualTo(height)
        val viewport = compose.onNodeWithTag("compact-fixture").getUnclippedBoundsInRoot()
        val console = compose.onNodeWithTag("native-score-console").getUnclippedBoundsInRoot()
        assertTrue("The complete console must fit the requested phone viewport", console.top >= viewport.top && console.bottom <= viewport.bottom)
        listOf(0 to "AAN DE BEURT", 1 to "WACHT").forEach { (index, status) ->
            val card = compose.onNodeWithTag("score-player-card-$index").assertIsDisplayed().getUnclippedBoundsInRoot()
            val name = compose.onNodeWithTag("score-player-name-$index").assertIsDisplayed().getUnclippedBoundsInRoot()
            val remaining = compose.onNodeWithTag("score-player-remaining-$index").assertIsDisplayed().getUnclippedBoundsInRoot()
            val statusNode = compose.onNodeWithTag("score-player-status-$index").assertIsDisplayed().assertTextEquals(status)
            val statusBounds = statusNode.getUnclippedBoundsInRoot()
            assertTrue("Player $index identity must precede the remaining score", name.bottom <= remaining.top)
            assertTrue("Player $index remaining score must precede its complete status label", remaining.bottom <= statusBounds.top)
            assertTrue("Player $index status must fit fully inside its score card at font scale $fontScale", statusBounds.top >= card.top && statusBounds.bottom <= card.bottom && statusBounds.left >= card.left && statusBounds.right <= card.right)
            val layouts = mutableListOf<TextLayoutResult>()
            statusNode.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertEquals("Player $index status exposes exactly one text layout", 1, layouts.size)
            assertFalse("Player $index status text must not be vertically clipped at font scale $fontScale", layouts.single().didOverflowHeight)
            assertFalse("Player $index status text must not wrap or ellipsize", layouts.single().hasVisualOverflow)
        }
        compose.onNodeWithTag("score-key-1").performClick()
        compose.onNodeWithTag("score-key-1").performClick()
        compose.onNodeWithTag("score-key-2").performClick()
        val confirm = compose.onNodeWithTag("confirm-score").assertIsDisplayed().assertIsEnabled().getUnclippedBoundsInRoot()
        val bottomKey = compose.onNodeWithTag("score-key-0").assertIsDisplayed().getUnclippedBoundsInRoot()
        assertTrue("Confirm must remain fully inside the score console with enlarged score cards", confirm.top >= console.top && confirm.bottom <= console.bottom && confirm.left >= console.left && confirm.right <= console.right)
        assertTrue("The complete numeric keypad must precede Confirm", bottomKey.bottom <= confirm.top)
        saveFixtureScreenshot(screenshot)
    }

    @Test fun scorePlayerStatusFits360By640AtDefaultFontScale() {
        assertScoreHeaderFitsViewport(360.dp, 640.dp, 1f, "score-status-default.png")
    }

    @Test fun scorePlayerStatusFits390By844AtLargeFontScale() {
        assertScoreHeaderFitsViewport(390.dp, 844.dp, 1.3f, "score-status-large-font.png")
    }

    @Test fun opponentTurnDisablesEveryScoreMutation() {
        compose.setContent { DartFlowPlayerTheme { PlayerScoreConsole("Set 1 · Leg 1", listOf(ScorePlayer("p1", "Danny", 501), ScorePlayer("p2", "Rick", 501)), 1, false, false, false, null, null, "m1:1", { _, _, _, _ -> fail("An unauthorized throw was submitted") }, {}, {}) } }
        compose.onNodeWithTag("confirm-score").assertIsNotEnabled()
        compose.onNodeWithTag("score-key-1").assertIsNotEnabled()
        compose.onNodeWithText("Wacht op de beurt van je tegenstander.").assertIsDisplayed()
    }

    @Test fun checkoutExplicitlyCapturesUsedDarts() {
        var submitted: List<Any>? = null
        compose.setContent { DartFlowPlayerTheme { PlayerScoreConsole("Solo 501", listOf(ScorePlayer("p1", "Danny", 40)), 0, true, false, false, "20 D20", null, "m1:1", { s, d, valid, _ -> submitted = listOf(s, d, valid) }, {}, {}) } }
        compose.onNodeWithTag("score-key-4").performClick(); compose.onNodeWithTag("score-key-0").performClick()
        compose.onNodeWithTag("confirm-score").performClick()
        compose.onNodeWithText("1 dart").performClick()
        compose.runOnIdle { assertEquals(listOf(40, 1, true), submitted) }
    }

    @Test fun mirrorsCurrentLegAndKeepsFiveRowsStable() {
        val visits = listOf(JSONObject("{\"playerIndex\":0,\"score\":60,\"remainingAfter\":88}"), JSONObject("{\"playerIndex\":1,\"score\":0,\"remainingAfter\":188,\"bust\":true}"))
        compose.setContent { DartFlowPlayerTheme { ScoreCardView(visits, 501, listOf("Danny", "Rick")) } }
        compose.onNodeWithText("BUST").assertIsDisplayed()
        compose.onNodeWithText("88").assertIsDisplayed()
        compose.onNodeWithTag("scorecard-visits").assertHeightIsEqualTo(170.dp)
    }
    @Test fun inactivityWarningKeepsPhoneKeypadAndConfirmReachable() {
        val activity = JSONObject("{\"sessionId\":\"board-session-1\",\"phase\":\"warning\",\"serverNow\":120000,\"warningAt\":120000,\"deadlineAt\":180000,\"extensionsUsed\":0,\"canExtend\":true}")
        compose.setContent { Box(Modifier.requiredSize(360.dp, 640.dp).testTag("score-fixture")) { DartFlowPlayerTheme {
            PlayerScoreConsole("Set 1 · Leg 1", listOf(ScorePlayer("p1", "Danny", 148), ScorePlayer("p2", "Rick", 188)), 0, true, false, false, null, null, "m1:1", { _, _, _, _ -> }, {}, {}, activity = activity)
        } } }
        compose.onNodeWithTag("score-fixture").assertWidthIsEqualTo(360.dp).assertHeightIsEqualTo(640.dp)
        compose.onNodeWithTag("continue-board").assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithTag("score-key-0").assertIsDisplayed()
        val keypad = compose.onNodeWithTag("score-key-0").getUnclippedBoundsInRoot()
        assertTrue("Score keys retain a usable height during warning", keypad.bottom - keypad.top >= 40.dp)
        compose.onNodeWithTag("score-key-6").performClick()
        compose.onNodeWithTag("confirm-score").assertIsDisplayed().assertIsEnabled()
    }

    @Test fun communityRequiresExplicitRulesAndAgeConfirmation() {
        var submitted: JSONObject? = null
        compose.setContent { DartFlowPlayerTheme { androidx.compose.foundation.layout.Column {
            CommunityConsent(signedIn().copy(safety = JSONObject("{\"requiresAcceptance\":true,\"rulesVersion\":\"2026-11-18\"}")), PlayerActions(command = { path, body -> assertEquals("/safety/consent", path); submitted = body }))
        } } }
        compose.onNodeWithTag("accept-community").assertIsNotEnabled()
        compose.onNodeWithTag("community-age").performClick()
        compose.onNodeWithTag("accept-community").assertIsNotEnabled()
        compose.onNodeWithTag("community-accept").performClick()
        compose.onNodeWithTag("accept-community").assertIsEnabled().performClick()
        compose.runOnIdle { assertTrue(submitted!!.getBoolean("accepted")); assertTrue(submitted!!.getBoolean("ageConfirmed")); assertEquals("2026-11-18", submitted!!.getString("version")) }
    }

    @Test fun blockRequiresConfirmationAndKeepsOwnIdentity() {
        var submitted: JSONObject? = null
        compose.setContent { DartFlowPlayerTheme { PlayerSafetyControls(signedIn(), PlayerActions(command = { path, body -> assertEquals("/safety/block", path); submitted = body }), "p2", "Fixture opponent") } }
        compose.onNodeWithText("Speler blokkeren").performClick()
        compose.runOnIdle { assertNull(submitted) }
        compose.onNodeWithText("Blokkeren", useUnmergedTree = true).performClick()
        compose.runOnIdle { assertEquals("p2", submitted!!.getString("userId")); assertTrue(submitted!!.getBoolean("blocked")) }
    }

    @Test fun reportRequiresExplanationAndExplicitSubmit() {
        var submitted: JSONObject? = null
        compose.setContent { DartFlowPlayerTheme { PlayerReportDialog(signedIn(), PlayerReportTarget("post", "post-1", "Bericht", "platform", "platform-1"), PlayerActions(command = { path, body -> assertEquals("/safety/report", path); submitted = body }), {}) } }
        compose.onNodeWithText("Melding versturen").assertIsNotEnabled()
        compose.onNodeWithText("Toelichting").performTextInput("Deze persoon bedreigt mij.")
        compose.onNodeWithText("Melding versturen").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals("post-1", submitted!!.getString("targetId")); assertEquals("harassment", submitted!!.getString("category")) }
    }

    @Test fun deletionRequiresExactConfirmationAndDoesNotLogoutBeforeAcceptance() {
        var submitted: JSONObject? = null
        compose.setContent { DartFlowPlayerTheme { androidx.compose.foundation.layout.Column(Modifier.verticalScroll(rememberScrollState())) { AccountDeletionCard(signedIn(), PlayerActions(command = { path, body -> assertEquals("/account/deletion", path); submitted = body })) } } }
        compose.onNodeWithText("Account verwijderen aanvragen").performScrollTo().performClick()
        compose.onNodeWithText("Verwijderverzoek bevestigen").assertIsNotEnabled()
        compose.onNodeWithText("Typ VERWIJDEREN om te bevestigen").performTextInput("verwijderen")
        compose.onNodeWithText("Verwijderverzoek bevestigen").assertIsNotEnabled()
        compose.onNodeWithText("Typ VERWIJDEREN om te bevestigen").performTextClearance()
        compose.onNodeWithText("Typ VERWIJDEREN om te bevestigen").performTextInput("VERWIJDEREN")
        compose.onNodeWithText("Verwijderverzoek bevestigen").performClick()
        compose.runOnIdle { assertEquals("VERWIJDEREN", submitted!!.getString("confirmation")) }
    }

    @Test fun deniedCameraStillOffersManualLinkEntry() {
        var cancelled = false
        compose.setContent { DartFlowPlayerTheme { androidx.compose.foundation.layout.Column { ScannerPermissionPanel("Camera niet toegestaan.", {}, { cancelled = true }) } } }
        compose.onNodeWithText("Camera niet toegestaan.").assertIsDisplayed()
        compose.onNodeWithText("Link of code invoeren").performClick()
        compose.runOnIdle { assertTrue(cancelled) }
    }

    @Test fun blockedMediaShowsStoppedStateAndRemovesCameraControls() {
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)
        val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        val call = PlayerVideoCall(context, PlayerApi("https://dartflow.nl"), "synthetic-match", scope)
        call.open = true
        call.handleSignalingFailure(PlayerApiFailure(403, "blocked", "Access denied"))
        compose.setContent { DartFlowPlayerTheme { PlayerMediaRoom(call) } }
        compose.onNodeWithText("De beeldverbinding is gestopt omdat de toegang is gewijzigd of geblokkeerd. Camera en microfoon zijn uit. Je kunt blijven scoren.").assertIsDisplayed()
        compose.onNodeWithText("Camera wisselen").assertDoesNotExist()
        compose.onNodeWithText("Microfoon uit").assertDoesNotExist()
        compose.onNodeWithText("Beeldverbinding starten").assertIsEnabled()
        compose.runOnIdle { call.close(); scope.coroutineContext[kotlinx.coroutines.Job]?.cancel() }
    }

}
