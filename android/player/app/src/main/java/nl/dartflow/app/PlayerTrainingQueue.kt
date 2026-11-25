package nl.dartflow.app

import android.content.Context
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

internal fun playerProjectSoloTraining(entity:JSONObject,action:JSONObject,actor:String):JSONObject {
    require(entity.optBoolean("canManage")&&entity.obj("state").optBoolean("offlineSupported")&&entity.obj("state").text("mode") in listOf("solo","bot")){"Laad eerst je eigen ondersteunde training voor offline invoer."}
    val copy=JSONObject(entity.toString());val state=copy.obj("state");val game=state.obj("game")
    require(!state.optBoolean("nativeAwaitingReceipt")&&!state.optBoolean("completed")&&!state.optBoolean("interrupted")&&state.obj("offlineConflict").text("status")!="open")
    val settings=json("startScore" to game.optInt("startScore",501),"bestOfLegs" to game.optInt("bestOf",1),"bestOfSets" to 1,"discipline" to game.text("discipline","x01"),"inRule" to game.text("inRule","single"),"outRule" to game.text("outRule","double"),"cricketMode" to game.text("cricketMode","standard"))
    game.optJSONArray("sideStartScores")?.let{settings.put("sideStartScores",it)}
    val bot=state.text("mode")=="bot"
    require(!bot||game.optInt("turn")==0){"Wacht op de echte Dartbotbeurt voordat je opnieuw invoert."}
    game.put("turn",0)
    val raw=json("id" to entity.text("id"),"revision" to entity.optInt("revision"),"status" to "live","offlineSupported" to true,"scoringState" to game,"players" to JSONArray(listOf(json("id" to actor,"name" to "Speler"),json("id" to "Dartbot","name" to "Ongebruikte zijde"))),"remaining" to game.optJSONArray("remaining"),"legs" to game.optJSONArray("legs"),"sets" to JSONArray(listOf(0,0)),"turn" to 0,"setNumber" to 1,"legNumber" to game.optJSONArray("legs").ints().sum()+1,"visits" to JSONArray(game.rows("visits")),"writerId" to actor,"scoringMode" to "shared-writer","settings" to settings,"permissions" to json("canScore" to true,"canUndo" to game.rows("history").isNotEmpty()))
    if(settings.text("discipline")=="cricket")raw.put("cricket",game.obj("cricket"))
    val projected=playerProjectMatch(PlayerMatch.parse(raw),JSONObject(action.toString()).put("type",if(action.text("type")=="training.undo")"undo" else "score"),actor)
    val next=projected.raw.obj("scoringState");if(!bot)next.put("turn",0)
    state.put("game",next).put("undoCount",(state.optInt("undoCount",state.rows("undo").size)+if(action.text("type")=="training.undo")-1 else 1).coerceAtLeast(0)).put("completed",next.text("status")=="finished"||!bot&&state.text("focus")=="first9"&&(next.optJSONArray("stats")?.optJSONObject(0)?.optInt("darts")?:0)>=9)
    return copy.put("revision",entity.optInt("revision")+1)
}

internal class PlayerTrainingQueue(context:Context,private val api:PlayerApi,private val account:()->String?,private val update:(JSONObject,Int,String?)->Unit){
    private val store=PlayerSessionStore(context,"training-queue");private val lock=Mutex();private var saved=store.read();private var projected:JSONObject?=null
    init{if(account()!=null)prepareAccount()}
    private fun valid()=account()!=null&&saved.text("origin")==api.origin&&scoped().text("accountId")==account()
    private fun prepareAccount(){
        val actor=account().orEmpty();require(actor.isNotBlank()){ "Log opnieuw in om je bewaarde invoer te openen." }
        if(saved.text("origin")!=api.origin)saved=json("origin" to api.origin,"accounts" to JSONObject())
        if(!saved.has("accounts")){
            val legacy=JSONObject(saved.toString());saved=json("origin" to api.origin,"accounts" to JSONObject())
            legacy.text("accountId").takeIf(String::isNotBlank)?.let{saved.obj("accounts").put(it,legacy)}
        }
        if(!saved.obj("accounts").has(actor))saved.obj("accounts").put(actor,json("accountId" to actor,"trainings" to JSONObject()))
    }
    private fun scoped()=saved.obj("accounts").obj(account().orEmpty())
    private fun record(id:String)=scoped().obj("trainings").obj(id)
    private fun persist(id:String,value:JSONObject){prepareAccount();scoped().obj("trainings").put(id,value);store.write(saved)}
    fun pending(id:String)=if(valid())record(id).rows("commands").size else 0
    fun restore(id:String){if(valid())record(id).optJSONObject("canonical")?.let(::reproject)}
    fun accept(entity:JSONObject){
        prepareAccount()
        val id=entity.text("id");val record=record(id);if(record.obj("canonical").optInt("revision",-1)>entity.optInt("revision"))return
        record.put("canonical",entity);persist(id,record);reproject(entity)
    }
    private fun reproject(canonical:JSONObject){
        val commands=record(canonical.text("id")).rows("commands");var current=JSONObject(canonical.toString());var error:String?=null
        if(commands.isNotEmpty()&&commands.first().optInt("expectedRevision")!=canonical.optInt("revision")){
            current.obj("state").put("nativeAwaitingReceipt",true);error="De server is verder. Controleer eerst de uitkomst van je bewaarde trainingsinvoer."
        }else if(canonical.obj("state").obj("offlineConflict").text("status")!="open")try{commands.forEach{current=playerProjectSoloTraining(current,it.obj("action"),account().orEmpty())}}catch(failure:Exception){error=failure.message}
        current.put("nativePendingCommands",JSONArray(commands));projected=current;update(current,commands.size,error)
    }
    fun enqueue(entity:JSONObject,action:JSONObject){
        if(!valid()||record(entity.text("id")).optJSONObject("canonical")==null)accept(entity)
        val current=projected?.takeIf{it.text("id")==entity.text("id")}?:entity
        val record=record(entity.text("id"));val queue=record.optJSONArray("commands")?:JSONArray();require(current.obj("state").text("mode")!="bot"||queue.length()==0){"Wacht op verwerking en de echte Dartbotbeurt."}
        val next=playerProjectSoloTraining(current,action,account().orEmpty());require(queue.length()<100){"Synchroniseer eerst de wachtende trainingsbeurten."}
        queue.put(json("requestId" to UUID.randomUUID().toString(),"expectedRevision" to current.optInt("revision"),"action" to action));record.put("commands",queue);persist(entity.text("id"),record)
        projected=next;next.put("nativePendingCommands",queue);update(next,queue.length(),null)
    }
    fun removeLast(id:String):Boolean{if(!valid()||pending(id)==0||lock.isLocked||record(id).has("batch"))return false;val record=record(id);record.put("commands",JSONArray(record.rows("commands").dropLast(1)));persist(id,record);reproject(record.obj("canonical"));return true}
    suspend fun sync(id:String)=lock.withLock{
        if(!valid()||pending(id)==0)return@withLock
        val actor=account();val commands=record(id).rows("commands")
        val batch=record(id).optJSONObject("batch")?:json("requestId" to UUID.randomUUID().toString(),"sourceId" to id,"kind" to "training","action" to "replay","baseRevision" to commands.first().optInt("expectedRevision"),"commands" to JSONArray(commands)).also{persist(id,record(id).put("batch",it))}
        val result=api.play("/play/legacy-actions",batch)
        if(account()!=actor)return@withLock
        val entity=api.call("/trainings/$id").obj("entity");if(account()!=actor)return@withLock
        val accepted=result.optJSONArray("accepted")?.strings().orEmpty().toSet();val record=record(id);record.put("commands",JSONArray(record.rows("commands").filter{it.text("requestId") !in accepted}));record.remove("batch");persist(id,record);accept(entity)
    }
    fun resolved(id:String){if(valid()){val record=record(id);record.put("commands",JSONArray()).remove("batch");persist(id,record)}}
    fun clear(){account()?.let{saved.obj("accounts").remove(it)};projected=null;store.write(saved)}
}
