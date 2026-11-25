package nl.dartflow.ochelive

import android.os.SystemClock
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue

class OcheUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun portraitSetupSavesWithoutAskingForScoreboardCount() {
        var saved: DisplayLayout? = null
        compose.setContent { MaterialTheme { LayoutWizard(LayoutSetup(DisplayLayout("portrait", 1), false), { saved = it }, {}, {}) } }
        compose.onNodeWithText("Hoe staat dit scherm?").assertIsDisplayed()
        compose.onNodeWithText("Opslaan en doorgaan").performClick()
        compose.onNodeWithText("Hoeveel scoreborden wil je tonen?").assertDoesNotExist()
        compose.runOnIdle { assertTrue(saved == DisplayLayout("portrait", 1)) }
    }
    @Test fun landscapeSetupRetainsTwoScoreboardsWhenGoingBack() {
        var saved: DisplayLayout? = null
        compose.setContent { MaterialTheme { LayoutWizard(LayoutSetup(DisplayLayout("landscape", 1), false), { saved = it }, {}, {}) } }
        compose.onNodeWithText("Doorgaan").performClick()
        compose.onNodeWithText("Twee scoreborden").performClick()
        compose.onNodeWithText("Terug").performClick()
        compose.onNodeWithText("Hoe staat dit scherm?").assertIsDisplayed()
        compose.onNodeWithText("Doorgaan").performClick()
        compose.onNodeWithText("Opslaan en doorgaan").performClick()
        compose.runOnIdle { assertTrue(saved == DisplayLayout("landscape", 2)) }
    }
    @Test fun linkedHomeScreenOffersOneScoreboard() {
        var saved: DisplayLayout? = null
        compose.setContent { MaterialTheme { LayoutWizard(LayoutSetup(DisplayLayout("landscape", 1), true, allowDual = false), { saved = it }, {}, {}) } }
        compose.onNodeWithText("Doorgaan").performClick()
        compose.onNodeWithText("Eén scorebord").assertIsDisplayed()
        compose.onNodeWithText("Twee scoreborden").assertDoesNotExist()
        compose.onNodeWithText("Opslaan en doorgaan").performClick()
        compose.runOnIdle { assertTrue(saved == DisplayLayout("landscape", 1)) }
    }
    @Test fun singlePanelRetainsUnavailableAssignmentStatus() {
        val snapshot = DisplaySnapshot("unassigned",0,"event",0,"TV","TV","location",null,null,null,null,layout = DisplayLayout("landscape",1),panels = listOf(DisplayPanel("left","removed-board","unavailable",null)))
        compose.setContent { MaterialTheme { OcheApp(ConnectionState(DisplayUi.Screen(snapshot,0,SystemClock.elapsedRealtime())),{}) } }
        compose.onNodeWithText("Baan niet beschikbaar").assertIsDisplayed()
        compose.onNodeWithText("Nog geen baan toegewezen").assertDoesNotExist()
    }
    @Test fun missingRightBoardKeepsLeftMatchAndOfflineRemovesEveryPlayQr() {
        val match = Match("left", 1, "live", listOf(Player("Links Danny",148,0,0,null,0,0),Player("Links Rick",188,0,0,null,0,0)),0,501,1,1,emptyList(),emptyList(),"left-session")
        val left = DisplaySnapshot("live",0,"left-event",1,"Baan links","TV","location",null,null,match,null)
        val free = DisplaySnapshot("standby",0,"right-event",1,"Baan rechts","TV","location",BuildConfig.API_ORIGIN + "/baan/right/",null,null,null)
        val snapshot = left.copy(layout = DisplayLayout("landscape",2), panels = listOf(DisplayPanel("left","left","ready",left),DisplayPanel("right",null,"unassigned",null)))
        val connection = mutableStateOf(ConnectionState(DisplayUi.Screen(snapshot,0,SystemClock.elapsedRealtime())))
        compose.setContent { MaterialTheme { OcheApp(connection.value,{}) } }
        compose.onNodeWithText("Links Danny").assertIsDisplayed()
        compose.onNodeWithText("Nog geen baan toegewezen").assertIsDisplayed()
        compose.runOnIdle { connection.value = ConnectionState(DisplayUi.Screen(snapshot.copy(panels = listOf(DisplayPanel("left","left","ready",left),DisplayPanel("right","right","ready",free))),0,SystemClock.elapsedRealtime()),offline = true) }
        compose.onNodeWithText("148").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("QR-code").assertCountEquals(0)
    }
    @Test fun dualCardsArePortraitWithFixedLaneDirectionsAndAFreeQr() {
        val left = DisplaySnapshot("live",0,"left",1,"Baan 1","TV","location",null,null,Match("left",1,"live",listOf(Player("Danny",148,0,0,null,0,0),Player("Rick",188,0,0,null,0,0)),0,501,1,1,emptyList(),emptyList(),"left"),null)
        val right = DisplaySnapshot("standby",0,"right",1,"Baan 2","TV","location",BuildConfig.API_ORIGIN + "/baan/right/",null,null,null)
        val snapshot = left.copy(layout = DisplayLayout("landscape",2),panels = listOf(DisplayPanel("left","left","ready",left),DisplayPanel("right","right","ready",right)))
        compose.setContent { MaterialTheme { OcheApp(ConnectionState(DisplayUi.Screen(snapshot,0,SystemClock.elapsedRealtime())),{}) } }
        compose.onNodeWithText("← Baan 1").assertIsDisplayed()
        compose.onNodeWithText("Baan 2 →").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("QR-code").assertCountEquals(1)
        val leftCard = compose.onNodeWithContentDescription("Scorebord links · 9:16").fetchSemanticsNode().boundsInRoot
        val rightCard = compose.onNodeWithContentDescription("Scorebord rechts · 9:16").fetchSemanticsNode().boundsInRoot
        assertTrue(kotlin.math.abs(leftCard.width / leftCard.height - 9f / 16f) < .01f)
        assertTrue(kotlin.math.abs(rightCard.width / rightCard.height - 9f / 16f) < .01f)
        assertTrue(leftCard.right < rightCard.left)
    }
    @Test fun waitingLobbyQrIsAvailableOnlyWhilePublicAndOnline() {
        val waiting = DisplaySnapshot("waiting",0,"waiting",1,"Baan lobby","TV","location",BuildConfig.API_ORIGIN + "/baan/lobby",null,null,null)
        val connection = mutableStateOf(ConnectionState(DisplayUi.Screen(waiting,0,SystemClock.elapsedRealtime())))
        compose.setContent { MaterialTheme { OcheApp(connection.value,{}) } }
        compose.onNodeWithText("SCAN EN SLUIT AAN").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("QR-code").assertCountEquals(1)
        compose.runOnIdle { connection.value = ConnectionState(DisplayUi.Screen(waiting.copy(playUrl = null),0,SystemClock.elapsedRealtime())) }
        compose.onAllNodesWithContentDescription("QR-code").assertCountEquals(0)
        compose.runOnIdle { connection.value = ConnectionState(DisplayUi.Screen(waiting.copy(state = "reserved"),0,SystemClock.elapsedRealtime())) }
        compose.onAllNodesWithContentDescription("QR-code").assertCountEquals(0)
        compose.runOnIdle { connection.value = ConnectionState(DisplayUi.Screen(waiting,0,SystemClock.elapsedRealtime()),offline = true) }
        compose.onAllNodesWithContentDescription("QR-code").assertCountEquals(0)
    }
    @Test fun bullWaitsForActualPhoneConfirmationWithoutShowingAScoreTurn() {
        val match = Match("bull-match", 3, "ready", listOf(Player("Danny",501,0,0,null,0,0),Player("Rick",501,0,0,null,0,0)), 0, 501, 1, 1, emptyList(), emptyList(), "bull-session", bull = Bull("match", "confirming", 1, listOf(0,1), listOf(Triple(1,0,"DB"),Triple(1,1,"SB")), 0, listOf(false,false)))
        compose.setContent { MaterialTheme { Box(Modifier.fillMaxWidth().height(330.dp)) { LiveView(match, false, false) } } }
        compose.onNodeWithText("BULL · GEEN SCORE").assertIsDisplayed()
        compose.onNodeWithText("Danny begint · bevestig op telefoon").assertIsDisplayed()
        compose.onNodeWithText("SCOREKAART").assertIsDisplayed()
    }
    @Test fun pairingHasCodeAndNativeNewCodeAction() {
        var pressed=false
        compose.setContent { MaterialTheme { OcheApp(ConnectionState(DisplayUi.Pairing("K8G4–P7RW", "https://dartflow.nl/koppel-scherm#code=K8G4P7RW", 600000, 0, SystemClock.elapsedRealtime())), { pressed=true }) } }
        compose.onNodeWithText("K8G4–P7RW").assertIsDisplayed()
        compose.onNodeWithText("Nieuwe code").performClick()
        assertTrue(pressed)
    }
    @Test fun liveScorecardShowsBothPlayersAndMirroredScore() {
        val match=Match("fixture-match",1,"live",listOf(Player("Danny",148,0,0,70.6,0,0),Player("Rick",188,0,0,62.6,0,0)),0,501,1,1,listOf(Visit(0,60,88,false)),emptyList(),"fixture-session")
        val snapshot=DisplaySnapshot("live",0,"event1",1,"Baan 1","Fixture","location",null,null,match,null)
        compose.setContent { MaterialTheme { OcheApp(ConnectionState(DisplayUi.Screen(snapshot,0,SystemClock.elapsedRealtime())), {}) } }
        compose.onNodeWithText("Danny").assertIsDisplayed()
        compose.onNodeWithText("Rick").assertIsDisplayed()
        compose.onNodeWithText("SCOREKAART").assertIsDisplayed()
        compose.onNodeWithText("148").assertIsDisplayed()
        compose.onNodeWithText("188").assertIsDisplayed()
    }
    @Test fun revokedScreenHasExplicitRepairAction() {
        compose.setContent { MaterialTheme { OcheApp(ConnectionState(DisplayUi.Disconnected("Koppel het scherm opnieuw.")), {}) } }
        compose.onNodeWithText("Nieuwe code").assertIsDisplayed()
    }
    @Test fun pausedMatchKeepsScoresAndSuppressesExpiredActivityWarning() {
        val match=Match("fixture-match",2,"live",listOf(Player("Danny",148,0,0,70.6,0,0),Player("Rick",188,0,0,62.6,0,0)),0,501,1,1,emptyList(),emptyList(),"fixture-session",paused=true)
        val snapshot=DisplaySnapshot("warning",180000,"event2",2,"Baan 1","Fixture","location",null,null,match,Activity(120000,180000,0))
        compose.setContent { MaterialTheme { OcheApp(ConnectionState(DisplayUi.Screen(snapshot,180000,SystemClock.elapsedRealtime())), {}) } }
        compose.onNodeWithText("Gepauzeerd").assertIsDisplayed()
        compose.onNodeWithText("148").assertIsDisplayed()
        compose.onNodeWithText("188").assertIsDisplayed()
        compose.onNodeWithText("BAAN WORDT VRIJGEGEVEN").assertDoesNotExist()
        compose.onNodeWithText("AAN DE BEURT").assertDoesNotExist()
    }
    @Test fun provisionalResultShowsServerWinnerAndRequiresConfirmation() {
        val match=Match("fixture-match",3,"result",listOf(Player("Danny",0,1,0,70.6,0,0),Player("Rick",188,0,0,62.6,0,0)),0,501,1,1,emptyList(),emptyList(),"fixture-session",winnerName="Danny")
        val snapshot=DisplaySnapshot("result",0,"event3",3,"Baan 1","Fixture","location",null,null,match,null)
        compose.setContent { MaterialTheme { OcheApp(ConnectionState(DisplayUi.Screen(snapshot,0,SystemClock.elapsedRealtime())), {}) } }
        compose.onNodeWithText("Voorlopige uitslag").assertIsDisplayed()
        compose.onNodeWithText("Winnaar: Danny").assertIsDisplayed()
        compose.onNodeWithText("Uitslag bevestigd").assertDoesNotExist()
    }
    @Test fun cachedRestartShowsLastScoresWithoutReplayingExpiredCountdown() {
        val match=Match("fixture-match",4,"live",listOf(Player("Danny",148,0,0,70.6,0,0),Player("Rick",188,0,0,62.6,0,0)),0,501,1,1,emptyList(),emptyList(),"fixture-session")
        val snapshot=DisplaySnapshot("warning",180000,"event4",4,"Baan 1","Fixture","location",null,null,match,Activity(120000,180000,0))
        compose.setContent { MaterialTheme { OcheApp(ConnectionState(DisplayUi.Screen(snapshot,180000,SystemClock.elapsedRealtime(),cached=true),offline=true), {}) } }
        compose.onNodeWithText("OFFLINE",substring=true).assertIsDisplayed()
        compose.onNodeWithText("148").assertIsDisplayed()
        compose.onNodeWithText("188").assertIsDisplayed()
        compose.onNodeWithText("BAAN WORDT VRIJGEGEVEN").assertDoesNotExist()
    }
    @Test fun alternateRulesShowEachRealStartingScoreInTheMirroredCard() {
        val match=Match("fixture-match",5,"live",listOf(Player("Danny",148,0,0,70.6,0,0),Player("Rick",188,0,0,62.6,0,0)),0,501,1,1,emptyList(),emptyList(),"fixture-session",inRule="double",outRule="master",sideStartScores=listOf(301,701))
        val snapshot=DisplaySnapshot("live",0,"event5",5,"Baan 1","Fixture","location",null,null,match,null,theme="onzetrots",encounter=Encounter("Landelijke teams","Team Zee","Team Duin",listOf(3,2),listOf(13,11),5,"Koppel 2"))
        compose.setContent { MaterialTheme { OcheApp(ConnectionState(DisplayUi.Screen(snapshot,0,SystemClock.elapsedRealtime())), {}) } }
        compose.onNodeWithContentDescription("Onze Trots").assertIsDisplayed()
        compose.onNodeWithText("Team Zee  3–2  Team Duin").assertIsDisplayed()
        compose.onNodeWithText("Werkelijke legs 13–11 · onderdeel 6: Koppel 2").assertIsDisplayed()
        compose.onNodeWithText("Powered by DartFlow").assertIsDisplayed()
        compose.onNodeWithText("Dubbel in · Master uit").assertIsDisplayed()
        compose.onNodeWithText("301 / 701").assertIsDisplayed()
        compose.onNodeWithText("301").assertIsDisplayed()
        compose.onNodeWithText("701").assertIsDisplayed()
    }
    @Test fun shortScoreViewportKeepsWinnerAndHandicapsVisibleInBothLayouts() {
        val landscape = mutableStateOf(true)
        val match = Match("short-result", 6, "result", listOf(Player("Danny", 0, 1, 0, 70.6, 0, 0), Player("Rick", 188, 0, 0, 62.6, 0, 0)), 0, 501, 1, 1, emptyList(), emptyList(), "short-session", winnerName = "Danny", sideStartScores = listOf(301, 701))
        compose.setContent { MaterialTheme { Box(Modifier.fillMaxWidth().height(330.dp)) { LiveView(match, landscape.value, true) } } }
        compose.onNodeWithText("Winnaar: Danny").assertIsDisplayed()
        compose.onNodeWithText("SCOREKAART").assertIsDisplayed()
        compose.runOnIdle { landscape.value = false }
        compose.onNodeWithText("Winnaar: Danny").assertIsDisplayed()
        compose.onNodeWithText("301").assertIsDisplayed()
        compose.onNodeWithText("701").assertIsDisplayed()
    }
}
