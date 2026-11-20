package nl.dartflow.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

@Composable internal fun PlayerClubFeed(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val club = view.obj("club").text("id"); var sort by rememberSaveable(club) { mutableStateOf("recent") }; var page by remember(club) { mutableStateOf(view.obj("feed")) }; var extra by remember(club) { mutableStateOf(emptyList<JSONObject>()) }; var loading by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }; val scope = rememberCoroutineScope()
    val selectedPost = playerClubRoute(state.activeId)?.item
    var direct by remember(club, selectedPost) { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(club, selectedPost) { if (selectedPost != null) try { val result = actions.read("/feed/post/$selectedPost?channel=${PlayerLinks.encode("club:$club")}").obj("post"); require(result.text("channel") == "club:$club"); direct = JSONObject(result.toString()).put("scopeKind", "club").put("scopeId", club).put("scopeName", view.obj("club").text("name")); error = null } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; direct = null; error = (failure as? PlayerApiFailure)?.feedback ?: "Dit bericht is niet beschikbaar." } }
    CommunityConsent(state, actions)
    LaunchedEffect(view, sort) { try { page = if (sort == "recent") view.obj("feed") else actions.read("/community/feed?kind=club&id=$club&sort=popular"); extra = emptyList(); error = null } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; error = (failure as? PlayerApiFailure)?.feedback ?: "Berichten laden is niet gelukt." } }
    if (selectedPost != null) {
        error?.let { Notice(it, true) }
        if (direct == null && error == null) LinearProgressIndicator()
        direct?.let { CommunityPostCard(it, state, actions, "clubhouse-direct") }
        Action("Terug naar verenigingsfeed", primary = false) { actions.navigate(PlayerScreen.CLUBHOUSE, playerClubId(club, "feed")) }
        return
    }
    Choice("Berichtenvolgorde", sort, listOf("recent" to "Nieuwste eerst", "popular" to "Populair"), { sort = it })
    PlayerClubFeedComposer(club, page, state, actions)
    PlayerClubModeration(view, state, actions)
    error?.let { Notice(it, true) }
    val posts = (page.rows("posts") + extra).distinctBy { it.text("id") }
    direct?.let { PlayerCard("Gedeeld clubbericht") { CommunityPostCard(it, state, actions, "clubhouse-direct") } }
    posts.filter { it.text("id") != direct?.text("id") }.forEach { CommunityPostCard(it, state, actions, "clubhouse") }
    if (posts.isEmpty() && !state.loading) Text("Nog geen clubberichten.", color = PlayerMuted)
    page.text("nextCursor").takeIf(String::isNotBlank)?.let { cursor -> Action("Eerdere clubberichten laden", state.online && !loading, false) { scope.launch { loading = true; try { val next = actions.read("/community/feed?kind=club&id=$club&sort=$sort&cursor=${PlayerLinks.encode(cursor)}"); extra = (extra + next.rows("posts")).distinctBy { it.text("id") }; page = JSONObject(page.toString()).put("nextCursor", next.text("nextCursor")); error = null } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; error = (failure as? PlayerApiFailure)?.feedback ?: "Meer berichten laden is niet gelukt." } finally { loading = false } } } }
}
@Composable private fun PlayerClubFeedComposer(club: String, page: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val context = LocalContext.current; val store = remember(club, state.session?.userId) { PlayerSessionStore(context, "club-feed-draft-${state.session?.userId}-${club}") }; val saved = remember(club, state.session?.userId) { store.read().takeIf { it.text("actor") == state.session?.userId && it.text("club") == club } }
    var body by rememberSaveable(club, state.session?.userId) { mutableStateOf(saved?.text("body").orEmpty()) }; var image by rememberSaveable(club, state.session?.userId) { mutableStateOf(saved?.text("image").orEmpty()) }; var poll by rememberSaveable(club) { mutableStateOf(saved?.optBoolean("poll") ?: false) }; var options by rememberSaveable(club) { mutableStateOf(saved?.text("options").orEmpty()) }; var hours by rememberSaveable(club) { mutableStateOf(saved?.text("hours", "24") ?: "24") }; var multiple by rememberSaveable(club) { mutableStateOf(saved?.optBoolean("multiple") ?: false) }; var change by rememberSaveable(club) { mutableStateOf(saved?.optBoolean("change", true) ?: true) }; var pending by rememberSaveable(club) { mutableStateOf(saved?.text("pending").orEmpty()) }; var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }; val scope = rememberCoroutineScope()
    fun persist() { store.write(json("actor" to state.session?.userId, "club" to club, "body" to body, "image" to image, "poll" to poll, "options" to options, "hours" to hours, "multiple" to multiple, "change" to change, "pending" to pending)) }
    LaunchedEffect(body, image, poll, options, hours, multiple, change, pending) { persist() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) runCatching { image = playerClubLogoBytes(requireNotNull(context.contentResolver.openInputStream(uri)).use { playerReadBounded(it, 8_000_000) }) }.onFailure { error = it.message ?: "Afbeelding kan niet worden gebruikt." } }
    val canWrite = page.rows("scopes").any { it.text("kind") == "club" && it.text("id") == club && it.optBoolean("canWrite") } && canUseCommunity(state.safety)
    PlayerCard("Deel iets met je vereniging") {
        val enabled = canWrite && !busy && pending.isBlank()
        Field("Jouw clubbericht", body, { body = it }, enabled, max = 4000, multiline = true)
        Action("Afbeelding toevoegen", enabled, false) { picker.launch(arrayOf("image/png", "image/jpeg", "image/webp")) }
        if (image.isNotBlank()) { PlayerClubLogo(image, "Bijlage", androidx.compose.ui.Modifier.fillMaxWidth().height(180.dp)); Action("Bijlage verwijderen", enabled, false) { image = "" } }
        PlayerToggle("Peiling toevoegen", poll, enabled) { poll = it }
        if (poll) { Field("Antwoordopties (één per regel)", options, { options = it }, enabled, max = 1000, multiline = true); Field("Peiling open in uren", hours, { hours = it.filter(Char::isDigit) }, enabled, max = 3); PlayerToggle("Meerdere antwoorden mogelijk", multiple, enabled) { multiple = it }; PlayerToggle("Stem aanpassen toestaan", change, enabled) { change = it } }
        error?.let { Notice(it, true) }
        if (pending.isNotBlank()) Text("Nog niet bevestigd · je invoer blijft bewaard.", color = PlayerMuted)
        val choices = options.lines().map(String::trim).filter(String::isNotBlank)
        Action(if (pending.isBlank()) "Clubbericht plaatsen" else "Plaatsen veilig hervatten", canWrite && state.online && !busy && (pending.isNotBlank() || body.isNotBlank() && (!poll || choices.distinct().size in 2..8 && hours.toIntOrNull() in 1..720))) { scope.launch {
            busy = true; error = null
            if (pending.isBlank()) { val action = json("type" to "compose", "channel" to "club:$club", "body" to body); if (image.isNotBlank()) action.put("attachments", JSONArray(listOf(json("name" to "Clubafbeelding.webp", "data" to image)))); if (poll) action.put("poll", json("options" to JSONArray(choices), "endsAt" to Instant.now().plusSeconds(hours.toLong() * 3600).toString(), "multiple" to multiple, "allowChange" to change)); pending = json("requestId" to UUID.randomUUID().toString(), "action" to action).toString(); persist() }
            try { actions.request("/feed/actions", JSONObject(pending)); pending = ""; body = ""; image = ""; poll = false; options = ""; store.clear(); actions.refresh() }
            catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; error = (failure as? PlayerApiFailure)?.feedback ?: "Plaatsen is niet bevestigd. Je concept is bewaard."; if (failure is PlayerApiFailure && failure.status in 400..499) pending = ""; persist() }
            finally { busy = false }
        } }
    }
}
@Composable internal fun PlayerFeedExtras(post: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val extras = post.obj("extras"); if (extras.length() == 0) return
    val id = post.text("feedItemId", post.text("id")); val enabled = state.online && !state.busy
    extras.rows("attachments").forEach { image -> PlayerClubLogo(image.text("data"), image.text("name"), androidx.compose.ui.Modifier.fillMaxWidth().height(180.dp)) }
    val poll = extras.obj("poll")
    if (poll.length() > 0) {
        var selected by rememberSaveable(id, poll.optJSONArray("myOptionIds")?.toString()) { mutableStateOf(poll.optJSONArray("myOptionIds")?.strings().orEmpty()) }
        Text("Peiling · ${poll.optInt("totalVoters")} stemmers · ${if (poll.optBoolean("closed")) "gesloten" else "tot ${shortDate(poll.text("endsAt"))}"}", color = PlayerLime)
        val canVote = enabled && !poll.optBoolean("closed") && (poll.optBoolean("allowChange") || poll.optJSONArray("myOptionIds")?.length() == 0)
        poll.rows("options").forEach { option -> PlayerToggle("${option.text("label")} · ${option.optInt("votes")} stemmen", option.text("id") in selected, canVote) { checked -> selected = if (poll.optBoolean("multiple")) playerWizardSelection(selected, option.text("id"), checked) else if (checked) listOf(option.text("id")) else emptyList() } }
        Action("Mijn stem opslaan", canVote && selected.isNotEmpty(), false) { actions.command("/feed/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "poll.vote", "itemId" to id, "optionIds" to JSONArray(selected)))) }
        if (extras.optBoolean("canEdit") && !poll.optBoolean("closed")) Action("Peiling sluiten", enabled, false) { actions.command("/feed/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "poll.close", "itemId" to id))) }
    }
    if (extras.optBoolean("canEdit") || extras.optBoolean("canPin")) {
        var edit by rememberSaveable(id) { mutableStateOf(false) }; var body by rememberSaveable(id) { mutableStateOf(post.text("body")) }; var pin by rememberSaveable(id) { mutableStateOf("0") }
        if (extras.optBoolean("canEdit")) Action("Bericht bewerken", enabled, false) { edit = !edit }
        if (edit) { Field("Bewerk bericht", body, { body = it }, enabled, max = 4000, multiline = true); Action("Wijziging opslaan", enabled && body.isNotBlank()) { actions.command("/feed/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "edit", "itemId" to id, "expectedRevision" to extras.optInt("revision"), "body" to body))) } }
        if (extras.optBoolean("canPin")) { Choice("Vastpinnen", pin, listOf("0" to "Niet vastpinnen", "1" to "1 dag", "3" to "3 dagen", "7" to "7 dagen").filter { it.first.toInt() <= extras.optInt("maxPinDays", 7) }, { pin = it }, enabled); Action("Pininstelling opslaan", enabled, false) { actions.command("/feed/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "pin", "itemId" to id, "days" to pin.toInt()))) } }
    }
    if (post.text("scopeKind") == "club") ShareButton("${BuildConfig.API_ORIGIN}/app/clubs/${post.text("scopeId")}/feed?post=${post.text("id")}")
}
