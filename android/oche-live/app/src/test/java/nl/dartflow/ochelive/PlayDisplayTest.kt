package nl.dartflow.ochelive

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlayDisplayTest {
    private fun frame(mode:String):JSONObject=JSONObject().put("id","public-play").put("version",1).put("revision",4).put("status","active").put("mode",mode)
        .put("rules",JSONObject().put("version",1).put("mode",mode).put("startScore",301).put("hitsPerTarget",1).put("points",true))
        .put("participants",JSONArray(listOf(JSONObject().put("id","opaque-one").put("name","Noor"),JSONObject().put("id","opaque-two").put("name","Rick"))))
        .put("game",JSONObject().put("ruleVersion",1).put("turn",0).put("currentThrowerId","opaque-one").put("sides",JSONArray(listOf(JSONObject().put("id","side-one").put("playerIds",JSONArray(listOf("opaque-one"))),JSONObject().put("id","side-two").put("playerIds",JSONArray(listOf("opaque-two")))))).put("progress",JSONObject().put("remaining",JSONArray(listOf(301,301)))))
    @Test fun allSevenModesAreRecognizedWithoutA501Fallback(){
        for(mode in listOf("x01","cricket","tactics","around","bingo","finish","leg-challenge")){val p=PlayDisplay.parse(frame(mode));assertTrue(mode,p.supported);assertEquals("Noor",p.current);assertEquals(listOf("Noor","Rick"),p.names);assertTrue(p.legs.isEmpty());assertTrue(p.sets.isEmpty())}
    }
    @Test fun unknownModesAndVersionsRequireAnUpdate(){
        assertFalse(PlayDisplay.parse(frame("future-mode")).supported)
        val f=frame("x01");f.getJSONObject("rules").put("version",2);assertFalse(PlayDisplay.parse(f).supported)
        assertFalse(PlayDisplay.parse(frame("x01").put("version",2)).supported)
        val gameFuture=frame("x01");gameFuture.getJSONObject("game").put("ruleVersion",2);assertFalse(PlayDisplay.parse(gameFuture).supported)
    }
    @Test fun publicParserNeverRetainsPrivateFieldsOrUnrevealedHistoricalVisits(){
        val f=frame("leg-challenge").put("privateAccess",JSONObject().put("token","must-stay-private")).put("accountId","private-account")
        f.getJSONObject("rules").put("source",JSONObject().put("visits",JSONArray(listOf(JSONObject().put("score",180).put("remainingAfter",121),JSONObject().put("score",121).put("remainingAfter",0)))))
        f.getJSONObject("game").getJSONObject("progress").put("revealedSourceVisits",1)
        val parsed=PlayDisplay.parse(f);assertEquals(listOf(180 to 121),parsed.sourceVisits);assertFalse(parsed.toString().contains("must-stay-private"));assertFalse(parsed.toString().contains("private-account"))
    }
    @Test fun tacticsKeepsAllTwelveRowsAndFiveMarks(){
        val f=frame("tactics");val p=f.getJSONObject("game").getJSONObject("progress");p.put("targets",JSONArray((20 downTo 10).toList()+25)).put("requiredMarks",5).put("marks",JSONArray(List(2){JSONArray(List(12){5})}));val parsed=PlayDisplay.parse(f)
        assertEquals(12,parsed.targets.size);assertEquals(5,parsed.requiredMarks);assertEquals(5,parsed.marks[0][11]);assertEquals("TACTICS 5",parsed.title)
    }
    @Test fun playProjectionIsAdditiveAndLegacyMatchRemainsAvailable(){
        val root=JSONObject("""{"apiVersion":1,"state":"live","serverNow":1000,"display":{"snapshot":{"match":{"id":"legacy","status":"live","players":[{"name":"Legacy"}],"remaining":[301]}}}}""")
        assertNotNull(DisplaySnapshot.parse(root).match);assertNull(DisplaySnapshot.parse(root).play)
        root.getJSONObject("display").getJSONObject("snapshot").put("play",frame("x01"));val parsed=DisplaySnapshot.parse(root);assertNotNull(parsed.match);assertNotNull(parsed.play);assertEquals(listOf(301,301),parsed.play!!.remaining);assertNotNull(parsed.play!!.x01Match);assertEquals(listOf("Noor","Rick"),parsed.play!!.x01Match!!.players.map{it.name})
    }
}
