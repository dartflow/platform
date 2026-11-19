package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

internal fun playerDartValue(hit: String): Int = when (hit) {
    "MISS" -> 0
    "SB" -> 25
    "DB" -> 50
    else -> {
        val match = Regex("([SDT])([1-9]|1[0-9]|20)").matchEntire(hit) ?: throw IllegalArgumentException("Ongeldige pijl.")
        match.groupValues[2].toInt() * when (match.groupValues[1]) { "D" -> 2; "T" -> 3; else -> 1 }
    }
}
internal fun playerDartCommand(hits: List<String>): JSONObject {
    require(hits.size in 1..3) { "Een beurt bevat één tot drie pijlen." }
    return json("score" to hits.sumOf(::playerDartValue), "darts" to hits.size, "dartHits" to JSONArray(hits))
}
internal fun playerNeedsDartDetail(settings: JSONObject): Boolean = settings.text("discipline", "x01") == "cricket" || settings.text("inRule", "single") == "double" || settings.text("outRule", "double") != "double"

/** Only records observed targets; the server applies opening, finish and bust rules. */
@Composable internal fun PlayerDartScoreEntry(match: PlayerMatch, state: PlayerUiState, actions: PlayerActions) {
    var hits by rememberSaveable(match.id) { mutableStateOf(listOf<String>()) }
    var multiplier by rememberSaveable { mutableStateOf("S") }
    var previousRevision by rememberSaveable(match.id) { mutableIntStateOf(match.revision) }
    LaunchedEffect(match.revision) { if (match.revision != previousRevision) { hits = emptyList(); previousRevision = match.revision } }
    val enabled = match.permissions.optBoolean("canScore") && !state.busy && state.online && !state.hasPendingCommand
    val settings = match.raw.obj("settings")
    if (playerIsCricket(match)) PlayerCricketTable(match) else Text("${if (settings.text("inRule", "single") == "double") "Dubbel in" else "Single in"} · ${when (settings.text("outRule", "double")) { "master" -> "Master uit"; "straight" -> "Straight uit"; else -> "Dubbel uit" }}", color = PlayerLime)
    Text("Voer de geraakte vakken in volgorde in. Stop na een finish of bust.", color = PlayerMuted)
    Text(hits.mapIndexed { index, hit -> "${index + 1}: ${when (hit) { "MISS" -> "Mis"; "SB" -> "Bull 25"; "DB" -> "Bull 50"; else -> hit }}" }.joinToString(" · ").ifBlank { "Nog geen pijlen ingevoerd" }, style = MaterialTheme.typography.titleMedium)
    Choice("Geraakt vak", multiplier, listOf("S" to "Single", "D" to "Dubbel", "T" to "Triple"), { multiplier = it }, enabled && hits.size < 3)
    (1..20).chunked(5).forEach { row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) { row.forEach { target ->
        Action("$target", enabled && hits.size < 3, false, Modifier.weight(1f)) { hits = hits + "$multiplier$target" }
    } } }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf("MISS" to "Mis", "SB" to "Bull 25", "DB" to "Bull 50").forEach { (hit, label) -> Action(label, enabled && hits.size < 3, false, Modifier.weight(1f)) { hits = hits + hit } }
    }
    Action("Laatste pijl wissen", enabled && hits.isNotEmpty(), false) { hits = hits.dropLast(1) }
    state.error?.let { Notice(it, true, actions.retry) }
    if (state.hasPendingCommand) Notice("Je vorige worp wacht op bevestiging.", retry = actions.retry)
    Action(if (state.busy) "Pijlen worden bevestigd…" else "Bevestig deze pijlen", enabled && hits.isNotEmpty(), modifier = Modifier.fillMaxWidth().testTag("confirm-dart-hits")) { actions.matchAction("score", playerDartCommand(hits)) }
}
