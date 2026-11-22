package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
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
internal fun playerNeedsDartDetail(settings: JSONObject): Boolean = settings.text("discipline", "x01") in listOf("cricket", "tactics") || settings.text("inRule", "single") == "double" || settings.text("outRule", "double") != "double"

/** No default Material button padding: five actual targets must fit without wrapping S20. */
@Composable internal fun PlayerDartPad(multiplier: String, enabled: Boolean, onMultiplier: (String) -> Unit, onHit: (String) -> Unit, showMultiplier: Boolean = true) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf("S" to "Single", "D" to "Dubbel", "T" to "Triple").forEach { (value, label) ->
            FilledTonalButton(onClick = { onMultiplier(value) }, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("dart-segment-$value").semantics { contentDescription = "$value · $label" }, shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(2.dp), colors = ButtonDefaults.filledTonalButtonColors(containerColor = if (multiplier == value) PlayerLime else PlayerPanel, contentColor = if (multiplier == value) PlayerInk else PlayerText)) { Text(label, maxLines = 1, softWrap = false, fontSize = 14.sp) }
        }
    }
    (1..20).chunked(5).forEach { row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) { row.forEach { target ->
        FilledTonalButton(onClick = { onHit("$multiplier$target") }, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("dart-target-$target").semantics { contentDescription = "$multiplier$target" }, shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(2.dp), colors = ButtonDefaults.filledTonalButtonColors(containerColor = PlayerPanel, contentColor = PlayerText)) { Text(if (showMultiplier) "$multiplier$target" else "$target", maxLines = 1, softWrap = false, fontSize = 18.sp, fontWeight = FontWeight.Bold) }
    } } }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf("MISS" to "Mis", "SB" to "25", "DB" to "Bull 50").forEach { (hit, label) ->
            FilledTonalButton(onClick = { onHit(hit) }, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("dart-hit-$hit"), shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(2.dp), colors = ButtonDefaults.filledTonalButtonColors(containerColor = PlayerPanel, contentColor = PlayerText)) { Text(label, maxLines = 1, softWrap = false, fontSize = 16.sp) }
        }
    }
}

/** Only records observed targets; the server applies opening, finish and bust rules. */
@Composable internal fun PlayerDartScoreEntry(match: PlayerMatch, state: PlayerUiState, actions: PlayerActions) {
    var hits by rememberSaveable(match.id) { mutableStateOf(listOf<String>()) }
    var multiplier by rememberSaveable { mutableStateOf("S") }
    var details by remember { mutableStateOf(false) }
    var previousRevision by rememberSaveable(match.id) { mutableIntStateOf(match.revision) }
    LaunchedEffect(match.revision) { if (match.revision != previousRevision) { hits = emptyList(); previousRevision = match.revision } }
    val enabled = match.permissions.optBoolean("canScore") && !state.busy && (state.online || match.raw.optBoolean("offlineSupported")) && !state.hasPendingCommand
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(hits.joinToString(" · ").ifBlank { "Raakvlak per pijl" }, Modifier.weight(1f).testTag("entered-dart-hits"), color = PlayerLime, maxLines = 2)
        TextButton(onClick = { hits = hits.dropLast(1) }, enabled = enabled && hits.isNotEmpty(), modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = "Laatste pijl wissen" }) { Text("⌫") }
        TextButton(onClick = { details = true }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Scorekaart") }
    }
    PlayerDartPad(multiplier, enabled && hits.size < 3, { multiplier = it }, { hits = hits + it }, showMultiplier = false)
    state.error?.let { Notice(it, true, actions.retry) }
    if (state.hasPendingCommand) Notice("Je vorige worp wacht op bevestiging.", retry = actions.retry)
    Action(if (state.busy) "Pijlen worden bevestigd…" else "Bevestig deze pijlen", enabled && hits.isNotEmpty(), modifier = Modifier.fillMaxWidth().testTag("confirm-dart-hits")) { actions.matchAction("score", playerDartCommand(hits)) }
    }
    if (details) AlertDialog(onDismissRequest = { details = false }, title = { Text("Scorekaart & spelregels") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (playerIsCricket(match)) PlayerCricketTable(match) else Text(playerRuleLabel(match.raw.obj("settings")), color = PlayerLime)
            Text("Voer de werkelijk geraakte vakken in volgorde in. Stop na een finish of bust.", color = PlayerMuted)
        }
    }, confirmButton = { TextButton(onClick = { details = false }) { Text("Terug naar scoren") } })
}
