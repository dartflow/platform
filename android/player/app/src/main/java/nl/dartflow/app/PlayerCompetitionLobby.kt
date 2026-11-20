package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.KeyboardType
import org.json.JSONObject
import java.time.Instant

internal fun playerCompetitionLobbyOpen(lobby: JSONObject, now: Long): Boolean = lobby.text("status") in listOf("waiting", "ready") && runCatching { Instant.parse(lobby.text("expiresAt")).toEpochMilli() > now }.getOrDefault(false)
internal fun playerCompetitionLobbyConfirmed(lobby: JSONObject): Boolean = lobby.rows("players").let { players -> players.size == 2 && players.map { it.text("id") }.distinct().size == 2 && players.all { it.text("id").isNotBlank() && it.optBoolean("confirmed") } }
internal fun playerCompetitionPinTarget(lobby: JSONObject, actorId: String?): JSONObject? = lobby.rows("players").singleOrNull { it.text("id") != actorId && !it.optBoolean("confirmed") }
internal fun playerCompetitionOpenAction(boardId: String, candidate: JSONObject): JSONObject = json("type" to "open", "boardId" to boardId, "seasonId" to candidate.text("seasonId"), "fixtureId" to candidate.text("fixtureId"), "slotId" to candidate.text("slotId"))

/** Only the authorized board projection offers candidates; the server rechecks every action. */
@Composable internal fun PlayerCompetitionBoard(data: JSONObject, boardId: String, state: PlayerUiState, actions: PlayerActions): Boolean {
    val competition = data.obj("competition")
    val candidates = competition.rows("candidates")
    val lobby = competition.obj("lobby")
    var showOfficial by rememberSaveable(boardId, lobby.text("id")) { mutableStateOf(true) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(lobby.text("expiresAt"), lobby.text("status")) { if (lobby.text("status") in listOf("waiting", "ready")) while (true) { kotlinx.coroutines.delay(1000); now = System.currentTimeMillis() } }
    val active = playerCompetitionLobbyOpen(lobby, now)
    val enabled = !state.busy && state.online
    if (lobby.text("status") == "started") PlayerCard("Officiële competitiewedstrijd") {
        Text("${lobby.text("seasonName")} · ronde ${lobby.optInt("round")} · ${lobby.text("boardName")}", color = PlayerMuted)
        Action("Hervat officiële wedstrijd", enabled) { actions.openLink(lobby.text("matchUrl", "/wedstrijd/${lobby.text("matchId")}")) }
    }
    if (active && showOfficial) {
        PlayerCompetitionLobby(lobby, state, actions, now)
        return true
    }
    if (lobby.text("id").isNotBlank() && !active && lobby.text("status") in listOf("expired", "canceled", "waiting", "ready")) Notice("Deze competitielobby is verlopen of verlaten. Je geplande partij blijft in het programma staan. Haal de actuele baanstatus op voordat je opnieuw kiest.")
    if (candidates.isEmpty()) return false
    PlayerCard("Competitiewedstrijd starten?") {
        Text("Gebruik je bestaande geplande partij. Competitie, regels en uitslagbestemmingen blijven aan die partij gekoppeld.", color = PlayerMuted)
        if (showOfficial) {
            candidates.forEach { candidate ->
                Text("${candidate.text("seasonName")} · ronde ${candidate.optInt("round")}")
                PlayerPublicIdentity(candidate.obj("opponent"))
                Text("${shortDate(candidate.text("startsAt", candidate.text("windowStart")))} · ${candidate.text("boardName")}", color = PlayerMuted)
                Text("${playerRuleLabel(candidate.obj("settings"))} · best of ${candidate.obj("settings").optInt("bestOfLegs", 5)} legs / ${candidate.obj("settings").optInt("bestOfSets", 1)} sets", color = PlayerMuted)
                if (candidate.text("blockedReason").isNotBlank()) Text(candidate.text("blockedReason"), color = PlayerMuted)
                if (candidate.text("matchId").isNotBlank() && candidate.text("resumeUrl").isNotBlank()) Action("Hervat geplande competitiewedstrijd", enabled, false) { actions.openLink(candidate.text("resumeUrl")) }
                else Action("Ja, competitiewedstrijd starten", enabled && candidate.optBoolean("canOpen")) { actions.command("/competition-lobbies/actions", json("action" to playerCompetitionOpenAction(boardId, candidate))) }
            }
            Action("Terug naar vrijspel", primary = false) { showOfficial = false }
        } else Action("Bekijk geplande competitiewedstrijden", primary = false) { showOfficial = true }
    }
    return showOfficial
}

@Composable internal fun PlayerCompetitionLobby(lobby: JSONObject, state: PlayerUiState, actions: PlayerActions, now: Long = System.currentTimeMillis()) {
    val id = lobby.text("id")
    val enabled = !state.busy && state.online && playerCompetitionLobbyOpen(lobby, now)
    val target = playerCompetitionPinTarget(lobby, state.profile?.id)
    var pin by remember(id, target?.text("id")) { mutableStateOf("") }
    var addPin by rememberSaveable(id) { mutableStateOf(false) }
    ClearSecretsOnBackground { pin = ""; addPin = false }
    PlayerCard("Lobby voor je competitiewedstrijd") {
        Text("${lobby.text("seasonName")} · ronde ${lobby.optInt("round")} · ${lobby.text("boardName")}", color = PlayerMuted)
        lobby.rows("players").forEach { player ->
            PlayerPublicIdentity(player)
            Text(if (player.optBoolean("confirmed")) "Bevestigd${if (player.text("method") == "pin") " via eigen spelerspincode" else " met eigen account"}" else "Wacht op deze geplande speler", color = if (player.optBoolean("confirmed")) PlayerLime else PlayerMuted)
        }
        Text("${playerRuleLabel(lobby.obj("settings"))} · best of ${lobby.obj("settings").optInt("bestOfLegs", 5)} legs / ${lobby.obj("settings").optInt("bestOfSets", 1)} sets", color = PlayerMuted)
        Text("Geldig tot ${shortDate(lobby.text("expiresAt"))}. Beide verschillende geplande deelnemers moeten zich bevestigen.", color = PlayerMuted)
        Text("Schrijver: ${lobby.text("writerName", lobby.rows("players").find { it.text("id") == lobby.text("writerId") }?.let(::playerPublicName) ?: "Volgens wedstrijdtoewijzing")}", color = PlayerMuted)
        Text(lobby.text("writerDeviceLabel", "De score-invoer opent na de start bij de toegewezen schrijver. De partijkaart toont wie mag invoeren."), color = PlayerMuted)
        if (lobby.optBoolean("canConfirm")) Action("Ik ben de geplande tegenstander", enabled) { actions.command("/competition-lobbies/actions", json("action" to json("type" to "confirm", "lobbyId" to id))) }
        if (target != null && lobby.rows("players").any { it.text("id") == state.profile?.id && it.optBoolean("confirmed") }) {
            Text("De tegenstander kan met een eigen aangemeld account dezelfde vaste baan-QR scannen.", color = PlayerMuted)
            if (target.text("username").isNotBlank()) {
                Action("Tegenstander bevestigt op dit toestel met pincode", enabled, false) { addPin = !addPin; pin = "" }
                if (addPin) {
                    Field("Gebruikersnaam van geplande tegenstander", target.text("username"), {}, false)
                    Field("Eigen zescijferige spelerspincode", pin, { pin = it.filter { c -> c in '0'..'9' } }, enabled, true, KeyboardType.NumberPassword, max = 6)
                    Action("Bevestig geplande tegenstander", enabled && PlayerValidation.validPin(pin)) { actions.command("/competition-lobbies/player-pin", json("lobbyId" to id, "username" to target.text("username"), "pin" to pin)); pin = ""; addPin = false }
                    Text("De primaire accountsessie blijft behouden. Deze bevestiging geldt alleen voor deze wedstrijd.", color = PlayerMuted)
                }
            } else Text("Voor bevestigen met pincode moet de tegenstander eerst de eigen gebruikersnaam en pincode instellen. Aansluiten met de eigen aangemelde app blijft mogelijk.", color = PlayerMuted)
        }
        if (lobby.optBoolean("canStart")) Action("Ga met beide spelers naar de officiële partij", enabled && playerCompetitionLobbyConfirmed(lobby)) { actions.command("/competition-lobbies/actions", json("action" to json("type" to "prepare", "lobbyId" to id))) }
        if (lobby.optBoolean("canCancel")) Action("Lobby verlaten en baan vrijgeven", enabled, false) { actions.command("/competition-lobbies/actions", json("action" to json("type" to "cancel", "lobbyId" to id))) }
        Action("Haal actuele lobbystatus op", !state.busy && state.online, false, onClick = actions.refresh)
        Action("Hulp bij competitie starten via QR", primary = false) { actions.navigate(PlayerScreen.HELP, "q=competitie QR") }
    }
}
