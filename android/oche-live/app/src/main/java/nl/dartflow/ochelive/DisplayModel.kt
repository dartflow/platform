package nl.dartflow.ochelive

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil

/** Public v1 only: never a player account, writer capability or private history. */
data class Player(val name: String, val remaining: Int, val legs: Int, val sets: Int, val average: Double?, val maxima: Int, val highestFinish: Int, val partners: List<String> = emptyList())
data class Cricket(val marks: List<List<Int>>, val points: List<Int>, val mpr: List<Double?>, val mode: String)
data class Bull(val reason: String, val status: String, val round: Int, val order: List<Int>, val throws: List<Triple<Int, Int, String>>, val winner: Int?, val confirmed: List<Boolean>)
data class StartDecision(val procedure: String, val starter: Int?)
data class Visit(val player: Int, val score: Int, val remaining: Int, val bust: Boolean, val creditedMarks: Int? = null)
data class ScoreEvent(val id: String, val revision: Long, val kind: String, val score: Int, val bust: Boolean, val checkout: Boolean, val player: String)
data class Match(val id: String, val revision: Long, val status: String, val players: List<Player>, val turn: Int, val startScore: Int, val leg: Int, val set: Int, val visits: List<Visit>, val events: List<ScoreEvent>, val sessionKey: String, val paused: Boolean = false, val winnerName: String? = null, val resultPublished: Boolean = false, val checkout: String? = null, val inRule: String = "single", val outRule: String = "double", val sideStartScores: List<Int> = emptyList(), val currentThrowerName: String? = null, val cricket: Cricket? = null, val bull: Bull? = null, val startDecision: StartDecision? = null, val legWinByTwo: Int? = null, val setWinByTwo: Int? = null) {
    val legKey get() = "$sessionKey:$set:$leg"
    fun startFor(index: Int) = sideStartScores.getOrNull(index) ?: startScore
    val startLabel get() = if (cricket != null) "CRICKET" else players.indices.map { startFor(it) }.distinct().joinToString(" / ")
    val startRow get() = if (players.size == 1) listOf("–", "${startFor(0)}") else listOf("–", "${startFor(0)}", "${startFor(1)}", "–")
    val rulesLabel get() = if (cricket != null) "Cricket · " + if (cricket.mode == "no-score") "zonder punten" else "met punten" else (if (inRule == "double") "Dubbel in · " else if (inRule != "single") "Inregel op telefoon · " else "") + when (outRule) { "straight" -> "Straight uit"; "double" -> "Dubbel uit"; "master" -> "Master uit"; else -> "Uitregel op telefoon" }
    val winByTwoLabel get() = listOfNotNull(legWinByTwo?.let { "Legs 2 verschil/cap $it" }, setWinByTwo?.let { "Sets 2 verschil/cap $it" }).joinToString(" · ").let { if (it.isBlank()) "" else " · $it" }
    val finished get() = status in listOf("result", "confirmed", "disputed")
    val bullPending get() = bull != null && bull.status != "complete"
    val canShowTurn get() = status == "live" && !paused && !bullPending
    val bullLabel get() = bull?.let { b ->
        if (b.status == "confirming") "${players.getOrNull(b.winner ?: -1)?.name ?: "Beginnende zijde"} begint · bevestig op telefoon"
        else { val count = b.throws.count { it.first == b.round }; "Ronde ${b.round} · ${players.getOrNull(b.order.getOrNull(count) ?: -1)?.name ?: "Speler"} werpt bull" }
    }
    val statusLabel get() = when {
        status == "disputed" -> "Uitslag in behandeling"
        finished -> if (resultPublished) "Uitslag bevestigd" else "Voorlopige uitslag"
        status == "interrupted" -> "Onderbroken"
        status == "abandoned" -> "Partij beëindigd"
        paused -> "Gepauzeerd"
        bullPending -> if (bull?.reason == "deciding-leg") "Opnieuw bullen" else "Bullen voor start"
        status == "live" -> "● Live"
        else -> "Wacht op start"
    }
    fun rows(): List<List<Visit?>> {
        val columns = players.indices.map { index -> visits.filter { it.player == index } }
        return (0 until maxOf(5, columns.maxOfOrNull { it.size } ?: 0)).map { row -> columns.map { it.getOrNull(row) } }
    }
}
data class PendingCall(val label: String, val players: List<String>, val writerName: String?)
data class Encounter(val name: String, val homeName: String, val awayName: String, val score: List<Int>, val legs: List<Int>, val componentIndex: Int, val componentLabel: String)
data class Activity(val warningAt: Long, val deadlineAt: Long, val extensionsUsed: Int)
/** Composition is independent of physical device rotation. Null retains legacy adaptive rendering. */
data class DisplayLayout(val orientation: String, val scoreboards: Int) {
    init { require(orientation in listOf("portrait", "landscape") && scoreboards in 1..2 && (orientation != "portrait" || scoreboards == 1)) }
    fun json(): JSONObject = JSONObject().put("orientation", orientation).put("scoreboards", scoreboards)
    companion object {
        fun parse(value: JSONObject?): DisplayLayout? = value?.let { runCatching { DisplayLayout(it.getString("orientation"), it.getInt("scoreboards")) }.getOrNull() }
        fun detected(landscape: Boolean) = DisplayLayout(if (landscape) "landscape" else "portrait", 1)
    }
}
data class DisplayPanel(val position: String, val sourceId: String?, val status: String, val snapshot: DisplaySnapshot?)
data class SplitScreenGeometry(val cardWidth: Float, val cardHeight: Float, val railWidth: Float)
/** Two outward-facing 9:16 cards leave a shared rail with one direction per logical half. */
fun splitScreenGeometry(width: Float, height: Float, gap: Float = 12f): SplitScreenGeometry {
    val railMinimum = minOf(260f, width * .28f)
    val cardWidth = minOf(height * 9f / 16f, ((width - gap * 2f - railMinimum) / 2f).coerceAtLeast(0f))
    return SplitScreenGeometry(cardWidth, cardWidth * 16f / 9f, (width - cardWidth * 2f - gap * 2f).coerceAtLeast(0f))
}
data class DisplaySnapshot(val state: String, val serverNow: Long, val eventId: String, val revision: Long, val boardName: String, val displayName: String, val scope: String, val playUrl: String?, val reservation: String?, val match: Match?, val activity: Activity?, val theme: String = "dartflow", val encounter: Encounter? = null, val pendingCall: PendingCall? = null, val layout: DisplayLayout? = null, val configurationRevision: Long? = null, val panels: List<DisplayPanel>? = null) {
    val publicStandby get() = state == "standby" && playUrl != null
    /** Lobby joining uses the same confirmed public board link without a standby carousel. */
    val canScan get() = playUrl != null && state in listOf("standby", "waiting")
    val playing get() = (panels?.mapNotNull { it.snapshot?.match } ?: listOfNotNull(match)).any { !it.finished && it.status in listOf("live", "ready", "interrupted") }
    val safeForLayoutSetup get() = !playing && state !in listOf("live", "warning") && panels.orEmpty().none { it.status == "error" || it.snapshot?.state in listOf("live", "warning") }
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
                val identities = m.optJSONArray("players").objects()
                val players = identities.mapIndexed { index, p ->
                    val stat = stats.optJSONObject(index)
                    val darts = stat?.optInt("darts") ?: 0
                    val avg = if (darts > 0) 3.0 * stat!!.optDouble("total", 0.0) / darts else null
                    val partners = m.optJSONArray("sideParticipants")?.optJSONArray(index).objects().map { it.optString("displayName").ifBlank { it.optString("name", "Speler") } }
                    val sideName = m.optJSONArray("sideNames")?.optString(index)?.takeIf { it.isNotBlank() && it != "null" }
                        ?: partners.takeIf { it.isNotEmpty() }?.joinToString(" & ")
                        ?: p.optString("displayName").ifBlank { p.optString("name", "Speler ${index + 1}") }
                    Player(sideName, remaining.optInt(index), legs.optInt(index), sets.optInt(index), avg, stat?.optInt("oneEighties") ?: 0, stat?.optInt("highestFinish") ?: 0, partners)
                }
                val finished = m.optString("status") in listOf("result", "confirmed", "disputed")
                val leg = m.optInt("legNumber", maxOf(1, legs.ints().sum() + if (finished) 0 else 1))
                val visits = (m.optJSONArray("currentLegVisits") ?: m.optJSONArray("visits")).objects().filter { !it.has("leg") || it.optInt("leg") == leg }.map { Visit(it.optInt("playerIndex"), it.optInt("score"), it.optInt("remainingAfter"), it.optBoolean("bust"), it.optJSONObject("cricket")?.optInt("creditedMarks")) }
                val events = snapshot.optJSONArray("scoreEvents").objects().map { ScoreEvent(it.optString("id"), it.optLong("revision"), it.optString("kind"), it.optInt("score"), it.optBoolean("bust"), it.optBoolean("checkout"), it.optString("playerName")) }
                val winner = m.optString("winnerId").takeIf { it.isNotBlank() && it != "null" }?.let { id -> identities.indexOfFirst { it.optString("id") == id }.takeIf { it >= 0 }?.let { players[it].name } }
                val settings = m.optJSONObject("settings")
                val startScore = m.optInt("currentLegStartScore", settings?.optInt("startScore", 501) ?: 501)
                val sideStarts = settings?.optJSONArray("sideStartScores")?.let { values -> players.indices.map { index -> values.optInt(index, startScore).takeIf { it in 1..1001 } ?: startScore } } ?: emptyList()
                val cricket = m.optJSONObject("cricket")?.let { c ->
                    val allVisits = m.optJSONArray("visits").objects()
                    Cricket((0..1).map { c.optJSONArray("marks")?.optJSONArray(it)?.ints().orEmpty().map { value -> value.coerceIn(0,3) } }, c.optJSONArray("points")?.ints().orEmpty(), (0..1).map { side -> val own = allVisits.filter { it.optInt("playerIndex") == side && it.has("cricket") }; val darts = own.sumOf { it.optInt("darts") }; if (darts > 0) 3.0 * own.sumOf { it.optJSONObject("cricket")?.optInt("creditedMarks") ?: 0 } / darts else null }, settings?.optString("cricketMode", "standard") ?: "standard")
                }
                val bull = m.optJSONObject("bull")?.let { b -> Bull(b.optString("reason"), b.optString("status"), b.optInt("round", 1), b.optJSONArray("order")?.ints().orEmpty().filter { it in 0..1 }, b.optJSONArray("throws").objects().map { Triple(it.optInt("round"), it.optInt("side"), it.optString("hit")) }, b.optInt("winner", -1).takeIf { it in 0..1 }, (0..1).map { b.optJSONArray("confirmed")?.optBoolean(it) == true }) }
                val decision = m.optJSONObject("startDecision")?.let { StartDecision(it.optString("procedure"), it.optInt("starter", -1).takeIf { n -> n in 0..1 }) }
                Match(m.getString("id"), m.optLong("revision"), m.optString("status"), players, m.optInt("turn"), startScore, leg, m.optInt("setNumber", 1), visits, events, snapshot.optString("sessionKey", m.getString("id")), m.optBoolean("paused"), winner, m.optBoolean("resultPublished"), m.optString("checkout").takeIf { it.isNotBlank() && it != "null" }, settings?.optString("inRule", "single") ?: "single", settings?.optString("outRule", "double") ?: "double", sideStarts, m.optJSONObject("currentThrower")?.let { it.optString("displayName").ifBlank { it.optString("name") } }?.takeIf { it.isNotBlank() }, cricket, bull, decision, settings?.optJSONObject("legWinByTwo")?.optInt("maximum"), settings?.optJSONObject("setWinByTwo")?.optInt("maximum"))
            }
            val board = json.optJSONObject("board") ?: display?.optJSONObject("board")
            val activity = (snapshot?.optJSONObject("boardActivity") ?: snapshot?.optJSONObject("match")?.optJSONObject("boardActivity"))?.let { Activity(it.optLong("warningAt"), it.optLong("deadlineAt"), it.optInt("extensionsUsed")) }
            val pendingCall = snapshot?.optJSONObject("pendingCall")?.let { c -> PendingCall(c.optString("label"), c.optJSONArray("players")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty(), c.optString("writerName").takeIf { it.isNotBlank() && it != "null" }) }
            val encounter = snapshot?.optJSONObject("encounter")?.let { e -> val component = e.optJSONObject("component"); Encounter(e.optString("name"), e.optString("homeName"), e.optString("awayName"), e.optJSONArray("score")?.ints().orEmpty(), e.optJSONArray("legs")?.ints().orEmpty(), component?.optInt("index") ?: 0, component?.optString("label").orEmpty()) }
            // A failed panel cannot prevent the other panel's valid projection from rendering.
            val panels = json.optJSONArray("panels")?.let { values ->
                listOf("left", "right").map { position ->
                    val panel = values.objects().firstOrNull { it.optString("position") == position }
                    val sourceId = panel?.optString("sourceId")?.takeIf { it.isNotBlank() && it != "null" }
                    val projection = panel?.optJSONObject("snapshot")?.let { runCatching { parse(it) }.getOrNull() }
                    val status = panel?.optString("status")?.takeIf { it in listOf("ready", "unassigned", "unavailable", "error") } ?: "unassigned"
                    DisplayPanel(position, sourceId, if (status == "ready" && projection == null) "error" else status, projection.takeIf { status == "ready" })
                }
            }
            return DisplaySnapshot(json.getString("state"), json.getLong("serverNow"), json.optString("eventId"), json.optLong("revision"), board?.optString("name") ?: "Mijn scherm", json.optJSONObject("device")?.optString("name") ?: "Oche Live", json.optString("scope"), display?.optJSONObject("board")?.takeIf { it.optBoolean("publicScan", false) }?.optString("playUrl")?.let { if (it.startsWith("/baan/")) BuildConfig.API_ORIGIN + it else it }?.takeIf { it.startsWith("${BuildConfig.API_ORIGIN}/baan/") }, display?.optJSONObject("reservation")?.optString("label"), match, activity, snapshot?.optJSONObject("theme")?.takeIf { it.optInt("version") == 1 && it.optString("id") in listOf("dartflow", "onzetrots") }?.optString("id") ?: "dartflow", encounter, pendingCall, DisplayLayout.parse(json.optJSONObject("layout")), json.optLong("configurationRevision").takeIf { json.has("configurationRevision") && !json.isNull("configurationRevision") }, panels)
        }
    }
}
internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
internal fun JSONArray.ints(): List<Int> = (0 until length()).map { optInt(it) }
/** Only an installation with a retained grant may restore its encrypted public projection. */
fun cachedDisplay(saved: JSONObject): DisplaySnapshot? = if (saved.optString("refreshToken").isBlank()) null else runCatching { DisplaySnapshot.parse(saved.getJSONObject("lastSnapshot")) }.getOrNull()
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
        val identity = "${match.sessionKey}:${match.id}"
        val retainedGap = match.events.size >= 64 && revision < (match.events.minOfOrNull { it.revision } ?: 0) - 1
        if (!connected || reset || session != identity || match.revision < revision || retainedGap) {
            connected = true; session = identity; revision = match.revision; seen.clear(); seen.addAll(match.events.map { it.id }); return null
        }
        val fresh = match.events.filter { it.revision > revision && it.id !in seen }.sortedBy { it.revision }
        revision = maxOf(revision, match.revision)
        seen.addAll(fresh.map { it.id }); if (seen.size > 1024) { seen.clear(); seen.addAll(match.events.map { it.id }) }
        return if (match.cricket != null || fresh.any { it.kind == "undo" }) null else fresh.lastOrNull { it.kind == "score" && !it.bust && (it.score == 180 || it.checkout && it.score >= 100) }
    }
}

/** Each stable TV position owns a baseline; changing its source invalidates only that baseline. */
class PanelEventCursors {
    private val cursors = mutableMapOf<String, EventCursor>()
    private val sources = mutableMapOf<String, String?>()
    fun disconnect() { cursors.values.forEach { it.disconnect() } }
    fun observe(panels: List<DisplayPanel>?, reset: Boolean = false): Map<String, ScoreEvent> {
        val result = mutableMapOf<String, ScoreEvent>()
        for (panel in panels.orEmpty()) {
            val cursor = cursors.getOrPut(panel.position) { EventCursor() }
            val changed = !sources.containsKey(panel.position) || sources[panel.position] != panel.sourceId
            sources[panel.position] = panel.sourceId
            cursor.observe(panel.snapshot?.match, reset || changed)?.let { result[panel.position] = it }
        }
        val active = panels.orEmpty().map { it.position }.toSet()
        cursors.keys.retainAll(active); sources.keys.retainAll(active)
        return result
    }
}

/** Clear grants and cached public projections while retaining the installation's confirmed choice. */
fun revokedInstallation(saved: JSONObject): JSONObject = JSONObject().apply {
    DisplayLayout.parse(saved.optJSONObject("layoutChoice"))?.let { put("layoutChoice", it.json()) }
    if (saved.optBoolean("layoutPromptShown")) put("layoutPromptShown", true)
}
