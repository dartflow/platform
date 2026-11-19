package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject

internal fun playerSeasonFixtureMode(season: JSONObject, fixture: JSONObject): String? = when (season.obj("settings").text("playMode")) { "hybrid" -> fixture.text("playMode").takeIf { it in listOf("local", "remote") }; "remote" -> "remote"; else -> "local" }

@Composable internal fun PlayerSeasonPlayMode(season: JSONObject, fixture: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    if (season.obj("settings").text("playMode") != "hybrid") return
    var mode by rememberSaveable(fixture.text("id")) { mutableStateOf("local") }
    var reason by rememberSaveable(fixture.text("id")) { mutableStateOf("") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val enabled = state.online && !state.busy
    val capabilities = fixture.obj("capabilities")
    val current = playerSeasonFixtureMode(season, fixture)
    Text(if (current == null) "Hybride ontmoeting · speelwijze nog niet afgesproken" else "Afgesproken speelwijze: ${if (current == "remote") "op afstand met twee fysieke banen" else "samen op locatie"}", color = PlayerLime)
    fixture.optJSONObject("playModeProposal")?.let { proposal ->
        Text("Voorstel ${if (proposal.text("side") == "home") "thuiszijde" else "uitzijde"}: ${if (proposal.text("mode") == "remote") "op afstand" else "samen op locatie"} · ${shortDate(proposal.text("at"))}", color = PlayerMuted)
        if (capabilities.optBoolean("canAcceptMode")) Action("Accepteer voorgestelde speelwijze", enabled, false) { pending = json("type" to "season.accept-play-mode", "fixtureId" to fixture.text("id")) }
    }
    if (capabilities.optBoolean("canProposeMode")) {
        Choice("Speelwijze voorstellen", mode, listOf("local" to "Samen op locatie", "remote" to "Op afstand · twee banen"), { mode = it }, enabled)
        Field("Toelichting speelwijze", reason, { reason = it }, enabled, max = 1000)
        Action(if (capabilities.optBoolean("canManage")) "Controleer vastleggen speelwijze door leiding" else "Stel speelwijze voor aan andere zijde", enabled && reason.trim().length >= 3, false) { pending = json("type" to "season.play-mode", "fixtureId" to fixture.text("id"), "playMode" to mode, "reason" to reason.trim()) }
    }
    pending?.let { action -> AlertDialog(onDismissRequest = { pending = null }, title = { Text("Speelwijze bevestigen?") }, text = { Text("Na een fysieke baankoppeling of een aangemaakte partij staat deze keuze vast. Op afstand koppelen beide zijden hun eigen fysieke baan en schrijver. De server controleert dat jij deze zijde of de leiding mag vertegenwoordigen.") }, confirmButton = { TextButton(onClick = { pending = null; playerSeasonCommand(actions, season, action.text("type"), action) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Terug") } }) }
}
