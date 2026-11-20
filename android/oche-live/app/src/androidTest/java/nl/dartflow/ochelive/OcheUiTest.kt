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
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue

class OcheUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun competitionLobbyKeepsPublicConfirmationsAndJoiningQrVisibleInBothLayouts() {
        val landscape = mutableStateOf(false)
        val lobby = CompetitionLobby("Clubleague", 3, listOf("De Pijl" to true, "Noor" to false), "De Pijl", Long.MAX_VALUE)
        compose.setContent { MaterialTheme { Box(Modifier.fillMaxWidth().height(if (landscape.value) 240.dp else 480.dp)) { CompetitionLobbyView(lobby, "https://dartflow.nl/baan/synthetic-board", landscape.value) } } }
        compose.onNodeWithText("COMPETITIELOBBY").assertIsDisplayed()
        compose.onNodeWithText("De Pijl · bevestigd").assertIsDisplayed()
        compose.onNodeWithText("Noor · wacht op deelname").assertIsDisplayed()
        compose.onNodeWithContentDescription("QR-code").assertIsDisplayed()
        compose.runOnIdle { landscape.value = true }
        compose.onNodeWithText("Noor · wacht op deelname").assertIsDisplayed()
        compose.onNodeWithContentDescription("QR-code").assertIsDisplayed()
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
