package nl.dartflow.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Real Keystore persistence on the emulator. Fixtures never call a hosted API. */
class PlayerPlayPersistenceTest {
    @Test fun soloTrainingQueueRestoresWithoutExposingItToAnotherAccount(){
        val context=ApplicationProvider.getApplicationContext<Context>();val store=PlayerSessionStore(context,"training-queue");store.clear()
        val game=json("players" to JSONArray(listOf("account-one","Dartbot")),"remaining" to JSONArray(listOf(501,501)),"legs" to JSONArray(listOf(0,0)),"turn" to 0,"legStarter" to 0,"startScore" to 501,"bestOf" to 1,"status" to "live","visits" to JSONArray(),"history" to JSONArray(),"stats" to JSONArray(List(2){json("total" to 0,"darts" to 0,"oneEighties" to 0,"highestFinish" to 0)}))
        val entity=json("id" to "10000000-0000-4000-8000-000000000010","revision" to 1,"canManage" to true,"state" to json("mode" to "solo","offlineSupported" to true,"game" to game))
        var restored:JSONObject?=null;var count=0
        try{
            val first=PlayerTrainingQueue(context,PlayerApi(),{"account-one"}){_,_,_->};first.accept(entity)
            first.enqueue(entity,json("type" to "training.score","score" to 60,"darts" to 3));first.enqueue(entity,json("type" to "training.score","score" to 100,"darts" to 3))
            val second=PlayerTrainingQueue(context,PlayerApi(),{"account-one"}){value,pending,_->restored=value;count=pending};second.restore(entity.text("id"))
            assertEquals(2,count);assertEquals(341,restored!!.obj("state").obj("game").getJSONArray("remaining").getInt(0))
            var leaked=false;val other=PlayerTrainingQueue(context,PlayerApi(),{"account-two"}){_,_,_->leaked=true};other.restore(entity.text("id"));assertFalse(leaked)
            other.accept(JSONObject(entity.toString()).put("id","10000000-0000-4000-8000-000000000011"))
            restored=null;count=0;PlayerTrainingQueue(context,PlayerApi(),{"account-one"}){value,pending,_->restored=value;count=pending}.restore(entity.text("id"));assertEquals(2,count);assertEquals(341,restored!!.obj("state").obj("game").getJSONArray("remaining").getInt(0))
            assertFalse(context.getSharedPreferences("dartflow-player-training-queue-private-v1",Context.MODE_PRIVATE).all.toString().contains("account-one"))
        }finally{store.clear()}
    }
    @Test fun guestMultipleOfflineVisitsAndPrivateAccessSurviveCoordinatorRecreation()= runBlocking {
        val context=ApplicationProvider.getApplicationContext<Context>();val store=PlayerSessionStore(context,"play");store.clear()
        val origin=BuildConfig.API_ORIGIN;val id="10000000-0000-4000-8000-000000000001";val capability="10000000-0000-4000-8000-000000000002.synthetic-private-capability-12345678901234567"
        val rules=playerPlayDefaultRules("x01",501)
        val game=json("id" to id,"mode" to "x01","ruleVersion" to 1,"rules" to rules,"turn" to 0,"currentThrowerId" to "guest-one","starter" to 0,"set" to 1,"leg" to 1,"attempt" to 1,"legs" to JSONArray(listOf(0,0)),"sets" to JSONArray(listOf(0,0)),"status" to "live","visits" to JSONArray(),"attempts" to JSONArray(),"sides" to JSONArray(listOf(json("id" to "side-one","playerIds" to JSONArray(listOf("guest-one"))),json("id" to "side-two","playerIds" to JSONArray(listOf("guest-two"))))),"progress" to json("mode" to "x01","remaining" to JSONArray(listOf(501,501)),"opened" to JSONArray(listOf(true,true))))
        val session=json("id" to id,"revision" to 7,"status" to "active","deviceMode" to "shared","rules" to rules,"rulesHash" to "synthetic-rules","writer" to json("epoch" to 1),"game" to game,"participants" to JSONArray(listOf(json("id" to "guest-one","name" to "Synthetische Noor"),json("id" to "guest-two","name" to "Synthetische Rick"))),"permissions" to json("canScore" to true))
        store.write(json("origin" to origin,"activeId" to id,"records" to json(id to json("accountId" to "","capability" to capability,"cache" to session,"queue" to JSONArray()))))
        val unavailable:suspend(String,JSONObject?,String?,String?)->JSONObject={_,_,_,_->throw java.io.IOException("synthetic offline fixture")}
        try {
            val first=PlayerPlayCoordinator(context,PlayerApi(),{null},{},unavailable);first.restore(id)
            first.action(json("type" to "session.score","input" to json("dartHits" to JSONArray(listOf("T20","S20","S20")))))
            first.action(json("type" to "session.score","input" to json("dartHits" to JSONArray(listOf("S20","S20","S20")))))
            assertEquals(2,first.ui.pending);assertTrue(first.ui.offline)
            val before=store.read().obj("records").obj(id).rows("queue").map{it.text("requestId")}
            val restored=PlayerPlayCoordinator(context,PlayerApi(),{null},{},unavailable);restored.restore(id)
            assertEquals(2,restored.ui.pending);assertEquals(listOf(401,441),restored.ui.session!!.progress.getJSONArray("remaining").ints())
            assertEquals(before,store.read().obj("records").obj(id).rows("queue").map{it.text("requestId")})
            val firstChallenge=PlayerChallengeLink("10000000-0000-4000-8000-000000000021","synthetic-first-challenge-code-123456789")
            val secondChallenge=PlayerChallengeLink("10000000-0000-4000-8000-000000000022","synthetic-second-challenge-code-123456789")
            restored.acceptChallenge(firstChallenge);restored.acceptChallenge(secondChallenge)
            var loadedCode:String?=null;var startedCode:String?=null
            val online:suspend(String,JSONObject?,String?,String?)->JSONObject={path,body,_,challengeLink->
                if(path.endsWith("/actions"))startedCode=body!!.obj("action").text("linkToken")else loadedCode=challengeLink
                JSONObject()
            }
            val reopened=PlayerPlayCoordinator(context,PlayerApi(),{null},{},online)
            reopened.load(PlayerScreen.CHALLENGES,firstChallenge.id);assertEquals(firstChallenge.token,loadedCode)
            reopened.load(PlayerScreen.CHALLENGES,secondChallenge.id);assertEquals(secondChallenge.token,loadedCode)
            reopened.action(json("type" to "challenge.start","challengeId" to firstChallenge.id));assertEquals(firstChallenge.token,startedCode)
            val disk=context.getSharedPreferences("dartflow-player-play-private-v1",Context.MODE_PRIVATE).all.toString()
            assertFalse(disk.contains(capability));assertFalse(disk.contains("Synthetische Noor"));assertFalse(disk.contains("dartHits"))
            assertFalse(disk.contains(firstChallenge.token!!));assertFalse(disk.contains(secondChallenge.token!!))
        }finally{store.clear()}
    }
}
