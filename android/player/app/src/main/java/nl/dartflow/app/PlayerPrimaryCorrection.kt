package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject

internal fun playerPrimaryCorrectionCommand(actions: PlayerActions, matchId: String, action: JSONObject) = actions.command("/matches/$matchId/corrections/actions", json("action" to action))
private val correctionCategories = listOf("score" to "Score of gespeelde beurt", "eligibility" to "Speelgerechtigdheid", "conduct" to "Gedrag rond deze uitslag", "camera" to "Cameraverbinding", "other" to "Ander bezwaar tegen deze uitslag")
private fun correctionMomentLabel(moment: JSONObject) = "Set ${moment.optInt("setNumber")} · leg ${moment.optInt("leg")} · ${moment.text("playerName")} · ${moment.optInt("score")} punten / ${moment.optInt("darts")} darts${if (moment.optBoolean("bust")) " · bust" else ""}${if (moment.optBoolean("checkout")) " · finish" else ""}"

@Composable internal fun PlayerPrimaryCorrectionPanel(match: PlayerMatch, state: PlayerUiState, actions: PlayerActions) {
    val data = state.resource.obj("corrections")
    if (data.length() == 0) return
    val enabled = !state.busy && state.online
    var count by rememberSaveable(match.id) { mutableStateOf("1") }
    var reason by rememberSaveable(match.id) { mutableStateOf("") }
    var category by rememberSaveable(match.id) { mutableStateOf("score") }
    var moment by rememberSaveable(match.id) { mutableStateOf("") }
    var evidence by rememberSaveable(match.id) { mutableStateOf("") }
    var lateReason by rememberSaveable(match.id) { mutableStateOf("") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    PlayerCard("Bezwaar en correctie na ondertekening") {
        Text("Een onafhankelijke wedstrijdleider beoordeelt het bezwaar tegen deze uitslag. Goedkeuring heropent de bewaarde partij voor werkelijke herinvoer en nieuwe ondertekening door beide zijden. Betrokken rankingstanden worden opnieuw berekend.", color = PlayerMuted)
        val policy = data.obj("policy")
        if (policy.length() > 0) Text("Indienen binnen ${policy.optInt("requestHours")} uur · reactie ${policy.optInt("responseHours")} uur · beroep ${policy.optInt("appealHours")} uur · bewijs ${policy.optInt("evidenceDays")} dagen bewaard.", color = PlayerMuted)
        if (match.raw.obj("primaryCorrection").text("phase") == "rescoring") Notice("Deze partij is heropend voor werkelijke herinvoer en nieuwe ondertekening.")
        data.optJSONObject("dependencyHold")?.text("message")?.takeIf { it.isNotBlank() }?.let { Notice(it) }
        if (data.optBoolean("canRequest")) {
            Choice("Categorie bezwaar tegen deze uitslag", category, correctionCategories, { category = it }, enabled)
            val moments = data.rows("moments").takeLast(data.optInt("maxUndoCount").coerceAtLeast(0))
            if (moments.isNotEmpty() || moment.isNotBlank()) Choice("Aangewezen werkelijk gespeelde beurt", moment, listOf("" to "Kies aantal laatste beurten") + moments.map { "${it.optInt("visitIndex")}" to correctionMomentLabel(it) }, { moment = it }, enabled)
            if (moment.isBlank()) {
                Field("Aantal laatste beurten herstellen", count, { count = it }, enabled, keyboard = androidx.compose.ui.text.input.KeyboardType.Number, max = 3)
                Text("Maximaal ${data.optInt("maxUndoCount")} beurten uit de bewaarde scorehistorie.", color = PlayerMuted)
            } else Text("De server leidt het herstelpunt af uit de aangewezen oorspronkelijke beurt.", color = PlayerMuted)
            Field("Wat moet worden gecorrigeerd?", reason, { reason = it }, enabled, max = 1000, multiline = true)
            Field("Onderbouwing of bewijs · optioneel", evidence, { evidence = it }, enabled, max = 4000, multiline = true)
            if (policy.length() > 0) Field("Reden later indienen · na ${policy.optInt("requestHours")} uur verplicht", lateReason, { lateReason = it }, enabled, max = 1000, multiline = true)
            val validMoment = moment.isNotBlank() && moments.any { "${it.optInt("visitIndex")}" == moment }
            if (moment.isNotBlank() && !validMoment) Notice("De gekozen beurt valt buiten de huidige herstelbare historie. Kies opnieuw voordat je het bezwaar indient.", true)
            val validSelection = if (moment.isNotBlank()) validMoment else count.toIntOrNull()?.let { it in 1..data.optInt("maxUndoCount") } == true
            Action("Correctie ter beoordeling indienen", enabled && validSelection && reason.trim().length >= 3 && (lateReason.isBlank() || lateReason.trim().length >= 5)) {
                pending = json("type" to "correction.request", "matchId" to match.id, "expectedRevision" to match.revision, "undoCount" to if (validMoment) 1 else count.toInt(), "reason" to reason, "category" to category).also { command ->
                    if (validMoment) command.put("visitIndex", moment.toInt())
                    if (evidence.isNotBlank()) command.put("evidenceText", evidence.trim())
                    if (lateReason.isNotBlank()) command.put("lateReason", lateReason.trim())
                }
            }
        }
        data.rows("requests").forEach { request -> key(request.text("id")) { PlayerPrimaryCorrectionRequest(request, enabled) { pending = it } } }
        if (!data.optBoolean("canRequest") && data.rows("requests").isEmpty()) Text(data.text("unavailableReason", "Het correctiedossier opent nadat de uitslag definitief is ondertekend."), color = PlayerMuted)
    }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(when (command.text("type")) { "correction.request" -> "Correctie indienen?"; "correction.cancel" -> "Correctieverzoek intrekken?"; "correction.repair" -> "Vervolgpartijen opnieuw indelen?"; "correction.respond" -> "Reactie aan dossier toevoegen?"; "correction.appeal" -> "Beroep bij andere onafhankelijke beoordelaar?"; "correction.close" -> "Dossier gemotiveerd sluiten?"; else -> if (command.text("decision") == "approve") "Partij heropenen?" else "Correctie afwijzen?" }) }, text = { Text(if (command.text("type") == "correction.repair") "Afhankelijke partijen worden opnieuw ingedeeld en moeten opnieuw worden gespeeld. Eerdere uitslagen blijven in het dossier.\n${command.text("reason")}" else if (command.text("decision") == "approve") "Werkelijke herinvoer en nieuwe ondertekening vervangen de eerdere definitieve uitkomst. Afhankelijke rankingstanden worden opnieuw berekend.\n${command.text("reason")}" else command.text("reason", "Trek het nog niet beoordeelde verzoek in.")) }, confirmButton = { TextButton(onClick = { pending = null; playerPrimaryCorrectionCommand(actions, match.id, command) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}

@Composable private fun PlayerPrimaryCorrectionRequest(request: JSONObject, enabled: Boolean, command: (JSONObject) -> Unit) {
    var reason by rememberSaveable { mutableStateOf("") }
    var evidence by rememberSaveable { mutableStateOf("") }
    var decision by rememberSaveable { mutableStateOf("reject") }
    Text("${when (request.text("status")) { "pending" -> "In beoordeling"; "approved" -> "Heropening goedgekeurd"; "rejected" -> "Afgewezen"; "cancelled" -> "Ingetrokken"; else -> "Correctiedossier" }} · ${request.text("requestedByName")}", style = MaterialTheme.typography.titleMedium)
    Text("${shortDate(request.text("createdAt"))} · ${request.optInt("undoCount")} beurten · oorspronkelijke uitslagrevisie ${request.optInt("resultRevision")}", color = PlayerMuted)
    correctionCategories.find { it.first == request.text("category") }?.let { Text(it.second, color = PlayerLime) }
    request.optJSONObject("moment")?.let { Text(correctionMomentLabel(it), color = PlayerMuted) }
    Text(request.text("reason"))
    if (request.optBoolean("evidenceExpired")) Text("De bewaartermijn van het bewijsmateriaal is verstreken.", color = PlayerMuted)
    else request.text("evidenceText").takeIf { it.isNotBlank() }?.let { Text("Onderbouwing: $it", color = PlayerMuted) }
    request.text("retainUntil").takeIf { it.isNotBlank() }?.let { Text("Bewijs bewaard tot ${shortDate(it)}", color = PlayerMuted) }
    request.text("responseDueAt").takeIf { it.isNotBlank() && request.text("status") == "pending" }?.let { Text("Reactietermijn tot ${shortDate(it)}. Beoordeling volgt na de tegenpartijreactie of het verstrijken van deze termijn.", color = PlayerMuted) }
    request.rows("responses").forEach { response ->
        Text("Reactie ${response.text("actorName")} · ${shortDate(response.text("at"))}", color = PlayerLime)
        Text(response.text("reason"))
        if (!request.optBoolean("evidenceExpired")) response.text("evidenceText").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
    }
    request.rows("timeline").forEach { entry -> Text("${shortDate(entry.text("at"))} · ${entry.text("actorName")} · ${when (entry.text("type")) { "request", "requested" -> "Bezwaar ingediend"; "response", "responded" -> "Reactie toegevoegd"; "appeal", "appealed" -> "Beroep ingesteld"; "approve", "approved" -> "Heropening goedgekeurd"; "reject", "rejected" -> "Bezwaar afgewezen"; "close", "closed" -> "Dossier gesloten"; "repair", "repaired" -> "Vervolgpartijen opnieuw ingedeeld"; "cancel", "cancelled" -> "Verzoek ingetrokken"; else -> "Dossier bijgewerkt" }}${entry.text("reason").takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()}", color = PlayerMuted) }
    request.text("appealOf").takeIf { it.isNotBlank() }?.let { Text("Beroepsdossier · beoordeling door een andere onafhankelijke beoordelaar", color = PlayerMuted) }
    request.text("closedAt").takeIf { it.isNotBlank() }?.let { Text("Dossier gesloten ${shortDate(it)}", color = PlayerMuted) }
    request.text("decisionReason").takeIf { it.isNotBlank() }?.let { Text("Besluit: $it", color = PlayerMuted) }
    if (request.optBoolean("canCancel") && request.text("status") == "pending") Action("Verzoek intrekken", enabled, false) { command(json("type" to "correction.cancel", "correctionId" to request.text("id"))) }
    if (request.optBoolean("canRespond") || request.optBoolean("canAppeal") || request.optBoolean("canClose")) {
        Field("Motivering reactie, beroep of sluiting", reason, { reason = it }, enabled, max = 1000, multiline = true)
        if (request.optBoolean("canRespond") || request.optBoolean("canAppeal")) Field("Aanvullende onderbouwing · optioneel", evidence, { evidence = it }, enabled, max = 4000, multiline = true)
        fun reply(type: String) = command(json("type" to type, "correctionId" to request.text("id"), "reason" to reason).also { if (evidence.isNotBlank()) it.put("evidenceText", evidence.trim()) })
        if (request.optBoolean("canRespond")) Action("Voeg mijn reactie toe", enabled && reason.trim().length >= 3, false) { reply("correction.respond") }
        if (request.optBoolean("canAppeal")) {
            Text("Beroep mogelijk tot ${shortDate(request.text("appealDeadline"))}. Een andere onafhankelijke beoordelaar behandelt het beroepsdossier.", color = PlayerMuted)
            Action("Stel gemotiveerd beroep in", enabled && reason.trim().length >= 3, false) { reply("correction.appeal") }
        }
        if (request.optBoolean("canClose")) Action("Sluit dossier met motivering", enabled && reason.trim().length >= 3, false) { command(json("type" to "correction.close", "correctionId" to request.text("id"), "reason" to reason)) }
    }
    if (request.optBoolean("canRepair")) {
        Field("Reden vervolgpartijen opnieuw indelen", reason, { reason = it }, enabled, max = 1000, multiline = true)
        Text("Afhankelijke vervolgpartijen worden opnieuw ingedeeld en moeten opnieuw worden gespeeld. Eerdere gespeelde branches blijven in het dossier bewaard.", color = PlayerMuted)
        Action("Vervolgpartijen opnieuw indelen", enabled && reason.trim().length >= 3, false) { command(json("type" to "correction.repair", "correctionId" to request.text("id"), "reason" to reason)) }
    }
    if (request.optBoolean("canReview") && request.text("status") == "pending") {
        Choice("Onafhankelijk besluit", decision, listOf("reject" to "Afwijzen", "approve" to "Goedkeuren en heropenen"), { decision = it }, enabled)
        Field("Motivering correctiebesluit", reason, { reason = it }, enabled, max = 1000, multiline = true)
        Action("Onafhankelijk besluit vastleggen", enabled && reason.trim().length >= 3, false) { command(json("type" to "correction.decide", "correctionId" to request.text("id"), "decision" to decision, "reason" to reason)) }
    }
}
