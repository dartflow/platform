package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.KeyboardType
import org.json.JSONArray
import org.json.JSONObject

/** Returns only game settings; identity and outcomes never come from this form. */
@Composable internal fun PlayerRuleFields(enabled: Boolean, includeStartProcedure: Boolean = true, freshStartScore: Int? = null): JSONObject {
    var discipline by rememberSaveable { mutableStateOf("x01") }
    var tacticsPreset by rememberSaveable { mutableStateOf("tactics-5") }
    var tacticsMode by rememberSaveable { mutableStateOf("standard") }
    var cricketMode by rememberSaveable { mutableStateOf("standard") }
    var selectedInRule by rememberSaveable { mutableStateOf<String?>(null) }
    val inRule = playerFreshStartInRule(freshStartScore, selectedInRule)
    var outRule by rememberSaveable { mutableStateOf("double") }
    var handicap by rememberSaveable { mutableStateOf(false) }
    var left by rememberSaveable { mutableStateOf("501") }
    var right by rememberSaveable { mutableStateOf("501") }
    var startValues by rememberSaveable { mutableStateOf("{}") }
    Choice("Discipline", discipline, listOf("x01" to "X01", "cricket" to "Cricket", "tactics" to "Tactics"), { discipline = it }, enabled)
    if (discipline == "cricket") Choice("Cricketregels", cricketMode, listOf("standard" to "Met punten", "no-score" to "Zonder punten"), { cricketMode = it }, enabled)
    else if (discipline == "tactics") {
        Choice("Tactics-preset", tacticsPreset, listOf("tactics-5" to "Tactics 5 · vijf treffers", "tactics-3" to "Tactics 3 · drie treffers"), { tacticsPreset = it }, enabled)
        Choice("Tacticsregels", tacticsMode, listOf("standard" to "Met punten", "no-score" to "Zonder punten"), { tacticsMode = it }, enabled)
        Text("Doelen 20 tot en met 10 en bull. Gelijk gesloten Tactics 5 met punten wordt overgespeeld zonder legwinst.", color = PlayerMuted)
    } else {
        Choice("Openen", inRule, listOf("single" to "Single in", "double" to "Dubbel in"), { selectedInRule = it }, enabled)
        Choice("Uitgooien", outRule, listOf("double" to "Dubbel uit", "straight" to "Straight uit", "master" to "Master uit"), { outRule = it }, enabled)
        PlayerToggle("Handicap per zijde", handicap, enabled) { handicap = it }
        if (handicap) {
            Field("Startscore eerste zijde", left, { left = it }, enabled, max = 4, keyboard = KeyboardType.Number)
            Field("Startscore tweede zijde", right, { right = it }, enabled, max = 4, keyboard = KeyboardType.Number)
            Text("Gebruik een startscore tot 1001; de server controleert de combinatie met de uitgooiveregel.", color = PlayerMuted)
        }
    }
    if (includeStartProcedure) PlayerStartSettingsFields(JSONObject(startValues), enabled) { key, value -> startValues = JSONObject(startValues).put(key, value).toString() }
    return json("discipline" to discipline, "cricketMode" to cricketMode, "tacticsPreset" to tacticsPreset, "tacticsMode" to tacticsMode, "inRule" to if (discipline != "x01") "single" else inRule, "outRule" to if (discipline != "x01") "double" else outRule).also {
        if (includeStartProcedure) playerStartSettings(JSONObject(startValues)).keys().forEach { key -> it.put(key, playerStartSettings(JSONObject(startValues)).get(key)) }
        if (handicap && discipline == "x01") it.put("sideStartScores", JSONArray(listOf(left.toIntOrNull() ?: 0, right.toIntOrNull() ?: 0)))
    }
}

/** Only fresh creation forms use the 301 preset; an explicit choice remains authoritative. */
internal fun playerFreshStartInRule(startScore: Int?, selected: String? = null): String = selected ?: if (startScore == 301) "double" else "single"

internal fun playerWithSettings(command: JSONObject, settings: JSONObject): JSONObject = JSONObject(command.toString()).also { result -> settings.keys().forEach { key -> result.put(key, settings.get(key)) } }

internal fun playerTrainingMatch(entity: JSONObject, profile: PlayerProfile?): PlayerMatch {
    val training=entity.obj("state");val game = training.obj("game")
    val mayScore=entity.optBoolean("canManage")&&!training.optBoolean("interrupted")&&!training.optBoolean("completed")&&!training.optBoolean("nativeAwaitingReceipt")&&training.obj("offlineConflict").text("status")!="open"&&(training.text("mode")!="bot"||game.optInt("turn")==0)
    val value = JSONObject(game.toString()).put("offlineSupported",entity.obj("state").optBoolean("offlineSupported")).put("id", entity.text("id")).put("revision", entity.optInt("revision")).put("permissions", json("canScore" to mayScore))
    value.put("settings", json("discipline" to game.text("discipline", "x01"), "cricketMode" to game.text("cricketMode", "standard"), "tacticsPreset" to game.text("tacticsPreset","tactics-5"), "tacticsMode" to game.text("tacticsMode","standard"), "inRule" to game.text("inRule", "single"), "outRule" to game.text("outRule", "double"), "startScore" to game.optInt("startScore", 501)).also { settings -> game.optJSONArray("sideStartScores")?.let { settings.put("sideStartScores", it) } })
    value.put("players", JSONArray(listOf(json("id" to profile?.id, "name" to (profile?.displayName?.ifBlank { profile.name } ?: "Speler")))))
    return PlayerMatch.parse(value)
}

internal fun playerRuleLabel(settings: JSONObject): String = if (settings.text("discipline") == "tactics") "${settings.text("tacticsPreset", "tactics-5").replace("tactics-", "Tactics ")} · ${if (settings.text("tacticsMode", "standard") == "no-score") "zonder punten" else "met punten"}" else if (settings.text("discipline", "x01") == "cricket") "Cricket · ${if (settings.text("cricketMode", "standard") == "no-score") "zonder punten" else "met punten"}" else {
    val starts = settings.optJSONArray("sideStartScores")?.ints()?.joinToString(" / ") ?: settings.text("startScore", "501")
    "$starts · ${if (settings.text("inRule", "single") == "double") "dubbel in · " else ""}${when (settings.text("outRule", "double")) { "straight", "straight-out" -> "straight uit"; "master", "master-out" -> "master uit"; else -> "dubbel uit" }}${playerDifferenceLabel(settings)}"
}
