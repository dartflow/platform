package nl.dartflow.app

import android.graphics.Bitmap
import android.os.Build
import android.os.ParcelFileDescriptor
import android.view.KeyEvent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
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
        var input=JSONObject();var commands=0;val session=session("x01")
        session.rules.put("inRule","double");session.progress.getJSONArray("opened").put(0,false).put(1,false)
        val current=mutableStateOf(PlayerUiState(screen=PlayerScreen.PLAY_SESSION,loading=false,play=PlayerPlayUi(session=session,canonical=session)))
        compose.setContent{Box(Modifier.requiredSize(390.dp,844.dp).testTag("play-fullscreen-fixture")){val density=LocalDensity.current.density;CompositionLocalProvider(LocalDensity provides Density(density,1.3f)){DartFlowPlayerTheme{PlayerApp(current.value,PlayerActions(playAction={commands++;input=it.obj("input")}))}}}}
        compose.onNodeWithTag("native-score-console").assertIsDisplayed()
        compose.onNodeWithTag("score-player-remaining-0").assertTextEquals("501")
        compose.onNodeWithText("Beoogd doel voor de volgende pijl (optioneel)").assertDoesNotExist()
        (1..20).forEach { target ->
            val node=compose.onNodeWithTag("dart-target-$target").assertIsDisplayed()
            val bounds=node.getUnclippedBoundsInRoot()
            assertTrue("Every target remains at least 48 dp wide and high",bounds.right-bounds.left>=48.dp&&bounds.bottom-bounds.top>=48.dp)
            val layouts=mutableListOf<TextLayoutResult>();node.performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(layouts)}
            assertEquals(1,layouts.size);assertEquals(1,layouts.single().lineCount);assertFalse("Target S$target must never wrap or clip",layouts.single().hasVisualOverflow)
        }
        compose.onNodeWithText("S20").performClick();compose.onNodeWithText("S19").performClick()
        captureScoreFixture("score-practice-darts-large-font.png")
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        compose.onNodeWithTag("native-score-console").assertDoesNotExist()
        compose.onNodeWithText("Open score-invoer").performScrollTo().performClick()
        compose.onNodeWithText("S20 · S19").assertIsDisplayed()
        compose.runOnIdle{assertEquals("Back and reopen cannot submit a visit",0,commands)}
        compose.onNodeWithText("Verwerk 2 pijl(en)").assertIsDisplayed().performClick()
        compose.runOnIdle{assertEquals(listOf("S20","S19"),input.optJSONArray("dartHits")!!.strings());assertTrue(input.getJSONArray("intendedTargets").isNull(0));assertTrue(input.getJSONArray("intendedTargets").isNull(1));assertFalse(input.has("score"))}
        // A failed request does not throw away the unconfirmed observed darts.
        compose.onNodeWithText("S20 · S19").assertIsDisplayed()
        compose.onNodeWithText("‹ Terug").performClick()
        compose.runOnIdle{val accepted=PlayerPlayEngine.project(session,input);current.value=current.value.copy(play=PlayerPlayUi(session=accepted,canonical=accepted))}
        compose.onNodeWithText("Open score-invoer").performScrollTo().performClick()
        compose.onNodeWithText("S20 · S19").assertDoesNotExist()
        compose.runOnIdle{assertEquals(1,commands)}
        compose.runOnIdle{
            val bingo=this.session("bingo");bingo.raw.put("id","synthetic-four-side-bingo")
            bingo.game.put("progress",json("mode" to "bingo","cardCode" to "SYNTHETIC","card" to JSONArray((1..9).toList()),"filled" to JSONArray(List(4){JSONArray(List(9){false})}),"darts" to JSONArray(List(4){0})))
            (3..4).forEach { side -> bingo.raw.getJSONArray("participants").put(json("id" to "player-$side","name" to "Speler $side"));bingo.game.getJSONArray("sides").put(json("id" to "side-$side","playerIds" to JSONArray(listOf("player-$side")))) }
            bingo.progress.put("card",JSONArray((1..9).toList())).put("filled",JSONArray(List(4){JSONArray(List(9){false})})).put("darts",JSONArray(listOf(0,0,0,0)))
            current.value=current.value.copy(play=PlayerPlayUi(session=bingo,canonical=bingo))
        }
        (0..3).forEach { side ->
            compose.onNodeWithTag("score-player-card-$side").assertIsDisplayed()
            val layouts=mutableListOf<TextLayoutResult>();compose.onNodeWithTag("score-player-status-$side").performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(layouts)}
            assertEquals(1,layouts.size);assertFalse("Four-side status remains readable at enlarged text",layouts.single().hasVisualOverflow)
        }
        compose.onNodeWithText("Scorekaart & correctie").performClick()
        (0..8).forEach { cell -> compose.onNodeWithTag("bingo-0-$cell").assertExists() }
        compose.onNodeWithText("Gereed").performClick()
        // Four-way bingo keeps every side readable; the real card remains available beside scoring.
        compose.runOnIdle{
            val bingo=session("bingo");bingo.raw.put("id","synthetic-bingo")
            bingo.raw.put("participants",JSONArray(listOf(json("id" to "one","name" to "Noor"),json("id" to "two","name" to "Rick"),json("id" to "three","name" to "Kim"),json("id" to "four","name" to "Pim"))))
            bingo.game.put("sides",JSONArray(listOf("one","two","three","four").map{json("id" to "side-$it","playerIds" to JSONArray(listOf(it)))}))
            bingo.game.put("progress",json("cardCode" to "SYNTHETIC","card" to JSONArray((1..9).toList()),"filled" to JSONArray(List(4){JSONArray(List(9){false})}),"darts" to JSONArray(List(4){0})))
            current.value=current.value.copy(play=PlayerPlayUi(session=bingo,canonical=bingo))
        }
        (0..3).forEach{side->
            val node=compose.onNodeWithTag("score-player-status-$side").assertIsDisplayed()
            val layouts=mutableListOf<TextLayoutResult>();node.performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(layouts)}
            assertFalse("Four-player turn labels must remain readable",layouts.single().hasVisualOverflow)
        }
        compose.onNodeWithText("Scorekaart & correctie").performClick()
        (0..8).forEach{compose.onNodeWithTag("bingo-0-$it").assertExists()}
        compose.onNodeWithText("Gereed").performClick()
        compose.onNodeWithTag("dart-target-1").assertIsDisplayed()

    }
    @Test fun tacticsHasTwelveTargetsAndFiveMarkCounts() {
        val fullscreen=mutableStateOf(false);var input=JSONObject();val current=session("tactics")
        compose.setContent{DartFlowPlayerTheme{if(fullscreen.value)PlayerApp(PlayerUiState(screen=PlayerScreen.PLAY_SESSION,loading=false,play=PlayerPlayUi(session=current,canonical=current)),PlayerActions(playAction={input=it.obj("input")}))else Column(Modifier.verticalScroll(rememberScrollState())){PlayerPlayGameView(current)}}}
        compose.onNodeWithText("10").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Bull").performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("0/5").assertCountEquals(24)
        compose.runOnIdle{fullscreen.value=true}
        compose.onNodeWithTag("native-score-console").assertIsDisplayed()
        compose.onNodeWithText("Scorekaart & correctie").performClick()
        compose.onAllNodesWithText("0/5").assertCountEquals(24)
        compose.onNodeWithText("Gereed").performClick()
        compose.onNodeWithText("Triple").performScrollTo().performClick()
        compose.onNodeWithTag("dart-target-20").performScrollTo().performClick()
        compose.onNodeWithTag("confirm-play-dart-hits").performScrollTo().performClick()
        compose.runOnIdle{assertEquals(listOf("T20"),input.optJSONArray("dartHits")!!.strings());assertFalse(input.has("score"))}
    }
    @Test fun unknownRuleVersionBlocksInputWithUpdateMessage() {
        val current=session("x01");current.rules.put("version",2)
        compose.setContent{DartFlowPlayerTheme{PlayerApp(PlayerUiState(screen=PlayerScreen.PLAY_SESSION,loading=false,play=PlayerPlayUi(session=current,canonical=current)),PlayerActions())}}
        compose.onNodeWithText("Deze spelvorm of regelversie wordt niet ondersteund. Werk DartFlow bij voordat je deze partij bedient.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Registreer de geworpen pijlen").assertDoesNotExist()
        compose.onNodeWithTag("native-score-console").assertDoesNotExist()
        compose.onNodeWithTag("dart-target-1").assertDoesNotExist()
        compose.onNodeWithTag("score-key-1").assertDoesNotExist()
    }
    @Test fun provisionalQueueIsLabeledAndCannotGrantManagementControls() {
        var command=JSONObject();val session=session("x01");session.permissions.put("canScore",false)
        val current=mutableStateOf(PlayerUiState(screen=PlayerScreen.PLAY_SESSION,loading=false,play=PlayerPlayUi(session=session,canonical=session,pending=2,offline=true)))
        compose.setContent{Box(Modifier.requiredSize(360.dp,640.dp).testTag("play-fullscreen-fixture")){DartFlowPlayerTheme{PlayerApp(current.value,PlayerActions(playAction={command=it}))}}}
        compose.onNodeWithTag("native-score-console").assertIsDisplayed()
        compose.onNodeWithTag("score-key-1").assertIsNotEnabled()
        compose.onNodeWithTag("confirm-score").assertIsNotEnabled()
        compose.onNodeWithText("Wacht op verbinding · 2 beurt(en) lokaal bewaard · voorlopig").assertIsDisplayed()
        compose.onNodeWithText("Schrijver, baan & onderbreken").assertDoesNotExist()
        compose.onNodeWithText("Privélinks per deelnemer").assertDoesNotExist()
        compose.onNodeWithText("‹ Terug").performClick()
        compose.onNodeWithText("Wacht op verbinding · 2 beurt(en) · lokaal voorlopig").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Schrijver, baan & onderbreken").assertDoesNotExist()
        compose.onNodeWithText("Privélinks per deelnemer").assertDoesNotExist()
        compose.onNodeWithText("Open score-invoer").performScrollTo().performClick()
        compose.onNodeWithTag("score-key-1").assertIsNotEnabled()
        compose.runOnIdle{val ready=this.session("x01");current.value=current.value.copy(play=PlayerPlayUi(session=ready,canonical=ready))}
        compose.onNodeWithTag("score-key-6").performClick();compose.onNodeWithTag("score-key-0").performClick()
        compose.onNodeWithText("‹ Terug").performClick()
        compose.onNodeWithText("Open score-invoer").performScrollTo().performClick()
        compose.onNodeWithTag("entered-score").assertTextEquals("60")
        compose.onNodeWithTag("toggle-dart-entry").performClick()
        compose.onNodeWithTag("dart-target-20").performScrollTo().performClick()
        compose.onNodeWithTag("toggle-dart-entry").performClick()
        compose.onNodeWithTag("entered-score").assertTextEquals("60")
        compose.onNodeWithTag("toggle-dart-entry").performClick()
        compose.onNodeWithTag("entered-dart-hits").assertTextEquals("S20").assertIsDisplayed()
        compose.onNodeWithTag("toggle-dart-entry").performClick()
        captureScoreFixture("score-practice-total-compact.png")
        compose.onNodeWithTag("confirm-score").assertIsDisplayed().performClick()
        compose.runOnIdle{val input=command.obj("input");assertEquals("session.score",command.text("type"));assertEquals(60,input.optInt("score"));assertFalse("Unmeasured actual dart count stays unknown",input.has("darts"));assertFalse(input.has("dartHits"));assertFalse(input.has("doubleAttempts"))}
        // Uncertain management operations pause the same scorer instead of discarding a pending operation.
        compose.runOnIdle{current.value=current.value.copy(play=current.value.play.copy(pendingOperation="session.transfer"))}
        compose.onNodeWithTag("score-key-1").assertIsNotEnabled()
        compose.onNodeWithTag("confirm-score").assertIsNotEnabled()
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
    private fun captureScoreFixture(filename:String) {
        require(filename in setOf("score-practice-darts-large-font.png","score-practice-total-compact.png"))
        if(Build.VERSION.SDK_INT<Build.VERSION_CODES.S)return
        val node=compose.onNodeWithTag("play-fullscreen-fixture")
        val bounds=node.getUnclippedBoundsInRoot();val root=compose.onRoot().getUnclippedBoundsInRoot()
        assertTrue(bounds.left>=root.left&&bounds.right<=root.right&&bounds.top>=root.top&&bounds.bottom<=root.bottom)
        val image=node.captureToImage().asAndroidBitmap()
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        val directory="/data/local/tmp/dartflow-ui-fixtures"
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p $directory")).use{it.readBytes()}
        val descriptors=automation.executeShellCommandRw("dd of=$directory/$filename")
        ParcelFileDescriptor.AutoCloseInputStream(descriptors[0]).use{completion->
            ParcelFileDescriptor.AutoCloseOutputStream(descriptors[1]).use{output->assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,output))}
            assertTrue(completion.readBytes().isEmpty())
        }
    }
    private fun session(mode:String):PlayerPlaySession {
        val rules=playerPlayDefaultRules(mode,501);val targets=(20 downTo 10).toList()+25
        val progress=if(mode=="tactics")json("mode" to mode,"targets" to JSONArray(targets),"requiredMarks" to 5,"marks" to JSONArray(List(2){JSONArray(List(12){0})}),"points" to JSONArray(listOf(0,0)),"creditedMarks" to JSONArray(listOf(0,0)))else json("mode" to mode,"remaining" to JSONArray(listOf(501,501)),"opened" to JSONArray(listOf(true,true)))
        return PlayerPlaySession(json("id" to "synthetic-play","revision" to 1,"status" to "active","deviceMode" to "shared","rules" to rules,"participants" to JSONArray(listOf(json("id" to "one","name" to "Noor"),json("id" to "two","name" to "Rick"))),"permissions" to json("canScore" to true),"game" to json("rules" to rules,"ruleVersion" to 1,"status" to "live","turn" to 0,"currentThrowerId" to "one","set" to 1,"leg" to 1,"attempt" to 1,"starter" to 0,"legs" to JSONArray(listOf(0,0)),"sets" to JSONArray(listOf(0,0)),"attempts" to JSONArray(),"visits" to JSONArray(),"sides" to JSONArray(listOf(json("id" to "side-one","playerIds" to JSONArray(listOf("one"))),json("id" to "side-two","playerIds" to JSONArray(listOf("two"))))),"progress" to progress)))
    }
}
