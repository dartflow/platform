package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject

internal fun playerDifferenceSettings(values: JSONObject, fixedLegs: Boolean = false): JSONObject = JSONObject().also { result ->
    if (!fixedLegs) listOf("leg" to "legWinByTwo", "set" to "setWinByTwo").forEach { (prefix, key) -> if (values.optBoolean("${prefix}TwoDifference")) result.put(key, json("maximum" to (values.text("${prefix}Maximum", if (prefix == "leg") "19" else "9").toIntOrNull() ?: 0))) }
}
internal fun playerDifferenceValid(values: JSONObject, legs: Int, sets: Int, fixedLegs: Boolean = false): Boolean = fixedLegs || listOf("leg" to legs, "set" to sets).all { (prefix, base) ->
    !values.optBoolean("${prefix}TwoDifference") || values.text("${prefix}Maximum", if (prefix == "leg") "19" else "9").toIntOrNull()?.let { it in base..99 && it % 2 == 1 } == true
}
internal fun playerStartSettings(values: JSONObject, fixedLegs: Boolean = false, allowDifference: Boolean = true): JSONObject = json(
    "startProcedure" to values.text("startProcedure", "bull"),
    "setOpener" to values.text("setOpener", "continuous"),
    "decidingLeg" to if (fixedLegs) "continue" else values.text("decidingLeg", "continue"),
    "bestOfSets" to if (fixedLegs) 1 else values.text("bestOfSets", "1").toIntOrNull().let { if (it in listOf(1, 3, 5)) it else 1 },
).let { if (allowDifference) playerWithSettings(it, playerDifferenceSettings(values, fixedLegs)) else it }

@Composable internal fun PlayerStartSettingsFields(values: JSONObject, enabled: Boolean, fixedLegs: Boolean = false, allowDifference: Boolean = true, change: (String, Any) -> Unit) {
    Choice("Wie begint?", values.text("startProcedure", "bull"), listOf("bull" to "Bullen · beide zijden bevestigen", "server-lot" to "Eenmalige serverloting", "home-first" to "Eerste zijde begint volgens reglement"), { change("startProcedure", it) }, enabled)
    if (!fixedLegs) {
        Choice("Best of sets", values.text("bestOfSets", "1"), listOf("1", "3", "5").map { it to "Best of $it" }, { change("bestOfSets", it) }, enabled)
        Choice("Beginner nieuwe set", values.text("setOpener", "continuous"), listOf("continuous" to "Legvolgorde loopt door", "alternate-sets" to "Beginnende zijde wisselt per set"), { change("setOpener", it) }, enabled)
        Choice("Beslissende leg bij gelijke stand", values.text("decidingLeg", "continue"), listOf("continue" to "Gepubliceerde beurtvolgorde behouden", "rebull" to "Opnieuw bullen en beide bevestigen"), { change("decidingLeg", it) }, enabled)
        if (allowDifference) PlayerDifferenceFields(values, enabled, change)
    } else Text("Vaste legs gebruiken één set zonder beslissende-leg-rebull.", color = PlayerMuted)
}
@Composable internal fun PlayerDifferenceFields(values: JSONObject, enabled: Boolean, change: (String, Any) -> Unit) {
    listOf("leg" to "Legs", "set" to "Sets").forEach { (prefix, label) ->
        PlayerToggle("$label winnen met twee verschil", values.optBoolean("${prefix}TwoDifference"), enabled) { change("${prefix}TwoDifference", it) }
        if (values.optBoolean("${prefix}TwoDifference")) Field("Harde cap $label · oneven totaal tot 99", values.text("${prefix}Maximum", if (prefix == "leg") "19" else "9"), { change("${prefix}Maximum", it) }, enabled, max = 2, keyboard = androidx.compose.ui.text.input.KeyboardType.Number)
    }
    if (values.optBoolean("legTwoDifference") || values.optBoolean("setTwoDifference")) Text("De best-of blijft de basis. De cap is een oneven maximaal totaal van minstens die best-of; op de cap beslist één leg of set. Vaste legs en nationale Elo sluiten deze variant uit.", color = PlayerMuted)
}
internal fun playerDifferenceLabel(settings: JSONObject): String = listOf("legWinByTwo" to "legs", "setWinByTwo" to "sets").mapNotNull { (key, label) -> settings.optJSONObject(key)?.let { "$label twee verschil · cap ${it.optInt("maximum")}" } }.joinToString(" · ").let { if (it.isBlank()) "" else " · $it" }

internal fun playerStartResolved(match: PlayerMatch): Boolean = when (match.raw.obj("settings").text("startProcedure")) {
    "bull" -> match.raw.obj("bull").let { it.text("status") == "complete" && it.optJSONArray("confirmed")?.let { flags -> flags.length() == 2 && flags.optBoolean(0) && flags.optBoolean(1) } == true }
    "server-lot" -> match.raw.obj("startDecision").let { it.has("starter") && it.optInt("starter", -1) in 0..1 }
    else -> true
}

@Composable internal fun PlayerStartProcedure(match: PlayerMatch, state: PlayerUiState, actions: PlayerActions) {
    val bull = match.raw.optJSONObject("bull")
    val decision = match.raw.obj("startDecision")
    val enabled = !state.busy && state.online && !state.hasPendingCommand
    if (bull != null) PlayerCard(if (bull.text("reason") == "deciding-leg") "Opnieuw bullen voor beslissende leg" else "Bullen voor de eerste leg") {
        Text("Ronde ${bull.optInt("round", 1)} · set ${bull.optInt("setNumber", 1)} · leg ${bull.optInt("legNumber", 1)}", color = PlayerMuted)
        Text("Alleen het gepubliceerde bullresultaat bepaalt wie begint. Deze pijlen tellen niet mee als score of statistiek.", color = PlayerMuted)
        bull.rows("throws").forEach { hit -> Text("Ronde ${hit.optInt("round")} · ${match.sideName(hit.optInt("side"))}: ${when (hit.text("hit")) { "DB" -> "Dubbele bull"; "SB" -> "Enkele bull"; else -> "Buiten de bull" }}") }
        bull.optJSONArray("order")?.ints()?.let { order -> Text("Werpvolgorde: ${order.joinToString(" → ") { match.sideName(it) }}", color = PlayerLime) }
        if (bull.has("winner")) Text("Beginnende zijde: ${match.sideName(bull.optInt("winner"))}", color = PlayerLime)
        if (match.permissions.optBoolean("canBullThrow")) listOf("DB" to "Dubbele bull geraakt", "SB" to "Enkele bull geraakt", "outside" to "Buiten de bull").forEach { (hit, label) -> Action(label, enabled, false) { actions.matchAction("bull-throw", json("hit" to hit)) } }
        if (match.permissions.optBoolean("canBullConfirm")) Action("Ik bevestig dit bullresultaat", enabled) { actions.matchAction("bull-confirm", JSONObject()) }
        if (match.permissions.optBoolean("canBullConfirmCompanion")) Action("PINgekoppelde speler bevestigt bulluitslag", enabled, false) { actions.matchAction("bull-confirm-companion", JSONObject()) }
        val confirmed = bull.optJSONArray("confirmed")
        Text("Bevestigd: ${match.players.indices.joinToString(" · ") { "${match.sideName(it)} ${if (confirmed?.optBoolean(it) == true) "ja" else "nog niet"}" }}", color = PlayerMuted)
    }
    if (match.permissions.optBoolean("canDrawStart")) PlayerCard("Beginner loten") {
        Text("De server legt één loting vast. Herhalen verandert de uitkomst niet.", color = PlayerMuted)
        Action("Loot beginnende zijde", enabled) { actions.matchAction("draw-start", JSONObject()) }
    }
    if (decision.has("starter")) Text("Beginnende zijde volgens ${when (decision.text("procedure")) { "bull" -> "bullen"; "server-lot" -> "serverloting"; else -> "het reglement" }}: ${match.sideName(decision.optInt("starter"))}", color = PlayerMuted)
}

@Composable internal fun PlayerOfflineConflict(match: PlayerMatch, state: PlayerUiState, actions: PlayerActions) {
    val conflict = match.raw.optJSONObject("offlineConflict") ?: return
    if (conflict.text("status") != "open") return
    var reason by rememberSaveable(conflict.text("id")) { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    PlayerCard("Offline-invoer vraagt beoordeling") {
        Text("Een bewaarde actie hoort bij een oudere stand. Geaccepteerde beurten blijven behouden; de wedstrijd wacht op het besluit van de leiding.", color = PlayerMuted)
        Text("Invoerrevisie ${conflict.optInt("expectedRevision")} · serverrevisie ${conflict.optInt("canonicalRevision")}", color = PlayerMuted)
        if (match.permissions.optBoolean("canManage")) {
            Field("Reden voor behouden serverstand", reason, { reason = it }, !state.busy, max = 1000)
            Action("Controleer verwerpen oude offline-actie", !state.busy && state.online && reason.trim().length >= 3, false) { confirm = true }
        }
    }
    if (confirm) androidx.compose.material3.AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Geaccepteerde serverstand behouden?") }, text = { Text("De oude offline-actie wordt expliciet verworpen. Indien nodig voert de bevoegde schrijver daarna bewust een nieuwe actie in vanaf de actuele stand.") }, confirmButton = { androidx.compose.material3.TextButton(onClick = { confirm = false; actions.matchAction("resolve-offline-conflict", json("conflictId" to conflict.text("id"), "reason" to reason.trim())) }, enabled = !state.busy && state.online && match.permissions.optBoolean("canManage")) { Text("Bevestigen") } }, dismissButton = { androidx.compose.material3.TextButton(onClick = { confirm = false }) { Text("Terug") } })
}
