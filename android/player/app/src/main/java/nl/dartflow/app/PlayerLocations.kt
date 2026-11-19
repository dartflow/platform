package nl.dartflow.app

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.time.LocalDateTime
import java.time.ZoneId

internal fun playerLocationAction(actions: PlayerActions, action: JSONObject, revision: Int? = null) = actions.command("/platform/actions", json("action" to action).also { if (revision != null) it.put("expectedRevision", revision) })
/** Ambiguous or missing daylight-saving times require the user to choose another local time. */
internal fun playerLocationInstant(value: String, timezone: String): String? = runCatching {
    val local = LocalDateTime.parse(value.trim().replace(' ', 'T')); val zone = ZoneId.of(timezone)
    val offsets = zone.rules.getValidOffsets(local)
    require(offsets.size == 1)
    local.atOffset(offsets.single()).toInstant().toString()
}.getOrNull()
internal fun playerForceReleaseCommand(locationId: String, board: JSONObject, typedName: String, gameConfirmed: Boolean, remoteConfirmed: Boolean, reason: String): JSONObject {
    val game = board.obj("activeGame"); val activity = board.obj("activity")
    require(gameConfirmed && game.text("id").isNotBlank() && activity.text("sessionId").isNotBlank())
    require(!game.optBoolean("remote") || remoteConfirmed)
    require(Normalizer.normalize(typedName.trim(), Normalizer.Form.NFC) == Normalizer.normalize(board.text("name"), Normalizer.Form.NFC))
    require(reason.trim().length in 1..300)
    return json("type" to "location.board.force-release", "locationId" to locationId, "boardId" to board.text("id"), "expectedSessionId" to activity.text("sessionId"), "confirmedSourceId" to game.text("id"), "confirmedBoardName" to typedName.trim(), "confirmedRemoteEffect" to remoteConfirmed, "reason" to reason.trim())
}

@Composable internal fun PlayerLocationsScreen(state: PlayerUiState, actions: PlayerActions) {
    var tab by rememberSaveable { mutableStateOf("mine") }
    var name by rememberSaveable { mutableStateOf("") }
    var timezone by rememberSaveable { mutableStateOf("Europe/Amsterdam") }
    val enabled = !state.busy && state.online
    Heading("Mijn banen en locaties", "FYSIEK BAANBEHEER", "Beheer je eigen fysieke banen en reserveer locatiebanen voor een officiële speeldag.")
    Choice("Locaties", tab, listOf("mine" to "Mijn locaties", "request" to "Banen aanvragen", "reservations" to "Aanvragen en reserveringen"), { tab = it })
    when (tab) {
        "request" -> PlayerReservationRequest(state, actions)
        "reservations" -> {
            state.resource.rows("reservations").forEach { reservation -> key(reservation.text("id")) { PlayerReservationDecision(reservation, state, actions) } }
            if (state.resource.rows("reservations").isEmpty() && !state.loading) Text("Geen aanvragen of reserveringen binnen je huidige rechten.", color = PlayerMuted)
        }
        else -> {
            PlayerCard("Jouw baanbeheer activeren") {
                if (!state.resource.obj("rights").optBoolean("home")) Action("Thuisbaan activeren", enabled) { playerLocationAction(actions, json("type" to "location.enable-home")) } else Text("Thuisbaan geactiveerd", color = PlayerLime)
                if (!state.resource.obj("rights").optBoolean("venue")) Action("Locatiebeheer activeren", enabled, false) { playerLocationAction(actions, json("type" to "location.enable-venue")) } else Text("Locatiebeheer geactiveerd", color = PlayerLime)
                Text("Activeren geeft alleen eigen locatie- en baanbeheer. Verenigingsrechten worden apart gecontroleerd.", color = PlayerMuted)
            }
            if (state.resource.obj("rights").optBoolean("venue")) PlayerCard("Locatie toevoegen") {
                Field("Naam nieuwe locatie", name, { name = it }, enabled, max = 60)
                Field("Tijdzone nieuwe locatie", timezone, { timezone = it }, enabled, max = 80)
                Action("Maak locatie", enabled && name.isNotBlank() && runCatching { ZoneId.of(timezone) }.isSuccess) { playerLocationAction(actions, json("type" to "location.create", "name" to name.trim(), "timezone" to timezone)) }
            }
            state.resource.rows("locations").forEach { location -> key(location.text("id")) { PlayerPhysicalLocation(location, state, actions) } }
            if (state.resource.rows("locations").isEmpty() && !state.loading) Text("Activeer je thuisbaan of voeg je eigen locatie toe. Een vaste baan behoudt zijn identiteit bij volgende wedstrijden.", color = PlayerMuted)
        }
    }
    Action("Hulp bij banen en reserveringen", primary = false) { actions.navigate(PlayerScreen.HELP, "q=banen+reserveringen") }
}

@Composable private fun PlayerPhysicalLocation(location: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val enabled = !state.busy && state.online
    var open by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf(location.text("name")) }
    var timezone by rememberSaveable { mutableStateOf(location.text("timezone", "Europe/Amsterdam")) }
    var boardName by rememberSaveable { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }
    var manager by rememberSaveable { mutableStateOf("") }
    var pendingManager by remember { mutableStateOf<JSONObject?>(null) }
    val canManage = location.text("role") in listOf("owner", "manager")
    fun send(type: String, fields: JSONObject = JSONObject()) = playerLocationAction(actions, JSONObject(fields.toString()).put("type", type).put("locationId", location.text("id")))
    PlayerCard("${location.text("name")} · ${if (location.text("kind") == "home") "Thuis" else "Locatie"}") {
        Text("${location.text("timezone")} · ${if (location.text("role") == "owner") "Eigenaar" else "Locatiebeheerder"}", color = PlayerMuted)
        if (location.text("role") == "owner") {
            Action(if (open) "Sluit locatie-instellingen" else "Open locatie-instellingen", primary = false) { open = !open }
            if (open) {
                Field("Locatienaam", name, { name = it }, enabled, max = 60)
                Field("Tijdzone", timezone, { timezone = it }, enabled, max = 80)
                Action("Bewaar locatie", enabled && name.isNotBlank() && runCatching { ZoneId.of(timezone) }.isSuccess, false) { send("location.rename", json("name" to name.trim(), "timezone" to timezone)) }
                if (location.text("kind") == "venue") {
                    Text("Beheerders krijgen uitsluitend toegang tot deze locatie en banen.", color = PlayerMuted)
                    location.rows("managers").forEach { person -> Action("Trek locatiebeheer in · ${person.text("name")}", enabled, false) { pendingManager = json("type" to "location.manager.remove", "userId" to person.text("id")) } }
                    Field("Zoek account voor locatiebeheer", search, { search = it }, enabled, max = 100)
                    val candidates = state.platform.rows("players").filter { it.text("id") != state.profile?.id && (search.isBlank() || "${it.text("name")} ${it.text("displayName")}".contains(search, true)) }.take(100)
                    Choice("Nieuwe locatiebeheerder", manager, listOf("" to "Kies account") + candidates.map { it.text("id") to it.text("displayName", it.text("name")) }, { manager = it }, enabled)
                    Action("Verleen locatiebeheer", enabled && candidates.any { it.text("id") == manager }, false) { pendingManager = json("type" to "location.manager.add", "userId" to manager) }
                }
            }
        }
        if (canManage && (location.text("kind") != "home" || location.rows("boards").isEmpty())) {
            Field("Naam nieuwe vaste baan", boardName, { boardName = it }, enabled, max = 40)
            Action("Voeg vaste baan toe", enabled && boardName.isNotBlank()) { send("location.board.create", json("name" to boardName.trim())) }
        }
        location.rows("boards").forEach { board -> key(board.text("id")) { PlayerManagedLocationBoard(location, board, state, actions) } }
    }
    pendingManager?.let { command -> AlertDialog(onDismissRequest = { pendingManager = null }, title = { Text(if (command.text("type").endsWith("add")) "Locatiebeheer verlenen?" else "Locatiebeheer intrekken?") }, text = { Text("De wijziging geldt voor ${location.text("name")} en de bijbehorende fysieke banen. Verenigingsrollen blijven apart.") }, confirmButton = { TextButton(onClick = { pendingManager = null; send(command.text("type"), command) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pendingManager = null }) { Text("Annuleren") } }) }
}

@Composable internal fun PlayerManagedLocationBoard(location: JSONObject, board: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val enabled = !state.busy && state.online && location.text("role") in listOf("owner", "manager")
    var settings by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf(board.text("name")) }
    var bookable by rememberSaveable { mutableStateOf(board.optBoolean("enabled")) }
    var publicScreen by rememberSaveable { mutableStateOf(board.optBoolean("publicScreen")) }
    var forceSnapshot by remember { mutableStateOf<JSONObject?>(null) }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val context = LocalContext.current
    fun send(type: String, fields: JSONObject = JSONObject()) = playerLocationAction(actions, JSONObject(fields.toString()).put("type", type).put("locationId", location.text("id")).put("boardId", board.text("id")))
    Text(board.text("name"), style = MaterialTheme.typography.titleMedium)
    Text("${mapOf("open" to "Open", "occupied" to "In gebruik", "reserved" to "Gereserveerd", "closed" to "Gesloten", "blocked" to "Geblokkeerd", "archived" to "Buiten gebruik")[board.text("effectiveStatus")] ?: "Status wordt opgehaald"}${if (board.optBoolean("closePending")) " · sluit na huidige partij" else ""}", color = PlayerLime)
    board.optJSONObject("activeGame")?.let { game -> Text("${game.text("label")} · ${game.rows("boards").joinToString(" · ") { it.text("name") }}", color = PlayerMuted) }
    board.optJSONObject("reservation")?.let { Text("${it.text("label")} · ${shortDate(it.text("startsAt"))} – ${shortDate(it.text("endsAt"))}${if (it.optBoolean("overrun")) " · partij loopt uit" else ""}", color = PlayerMuted) }
    Action("Open vaste baan · ${board.text("name")}", primary = false) { actions.navigate(PlayerScreen.BOARD, board.text("id")) }
    Action("Deel vaste baanlink · ${board.text("name")}", primary = false) { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "${BuildConfig.API_ORIGIN}/baan/${board.text("id")}"), "Deel vaste baan")) }
    Action("Beheer Oche Live-schermen", primary = false) { actions.navigate(PlayerScreen.SCREENS, null) }
    if (enabled) {
        Action("Open baan · ${board.text("name")}", !board.optBoolean("archived") && (board.optBoolean("closed") || board.optBoolean("closePending") || board.optBoolean("blocked")), false) { send("location.board.open") }
        Action("Sluit baan · ${board.text("name")}", !board.optBoolean("archived") && !board.optBoolean("closed") && !board.optBoolean("closePending"), false) { pending = json("type" to "location.board.close") }
        if (board.obj("activity").text("sessionId").isNotBlank() && board.obj("activeGame").text("id").isNotBlank()) Action("Geforceerd vrijgeven · ${board.text("name")}", primary = false) { forceSnapshot = JSONObject(board.toString()) }
        Action(if (settings) "Sluit baaninstellingen" else "Baaninstellingen", primary = false) { settings = !settings }
        if (settings) {
            Field("Baannaam", name, { name = it }, enabled, max = 40)
            if (location.text("kind") == "venue") PlayerToggle("Open voor reserveringsaanvragen", bookable, enabled) { bookable = it }
            if (board.optBoolean("legacyClub")) Text("Dit bestaande verenigingsscherm behoudt de openbare schermlink.", color = PlayerMuted) else PlayerToggle("Oche Live openbaar leesbaar", publicScreen, enabled) { publicScreen = it }
            Action("Bewaar baaninstellingen", enabled && name.isNotBlank(), false) { send("location.board.update", json("name" to name.trim(), "enabled" to (location.text("kind") == "venue" && bookable), "publicScreen" to (board.optBoolean("legacyClub") || publicScreen))) }
            Action(if (board.optBoolean("blocked")) "Baan deblokkeren" else "Baan blokkeren", enabled && !board.optBoolean("occupied"), false) { send("location.board.update", json("blocked" to !board.optBoolean("blocked"))) }
            Action(if (board.optBoolean("archived")) "Baan herstellen" else "Baan buiten gebruik stellen", enabled && !board.optBoolean("occupied"), false) { pending = json("type" to "location.board.update", "archived" to !board.optBoolean("archived")) }
        }
    }
    forceSnapshot?.let { captured -> PlayerForceReleaseDialog(location.text("id"), captured, enabled, { forceSnapshot = null }) { command -> forceSnapshot = null; playerLocationAction(actions, command) } }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(if (command.text("type").endsWith("close")) "Baan sluiten?" else "Baanstatus wijzigen?") }, text = { Text(if (command.text("type").endsWith("close")) "${board.text("name")} sluit na de huidige partij als de baan in gebruik is. Scores blijven behouden." else "De server controleert bezetting en bestaande reserveringen voordat ${board.text("name")} wordt gewijzigd.") }, confirmButton = { TextButton(onClick = { pending = null; send(command.text("type"), command) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}

@Composable private fun PlayerForceReleaseDialog(locationId: String, captured: JSONObject, enabled: Boolean, dismiss: () -> Unit, submit: (JSONObject) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var gameConfirmed by rememberSaveable { mutableStateOf(false) }
    var remoteConfirmed by rememberSaveable { mutableStateOf(false) }
    val game = captured.obj("activeGame")
    AlertDialog(onDismissRequest = dismiss, title = { Text("Huidige partij geforceerd vrijgeven") }, text = { Column(Modifier.verticalScroll(rememberScrollState())) {
        Text(if (captured.obj("activity").text("phase") == "completed") "De afgeronde score blijft bewaard; alleen de fysieke baan wordt vrijgegeven." else if (game.text("kind") == "official") "De officiële partij wordt onderbroken. Scores blijven bewaard voor hervatten door de wedstrijdleiding." else "Deze vrije partij verloopt. Voorlopige scores en statistieken worden verwijderd; hervatten is daarna niet mogelijk.")
        Text("Betrokken banen: ${game.rows("boards").joinToString(" · ") { it.text("name") }}", color = PlayerMuted)
        PlayerToggle("Ik bevestig de partij ${game.text("label")}", gameConfirmed, enabled) { gameConfirmed = it }
        if (game.optBoolean("remote")) PlayerToggle("Ook de tegenstander en alle gekoppelde banen worden geraakt", remoteConfirmed, enabled) { remoteConfirmed = it }
        Field("Typ de baannaam ter bevestiging", name, { name = it }, enabled, max = 40)
        Field("Reden voor vrijgave", reason, { reason = it }, enabled, max = 300, multiline = true)
    } }, confirmButton = { TextButton(onClick = { submit(playerForceReleaseCommand(locationId, captured, name, gameConfirmed, remoteConfirmed, reason)) }, enabled = enabled && runCatching { playerForceReleaseCommand(locationId, captured, name, gameConfirmed, remoteConfirmed, reason) }.isSuccess) { Text("Bevestigen en vrijgeven") } }, dismissButton = { TextButton(onClick = dismiss) { Text("Annuleren") } })
}
