package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject

internal fun playerSeasonDelegationCandidates(season: JSONObject, remove: Boolean): List<JSONObject> {
    if (!season.obj("capabilities").optBoolean("canDelegate")) return emptyList()
    val managers = season.optJSONArray("managerIds")?.strings().orEmpty()
    return season.rows("delegationCandidates").filter { it.text("id").isNotBlank() && if (remove) it.text("id") in managers else it.optBoolean("active") && it.text("id") !in managers }.distinctBy { it.text("id") }
}

@Composable internal fun PlayerSeasonDelegation(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    if (!season.obj("capabilities").optBoolean("canDelegate")) return
    var player by rememberSaveable(season.text("id")) { mutableStateOf("") }
    var remove by rememberSaveable(season.text("id")) { mutableStateOf(false) }
    var reason by rememberSaveable(season.text("id")) { mutableStateOf("") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val candidates = playerSeasonDelegationCandidates(season, remove)
    val enabled = state.online && !state.busy
    PlayerCard("Leiding voor dit seizoen") {
        Text("Deze delegatie geeft uitsluitend beheer over dit ene seizoen. De server controleert de actuele bevoegdheid; er worden geen platform- of clubrollen verleend.", color = PlayerMuted)
        val managers = season.optJSONArray("managerIds")?.strings().orEmpty()
        season.rows("delegationCandidates").filter { it.text("id") in managers }.forEach { Text("${it.text("name")}${if (!it.optBoolean("active")) " · niet actief, intrekken blijft mogelijk" else ""}", color = PlayerLime) }
        Choice("Delegatie wijzigen", if (remove) "remove" else "add", listOf("add" to "Leiding toevoegen", "remove" to "Delegatie intrekken"), { remove = it == "remove"; player = "" }, enabled)
        Choice("Account voor seizoensleiding", player, listOf("" to "Kies bevoegd account") + candidates.map { it.text("id") to it.text("name") }, { player = it }, enabled)
        Field("Reden voor seizoensdelegatie", reason, { reason = it }, enabled, max = 1000)
        Action("Controleer seizoensdelegatie", enabled && candidates.any { it.text("id") == player } && reason.trim().length >= 5, false) {
            pending = json("expectedRevision" to season.optInt("revision"), "action" to json("type" to "season.manager", "seasonId" to season.text("id"), "playerId" to player, "remove" to remove, "reason" to reason.trim()))
        }
    }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text("Seizoensdelegatie bevestigen?") }, text = { Text("${if (command.obj("action").optBoolean("remove")) "Trek de delegatie in" else "Verleen seizoensleiding"} voor ${season.rows("delegationCandidates").find { it.text("id") == command.obj("action").text("playerId") }?.text("name") ?: "het gekozen account"} bij ${season.text("name")}.\n${command.obj("action").text("reason")}") }, confirmButton = { TextButton(onClick = { pending = null; actions.command("/seasons/actions", command) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Terug") } }) }
}
