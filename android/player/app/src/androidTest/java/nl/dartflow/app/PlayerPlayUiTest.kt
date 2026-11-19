package nl.dartflow.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class PlayerPlayUiTest {
    @get:Rule val compose=createComposeRule()
    @Test fun guestCanReviewAndCreate301WithoutLoginOrAccountImpersonation() {
        var command=JSONObject()
        val current=mutableStateOf(PlayerUiState(screen=PlayerScreen.PLAY_START,loading=false))
        compose.setContent{DartFlowPlayerTheme{PlayerApp(current.value,PlayerActions(playAction={command=it},platformAction={command=it}))}}
        compose.onNodeWithText("Voornaam speler 1").performScrollTo().performTextInput("Noor")
        compose.onNodeWithText("Voornaam speler 2").performScrollTo().performTextInput("Rick")
        compose.onNodeWithText("Controleer partij").performScrollTo().performClick()
        compose.onNodeWithText("Controle vóór de eerste pijl").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Start deze partij").performScrollTo().performClick()
        compose.runOnIdle{assertEquals("session.create",command.text("type"));assertEquals("double",command.obj("rules").text("inRule"));assertEquals(301,command.obj("rules").optInt("startScore"));assertEquals(listOf("Noor","Rick"),command.rows("players").map{it.text("name")});assertFalse(command.toString().contains("accountId"))}
        compose.runOnIdle{current.value=PlayerUiState(screen=PlayerScreen.PLAY,session=PlayerSession("one","fixture@example.test",Long.MAX_VALUE),loading=false)}
        compose.onNodeWithText("501").performScrollTo().performClick();compose.onNodeWithText("301").performClick()
        compose.onNodeWithText("Dubbel in").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Start training").performScrollTo().performClick()
        compose.runOnIdle{assertEquals("training.create",command.text("type"));assertEquals(301,command.optInt("startScore"));assertEquals("double",command.text("inRule"))}
        compose.onNodeWithText("Dubbel in").performScrollTo().performClick();compose.onNodeWithText("Single in").performClick()
        compose.onNodeWithText("301").performScrollTo().performClick();compose.onNodeWithText("501").performClick()
        compose.onNodeWithText("501").performScrollTo().performClick();compose.onNodeWithText("301").performClick()
        compose.onNodeWithText("Start training").performScrollTo().performClick()
        compose.runOnIdle{assertEquals("single",command.text("inRule"))}
        compose.onNodeWithText("Solo trainen").performScrollTo().performClick();compose.onNodeWithText("Tegen de bot").performClick()
        compose.onNodeWithText("Dubbel in").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Start training").performScrollTo().performClick()
        compose.runOnIdle{assertEquals("bot",command.text("mode"));assertEquals(301,command.optInt("startScore"));assertEquals("double",command.text("inRule"))}
    }
    @Test fun actualDartsAndExplicitUnknownTargetsAreSubmittedInOrder() {
        var input=JSONObject();val session=session("x01")
        compose.setContent{DartFlowPlayerTheme{Column(Modifier.verticalScroll(rememberScrollState())){PlayerPlayDartEntry(session,true){input=it}}}}
        compose.onNodeWithText("S20").performScrollTo().performClick()
        compose.onNodeWithText("S19").performScrollTo().performClick()
        compose.onNodeWithText("Verwerk 2 pijl(en)").performScrollTo().performClick()
        compose.runOnIdle{assertEquals(listOf("S20","S19"),input.optJSONArray("dartHits")!!.strings());assertTrue(input.getJSONArray("intendedTargets").isNull(0));assertTrue(input.getJSONArray("intendedTargets").isNull(1))}
    }
    @Test fun tacticsHasTwelveTargetsAndFiveMarkCounts() {
        compose.setContent{DartFlowPlayerTheme{Column(Modifier.verticalScroll(rememberScrollState())){PlayerPlayGameView(session("tactics"))}}}
        compose.onNodeWithText("10").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Bull").performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("0/5").assertCountEquals(24)
    }
    @Test fun unknownRuleVersionBlocksInputWithUpdateMessage() {
        val current=session("x01");current.rules.put("version",2)
        compose.setContent{DartFlowPlayerTheme{PlayerApp(PlayerUiState(screen=PlayerScreen.PLAY_SESSION,loading=false,play=PlayerPlayUi(session=current,canonical=current)),PlayerActions())}}
        compose.onNodeWithText("Deze spelvorm of regelversie wordt niet ondersteund. Werk DartFlow bij voordat je deze partij bedient.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Registreer de geworpen pijlen").assertDoesNotExist()
    }
    @Test fun provisionalQueueIsLabeledAndCannotGrantManagementControls() {
        val current=session("x01");current.permissions.put("canScore",false)
        compose.setContent{DartFlowPlayerTheme{PlayerApp(PlayerUiState(screen=PlayerScreen.PLAY_SESSION,loading=false,play=PlayerPlayUi(session=current,canonical=current,pending=2,offline=true)),PlayerActions())}}
        compose.onNodeWithText("Wacht op verbinding · 2 beurt(en) · lokaal voorlopig").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Schrijver, baan & onderbreken").assertDoesNotExist()
        compose.onNodeWithText("Privélinks per deelnemer").assertDoesNotExist()
    }
    @Test fun playStatisticsKeepsSourceCohortsSeparateAndUnknownMeasurementsVisible(){
        val rules=json("version" to 1,"mode" to "x01","startScore" to 301,"inRule" to "double","outRule" to "double","bestOfLegs" to 1,"bestOfSets" to 1,"teamSizes" to JSONArray(listOf(1,1)))
        val group=json("id" to "synthetic-group","mode" to "x01","source" to "free","rules" to rules,"sessions" to 1,"visits" to 4,"darts" to null,"countingDarts" to 12,"points" to 180,"average" to 45.0,"doubleAttempts" to null)
        val state=PlayerUiState(screen=PlayerScreen.PLAY_HISTORY,activeId="statistics:",session=PlayerSession("one","fixture@example.test",Long.MAX_VALUE),loading=false,play=PlayerPlayUi(auxiliary=json("filters" to JSONObject(),"definitions" to JSONArray(listOf("Geen officiële rankingmenging.")),"groups" to JSONArray(listOf(group)),"rows" to JSONArray())))
        compose.setContent{DartFlowPlayerTheme{PlayerApp(state,PlayerActions())}}
        compose.onNodeWithText("301 / 501 / 701 · Vrij spel").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("4 beurten · pijlaantal onbekend").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("AVG 45,00").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Dubbelpogingen en dubbelpercentage onbekend").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("MPR 45,00").assertDoesNotExist()
    }
    private fun session(mode:String):PlayerPlaySession {
        val rules=playerPlayDefaultRules(mode,501);val targets=(20 downTo 10).toList()+25
        val progress=if(mode=="tactics")json("mode" to mode,"targets" to JSONArray(targets),"requiredMarks" to 5,"marks" to JSONArray(List(2){JSONArray(List(12){0})}),"points" to JSONArray(listOf(0,0)),"creditedMarks" to JSONArray(listOf(0,0)))else json("mode" to mode,"remaining" to JSONArray(listOf(501,501)),"opened" to JSONArray(listOf(true,true)))
        return PlayerPlaySession(json("id" to "synthetic-play","revision" to 1,"status" to "active","deviceMode" to "shared","rules" to rules,"participants" to JSONArray(listOf(json("id" to "one","name" to "Noor"),json("id" to "two","name" to "Rick"))),"permissions" to json("canScore" to true),"game" to json("rules" to rules,"ruleVersion" to 1,"status" to "live","turn" to 0,"currentThrowerId" to "one","set" to 1,"leg" to 1,"attempt" to 1,"starter" to 0,"legs" to JSONArray(listOf(0,0)),"sets" to JSONArray(listOf(0,0)),"attempts" to JSONArray(),"visits" to JSONArray(),"sides" to JSONArray(listOf(json("id" to "side-one","playerIds" to JSONArray(listOf("one"))),json("id" to "side-two","playerIds" to JSONArray(listOf("two"))))),"progress" to progress)))
    }
}
