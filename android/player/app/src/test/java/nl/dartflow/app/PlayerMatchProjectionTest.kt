package nl.dartflow.app

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class PlayerMatchProjectionTest {
    private fun match(remote:Boolean=false):PlayerMatch {
        val game=json("players" to JSONArray(listOf("one","two")),"remaining" to JSONArray(listOf(501,501)),"legs" to JSONArray(listOf(0,0)),"turn" to 0,"legStarter" to 0,"startScore" to 501,"bestOf" to 3,"status" to "live","visits" to JSONArray(),"history" to JSONArray(),"stats" to JSONArray(List(2){json("total" to 0,"darts" to 0,"oneEighties" to 0,"highestFinish" to 0)}))
        return PlayerMatch.parse(json("id" to "match-one","revision" to 4,"status" to "live","offlineSupported" to true,"scoringState" to game,"players" to JSONArray(listOf(json("id" to "one","name" to "Noor"),json("id" to "two","name" to "Rick"))),"remaining" to JSONArray(listOf(501,501)),"legs" to JSONArray(listOf(0,0)),"sets" to JSONArray(listOf(0,0)),"turn" to 0,"setNumber" to 1,"legNumber" to 1,"visits" to JSONArray(),"writerId" to "one","scoringMode" to if(remote)"per-player" else "shared-writer","settings" to json("startScore" to 501,"bestOfLegs" to 3,"bestOfSets" to 1),"permissions" to json("canScore" to true,"canWrite" to true)))
    }
    @Test fun sharedWriterCanProjectSeveralTurnsWithoutChangingAcceptedSource() {
        val original=match();val saved=original.raw.toString()
        val next=playerProjectMatch(original,json("type" to "score","score" to 60,"darts" to 3),"one")
        val second=playerProjectMatch(next,json("type" to "score","score" to 100,"darts" to 3),"one")
        assertEquals(listOf(441,401),second.remaining);assertEquals(6,second.revision);assertEquals(0,second.turn)
        assertEquals(2,second.raw.rows("visits").size);assertTrue(second.permissions.optBoolean("canScore"));assertEquals(saved,original.raw.toString())
        val undone=playerProjectMatch(second,json("type" to "undo"),"one")
        assertEquals(listOf(441,501),undone.remaining);assertEquals(7,undone.revision);assertEquals(1,undone.raw.rows("visits").size)
        assertEquals(listOf(441,441),playerProjectMatch(undone,json("type" to "score","score" to 60),"one").remaining)
    }
    @Test fun individualWriterStopsAtOtherSidesTurn() {
        val next=playerProjectMatch(match(true),json("type" to "score","score" to 60,"darts" to 3),"one")
        assertEquals(1,next.turn);assertFalse(next.permissions.optBoolean("canScore"))
        assertThrows(IllegalArgumentException::class.java){playerProjectMatch(next,json("type" to "score","score" to 60),"one")}
    }
    @Test fun currentWriterAndPreparedOfflineSourceAreRequired() {
        assertThrows(IllegalArgumentException::class.java){playerProjectMatch(match(),json("type" to "score","score" to 60),"two")}
        val unsupported=PlayerMatch.parse(match().raw.put("offlineSupported",false))
        assertThrows(IllegalArgumentException::class.java){playerProjectMatch(unsupported,json("type" to "score","score" to 60),"one")}
    }
    @Test fun invalidTotalsDoNotBecomeLocalVisits() {
        assertThrows(IllegalArgumentException::class.java){playerProjectMatch(match(),json("type" to "score","score" to 179,"darts" to 3),"one")}
    }
    @Test fun twoClearCapMatchesPublishedSeriesRule() {
        assertNull(playerSeriesWinner(listOf(2,1),3,7));assertEquals(0,playerSeriesWinner(listOf(3,1),3,7));assertEquals(0,playerSeriesWinner(listOf(4,3),3,7));assertEquals(1,playerSeriesWinner(listOf(1,2),3))
    }
    @Test fun soloTrainingKeepsOwnTurnAndCanonicalIdentityAcrossMultipleLocalVisits() {
        val entity=json("id" to "training-one","revision" to 4,"canManage" to true,"state" to json("mode" to "solo","offlineSupported" to true,"game" to match().raw.obj("scoringState")))
        val original=entity.toString();val first=playerProjectSoloTraining(entity,json("type" to "training.score","score" to 60,"darts" to 3),"one")
        val second=playerProjectSoloTraining(first,json("type" to "training.score","score" to 100,"darts" to 3),"one")
        assertEquals("training-one",second.text("id"));assertEquals(6,second.optInt("revision"));assertEquals(0,second.obj("state").obj("game").optInt("turn"));assertEquals(listOf(341,501),second.obj("state").obj("game").getJSONArray("remaining").ints());assertEquals(original,entity.toString())
    }
    @Test fun firstNineStopsAtNineDartsAndBotWaitsForItsRealTurn() {
        val game=match().raw.obj("scoringState");game.getJSONArray("stats").getJSONObject(0).put("darts",6)
        val entity=json("id" to "training-one","revision" to 4,"canManage" to true,"state" to json("mode" to "solo","offlineSupported" to true,"focus" to "first9","game" to game))
        assertTrue(playerProjectSoloTraining(entity,json("type" to "training.score","score" to 60,"darts" to 3),"one").obj("state").optBoolean("completed"))
        entity.obj("state").put("mode","bot")
        val pending=playerProjectSoloTraining(entity,json("type" to "training.score","score" to 60),"one")
        assertEquals(1,pending.obj("state").obj("game").optInt("turn"));assertEquals(1,pending.obj("state").obj("game").rows("visits").size)
        assertThrows(IllegalArgumentException::class.java){playerProjectSoloTraining(pending,json("type" to "training.score","score" to 60),"one")}
    }
}
