package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.KeyboardType
import org.json.JSONArray
import org.json.JSONObject

internal val playerTournamentPhases = listOf("pool", "knockout", "league", "winners", "losers", "final", "reset", "swiss")
private val tournamentRuleChoices = linkedMapOf(
    "startScore" to listOf("301", "501", "701"), "bestOfLegs" to (1..19 step 2).map { "$it" }, "bestOfSets" to listOf("1", "3", "5"),
    "discipline" to listOf("x01", "cricket"), "cricketMode" to listOf("standard", "no-score"), "inRule" to listOf("single", "double"), "outRule" to listOf("double", "straight", "master"),
    "startProcedure" to listOf("bull", "server-lot", "home-first"), "setOpener" to listOf("continuous", "alternate-sets"), "decidingLeg" to listOf("continue", "rebull"),
)
/** A partial profile: an empty control inherits the published base/phase setting. */
internal fun playerTournamentRuleOverride(values: JSONObject, base: JSONObject): JSONObject? {
    val phase = values.text("phase", "pool")
    val round = values.text("round").trim()
    if (phase !in playerTournamentPhases || round.isNotEmpty() && round.toIntOrNull() !in 1..256) return null
    val settings = JSONObject()
    for ((key, allowed) in tournamentRuleChoices) {
        val value = values.text(key)
        if (value.isBlank()) continue
        if (value !in allowed) return null
        settings.put(key, if (key in listOf("startScore", "bestOfLegs", "bestOfSets")) value.toInt() else value)
    }
    if (values.optBoolean("handicap")) {
        val minimum = if (settings.text("outRule", base.text("outRule", "double")) == "straight") 1 else 2
        val starts = listOf("homeStart", "awayStart").map { values.text(it, "501").toIntOrNull() }
        if (starts.any { it !in minimum..1001 }) return null
        settings.put("sideStartScores", JSONArray(starts))
    }
    if (!playerDifferenceValid(values, settings.optInt("bestOfLegs", base.optInt("bestOfLegs", 3)), settings.optInt("bestOfSets", base.optInt("bestOfSets", 1)))) return null
    val difference = playerDifferenceSettings(values)
    difference.keys().forEach { key -> settings.put(key, difference.get(key)) }
    if (settings.length() == 0) return null
    return json("phase" to phase, "settings" to settings).also { if (round.isNotEmpty()) it.put("round", round.toInt()) }
}
private fun tournamentRuleName(key: String, value: String): String = when (key) {
    "discipline" -> if (value == "cricket") "Cricket" else "X01"
    "cricketMode" -> if (value == "no-score") "Zonder punten" else "Met punten"
    "inRule" -> if (value == "double") "Dubbel in" else "Single in"
    "outRule" -> when (value) { "straight" -> "Straight uit"; "master" -> "Master uit"; else -> "Dubbel uit" }
    "startProcedure" -> when (value) { "bull" -> "Bullen · beide bevestigen"; "server-lot" -> "Eenmalige serverloting"; else -> "Eerste zijde begint" }
    "setOpener" -> if (value == "alternate-sets") "Beginner wisselt per set" else "Legvolgorde loopt door"
    "decidingLeg" -> if (value == "rebull") "Opnieuw bullen" else "Beurtvolgorde behouden"
    "bestOfLegs", "bestOfSets" -> "Best of $value"
    else -> value
}

@Composable internal fun PlayerTournamentRules(event: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val body = event.obj("state")
    var rules by rememberSaveable(event.text("id"), event.optInt("revision")) { mutableStateOf(body.optJSONArray("tournamentRuleOverrides")?.toString() ?: "[]") }
    var fields by rememberSaveable(event.text("id")) { mutableStateOf("{}") }
    var expanded by rememberSaveable(event.text("id")) { mutableStateOf(false) }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val enabled = event.optBoolean("canManage") && state.online && !state.busy && body.rows("fixtures").isEmpty()
    fun change(key: String, value: Any) { fields = JSONObject(fields).put(key, value).toString() }
    PlayerCard("Reglement per fase of ronde") {
        Text("Niet ingevulde velden erven het basisreglement, daarna de faseregel. Een specifieke ronderegel gaat voor. Echte poulebeslissers houden hun vaste 501 best-of-five-profiel.", color = PlayerMuted)
        JSONArray(rules).objects().forEachIndexed { index, rule ->
            Text("${playerTournamentPhaseLabel(rule.text("phase"))}${if (rule.has("round")) " · ronde ${rule.optInt("round")}" else " · alle ronden"}", color = PlayerLime)
            rule.obj("settings").let { settings -> Text(settings.keys().asSequence().joinToString(" · ") { key -> when (key) { "legWinByTwo" -> "Legs twee verschil, cap ${settings.obj(key).optInt("maximum")}"; "setWinByTwo" -> "Sets twee verschil, cap ${settings.obj(key).optInt("maximum")}"; "sideStartScores" -> "Handicap ${settings.optJSONArray(key)?.ints()?.joinToString("–")}"; else -> tournamentRuleName(key, settings.text(key)) } }, color = PlayerMuted) }
            if (enabled) Action("Verwijder profiel ${index + 1}", primary = false) { rules = JSONArray(JSONArray(rules).objects().filterIndexed { at, _ -> at != index }).toString() }
        }
        if (!enabled) { Text("Fase- en ronderegels worden vóór de loting vastgelegd.", color = PlayerMuted); return@PlayerCard }
        Action(if (expanded) "Sluit faseprofiel" else "Faseprofiel toevoegen of vervangen", primary = false) { expanded = !expanded }
        if (expanded) {
            val values = JSONObject(fields)
            Choice("Fase", values.text("phase", "pool"), playerTournamentPhases.map { it to playerTournamentPhaseLabel(it) }, { change("phase", it) }, enabled)
            Field("Ronde · leeg voor hele fase", values.text("round"), { change("round", it) }, enabled, max = 3, keyboard = KeyboardType.Number)
            val labels = listOf("startScore" to "Startscore", "bestOfLegs" to "Legs", "bestOfSets" to "Sets", "discipline" to "Discipline", "cricketMode" to "Cricketregels", "inRule" to "Openen", "outRule" to "Uitgooien", "startProcedure" to "Wie begint?", "setOpener" to "Beginner nieuwe set", "decidingLeg" to "Beslissende leg")
            labels.forEach { (key, label) -> Choice(label, values.text(key), listOf("" to "Erven uit basis- of faseregel") + tournamentRuleChoices.getValue(key).map { it to tournamentRuleName(key, it) }, { change(key, it) }, enabled) }
            PlayerToggle("Afwijkende handicapstart voor dit profiel", values.optBoolean("handicap"), enabled) { change("handicap", it) }
            if (values.optBoolean("handicap")) listOf("homeStart" to "Start eerste zijde", "awayStart" to "Start tweede zijde").forEach { (key, label) -> Field(label, values.text(key, "501"), { change(key, it) }, enabled, max = 4, keyboard = KeyboardType.Number) }
            PlayerDifferenceFields(values, enabled, ::change)
            val inherited = JSONObject(body.obj("settings").toString())
            if (values.text("round").isNotBlank()) JSONArray(rules).objects().find { it.text("phase") == values.text("phase", "pool") && !it.has("round") }?.obj("settings")?.let { settings -> settings.keys().forEach { key -> inherited.put(key, settings.get(key)) } }
            val candidate = playerTournamentRuleOverride(values, inherited)
            Action("Bewaar faseprofiel in voorstel", candidate != null) {
                candidate?.let { new -> rules = JSONArray(JSONArray(rules).objects().filterNot { it.text("phase") == new.text("phase") && it.optInt("round") == new.optInt("round") } + new).toString(); expanded = false; fields = "{}" }
            }
        }
        Action("Controleer vastleggen fase- en ronderegels", enabled && JSONArray(rules).length() <= 64, false) { pending = json("expectedRevision" to event.optInt("revision"), "action" to json("type" to "competition.rules", "id" to event.text("id"), "overrides" to JSONArray(rules))) }
    }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text("Fase- en ronderegels vastleggen?") }, text = { Text("Deze expliciete profielen gelden bij de volgende loting. De server valideert de volledige combinatie en bewaart de effectieve regels per partij. Na de loting kun je ze niet meer wijzigen.") }, confirmButton = { TextButton(onClick = { pending = null; actions.command("/platform/actions", command) }, enabled = enabled) { Text("Leg reglement vast") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Terug") } }) }
}
