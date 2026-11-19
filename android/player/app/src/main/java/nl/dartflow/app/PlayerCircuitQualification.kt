package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject
import java.time.LocalDate

@Composable internal fun PlayerCircuitQualification(state: PlayerUiState, actions: PlayerActions) {
    val selected = state.resource.obj("selectedList")
    val qualification = state.resource.obj("qualification")
    val enabled = !state.busy && state.online
    val generation = selected.text("generation", state.resource.text("generation"))
    val unavailable = state.resource.text("qualificationUnavailableReason")
    var reason by rememberSaveable(selected.text("id")) { mutableStateOf("") }
    var name by rememberSaveable(selected.text("id")) { mutableStateOf("") }
    var date by rememberSaveable(selected.text("id")) { mutableStateOf("") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    PlayerCard("Circuitfinale · acht geplaatste spelers") {
        Text("De acht definitieve circuitavonden bepalen de kwalificatie. Gelijkheid op de grens wordt beslist met echte best-of-vijf partijen. De finale is een afzonderlijk knock-outtoernooi.", color = PlayerMuted)
        if (unavailable.isNotBlank()) Notice(unavailable)
        if (qualification.length() == 0) Text("Er is nog geen kwalificatiedossier voor deze circuitgeneratie.", color = PlayerMuted)
        else {
            Text("${when (qualification.text("status")) { "deciding" -> "Beslissingswedstrijden nodig"; "qualified" -> "Acht finalisten vastgesteld"; "finale" -> "Finale aangemaakt"; else -> "Kwalificatie in beoordeling" }} · revisie ${qualification.optInt("revision")}", color = PlayerLime)
            Text("Bron ${qualification.text("sourceGeneration")} · actuele generatie ${qualification.text("currentGeneration")}", color = PlayerMuted)
            if (qualification.optBoolean("stale")) Notice("De bronstand is gewijzigd. Dit dossier en de bestaande beslissers of finale blijven bewaard. Bereken de kwalificatie opnieuw op de actuele generatie voordat verdere sportbesluiten worden genomen.", true)
            qualification.rows("qualified").forEachIndexed { index, player -> Text("${index + 1}. ${player.text("name")} · geplaatst", color = PlayerLime) }
            if (qualification.rows("boundaryPlayers").isNotEmpty()) {
                Text("Grensgroep · nog ${qualification.optInt("placesRemaining")} plaatsen", style = MaterialTheme.typography.titleMedium)
                qualification.rows("boundaryPlayers").forEach { Text(it.text("name")) }
            }
            qualification.rows("snapshot").forEach { row -> Text("${row.optInt("position")}. ${row.text("name")} · ${row.optInt("points")} punten · tellend: ${row.optJSONArray("countingResults")?.ints()?.joinToString(", ").orEmpty()}", color = PlayerMuted) }
            qualification.rows("fixtures").forEach { fixture ->
                Text("Ronde ${fixture.optInt("round")} · ${playerTournamentPhaseLabel(fixture.text("phase"))} · ${statusLabel(fixture.text("status"))}", color = PlayerMuted)
                Text(fixture.optJSONArray("players")?.let { players -> (0 until players.length()).joinToString(" – ") { players.optJSONObject(it)?.text("name") ?: "Wacht op vorige ronde" } }.orEmpty())
                if (fixture.text("matchId").isNotBlank()) Action("Open kwalificatiepartij", primary = false) { actions.navigate(PlayerScreen.MATCH, fixture.text("matchId")) }
            }
            if (qualification.text("decisionEventId").isNotBlank()) Action("Open beslissingsprogramma", primary = false) { actions.navigate(if (qualification.optBoolean("canManage")) PlayerScreen.DIRECTOR else PlayerScreen.EVENT, qualification.text("decisionEventId")) }
            if (qualification.text("finaleId").isNotBlank()) Action("Open afzonderlijke circuitfinale", primary = false) { actions.navigate(PlayerScreen.EVENT, qualification.text("finaleId")) }
        }
        if (state.resource.optBoolean("canCreateQualification") || qualification.optBoolean("canManage")) Field("Reden kwalificatiebesluit", reason, { reason = it }, enabled, max = 1000, multiline = true)
        if (state.resource.optBoolean("canCreateQualification") && (qualification.length() == 0 || qualification.optBoolean("stale"))) Action(if (qualification.optBoolean("stale")) "Herbereken op actuele circuitgeneratie" else "Controleer top acht en grensgelijkheid", enabled && generation.isNotBlank() && unavailable.isBlank() && reason.trim().length >= 5, false) {
            pending = json("type" to "qualification.create", "listId" to selected.text("id"), "expectedGeneration" to generation, "reason" to reason)
        }
        if (qualification.optBoolean("canManage") && !qualification.optBoolean("stale")) when (qualification.text("status")) {
            "deciding" -> Action("Verwerk werkelijk bevestigde beslissers", enabled && reason.trim().length >= 5, false) { pending = json("type" to "qualification.advance", "qualificationId" to qualification.text("id"), "expectedRevision" to qualification.optInt("revision"), "reason" to reason) }
            "qualified" -> {
                Field("Naam afzonderlijke finale", name, { name = it }, enabled, max = 100)
                Field("Datum finale · jjjj-mm-dd", date, { date = it }, enabled, max = 10)
                Text("Deze finale voegt geen negende circuitavond of circuitpunten toe.", color = PlayerMuted)
                Action("Controleer afzonderlijke knock-outfinale", enabled && name.trim().length >= 3 && runCatching { LocalDate.parse(date) }.isSuccess && reason.trim().length >= 5) { pending = json("type" to "qualification.finale", "qualificationId" to qualification.text("id"), "expectedRevision" to qualification.optInt("revision"), "name" to name.trim(), "date" to date, "reason" to reason) }
            }
        }
    }
    pending?.let { captured -> AlertDialog(onDismissRequest = { pending = null }, title = { Text("Kwalificatiebesluit bevestigen?") }, text = { Text("${captured.text("reason")}\nDe server controleert de getoonde bronversie en leidt plaatsing uitsluitend af uit werkelijk bevestigde uitslagen. Een bestaande finale wordt niet stilzwijgend heringedeeld.") }, confirmButton = { TextButton(onClick = { pending = null; playerRankingAction(actions, captured.text("type"), captured) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}
