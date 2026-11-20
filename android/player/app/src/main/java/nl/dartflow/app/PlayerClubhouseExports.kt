package nl.dartflow.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal fun playerReadBounded(input: java.io.InputStream, maximum: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val count = input.read(buffer, 0, minOf(buffer.size, maximum + 1 - output.size())); if (count < 0) break; output.write(buffer, 0, count); require(output.size() <= maximum) { "Dit bestand is te groot." } }
    return output.toByteArray()
}
@Composable internal fun PlayerClubCalendarExport(club: String, state: PlayerUiState, actions: PlayerActions) {
    val context = LocalContext.current; val scope = rememberCoroutineScope(); var feedback by remember { mutableStateOf<String?>(null) }; var busy by remember { mutableStateOf(false) }; var subscription by remember { mutableStateOf<JSONObject?>(null) }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/calendar")) { uri ->
        if (uri != null) scope.launch { busy = true; try { val bytes = actions.download("/clubhouse/$club/calendar.ics"); withContext(Dispatchers.IO) { requireNotNull(context.contentResolver.openOutputStream(uri)).use { it.write(bytes) } }; feedback = "Agenda opgeslagen op de gekozen locatie." } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; feedback = (failure as? PlayerApiFailure)?.feedback ?: "Agenda opslaan is niet gelukt." } finally { busy = false } }
    }
    PlayerCard("Agenda meenemen") {
        Text("Een eenmalig ICS-bestand blijft na downloaden niet automatisch verversen.", color = PlayerMuted)
        Action("Agenda als ICS opslaan", state.online && !busy, false) { export.launch("DartFlow-clubagenda.ics") }
        Text("Een persoonlijke abonnementslink blijft maximaal 90 dagen geldig. Iedereen met de link kan deze agenda lezen zolang jouw lidmaatschap geldig is. Maak en deel hem bewust.", color = PlayerMuted)
        Action("Persoonlijke abonnementslink maken", state.online && !busy, false) { scope.launch { busy = true; try { subscription = actions.request("/clubhouse/$club/calendar-feed", json("revoke" to false)); feedback = "Nieuwe persoonlijke link gemaakt; eerdere link is vervallen." } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; feedback = (failure as? PlayerApiFailure)?.feedback ?: "Link maken is niet gelukt." } finally { busy = false } } }
        subscription?.let { result -> Text("Geldig tot ${shortDate(result.text("expiresAt"))}", color = PlayerMuted); if (result.text("url").startsWith(BuildConfig.API_ORIGIN + "/api/clubhouse/calendar-feed/")) ShareButton(result.text("url")) }
        Action("Mijn abonnementslink intrekken", state.online && !busy, false) { scope.launch { busy = true; try { actions.request("/clubhouse/$club/calendar-feed", json("revoke" to true)); subscription = null; feedback = "Je persoonlijke abonnementslink is ingetrokken." } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; feedback = (failure as? PlayerApiFailure)?.feedback ?: "Intrekken is niet gelukt." } finally { busy = false } } }
        feedback?.let { Text(it, color = PlayerMuted) }
    }
}
@Composable internal fun PlayerPremiumAdministration(state: PlayerUiState, actions: PlayerActions) {
    var expanded by remember { mutableStateOf(false) }; var clubs by remember { mutableStateOf(emptyList<JSONObject>()) }; var error by remember { mutableStateOf<String?>(null) }
    PlayerCard("Platformbeheer premium") {
        Action("Premiumrechten van verenigingen laden", state.online && !state.busy, false) { expanded = true }
        LaunchedEffect(expanded, state.busy) { if (expanded && !state.busy) try { clubs = actions.read("/theme/admin").rows("clubs"); error = null } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; clubs = emptyList(); error = (failure as? PlayerApiFailure)?.feedback ?: "Premiumbeheer niet beschikbaar." } }
        error?.let { Notice(it, true) }
        if (expanded) clubs.forEach { club -> if (club.obj("branding").optBoolean("canManageEntitlement")) {
            Text(club.text("name")); var start by remember(club.text("id")) { mutableStateOf(java.time.LocalDate.now().toString()) }; var end by remember(club.text("id")) { mutableStateOf(java.time.LocalDate.now().plusYears(1).toString()) }
            Field("Premium vanaf (JJJJ-MM-DD)", start, { start = it }, max = 10); Field("Premium tot (JJJJ-MM-DD)", end, { end = it }, max = 10)
            val from = playerClubLocalInstant("${start}T00:00", "Europe/Amsterdam", null); val until = playerClubLocalInstant("${end}T00:00", "Europe/Amsterdam", null)
            Action("Premiumrecht verlenen", state.online && !state.busy && from != null && until != null, false) { playerClubhouseAction(actions, club.text("id"), "entitlement.grant", json("startsAt" to from, "endsAt" to until)) }
            Action("Premiumrecht intrekken", state.online && !state.busy && club.obj("branding").obj("entitlement").optBoolean("effective"), false) { playerClubhouseAction(actions, club.text("id"), "entitlement.revoke") }
        } }
    }
}
