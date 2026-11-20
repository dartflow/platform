@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package nl.dartflow.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.util.UUID

internal val playerWizardSteps = listOf("Basis", "Deelnemers", "Spelregels", "Eigen locaties en banen", "Planning", "Controle en publiceren")
internal fun playerWizardDefaults() = json("version" to 1, "title" to "", "season" to "", "description" to "", "organizerName" to "", "variant" to "singles", "system" to "round-robin", "playerIds" to JSONArray(), "teams" to JSONArray(), "rules" to json("startScore" to 501, "inRule" to "single", "outRule" to "double", "legMode" to "bestOf", "legs" to 5, "bestOfSets" to 1, "pointsWin" to 2, "pointsDraw" to 1, "pointsLoss" to 0, "slotCount" to 4, "tiebreaks" to JSONArray(listOf("points", "leg-difference", "legs-for", "head-to-head"))), "boardIds" to JSONArray(), "planning" to json("startDate" to LocalDate.now().plusDays(1).toString(), "endDate" to null, "weekdays" to JSONArray(listOf(2)), "startTime" to "19:30", "endTime" to "23:00", "timezone" to "Europe/Amsterdam", "matchMinutes" to 30, "changeMinutes" to 5, "breaks" to JSONArray(), "excludedDates" to JSONArray(), "roundGating" to "manual", "returnLegs" to false, "offsets" to JSONObject()))
internal fun playerWizardRestore(value: JSONObject, actor: String, club: String): JSONObject? = value.takeIf { actor.isNotBlank() && it.text("actorId") == actor && it.text("clubId") == club && it.obj("config").optInt("version") == 1 }
internal fun playerWizardOwnBoards(context: JSONObject) = context.rows("locations").flatMap { location -> location.rows("boards").map { board -> JSONObject(board.toString()).put("locationId", location.text("id")).put("locationName", location.text("name")) } }.distinctBy { it.text("id") }
internal fun playerWizardSaveAction(club: String, id: String, revision: Int, step: Int, config: JSONObject) = json("type" to "wizard.save", "clubId" to club, "id" to id, "expectedRevision" to revision, "step" to step.coerceIn(1, 6), "config" to config)

@Composable internal fun PlayerClubCompetitionWizard(state: PlayerUiState, actions: PlayerActions) {
    val context = LocalContext.current; val clubId = playerClubRoute(state.activeId)?.clubId ?: return; val actor = state.session?.userId.orEmpty(); val data = state.resource
    if (data.obj("club").text("id") != clubId) { Column(Modifier.padding(16.dp)) { if (state.loading) LinearProgressIndicator() else Notice("De competitiecontext is niet beschikbaar. Je herstelconcept blijft bewaard.", true, actions.refresh) }; return }
    if (!data.optBoolean("canManage")) { Notice("Je hebt geen actueel recht om een interne competitie voor deze vereniging te maken.", true); return }
    val store = remember(actor, clubId) { PlayerSessionStore(context, "competition-wizard-${actor}-${clubId}") }
    val restored = remember(actor, clubId) { playerWizardRestore(store.read(), actor, clubId) }
    var configText by rememberSaveable(actor, clubId) { mutableStateOf(restored?.obj("config")?.toString() ?: playerWizardDefaults().toString()) }
    var id by rememberSaveable(actor, clubId) { mutableStateOf(restored?.text("id")?.ifBlank { UUID.randomUUID().toString() } ?: UUID.randomUUID().toString()) }
    var revision by rememberSaveable(actor, clubId) { mutableIntStateOf(restored?.optInt("revision") ?: 0) }
    var step by rememberSaveable(actor, clubId) { mutableIntStateOf(restored?.optInt("step", 1)?.coerceIn(1, 6) ?: 1) }
    var dirty by rememberSaveable(actor, clubId) { mutableStateOf(restored?.optBoolean("dirty", true) ?: true) }
    var pending by rememberSaveable(actor, clubId) { mutableStateOf(restored?.text("pending").orEmpty()) }
    var previewText by rememberSaveable(actor, clubId) { mutableStateOf("") }; var acknowledgments by rememberSaveable(actor, clubId) { mutableStateOf(emptyList<String>()) }
    var published by remember { mutableStateOf(false) }; var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }; var status by remember { mutableStateOf(restored?.let { "Lokaal herstelconcept geladen; rechten worden opnieuw gecontroleerd." } ?: "Nieuw concept") }; var confirmPublish by remember { mutableStateOf(false) }; var close by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope(); val config = JSONObject(configText); val preview = previewText.takeIf(String::isNotBlank)?.let(::JSONObject) ?: JSONObject()
    fun persist() { if (published) { store.clear(); return }; store.write(json("actorId" to actor, "clubId" to clubId, "id" to id, "revision" to revision, "step" to step, "config" to JSONObject(configText), "dirty" to dirty, "pending" to pending)) }
    fun update(value: JSONObject) { configText = value.toString(); dirty = true; previewText = ""; acknowledgments = emptyList(); status = "Nog niet naar de server opgeslagen" }
    fun accept(result: JSONObject) {
        result.optJSONObject("draft")?.let { draft -> require(draft.text("clubId") == clubId); id = draft.text("id"); revision = draft.optInt("revision"); configText = draft.obj("config").toString(); step = draft.optInt("step", step).coerceIn(1, 6); dirty = false; status = "Opgeslagen · versie $revision" }
        result.optJSONObject("preview")?.let { previewText = it.toString(); acknowledgments = emptyList(); status = "Roosterpreview berekend; banen zijn nog niet gereserveerd." }
        if (result.text("seasonId").isNotBlank()) { published = true; store.clear(); actions.navigate(PlayerScreen.SEASON, result.text("seasonId")) }
    }
    suspend fun request(action: JSONObject): JSONObject {
        val envelope = json("requestId" to UUID.randomUUID().toString(), "action" to action)
        pending = envelope.toString(); persist()
        val result = actions.request("/competition-wizard", envelope)
        pending = ""; accept(result); if (result.text("seasonId").isBlank()) persist(); return result
    }
    suspend fun save() { if (dirty || revision == 0) request(playerWizardSaveAction(clubId, id, revision, step, JSONObject(configText))) }
    fun run(task: suspend () -> Unit) { if (!busy) scope.launch { busy = true; error = null; try { task() } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; error = (failure as? PlayerApiFailure)?.feedback ?: failure.message?.take(240) ?: "Opslaan of berekenen is niet gelukt. Je invoer is bewaard."; if (failure is PlayerApiFailure && failure.status in 400..499) pending = ""; persist() } finally { busy = false } } }
    LaunchedEffect(configText, step, id, revision, pending) { delay(250); persist() }
    BackHandler { if (step > 1 && pending.isBlank() && !busy) step-- else close = true }
    Column(Modifier.fillMaxSize().imePadding()) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Heading("Interne competitie", data.obj("club").text("name")); Text("Stap $step van 6 · ${playerWizardSteps[step - 1]}", color = PlayerLime)
            LinearProgressIndicator(progress = { step / 6f }, modifier = Modifier.fillMaxWidth()); Text(status, color = PlayerMuted)
        }
        Column(Modifier.weight(1f).fillMaxWidth().testTag("club-wizard-body").verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { Notice(it, true) }
            if (!state.online) Notice("Geen verbinding. Je lokale herstelconcept blijft bewaard; publiceren vraagt een verse servercontrole.", true)
            val latest = data.rows("drafts").find { it.text("id") == id }
            if (latest != null && latest.optInt("revision") > revision) { Notice("Een andere beheerder heeft dit concept gewijzigd. Je invoer is behouden.", true); Action("Nieuwste serverversie laden", !busy && state.online, false) { accept(json("draft" to latest)); previewText = ""; pending = ""; persist() }; Action("Mijn invoer als afzonderlijk concept bewaren", !busy && state.online && pending.isBlank(), false) { id = UUID.randomUUID().toString(); revision = 0; dirty = true; run { save() } } }
            if (pending.isNotBlank()) { Notice("De uitkomst van de vorige aanvraag is nog onzeker. Herhaal exact die aanvraag voordat je verdergaat.", true); Action("Vorige aanvraag veilig herhalen", !busy && state.online) { run { val result = actions.request("/competition-wizard", JSONObject(pending)); pending = ""; accept(result); persist() } } }
            if (revision == 0 && data.rows("drafts").isNotEmpty()) PlayerCard("Bestaand concept hervatten") { data.rows("drafts").filter { it.text("status") == "draft" }.forEach { draft -> Action("Hervat ${draft.obj("config").text("title", "Naamloos concept")} · versie ${draft.optInt("revision")}", !busy && pending.isBlank(), false) { accept(json("draft" to draft)); previewText = ""; persist() } } }
            val enabled = !busy && pending.isBlank()
            when (step) {
                1 -> PlayerWizardBasis(config, data, enabled, ::update)
                2 -> PlayerWizardParticipants(config, data, enabled, ::update)
                3 -> PlayerWizardRules(config, enabled, ::update)
                4 -> PlayerWizardBoards(config, data, state, actions, enabled, ::update)
                5 -> PlayerWizardPlanning(config, preview, enabled, ::update)
                6 -> {
                    PlayerCard("Controleer je competitie") {
                        Text("Vereniging: ${data.obj("club").text("name")}"); Text("${config.text("title")} · ${config.text("season")}"); Text("${config.text("variant")} · ${config.text("system")}"); Text("${if (config.text("variant") == "singles") config.optJSONArray("playerIds")?.length() ?: 0 else config.rows("teams").size} deelnemers/teams · ${config.optJSONArray("boardIds")?.length() ?: 0} banen"); Text("${config.obj("planning").text("startDate")} · ${config.obj("planning").text("startTime")}–${config.obj("planning").text("endTime")} · ${config.obj("planning").text("timezone")}")
                        playerWizardSteps.take(5).forEachIndexed { index, label -> Action("Wijzig $label", enabled, false) { step = index + 1 } }
                    }
                    Action("Bewaar en bereken roosterpreview", enabled && state.online) { run { save(); request(json("type" to "wizard.preview", "id" to id, "expectedRevision" to revision)) } }
                    preview.rows("issues").forEach { issue -> Notice(issue.text("message"), true); Action("Herstel in stap ${issue.optInt("step")}", enabled, false) { step = issue.optInt("step", 1).coerceIn(1, 6) } }
                    preview.rows("warnings").forEach { warning -> val code = warning.text("code"); PlayerToggle("Beoordeeld: ${warning.text("message")}", code in acknowledgments, enabled) { checked -> acknowledgments = if (checked) acknowledgments + code else acknowledgments - code } }
                    preview.optJSONArray("regulation")?.strings()?.forEach { Text(it, color = PlayerMuted) }
                    if (preview.length() > 0) {
                        Text("${preview.optInt("totalMatches")} ontmoetingen · ${preview.optInt("participantCount")} deelnemers/teams", color = PlayerLime)
                        preview.rows("rounds").forEach { round -> PlayerCard("Ronde ${round.optInt("number")}") { Text("${shortDate(round.text("startsAt"))} – ${shortDate(round.text("endsAt"))}"); if ((round.optJSONArray("byeIds")?.length() ?: 0) > 0) Text("${round.optJSONArray("byeIds")?.length()} vrijronde(n); geen gespeelde overwinning", color = PlayerMuted) } }
                        preview.rows("fixtures").forEach { fixture -> PlayerCard("Ronde ${fixture.optInt("round")} · ${fixture.text("homeName")} – ${fixture.text("awayName")}") { Text("${shortDate(fixture.text("startsAt"))} – ${shortDate(fixture.text("endsAt"))} · ${fixture.text("offset")}"); Text(playerWizardOwnBoards(data).find { it.text("id") == fixture.text("boardId") }?.let { "${it.text("locationName")} · ${it.text("name")}" } ?: "Baan niet meer beschikbaar", color = PlayerMuted) } }
                    }
                    Text("Publiceren legt het volledige rooster, de deelnemerssnapshot en baanboekingen vast. Rechten, leden, koppelingen en conflicten worden opnieuw gecontroleerd. Een preview reserveert niets.", color = PlayerMuted)
                    Action("Competitie publiceren", enabled && state.online && !dirty && preview.optBoolean("canPublish") && preview.optInt("revision") == revision && preview.rows("warnings").all { it.text("code") in acknowledgments }) { confirmPublish = true }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
        FlowRow(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Action(if (step == 1) "Sluiten" else "Vorige", !busy, false) { if (step > 1) step-- else close = true }
            Action("Concept opslaan", !busy && pending.isBlank() && state.online, false) { run { dirty = true; save() } }
            if (step < 6) Action("Volgende", !busy && pending.isBlank(), modifier = Modifier.testTag("club-wizard-next")) { val issue = playerWizardStepError(JSONObject(configText), step); if (issue == null) { error = null; step++ } else error = issue }
        }
    }
    if (confirmPublish) AlertDialog(onDismissRequest = { confirmPublish = false }, title = { Text("Competitie publiceren?") }, text = { Text("Het programma wordt definitief aangemaakt met de getoonde deelnemers en banen. De server controleert alle rechten en tijdvakken opnieuw.") }, confirmButton = { TextButton(onClick = { confirmPublish = false; run { request(json("type" to "wizard.publish", "id" to id, "expectedRevision" to revision, "configurationHash" to preview.text("configurationHash"), "acknowledgedWarnings" to JSONArray(acknowledgments))) } }) { Text("Publicatie bevestigen") } }, dismissButton = { TextButton(onClick = { confirmPublish = false }) { Text("Annuleren") } })
    if (close) AlertDialog(onDismissRequest = { close = false }, title = { Text("Wizard sluiten?") }, text = { Text("Je herstelconcept blijft op dit toestel bewaard voor dit account en deze vereniging. Gebruik Concept opslaan om het ook op andere apparaten te hervatten.") }, confirmButton = { TextButton(onClick = { persist(); close = false; actions.back() }) { Text("Sluiten en lokaal bewaren") } }, dismissButton = { TextButton(onClick = { close = false }) { Text("Verder invullen") } })
}
