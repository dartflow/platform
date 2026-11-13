package nl.dartflow.ochelive

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil

/** Public v1 only: never a player account, writer capability or private history. */
data class Player(val name: String, val remaining: Int, val legs: Int, val sets: Int, val average: Double?, val maxima: Int, val highestFinish: Int)
data class Visit(val player: Int, val score: Int, val remaining: Int, val bust: Boolean)
data class ScoreEvent(val id: String, val revision: Long, val kind: String, val score: Int, val bust: Boolean, val checkout: Boolean, val player: String)
data class Match(val id: String, val revision: Long, val status: String, val players: List<Player>, val turn: Int, val startScore: Int, val leg: Int, val set: Int, val visits: List<Visit>, val events: List<ScoreEvent>, val sessionKey: String) {
    val legKey get() = "$sessionKey:$set:$leg"
    fun rows(): List<List<Visit?>> {
        val columns = players.indices.map { index -> visits.filter { it.player == index } }
        return (0 until maxOf(5, columns.maxOfOrNull { it.size } ?: 0)).map { row -> columns.map { it.getOrNull(row) } }
    }
}
data class Activity(val warningAt: Long, val deadlineAt: Long, val extensionsUsed: Int)
data class DisplaySnapshot(val state: String, val serverNow: Long, val eventId: String, val revision: Long, val boardName: String, val displayName: String, val scope: String, val playUrl: String?, val reservation: String?, val match: Match?, val activity: Activity?) {
    companion object {
        fun parse(json: JSONObject): DisplaySnapshot {
            require(json.getInt("apiVersion") == 1) { "Deze app moet worden bijgewerkt." }
            val display = json.optJSONObject("display")
            val snapshot = display?.optJSONObject("snapshot")
            val match = snapshot?.optJSONObject("match")?.let { m ->
                val remaining = m.optJSONArray("remaining") ?: JSONArray()
                val legs = m.optJSONArray("legs") ?: JSONArray()
                val sets = m.optJSONArray("sets") ?: JSONArray()
                val stats = m.optJSONArray("stats") ?: JSONArray()
                val players = m.optJSONArray("players").objects().mapIndexed { index, p ->
                    val stat = stats.optJSONObject(index)
                    val darts = stat?.optInt("darts") ?: 0
                    val avg = if (darts > 0) 3.0 * stat!!.optDouble("total", 0.0) / darts else null
                    Player(p.optString("displayName").ifBlank { p.optString("name", "Speler ${index + 1}") }, remaining.optInt(index), legs.optInt(index), sets.optInt(index), avg, stat?.optInt("oneEighties") ?: 0, stat?.optInt("highestFinish") ?: 0)
                }
                val leg = m.optInt("legNumber", legs.ints().sum() + 1)
                val visits = (m.optJSONArray("currentLegVisits") ?: m.optJSONArray("visits")).objects().filter { !it.has("leg") || it.optInt("leg") == leg }.map { Visit(it.optInt("playerIndex"), it.optInt("score"), it.optInt("remainingAfter"), it.optBoolean("bust")) }
                val events = snapshot.optJSONArray("scoreEvents").objects().map { ScoreEvent(it.optString("id"), it.optLong("revision"), it.optString("kind"), it.optInt("score"), it.optBoolean("bust"), it.optBoolean("checkout"), it.optString("playerName")) }
                Match(m.getString("id"), m.optLong("revision"), m.optString("status"), players, m.optInt("turn"), m.optInt("currentLegStartScore", m.optJSONObject("settings")?.optInt("startScore", 501) ?: 501), leg, m.optInt("setNumber", 1), visits, events, snapshot.optString("sessionKey", m.getString("id")))
            }
            val board = json.optJSONObject("board") ?: display?.optJSONObject("board")
            val activity = (snapshot?.optJSONObject("boardActivity") ?: snapshot?.optJSONObject("match")?.optJSONObject("boardActivity"))?.let { Activity(it.optLong("warningAt"), it.optLong("deadlineAt"), it.optInt("extensionsUsed")) }
            return DisplaySnapshot(json.getString("state"), json.getLong("serverNow"), json.optString("eventId"), json.optLong("revision"), board?.optString("name") ?: "Mijn scherm", json.optJSONObject("device")?.optString("name") ?: "Oche Live", json.optString("scope"), display?.optJSONObject("board")?.takeIf { it.optBoolean("publicScan", false) }?.optString("playUrl")?.let { if (it.startsWith("/baan/")) BuildConfig.API_ORIGIN + it else it }?.takeIf { it.startsWith("${BuildConfig.API_ORIGIN}/baan/") }, display?.optJSONObject("reservation")?.optString("label"), match, activity)
        }
    }
}
internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
internal fun JSONArray.ints(): List<Int> = (0 until length()).map { optInt(it) }
fun secondsRemaining(deadline: Long, serverTime: Long): Int = maxOf(0, ceil((deadline - serverTime) / 1000.0).toInt())
fun standbySlide(elapsedMs: Long): Int = when (elapsedMs.coerceAtLeast(0) % 30_000) { in 0..4_999 -> 0; in 5_000..14_999 -> 1; else -> 2 }

/** Reconnect/initial snapshots establish a baseline; only new accepted events animate. */
class EventCursor {
    private var session: String? = null
    private var revision = -1L
    private var connected = false
    private val seen = LinkedHashSet<String>()
    fun disconnect() { connected = false }
    fun observe(match: Match?, reset: Boolean = false): ScoreEvent? {
        if (match == null) { session = null; revision = -1; connected = false; seen.clear(); return null }
        if (!connected || reset || session == match.sessionKey && match.revision < revision) {
            connected = true; session = match.sessionKey; revision = match.revision; seen.clear(); seen.addAll(match.events.map { it.id }); return null
        }
        if (session != match.sessionKey) { session = match.sessionKey; revision = -1; seen.clear() }
        val fresh = match.events.filter { it.revision > revision && it.id !in seen }.sortedBy { it.revision }
        revision = maxOf(revision, match.revision)
        seen.addAll(fresh.map { it.id }); if (seen.size > 1024) { seen.clear(); seen.addAll(match.events.map { it.id }) }
        return if (fresh.any { it.kind == "undo" }) null else fresh.lastOrNull { it.kind == "score" && !it.bust && (it.score == 180 || it.checkout && it.score >= 100) }
    }
}
