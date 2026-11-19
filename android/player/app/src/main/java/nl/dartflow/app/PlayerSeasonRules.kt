package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.text.input.KeyboardType
import org.json.JSONArray
import org.json.JSONObject

internal fun playerSeasonRuleSettings(values: JSONObject, fixedLegs: Boolean = false): JSONObject = json("inRule" to values.text("inRule", "single"), "outRule" to values.text("outRule", "double")).also { result ->
    val difference = playerDifferenceSettings(values, fixedLegs)
    difference.keys().forEach { key -> result.put(key, difference.get(key)) }
    if (values.optBoolean("handicap")) result.put("sideStartScores", JSONArray(listOf(values.text("homeStart", "501").toIntOrNull() ?: 0, values.text("awayStart", "501").toIntOrNull() ?: 0)))
    if (values.has("legs") && values.text("legs").isNotBlank()) result.put("bestOfLegs", values.text("legs").toIntOrNull() ?: 0)
    if (values.has("sets") && values.text("sets").isNotBlank()) result.put("bestOfSets", values.text("sets").toIntOrNull() ?: 0)
}
internal fun playerSeasonRulesValid(values: JSONObject, baseLegs: Int = 1, baseSets: Int = 1, fixedLegs: Boolean = false): Boolean {
    if (values.text("inRule", "single") !in listOf("single", "double") || values.text("outRule", "double") !in listOf("straight", "double", "master")) return false
    if (values.optBoolean("handicap") && listOf("homeStart", "awayStart").any { values.text(it, "501").toIntOrNull() !in (if (values.text("outRule", "double") == "straight") 1 else 2)..1001 }) return false
    if (values.text("legs").isNotBlank() && values.text("legs").toIntOrNull() !in (1..19 step 2)) return false
    if (values.text("sets").isNotBlank() && values.text("sets").toIntOrNull() !in listOf(1,3,5)) return false
    return playerDifferenceValid(values, values.text("legs").toIntOrNull() ?: baseLegs, values.text("sets").toIntOrNull() ?: baseSets, fixedLegs)
}
@Composable internal fun PlayerSeasonRuleFields(values: JSONObject, enabled: Boolean, slot: Boolean = false, change: (String, Any) -> Unit) {
    Choice("Openen", values.text("inRule", "single"), listOf("single" to "Single in", "double" to "Dubbel in"), { change("inRule", it) }, enabled)
    Choice("Uitgooien", values.text("outRule", "double"), listOf("double" to "Dubbel uit", "straight" to "Straight uit", "master" to "Master uit"), { change("outRule", it) }, enabled)
    PlayerToggle("Handicapstart per zijde", values.optBoolean("handicap"), enabled) { change("handicap", it) }
    if (values.optBoolean("handicap")) listOf("homeStart" to "Startscore thuis", "awayStart" to "Startscore uit").forEach { (key, label) -> Field(label, values.text(key, "501"), { change(key, it) }, enabled, max = 4, keyboard = KeyboardType.Number) }
    if (slot) {
        Choice("Afwijkend best of legs", values.text("legs"), listOf("" to "Basisreglement") + (1..19 step 2).map { "$it" to "Best of $it" }, { change("legs", it) }, enabled)
        Choice("Afwijkend best of sets", values.text("sets"), listOf("" to "Basisreglement") + listOf(1,3,5).map { "$it" to "Best of $it" }, { change("sets", it) }, enabled)
        PlayerDifferenceFields(values, enabled, change)
    }
    if (!playerSeasonRulesValid(values)) Text("Controleer de startscore, in/uitregel en wedstrijdlengte.", color = PlayerError)
}
