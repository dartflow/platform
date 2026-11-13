package nl.dartflow.ochelive

import android.os.SystemClock
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue

class OcheUiTest {
    @get:Rule val compose = createComposeRule()
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
}
