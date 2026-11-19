package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject

internal fun playerSeasonRemoteReady(fixture: JSONObject): Boolean {
    val assignments = fixture.obj("remoteAssignments")
    val home = assignments.obj("home"); val away = assignments.obj("away")
    return home.text("boardId").isNotBlank() && away.text("boardId").isNotBlank() && home.text("boardId") != away.text("boardId") && home.text("writerId").isNotBlank() && away.text("writerId").isNotBlank() && home.text("writerId") != away.text("writerId")
}

@Composable internal fun PlayerSeasonRemoteAssignments(season: JSONObject, fixture: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    Text("Officieel op afstand · twee fysieke banen en eigen schrijvers", style = MaterialTheme.typography.titleMedium)
    val boards = (season.rows("boards") + state.platform.rows("clubBoards") + state.resource.obj("locationContext").rows("locations").flatMap { it.rows("boards") } + state.resource.obj("locationContext").rows("reservations").filter { it.text("eventId") == season.text("eventId") && it.text("status") == "accepted" }.flatMap { it.rows("boards") }).distinctBy { it.text("id") }.filter { !it.optBoolean("blocked") && !it.optBoolean("closed") && !it.optBoolean("archived") }
    val people = (season.rows("eligiblePlayers") + state.platform.rows("players") + listOfNotNull(state.profile?.let { json("id" to it.id, "name" to it.displayName.ifBlank { it.name }) })).distinctBy { it.text("id") }
    Text("Een eigen thuisbaan koppelen geldt als toestemming van de eigenaar voor dit officiële speelblok. Een externe locatie moet de reservering vooraf goedkeuren.", color = PlayerMuted)
    val enabled = !state.busy && state.online
    listOf("home" to "Thuiszijde", "away" to "Uitzijde").forEach { (side, label) -> key(side) {
        val assignment = fixture.obj("remoteAssignments").obj(side)
        var boardId by rememberSaveable { mutableStateOf(assignment.text("boardId")) }
        var writerId by rememberSaveable { mutableStateOf(assignment.text("writerId")) }
        Text(label, color = PlayerLime)
        if (assignment.text("boardId").isNotBlank()) Text("${boards.find { it.text("id") == assignment.text("boardId") }?.text("name") ?: "Gekoppelde fysieke baan"} · ${people.find { it.text("id") == assignment.text("writerId") }?.text("name") ?: "Toegewezen schrijver"}", color = PlayerMuted)
        else Text("Nog geen baan en schrijver gekoppeld.", color = PlayerMuted)
        if (fixture.obj("capabilities").optBoolean(if (side == "home") "canBindHome" else "canBindAway")) {
            Choice("Baan voor $label", boardId, listOf("" to "Kies geregistreerde fysieke baan") + boards.map { it.text("id") to it.text("name") }, { boardId = it }, enabled)
            Choice("Eigen schrijver voor $label", writerId, listOf("" to "Kies account schrijver") + people.map { it.text("id") to it.text("displayName", it.text("name")) }, { writerId = it }, enabled)
            Action("Koppel baan en schrijver · $label", enabled && boardId.isNotBlank() && writerId.isNotBlank(), false) { playerSeasonCommand(actions, season, "season.remote-bind", json("fixtureId" to fixture.text("id"), "side" to side, "boardId" to boardId, "writerId" to writerId)) }
        }
    } }
    Text(if (playerSeasonRemoteReady(fixture)) "Beide zijden zijn gekoppeld. De server controleert bij de start opnieuw baanrechten, bezetting, aanwezigheid en schrijvers." else "Beide zijden moeten verschillende fysieke banen en hun eigen schrijver koppelen voordat de partij kan starten.", color = PlayerMuted)
}
