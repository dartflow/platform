package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject

internal val playerSupportStatuses = listOf("new" to "Nieuw", "in_progress" to "In behandeling", "waiting_for_user" to "Wacht op gebruiker", "resolved" to "Opgelost", "closed" to "Gesloten")
internal val playerSupportCategories = listOf("account" to "Account & inloggen", "playing" to "Spelen & scores", "competition" to "Competities & toernooien", "boards" to "Banen & Oche Live", "notifications" to "Meldingen", "other" to "Overig")
internal val playerSupportPriorities = listOf("low" to "Laag", "normal" to "Normaal", "high" to "Hoog", "urgent" to "Dringend")
internal fun playerSupportLabel(value: String, options: List<Pair<String, String>>) = options.find { it.first == value }?.second ?: value
internal fun playerSupportQuery(value: String?, admin: Boolean): String {
    val input = runCatching { PlayerLinks.query(java.net.URI("https://native.invalid/?${value.orEmpty().removePrefix("?")}")) }.getOrDefault(emptyMap())
    return input.filter { (key, v) -> when (key) {
        "q" -> v.length <= 160 && v.none { it.code < 32 }
        "status" -> v in playerSupportStatuses.map { it.first } + listOf("all", "open", "unhandled")
        "category" -> v in playerSupportCategories.map { it.first } + "all"
        "priority" -> admin && v in playerSupportPriorities.map { it.first } + "all"
        "assignee" -> admin && (v in listOf("all", "me", "unassigned") || runCatching { java.util.UUID.fromString(v).toString() == v }.getOrDefault(false))
        "offset" -> v.toIntOrNull()?.let { it in 0..100_000 } == true
        "limit" -> v.toIntOrNull()?.let { it in 1..100 } == true
        else -> false
    } }.entries.joinToString("&", prefix = "?") { "${it.key}=${PlayerLinks.encode(it.value)}" }.takeIf { it != "?" }.orEmpty()
}
internal fun playerSupportAction(ticket: JSONObject, type: String, vararg fields: Pair<String, Any?>): JSONObject {
    val permission = when (type) {
        "ticket.reply", "ticket.admin.reply" -> "canReply"
        "ticket.close" -> "canClose"; "ticket.reopen" -> "canReopen"; "ticket.admin.note" -> "canNote"
        "ticket.admin.status" -> "canChangeStatus"
        "ticket.admin.update" -> when { fields.any { it.first == "assigneeId" } -> "canAssign"; fields.any { it.first == "priority" } -> "canSetPriority"; else -> "canEditDetails" }
        else -> throw IllegalArgumentException("Onbekende supportactie.")
    }
    val extraPermissions = if (type == "ticket.admin.update") fields.mapNotNull { when (it.first) { "assigneeId" -> "canAssign"; "priority" -> "canSetPriority"; "subject", "category" -> "canEditDetails"; else -> null } } else emptyList()
    require((extraPermissions + permission).all { ticket.obj("permissions").optBoolean(it) }) { "Dit ticket moet opnieuw worden gecontroleerd voordat je deze actie uitvoert." }
    return json("expectedRevision" to ticket.optInt("revision"), "action" to json("type" to type, "ticketId" to ticket.text("id"), *fields))
}

internal fun playerSupportEventLabel(type: String) = mapOf("created" to "Ticket aangemaakt", "message" to "Openbare reactie", "status" to "Status gewijzigd", "details" to "Ticketgegevens gewijzigd", "internal_note" to "Interne notitie", "assignment" to "Toewijzing gewijzigd", "priority" to "Prioriteit gewijzigd")[type] ?: "Ticket bijgewerkt"
internal fun playerSupportChanges(event: JSONObject, management: JSONObject): List<String> {
    val labels = listOf("previousAssigneeId" to "Eerder toegewezen aan", "assigneeId" to "Toegewezen aan", "previousPriority" to "Vorige prioriteit", "priority" to "Prioriteit", "previousSubject" to "Vorig onderwerp", "subject" to "Onderwerp", "previousCategory" to "Vorige categorie", "category" to "Categorie", "fromStatus" to "Vorige status", "toStatus" to "Status")
    val changes = event.obj("changes")
    return labels.filter { changes.has(it.first) }.map { (key, label) ->
        val value = changes.text(key)
        val display = when (key) {
            "previousAssigneeId", "assigneeId" -> if (value.isBlank()) "Niet toegewezen" else (management.rows("staff") + listOf(management.obj("assignee"), event.obj("actor"))).find { it.text("id") == value }?.text("name") ?: "Eerdere supportmedewerker"
            "previousPriority", "priority" -> playerSupportLabel(value, playerSupportPriorities)
            "previousCategory", "category" -> playerSupportLabel(value, playerSupportCategories)
            "fromStatus", "toStatus" -> playerSupportLabel(value, playerSupportStatuses)
            else -> value
        }
        "$label: $display"
    }
}
internal fun playerSupportNextStatus(ticket: JSONObject, selected: String): String = ticket.obj("management").optJSONArray("allowedStatuses")?.strings().orEmpty().let { if (selected in it) selected else it.firstOrNull().orEmpty() }
internal fun playerSupportTimeline(ticket: JSONObject, admin: Boolean): List<JSONObject> = if (admin && ticket.obj("permissions").optBoolean("canManage")) ticket.obj("management").rows("timeline") else ticket.rows("timeline").filter { it.text("type") in listOf("created", "message", "status", "details") && it.text("visibility") != "internal" }

@Composable internal fun PlayerSupportList(state: PlayerUiState, actions: PlayerActions, admin: Boolean = false) {
    val data = state.resource
    val route = if (admin) PlayerScreen.SUPPORT_ADMIN else PlayerScreen.SUPPORT
    val filters = runCatching { PlayerLinks.query(java.net.URI("https://native.invalid/?${state.activeId.orEmpty()}")) }.getOrDefault(emptyMap())
    var q by rememberSaveable { mutableStateOf(filters["q"].orEmpty()) }
    var status by rememberSaveable { mutableStateOf(filters["status"] ?: if (admin) "unhandled" else "all") }
    var category by rememberSaveable { mutableStateOf(filters["category"] ?: "all") }
    var priority by rememberSaveable { mutableStateOf(filters["priority"] ?: "all") }
    var assignee by rememberSaveable { mutableStateOf(filters["assignee"] ?: "all") }
    var create by rememberSaveable { mutableStateOf(state.activeId == "new=1") }
    var subject by rememberSaveable { mutableStateOf("") }; var body by rememberSaveable { mutableStateOf("") }; var newCategory by rememberSaveable { mutableStateOf("other") }
    val enabled = !state.busy && !state.hasPendingCommand
    LaunchedEffect(state.communicationReceipt.toString()) { if (state.communicationReceipt.obj("input").obj("action").text("type") == "ticket.create") { subject = ""; body = "" } }
    Heading(if (admin) "Supportbeheer" else "Mijn supporttickets", if (admin) "PLATFORMBEHEER" else "HULP", "Vragen en antwoorden blijven bij hun vaste DF-nummer.")
    Action("Terug", primary = false, onClick = actions.back)
    if (admin && !data.optBoolean("canManageSupport")) { if (!state.loading) Notice("Geen actueel recht voor supportbeheer.", true); return }
    if (!admin) {
        Action(if (create) "Ticketformulier sluiten" else "Nieuwe vraag stellen", enabled, false) { create = !create }
        if (create) PlayerCard("Nieuwe supportvraag") {
            Choice("Categorie", newCategory, playerSupportCategories, { newCategory = it }, enabled)
            Field("Onderwerp", subject, { subject = it }, enabled, max = 160)
            Field("Je vraag", body, { body = it }, enabled, max = 8000, multiline = true)
            Text("Vermeld geen wachtwoord, pincode of toegangssleutel. Je vraag is alleen zichtbaar voor jou en de bevoegde supportmedewerkers.", color = PlayerMuted)
            Action("Verstuur supportvraag", enabled && subject.isNotBlank() && body.isNotBlank()) { actions.command("/support/actions", json("action" to json("type" to "ticket.create", "category" to newCategory, "subject" to subject, "body" to body))) }
        }
        if (data.optBoolean("canManageSupport")) Action("Open supportbeheer", primary = false) { actions.navigate(PlayerScreen.SUPPORT_ADMIN, null) }
    } else Text("${data.obj("counts").optInt("open")} open · ${data.obj("counts").optInt("unhandled")} onbehandeld", color = PlayerMuted)
    PlayerCard("Tickets zoeken") {
        Field("Zoek op ticketnummer, onderwerp of tekst", q, { q = it }, max = 160)
        Choice("Status", status, listOf("all" to "Alle statussen", "open" to "Open tickets", "unhandled" to "Onbehandeld") + playerSupportStatuses, { status = it })
        Choice("Categorie", category, listOf("all" to "Alle categorieën") + playerSupportCategories, { category = it })
        if (admin) {
            Choice("Prioriteit", priority, listOf("all" to "Alle prioriteiten") + playerSupportPriorities, { priority = it })
            Choice("Toegewezen aan", assignee, listOf("all" to "Iedereen", "me" to "Aan mij", "unassigned" to "Niet toegewezen") + data.rows("staff").map { it.text("id") to it.text("name") }, { assignee = it })
        }
        Action("Pas ticketfilters toe", primary = false) { actions.navigate(route, playerSupportFilter(q, status, category, priority, assignee, admin, 0)) }
    }
    data.rows("tickets").forEach { ticket -> PlayerCard("${ticket.text("number")} · ${ticket.text("subject")}") {
        Text(playerSupportLabel(ticket.text("status"), playerSupportStatuses) + " · " + playerSupportLabel(ticket.text("category"), playerSupportCategories), color = PlayerMuted)
        Text("Bijgewerkt ${shortDate(ticket.text("updatedAt"))}", color = PlayerMuted)
        if (admin) Text("${ticket.obj("owner").text("name")} · ${playerSupportLabel(ticket.text("priority"), playerSupportPriorities)} · ${ticket.obj("assignee").text("name", "Niet toegewezen")}", color = PlayerMuted)
        Action("Open ${ticket.text("number")}", primary = false) { actions.navigate(if (admin) PlayerScreen.SUPPORT_ADMIN_TICKET else PlayerScreen.SUPPORT_TICKET, ticket.text("id")) }
    } }
    if (!state.loading && data.rows("tickets").isEmpty()) Text("Geen tickets gevonden.", color = PlayerMuted)
    val offset = data.optInt("offset"); val limit = data.optInt("limit", 25)
    Text("${data.optInt("total")} tickets · pagina ${offset / limit.coerceAtLeast(1) + 1}", color = PlayerMuted)
    if (offset > 0) Action("Vorige tickets", primary = false) { actions.navigate(route, playerSupportFilter(q, status, category, priority, assignee, admin, (offset - limit).coerceAtLeast(0))) }
    if (offset + limit < data.optInt("total")) Action("Volgende tickets", primary = false) { actions.navigate(route, playerSupportFilter(q, status, category, priority, assignee, admin, offset + limit)) }
}
internal fun playerSupportFilter(q: String, status: String, category: String, priority: String, assignee: String, admin: Boolean, offset: Int) = playerSupportQuery(listOf("q" to q, "status" to status, "category" to category, "priority" to priority, "assignee" to assignee, "offset" to "$offset").joinToString("&") { "${it.first}=${PlayerLinks.encode(it.second)}" }, admin).removePrefix("?")

@Composable internal fun PlayerSupportDetail(state: PlayerUiState, actions: PlayerActions, admin: Boolean = false) {
    val ticket = state.resource.obj("ticket"); val permissions = ticket.obj("permissions"); val management = ticket.obj("management")
    Heading(ticket.text("number", "Supportticket"), if (admin) "SUPPORTBEHEER" else "MIJN SUPPORT")
    Action("Terug naar tickets", primary = false, onClick = actions.back)
    if (ticket.text("id").isBlank()) { if (!state.loading) Notice("Dit ticket bestaat niet of is niet toegankelijk.", true); return }
    Text(ticket.text("subject"), style = MaterialTheme.typography.titleLarge)
    Text("${playerSupportLabel(ticket.text("status"), playerSupportStatuses)} · ${playerSupportLabel(ticket.text("category"), playerSupportCategories)}", color = PlayerMuted)
    Text(when (ticket.text("waitingOn")) { "support" -> "Support is aan zet."; "user" -> if (admin) "Er wordt op de gebruiker gewacht." else "Er wordt op jouw reactie gewacht."; else -> "Er staat geen reactie open." }, color = PlayerMuted)
    var reply by rememberSaveable { mutableStateOf("") }; var note by rememberSaveable { mutableStateOf("") }; var reason by rememberSaveable { mutableStateOf("") }
    var targetStatus by rememberSaveable { mutableStateOf(playerSupportNextStatus(ticket, "in_progress")) }; var replyStatus by rememberSaveable { mutableStateOf("waiting_for_user") }
    var assignee by rememberSaveable(ticket.text("id")) { mutableStateOf(management.obj("assignee").text("id")) }; var priority by rememberSaveable(ticket.text("id")) { mutableStateOf(management.text("priority", "normal")) }
    var subject by rememberSaveable(ticket.text("id")) { mutableStateOf(ticket.text("subject")) }; var category by rememberSaveable(ticket.text("id")) { mutableStateOf(ticket.text("category")) }
    val enabled = !state.busy && !state.hasPendingCommand
    val receipt = state.communicationReceipt
    LaunchedEffect(ticket.optInt("revision"), management.optJSONArray("allowedStatuses")?.toString()) { targetStatus = playerSupportNextStatus(ticket, targetStatus) }
    LaunchedEffect(receipt.toString()) { if (receipt.obj("result").obj("ticket").text("id") == ticket.text("id")) when (receipt.obj("input").obj("action").text("type")) { "ticket.reply", "ticket.admin.reply" -> reply = ""; "ticket.admin.note" -> note = "" } }
    // Owner routes render only the public projection, even if a malformed response contains management data.
    val timeline = playerSupportTimeline(ticket, admin)
    timeline.forEach { event -> PlayerCard(if (admin && event.text("visibility") == "internal") "Interne notitie · alleen support" else event.text("actorName", event.obj("actor").text("name", "Support"))) {
        Text("${playerSupportEventLabel(event.text("type"))} · ${shortDate(event.text("createdAt"))}", color = PlayerMuted)
        if (event.text("body").isNotBlank()) Text(event.text("body"))
        if (event.text("toStatus").isNotBlank()) Text("Status: ${playerSupportLabel(event.text("toStatus"), playerSupportStatuses)}", color = PlayerMuted)
        if (admin) playerSupportChanges(event, management).forEach { Text(it, color = PlayerMuted) }
    } }
    if (permissions.optBoolean("canReply")) PlayerCard(if (admin) "Antwoord aan gebruiker" else "Je reactie") {
        Field("Reactie", reply, { reply = it }, enabled, max = 8000, multiline = true)
        if (admin) Choice("Status na antwoord", replyStatus, playerSupportStatuses.filter { it.first in listOf("waiting_for_user", "in_progress", "resolved") }, { replyStatus = it }, enabled)
        Action("Verstuur reactie", enabled && reply.isNotBlank()) { actions.command("/support/actions", playerSupportAction(ticket, if (admin) "ticket.admin.reply" else "ticket.reply", "body" to reply, *if (admin) arrayOf("status" to replyStatus) else emptyArray())) }
    }
    if (permissions.optBoolean("canClose")) Action("Ticket sluiten", enabled, false) { actions.command("/support/actions", playerSupportAction(ticket, "ticket.close")) }
    if (permissions.optBoolean("canReopen")) PlayerCard("Ticket heropenen") { Field("Aanvullende uitleg", reply, { reply = it }, enabled, max = 8000, multiline = true); Action("Heropen ticket", enabled) { actions.command("/support/actions", playerSupportAction(ticket, "ticket.reopen", *if (reply.isNotBlank()) arrayOf("body" to reply) else emptyArray())) } }
    if (admin && permissions.optBoolean("canManage")) {
        PlayerCard("Ticketbeheer") {
            if (permissions.optBoolean("canAssign")) { Choice("Supportmedewerker", assignee, listOf("" to "Niet toegewezen") + management.rows("staff").map { it.text("id") to it.text("name") }, { assignee = it }, enabled); Action("Bewaar toewijzing", enabled, false) { actions.command("/support/actions", playerSupportAction(ticket, "ticket.admin.update", "assigneeId" to assignee.ifBlank { null })) } }
            if (permissions.optBoolean("canSetPriority")) { Choice("Prioriteit", priority, playerSupportPriorities, { priority = it }, enabled); Action("Bewaar prioriteit", enabled, false) { actions.command("/support/actions", playerSupportAction(ticket, "ticket.admin.update", "priority" to priority)) } }
            if (permissions.optBoolean("canEditDetails")) { Field("Onderwerp wijzigen", subject, { subject = it }, enabled, max = 160); Choice("Categorie wijzigen", category, playerSupportCategories, { category = it }, enabled); Action("Bewaar ticketgegevens", enabled && subject.isNotBlank(), false) { actions.command("/support/actions", playerSupportAction(ticket, "ticket.admin.update", "subject" to subject, "category" to category)) } }
            if (permissions.optBoolean("canChangeStatus")) { Choice("Nieuwe status", targetStatus, playerSupportStatuses.filter { it.first in management.optJSONArray("allowedStatuses")?.strings().orEmpty() }, { targetStatus = it }, enabled); Field("Reden statuswijziging", reason, { reason = it }, enabled, max = 1000, multiline = true); Action("Wijzig ticketstatus", enabled && targetStatus in management.optJSONArray("allowedStatuses")?.strings().orEmpty(), false) { actions.command("/support/actions", playerSupportAction(ticket, "ticket.admin.status", "status" to targetStatus, *if (reason.isNotBlank()) arrayOf("reason" to reason) else emptyArray())) } }
        }
        if (permissions.optBoolean("canNote")) PlayerCard("Interne notitie") { Text("Uitsluitend voor support. Dit wordt niet naar de gebruiker of diens meldingen gestuurd.", color = PlayerMuted); Field("Interne notitie", note, { note = it }, enabled, max = 8000, multiline = true); Action("Bewaar interne notitie", enabled && note.isNotBlank(), false) { actions.command("/support/actions", playerSupportAction(ticket, "ticket.admin.note", "body" to note)) } }
    }
}
