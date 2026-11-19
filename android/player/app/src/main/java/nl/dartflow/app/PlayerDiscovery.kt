package nl.dartflow.app

import android.content.Intent
import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.net.URI
import java.text.Normalizer
import java.util.Locale

internal fun playerHelpQuery(value: String?): Map<String, String> = runCatching { PlayerLinks.query(URI("https://native.invalid/?${value.orEmpty().removePrefix("?")}")) }
    .getOrDefault(emptyMap()).filter { (key, input) -> key in listOf("q", "category", "id") && input.length <= 200 && input.none { it.code < 32 } }

internal fun playerHelpItems(resource: JSONObject, query: String, category: String): List<JSONObject> {
    fun normalize(value: String) = Normalizer.normalize(value, Normalizer.Form.NFD).replace(Regex("[\\u0300-\\u036f]"), "").lowercase(Locale.forLanguageTag("nl"))
    val terms = normalize(query.trim().take(200)).split(Regex("\\s+")).filter { it.isNotBlank() }
    return resource.rows("items").filter { article ->
        (category.isBlank() || article.text("category") == category) && terms.all { term -> normalize((listOf(article.text("question"), article.text("answer")) + article.optJSONArray("keywords")?.strings().orEmpty()).joinToString(" ")).contains(term) }
    }
}

@Composable internal fun PlayerHelpScreen(state: PlayerUiState, actions: PlayerActions) {
    if (state.canManagePlatform) Action("Beheer gedeelde hulp", primary = false) { actions.navigate(PlayerScreen.FAQ_ADMIN, null) }
    val params = playerHelpQuery(state.activeId)
    var query by rememberSaveable { mutableStateOf(params["q"].orEmpty()) }
    var category by rememberSaveable { mutableStateOf(params["category"].orEmpty().takeIf { value -> state.resource.rows("items").any { it.text("category") == value } }.orEmpty()) }
    val resource = state.resource
    val selected = params["id"]?.let { id -> resource.rows("items").find { it.text("id") == id } }
    val context = LocalContext.current
    Heading("Help & FAQ", "DARTFLOW", "Spelen, organiseren en de geldende regels.")
    Text("Inhoudsversie ${resource.text("version", "wordt opgehaald")} · ${resource.text("publishedAt")}", color = PlayerMuted)
    if (resource.optBoolean("offline")) Notice("Offline · laatst opgeslagen hulp. Online wijzigingen zijn nog niet opgehaald.")
    Action("Terug", primary = false, onClick = actions.back)
    if (selected != null) {
        PlayerCard(selected.text("question")) {
            Text(selected.text("category"), color = PlayerLime)
            Text(selected.text("answer"))
            Action("Deel dit artikel", primary = false) {
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "${selected.text("question")}\n${BuildConfig.API_ORIGIN}/help/${selected.text("id")}"), "Deel hulp"))
            }
        }
        Action("Alle veelgestelde vragen", primary = false) { actions.navigate(PlayerScreen.HELP, null) }
    } else if (params["id"] != null && !state.loading && resource.length() > 0) {
        Notice("Dit artikel is niet beschikbaar in de gepubliceerde hulp.", true)
        Action("Open alle hulp", primary = false) { actions.navigate(PlayerScreen.HELP, null) }
    } else {
        Field("Zoek in vragen en antwoorden", query, { query = it }, max = 200)
        val categories = resource.rows("items").map { it.text("category") }.distinct().sorted()
        Choice("Categorie", category, listOf("" to "Alle onderwerpen") + categories.map { it to it }, { category = it })
        val items = playerHelpItems(resource, query, category)
        if (items.isEmpty() && !state.loading) {
            Text("Geen vragen gevonden. Probeer een ander zoekwoord of wis de filters.", color = PlayerMuted)
            Action("Wis filters", primary = false) { query = ""; category = "" }
        }
        items.forEach { article -> PlayerCard(article.text("question")) {
            Text(article.text("category"), color = PlayerMuted)
            Action("Lees antwoord", primary = false) { actions.navigate(PlayerScreen.HELP, "id=${PlayerLinks.encode(article.text("id"))}") }
        } }
    }
}

internal fun playerRankingsQuery(value: String?): String {
    val query = runCatching { PlayerLinks.query(URI("https://native.invalid/?${value.orEmpty().removePrefix("?")}")) }.getOrDefault(emptyMap())
    val safe = query.filter { (key, input) -> when (key) { "status" -> input in listOf("all", "active", "provisional", "inactive"); "view" -> input in listOf("top", "around"); "limit" -> input.toIntOrNull()?.let { it in 1..100 } == true; "listId" -> Regex("[0-9a-fA-F-]{36}").matches(input); else -> false } }
    return safe.entries.joinToString("&", prefix = if (safe.isEmpty()) "" else "?") { "${it.key}=${PlayerLinks.encode(it.value)}" }
}

@Composable internal fun PlayerRankingsScreen(state: PlayerUiState, actions: PlayerActions) {
    val resource = state.resource
    val policy = resource.obj("policy")
    val selected = resource.obj("selectedList")
    val circuit = selected.text("kind") == "circuit"
    val filters = runCatching { PlayerLinks.query(URI("https://native.invalid/${playerRankingsQuery(state.activeId)}")) }.getOrDefault(emptyMap())
    var query by rememberSaveable { mutableStateOf("") }
    var tab by rememberSaveable(selected.text("id")) { mutableStateOf("list") }
    Heading(selected.text("name", "Spelersrating"), "RANKINGS", if (circuit) "Circuitpunten uit definitieve, toegelaten eindplaatsen." else "Spelersrating uit bevestigde en toegelaten singles.")
    if (resource.rows("lists").isNotEmpty()) Choice("Ranglijst of circuit", selected.text("id", filters["listId"].orEmpty()), resource.rows("lists").map { it.text("id") to "${it.text("name")} · ${if (it.text("scope") == "national") "Landelijk" else "Vereniging"}" }, { actions.navigate(PlayerScreen.RANKINGS, updatedQuery(updatedQuery(state.activeId, "listId", it), "status", "all")) })
    resource.text("updatedAt").takeIf { it.isNotBlank() }?.let { Text("Bijgewerkt ${shortDate(it)}", color = PlayerMuted) }
    selected.text("closesAt").takeIf { it.isNotBlank() }?.let { Text("Gesloten voor nieuwe evenementen vanaf ${shortDate(it)}", color = PlayerMuted) }
    val mine = resource.optJSONObject("me")
    if (mine != null) PlayerCard("Mijn positie") { PlayerRatingRow(mine, policy, circuit) }
    Action("Uitleg ranking en plaatsing", primary = false) { actions.navigate(PlayerScreen.HELP, if (circuit) "q=beste+vijf" else "q=1500") }
    val manage = selected.optBoolean("canManage") || resource.rows("approvals").any { it.optBoolean("canApprove") } || state.platform.rows("clubs").any { it.obj("clubAccess").optJSONArray("permissions")?.strings()?.contains("settings.edit") == true }
    Choice("Ranking", tab, listOf("list" to "Ranglijst", "history" to "Mijn mutaties") + (if (circuit) listOf("qualification" to "Finalekwalificatie") else emptyList()) + if (manage) listOf("manage" to "Beheer en erkenning") else emptyList(), { tab = it })
    when (tab) {
        "qualification" -> PlayerCircuitQualification(state, actions)
        "manage" -> PlayerRankingManageContent(state, actions)
        "history" -> {
            val history = resource.rows("history")
            if (history.isEmpty() && !state.loading) Text("Nog geen definitieve mutaties.", color = PlayerMuted)
            history.forEach { row -> PlayerCard(row.text("opponentName", if (row.text("sourceKind") == "event") "Circuitevenement" else "Tegenstander")) {
                Text(if (row.has("points")) "${row.optInt("points")} circuitpunten · plaats ${row.text("place", "—")}" else "${row.text("before")} → ${row.text("after")} · ${if (row.optDouble("delta") >= 0) "+" else ""}${row.text("delta")}", color = PlayerLime)
                Text(shortDate(row.text("recordedAt")), color = PlayerMuted)
                if (selected.optBoolean("canManage") && row.text("sourceId").isNotBlank() && row.has("sourceRevision")) PlayerRankingSourceDecision(row, state, actions)
                if (row.text("sourceKind") == "event" && row.text("entityId").isNotBlank()) Action("Open bronevenement", primary = false) { actions.navigate(PlayerScreen.EVENT, row.text("entityId")) }
                else if (row.text("matchId").isNotBlank()) Action("Open bronpartij", primary = false) { actions.navigate(PlayerScreen.MATCH, row.text("matchId")) }
            } }
        }
        else -> {
            Choice("Bereik", filters["view"] ?: "top", listOf("top" to "Top 50", "around" to "Rond mijn positie"), { actions.navigate(PlayerScreen.RANKINGS, updatedQuery(state.activeId, "view", it)) })
            if (!circuit) Choice("Status", filters["status"] ?: "all", listOf("active" to "Actief en geplaatst", "provisional" to "Voorlopig", "inactive" to "Inactief", "all" to "Alle spelers"), { actions.navigate(PlayerScreen.RANKINGS, updatedQuery(state.activeId, "status", it)) })
            Field("Zoek in deze lijst", query, { query = it }, max = 80)
            val rows = resource.rows("rows").filter { query.isBlank() || it.text("name").contains(query, ignoreCase = true) }
            if (rows.isEmpty() && !state.loading) Text("Geen spelers gevonden met deze filters.", color = PlayerMuted)
            rows.forEach { row -> PlayerCard { PlayerRatingRow(row, policy, circuit) } }
        }
    }
    if (policy.length() > 0) Text(if (circuit) "Regelversie ${policy.text("version")} · beste ${selected.obj("policy").optInt("bestResults")} van ${selected.obj("policy").optInt("eventCount")} evenementen" else "Regelversie ${policy.text("version")} · beginrating ${policy.optInt("initialRating", 1500)} · plaatsing: ${policy.optInt("placementMatches", 10)} partijen en ${policy.optInt("placementOpponents", 5)} tegenstanders.", color = PlayerMuted)
}

@Composable private fun PlayerRatingRow(row: JSONObject, policy: JSONObject, circuit: Boolean = false) {
    val position = if (row.isNull("position")) "—" else row.text("position", "—")
    Text("$position · ${row.text("name", "Speler")} · ${if (circuit) "${row.optInt("points")} p" else row.text("displayRating", row.text("rating"))}", style = MaterialTheme.typography.titleMedium)
    if (circuit) row.rows("results").forEach { result -> Text("Plaats ${result.optInt("place")} · ${result.optInt("points")} punten · ${if (result.optBoolean("counting")) "Telt mee" else "Weggestreept"}", color = PlayerMuted) }
    else Text(if (row.optBoolean("provisional")) "Voorlopig · ${row.optInt("played")} van ${policy.optInt("placementMatches", 10)} partijen · ${row.optInt("uniqueOpponents")} van ${policy.optInt("placementOpponents", 5)} tegenstanders" else if (row.optBoolean("active")) "Actief · ${row.optInt("played")} partijen" else "Inactief · ${row.optInt("played")} partijen", color = PlayerMuted)
}

@Composable internal fun PlayerClubsScreen(state: PlayerUiState, actions: PlayerActions) {
    Heading("Verenigingen", "JOUW DARTFLOW")
    val clubs = state.platform.rows("clubs")
    if (clubs.isEmpty() && !state.loading) Text("Er zijn nog geen toegankelijke verenigingen. Je kunt zonder clublidmaatschap spelen en zelf een toernooi organiseren.", color = PlayerMuted)
    clubs.forEach { club -> PlayerCard(club.text("name")) {
        Text(if (club.obj("clubAccess").optBoolean("isMember")) "Jouw vereniging" else "Vereniging", color = PlayerLime)
        club.obj("state").text("description").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
        Action("Open vereniging", primary = false) { actions.navigate(PlayerScreen.CLUB, club.text("id")) }
    } }
    Action("Zelf een toernooi organiseren", primary = false) { actions.navigate(PlayerScreen.ORGANIZE, null) }
}

@Composable internal fun PlayerClubScreen(state: PlayerUiState, actions: PlayerActions) {
    val club = state.resource.optJSONObject("entity") ?: state.platform.rows("clubs").find { it.text("id") == state.activeId } ?: JSONObject()
    Heading(club.text("name", "Vereniging"), "VERENIGING")
    if (club.length() == 0) { if (!state.loading) Notice("Deze vereniging is niet beschikbaar voor je huidige account.", true); return }
    val access = club.obj("clubAccess")
    val details = club.obj("clubDetails")
    Text(club.obj("state").text("description"), color = PlayerMuted)
    Text(if (access.optBoolean("isOwner")) "Jouw rol: eigenaar" else if (access.optBoolean("isMember")) "Actief lid" else "Nog geen actief lidmaatschap", color = PlayerLime)
    val events = (state.platform.rows("leagues") + state.platform.rows("tournaments")).filter { it.text("clubId") == club.text("id") }
    events.forEach { event -> PlayerCard(event.text("name")) { Action("Open evenement", primary = false) { actions.navigate(PlayerScreen.EVENT, event.text("id")) } } }
    if (access.optJSONArray("permissions")?.strings()?.contains("tournaments.manage") == true) Action("Toernooi namens vereniging", !state.busy) {
        actions.saveOrganizerDraft(PlayerOrganizerDraft.sanitize(JSONObject()).put("ownership", "club").put("clubId", club.text("id")))
        actions.navigate(PlayerScreen.ORGANIZE, null)
    }
    if (access.optBoolean("isMember")) {
        Action("Verenigingschat", primary = false) { actions.navigate(PlayerScreen.CHAT, "club:${club.text("id")}") }
        PlayerCard("Leden") { club.rows("members").forEach { Text("${it.text("name")} · ${statusLabel(it.text("role"))}") } }
    }
    if (access.optBoolean("canApprove")) details.rows("requests").filter { it.text("status") == "pending" }.forEach { request -> PlayerCard("Aanmelding: ${request.text("name")}") {
        request.rows("answers").forEach { Text("${it.text("label")}: ${it.text("value")}") }
        Action("Lidmaatschap goedkeuren", !state.busy && state.online) { entityCommand(actions, club, json("type" to "club.approve", "id" to club.text("id"), "requestId" to request.text("id"))) }
    } }
    Action("Hulp over verenigingen", primary = false) { actions.navigate(PlayerScreen.HELP, "q=vereniging") }
}

@Composable internal fun PlayerMatchRanking(match: PlayerMatch, state: PlayerUiState, actions: PlayerActions) {
    val eligibility = match.raw.obj("rankingEligibility")
    val ranking = match.raw.obj("ranking")
    val destinations = match.raw.rows("rankingDestinations")
    if (eligibility.length() == 0 && ranking.length() == 0 && destinations.isEmpty()) return
    val own = match.players.indexOfFirst { it.id == state.profile?.id }
    destinations.forEach { destination -> PlayerCard(destination.text("name", "Rankingbestemming")) {
        Text("${if (destination.text("scope") == "club") "Vereniging" else "Landelijk"} · ${when (destination.text("status")) { "admitted" -> "Toegelaten"; "excluded" -> "Uitgesloten"; "booked" -> "Verwerkt"; "void" -> "Ongeldig verklaard"; else -> "In behandeling" }} · beleid ${destination.text("policyVersion")}", color = PlayerLime)
        destination.text("generation").takeIf { it.isNotBlank() }?.let { Text("Actuele generatie: $it", color = PlayerMuted) }
        if (destination.has("before") && destination.has("after")) match.players.indices.forEach { side -> Text("${match.sideName(side)}: ${destination.optJSONArray("before")?.optInt(side)} → ${destination.optJSONArray("after")?.optInt(side)} (${destination.optJSONArray("deltas")?.optInt(side)?.let { if (it > 0) "+$it" else "$it" }.orEmpty()})") }
        destination.text("reason").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
    } }
    if (eligibility.length() == 0 && ranking.length() == 0) return
    PlayerCard("Landelijke spelersrating") {
        val booking = ranking.obj("booking")
        if (booking.length() > 0) {
            Text("Oorspronkelijk boekingsbewijs · de actuele verwerking staat bij de rankingbestemming.", color = PlayerMuted)
            match.players.forEachIndexed { index, player -> Text("${player.displayName.ifBlank { player.name }}: ${booking.optJSONArray("before")?.optInt(index)} → ${booking.optJSONArray("after")?.optInt(index)}", color = PlayerLime) }
        } else if (ranking.text("status") == "reserved") Text("Beide spelers hebben ingestemd · rating volgt na definitieve bevestiging.", color = PlayerLime)
        else if (eligibility.optBoolean("eligible") && own >= 0 && match.status in listOf("planned", "called", "ready")) {
            Text("Beginrating 1500 · alleen na instemming van beide spelers vóór de start.", color = PlayerMuted)
            PlayerToggle("Mijn instemming met rating", ranking.optJSONArray("consents")?.optBoolean(own) == true, !state.busy && state.online) { actions.matchAction("ranking-consent", json("consent" to it)) }
            val other = if (own == 0) 1 else 0
            Text(if (ranking.optJSONArray("consents")?.optBoolean(other) == true) "Tegenstander heeft ingestemd" else "Tegenstander heeft nog niet ingestemd", color = PlayerMuted)
        } else Text(eligibility.text("reason", if (ranking.text("status") == "pending") "Geen officiële rating vastgelegd voor deze partij." else "Rating wordt bijgewerkt."), color = PlayerMuted)
        Action("Ratingregels", primary = false) { actions.navigate(PlayerScreen.HELP, "q=1500") }
    }
}

/** Published public content is kept separate from the encrypted account/command blob. */
internal class PlayerHelpCache(context: Context) {
    private val prefs = context.getSharedPreferences("dartflow-public-help-v1", Context.MODE_PRIVATE)
    fun read(): JSONObject? = runCatching {
        val raw = prefs.getString("published", null) ?: return null
        require(raw.length <= 200_000)
        JSONObject(raw).takeIf { it.has("version") && it.optJSONArray("items") != null }
    }.getOrNull()
    fun write(value: JSONObject) {
        val raw = value.toString()
        if (raw.length <= 200_000 && value.has("version") && value.optJSONArray("items") != null) prefs.edit().putString("published", raw).apply()
    }
}
