@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package nl.dartflow.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.time.*

internal fun playerClubLocalInstant(value: String, zone: String, offset: String?): String? = runCatching {
    val local = LocalDateTime.parse(value); val offsets = ZoneId.of(zone).rules.getValidOffsets(local)
    require(offsets.isNotEmpty())
    val chosen = if (offsets.size == 1) offsets.single() else offsets.first { it.id == offset }
    local.toInstant(chosen).toString()
}.getOrNull()
@Composable internal fun PlayerClubLocalTime(label: String, initial: String, zone: String): String? {
    val local = remember(initial, zone) { runCatching { Instant.parse(initial).atZone(ZoneId.of(zone)).toLocalDateTime() }.getOrNull() }
    var date by rememberSaveable(initial) { mutableStateOf(local?.toLocalDate()?.toString() ?: LocalDate.now().plusDays(1).toString()) }
    var time by rememberSaveable(initial) { mutableStateOf(local?.toLocalTime()?.toString()?.take(5) ?: if (label.startsWith("Eind")) "22:00" else "19:30") }
    var offset by rememberSaveable(initial) { mutableStateOf("") }
    Field("$label datum", date, { date = it }, max = 10)
    Field("$label tijd · $zone", time, { time = it }, max = 5)
    val offsets = runCatching { ZoneId.of(zone).rules.getValidOffsets(LocalDateTime.parse("${date}T$time")) }.getOrDefault(emptyList())
    if (offsets.size > 1) Choice("$label · wintertijdkeuze", offset, listOf("" to "Kies de bedoelde offset") + offsets.map { it.id to it.id }, { offset = it })
    val result = playerClubLocalInstant("${date}T$time", zone, offset)
    if (result == null) Text(if (offsets.size > 1) "Dit tijdstip komt tweemaal voor. Kies de bedoelde offset." else "Controleer datum/tijd. Een overgeslagen zomertijdstip kan niet worden opgeslagen.", color = PlayerError)
    return result
}
@Composable internal fun PlayerClubCalendar(view: JSONObject, state: PlayerUiState, actions: PlayerActions, active: String?) {
    val id = view.obj("club").text("id"); val enabled = state.online && !state.busy
    var month by rememberSaveable { mutableStateOf(view.rows("activities").find { it.text("id") == active }?.let { runCatching { YearMonth.from(Instant.parse(it.text("startsAt")).atZone(ZoneId.of(it.text("timeZone", "Europe/Amsterdam")))).toString() }.getOrNull() } ?: YearMonth.now(ZoneId.of("Europe/Amsterdam")).toString()) }; var display by rememberSaveable { mutableStateOf("list") }; var selected by rememberSaveable { mutableStateOf(active.orEmpty()) }; var editing by rememberSaveable { mutableStateOf<String?>(null) }
    Choice("Agendaweergave", display, listOf("list" to "Lijst", "month" to "Maand"), { display = it })
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Action("Vorige maand", primary = false, modifier = Modifier.weight(1f)) { month = YearMonth.parse(month).minusMonths(1).toString() }; Text(month); Action("Volgende maand", primary = false, modifier = Modifier.weight(1f)) { month = YearMonth.parse(month).plusMonths(1).toString() } }
    val activities = view.rows("activities").filter { runCatching { Instant.parse(it.text("startsAt")).atZone(ZoneId.of(it.text("timeZone", "Europe/Amsterdam"))).toLocalDate().toString().startsWith(month) }.getOrDefault(false) }
    if (display == "month") BoxWithConstraints {
        val cellWidth = maxWidth / 7
        val ym = YearMonth.parse(month); val blank = ym.atDay(1).dayOfWeek.value - 1
        FlowRow(maxItemsInEachRow = 7) {
            listOf("Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo").forEach { Text(it, Modifier.width(cellWidth).padding(4.dp), color = PlayerMuted) }
            repeat(blank + ym.lengthOfMonth()) { cell ->
                val day = cell - blank + 1; val date = if (day > 0) ym.atDay(day).toString() else ""
                val onDay = activities.filter { runCatching { Instant.parse(it.text("startsAt")).atZone(ZoneId.of(it.text("timeZone", "Europe/Amsterdam"))).toLocalDate().toString() == date }.getOrDefault(false) }
                Text(if (day <= 0) "" else "$day" + if (onDay.isNotEmpty()) " •" else "", Modifier.width(cellWidth).heightIn(min = 48.dp).clickable(enabled = onDay.isNotEmpty()) { selected = onDay.first().text("id") }.padding(4.dp), color = if (onDay.isNotEmpty()) PlayerLime else PlayerText)
            }
        }
    }
    Text("Inschrijven voor een clubactiviteit staat los van je beschikbaarheid voor een teamwedstrijd.", color = PlayerMuted)
    if (activities.isEmpty()) Text("Geen clubactiviteiten in deze maand.", color = PlayerMuted)
    val detail = view.rows("activities").find { it.text("id") == selected }
    if (detail != null) { androidx.activity.compose.BackHandler { selected = "" }; Action("Terug naar agendaoverzicht", primary = false) { selected = "" } }
    (detail?.let(::listOf) ?: activities).sortedBy { it.text("startsAt") }.forEach { activity -> PlayerCard(activity.text("title")) {
        Text("${shortDate(activity.text("startsAt"))} – ${shortDate(activity.text("endsAt"))} · ${activity.text("timeZone")}", color = PlayerLime)
        Text(activity.text("description")); Text("Type: ${when (activity.text("type")) { "training" -> "Training"; "match" -> "Wedstrijd"; "social" -> "Sociaal"; "meeting" -> "Vergadering"; "other" -> "Overig"; else -> "Clubactiviteit" }}", color = PlayerMuted); activity.text("lastChange").takeIf(String::isNotBlank)?.let { Text("Wijziging: $it", color = PlayerMuted) }; activity.text("location").takeIf(String::isNotBlank)?.let { Text("Locatie: $it") }; activity.text("organizerName").takeIf(String::isNotBlank)?.let { Text("Organisator: $it", color = PlayerMuted) }
        Text("${activity.optInt("registered")} / ${activity.optInt("capacity")} aangemeld · ${activity.optInt("waitlisted")} op wachtlijst", color = PlayerMuted)
        Text(when (activity.text("myStatus")) { "registered" -> "Je bent aangemeld"; "waitlisted" -> "Je staat op de wachtlijst"; else -> "Je bent niet aangemeld" }, color = PlayerLime)
        Action(if (activity.text("myStatus").isBlank()) "Aanmelden voor activiteit" else "Afmelden voor activiteit", enabled) { playerClubhouseAction(actions, id, if (activity.text("myStatus").isBlank()) "activity.join" else "activity.leave", json("id" to activity.text("id"))) }
        activity.rows("participants").forEach { Text("${it.text("name")} · ${statusLabel(it.text("status"))}", color = PlayerMuted) }
        if (activity.optBoolean("canManage")) Action("Activiteit bewerken", enabled, false) { editing = activity.toString(); selected = activity.text("id") }
        if (selected == activity.text("id")) Text("Geselecteerde activiteit", color = PlayerLime)
    } }
    PlayerClubCalendarExport(id, state, actions)
    if (playerClubPermission(view, "calendar.manage")) Action("Clubactiviteit maken", enabled) { editing = "{}" }
    editing?.let { saved -> key(saved) { val activity = JSONObject(saved)
        var title by rememberSaveable { mutableStateOf(activity.text("title")) }; var description by rememberSaveable { mutableStateOf(activity.text("description")) }; var capacity by rememberSaveable { mutableStateOf(activity.text("capacity", "20")) }; var location by rememberSaveable { mutableStateOf(activity.text("location")) }; var organizer by rememberSaveable { mutableStateOf(activity.text("organizerName")) }; var zone by rememberSaveable { mutableStateOf(activity.text("timeZone", "Europe/Amsterdam")) }; var type by rememberSaveable { mutableStateOf(activity.text("type", "club")) }
        PlayerCard("Activiteitgegevens") {
            Field("Titel", title, { title = it }, max = 160); Field("Beschrijving", description, { description = it }, multiline = true, max = 4000); Field("Locatie", location, { location = it }, max = 200); Field("Organisator", organizer, { organizer = it }, max = 80); Field("Tijdzone", zone, { zone = it }, max = 80)
            Choice("Activiteitstype", type, listOf("club" to "Clubactiviteit", "training" to "Training", "match" to "Wedstrijd", "social" to "Sociaal", "meeting" to "Vergadering", "other" to "Overig"), { type = it })
            val start = PlayerClubLocalTime("Begin", activity.text("startsAt"), zone); val end = PlayerClubLocalTime("Einde", activity.text("endsAt"), zone)
            Field("Aantal plekken", capacity, { capacity = it.filter(Char::isDigit) }, max = 5)
            Action("Activiteit opslaan", enabled && title.isNotBlank() && start != null && end != null && capacity.toIntOrNull() in 1..10000) { playerClubhouseAction(actions, id, "activity.save", json("title" to title, "description" to description, "startsAt" to start, "endsAt" to end, "timeZone" to zone, "capacity" to capacity.toInt(), "location" to location, "organizerName" to organizer, "type" to type).also { if (activity.text("id").isNotBlank()) it.put("id", activity.text("id")) }, activity.optInt("revision")) }
            Action("Bewerking sluiten", primary = false) { editing = null }
        }
    } }
}
@Composable internal fun PlayerClubTasks(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val id = view.obj("club").text("id"); val enabled = state.online && !state.busy; val manage = playerClubPermission(view, "tasks.manage")
    var filter by rememberSaveable { mutableStateOf("open") }; var mine by rememberSaveable { mutableStateOf(false) }; var editing by rememberSaveable { mutableStateOf<String?>(null) }
    Choice("Taakstatus", filter, listOf("open" to "Open", "done" to "Afgerond", "all" to "Alle"), { filter = it }); PlayerToggle("Alleen mijn taken en diensten", mine, true) { mine = it }
    view.rows("tasks").filter { (filter == "all" || if (filter == "done") it.text("status") == "done" else it.text("status") != "done") && (!mine || it.text("ownerId") == state.profile?.id || state.profile?.id in it.optJSONArray("volunteerIds")?.strings().orEmpty()) }.forEach { task -> PlayerCard(task.text("title")) {
        Text(task.text("description")); task.text("ownerId").takeIf(String::isNotBlank)?.let { owner -> Text("Verantwoordelijke: ${playerClubMembers(view).find { it.text("id") == owner }?.let(::playerPublicName) ?: "Clublid"}", color = PlayerMuted) }; Text("${statusLabel(task.text("status"))} · ${task.text("deadline").takeIf(String::isNotBlank)?.let(::shortDate) ?: "Geen deadline"}", color = PlayerLime)
        if (task.text("function").isNotBlank()) Text("Functie: ${task.text("function")}", color = PlayerMuted)
        if (task.text("startsAt").isNotBlank()) Text("Dienst: ${shortDate(task.text("startsAt"))} – ${shortDate(task.text("endsAt"))}", color = PlayerMuted)
        if (manage || task.text("ownerId") == state.profile?.id) { var nextStatus by rememberSaveable(task.text("id"), task.optInt("revision")) { mutableStateOf(task.text("status", "open")) }; Choice("Voortgang taak", nextStatus, listOf("open" to "Open", "in_progress" to "Bezig", "done" to "Afgerond"), { nextStatus = it }); Action("Taakstatus bijwerken", enabled, false) { playerClubhouseAction(actions, id, "task.status", json("id" to task.text("id"), "status" to nextStatus), task.optInt("revision")) } }
        val volunteers = task.optJSONArray("volunteerIds")?.strings().orEmpty(); val signed = state.profile?.id in volunteers
        Text("${volunteers.size} / ${task.optInt("capacity")} vrijwilligersplaatsen", color = PlayerMuted)
        if (task.text("status") != "done") Action(if (signed) "Mijn vrijwilligersplek afmelden" else "Vrijwilligersplek kiezen", enabled && (signed || volunteers.size < task.optInt("capacity")), false) { playerClubhouseAction(actions, id, if (signed) "task.withdraw" else "task.volunteer", json("id" to task.text("id"))) }
        if (manage) { task.text("privateNote").takeIf(String::isNotBlank)?.let { Text("Alleen voor leiding: $it", color = PlayerMuted) }; Action("Taak bewerken of heropenen", enabled, false) { editing = task.toString() } }
    } }
    if (manage) Action("Taak of vrijwilligersdienst maken", enabled) { editing = "{}" }
    editing?.let { saved -> key(saved) { val task = JSONObject(saved)
        var title by rememberSaveable { mutableStateOf(task.text("title")) }; var description by rememberSaveable { mutableStateOf(task.text("description")) }; var owner by rememberSaveable { mutableStateOf(task.text("ownerId")) }; var deadline by rememberSaveable { mutableStateOf(task.text("deadline").take(10)) }; var status by rememberSaveable { mutableStateOf(task.text("status", "open")) }; var capacity by rememberSaveable { mutableStateOf(task.text("capacity", "1")) }; var note by rememberSaveable { mutableStateOf(task.text("privateNote")) }; var function by rememberSaveable { mutableStateOf(task.text("function")) }; var activityId by rememberSaveable { mutableStateOf(task.text("activityId")) }; var hasShift by rememberSaveable { mutableStateOf(task.text("startsAt").isNotBlank()) }
        PlayerCard("Taakgegevens") {
            Field("Titel", title, { title = it }, max = 160); Field("Toelichting", description, { description = it }, multiline = true, max = 4000)
            Choice("Verantwoordelijke", owner, listOf("" to "Nog niet toegewezen") + playerClubMembers(view).map { it.text("id") to playerPublicName(it) }, { owner = it })
            Field("Deadline (JJJJ-MM-DD, optioneel)", deadline, { deadline = it }, max = 10); Choice("Status", status, listOf("open" to "Open", "in_progress" to "Bezig", "done" to "Afgerond"), { status = it }); Field("Vrijwilligersplaatsen", capacity, { capacity = it.filter(Char::isDigit) }, max = 4); Field("Interne organisatienotitie", note, { note = it }, multiline = true, max = 4000)
            Field("Functie of dienst", function, { function = it }, max = 160)
            Choice("Gekoppelde activiteit", activityId, listOf("" to "Geen activiteit") + view.rows("activities").map { it.text("id") to it.text("title") }, { activityId = it })
            PlayerToggle("Vrijwilligersdienst met tijdvak", hasShift, enabled) { hasShift = it }
            val shiftStart = if (hasShift) PlayerClubLocalTime("Begin dienst", task.text("startsAt"), "Europe/Amsterdam") else null
            val shiftEnd = if (hasShift) PlayerClubLocalTime("Einde dienst", task.text("endsAt"), "Europe/Amsterdam") else null
            val until = if (deadline.isBlank()) null else playerClubLocalInstant("${deadline}T23:59", "Europe/Amsterdam", null)
            Action("Taak opslaan", enabled && title.isNotBlank() && capacity.toIntOrNull() in 1..1000 && (deadline.isBlank() || until != null) && (!hasShift || shiftStart != null && shiftEnd != null)) { playerClubhouseAction(actions, id, "task.save", json("title" to title, "description" to description, "ownerId" to owner.ifBlank { null }, "deadline" to until, "status" to status, "capacity" to capacity.toInt(), "privateNote" to note, "function" to function, "activityId" to activityId.ifBlank { null }, "startsAt" to shiftStart, "endsAt" to shiftEnd).also { if (task.text("id").isNotBlank()) it.put("id", task.text("id")) }, task.optInt("revision")) }
            Action("Bewerking sluiten", primary = false) { editing = null }
        }
    } }
}
