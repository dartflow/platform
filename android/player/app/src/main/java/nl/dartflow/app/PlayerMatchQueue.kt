package nl.dartflow.app

import android.content.Context
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/** Durable ordered core-match visits, bound to the account, environment and canonical source. */
internal class PlayerMatchQueue(context: Context, private val api: PlayerApi, private val account: () -> String?, private val update: (PlayerMatch,Int,String?) -> Unit) {
    private val store = PlayerSessionStore(context,"match-queue"); private val lock=Mutex()
    private var saved=store.read(); private var projected:PlayerMatch?=null
    init{if(account()!=null)prepareAccount()}
    private fun prepareAccount(){
        val actor=account().orEmpty();require(actor.isNotBlank()){ "Log opnieuw in om je bewaarde invoer te openen." }
        if(saved.text("origin")!=api.origin)saved=json("origin" to api.origin,"accounts" to JSONObject())
        if(!saved.has("accounts")){
            val legacy=JSONObject(saved.toString());saved=json("origin" to api.origin,"accounts" to JSONObject())
            legacy.text("accountId").takeIf(String::isNotBlank)?.let{saved.obj("accounts").put(it,legacy)}
        }
        if(!saved.obj("accounts").has(actor))saved.obj("accounts").put(actor,json("accountId" to actor,"matches" to JSONObject()))
    }
    private fun scoped()=saved.obj("accounts").obj(account().orEmpty())
    private fun record(id:String)=scoped().obj("matches").obj(id)
    private fun persist(id:String,record:JSONObject) { prepareAccount();scoped().obj("matches").put(id,record);store.write(saved) }
    private fun valid()=account()!=null&&saved.text("origin")==api.origin&&scoped().text("accountId")==account()
    fun pending(id:String)=if(valid())record(id).rows("commands").size else 0
    fun restore(id:String) {
        if (!valid())return
        record(id).optJSONObject("canonical")?.let{reproject(PlayerMatch.parse(it))}
    }
    fun accept(raw:JSONObject) {
        val incoming=PlayerMatch.parse(raw)
        prepareAccount()
        val record=record(incoming.id);val prior=record.obj("canonical")
        if(prior.optInt("revision",-1)>incoming.revision)return
        record.put("canonical",incoming.raw);persist(incoming.id,record);reproject(incoming)
    }
    private fun reproject(canonical:PlayerMatch) {
        var match=canonical;var error:String?=null
        val commands=record(canonical.id).rows("commands")
        if(commands.isNotEmpty()&&commands.first().optInt("expectedRevision")!=canonical.revision){
            match=PlayerMatch.parse(JSONObject(canonical.raw.toString()).also{it.obj("permissions").put("canScore",false)})
            error="De server is verder. Controleer de uitkomst van de bewaarde invoer voordat je verder speelt."
        }else if(canonical.raw.obj("offlineConflict").text("status")!="open")try{commands.forEach{match=playerProjectMatch(match,it.obj("action"),account().orEmpty())}}catch(failure:Exception){error=failure.message}
        match.raw.put("nativePendingCommands",JSONArray(commands.map{json("requestId" to it.text("requestId"),"expectedRevision" to it.optInt("expectedRevision"),"action" to it.obj("action"))})).put("nativeCanonicalRevision",canonical.revision)
        projected=match;update(match,commands.size,error)
    }
    fun enqueue(match:PlayerMatch,action:JSONObject):Boolean {
        if(!valid()||record(match.id).optJSONObject("canonical")==null)accept(match.raw)
        val current=projected?.takeIf{it.id==match.id}?:match
        val record=record(match.id);val queue=record.optJSONArray("commands")?:JSONArray()
        require(queue.length()<100){"Synchroniseer eerst de honderd wachtende beurten."}
        val next=playerProjectMatch(current,action,account().orEmpty())
        val command=json("requestId" to UUID.randomUUID().toString(),"matchId" to match.id,"expectedRevision" to current.revision,"action" to JSONObject(action.toString()),"offline" to true)
        record.put("commands",queue.put(command));persist(match.id,record)
        next.raw.put("nativePendingCommands",queue).put("nativeCanonicalRevision",record.obj("canonical").optInt("revision"));projected=next;update(next,queue.length(),null)
        return true
    }
    fun removeLast(id:String):Boolean {
        if(!valid()||pending(id)==0||lock.isLocked||record(id).has("attempted"))return false
        val record=record(id);record.put("commands",JSONArray(record.rows("commands").dropLast(1)));persist(id,record);reproject(PlayerMatch.parse(record.obj("canonical")));return true
    }
    suspend fun sync(id:String)=lock.withLock {
        if(!valid())return@withLock
        val actor=account()
        while(pending(id)>0&&account()==actor) {
            val commands=record(id).rows("commands");persist(id,record(id).put("attempted",true));val result=try{api.call("/platform/matches/$id/replay",json("matchId" to id,"baseRevision" to commands.first().optInt("expectedRevision"),"commands" to JSONArray(commands)))}catch(failure:PlayerApiFailure){
                if(failure.status in listOf(403,409,410,422))runCatching{if(account()==actor)accept(api.call("/matches/$id"))}
                throw failure
            }
            if(account()!=actor)return@withLock
            val raw=api.call("/matches/$id")
            if(account()!=actor)return@withLock
            val accepted=result.optJSONArray("accepted")?.strings().orEmpty().toSet()
            val record=record(id);record.put("commands",JSONArray(record.rows("commands").filter{it.text("requestId") !in accepted}));record.remove("attempted");persist(id,record)
            accept(raw)
            if((raw.optJSONObject("match")?:raw).obj("offlineConflict").text("status")=="open"||result.has("conflict")||accepted.isEmpty())return@withLock
        }
    }
    fun resolved(id:String) {
        if(!valid())return
        val record=record(id);record.put("commands",JSONArray()).remove("attempted");persist(id,record)
    }
    fun clear(){account()?.let{saved.obj("accounts").remove(it)};projected=null;store.write(saved)}
}
