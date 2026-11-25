@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package nl.dartflow.app

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.YearMonth
import java.util.UUID

internal fun playerClubhouseAction(actions: PlayerActions, clubId: String, type: String, values: JSONObject = JSONObject(), revision: Int? = null) {
    val body = json("requestId" to UUID.randomUUID().toString(), "action" to JSONObject(values.toString()).put("type", type).put("clubId", clubId))
    revision?.let { body.put("expectedRevision", it) }
    actions.command("/clubhouse/actions", body)
}
internal fun playerClubMembers(view: JSONObject) = view.obj("club").rows("members").filter { it.text("status") == "active" }
internal fun playerClubPermission(view: JSONObject, permission: String) = permission in view.optJSONArray("permissions")?.strings().orEmpty()
@Composable internal fun PlayerClubLogo(data: String?, name: String, modifier: Modifier = Modifier.size(48.dp)) {
    val bitmap = remember(data) { runCatching {
        require(!data.isNullOrBlank() && data.length <= 512_000 && Regex("data:image/(png|jpeg|webp);base64,.*", RegexOption.DOT_MATCHES_ALL).matches(data))
        val raw = android.util.Base64.decode(data.substringAfter(','), android.util.Base64.DEFAULT)
        val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(raw, 0, raw.size, options)
        require(options.outWidth in 1..2048 && options.outHeight in 1..2048)
        android.graphics.BitmapFactory.decodeByteArray(raw, 0, raw.size)?.asImageBitmap()
    }.getOrNull() }
    if (bitmap != null) Image(bitmap, name, modifier) else Avatar(name, modifier)
}
@Composable internal fun PlayerClubhouseScreen(state: PlayerUiState, actions: PlayerActions) {
    val route = playerClubRoute(state.activeId) ?: return
    val view = state.resource
    if (view.obj("club").text("id") != route.clubId) { if (!state.loading) Notice("Dit Clubhouse is niet beschikbaar voor je huidige account.", true, actions.refresh); return }
    val club = view.obj("club"); val pages = view.optJSONArray("pages")?.strings().orEmpty()
    if (route.page == "overview") PlayerPhotoCard(venue = true) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PlayerClubLogo(view.obj("theme").obj("effective").text("logoData"), club.text("name"))
            Column(Modifier.weight(1f)) {
                Text(club.text("name").uppercase(java.util.Locale.ROOT), style = MaterialTheme.typography.labelSmall)
                Text("Clubhouse", fontFamily = PlayerBarlow, style = MaterialTheme.typography.headlineLarge)
            }
        }
        Text("Jouw vereniging, via DartFlow", style = MaterialTheme.typography.bodySmall)
    } else Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        PlayerClubLogo(view.obj("theme").obj("effective").text("logoData"), club.text("name"), Modifier.size(40.dp))
        Column(Modifier.weight(1f)) { Heading(playerClubPages[route.page] ?: "Clubhouse", club.text("name")) }
    }
    val eligibleClubs = state.platform.rows("clubs").filter { it.obj("clubAccess").optBoolean("isMember") }
    if (eligibleClubs.size > 1) Choice("Actieve vereniging", route.clubId, eligibleClubs.map { it.text("id") to it.text("name") }, { actions.navigate(PlayerScreen.CLUBHOUSE, playerClubId(it)) })
    val quickPages = listOf("overview", "feed", "calendar").filter { it in pages }
    PlayerWorkspaceTabs(route.page, quickPages.map { it to playerClubPages.getValue(it) }) { actions.navigate(PlayerScreen.CLUBHOUSE, playerClubId(route.clubId, it)) }
    val otherPages = pages.filter { it !in quickPages }
    if (otherPages.isNotEmpty()) Choice("Meer onderdelen", route.page.takeIf { it in otherPages }.orEmpty(), listOf("" to "Kies een onderdeel") + otherPages.mapNotNull { page -> playerClubPages[page]?.let { page to it } }, { if (it.isNotBlank()) actions.navigate(PlayerScreen.CLUBHOUSE, playerClubId(route.clubId, it)) })
    if (route.page !in pages) { Notice("Je hebt geen toegang tot dit verenigingsonderdeel.", true); return }
    when (route.page) {
        "overview" -> PlayerClubhouseOverview(view, state, actions)
        "feed" -> {
            PlayerClubFeed(view, state, actions)
        }
        "calendar" -> PlayerClubCalendar(view, state, actions, route.item)
        "members" -> PlayerClubMembers(view, state, actions)
        "teams" -> PlayerClubTeams(view, state, actions)
        "competitions" -> PlayerClubCompetitions(view, state, actions)
        "matches" -> PlayerClubMatches(view, state, actions)
        "locations" -> PlayerClubLocations(view, state, actions)
        "tasks" -> PlayerClubTasks(view, state, actions)
        "dues" -> PlayerCard("Contributie") { Text("Nog geen contributieadministratie gekoppeld.", color = PlayerMuted) }
        "manage" -> PlayerClubManagement(view, state, actions)
    }
    val channels = view.rows("channels")
    if (channels.isNotEmpty()) PlayerCard("Verenigingschat") {
        channels.forEach { channel -> Action(channel.text("name") + if (channel.optInt("unread") > 0) " · ${channel.optInt("unread")} ongelezen" else "", primary = false) {
            actions.navigate(PlayerScreen.CLUB_CHAT, playerClubId(route.clubId, item = channel.text("id")))
        } }
        PlayerClubChannelManagement(view, state, actions)
    }
}
@Composable private fun PlayerClubhouseOverview(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val metrics = view.obj("metrics"); val clubId = view.obj("club").text("id")
    Text("Welkom ${state.profile?.displayName.orEmpty()}. Dit speelt er in je vereniging.", color = PlayerMuted)
    Text("Periode: ${shortDate(metrics.obj("period").text("from"))} – ${shortDate(metrics.obj("period").text("to"))}", color = PlayerMuted)
    BoxWithConstraints {
        val cardWidth = (maxWidth - 10.dp) / 2
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), maxItemsInEachRow = 2) {
            listOf("members" to "Actieve leden", "teamMatches" to "Teamwedstrijden", "individualMatches" to "Individuele partijen", "activeTeams" to "Actieve teams").forEach { (key, label) -> PlayerCard(label, Modifier.width(cardWidth)) { Text(if (metrics.has(key)) metrics.optInt(key).toString() else "Nog niet beschikbaar", style = MaterialTheme.typography.headlineMedium, color = PlayerLime) } }
        }
    }
    val upcoming = playerUpcomingActivities(view.rows("activities"))
    PlayerCard("Binnenkort") { if (upcoming.isEmpty()) Text("Geen komende clubactiviteiten.", color = PlayerMuted); upcoming.forEach { activity -> Text(activity.text("title")); Text(shortDate(activity.text("startsAt")), color = PlayerMuted); Action("Bekijk activiteit", primary = false) { actions.navigate(PlayerScreen.CLUBHOUSE, playerClubId(clubId, "calendar", activity.text("id"))) } } }
    PlayerCard("Open taken") { val tasks = view.rows("tasks").filter { it.text("status") != "done" }.take(3); if (tasks.isEmpty()) Text("Geen open taken.", color = PlayerMuted); tasks.forEach { Text(it.text("title")); it.text("deadline").takeIf(String::isNotBlank)?.let { deadline -> Text(shortDate(deadline), color = PlayerMuted) } }; Action("Taken en vrijwilligers", primary = false) { actions.navigate(PlayerScreen.CLUBHOUSE, playerClubId(clubId, "tasks")) } }
    PlayerCard("Recente clubberichten") {
        if (view.obj("feed").rows("posts").isEmpty()) Text("Nog geen clubberichten.", color = PlayerMuted)
        view.obj("feed").rows("posts").take(3).forEach { post -> Text(post.text("authorName"), color = PlayerLime); Text(post.text("body"), maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis); Text(shortDate(post.text("createdAt")), color = PlayerMuted); Action("Open dit clubbericht", primary = false) { actions.navigate(PlayerScreen.CLUBHOUSE, playerClubId(clubId, "feed", post.text("id"))) } }
    }
    Action("Bekijk verenigingsfeed", primary = false) { actions.navigate(PlayerScreen.CLUBHOUSE, playerClubId(clubId, "feed")) }
    PlayerClubMatches(view, state, actions, limit = 1)
}
@Composable private fun PlayerClubCompetitions(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val clubId = view.obj("club").text("id")
    if (playerClubPermission(view, "competitions.manage")) Action("Interne competitie maken", state.online && !state.busy) { actions.navigate(PlayerScreen.CLUB_COMPETITION_WIZARD, playerClubId(clubId)) }
    val seasons = view.rows("competitions").sortedBy(::playerEventPriority)
    if (seasons.isEmpty()) Text("Nog geen zichtbare interne competities. Concepten zijn alleen voor bevoegde leiding zichtbaar.", color = PlayerMuted)
    seasons.forEach { season -> PlayerCard(season.text("name")) { Text("${season.text("format")} · ${statusLabel(season.text("status"))}", color = PlayerLime); Action("Open programma, stand en reglement", primary = false) { actions.navigate(PlayerScreen.SEASON, season.text("id")) } } }
    Action("Ook landelijke DartFlow Leagues bekijken", primary = false) { actions.navigate(PlayerScreen.SEASONS, null) }
}
@Composable private fun PlayerClubMatches(view: JSONObject, state: PlayerUiState, actions: PlayerActions, limit: Int = 50) {
    val clubId = view.obj("club").text("id")
    val rows = view.rows("matches").ifEmpty { state.overview.rows("matches").filter { it.text("clubId") == clubId } }.take(limit)
    if (rows.isEmpty()) Text("Nog geen toegankelijke partijen. Bekijk het competitieprogramma voor geplande ontmoetingen.", color = PlayerMuted)
    rows.forEach { match -> PlayerCard(match.text("name", "Partij")) { Text(statusLabel(match.text("status")), color = PlayerLime); Text(match.optJSONArray("playerNames")?.strings()?.joinToString(" – ").orEmpty()); match.text("startsAt").takeIf(String::isNotBlank)?.let { Text(shortDate(it), color = PlayerMuted) }; if (match.optBoolean("canOpen")) Action(if (match.text("seasonId").isNotBlank()) "Open competitieontmoeting" else "Open partij", primary = false) { if (match.text("seasonId").isNotBlank()) actions.navigate(PlayerScreen.SEASON, match.text("seasonId")) else actions.navigate(PlayerScreen.MATCH, match.text("matchId", match.text("id"))) } } }
}
@Composable private fun PlayerClubLocations(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val locations = view.rows("locations")
    if (locations.isEmpty()) Text("Nog geen expliciet gekoppelde locaties en banen. Een bevoegde locatiebeheerder kan planningstoegang verlenen.", color = PlayerMuted)
    locations.forEach { location -> PlayerCard(location.text("name")) { location.rows("boards").forEach { board -> Text(board.text("name")); Action("Open baan", primary = false) { actions.navigate(PlayerScreen.BOARD, board.text("id")) } } } }
    if (playerClubPermission(view, "competitions.manage")) Action("Beheer planningstoegang", primary = false) { actions.navigate(PlayerScreen.CLUB_COMPETITION_WIZARD, playerClubId(view.obj("club").text("id"))) }
    Action("Mijn toegankelijke Oche Live-schermen beheren", primary = false) { actions.navigate(PlayerScreen.SCREENS, null) }
    Action("Mijn fysieke locaties en reserveringen", primary = false) { actions.navigate(PlayerScreen.LOCATIONS, null) }
}
