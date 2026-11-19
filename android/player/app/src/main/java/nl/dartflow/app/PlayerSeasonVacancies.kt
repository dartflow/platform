package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject

/** The server chooses the rightful candidate; the client never sends a replacement player. */
@Composable internal fun PlayerSeasonVacancies(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val vacancies = season.rows("vacancies")
    val source = season.obj("promotionSource")
    if (source.length() == 0 && vacancies.isEmpty()) return
    val canManage = season.optBoolean("canManage") && season.text("publishedAt").isBlank() && season.rows("fixtures").none { it.obj("classification").text("kind") !in listOf("promotion", "vacancy") }
    val enabled = canManage && !state.busy && state.online
    var division by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var qualification by rememberSaveable { mutableStateOf("") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    fun review(type: String, values: JSONObject) { pending = JSONObject(values.toString()).put("type", type).put("expectedRevision", season.optInt("revision")).put("reason", reason.trim()) }
    fun name(id: String) = season.rows("participants").find { it.text("id") == id }?.text("name") ?: season.rows("eligiblePlayers").find { it.text("id") == id }?.text("name") ?: "Kandidaat uit de gepubliceerde sportieve volgorde"
    PlayerCard("Vrijgevallen divisieplaatsen") {
        Text("Bronseizoen ${source.text("seasonId")} · bronrevisie ${source.optInt("revision")}. Een vrijgevallen plaats volgt de vastgelegde sportieve volgorde. Gelijkheid wordt op de baan beslist.", color = PlayerMuted)
        val order = source.obj("sportingOrder")
        if (order.length() > 0) {
            Text("Sportieve volgorde gepubliceerd ${shortDate(order.text("publishedAt"))} · ${order.text("policy")}", color = PlayerMuted)
            order.rows("groups").forEach { group -> Text("Niveau ${group.optInt("level")} · ${group.optJSONArray("playerIds")?.strings().orEmpty().joinToString(" / ", transform = ::name)}", color = PlayerMuted) }
        }
        if (canManage) {
            Choice("Divisie met open plaats", division, listOf("" to "Kies divisie") + season.rows("divisions").map { it.text("id") to it.text("name") }, { division = it }, enabled)
            Field("Reden vrijgevallen plaats of besluit", reason, { reason = it }, enabled, max = 1000)
            Action("Controleer volgende rechthebbende", enabled && division.isNotBlank() && reason.trim().length >= 5, false) { review("season.vacancy-plan", json("divisionId" to division)) }
        }
        vacancies.forEach { vacancy -> key(vacancy.text("id")) {
            val divisionName = season.rows("divisions").find { it.text("id") == vacancy.text("divisionId") }?.text("name") ?: "Divisie"
            Text("$divisionName · ${when (vacancy.text("status")) { "deciding" -> "Beslissingswedstrijden nodig"; "ready" -> "Rechthebbende vastgesteld"; "qualification" -> "Kwalificatiebron nodig"; "confirmed" -> "Plaats bekrachtigd"; "canceled" -> "Voorstel ingetrokken"; else -> "In beoordeling" }}", color = PlayerLime)
            vacancy.text("candidateId").takeIf { it.isNotBlank() }?.let { Text(name(it)) }
            vacancy.optJSONArray("candidateIds")?.strings().orEmpty().takeIf { vacancy.text("candidateId").isBlank() }?.forEach { Text(name(it), color = PlayerMuted) }
            vacancy.text("reason").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
            Text("Sportieve bronrevisie ${vacancy.optInt("sourceRevision")}", color = PlayerMuted)
            if (canManage && vacancy.optBoolean("canCancel")) Action("Trek vacaturevoorstel in · $divisionName", enabled && reason.trim().length >= 5, false) { review("season.vacancy-cancel", json("vacancyId" to vacancy.text("id"))) }
            when (vacancy.text("status")) {
                "deciding" -> Text("Speel en bevestig de echte 501 best-of-vijf beslissingswedstrijden in Programma en uitslagen voordat de plek wordt bekrachtigd.", color = PlayerMuted)
                "ready" -> if (canManage) Action("Bekrachtig rechthebbende · $divisionName", enabled && reason.trim().length >= 5, false) { review("season.vacancy-confirm", json("vacancyId" to vacancy.text("id"))) }
                "qualification" -> if (canManage) {
                    val sources = season.rows("availableVacancyQualificationSources")
                    val boundSource = vacancy.text("qualificationSourceSeasonId")
                    if (boundSource.isBlank()) {
                        Choice("Vooraf gepubliceerde kwalificatie", qualification, listOf("" to "Kies geldige bron vóór de eerste worp") + sources.map { it.text("id") to it.text("name") }, { qualification = it }, enabled)
                        Action("Leg kwalificatiebron vast · $divisionName", enabled && sources.any { it.text("id") == qualification } && reason.trim().length >= 5, false) { review("season.vacancy-qualification", json("vacancyId" to vacancy.text("id"), "sourceSeasonId" to qualification)) }
                    } else {
                        Text("Kwalificatiebron vastgelegd ${shortDate(vacancy.text("qualificationPublishedAt"))}. Speel en bevestig de echte bronpartijen; daarna wordt de rechthebbende opnieuw gecontroleerd.", color = PlayerMuted)
                        Action("Open vastgelegde kwalificatie", primary = false) { actions.navigate(PlayerScreen.SEASON, boundSource) }
                        Action("Controleer definitieve kwalificatie · $divisionName", enabled && reason.trim().length >= 5, false) { review("season.vacancy-qualification", json("vacancyId" to vacancy.text("id"), "sourceSeasonId" to boundSource)) }
                    }
                }
            }
        } }
        if (vacancies.isEmpty()) Text("Er is nog geen vrije plaats ter beoordeling vastgelegd.", color = PlayerMuted)
    }
    pending?.let { captured -> AlertDialog(onDismissRequest = { pending = null }, title = { Text("Vrijgevallen plaats beoordelen?") }, text = { Text("${captured.text("reason")}\nDe server controleert bronrevisie, capaciteit, gelijke standen en de volgende rechthebbende. Een vrij gekozen speler kan deze volgorde niet vervangen.") }, confirmButton = { TextButton(onClick = {
        pending = null
        playerSeasonCommand(actions, season, captured.text("type"), JSONObject(captured.toString()).also { it.remove("expectedRevision") }, captured.optInt("expectedRevision"))
    }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}
