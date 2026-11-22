package nl.dartflow.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

internal val playerPublicPlayScreens = setOf(PlayerScreen.PLAY_START, PlayerScreen.PLAY_SESSION, PlayerScreen.PLAY_HISTORY, PlayerScreen.PRACTICE, PlayerScreen.CHALLENGES)

@Composable internal fun PlayerPlayScreen(state: PlayerUiState, actions: PlayerActions) {
    val session = state.play.session
    var fullScore by rememberSaveable(session?.id) { mutableStateOf(true) }
    val scoringState = rememberSaveableStateHolder()
    val scoreAvailable = state.screen == PlayerScreen.PLAY_SESSION && session != null && session.supported && !session.complete && session.raw.text("status") == "active" && session.game.text("status") == "live" && (state.play.canonical ?: session).raw.obj("conflict").text("status") != "open" && state.play.purpose != "claim"
    BackHandler { if (scoreAvailable && fullScore) fullScore = false else actions.back() }
    if (scoreAvailable && fullScore) {
        scoringState.SaveableStateProvider("play-score:${session!!.id}") { PlayerPlayScoreScreen(state, actions) { fullScore = false } }
        return
    }
    Column(Modifier.fillMaxSize().background(PlayerInk).safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Action("Terug", primary = false, onClick = actions.back)
        if (state.play.syncing) LinearProgressIndicator(Modifier.fillMaxWidth(), color = PlayerLime)
        state.play.error?.let { Notice(it, true) { actions.playAction(json("type" to "local.refresh")) } }
        if(state.play.pendingOperation!=null)PlayerCard("Eerdere wijziging wacht op bevestiging"){
            Text("De oorspronkelijke aanvraag blijft met hetzelfde actie-ID bewaard. Controleer de uitkomst voordat je een andere partijwijziging uitvoert.",color=PlayerMuted)
            Action("Controleer bewaarde partijwijziging",!state.play.syncing){actions.playAction(json("type" to "local.retry-operation"))}
        }
        when (state.screen) {
            PlayerScreen.PLAY_SESSION -> PlayerPlaySessionScreen(state, actions) { fullScore = true }
            PlayerScreen.PLAY_HISTORY -> PlayerPlayHistoryScreen(state, actions)
            PlayerScreen.CHALLENGES -> PlayerPlayChallengesScreen(state, actions)
            PlayerScreen.PRACTICE -> PlayerPracticeScreen(state, actions)
            else -> PlayerPlayStartScreen(state, actions)
        }
        Action("Speluitleg & herstelhulp", primary = false) { actions.navigate(PlayerScreen.MANUAL,state.play.session?.rules?.text("mode")?.let{when(it){"bingo"->"dubbelbingo";"finish"->"finishtraining";"leg-challenge"->"versla-mijn-leg";else->it}}) }
        Text("Powered by DartFlow", color = PlayerMuted, fontSize = 12.sp)
    }
}

@Composable private fun PlayerPlayStartScreen(state: PlayerUiState, actions: PlayerActions) {
    val replaySession = state.play.session?.takeIf { state.activeId=="replay:${it.id}" }
    var encodedRules by rememberSaveable(state.activeId) { mutableStateOf((replaySession?.rules ?: playerPlayDefaultRules(state.activeId?.removePrefix("mode:")?.substringBefore(':')?.takeIf { state.activeId.startsWith("mode:") && it in playerPlayModes } ?: "x01").also { rules ->
        val fields = state.activeId.orEmpty().split(':'); if (fields.getOrNull(1) == "finish") { fields.getOrNull(2)?.toIntOrNull()?.let { rules.put("target", it) }; fields.getOrNull(3)?.takeIf { it in listOf("double", "straight", "master") }?.let { rules.put("outRule", it) } }
    }).toString()) }
    val rules = remember(encodedRules) { JSONObject(encodedRules) }
    var count by rememberSaveable(state.activeId) { mutableStateOf(replaySession?.participants?.size?.toString() ?: "2") }; var teams by rememberSaveable(state.activeId) { mutableStateOf(replaySession?.sides?.any{(it.optJSONArray("playerIds")?.length() ?: 0)>1} ?: false) }
    var names by rememberSaveable(state.activeId) { mutableStateOf(replaySession?.participants?.map{it.text("name")}?.let{it+List((8-it.size).coerceAtLeast(0)){""}} ?: listOf(state.profile?.displayName.orEmpty(), "", "", "", "", "", "", "")) }
    var useAccount by rememberSaveable(state.activeId){mutableStateOf(state.profile!=null)}
    var deviceMode by rememberSaveable { mutableStateOf("shared") }; var starter by rememberSaveable { mutableStateOf("0") }
    var summary by rememberSaveable { mutableStateOf(false) }
    val practice = rules.text("mode") in listOf("finish", "leg-challenge")
    val playerCount = if (practice) 1 else count.toIntOrNull() ?: 2
    val selected = names.take(playerCount).mapIndexed{index,name->if(index==0&&useAccount&&state.profile!=null)state.profile.displayName else name}; val board = state.play.board.obj("board")
    val boardId = if(replaySession!=null)replaySession.raw.rows("boards").firstOrNull()?.text("id")else state.activeId?.takeUnless { it.startsWith("mode:") || it.startsWith("replay:") }
    val allowedCount = if (rules.text("mode") == "bingo") if (teams) listOf(4,6,8) else listOf(1,2,3,4) else listOf(1,2)
    Heading("Nieuwe partij", "SPELEN", "Ook zonder account. Namen blijven gekoppeld aan deze partij; je kunt je eigen deelname later claimen.")
    if (boardId != null) PlayerCard(board.text("name", "Baan")) {
        Text(if (board.optBoolean("available")) "Beschikbaar" else board.text("reason", "Deze baan kan nu niet worden gestart."), color = PlayerMuted)
        if(state.play.board.optBoolean("requiresAccount")&&state.session==null)Action("Inloggen voor deze baan"){actions.navigate(PlayerScreen.HOME,null)}
        state.play.board.obj("play").text("id").takeIf(String::isNotBlank)?.let { id -> Action("Hervat partij op deze baan") { actions.navigate(PlayerScreen.PLAY_SESSION, id) } }
        state.play.board.text("officialUrl").takeIf(String::isNotBlank)?.let { url -> Action("Geplande officiële wedstrijd", primary = false) { actions.openLink(url) } }
    }
    PlayerCard("Spelregels") { PlayerPlayRulesEditor(rules, !state.play.syncing) { encodedRules = it.toString(); summary = false; if ((count.toIntOrNull() ?: 2) !in if (it.text("mode") == "bingo") 1..8 else 1..2) count = "2" } }
    PlayerCard("Deelnemers & bediening") {
        if(state.profile!=null)PlayerToggle("Eerste speler is mijn account",useAccount,!state.play.syncing){useAccount=it;summary=false}
        if (rules.text("mode") == "bingo") PlayerToggle("Twee teams", teams, !state.play.syncing) { teams = it; count = if (it) "4" else "2"; summary = false }
        if (!practice) Choice("Aantal spelers", count, allowedCount.map { "$it" to "$it" }, { count = it; summary = false }, !state.play.syncing)
        selected.forEachIndexed { index, value -> Field(if (teams) "Team ${if (index < playerCount / 2) 1 else 2} · speler ${index % (playerCount / 2) + 1}" else "Voornaam speler ${index + 1}", value, { value -> names = names.toMutableList().also { it[index] = value }; summary = false }, !state.play.syncing, max = 80) }
        Choice("Scorebediening", deviceMode, listOf("shared" to "Eén schrijver op dit toestel", "individual" to "Iedere speler een eigen telefoon"), { deviceMode = it; summary = false }, !state.play.syncing)
        Choice("Wie begint?", starter, (0 until if (teams) 2 else playerCount).map { "$it" to if (teams) "Team ${it + 1}" else selected.getOrNull(it).orEmpty().ifBlank { "Speler ${it + 1}" } }, { starter = it; summary = false }, !state.play.syncing)
        Text(if (deviceMode == "shared") "Dit toestel voert de beurten in. Overdracht gebeurt bewust met behoud van de partij." else "Deel na het starten de eigen deelnemerslink. Op ieder toestel kan alleen de eigen beurt worden ingevoerd; wacht op serververwerking.", color = PlayerMuted)
    }
    val valid = playerPlayDistinctNames(selected) && playerCount in if (practice) 1..1 else allowedCount.min()..allowedCount.max()
    Action("Controleer partij", valid && !state.play.syncing, modifier = Modifier.fillMaxWidth()) { summary = true }
    if (summary) PlayerCard("Controle vóór de eerste pijl") {
        Text(selected.joinToString(" · "), color = PlayerText); Text(playerPlayRulesLabel(rules), color = PlayerLime)
        Text("${if (boardId == null) "Zonder gekoppelde baan" else board.text("name", "Gescande baan")} · ${if (deviceMode == "shared") "één schrijver" else "eigen telefoons"} · starter ${if (teams) "team ${starter.toInt() + 1}" else selected.getOrNull(starter.toInt()).orEmpty()}", color = PlayerMuted)
        Text("Vrij spel telt niet mee voor een officiële ranking. Verwerkte beurten worden door de server bevestigd.", color = PlayerMuted)
        Action("Start deze partij", !state.play.syncing && (boardId == null || state.play.board.optBoolean("canStart")), modifier = Modifier.fillMaxWidth()) {
            val players = JSONArray(selected.mapIndexed { index, value -> json("name" to PlayerValidation.normalizeName(value)).also { if (index == 0 && useAccount && state.profile != null) it.put("accountId", state.profile.id) } })
            val action = json("type" to "session.create", "deviceMode" to deviceMode, "players" to players, "rules" to rules, "starter" to starter.toInt())
            boardId?.let { action.put("boardId", it) }
            if (teams) action.put("sides", JSONArray(listOf(JSONArray((0 until playerCount / 2).toList()), JSONArray((playerCount / 2 until playerCount).toList()))))
            actions.playAction(action)
        }
    }
    Action("Scan een vaste baan-QR", primary = false, onClick = actions.scan)
    Action("Mijn partijen & herstel", primary = false) { actions.navigate(PlayerScreen.PLAY_HISTORY, null) }
}

@Composable private fun PlayerPlaySessionScreen(state: PlayerUiState, actions: PlayerActions, openConsole: () -> Unit) {
    val session = state.play.session
    if (session == null) { Notice("De partij wordt opgehaald. Een persoonlijke herstel- of deelnemerslink geeft alleen toegang tot deze partij."); Action("Opnieuw ophalen") { actions.refresh() }; return }
    val canonical = state.play.canonical ?: session; val p = session.permissions; val pending = state.play.pending
    val context = LocalContext.current
    Heading(playerPlayModeName(session.rules.text("mode")), "PARTIJ", session.raw.rows("boards").joinToString(" · ") { it.text("name") })
    Notice(when { canonical.raw.obj("conflict").text("status") == "open" -> "Controle nodig · ${pending} lokale beurt(en) bewaard"; pending > 0 -> "Wacht op verbinding · $pending beurt(en) · lokaal voorlopig"; else -> "Verwerkt · ${canonical.game.rows("visits").size} beurt(en)" }, pending > 0)
    PlayerPlayGameView(session)
    if (!session.supported) return
    PlayerPlayTimer(session, state.play.syncing, actions)
    if (state.play.purpose == "claim") PlayerCard("Mijn eigen deelname koppelen") {
        Text("Deze privélink koppelt uitsluitend de aangewezen gastdeelname. Andere spelers en de oorspronkelijke partij blijven behouden.", color = PlayerMuted)
        if (state.session == null) Action("Inloggen of account maken") { actions.navigate(PlayerScreen.HOME, null) }
        else if (state.profile?.usernameLocked != true) Action("Rond eerst mijn profiel af") { actions.navigate(PlayerScreen.PROFILE,null) }
        else Action("Koppel deze eigen deelname", !state.play.syncing) { actions.playAction(json("type" to "session.claim")) }
        canonical.raw.text("claimExpiresAt").takeIf(String::isNotBlank)?.let { Text("Claimen tot ${shortDate(it)}", color = PlayerMuted) }
    }
    if (canonical.raw.obj("conflict").text("status") == "open") PlayerPlayConflict(canonical, pending, state.play.syncing, actions)
    else if (session.raw.text("status") == "interrupted") {
        Notice("Onderbroken. Dezelfde partij, regels en geaccepteerde voortgang blijven bewaard.")
        if (p.optBoolean("canResume")) Action("Hervat dezelfde partij", !state.play.syncing) { actions.playAction(json("type" to "session.resume")) }
    } else if (state.play.purpose != "claim" && !session.complete && session.game.text("status") == "live" && p.optBoolean("canScore") && (session.raw.text("deviceMode") != "individual" || pending == 0)) {
        Action("Open score-invoer", modifier = Modifier.fillMaxWidth()) { openConsole() }
    } else if (state.play.purpose != "claim" && !session.complete && session.game.text("status") == "live") {
        Notice("Wacht op de beurt van ${session.currentName()}. De stand wordt automatisch vernieuwd.")
        Action("Open score-invoer", primary = false, modifier = Modifier.fillMaxWidth()) { openConsole() }
    }
    if (session.game.text("status") == "replay-required" && p.optBoolean("canReplayAttempt")) Action("Speel deze gelijke leg opnieuw", pending == 0 && !state.play.syncing) { actions.playAction(json("type" to "session.restart-attempt")) }
    if (p.optBoolean("canUndo") || pending > 0) Action(if (pending > 0) "Laatste wachtende invoer terugnemen" else "Laatste verwerkte beurt terugnemen", !state.play.syncing, false) { actions.playAction(json("type" to "session.undo")) }
    if (pending > 0) Action("Synchroniseer bewaarde invoer", !state.play.syncing) { actions.playAction(json("type" to "local.refresh")) }
    if (session.complete) {
        if(session.rules.text("mode")=="leg-challenge") {
            session.raw.text("challengeId").takeIf(String::isNotBlank)?.let{challengeId->Action("Probeer dezelfde leg opnieuw",!state.play.syncing){actions.playAction(json("type" to "challenge.start","challengeId" to challengeId,"name" to session.currentName()))}}
            Action("Terug naar uitdagingen",primary=false){actions.navigate(PlayerScreen.CHALLENGES,null)}
        }else Action("Nog een partij met deze spelregels") { actions.navigate(PlayerScreen.PLAY_START, "replay:${session.id}") }
        if (state.session != null && session.rules.text("mode") == "x01") PlayerChallengePublish("play", session.id, session.game.text("currentThrowerId"), state, actions)
    }
    if (p.optBoolean("canManage") || p.optBoolean("canTransfer") || p.optBoolean("canMove")) PlayerPlayManagement(session, pending, state, actions)
    if (p.optBoolean("canManage")) PlayerCard("Privélinks per deelnemer") {
        Text("Geef iedere speler uitsluitend de eigen link. Deze links geven toegang tot deelname of herstel en worden niet op Oche Live getoond.", color = PlayerMuted)
        session.participants.forEach { participant ->
            Text(participant.text("name"), color = PlayerText)
            if (session.raw.text("deviceMode") == "individual" && !session.complete) Action("Eigen telefoon: ${participant.text("name")}", !state.play.syncing, false) { actions.playAction(json("type" to "session.issue-link", "participantId" to participant.text("id"), "purpose" to "participant")) }
            if (session.complete && participant.optBoolean("isGuest") && !participant.optBoolean("claimed")) Action("Privé claimlink: ${participant.text("name")}", !state.play.syncing, false) { actions.playAction(json("type" to "session.issue-link", "participantId" to participant.text("id"), "purpose" to "claim")) }
            Action("Privé herstellink: ${participant.text("name")}", !state.play.syncing, false) { actions.playAction(json("type" to "session.issue-link", "participantId" to participant.text("id"), "purpose" to "recovery")) }
        }
    }
    state.play.privateLink?.let { link -> PlayerCard(if(link.text("purpose")=="challenge") "Deel jouw leguitdaging" else "Persoonlijke link · ${session.participantName(link.text("participantId"))}") {
        val url = link.text("url")
        Text("Alleen delen met deze deelnemer. ${link.text("expiresAt").takeIf(String::isNotBlank)?.let { "Geldig tot ${shortDate(it)}." }.orEmpty()}", color = PlayerMuted)
        PlayerPrivateQr(url)
        Action("Kopieer persoonlijke link") { (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("Persoonlijke DartFlow-link",url)) }
        Action("Verberg persoonlijke link", primary = false) { actions.playAction(json("type" to "local.clear-link")) }
    } }
    Action("Partijen & historie", primary = false) { actions.navigate(PlayerScreen.PLAY_HISTORY, null) }
}

@Composable internal fun PlayerPlayTimer(session: PlayerPlaySession, busy: Boolean, actions: PlayerActions) {
    var now by remember(session.raw.optLong("serverNow")) { mutableLongStateOf(session.raw.optLong("serverNow")) }
    LaunchedEffect(session.raw.optLong("serverNow")) { while (true) { delay(1000); now += 1000 } }
    val deadline = session.raw.optLong("deadlineAt"); val warning = session.raw.optLong("warningAt")
    if (deadline > 0 && now >= warning && session.raw.text("status") == "active") PlayerCard("Geen recente invoer") {
        Text("Nog ${((deadline - now).coerceAtLeast(0) + 999) / 1000} seconden tot de baan wordt vrijgegeven. De partij blijft herstelbaar.", color = PlayerLime)
        if (session.raw.optInt("extensionsUsed") < session.raw.optInt("maxExtensions", 2) && (session.permissions.optBoolean("canManage") || session.permissions.optBoolean("canScore"))) Action("Verleng dezelfde partij", !busy) { actions.playAction(json("type" to "session.extend", "warningEpoch" to session.raw.text("warningEpoch"))) }
    }
}

@Composable internal fun PlayerPrivateQr(value: String) {
    // The native QR renderer uses only the supplied private value in memory.
    PlayerQrCode(value, "Persoonlijke deelnamelink")
}
