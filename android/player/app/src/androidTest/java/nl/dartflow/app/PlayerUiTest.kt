package nl.dartflow.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Isolated native UI fixtures; these tests neither log in nor connect to staging/production. */
class PlayerUiTest {
    @get:Rule val compose = createComposeRule()
    private fun profile(pin: Boolean = true, confirmed: Boolean = true) = PlayerProfile("p1", "Danny", "danny", "Danny", pin, pin && confirmed, confirmed)
    private fun signedIn(p: PlayerProfile = profile()) = PlayerUiState(loading = false, session = PlayerSession(p.id, "fixture@example.test", Long.MAX_VALUE, true), profile = p)

    @Test fun loginUsesNativeEmailCodeAndGoogleControls() {
        var email: String? = null; var google = false
        compose.setContent { DartFlowPlayerTheme { PlayerApp(PlayerUiState(loading = false), PlayerActions(requestOtp = { email = it }, google = { google = true })) } }
        compose.onNodeWithText("E-mailadres").performTextInput("darter@example.test")
        compose.onNodeWithText("Stuur mij een inlogcode").performClick()
        compose.runOnIdle { assertEquals("darter@example.test", email) }
        compose.onNodeWithText("Doorgaan met Google").performClick()
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
        compose.setContent { DartFlowPlayerTheme { Box(Modifier.size(360.dp, 640.dp)) {
            PlayerScoreConsole("Set 1 · Leg 1", listOf(ScorePlayer("p1", "Danny", 148), ScorePlayer("p2", "Rick", 188)), 0, true, false, false, "T20 D20", null, "m1:1", { s, _, _, _ -> score = s }, {}, {})
        } } }
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
        compose.setContent { DartFlowPlayerTheme { Box(Modifier.size(360.dp, 640.dp)) {
            PlayerScoreConsole("Set 1 · Leg 1", listOf(ScorePlayer("p1", "Danny", 148), ScorePlayer("p2", "Rick", 188)), 0, true, false, false, null, null, "m1:1", { _, _, _, _ -> }, {}, {}, activity = activity)
        } } }
        compose.onNodeWithTag("continue-board").assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithTag("score-key-0").assertIsDisplayed()
        val keypad = compose.onNodeWithTag("score-key-0").getUnclippedBoundsInRoot()
        assertTrue("Score keys retain a usable height during warning", keypad.bottom - keypad.top >= 40.dp)
        compose.onNodeWithTag("score-key-6").performClick()
        compose.onNodeWithTag("confirm-score").assertIsDisplayed().assertIsEnabled()
    }

}
