package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject

@Composable internal fun PlayerFriendSearch(state: PlayerUiState, actions: PlayerActions) {
    val actor = state.profile?.id
    var search by rememberSaveable(actor) { mutableStateOf("") }
    var offset by remember(actor, search) { mutableIntStateOf(0) }
    var results by remember(actor, search) { mutableStateOf(emptyList<JSONObject>()) }
    var nextOffset by remember(actor, search) { mutableStateOf<Int?>(null) }
    var loading by remember(actor, search) { mutableStateOf(search.isNotBlank()) }
    var error by remember(actor, search) { mutableStateOf<String?>(null) }
    var retry by remember(actor) { mutableIntStateOf(0) }
    // Cancellation discards an older query/page after input or account changes.
    LaunchedEffect(actor, search, offset, retry, state.online) {
        if (actor == null || search.isBlank()) { loading = false; return@LaunchedEffect }
        if (!state.online) { error = "Zoeken vereist verbinding. Je bestaande vrienden blijven hieronder beschikbaar."; loading = false; return@LaunchedEffect }
        loading = true; error = null
        if (offset == 0) delay(350)
        try {
            val response = actions.read("/players?search=${PlayerLinks.encode(search)}&offset=$offset")
            val page = response.rows("players").filter { it.text("id").isNotBlank() && it.text("id") != actor }.take(50).map(::playerPublicSearchResult)
            results = if (offset == 0) page else (results + page).distinctBy { it.text("id") }
            nextOffset = response.optInt("nextOffset", -1).takeIf { !response.isNull("nextOffset") && it > offset }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = if (failure is PlayerApiFailure) failure.feedback else "Spelers konden niet worden opgehaald. Probeer opnieuw." }
        finally { loading = false }
    }
    PlayerCard("Speler zoeken") {
        Field("Displaynaam of gebruikersnaam", search, { search = it }, max = 80)
        Text("Zoek op openbare displaynaam of @gebruikersnaam. Je volledige naam wordt niet doorzocht.", color = PlayerMuted)
        if (loading) Text("Spelers zoeken…", color = PlayerMuted)
        error?.let { Notice(it, true); Action("Opnieuw zoeken", !state.busy && state.online, false) { retry++ } }
        results.forEach { player ->
            PlayerPublicIdentity(player)
            TextButton(onClick = { actions.platformAction(json("type" to "friend.request", "userId" to player.text("id"))) }, enabled = !state.busy && state.online) { Text("Toevoegen") }
            PlayerSafetyControls(state, actions, player.text("id"), playerPublicName(player))
        }
        if (search.isNotBlank() && !loading && error == null && results.isEmpty()) Text("Geen spelers gevonden.", color = PlayerMuted)
        nextOffset?.let { next -> Action("Meer spelers tonen", !state.busy && state.online && !loading, false) { offset = next } }
    }
}
