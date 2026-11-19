package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.KeyboardType
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

@Composable internal fun PlayerReservationRequest(state: PlayerUiState, actions: PlayerActions) {
    val data = state.resource
    val locations = data.rows("bookableLocations")
    val events = data.rows("events")
    var locationId by rememberSaveable { mutableStateOf("") }
    var eventId by rememberSaveable { mutableStateOf("") }
    var preferred by rememberSaveable { mutableStateOf("") }
    var starts by rememberSaveable { mutableStateOf("") }
    var ends by rememberSaveable { mutableStateOf("") }
    var count by rememberSaveable { mutableStateOf("1") }
    var maximum by rememberSaveable { mutableStateOf("4") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val location = locations.find { it.text("id") == locationId }
    val timezone = location?.text("timezone", "Europe/Amsterdam") ?: "Europe/Amsterdam"
    val enabled = !state.busy && state.online
    PlayerCard("Locatiebanen voor een speeldag aanvragen") {
        if (events.isEmpty()) { Text("Je hebt actueel competitie- of toernooibeheerrecht nodig voor een bestaande verenigingsspeeldag.", color = PlayerMuted); return@PlayerCard }
        if (locations.isEmpty()) { Text("Er zijn nog geen locatiebanen opengesteld voor aanvragen.", color = PlayerMuted); return@PlayerCard }
        Choice("Verenigingsspeeldag", eventId, listOf("" to "Kies speeldag") + events.map { it.text("id") to "${it.text("clubName")} · ${it.text("name")}" }, { eventId = it }, enabled)
        Choice("Te reserveren locatie", locationId, listOf("" to "Kies locatie") + locations.map { it.text("id") to "${it.text("name")} · ${it.rows("boards").size} banen" }, { locationId = it; preferred = "" }, enabled)
        Choice("Gewenste vaste baan", preferred, listOf("" to "Locatie kiest de banen") + location?.rows("boards").orEmpty().map { it.text("id") to it.text("name") }, { preferred = it }, enabled)
        Text("Vul de lokale tijd van de locatie in: $timezone.", color = PlayerMuted)
        Field("Vanaf · jjjj-mm-dd uu:mm", starts, { starts = it }, enabled, max = 16)
        Field("Tot · jjjj-mm-dd uu:mm", ends, { ends = it }, enabled, max = 16)
        Field("Aantal banen aanvragen", count, { count = it }, enabled, max = 2, keyboard = KeyboardType.Number)
        Field("Maximaal aantal partijen", maximum, { maximum = it }, enabled, max = 2, keyboard = KeyboardType.Number)
        val start = playerLocationInstant(starts, timezone)
        val end = playerLocationInstant(ends, timezone)
        val now = data.optLong("serverNow")
        val validWindow = start != null && end != null && runCatching { val a = Instant.parse(start).toEpochMilli(); val b = Instant.parse(end).toEpochMilli(); a >= now - 300000 && b > maxOf(now, a) && b - a <= 7 * 86400000L }.getOrDefault(false)
        val valid = events.any { it.text("id") == eventId } && location != null && count.toIntOrNull()?.let { it in 1..minOf(16, location.rows("boards").size) } == true && maximum.toIntOrNull() in 1..32 && validWindow
        if (starts.isNotBlank() && start == null || ends.isNotBlank() && end == null) Text("Kies geldige lokale tijden. Een ontbrekend of dubbel tijdstip bij de zomertijdwisseling kan niet eenduidig worden gereserveerd.", color = PlayerMuted)
        Action("Controleer reserveringsaanvraag", enabled && valid) { pending = json("type" to "reservation.request", "eventId" to eventId, "locationId" to locationId, "startsAt" to start, "endsAt" to end, "boardCount" to count.toInt(), "maxMatches" to maximum.toInt()).also { if (preferred.isNotBlank()) it.put("preferredBoardId", preferred) } }
        Text("De locatie beoordeelt de aanvraag en wijst exact het gevraagde aantal banen toe. Een gevraagde vaste baan moet in die toewijzing zitten.", color = PlayerMuted)
    }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text("Reserveringsaanvraag indienen?") }, text = { Text("${location?.text("name")} · ${events.find { it.text("id") == eventId }?.text("name")}\n$starts – $ends ($timezone)\n${command.optInt("boardCount")} banen · maximaal ${command.optInt("maxMatches")} partijen") }, confirmButton = { TextButton(onClick = { pending = null; playerLocationAction(actions, command) }, enabled = enabled) { Text("Dien aanvraag in") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}

@Composable internal fun PlayerReservationDecision(reservation: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    var boards by rememberSaveable { mutableStateOf(listOfNotNull(reservation.text("preferredBoardId").takeIf { it.isNotBlank() })) }
    var reason by rememberSaveable { mutableStateOf("") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val enabled = !state.busy && state.online
    val location = state.resource.rows("locations").find { it.text("id") == reservation.text("locationId") }
    val available = location?.rows("boards").orEmpty().filter { it.optBoolean("enabled") && !it.optBoolean("archived") && !it.optBoolean("blocked") && !it.optBoolean("closed") && !it.optBoolean("closePending") }
    PlayerCard("${reservation.text("eventName")} · ${reservation.text("locationName")}") {
        Text("${mapOf("pending" to "In behandeling", "accepted" to "Goedgekeurd", "declined" to "Afgewezen", "cancelled" to "Geannuleerd")[reservation.text("status")] ?: reservation.text("status")} · revisie ${reservation.optInt("revision")}", color = PlayerLime)
        Text("${shortDate(reservation.text("startsAt"))} – ${shortDate(reservation.text("endsAt"))} · ${reservation.text("timezone")}", color = PlayerMuted)
        Text("${reservation.optInt("boardCount")} banen · ${reservation.optInt("usedMatches")} / ${reservation.optInt("maxMatches")} partijen gebruikt")
        reservation.rows("boards").forEach { Text(it.text("name"), color = PlayerMuted) }
        if (reservation.optBoolean("overrun")) Notice("Een gekoppelde partij loopt uit; die partij blijft aan de reservering gekoppeld.")
        reservation.text("reason").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
        if (reservation.optBoolean("canDecide") && reservation.text("status") == "pending") {
            Text("Wijs precies ${reservation.optInt("boardCount")} fysieke banen toe.", color = PlayerMuted)
            available.forEach { board -> PlayerToggle(board.text("name") + if (board.text("id") == reservation.text("preferredBoardId")) " · aangevraagd" else "", board.text("id") in boards, enabled) { checked -> boards = if (checked) boards + board.text("id") else boards - board.text("id") } }
            Field("Motivering bij besluit · optioneel", reason, { reason = it }, enabled, max = 300)
            Action("Controleer toewijzing en goedkeuring", enabled && boards.distinct().size == reservation.optInt("boardCount") && boards.all { id -> available.any { it.text("id") == id } } && (reservation.text("preferredBoardId").isBlank() || reservation.text("preferredBoardId") in boards)) { pending = json("type" to "reservation.accept", "reservationId" to reservation.text("id"), "boardIds" to JSONArray(boards), "reason" to reason).put("expectedRevision", reservation.optInt("revision")) }
            Action("Wijs reserveringsaanvraag af", enabled, false) { pending = json("type" to "reservation.decline", "reservationId" to reservation.text("id"), "reason" to reason).put("expectedRevision", reservation.optInt("revision")) }
        }
        if (reservation.optBoolean("canCancel")) Action("Annuleer reservering", enabled, false) { pending = json("type" to "reservation.cancel", "reservationId" to reservation.text("id"), "reason" to reason).put("expectedRevision", reservation.optInt("revision")) }
    }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(when (command.text("type")) { "reservation.accept" -> "Reservering en fysieke banen goedkeuren?"; "reservation.decline" -> "Reserveringsaanvraag afwijzen?"; else -> "Reservering annuleren?" }) }, text = { Text("${reservation.text("eventName")} · ${reservation.text("locationName")}\n${shortDate(reservation.text("startsAt"))} – ${shortDate(reservation.text("endsAt"))}\nVerwachte revisie ${command.optInt("expectedRevision")}. De server controleert toewijzing en overlap opnieuw.") }, confirmButton = { TextButton(onClick = { pending = null; playerLocationAction(actions, JSONObject(command.toString()).also { it.remove("expectedRevision") }, command.optInt("expectedRevision")) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}
