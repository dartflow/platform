package nl.dartflow.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

internal fun playerMergeMessages(before: List<JSONObject>, after: List<JSONObject>) = (before + after).associateBy { it.text("id") }.values.sortedBy { it.optInt("sequence") }
@Composable internal fun PlayerClubChannelManagement(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val managed = view.rows("channels").filter { it.optBoolean("canManage") }
    if (managed.isEmpty()) return
    var editing by rememberSaveable { mutableStateOf<String?>(null) }; val club = view.obj("club").text("id")
    Action("Kanaal maken", state.online && !state.busy, false) { editing = "{}" }
    managed.filter { it.text("kind") != "general" }.forEach { channel -> Action("Kanaal ${channel.text("name")} beheren", state.online && !state.busy, false) { editing = channel.toString() } }
    editing?.let { saved -> key(saved) {
        val current = JSONObject(saved); var name by rememberSaveable { mutableStateOf(current.text("name")) }; var kind by rememberSaveable { mutableStateOf(current.text("kind", "team")) }; var team by rememberSaveable { mutableStateOf(current.text("teamId")) }; var policy by rememberSaveable { mutableStateOf("members") }
        PlayerCard("Kanaalinstellingen") {
            Field("Kanaalnaam", name, { name = it }, max = 80)
            if (current.text("kind") != "general") Choice("Zichtbaarheid kanaal", kind, listOf("team" to "Alleen dit team", "board" to "Bestuurskanaal"), { kind = it })
            if (kind == "team") Choice("Eigen clubteam", team, listOf("" to "Kies team") + view.rows("teams").map { it.text("id") to it.text("name") }, { team = it })
            Choice("Schrijven", policy, listOf("members" to "Leden van dit kanaal", "managers" to "Alleen bevoegde leiding"), { policy = it })
            Action("Kanaal opslaan", state.online && !state.busy && name.isNotBlank() && (kind != "team" || team.isNotBlank())) { playerClubhouseAction(actions, club, "channel.save", json("name" to name, "kind" to kind, "teamId" to team.ifBlank { null }, "writePolicy" to policy).also { if (current.text("id").isNotBlank()) it.put("id", current.text("id")) }, current.optInt("revision")) }
            if (current.text("id").isNotBlank() && current.text("kind") != "general") Action("Kanaal archiveren", state.online && !state.busy, false) { playerClubhouseAction(actions, club, "channel.archive", json("id" to current.text("id")), current.optInt("revision")); editing = null }
            Action("Kanaalbewerking sluiten", primary = false) { editing = null }
        }
    } }
}
@Composable internal fun PlayerClubChat(state: PlayerUiState, actions: PlayerActions) {
    val route = playerClubRoute(state.activeId) ?: return; val channelId = route.item ?: route.clubId
    val data = state.resource; val channel = data.obj("channel"); val authorized = channel.text("id") == channelId
    val context = androidx.compose.ui.platform.LocalContext.current
    val store = remember(state.session?.userId, channelId) { PlayerSessionStore(context, "club-chat-draft-${state.session?.userId}-${channelId}") }
    val cached = remember(channelId, state.session?.userId) { store.read().takeIf { it.text("actor") == state.session?.userId && it.text("channel") == channelId } }
    var draft by rememberSaveable(channelId, state.session?.userId) { mutableStateOf(cached?.text("body").orEmpty()) }; var pending by rememberSaveable(channelId, state.session?.userId) { mutableStateOf(cached?.text("pending").orEmpty()) }
    var messages by remember(channelId, state.session?.userId) { mutableStateOf(emptyList<JSONObject>()) }; var cursor by remember(channelId) { mutableIntStateOf(0) }; var before by remember(channelId) { mutableStateOf<Int?>(null) }; var more by remember(channelId) { mutableStateOf(false) }; var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }; val scope = rememberCoroutineScope(); val list = rememberLazyListState()
    fun persist() { if (draft.isBlank() && pending.isBlank()) store.clear() else store.write(json("actor" to state.session?.userId, "channel" to channelId, "body" to draft, "pending" to pending)) }
    LaunchedEffect(draft, pending) { persist() }
    LaunchedEffect(data, authorized) {
        if (authorized) { messages = playerMergeMessages(messages, data.rows("messages")); cursor = maxOf(cursor, data.optInt("cursor")); if (before == null) { before = data.optInt("nextBefore").takeIf { it > 0 }; more = data.optBoolean("hasMoreBefore") } }
        else if (!state.loading) messages = emptyList()
    }
    LaunchedEffect(messages.lastOrNull()?.text("id")) { if (messages.isNotEmpty() && list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= messages.lastIndex - 3 } != false) list.animateScrollToItem(messages.lastIndex + 1) }
    // Reading is acknowledged only while the actual latest message is on screen.
    LaunchedEffect(cursor, list.firstVisibleItemIndex, list.layoutInfo.visibleItemsInfo.lastOrNull()?.index, authorized) { if (authorized && cursor > 0 && list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= messages.lastIndex + 1 } == true) runCatching { actions.request("/clubhouse/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "channel.read", "clubId" to route.clubId, "channelId" to channelId, "cursor" to cursor))) } }
    BackHandler { persist(); actions.back() }
    Column(Modifier.fillMaxSize().imePadding().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth()) { Column(Modifier.weight(1f)) { Heading(if (authorized) channel.text("name") else "Verenigingschat", "CLUBHOUSE") }; Action("Sluiten", primary = false) { persist(); actions.back() } }
        if (state.error != null) Notice(state.error, true, actions.refresh)
        if (!authorized) { if (state.loading) LinearProgressIndicator() else Notice("Je hebt geen actuele toegang tot dit kanaal. Een lokaal concept geeft geen kanaaltoegang.", true); return@Column }
        CommunityConsent(state, actions)
        error?.let { Notice(it, true) }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { if (more) Action("Eerdere chatberichten laden", state.online && !busy, false) { scope.launch { busy = true; try { val page = actions.read("/clubhouse/${route.clubId}/channels/$channelId?before=${before ?: messages.firstOrNull()?.optInt("sequence") ?: 0}"); require(page.obj("channel").text("id") == channelId); messages = playerMergeMessages(page.rows("messages"), messages); more = page.optBoolean("hasMoreBefore"); before = page.optInt("nextBefore").takeIf { it > 0 } } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; error = (failure as? PlayerApiFailure)?.feedback ?: "Eerdere berichten laden is niet gelukt." } finally { busy = false } } } }
            items(messages, key = { it.text("id") }) { message -> PlayerCard(message.text("authorName")) {
                Text(shortDate(message.text("createdAt")), color = PlayerMuted); Text(if (message.optBoolean("deleted")) "Bericht verwijderd." else message.text("body"))
                if (!message.optBoolean("deleted")) {
                    PlayerSafetyControls(state, actions, message.text("authorId"), message.text("authorName"), PlayerReportTarget("message", message.text("id"), "Chatbericht", "club", route.clubId))
                    if (channel.optBoolean("canModerate") || message.text("authorId") == state.profile?.id) Action("Chatbericht verwijderen", state.online && !state.busy, false) { playerClubhouseAction(actions, route.clubId, "channel.message.delete", json("channelId" to channelId, "messageId" to message.text("id"))) }
                }
            } }
            item { if (messages.isEmpty()) Text("Nog geen berichten.", color = PlayerMuted); if (pending.isNotBlank()) PlayerCard("Wordt verstuurd") { Text(runCatching { JSONObject(pending).obj("action").text("body") }.getOrDefault("")); Text("Nog geen serverbevestiging", color = PlayerMuted) } }
        }
        if (pending.isNotBlank()) Text("Wordt verstuurd · je bericht blijft bewaard tot de server bevestigt.", color = PlayerMuted)
        Field("Bericht aan ${channel.text("name")}", draft, { draft = it }, channel.optBoolean("canWrite") && !busy && pending.isBlank() && canUseCommunity(state.safety), max = 2000, multiline = true)
        Action(if (pending.isNotBlank()) "Versturen veilig hervatten" else "Bericht verzenden", state.online && !busy && channel.optBoolean("canWrite") && canUseCommunity(state.safety) && (draft.isNotBlank() || pending.isNotBlank())) { scope.launch {
            busy = true; error = null
            if (pending.isBlank()) { pending = json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "channel.message", "clubId" to route.clubId, "channelId" to channelId, "body" to draft)).toString(); persist() }
            try { actions.request("/clubhouse/actions", JSONObject(pending)); pending = ""; draft = ""; persist(); val fresh = actions.read("/clubhouse/${route.clubId}/channels/$channelId?after=$cursor"); require(fresh.obj("channel").text("id") == channelId); messages = playerMergeMessages(messages, fresh.rows("messages")); cursor = fresh.optInt("cursor"); if (messages.isNotEmpty()) list.animateScrollToItem(messages.lastIndex + 1); actions.refresh() }
            catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; error = (failure as? PlayerApiFailure)?.feedback ?: "Versturen is niet bevestigd. Hetzelfde bericht kan veilig opnieuw worden aangeboden."; if (failure is PlayerApiFailure && failure.status in 400..499) pending = ""; persist() }
            finally { busy = false }
        } }
    }
}
