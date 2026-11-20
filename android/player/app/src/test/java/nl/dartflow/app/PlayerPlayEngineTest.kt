package nl.dartflow.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/** Shared golden examples originate in the canonical TypeScript engine, not the Kotlin implementation. */
@RunWith(Parameterized::class)
class PlayerPlayEngineTest(private val case: JSONObject) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{index}") fun cases(): List<Array<Any>> = JSONObject(PlayerPlayEngineTest::class.java.classLoader!!.getResourceAsStream("play-rules.json")!!.bufferedReader().readText()).rows("cases").map { arrayOf(it) }
    }
    @Test fun sequentialDartsUndoAndReplayMatchSharedGoldenOwnProgress() {
        val rawRules = case.obj("rules"); val rules = playerPlayDefaultRules(rawRules.text("mode", "x01"), rawRules.optInt("startScore",301)).also { r -> rawRules.keys().forEach { r.put(it, rawRules.get(it)) } }
        if (rules.text("mode") == "leg-challenge") { rules.obj("source").put("visitCount", rules.obj("source").rows("visits").size) }
        val initial = case.obj("initial"); if (rules.text("mode") == "leg-challenge" && !rules.has("comparison")) rules.put("comparison", initial.obj("progress").text("comparison")); val game = JSONObject(initial.toString()).put("id", case.text("id")).put("rules", rules).put("ruleVersion",1).put("sides", case.optJSONArray("sides")).put("starter",case.optInt("starter")).put("set",1).put("leg",1).put("visits",JSONArray()).put("attempts",JSONArray())
        var session = PlayerPlaySession(json("id" to case.text("id"), "revision" to 0, "rules" to rules, "game" to game, "participants" to JSONArray(case.rows("sides").flatMap { it.getJSONArray("playerIds").strings() }.map { json("id" to it, "name" to it) })))
        val undo = mutableListOf<PlayerPlaySession>()
        case.rows("steps").forEachIndexed { index, step ->
            val action = step.obj("action")
            session = when (action.text("type")) {
                "undo" -> undo.removeAt(undo.lastIndex)
                "restart" -> { undo.add(session); PlayerPlayEngine.restart(session) }
                else -> { undo.add(session); PlayerPlayEngine.project(session, action.obj("input")) }
            }
            val expected = step.obj("expected"); val actual = session.game
            expected.keys().forEach { key ->
                // Offline projections cannot reveal a future source throw; only an accepted server snapshot can.
                val want = expected.get(key); val got = actual.get(key)
                if (key == "progress" && rules.text("mode") == "leg-challenge") {
                    val expectedOwn = JSONObject(want.toString()).also { it.remove("revealedSourceVisits"); it.remove("sourceRemaining") }
                    val actualOwn = JSONObject(got.toString()).also { it.remove("revealedSourceVisits"); it.remove("sourceRemaining") }
                    assertEquals("${case.text("id")} step $index $key", normalized(expectedOwn), normalized(actualOwn))
                    assertEquals(0, session.progress.optInt("revealedSourceVisits"))
                } else if (key == "result" && rules.text("mode") == "leg-challenge" && want is JSONObject && got is JSONObject) {
                    assertEquals(want.text("kind"), got.text("kind")); assertEquals(want.opt("winnerSideId"), got.opt("winnerSideId"))
                } else assertEquals("${case.text("id")} step $index $key", normalized(want), normalized(got))
            }
        }
    }
    private fun normalized(value: Any?): String = when (value) { is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix="{", postfix="}") { "$it:${normalized(value.get(it))}" }; is JSONArray -> (0 until value.length()).joinToString(prefix="[",postfix="]") { normalized(value.get(it)) }; else -> value.toString() }
}

class PlayerPlaySafetyTest {
    private val id = "10000000-0000-4000-8000-000000000001"
    private val secret = "test-capability-only-123456789"
    @Test fun privateFragmentsStayScopedAndRedacted() {
        val link = PlayerPlayLink.parse("https://dartflow.nl/spelen/$id#claim=$secret", "https://dartflow.nl")!!
        assertEquals("claim", link.purpose); assertEquals(secret, link.token); assertFalse(link.toString().contains(secret))
        assertNull(PlayerPlayLink.parse("https://evil.example/spelen/$id#claim=$secret", "https://dartflow.nl"))
        assertNull(PlayerPlayLink.parse("https://dartflow.nl/spelen/$id?claim=$secret", "https://dartflow.nl"))
        assertNull(PlayerPlayLink.parse("https://dartflow.nl/spelen/$id#claim=$secret&controller=$secret", "https://dartflow.nl"))
        assertNull(PlayerPlayLink.parse("https://dartflow.nl/spelen/$id#claim=short", "https://dartflow.nl"))
    }
    @Test fun startDefaultsAreExplicitAndDifferentFor301() {
        assertEquals("double", playerPlayDefaultRules("x01",301).text("inRule"))
        assertEquals("single", playerPlayDefaultRules("x01",501).text("inRule"))
        assertEquals("single", playerPlayDefaultRules("x01",701).text("inRule"))
        assertEquals("double", playerFreshStartInRule(301))
        assertEquals("single", playerFreshStartInRule(501))
        assertEquals("single", playerFreshStartInRule(null))
        assertEquals("single", playerFreshStartInRule(301, "single"))
        val legacy = playerTrainingMatch(json("state" to json("mode" to "solo", "game" to json("startScore" to 301))), null)
        assertEquals("single", legacy.raw.obj("settings").text("inRule"))
        assertEquals(5, playerPlayDefaultRules("finish").optInt("attemptCount"))
        assertEquals("replay", playerPlayDefaultRules("tactics").text("tieRule"))
    }
    @Test fun unknownModeOrRuleVersionNeverFallsBackTo501() {
        assertFalse(PlayerPlaySession(json("rules" to json("mode" to "future", "version" to 1))).supported)
        assertFalse(PlayerPlaySession(json("rules" to json("mode" to "x01", "version" to 2))).supported)
    }
    @Test fun finishRoutesUseRemainingDartsAndActualOutRule() {
        assertEquals(listOf("DB"), playerPlayFinishRoutes(50,1,"double").first())
        assertTrue(playerPlayFinishRoutes(169,3,"double").isEmpty())
        assertTrue(playerPlayFinishRoutes(20,1,"double").contains(listOf("D10")))
        assertTrue(playerPlayFinishRoutes(60,1,"master").contains(listOf("T20")))
    }
    @Test fun finishComparisonNeverMixesOutRulesAttemptsHelpOrRuleVersions(){
        val row=json("target" to 68,"outRule" to "double","attemptCount" to 5,"routeHelp" to true,"ruleVersion" to 1,"comparisonKey" to "finish:1:68:double:5:true")
        val other=JSONObject(row.toString()).put("outRule","straight").put("comparisonKey","finish:1:68:straight:5:true")
        assertEquals(listOf(row),playerFinishComparable(listOf(row,other),row.text("comparisonKey")))
        assertTrue(playerFinishComparisonLabel(row).contains("5 pogingen"));assertTrue(playerFinishComparisonLabel(row).contains("regels v1"))
        assertTrue(playerPlayStatisticsRuleLabel(json("mode" to "leg-challenge","startScore" to 301,"inRule" to "double","outRule" to "double","comparison" to "visits")).startsWith("301 ·"))
    }
    @Test fun privateGrantsNeverEnterPublicCache() {
        val session = PlayerPlaySession(json("privateAccess" to json("grants" to JSONArray(listOf(json("token" to secret)))), "id" to id))
        assertFalse(session.publicCache().toString().contains(secret)); assertFalse(session.publicCache().has("privateAccess"))
    }
    @Test fun queuedCommandHasStableIdentityRevisionWriterAndRulesWithoutCapability() {
        val session = PlayerPlaySession(json("id" to id, "revision" to 8, "rulesHash" to "rules-1", "writer" to json("epoch" to 4), "game" to json("currentThrowerId" to "guest-one")))
        val command = playerPlayQueueCommand(session,json("dartHits" to JSONArray(listOf("D16"))),0,"same-request")
        assertEquals(8,command.optInt("expectedRevision")); assertEquals(4,command.optInt("writerEpoch")); assertEquals("same-request",command.text("requestId")); assertEquals("guest-one",command.text("participantId")); assertFalse(command.toString().contains("token"))
    }
}
