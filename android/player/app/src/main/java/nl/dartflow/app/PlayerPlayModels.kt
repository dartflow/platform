package nl.dartflow.app

import java.net.URI
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal val playerPlayModes = listOf("x01", "cricket", "tactics", "around", "bingo", "finish", "leg-challenge")
internal fun playerPlayModeName(mode: String) = when (mode) { "x01" -> "301 / 501 / 701"; "cricket" -> "Cricket"; "tactics" -> "Tactics"; "around" -> "Around the Clock"; "bingo" -> "Dubbelbingo"; "finish" -> "Finishtraining"; "leg-challenge" -> "Versla mijn leg"; else -> "Onbekende spelvorm" }
internal fun playerPlayDefaultRules(mode: String, start: Int = 301): JSONObject {
    require(mode in playerPlayModes)
    val base = json("version" to 1, "mode" to mode)
    return when (mode) {
        "x01" -> base.put("startScore", start).put("inRule", if (start == 301) "double" else "single").put("outRule", "double").put("bestOfLegs", 1).put("bestOfSets", 1)
        "cricket" -> base.put("points", true).put("bestOfLegs", 1).put("bestOfSets", 1)
        "tactics" -> base.put("preset", "tactics-5").put("requiredMarks", 5).put("points", true).put("tieRule", "replay").put("bestOfLegs", 1).put("bestOfSets", 1)
        "around" -> base.put("segment", "any").put("bull", "any").put("order", "ascending").put("hitsPerTarget", 1)
        "bingo" -> base.put("win", "line")
        "finish" -> base.put("target", 68).put("attemptCount", 5).put("outRule", "double").put("routeHelp", true)
        else -> base
    }
}
internal fun playerPlayRulesLabel(rules: JSONObject): String = when (rules.text("mode")) {
    "x01" -> "${rules.optInt("startScore")} · ${if (rules.text("inRule") == "double") "dubbel openen" else "open start"} · ${playerPlayOutLabel(rules.text("outRule"))} · best of ${rules.optInt("bestOfLegs", 1)} legs / ${rules.optInt("bestOfSets", 1)} sets"
    "cricket" -> "Cricket · 20–15 en bull · 3 treffers · ${if (rules.optBoolean("points", true)) "met punten" else "zonder punten"}"
    "tactics" -> "${if (rules.text("preset") == "tactics-3") "Tactics 3" else "Tactics 5"} · 20–10 en bull · ${rules.optInt("requiredMarks", 5)} treffers · ${if (rules.optBoolean("points", true)) "met punten" else "zonder punten"} · ${if (rules.text("tieRule") == "replay") "gelijk: leg overspelen" else "sluiten met minstens evenveel punten"}"
    "around" -> "Around the Clock · ${rules.text("segment")} · bull ${rules.text("bull")} · ${rules.text("order")} · ${rules.optInt("hitsPerTarget", 1)} treffer(s) per doel"
    "bingo" -> "Dubbelbingo · ${if (rules.text("win") == "full-card") "volle kaart" else "eerste lijn"}${rules.text("cardCode").takeIf(String::isNotBlank)?.let { " · kaart $it" }.orEmpty()}"
    "finish" -> "Finish ${rules.optInt("target")} · ${rules.optInt("attemptCount", 5)} pogingen van maximaal 3 pijlen · ${playerPlayOutLabel(rules.text("outRule"))}"
    "leg-challenge" -> "Versla mijn leg · ${rules.obj("source").optInt("startScore")} · ${if (rules.text("comparison") == "darts") "vergelijking op betrouwbare pijlen" else "vergelijking op beurten; dezelfde beurt is gelijk"}"
    else -> "Deze spelvorm vereist een appupdate."
}
internal fun playerPlayOutLabel(value: String) = when (value) { "straight" -> "straight uit"; "master" -> "master uit"; else -> "dubbel uit" }

data class PlayerPlaySession(val raw: JSONObject) {
    override fun toString() = "PlayerPlaySession(id=$id, revision=$revision, mode=${rules.text("mode")}, private=[redacted])"
    val id get() = raw.text("id")
    val revision get() = raw.optInt("revision")
    val game get() = raw.obj("game")
    val rules get() = raw.obj("rules").takeIf { it.length() > 0 } ?: game.obj("rules")
    val progress get() = game.obj("progress")
    val participants get() = raw.rows("participants")
    val sides get() = game.rows("sides")
    val turn get() = game.optInt("turn")
    val permissions get() = raw.obj("permissions")
    val supported get() = rules.optInt("version") == 1 && rules.text("mode") in playerPlayModes
    val complete get() = raw.text("status") == "completed" || game.text("status") == "finished"
    fun participantName(id: String) = participants.find { it.text("id") == id }?.text("name") ?: "Speler"
    fun sideName(index: Int) = sides.getOrNull(index)?.optJSONArray("playerIds")?.strings()?.joinToString(" & ", transform = ::participantName) ?: participants.getOrNull(index)?.text("name", "Speler") ?: "Speler"
    fun currentName() = participantName(game.text("currentThrowerId"))
    fun publicCache() = JSONObject(raw.toString()).also { it.remove("privateAccess") }
}

/** Timer, writer and other session-only revisions do not acknowledge a score draft. */
internal fun playerPlayDraftKey(session: PlayerPlaySession): String = "${session.game.optInt("set", 1)}:${session.game.optInt("leg", 1)}:${session.game.optInt("attempt", 1)}:${session.game.rows("visits").size}"

/** Private fragments never become API query strings, account credentials or navigation labels. */
internal class PlayerPlayLink(val sessionId: String, val purpose: String?, val token: String?) {
    override fun toString() = "PlayerPlayLink(session=$sessionId, purpose=$purpose, credential=[redacted])"
    companion object {
        fun parse(value: String, origin: String): PlayerPlayLink? = runCatching {
            val base = URI(origin); val uri = URI(if (value.startsWith('/') && !value.startsWith("//")) origin.trimEnd('/') + value else value)
            require(uri.scheme == base.scheme && uri.host == base.host && uri.port == base.port && uri.userInfo == null && uri.rawQuery == null)
            val id = Regex("/(?:app/)?spelen/([0-9a-fA-F-]{36})/?").matchEntire(uri.path)?.groupValues?.get(1) ?: return null
            require(UUID.fromString(id).toString().equals(id, true))
            val fragment = uri.rawFragment?.let { PlayerLinks.query(URI("https://private.invalid/?$it")) }.orEmpty()
            require(fragment.size <= 1 && fragment.keys.all { it in setOf("claim", "recover", "recovery", "participant", "join", "controller") })
            val purpose = fragment.keys.firstOrNull(); val token = fragment.values.firstOrNull()
            require(token == null || token.length in 16..2048 && token.all { it.isLetterOrDigit() || it in "-_.~" })
            PlayerPlayLink(id, purpose, token)
        }.getOrNull()
    }
}

internal fun playerPlayQueueCommand(session: PlayerPlaySession, input: JSONObject, offset: Int, requestId: String = UUID.randomUUID().toString()) = json("requestId" to requestId, "expectedRevision" to session.revision + offset, "writerEpoch" to session.raw.obj("writer").optInt("epoch"), "rulesHash" to session.raw.text("rulesHash"), "participantId" to session.game.text("currentThrowerId"), "input" to JSONObject(input.toString()))
internal fun playerPlayDistinctNames(values: List<String>) = values.all(::validPlayerName) && values.map { PlayerValidation.normalizeName(it).lowercase(java.util.Locale.ROOT) }.distinct().size == values.size

internal class PlayerChallengeLink(val id: String, val token: String?) {
    override fun toString() = "PlayerChallengeLink(id=$id, credential=[redacted])"
    companion object { fun parse(value: String, origin: String): PlayerChallengeLink? = runCatching {
        val base=URI(origin);val uri=URI(if(value.startsWith('/')&&!value.startsWith("//"))origin.trimEnd('/')+value else value)
        require(uri.scheme==base.scheme&&uri.host==base.host&&uri.port==base.port&&uri.userInfo==null&&uri.rawQuery==null)
        val id=Regex("/leg/([0-9a-fA-F-]{36})/?").matchEntire(uri.path)?.groupValues?.get(1)?:return null
        require(UUID.fromString(id).toString().equals(id,true))
        val fragment=uri.rawFragment?.let{PlayerLinks.query(URI("https://private.invalid/?$it"))}.orEmpty()
        require(fragment.isEmpty()||fragment.size==1&&fragment.containsKey("code"))
        val token=fragment["code"];require(token==null||token.length in 16..2048&&token.all{it in 'A'..'Z'||it in 'a'..'z'||it in '0'..'9'||it in "-_.~"})
        PlayerChallengeLink(id,token)
    }.getOrNull() }
}
