package nl.dartflow.app

import android.content.Context
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

data class PlayerPlayUi(
    val session: PlayerPlaySession? = null, val canonical: PlayerPlaySession? = null,
    val board: JSONObject = JSONObject(), val sessions: List<JSONObject> = emptyList(), val history: List<JSONObject> = emptyList(),
    val pending: Int = 0, val syncing: Boolean = false, val offline: Boolean = false, val error: String? = null,
    val purpose: String? = null, val privateLink: JSONObject? = null, val auxiliary: JSONObject = JSONObject(),
    val pendingOperation: String? = null,
) { override fun toString()="PlayerPlayUi(session=${session?.id}, pending=$pending, private=[redacted])" }

/** Capabilities and pending visits are encrypted separately from account credentials and never logged. */
internal class PlayerPlayCoordinator(context: Context, private val api: PlayerApi, private val account: () -> String?, private val update: (PlayerPlayUi) -> Unit, private val transport: (suspend (String,JSONObject?,String?,String?)->JSONObject)? = null) {
    private val store = PlayerSessionStore(context, "play")
    private val lock = Mutex()
    private var saved = store.read().takeIf { it.text("origin") == api.origin } ?: json("origin" to api.origin, "records" to JSONObject())
    var ui = PlayerPlayUi(); private set
    fun resetView() { emit(PlayerPlayUi()) }
    fun eraseAccount(actor:String) {
        val records=saved.obj("records");val ids=records.keys().asSequence().toList().filter{records.obj(it).text("accountId")==actor}
        ids.forEach(records::remove)
        if(saved.text("activeId") in ids)saved.remove("activeId")
        if(saved.text("operationAccount")==actor){saved.remove("operation");saved.remove("operationAccount")}
        persist();resetView()
    }
    private fun emit(value: PlayerPlayUi) { ui = value.copy(pendingOperation=saved.obj("operation").obj("action").text("type").ifBlank{null}); update(ui) }
    private suspend fun request(path:String,body:JSONObject?=null,capability:String?=null,challengeLink:String?=null)=transport?.invoke(path,body,capability,challengeLink)?:api.play(path,body,capability,challengeLink)
    private fun record(id: String) = saved.obj("records").obj(id)
    private fun persist() { store.write(saved) }
    private fun putRecord(id: String, value: JSONObject) { saved.obj("records").put(id, value); persist() }
    private fun authorized(value: JSONObject) = value.text("accountId").let { it.isBlank() || it == account() }
    private fun capability(id: String): String? = record(id).takeIf(::authorized)?.text("capability")?.takeIf(String::isNotBlank)
    fun lastId(): String? = saved.text("activeId").takeIf { it.isNotBlank() && authorized(record(it)) }
    private fun challengeAccess(id: String?) = saved.obj("challenges").optJSONObject(id.orEmpty())
        ?: saved.obj("challenge").takeIf { id != null && it.text("id") == id }
    fun acceptChallenge(link: PlayerChallengeLink) {
        val challenges = saved.obj("challenges")
        saved.optJSONObject("challenge")?.takeIf { it.text("id").isNotBlank() }?.let { legacy ->
            if (!challenges.has(legacy.text("id"))) challenges.put(legacy.text("id"), legacy)
        }
        if (link.token != null || !challenges.has(link.id)) challenges.put(link.id, json("id" to link.id, "token" to link.token))
        saved.put("challenges", challenges); saved.remove("challenge"); persist()
    }
    fun acceptLink(link: PlayerPlayLink) {
        val record = record(link.sessionId)
        if (link.token != null) {
            if (link.purpose == "claim") record.put("claimToken", link.token)
            record.put("capability", link.token)
            record.put("purpose", link.purpose).put("accountId", "")
        }
        putRecord(link.sessionId, record); restore(link.sessionId)
    }
    fun restore(id: String) {
        val record = record(id)
        require(authorized(record)) { "Open deze partij met het account waarmee je deelnam." }
        saved.put("activeId", id); persist()
        val cache = record.optJSONObject("cache")?.let(::PlayerPlaySession)
        emit(ui.copy(session = cache, canonical = cache, pending = record.rows("queue").size, purpose = record.text("purpose").ifBlank { null }, error = null, privateLink = null))
        if (cache != null) projectQueue(cache, record.rows("queue"))
    }
    private fun saveSession(raw: JSONObject) {
        val incoming = PlayerPlaySession(raw); val record = record(incoming.id)
        val grants = raw.obj("privateAccess").rows("grants")
        val access = grants.firstOrNull { it.text("purpose") == "controller" } ?: grants.firstOrNull { it.text("purpose") in listOf("participant", "recovery") }
        // Issuing somebody else's link must never replace this device's controller grant.
        access?.takeIf { record.text("capability").isBlank() }?.let { record.put("capability", it.text("token")).put("purpose", it.text("purpose")) }
        record.put("grants", JSONArray(grants)).put("cache", incoming.publicCache())
        if (!record.has("accountId")) record.put("accountId", account().orEmpty())
        putRecord(incoming.id, record); saved.put("activeId", incoming.id); persist()
        projectQueue(PlayerPlaySession(incoming.publicCache()), record.rows("queue"))
    }
    private fun projectQueue(canonical: PlayerPlaySession, queue: List<JSONObject>) {
        var projected = canonical
        var projectionError: String? = null
        try {
            if(queue.isNotEmpty()&&queue.first().optInt("expectedRevision")!=canonical.revision){
                projected=PlayerPlaySession(JSONObject(canonical.raw.toString()).also{it.obj("permissions").put("canScore",false)})
                projectionError="De server is verder. Controleer eerst de uitkomst van de bewaarde beurten."
            }else queue.forEach { projected = PlayerPlayEngine.project(projected, it.obj("input")) }
        }
        catch (failure: IllegalArgumentException) { projectionError = failure.message }
        emit(ui.copy(session = projected, canonical = canonical, pending = queue.size, purpose = record(canonical.id).text("purpose").ifBlank { null }, error = projectionError ?: ui.error))
    }
    suspend fun load(screen: PlayerScreen, id: String?) = lock.withLock {
        try {
            when (screen) {
                PlayerScreen.PLAY_SESSION -> {
                    require(!id.isNullOrBlank())
                    if (ui.canonical?.id != id) restore(id)
                    if (record(id).rows("queue").isNotEmpty()) syncLocked(id)
                    else saveSession(request("/play/sessions/${PlayerLinks.encode(id)}", capability = capability(id)))
                }
                PlayerScreen.PLAY_START -> {
                    val boardId=if(id?.startsWith("replay:")==true)ui.session?.raw?.rows("boards")?.firstOrNull()?.text("id")else id?.takeUnless{it.startsWith("mode:")}
                    emit(ui.copy(board = if(boardId.isNullOrBlank())JSONObject()else request("/play/boards/${PlayerLinks.encode(boardId)}"), error = null, offline = false))
                }
                PlayerScreen.PLAY_HISTORY -> {
                    if(id?.startsWith("statistics")==true){
                        val result=if(account()!=null)request("/play/statistics"+id.substringAfter(':',"").takeIf(String::isNotBlank)?.let{"?$it"}.orEmpty())else JSONObject()
                        emit(ui.copy(auxiliary=result,error=null,offline=false));return@withLock
                    }
                    if (account() != null) {
                        val result = request("/play/mine")
                        emit(ui.copy(sessions = result.rows("sessions"), history = result.rows("history"), error = null, offline = false))
                    } else {
                        val values = saved.obj("records").keys().asSequence().map { record(it) }.filter(::authorized).mapNotNull { it.optJSONObject("cache") }.toList()
                        emit(ui.copy(sessions = values.filter { it.text("status") != "completed" }, history = values.filter { it.text("status") == "completed" }, error = null))
                    }
                }
                PlayerScreen.CHALLENGES -> {
                    val link=challengeAccess(id)
                    val result=if(id.isNullOrBlank())request("/play/challenges")else json("challenges" to JSONArray(listOf(request("/play/challenges/${PlayerLinks.encode(id)}",challengeLink=link?.text("token")?.takeIf(String::isNotBlank)))))
                    if(account()!=null)result.put("sources",request("/play/sources").optJSONArray("sources"))
                    emit(ui.copy(auxiliary = result, error = null, offline = false))
                }
                PlayerScreen.PRACTICE -> emit(ui.copy(auxiliary = if (account() != null) request("/play/advice") else JSONObject(), error = null, offline = false))
                else -> Unit
            }
        } catch (failure: Exception) { fail(failure) }
    }
    suspend fun action(action: JSONObject): String? {
        // Queue and render before waiting for any network mutex; offline input must stay responsive.
        if (action.text("type") == "session.score") {
            try {
                require(saved.optJSONObject("operation")==null){"Wacht op verbinding en controleer eerst de uitkomst van je bewaarde partijwijziging."}
                val session = ui.session ?: error("Open eerst een partij.")
                require(session.permissions.optBoolean("canScore") && session.raw.obj("conflict").text("status") != "open") { "Je mag deze beurt nu niet invoeren." }
                require(session.raw.text("deviceMode") != "individual" || ui.pending == 0) { "Wacht tot je eigen beurt is verwerkt voordat je verder speelt." }
                val queue = record(session.id).optJSONArray("queue") ?: JSONArray()
                require(queue.length() < 300) { "Synchroniseer eerst de wachtende beurten." }
                val command = playerPlayQueueCommand(session, action.obj("input"), 0)
                val projection = PlayerPlayEngine.project(session, command.obj("input"))
                putRecord(session.id, record(session.id).put("queue", queue.put(command)))
                emit(ui.copy(session = projection, pending = queue.length(), error = null))
                if (!ui.offline) lock.withLock { try { syncLocked(session.id) } catch (failure: Exception) { fail(failure) } }
                return session.id
            } catch (failure: Exception) { fail(failure); return null }
        }
        return lock.withLock {
        emit(ui.copy(syncing = true, error = null))
        try {
            val type = action.text("type"); val id = ui.canonical?.id
            if(type=="local.retry-operation"){
                val body=saved.optJSONObject("operation")?:return@withLock id
                require(saved.text("operationAccount")==account().orEmpty()){ "Open de oorspronkelijke aanmelding om deze bewaarde wijziging te controleren." }
                val originalType=body.obj("action").text("type");val originalId=body.text("sessionId").takeIf(String::isNotBlank)
                val result=request(when{originalType.startsWith("challenge.")->"/play/challenges/actions";originalType.startsWith("advice.")->"/play/advice";else->"/play/actions"},if(originalType.startsWith("advice."))json("requestId" to body.text("requestId"),"action" to originalType.removePrefix("advice."))else body,originalId?.let(::capability))
                saved.remove("operation");saved.remove("operationAccount");persist()
                result.optJSONObject("session")?.let(::saveSession)
                result.optJSONObject("challenge")?.let{emit(ui.copy(auxiliary=json("challenges" to JSONArray(listOf(it)))))}
                return@withLock result.obj("session").text("id").ifBlank{originalId}
            }
            if (type == "local.refresh") { id?.let { syncLocked(it) }; return@withLock id }
            if (type == "local.clear-link") { emit(ui.copy(privateLink = null)); return@withLock id }
            if (type == "challenge.start") challengeAccess(action.text("challengeId"))?.text("token")?.takeIf(String::isNotBlank)?.let { action.put("linkToken",it) }
            require(id != null || type == "session.create" || type == "policy.update" || type.startsWith("challenge.") || type.startsWith("advice.")) { "Open eerst een partij." }
            if (id != null && record(id).rows("queue").isNotEmpty()) {
                if (type == "session.undo") {
                    require(!record(id).has("batch")){"Controleer eerst de uitkomst van de lopende synchronisatie; dezelfde verzoeken blijven bewaard."}
                    val queue = record(id).rows("queue"); val record = record(id).put("queue", JSONArray(queue.dropLast(1)))
                    putRecord(id, record); ui.canonical?.let { projectQueue(it, queue.dropLast(1)) }; return@withLock id
                }
                require(type == "session.transfer") { "Verwerk eerst de wachtende invoer. Dezelfde verzoeken blijven bewaard." }
            }
            if (type == "session.claim") {
                require(account() != null) { "Log in om uitsluitend jouw eigen deelname te koppelen." }
                action.put("claimToken", record(id!!).text("claimToken"))
            }
            if (type in listOf("session.undo", "session.transfer")) {
                action.put("writerEpoch", ui.canonical?.raw?.obj("writer")?.optInt("epoch"))
                action.put("rulesHash", ui.canonical?.raw?.text("rulesHash"))
            }
            if (type == "session.transfer") action.put("pendingRequestIds", JSONArray(record(id!!).rows("queue").map { it.text("requestId") }))
            val pending = saved.optJSONObject("operation")?.also { require(saved.text("operationAccount")==account().orEmpty()) { "De vorige wijziging hoort bij een ander account. Open die partij met het oorspronkelijke account." } }
            require(pending == null || pending.obj("action").toString() == action.toString()) { "Een eerdere partijwijziging wacht nog op bevestiging. Herhaal eerst diezelfde actie." }
            val body = pending ?: json("requestId" to UUID.randomUUID().toString(), "sessionId" to id, "expectedRevision" to ui.canonical?.revision, "action" to action)
            val sensitive = type in listOf("session.pin", "session.claim")
            if (!sensitive) { saved.put("operation", body).put("operationAccount",account().orEmpty()); persist() }
            val result = request(when { type.startsWith("challenge.") -> "/play/challenges/actions"; type.startsWith("advice.") -> "/play/advice"; else -> "/play/actions" }, if (type.startsWith("advice.")) json("requestId" to body.text("requestId"), "action" to type.removePrefix("advice.")) else body, id?.let(::capability))
            if (!sensitive) { saved.remove("operation"); saved.remove("operationAccount"); persist() }
            result.optJSONObject("session")?.let(::saveSession)
            result.optJSONObject("challenge")?.let { challenge -> emit(ui.copy(auxiliary = json("challenges" to JSONArray(listOf(challenge))), privateLink = challenge.optJSONObject("link")?.let { JSONObject(it.toString()).put("purpose","challenge").put("url",absoluteLink(it.text("url"))) })) }
            if (type.startsWith("advice.")) emit(ui.copy(auxiliary = result))
            result.optJSONObject("policy")?.let{emit(ui.copy(auxiliary=JSONObject(ui.auxiliary.toString()).put("policy",it)))}
            if (type == "session.claim" && id != null) { putRecord(id, record(id).also { it.remove("claimToken"); it.remove("purpose") }); emit(ui.copy(purpose = null)) }
            if (type == "session.resolve-conflict" && id != null) { putRecord(id, record(id).put("queue", JSONArray()).also { it.remove("batch") }); result.optJSONObject("session")?.let(::saveSession) }
            result.obj("session").obj("privateAccess").rows("grants").firstOrNull { grant -> type == "session.issue-link" && grant.text("purpose") == action.text("purpose") && grant.text("participantId") == action.text("participantId") }?.let { emit(ui.copy(privateLink = JSONObject(it.toString()).put("url",absoluteLink(it.text("url"))))) }
            emit(ui.copy(offline = false, error = null)); return@withLock result.obj("session").text("id").ifBlank { id }
        } catch (failure: Exception) {
            if(failure is PlayerApiFailure && failure.status in 400..499){saved.remove("operation");saved.remove("operationAccount");persist()}
            fail(failure); null
        }
        finally { emit(ui.copy(syncing = false)) }
        }
    }
    private suspend fun syncLocked(id: String) {
        val queue = record(id).rows("queue")
        if (queue.isEmpty()) return
        val record = record(id)
        // Batch operation identity survives a lost HTTP response and process restart.
        val batch = record.optJSONObject("batch") ?: json("requestId" to UUID.randomUUID().toString(), "sessionId" to id, "action" to json("type" to "session.replay", "commands" to JSONArray(queue.take(100)))).also { record.put("batch", it); putRecord(id, record) }
        val result = request("/play/actions", batch, capability(id))
        val accepted = result.optJSONArray("accepted")?.strings().orEmpty().toSet()
        val remaining = record(id).rows("queue").filter { it.text("requestId") !in accepted }
        record.put("queue", JSONArray(remaining)); record.remove("batch"); putRecord(id, record)
        result.optJSONObject("session")?.let(::saveSession)
        emit(ui.copy(offline = false, error = if (result.optBoolean("conflict")) "Controle nodig: vergelijk de serverstand en de bewaarde lokale invoer." else null))
        if (remaining.isNotEmpty() && accepted.isNotEmpty() && !result.optBoolean("conflict")) syncLocked(id)
    }
    private fun fail(failure: Exception) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        val message = when (failure) { is PlayerApiFailure -> failure.feedback; is IllegalArgumentException, is IllegalStateException -> failure.message; else -> "Geen verbinding. Je partij en wachtende invoer blijven op dit toestel bewaard." }
        emit(ui.copy(syncing = false, offline = failure is java.io.IOException || failure is PlayerApiFailure && failure.status >= 500, error = message))
    }
    private fun absoluteLink(url:String):String { require(url.startsWith('/')&&!url.startsWith("//")||url.startsWith(api.origin+"/"));return if(url.startsWith('/'))api.origin.trimEnd('/')+url else url }
}
