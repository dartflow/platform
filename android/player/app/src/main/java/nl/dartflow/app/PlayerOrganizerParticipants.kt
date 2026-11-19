package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

internal fun playerGuestOperatorState(state: PlayerUiState): PlayerUiState {
    val match = state.match ?: return state
    val guest = match.raw.rows("guestOperators").find { it.text("id") == state.guestOperatorId } ?: return state
    val permissions = JSONObject(match.permissions.toString())
    listOf("canAccept", "canConfirm", "canScore", "canUndo", "canStart", "canDrawStart", "canBullThrow", "canBullConfirm").forEach { key -> permissions.put(key, guest.obj("permissions").optBoolean(key)) }
    return state.copy(match = match.copy(permissions = permissions, raw = JSONObject(match.raw.toString()).put("permissions", permissions)))
}
internal fun playerGuestOperatorLabel(state: PlayerUiState): String? = state.match?.raw?.rows("guestOperators")?.find { it.text("id") == state.guestOperatorId }?.let { "Bediening voor gast ${it.text("name")}" }

@Composable internal fun PlayerGuestOperatorPicker(match: PlayerMatch, state: PlayerUiState, actions: PlayerActions) {
    val guests = match.raw.rows("guestOperators")
    if (guests.isEmpty()) return
    PlayerCard("Lokale gastbediening") {
        Text("Als wedstrijdleiding voer je een handeling voor een toegelaten eventgast uit. De server bewaart dat jij bedient; dit maakt geen tweede aangemeld account.", color = PlayerMuted)
        Choice("Bediening", state.guestOperatorId.takeIf { id -> guests.any { it.text("id") == id } }.orEmpty(), listOf("" to "Mijn eigen rol") + guests.map { it.text("id") to "Bediening voor gast ${it.text("name")}" }, actions.selectGuestOperator, !state.busy && !state.hasPendingCommand)
        guests.find { it.text("id") == state.guestOperatorId }?.let { Text("Bediening voor gast ${it.text("name")}", color = PlayerLime) }
    }
}

@Composable internal fun PlayerOrganizerParticipants(event: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    var data by remember(event.text("id")) { mutableStateOf(JSONObject()) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var csv by rememberSaveable(event.text("id")) { mutableStateOf("name,username,type\n") }
    var guestName by rememberSaveable(event.text("id")) { mutableStateOf("") }
    var target by rememberSaveable(event.text("id")) { mutableStateOf("") }
    var account by rememberSaveable(event.text("id")) { mutableStateOf("") }
    var reason by rememberSaveable(event.text("id")) { mutableStateOf("") }
    var expanded by rememberSaveable(event.text("id")) { mutableStateOf(false) }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var apply by remember { mutableStateOf<JSONObject?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(event.text("id"), event.optInt("revision"), state.busy) {
        if (state.busy) return@LaunchedEffect
        try { data = actions.read("/organizer-participants/${PlayerLinks.encode(event.text("id"))}"); error = null; preview = null }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: PlayerApiFailure) { error = failure.feedback }
        catch (_: Exception) { error = "Deelnemersimport en gastbeheer zijn tijdelijk niet beschikbaar." }
    }
    val enabled = state.online && !state.busy && !busy && data.optBoolean("canManage")
    fun send(type: String, fields: JSONObject) = actions.command("/organizer-participants", json("expectedRevision" to data.optInt("revision", event.optInt("revision")), "action" to JSONObject(fields.toString()).put("type", type).put("entityId", event.text("id"))))
    Action(if (expanded) "Sluit import en gastbeheer" else "Deelnemers importeren en eventgasten", !state.busy, false) { expanded = !expanded }
    if (!expanded) return
    error?.let { Notice(it, true) }
    PlayerCard("Import eerst controleren") {
        Text("Plak CSV met kolommen name, username en type (account of guest). Komma en puntkomma worden ondersteund. De controle toont ambiguïteit, dubbele regels en fouten voordat je bewust toepast.", color = PlayerMuted)
        if (data.optBoolean("drawPublished")) Notice("Er is al een gepubliceerde loting. De server bepaalt welke deelnemerswijziging nog is toegestaan.")
        Field("CSV-deelnemerslijst", csv, { csv = it; preview = null }, enabled, max = 32000, multiline = true)
        Action(if (busy) "Import controleren…" else "Maak importpreview", enabled && data.optBoolean("canImport") && csv.isNotBlank(), false) {
            val submitted = csv
            scope.launch { busy = true; error = null; try { val result = actions.request("/organizer-participants", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "participants.preview", "entityId" to event.text("id"), "csv" to submitted))); preview = result.optJSONObject("preview") } catch (cancelled: CancellationException) { throw cancelled } catch (failure: PlayerApiFailure) { error = failure.feedback } catch (_: Exception) { error = "De import kon niet worden gecontroleerd." } finally { busy = false } }
        }
        preview?.let { checked ->
            val summary = checked.obj("summary")
            checked.optJSONArray("missingColumns")?.strings()?.takeIf { it.isNotEmpty() }?.let { Notice("Ontbrekende kolommen: ${it.joinToString(", ")}", true) }
            Text("${summary.optInt("add")} toevoegen · ${summary.optInt("skip")} overslaan · ${summary.optInt("ambiguous")} onduidelijk · ${summary.optInt("invalid")} ongeldig", color = PlayerLime)
            Text("Bronrevisie ${checked.optInt("baseRevision")} · geldig tot ${shortDate(checked.text("expiresAt"))}", color = PlayerMuted)
            checked.text("drawImpact").takeIf { it.isNotBlank() }?.let { Notice(it) }
            checked.rows("rows").forEach { row -> Text("Regel ${row.optInt("line")}: ${row.text("name")} · ${row.text("kind")} · ${row.text("status")}\n${row.text("reason")}", color = if (row.text("status") in listOf("invalid", "ambiguous")) PlayerError else PlayerMuted) }
            Action("Controleer toepassen deelnemersimport", enabled && summary.optInt("add") > 0 && summary.optInt("invalid") == 0 && summary.optInt("ambiguous") == 0) { apply = checked }
        }
    }
    if (data.optBoolean("allowGuests")) PlayerCard("Lokale eventgasten") {
        Text("Een gast krijgt uitsluitend een identiteit voor dit evenement. Een gast is geen geregistreerd account en ontvangt hierdoor geen persoonlijke Elo of profielkoppeling.", color = PlayerMuted)
        Field("Naam eventgast", guestName, { guestName = it }, enabled, max = 80)
        Action("Voeg eventgast toe", enabled && validPlayerName(guestName), false) { send("guest.add", json("name" to guestName.trim())) }
        data.rows("guests").forEach { guest ->
            Text("${guest.text("name")} · ${statusLabel(guest.text("status"))}${if (guest.optBoolean("checkedIn")) " · ingecheckt" else ""}")
            if (!guest.optBoolean("checkedIn")) Action("Check gast in · ${guest.text("name")}", enabled, false) { send("guest.checkin", json("guestId" to guest.text("id"))) }
            guest.optJSONObject("claim")?.let { Text("Historieclaim: ${statusLabel(it.text("status"))} · ${it.text("accountName")}", color = PlayerMuted) }
        }
        if (data.rows("guests").isNotEmpty()) {
            Choice("Gast voor historieclaim", target, listOf("" to "Kies eventgast") + data.rows("guests").map { it.text("id") to it.text("name") }, { target = it }, enabled)
            Choice("Bestaand account", account, listOf("" to "Kies bekend spelersaccount") + state.platform.rows("players").map { it.text("id") to it.text("displayName", it.text("name")) }, { account = it }, enabled)
            Field("Toelichting historieclaim", reason, { reason = it }, enabled, max = 1000)
            Text("De eigenaar van het gekozen account moet de claim zelf accepteren. Oorspronkelijke partijen en ratingbronnen worden niet stilzwijgend herschreven.", color = PlayerMuted)
            Action("Stel historieclaim voor", enabled && target.isNotBlank() && account.isNotBlank() && reason.trim().length >= 3, false) { send("guest.claim.propose", json("guestId" to target, "accountId" to account, "reason" to reason.trim())) }
        }
    }
    apply?.let { checked -> AlertDialog(onDismissRequest = { apply = null }, title = { Text("Gecontroleerde import toepassen?") }, text = { Text("Voeg uitsluitend de gecontroleerde regels uit preview ${checked.text("id").take(8)} toe bij revisie ${checked.optInt("baseRevision")}. De server controleert opnieuw het actuele evenement en verwerkt deze preview eenmaal.") }, confirmButton = { TextButton(onClick = { apply = null; actions.command("/organizer-participants", json("expectedRevision" to checked.optInt("baseRevision"), "action" to json("type" to "participants.apply", "entityId" to event.text("id"), "previewId" to checked.text("id")))) }, enabled = enabled) { Text("Pas import toe") } }, dismissButton = { TextButton(onClick = { apply = null }) { Text("Terug") } }) }
}

@Composable internal fun PlayerGuestClaims(state: PlayerUiState, actions: PlayerActions) {
    var data by remember { mutableStateOf(JSONObject()) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(state.resource.toString(), state.profile?.id, state.busy) {
        if (state.busy) return@LaunchedEffect
        data = JSONObject()
        try { data = actions.read("/organizer-guest-claims") } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { /* The normal inbox remains usable if this optional section is unavailable. */ }
    }
    if (data.rows("claims").isEmpty() && data.rows("history").isEmpty()) return
    PlayerCard("Eventgasten en jouw historie") {
        data.rows("claims").forEach { claim ->
            Text("${claim.text("guestName")} · ${claim.text("eventName")}")
            Text("Voorgesteld door ${claim.text("proposedByName")} · ${claim.text("reason")}", color = PlayerMuted)
            if (claim.optBoolean("canAccept")) listOf("accept" to "Controleer accepteren historieclaim", "decline" to "Historieclaim afwijzen").forEach { (decision, label) -> Action(label, !state.busy && state.online, decision == "accept") { pending = json("type" to "guest.claim.decide", "claimId" to claim.text("id"), "decision" to decision) } }
            else Text(statusLabel(claim.text("status")), color = PlayerMuted)
        }
        if (data.rows("history").isNotEmpty()) Action(if (expanded) "Sluit historische gastpartijen" else "Bekijk historische gastpartijen", primary = false) { expanded = !expanded }
        if (expanded) data.rows("history").forEach { history ->
            Text("${history.text("eventName")} · gespeeld als ${history.text("guestName")}", color = PlayerLime)
            Text("Historisch gastresultaat · oorspronkelijke identiteit en ranking blijven behouden.", color = PlayerMuted)
            history.rows("matches").forEach { match -> Text("${match.rows("players").joinToString(" – ") { it.text("name") }} · legs ${match.optJSONArray("legs")?.strings()?.joinToString("–").orEmpty()} · sets ${match.optJSONArray("sets")?.strings()?.joinToString("–").orEmpty()}", color = PlayerMuted) }
        }
    }
    pending?.let { action -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(if (action.text("decision") == "accept") "Gastgeschiedenis aan jouw account verbinden?" else "Historieclaim afwijzen?") }, text = { Text("Bevestig alleen eigen gespeelde historie. Dit bewaart een afzonderlijk claimbewijs; de oorspronkelijke wedstrijdidentiteit en officiële rankingbronnen blijven bestaan.") }, confirmButton = { TextButton(onClick = { pending = null; actions.command("/organizer-participants", json("action" to action)) }, enabled = !state.busy && state.online) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Terug") } }) }
}
