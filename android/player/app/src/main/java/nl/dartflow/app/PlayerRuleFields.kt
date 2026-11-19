package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.KeyboardType
import org.json.JSONArray
import org.json.JSONObject

/** Returns only game settings; identity and outcomes never come from this form. */
@Composable internal fun PlayerRuleFields(enabled: Boolean): JSONObject {
    var discipline by rememberSaveable { mutableStateOf("x01") }
    var cricketMode by rememberSaveable { mutableStateOf("standard") }
    var inRule by rememberSaveable { mutableStateOf("single") }
    var outRule by rememberSaveable { mutableStateOf("double") }
    var handicap by rememberSaveable { mutableStateOf(false) }
    var left by rememberSaveable { mutableStateOf("501") }
    var right by rememberSaveable { mutableStateOf("501") }
    Choice("Discipline", discipline, listOf("x01" to "X01", "cricket" to "Cricket"), { discipline = it }, enabled)
    if (discipline == "cricket") Choice("Cricketregels", cricketMode, listOf("standard" to "Met punten", "no-score" to "Zonder punten"), { cricketMode = it }, enabled)
    else {
        Choice("Openen", inRule, listOf("single" to "Single in", "double" to "Dubbel in"), { inRule = it }, enabled)
        Choice("Uitgooien", outRule, listOf("double" to "Dubbel uit", "straight" to "Straight uit", "master" to "Master uit"), { outRule = it }, enabled)
        PlayerToggle("Handicap per zijde", handicap, enabled) { handicap = it }
        if (handicap) {
            Field("Startscore eerste zijde", left, { left = it }, enabled, max = 4, keyboard = KeyboardType.Number)
            Field("Startscore tweede zijde", right, { right = it }, enabled, max = 4, keyboard = KeyboardType.Number)
            Text("Gebruik een startscore tot 1001; de server controleert de combinatie met de uitgooiveregel.", color = PlayerMuted)
        }
    }
    return json("discipline" to discipline, "cricketMode" to cricketMode, "inRule" to if (discipline == "cricket") "single" else inRule, "outRule" to if (discipline == "cricket") "double" else outRule).also {
        if (handicap && discipline == "x01") it.put("sideStartScores", JSONArray(listOf(left.toIntOrNull() ?: 0, right.toIntOrNull() ?: 0)))
    }
}

internal fun playerWithSettings(command: JSONObject, settings: JSONObject): JSONObject = JSONObject(command.toString()).also { result -> settings.keys().forEach { key -> result.put(key, settings.get(key)) } }

internal fun playerTrainingMatch(entity: JSONObject, profile: PlayerProfile?): PlayerMatch {
    val game = entity.obj("state").obj("game")
    val value = JSONObject(game.toString()).put("id", entity.text("id")).put("revision", entity.optInt("revision")).put("permissions", json("canScore" to entity.optBoolean("canManage")))
    value.put("settings", json("discipline" to game.text("discipline", "x01"), "cricketMode" to game.text("cricketMode", "standard"), "inRule" to game.text("inRule", "single"), "outRule" to game.text("outRule", "double"), "startScore" to game.optInt("startScore", 501)).also { settings -> game.optJSONArray("sideStartScores")?.let { settings.put("sideStartScores", it) } })
    value.put("players", JSONArray(listOf(json("id" to profile?.id, "name" to (profile?.displayName?.ifBlank { profile.name } ?: "Speler")))))
    return PlayerMatch.parse(value)
}

internal fun playerRuleLabel(settings: JSONObject): String = if (settings.text("discipline", "x01") == "cricket") "Cricket · ${if (settings.text("cricketMode", "standard") == "no-score") "zonder punten" else "met punten"}" else {
    val starts = settings.optJSONArray("sideStartScores")?.ints()?.joinToString(" / ") ?: settings.text("startScore", "501")
    "$starts · ${if (settings.text("inRule", "single") == "double") "dubbel in · " else ""}${when (settings.text("outRule", "double")) { "straight", "straight-out" -> "straight uit"; "master", "master-out" -> "master uit"; else -> "dubbel uit" }}"
}
