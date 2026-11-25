package nl.dartflow.ochelive

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test

class PlayDisplayUiTest {
    @get:Rule val compose=createComposeRule()
    @Test fun tacticsShowsTwelfthBullRowAndFiveMarksInPortraitAndLandscape(){
        val landscape=mutableStateOf(false);val data=play("tactics");data.getJSONObject("game").getJSONObject("progress").put("targets",JSONArray((20 downTo 10).toList()+25)).put("requiredMarks",5).put("marks",JSONArray(List(2){JSONArray(List(12){4})})).put("points",JSONArray(listOf(100,90)))
        val frame=PlayDisplay.parse(data)
        compose.setContent{MaterialTheme{Box(Modifier.fillMaxWidth().height(if(landscape.value)330.dp else 610.dp)){PlayDisplayView(frame,landscape.value,0,false)}}}
        compose.onNodeWithText("TACTICS 5 · SET 1 · LEG 1").assertIsDisplayed();compose.onNodeWithText("10").assertIsDisplayed();compose.onNodeWithText("BULL").assertIsDisplayed();compose.onAllNodesWithText("4/5").assertCountEquals(24)
        compose.runOnIdle{landscape.value=true};compose.onNodeWithText("BULL").assertIsDisplayed();compose.onNodeWithText("PUNTEN").assertIsDisplayed()
    }
    @Test fun bingoShowsSameCardCodeAndAllNineDoubleSquares(){
        val data=play("bingo");data.getJSONObject("rules").put("win","line");data.getJSONObject("game").getJSONObject("progress").put("card",JSONArray((1..9).toList())).put("cardCode","DFB1-010203040506070809").put("filled",JSONArray(List(2){JSONArray(List(9){false})}))
        compose.setContent{MaterialTheme{Box(Modifier.fillMaxWidth().height(600.dp)){PlayDisplayView(PlayDisplay.parse(data),false,0,false)}}}
        compose.onNodeWithText("EERSTE LIJN · DFB1-010203040506070809").assertIsDisplayed();(1..9).forEach{compose.onAllNodesWithText("D$it").assertCountEquals(2);compose.onAllNodesWithText("D$it").onFirst().assertIsDisplayed()}
    }
    @Test fun freeX01KeepsExistingMirroredScorecardAndAcceptedVisitRows(){
        val data=play("x01");data.getJSONObject("rules").put("startScore",501).put("inRule","single").put("outRule","double")
        data.getJSONObject("game").put("legs",JSONArray(listOf(1,0))).put("sets",JSONArray(listOf(0,0))).put("visits",JSONArray(listOf(JSONObject().put("number",1).put("set",1).put("leg",1).put("sideId","a").put("throwerId","one").put("score",60).put("remainingAfter",441).put("countingDarts",3),JSONObject().put("number",2).put("set",1).put("leg",1).put("sideId","b").put("throwerId","two").put("score",100).put("remainingAfter",401).put("countingDarts",3))))
        data.getJSONObject("game").getJSONObject("progress").put("remaining",JSONArray(listOf(441,401)))
        compose.setContent{MaterialTheme{Box(Modifier.fillMaxWidth().height(600.dp)){PlayDisplayView(PlayDisplay.parse(data),false,0,false)}}}
        compose.onNodeWithText("Noor").assertIsDisplayed();compose.onNodeWithText("Rick").assertIsDisplayed()
        compose.onAllNodesWithText("441").onFirst().assertIsDisplayed();compose.onNodeWithText("60").assertIsDisplayed();compose.onNodeWithText("100").assertIsDisplayed()
    }
    @Test fun unknownModeDisplaysUpdateWithoutInventedRestScore(){
        compose.setContent{MaterialTheme{Box(Modifier.fillMaxWidth().height(400.dp)){PlayDisplayView(PlayDisplay.parse(play("future")),false,0,false)}}}
        compose.onNodeWithText("WERK OCHE LIVE BIJ").assertIsDisplayed();compose.onNodeWithText("501").assertDoesNotExist()
    }
    private fun play(mode:String)=JSONObject().put("id","synthetic-play").put("version",1).put("status","active").put("rules",JSONObject().put("version",1).put("mode",mode).put("points",true)).put("participants",JSONArray(listOf(JSONObject().put("id","one").put("name","Noor"),JSONObject().put("id","two").put("name","Rick")))).put("game",JSONObject().put("ruleVersion",1).put("set",1).put("leg",1).put("turn",0).put("currentThrowerId","one").put("sides",JSONArray(listOf(JSONObject().put("id","a").put("playerIds",JSONArray(listOf("one"))),JSONObject().put("id","b").put("playerIds",JSONArray(listOf("two")))))).put("progress",JSONObject()))
}
