@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package nl.dartflow.app

import android.content.Intent
import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

/** UI owns only ephemeral form values; all identity, permissions and accepted scores come from the server. */
class PlayerActions(
    val request: suspend (String, JSONObject) -> JSONObject = { _, _ -> throw PlayerApiFailure(503, "unavailable", "Deze aanvraag is tijdelijk niet beschikbaar.") },
    val playAction: (JSONObject) -> Unit = {},
    val selectGuestOperator: (String) -> Unit = {},
    val pushConsent: (Boolean) -> Unit = {}, val pushSettings: () -> Unit = {}, val openNotification: (String) -> Unit = {},
    val download: suspend (String) -> ByteArray = { throw PlayerApiFailure(503, "unavailable", "Deze download is tijdelijk niet beschikbaar.") },
    val read: suspend (String) -> JSONObject = { throw PlayerApiFailure(503, "unavailable", "Deze gegevens zijn tijdelijk niet beschikbaar.") },
    val navigate: (PlayerScreen, String?) -> Unit = { _, _ -> },
    val back: () -> Unit = {}, val saveOrganizerDraft: (JSONObject) -> Unit = {},
    val refresh: () -> Unit = {}, val requestOtp: (String) -> Unit = {}, val verifyOtp: (String) -> Unit = {},
    val google: () -> Unit = {}, val localLogin: (String) -> Unit = {}, val logout: () -> Unit = {},
    val reviewLogin: (String, String) -> Unit = { _, _ -> },
    val completeProfile: (String, String, String, String, String) -> Unit = { _, _, _, _, _ -> },
    val changePin: (String, String, String) -> Unit = { _, _, _ -> },
    val command: (String, JSONObject) -> Unit = { _, _ -> }, val platformAction: (JSONObject) -> Unit = {},
    val score: (Int, Int, Boolean, Int?) -> Unit = { _, _, _, _ -> },
    val matchAction: (String, JSONObject) -> Unit = { _, _ -> },
    val retry: () -> Unit = {}, val openLink: (String) -> Unit = {}, val scan: () -> Unit = {}, val dismiss: () -> Unit = {}
)

internal fun JSONObject.text(key: String, fallback: String = ""): String = if (isNull(key)) fallback else optString(key, fallback)
internal fun JSONObject.obj(key: String): JSONObject = optJSONObject(key) ?: JSONObject()
internal fun JSONObject.rows(key: String): List<JSONObject> = optJSONArray(key)?.objects() ?: emptyList()
internal fun JSONArray.strings(): List<String> = (0 until length()).map { optString(it) }
internal fun json(vararg pairs: Pair<String, Any?>) = JSONObject().also { o -> pairs.forEach { (k, v) -> o.put(k, v ?: JSONObject.NULL) } }
internal fun shortDate(value: String): String = runCatching { DateTimeFormatter.ofPattern("d MMM · HH:mm", Locale.forLanguageTag("nl-NL")).withZone(ZoneId.of("Europe/Amsterdam")).format(Instant.parse(value)) }.getOrDefault(value.take(16).replace("T", " "))
internal fun number(value: Double): String = String.format(Locale.forLanguageTag("nl-NL"), "%.2f", value)
private fun name(value: JSONObject) = playerPublicName(value)
internal fun validPlayerName(value: String) = PlayerValidation.validName(value)
internal fun validPlayerUsername(value: String) = PlayerValidation.validUsername(value)
internal fun validPlayerPin(value: String) = PlayerValidation.validPin(value)

@Composable internal fun PlayerWordmark(modifier: Modifier = Modifier) {
    val tint = playerWordmarkTint(LocalPlayerTokens.current)?.let { Color(0xFF000000 or it.removePrefix("#").toLong(16)) }
    Image(painterResource(R.drawable.dartflow_logo), "DartFlow", modifier, contentScale = ContentScale.Fit, colorFilter = tint?.let { androidx.compose.ui.graphics.ColorFilter.tint(it) })
}

@Composable fun PlayerApp(state: PlayerUiState, actions: PlayerActions, media: @Composable (String) -> Unit = {}) = PlayerAppContent(playerGuestOperatorState(state), actions, media)
@Composable private fun PlayerAppContent(state: PlayerUiState, actions: PlayerActions, media: @Composable (String) -> Unit) {
    if (state.screen in playerPublicPlayScreens) {
        PlayerPlayScreen(state, actions)
        return
    }
    val destinations = rememberSaveableStateHolder()
    val profile = state.profile
    var fullScore by remember(state.match?.id) { mutableStateOf(true) }
    var more by remember { mutableStateOf(false) }
    val navigationSection = playerNavigationSection(state.screen, state.activeId)
    val activeMatch = state.screen == PlayerScreen.MATCH && state.match != null
    BackHandler(enabled = (state.session != null || state.screen in listOf(PlayerScreen.HELP,PlayerScreen.MANUAL)) && state.screen != PlayerScreen.HOME) {
        if (activeMatch && fullScore) fullScore = false else actions.back()
    }
    if (state.session == null && state.screen in listOf(PlayerScreen.HELP,PlayerScreen.MANUAL)) {
        Column(Modifier.fillMaxSize().background(PlayerInk).safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.error?.let { Notice(it, true, actions.refresh) }
            if(state.screen==PlayerScreen.MANUAL)PlayerManualScreen(state,actions)else PlayerHelpScreen(state, actions)
        }
        return
    }
    if (state.session == null) {
        LoginScreen(state, actions)
        return
    }
    if (profile != null && state.screen != PlayerScreen.HELP && (!profile.displayNameConfirmed || !profile.usernameLocked || !validPlayerUsername(profile.username) || !validPlayerName(profile.displayName))) {
        ProfileCompletionScreen(profile, state.busy, state.error, actions)
        return
    }
    if (activeMatch && fullScore && state.match!!.status == "live" && playerStartResolved(state.match!!) && state.match!!.raw.obj("offlineConflict").text("status") != "open") {
        val match = state.match!!
        PlayerScoreConsole(
            title = playerGuestOperatorLabel(state)?.let { "$it · Set ${match.setNumber} · Leg ${match.legNumber}" } ?: "Set ${match.setNumber} · Leg ${match.legNumber}",
            players = match.players.mapIndexed { i, p -> ScorePlayer(p.id, match.sideName(i), if (playerIsCricket(match)) match.raw.obj(if (match.raw.obj("settings").text("discipline") == "tactics") "tactics" else "cricket").optJSONArray("points")?.optInt(i) ?: 0 else match.remaining.getOrElse(i) { 0 }) },
            active = match.turn, canScore = match.permissions.optBoolean("canScore"), busy = state.busy,
            offline = !state.online, checkout = match.checkout, message = state.error, queueSupported = match.raw.optBoolean("offlineSupported"), queuedVisits = state.pendingMatchVisits,
            scoreKey = "${match.id}:${match.revision}", onSubmit = actions.score, scoreLabel = if (playerIsCricket(match)) "punten" else "restscore", currentThrowerName = match.currentThrower?.let { it.displayName.ifBlank { it.name } },
            onBack = { fullScore = false }, onRetry = actions.retry, pending = state.hasPendingCommand,
            activity = match.raw.obj("boardActivity"), onExtend = { extendActivity(match.raw.obj("boardActivity"), actions) },
            options = { state.notice?.let { Notice(it, retry = actions.dismiss) }; MatchOptions(match, actions, state) }, dartEntry = if (playerNeedsDartDetail(match.raw.obj("settings"))) { { PlayerDartScoreEntry(match, state, actions) } } else null, media = if (playerCanMedia(match, state.profile?.id)) { { media(match.id) } } else null)
        return
    }
    if (state.screen == PlayerScreen.TRAINING && state.activeId != null && (entityFor(state, "trainings").obj("state").has("game") || entityFor(state, "trainings").obj("state").text("mode") == "around")) {
        TrainingScreen(state, actions); return
    }
    Scaffold(
        modifier = Modifier.fillMaxSize(), containerColor = PlayerInk,
        topBar = {
            Column(Modifier.statusBarsPadding().fillMaxWidth().background(PlayerInk)) {
                Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    PlayerWordmark(Modifier.width(112.dp).height(32.dp))
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { actions.navigate(PlayerScreen.NOTIFICATIONS, null) }, modifier = Modifier.semantics { contentDescription = "Meldingen" }) { PlayerIcon(PlayerNavIcon.BELL) }
                    Box(Modifier.size(48.dp).clickable { actions.navigate(PlayerScreen.PROFILE, null) }, contentAlignment = Alignment.Center) {
                        Avatar(profile?.displayName?.ifBlank { profile.name } ?: "DartFlow", Modifier.size(32.dp))
                    }
                }
                HorizontalDivider(color = PlayerBorder)
            }
        },
        bottomBar = {
            Column(Modifier.background(PlayerInk).navigationBarsPadding()) {
                HorizontalDivider(color = PlayerBorder)
                Row(Modifier.fillMaxWidth().selectableGroup()) {
                    listOf(Triple(PlayerScreen.HOME, PlayerNavIcon.HOME, "Vandaag"), Triple(PlayerScreen.PLAY, PlayerNavIcon.PLAY, "Spelen"), Triple(PlayerScreen.SEASONS, PlayerNavIcon.COMPETITIONS, "Competities"), Triple(PlayerScreen.EVENTS, PlayerNavIcon.EVENTS, "Toernooien")).forEach { (route, icon, label) ->
                        PlayerNavigationItem(label, icon, !more && navigationSection == icon, Modifier.weight(1f)) { actions.navigate(route, null) }
                    }
                    PlayerNavigationItem("Meer", PlayerNavIcon.MORE, more || navigationSection == PlayerNavIcon.MORE, Modifier.weight(1f)) { more = true }
                }
            }
        }
    ) { inset ->
        Box(Modifier.fillMaxSize().padding(inset)) {
            PlayerRings(Modifier.fillMaxSize())
            destinations.SaveableStateProvider("${state.session.userId}:${state.screen}:${state.activeId.orEmpty()}") {
            if (state.screen == PlayerScreen.CLUB_COMPETITION_WIZARD) PlayerClubCompetitionWizard(state, actions)
            else if (state.screen == PlayerScreen.CLUB_CHAT) PlayerClubChat(state, actions)
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (!state.online) Notice("Geen verbinding. De laatst ontvangen gegevens blijven zichtbaar.", true)
                state.error?.takeIf { it.isNotBlank() }?.let { Notice(it, true, actions.retry) }
                state.notice?.takeIf { it.isNotBlank() }?.let { Notice(it, false, actions.dismiss) }
                if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = PlayerLime)
                when (state.screen) {
                    PlayerScreen.HOME -> HomeScreen(state, actions)
                    PlayerScreen.PLAY -> PlayScreen(state, actions)
                    PlayerScreen.PLAY_START, PlayerScreen.PLAY_SESSION, PlayerScreen.PLAY_HISTORY, PlayerScreen.PRACTICE, PlayerScreen.CHALLENGES -> Unit
                    PlayerScreen.BOARDS -> BoardsScreen(state, actions)
                    PlayerScreen.BOARD -> BoardScreen(state, actions)
                    PlayerScreen.LOBBY -> LobbyScreen(state, actions)
                    PlayerScreen.MATCH -> state.match?.let { MatchDetail(it, state, actions, { fullScore = true }, media) }
                    PlayerScreen.TRAINING -> TrainingOverview(state, actions)
                    PlayerScreen.EVENTS -> EventsScreen(state, actions)
                    PlayerScreen.EVENT -> EventScreen(state, actions)
                    PlayerScreen.SEASONS -> SeasonsScreen(state, actions)
                    PlayerScreen.SEASON -> PlayerSeasonDetail(state, actions)
                    PlayerScreen.SEASON_CREATE -> PlayerSeasonCreateScreen(state, actions)
                    PlayerScreen.FRIENDS -> FriendsScreen(state, actions)
                    PlayerScreen.FEED -> FeedScreen(state, actions)
                    PlayerScreen.CHAT -> ChatScreen(state, actions)
                    PlayerScreen.HISTORY -> HistoryScreen(state, actions)
                    PlayerScreen.STATISTICS -> StatisticsScreen(state, actions)
                    PlayerScreen.PROFILE -> ProfileScreen(state, actions)
                    PlayerScreen.NOTIFICATIONS -> NotificationsScreen(state, actions)
                    PlayerScreen.SCREENS -> ScreensScreen(state, actions)
                    PlayerScreen.ORGANIZE -> PlayerOrganizerScreen(state, actions)
                    PlayerScreen.DIRECTOR -> PlayerDirectorScreen(state, actions)
                    PlayerScreen.HELP -> PlayerHelpScreen(state, actions)
                    PlayerScreen.MANUAL -> PlayerManualScreen(state,actions)
                    PlayerScreen.FAQ_ADMIN -> PlayerFaqAdminScreen(state, actions)
                    PlayerScreen.LOCATIONS -> PlayerLocationsScreen(state, actions)
                    PlayerScreen.RANKING_EVENT -> PlayerEventRankingsScreen(state, actions)
                    PlayerScreen.RANKINGS -> PlayerRankingsScreen(state, actions)
                    PlayerScreen.CLUBS -> PlayerClubsScreen(state, actions)
                    PlayerScreen.CLUB -> PlayerClubScreen(state, actions)
                    PlayerScreen.CLUBHOUSE -> PlayerClubhouseScreen(state, actions)
                    PlayerScreen.CLUB_COMPETITION_WIZARD, PlayerScreen.CLUB_CHAT -> Unit
                }
                Spacer(Modifier.height(8.dp))
            }
            }
        }
    }
    if (more) PlayerMoreMenu(state, actions) { more = false }
}

@Composable internal fun Heading(title: String, eyebrow: String? = null, description: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        eyebrow?.let { Text(it.uppercase(Locale.ROOT), color = PlayerLime, fontSize = 10.sp, letterSpacing = 2.sp) }
        Text(title, color = PlayerLime, style = MaterialTheme.typography.headlineLarge)
        description?.let { Text(it, color = PlayerMuted, style = MaterialTheme.typography.bodyMedium) }
    }
}
@Composable internal fun PlayerCard(title: String? = null, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().border(1.dp, PlayerBorder, RoundedCornerShape(14.dp)).background(PlayerPanel.copy(alpha = .92f), RoundedCornerShape(14.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        title?.let { Text(it, color = PlayerText, style = MaterialTheme.typography.titleLarge) }; content()
    }
}
@Composable internal fun Action(label: String, enabled: Boolean = true, primary: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) {
    if (primary) Button(onClick, modifier.heightIn(min = 48.dp), enabled = enabled, shape = RoundedCornerShape(12.dp)) { Text(label) }
    else OutlinedButton(onClick, modifier.heightIn(min = 48.dp), enabled = enabled, shape = RoundedCornerShape(12.dp)) { Text(label) }
}
@Composable internal fun Notice(message: String, error: Boolean = false, retry: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().background(if (error) PlayerError.copy(alpha = .12f) else PlayerPanel, RoundedCornerShape(12.dp)).padding(12.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(message, color = if (error) PlayerError else PlayerLime, fontSize = 13.sp)
        retry?.let { TextButton(onClick = it) { Text(if (error) "Opnieuw proberen" else "Gereed") } }
    }
}
@Composable internal fun Avatar(label: String, modifier: Modifier = Modifier) {
    Box(modifier.clip(CircleShape).background(PlayerLime.copy(alpha = .12f)).border(1.dp, PlayerBorder, CircleShape), contentAlignment = Alignment.Center) {
        Text(label.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString(""), color = PlayerLime, fontWeight = FontWeight.Bold, fontSize = 14.sp)
    }
}
@Composable internal fun Field(label: String, value: String, changed: (String) -> Unit, enabled: Boolean = true, secret: Boolean = false, keyboard: KeyboardType = KeyboardType.Text, error: String? = null, max: Int = 200, multiline: Boolean = false) {
    OutlinedTextField(value = value, onValueChange = { changed(it.take(max)) }, label = { Text(label) }, enabled = enabled, modifier = Modifier.fillMaxWidth(), singleLine = !multiline, minLines = if (multiline) 3 else 1, maxLines = if (multiline) 6 else 1,
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, autoCorrectEnabled = !secret && keyboard == KeyboardType.Text), isError = error != null,
        supportingText = error?.let { { Text(it) } }, textStyle = MaterialTheme.typography.bodyMedium, shape = RoundedCornerShape(12.dp))
}
@Composable internal fun Choice(label: String, selected: String, options: List<Pair<String, String>>, changed: (String) -> Unit, enabled: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label, color = PlayerMuted, fontSize = 12.sp)
        Box {
            OutlinedButton({ open = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = enabled, shape = RoundedCornerShape(12.dp)) { Text(options.find { it.first == selected }?.second ?: selected, Modifier.weight(1f)); Text("⌄") }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) { options.forEach { (value, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { open = false; changed(value) }) } }
        }
    }
}
@Composable internal fun ClearSecretsOnBackground(clear: () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val callback by rememberUpdatedState(clear)
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) callback() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); callback() }
    }
}

@Composable private fun LoginScreen(state: PlayerUiState, actions: PlayerActions) {
    var email by rememberSaveable { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var review by remember { mutableStateOf(false) }
    var reviewEmail by remember { mutableStateOf("") }
    var reviewPassword by remember { mutableStateOf("") }
    ClearSecretsOnBackground { code = ""; reviewPassword = "" }
    Column(Modifier.fillMaxSize().background(PlayerInk).safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PlayerWordmark(Modifier.width(152.dp).height(42.dp))
        Heading("Klaar voor jouw volgende leg?", "DARTFLOW SPELER", "Speel, ontmoet andere darters en volg iedere worp. Je baan of uitnodiging blijft klaarstaan na het inloggen.")
        if (state.loading || state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let { Notice(it, true) }
        state.notice?.let { Notice(it) }
        if (state.pendingEmail != null) {
            PlayerCard("Je inlogcode") {
                Text("Vul de code uit de e-mail aan ${state.pendingEmail} in. Gebruik de volledige code.", color = PlayerMuted)
                Field("E-mailcode", code, { code = it.filter { c -> c in '0'..'9' }.take(10) }, !state.busy, secret = true, keyboard = KeyboardType.NumberPassword, max = 10)
                Action("Inloggen", PlayerValidation.validOtp(code, state.capabilities.obj("auth").optInt("otpLengthMin", 6), state.capabilities.obj("auth").optInt("otpLengthMax", 10)) && !state.busy, modifier = Modifier.fillMaxWidth()) { actions.verifyOtp(code); code = "" }
                TextButton(onClick = { actions.requestOtp(state.pendingEmail) }, enabled = !state.busy) { Text("Nieuwe code versturen") }
            }
        } else {
            PlayerCard("Welkom bij DartFlow") {
                Field("E-mailadres", email, { email = it }, !state.busy, keyboard = KeyboardType.Email)
                Action("Stuur mij een inlogcode", email.contains('@') && email.substringAfter('@').contains('.') && !state.busy, modifier = Modifier.fillMaxWidth()) { actions.requestOtp(email.trim()) }
                HorizontalDivider(color = PlayerBorder)
                Action("Doorgaan met Google", !state.busy, primary = false, modifier = Modifier.fillMaxWidth(), onClick = actions.google)
            }
        }
        if (state.localUsers.isNotEmpty()) PlayerCard("Lokale ontwikkelaccounts") {
            Text("Alleen beschikbaar in de lokale ontwikkelomgeving.", color = PlayerMuted)
            state.localUsers.forEach { user -> Action(user.name, !state.busy, false, Modifier.fillMaxWidth()) { actions.localLogin(user.id) } }
        }
        if (!review) TextButton(onClick = { review = true }) { Text("Toegang voor appbeoordeling") }
        else PlayerCard("Toegang voor appbeoordeling") {
            Text("Uitsluitend voor het afzonderlijk verstrekte beoordelingsaccount. Normale spelers gebruiken een e-mailcode of Google.", color = PlayerMuted)
            Field("Beoordelingsaccount · e-mailadres", reviewEmail, { reviewEmail = it }, !state.busy, keyboard = KeyboardType.Email)
            Field("Wachtwoord beoordelingsaccount", reviewPassword, { reviewPassword = it }, !state.busy, secret = true, keyboard = KeyboardType.Password, max = 256)
            Action("Inloggen voor appbeoordeling", !state.busy && reviewEmail.contains('@') && reviewPassword.isNotBlank(), modifier = Modifier.fillMaxWidth()) { actions.reviewLogin(reviewEmail.trim(), reviewPassword); reviewPassword = "" }
            TextButton(onClick = { review = false; reviewPassword = "" }) { Text("Terug naar gewone aanmelding") }
        }
        Action("Spelen zonder account") { actions.navigate(PlayerScreen.PLAY_START, null) }
        Action("Scan baan-QR", primary = false, onClick = actions.scan)
        Action("Bewaarde partijen & herstel", primary = false) { actions.navigate(PlayerScreen.PLAY_HISTORY, null) }
        Action("Help & FAQ", primary = false) { actions.navigate(PlayerScreen.HELP, null) }
        SafetyLink("Privacybeleid", "/privacy")
        SafetyLink("Account en gegevens verwijderen", "/account-verwijderen")
        SafetyLink("Communityregels", "/communityregels")
    }
}

@Composable private fun ProfileCompletionScreen(profile: PlayerProfile, busy: Boolean, error: String?, actions: PlayerActions) {
    var username by remember(profile.id) { mutableStateOf(profile.username) }
    var display by remember(profile.id) { mutableStateOf(profile.displayName.takeIf(::validPlayerName) ?: "") }
    var fullName by remember(profile.id) { mutableStateOf(profile.fullName.orEmpty()) }
    var confirmUsername by remember { mutableStateOf(false) }
    var pin by remember { mutableStateOf("") }; var repeat by remember { mutableStateOf("") }
    ClearSecretsOnBackground { pin = ""; repeat = ""; confirmUsername = false }
    fun save() { actions.completeProfile(fullName, username, display, pin, repeat); pin = ""; repeat = ""; confirmUsername = false }
    Column(Modifier.fillMaxSize().background(PlayerInk).safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Heading("Dit ben jij op het scorebord", "REGISTRATIE AFRONDEN", "Kies je openbare displaynaam en leg je gebruikersnaam eenmalig vast. Je volledige naam blijft privé.")
        val validIdentity = PlayerIdentityFields(profile, !busy, fullName, { fullName = it }, display, { display = it }, username, { username = it }, actions)
        if (!profile.pinConfigured) {
            Text("Gebruik deze pincode om op een QR-baan met jouw DartFlow-profiel mee te spelen.", color = PlayerMuted)
            Field("Spelerspincode", pin, { pin = it.filter { c -> c in '0'..'9' } }, !busy, true, KeyboardType.NumberPassword, if (pin.isNotEmpty() && !validPlayerPin(pin)) "Gebruik precies zes cijfers." else null, 6)
            Field("Herhaal spelerspincode", repeat, { repeat = it.filter { c -> c in '0'..'9' } }, !busy, true, KeyboardType.NumberPassword, if (repeat.isNotEmpty() && repeat != pin) "De pincodes zijn niet gelijk." else null, 6)
        }
        error?.let { Notice(it, true) }
        Action(if (busy) "Profiel opslaan…" else "Begin met spelen", !busy && validIdentity && (profile.pinConfigured || validPlayerPin(pin) && pin == repeat), modifier = Modifier.fillMaxWidth()) { if (profile.usernameLocked) save() else confirmUsername = true }
        TextButton(onClick = actions.logout) { Text("Ander account gebruiken") }
        Action("Hulp bij namen en privacy", primary = false) { actions.navigate(PlayerScreen.HELP, "q=gebruikersnaam") }
    }
    if (confirmUsername) PlayerUsernameConfirmation(username, ::save) { confirmUsername = false }
}

@Composable private fun HomeScreen(state: PlayerUiState, actions: PlayerActions) {
    val experience = state.resource
    val resume = experience.rows("resume")
    val feed = state.homeFeed
    var composeOpen by rememberSaveable(state.session?.userId) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("Hoi ${state.profile?.displayName?.ifBlank { state.profile.name } ?: "darter"}.", style = MaterialTheme.typography.titleLarge, color = PlayerText)
        Text("Wat speelt er vandaag?", color = PlayerMuted, style = MaterialTheme.typography.bodyMedium)
    }
    // The actual active assignment always comes before discovery and community.
    resume.take(2).forEach { match -> PlayerCard {
        Text("JOUW PARTIJ", color = PlayerLime, fontSize = 10.sp, letterSpacing = 1.sp)
        Text(match.optJSONArray("players")?.strings()?.joinToString(" – ") ?: "Jouw wedstrijd", style = MaterialTheme.typography.titleMedium)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(match.optJSONArray("remaining")?.strings()?.joinToString(" – ") ?: "", Modifier.weight(1f), fontFamily = PlayerBarlow, fontSize = 34.sp, lineHeight = 38.sp, color = PlayerLime)
            Action(match.text("actionLabel", "Hervat je partij"), modifier = Modifier.widthIn(max = 190.dp)) { actions.openLink(match.text("href", "/wedstrijd/${match.text("id")}")) }
        }
    } }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(onClick = actions.scan, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("home-scan-button"), shape = RoundedCornerShape(12.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp)) {
            PlayerIcon(PlayerNavIcon.QR, PlayerInk, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Scan baan-QR")
        }
        OutlinedButton(onClick = { actions.navigate(PlayerScreen.PLAY, null) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("home-play-button"), shape = RoundedCornerShape(12.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp)) {
            PlayerIcon(PlayerNavIcon.PLAY, PlayerLime, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Vrij spelen")
        }
    }
    PlayerOwnPreCalls(state, actions)
    experience.rows("fixtures").firstOrNull()?.let { FixtureCard(it, actions, state.busy) }
    // Community is the main home content, using the exact same server posts and
    // actions as the standalone feed. Keep the first page compact on startup.
    Column(Modifier.fillMaxWidth().testTag("home-community-feed"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Community", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = { actions.navigate(PlayerScreen.FEED, null) }) { Text("Alle berichten") }
        }
        if (feed.rows("scopes").isNotEmpty()) {
            OutlinedButton(onClick = { composeOpen = !composeOpen }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(12.dp)) {
                Text(if (composeOpen) "Sluit bericht" else "Deel iets met je community", Modifier.weight(1f), textAlign = TextAlign.Start)
            }
            if (composeOpen) { CommunityConsent(state, actions); CommunityPostComposer(feed, state, actions) }
        }
        state.homeFeedError?.let { message ->
            Column(Modifier.fillMaxWidth().background(PlayerPanel, RoundedCornerShape(12.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(message, color = PlayerError, fontSize = 12.sp)
                TextButton(onClick = actions.refresh, modifier = Modifier.heightIn(min = 48.dp).testTag("home-feed-retry")) { Text("Community opnieuw laden") }
            }
        }
        if (state.homeFeedLoading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = PlayerLime)
        feed.rows("posts").take(5).forEach { post -> CommunityPostCard(post, state, actions, "home-feed") }
        if (feed.rows("posts").isEmpty() && !state.homeFeedLoading && state.homeFeedError == null) {
            PlayerCard {
                Text("Nog geen berichten", style = MaterialTheme.typography.titleMedium)
                Text("Berichten uit jouw verenigingen en evenementen verschijnen hier. Deel zelf iets of bekijk de community.", color = PlayerMuted)
            }
        }
    }
    if (state.profile?.pinConfigured == false) PlayerCard("Spelen met één telefoon") {
        Text("Met je spelerspincode kan je tegenstander jou toevoegen aan een lokale partij.", color = PlayerMuted)
        Action("Pincode instellen", primary = false) { actions.navigate(PlayerScreen.PROFILE, null) }
    }
    HomeProgressShortcuts(actions)
}
@Composable private fun HomeProgressShortcuts(actions: PlayerActions) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        // Give large system text the full row instead of shrinking or clipping a label.
        if (maxWidth < 300.dp || LocalDensity.current.fontScale > 1.3f) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                HomeProgressShortcut("Statistieken", "home-statistics", Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.STATISTICS, null) }
                HomeProgressShortcut("Historie", "home-history", Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.HISTORY, null) }
            }
        } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            HomeProgressShortcut("Statistieken", "home-statistics", Modifier.weight(1f)) { actions.navigate(PlayerScreen.STATISTICS, null) }
            HomeProgressShortcut("Historie", "home-history", Modifier.weight(1f)) { actions.navigate(PlayerScreen.HISTORY, null) }
        }
    }
}
@Composable private fun HomeProgressShortcut(label: String, tag: String, modifier: Modifier, onClick: () -> Unit) {
    OutlinedButton(onClick, modifier.heightIn(min = 48.dp).testTag(tag), shape = RoundedCornerShape(12.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp)) {
        // A full, integer-constrained text box avoids rounding a wrap-content glyph
        // advance down to fewer pixels than the paragraph actually needs.
        Text(label, Modifier.fillMaxWidth().heightIn(min = 20.dp), textAlign = TextAlign.Center, maxLines = 1, softWrap = false)
    }
}
@Composable private fun FixtureCard(f: JSONObject, actions: PlayerActions, busy: Boolean) {
    PlayerCard(f.text("seasonName", "Jouw speeldag")) {
        Text("Tegen ${f.text("opponent", "tegenstander")}", fontWeight = FontWeight.Bold)
        Text("Ronde ${f.optInt("round")} · ${shortDate(f.text("startsAt", f.text("windowStart")))}", color = PlayerMuted)
        Text(if (f.optBoolean("checkedIn")) "Ingecheckt" else statusLabel(f.text("status")), color = PlayerLime)
        Action(if (f.text("matchId").isNotBlank()) "Open score-invoer" else "Bekijk wedstrijd", !busy) { actions.openLink(f.text("href")) }
        if (f.optBoolean("canCheckIn") && !f.optBoolean("checkedIn")) Action("Check in", !busy, false) { actions.command("/seasons/actions", json("expectedRevision" to f.optInt("revision"), "action" to json("type" to "season.check-in", "seasonId" to f.text("seasonId"), "fixtureId" to f.text("fixtureId"), "present" to true))) }
    }
}
@Composable internal fun Stat(label: String, value: String) { Column { Text(value, color = PlayerLime, fontFamily = PlayerBarlow, fontSize = 30.sp); Text(label, color = PlayerMuted, fontSize = 11.sp) } }
internal fun statusLabel(value: String): String = mapOf("live" to "Live", "planned" to "Gepland", "registered" to "Ingeschreven", "completed" to "Afgerond", "confirmed" to "Bevestigd", "result" to "Uitslag", "interrupted" to "Onderbroken", "ready" to "Gereed", "closed" to "Gesloten", "scheduled" to "Gepland", "registration" to "Inschrijving open", "active" to "Actief", "waitlisted" to "Wachtlijst", "bye" to "Vrijgesteld", "void" to "Niet nodig", "proposed" to "Tijdvoorstel", "provisional" to "Voorlopig", "disputed" to "Betwist", "administrative" to "Administratief", "draft" to "Concept", "archived" to "Archief", "pending" to "In behandeling", "withdrawn" to "Teruggetrokken", "canceled" to "Geannuleerd")[value] ?: value

@Composable private fun PlayScreen(state: PlayerUiState, actions: PlayerActions) {
    var setup by rememberSaveable { mutableStateOf("solo") }
    var score by rememberSaveable { mutableStateOf("501") }
    var botOpening by rememberSaveable { mutableStateOf<String?>(null) }
    var legs by rememberSaveable { mutableStateOf("3") }
    var code by rememberSaveable { mutableStateOf("") }
    Heading("Stap naar de oche", "SPELEN", "Train solo, speel samen op locatie of daag iemand op afstand uit.")
    PlayerCard("Vrij spelen, oefenen & uitdagingen") {
        Text("Speel met gastnamen of accounts. Cricket, Tactics, Around the Clock, dubbelbingo en finishtraining gebruiken hun eigen scorekaart.", color = PlayerMuted)
        Action("Nieuwe vrije partij", modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.PLAY_START, null) }
        Action("Oefenen", primary = false) { actions.navigate(PlayerScreen.PRACTICE, null) }
        Action("Uitdagingen", primary = false) { actions.navigate(PlayerScreen.CHALLENGES, null) }
        Action("Partijen hervatten & historie", primary = false) { actions.navigate(PlayerScreen.PLAY_HISTORY, null) }
    }
    PlayerCard("Bestaande wedstrijd & bot") {
        Choice("Spelvorm", setup, listOf("solo" to "Solo trainen", "bot" to "Tegen de bot", "localone" to "Lokaal · één schrijver", "localtwo" to "Lokaal · twee borden", "remote" to "Beide thuis", "hybrid" to "Hybride"), { setup = it }, !state.busy)
        Choice("Startscore", score, listOf("301" to "301", "501" to "501", "701" to "701"), { score = it }, !state.busy)
        if (setup !in listOf("solo", "bot")) Choice("Best of legs", legs, listOf(1,3,5,7,9).map { "$it" to "$it legs" }, { legs = it }, !state.busy)
        val extraRules = if (setup != "bot") PlayerRuleFields(!state.busy, includeStartProcedure = setup != "solo", freshStartScore = score.toInt()) else {
            val opening = playerFreshStartInRule(score.toInt(), botOpening)
            Choice("Openen", opening, listOf("single" to "Single in", "double" to "Dubbel in"), { botOpening = it }, !state.busy)
            json("inRule" to opening, "outRule" to "double")
        }
        Text(when(setup) { "solo" -> "Jouw worpen en voortgang worden bewaard."; "bot" -> "Oefen tegen de DartFlow-bot."; "remote", "hybrid" -> "Iedere speler scoort de eigen beurt op het eigen toestel. Open video tijdens de wedstrijd om de camera te verbinden."; else -> "Eén schrijver voert de worpen in. Je tegenstander kan zelf de baan-QR scannen." }, color = PlayerMuted)
        Action("${if (setup in listOf("solo", "bot")) "Start training" else "Open wedstrijdlobby"}", !state.busy, modifier = Modifier.fillMaxWidth()) {
            if (setup in listOf("solo", "bot")) actions.platformAction(playerWithSettings(json("type" to "training.create", "mode" to setup, "startScore" to score.toInt(), "botAverage" to 45), extraRules))
            else actions.platformAction(playerWithSettings(json("type" to "lobby.create", "name" to "Vrije wedstrijd", "setup" to setup, "startScore" to score.toInt(), "bestOfLegs" to legs.toInt()), extraRules))
        }
    }
    PlayerCard("Ik heb een uitnodiging") {
        Field("Wedstrijdcode of uitnodigingslink", code, { code = it }, !state.busy, max = 500)
        Action("Aansluiten", code.isNotBlank() && !state.busy, modifier = Modifier.fillMaxWidth()) { actions.openLink(code) }
        Text("Codes hebben vier tekens. Kleine letters zijn ook geldig.", color = PlayerMuted, fontSize = 12.sp)
    }
    Action("Scan een vaste baan-QR", modifier = Modifier.fillMaxWidth(), onClick = actions.scan)
    Action("Banen & locaties", primary = false, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.BOARDS, null) }
    val lobbies = state.platform.rows("lobbies").filter { !it.obj("state").optBoolean("closed") }
    lobbies.forEach { l -> PlayerCard(l.text("name")) { Text("${l.rows("members").count { it.text("status") == "active" }} spelers · ${l.obj("state").text("setup")}", color = PlayerMuted); Action("Open lobby", primary = false) { actions.navigate(PlayerScreen.LOBBY, l.text("id")) } } }
}

@Composable private fun BoardsScreen(state: PlayerUiState, actions: PlayerActions) {
    var filter by rememberSaveable { mutableStateOf("") }
    Heading("Jouw vaste banen", "BANEN & LOCATIES", "De baan-QR en je favoriete instellingen blijven bij hetzelfde bord.")
    Action("Beheer mijn locaties en reserveringen", primary = false) { actions.navigate(PlayerScreen.LOCATIONS, null) }
    Action("Scan baan-QR", modifier = Modifier.fillMaxWidth(), onClick = actions.scan)
    Field("Zoek baan of locatie", filter, { filter = it })
    val boards = state.resource.rows("boards").filter { filter.isBlank() || "${it.text("name")} ${it.text("locationName")}".contains(filter, true) }.sortedByDescending { it.optBoolean("favorite") }
    boards.forEach { b -> PlayerCard(b.text("name")) {
        Text(b.text("locationName"), color = PlayerMuted)
        Text(if (b.optBoolean("occupied")) "In gebruik" else if (b.optBoolean("canStart")) "Beschikbaar" else "Beperkte toegang", color = PlayerLime)
        Action("Open baan", !state.busy, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.BOARD, b.text("id")) }
        Action(if (b.optBoolean("favorite")) "★ Verwijder uit favorieten" else "☆ Bewaar als favoriet", !state.busy, false) { actions.command("/player-experience", json("type" to "favorite", "boardId" to b.text("id"), "favorite" to !b.optBoolean("favorite"))) }
    } }
    if (boards.isEmpty() && !state.loading) Text("Geen toegankelijke banen gevonden. Scan de vaste QR op jouw locatie.", color = PlayerMuted)
}

@Composable private fun BoardScreen(state: PlayerUiState, actions: PlayerActions) {
    Action("Vrij spelen op deze baan", !state.busy, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.PLAY_START, state.activeId) }
    val data = state.board ?: state.resource
    val board = data.obj("board")
    val boardId = board.text("id", state.activeId ?: "")
    var mode by rememberSaveable(boardId) { mutableStateOf("local") }
    var score by rememberSaveable(boardId) { mutableStateOf("501") }
    var legs by rememberSaveable(boardId) { mutableStateOf("3") }
    Heading(board.text("name", "Jouw baan"), "VASTE QR-BAAN", data.obj("club").text("name", data.obj("event").text("name")))
    if (PlayerCompetitionBoard(data, boardId, state, actions)) return
    data.text("matchId").takeIf { it.isNotBlank() }?.let { id -> Action("Open actuele wedstrijd", modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.MATCH, id) }; return }
    data.text("practiceId").takeIf { it.isNotBlank() }?.let { id -> Action("Open jouw training", modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.TRAINING, id) }; return }
    data.text("ownLobbyId").takeIf { it.isNotBlank() }?.let { id -> Action("Open jouw wedstrijdlobby", modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.LOBBY, id) }; return }
    val reservation = data.obj("reservation")
    if (reservation.length() > 0) PlayerCard(reservation.text("label", "Gereserveerd")) { Text("${shortDate(reservation.text("startsAt"))} – ${shortDate(reservation.text("endsAt"))}", color = PlayerMuted); if (reservation.optBoolean("canPrepare") && reservation.text("fixtureId").isNotBlank()) Action("Mijn ingeplande partij klaarmaken", !state.busy) { actions.platformAction(json("type" to "reservation.fixture.start", "reservationId" to reservation.text("id"), "boardId" to boardId, "fixtureId" to reservation.text("fixtureId"))) } }
    val pendingLobby = data.text("pendingLobbyId")
    if (board.optBoolean("blocked") || board.optBoolean("closed")) PlayerCard("Baan niet beschikbaar") { Text("De baan is gesloten of tijdelijk geblokkeerd. De wedstrijdleiding bepaalt wanneer je kunt starten.", color = PlayerMuted) }
    else if (pendingLobby.isNotBlank()) PlayerCard("Er wacht een speler") { Text("Meld je met jouw eigen account aan op de tweede plek.", color = PlayerMuted); Action("Meedoen aan deze baan", !state.busy) { actions.platformAction(json("type" to "lobby.join", "id" to pendingLobby, "boardId" to boardId)) } }
    else if (data.optBoolean("canStart")) PlayerCard("De baan staat klaar") {
        Choice("Spelvorm", mode, listOf("solo" to "Solo trainen", "local" to "Samen op locatie", "remote" to "Tegenstander op afstand"), { mode = it }, !state.busy)
        Choice("Startscore", score, listOf("301" to "301", "501" to "501", "701" to "701"), { score = it }, !state.busy)
        if (mode != "solo") Choice("Best of legs", legs, listOf(1,3,5,7,9).map { "$it" to "$it" }, { legs = it }, !state.busy)
        val extraRules = PlayerRuleFields(!state.busy, includeStartProcedure = mode != "solo", freshStartScore = score.toInt())
        Action("Op deze baan starten", !state.busy, modifier = Modifier.fillMaxWidth()) { actions.platformAction(playerWithSettings(json("type" to "board.start", "boardId" to boardId, "mode" to mode, "startScore" to score.toInt(), "bestOfLegs" to legs.toInt()), extraRules)) }
    } else PlayerCard(if (board.optBoolean("occupied")) "Baan bezet" else "Wacht op je baanoproep") { Text("Een ingeplande of gereserveerde partij krijgt voorrang. Deze vaste baanlink blijft naar hetzelfde bord verwijzen.", color = PlayerMuted) }
}

private fun entityFor(state: PlayerUiState, key: String): JSONObject {
    state.resource.optJSONObject("entity")?.let { return it }
    if (state.resource.has("state") && state.resource.has("id")) return state.resource
    return state.platform.rows(key).find { it.text("id") == state.activeId } ?: state.resource.rows(key).find { it.text("id") == state.activeId } ?: JSONObject()
}
internal fun entityCommand(actions: PlayerActions, entity: JSONObject, action: JSONObject) { actions.command("/platform/actions", json("expectedRevision" to entity.optInt("revision"), "action" to action)) }

@Composable private fun LobbyScreen(state: PlayerUiState, actions: PlayerActions) {
    val entity = entityFor(state, "lobbies")
    if (entity.length() == 0) { Heading("Wedstrijdlobby", "SPELERS VERZAMELEN"); Text(if (state.loading) "Lobby ophalen…" else "Deze lobby is niet beschikbaar.", color = PlayerMuted); return }
    val body = entity.obj("state"); val id = entity.text("id"); val members = entity.rows("members").filter { it.text("status") == "active" }
    val mine = state.profile?.id ?: ""; val owner = entity.text("ownerId") == mine; val selfActive = members.any { it.text("id") == mine }
    val closed = body.optBoolean("closed"); val matchId = body.text("matchId")
    val code = entity.text("inviteCode", body.text("code")); val boardId = body.text("boardId")
    var add by remember(id) { mutableStateOf(false) }
    var username by remember(id) { mutableStateOf("") }; var pin by remember { mutableStateOf("") }
    ClearSecretsOnBackground { pin = ""; add = false }
    Heading(entity.text("name", "Wedstrijdlobby"), "SPELERS VERZAMELEN")
    BoardActivityBanner(entity.obj("boardActivity"), state.online, state.busy) { extendActivity(entity.obj("boardActivity"), actions) }
    if (closed) Notice("Deze lobby is gesloten. De baan is weer vrijgegeven.", true)
    if (code.isNotBlank()) PlayerCard("Nodig je tegenstander uit") {
        Text(code.uppercase(Locale.ROOT), fontFamily = PlayerBarlow, fontSize = 62.sp, color = PlayerLime, letterSpacing = 6.sp)
        Text("Deel de code of de korte link. Je tegenstander kan ook zelf de vaste baan-QR scannen.", color = PlayerMuted)
        ShareButton("${BuildConfig.API_ORIGIN}/w/$code")
    }
    PlayerCard("Spelers") {
        members.forEach { member -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { Avatar(name(member), Modifier.size(44.dp)); Column(Modifier.weight(1f)) { Text(name(member), fontWeight = FontWeight.Bold); Text(if (body.obj("ready").optBoolean(member.text("id"))) "Gereed aan het bord" else "Wacht op gereedmelding", color = PlayerMuted, fontSize = 12.sp) } } }
        if (members.size < 2) Text("Tweede spelersplek is vrij.", color = PlayerMuted)
        val canAdd = owner && selfActive && members.size == 1 && !closed && matchId.isBlank() && boardId.isNotBlank() && body.text("setup") in listOf("localone", "localtwo")
        if (canAdd) {
            Action(if (add) "Sluit speler toevoegen" else "Speler toevoegen", !state.busy, false, Modifier.fillMaxWidth()) { add = !add; pin = "" }
            if (add) {
                Text("Geef je telefoon aan je tegenstander. Die vult zelf de eigen gebruikersnaam en spelerspincode in.", color = PlayerMuted)
                Field("Gebruikersnaam", username, { username = it }, !state.busy, max = 81)
                Field("Spelerspincode", pin, { pin = it.filter { c -> c in '0'..'9' } }, !state.busy, true, KeyboardType.NumberPassword, max = 6)
                Action("Toevoegen", validPlayerUsername(username) && validPlayerPin(pin) && !state.busy, modifier = Modifier.fillMaxWidth()) {
                    actions.command("/player-pin/lobby-add", json("lobbyId" to id, "expectedRevision" to entity.optInt("revision"), "username" to username.trim(), "pin" to pin)); pin = ""
                }
                TextButton(onClick = { pin = ""; add = false; actions.navigate(PlayerScreen.BOARD, boardId) }) { Text("Liever zelf de baan-QR scannen") }
            }
        }
        if (!selfActive && !closed && matchId.isBlank()) Action("Meedoen", !state.busy) { entityCommand(actions, entity, json("type" to "lobby.join", "id" to id, "code" to code)) }
        if (selfActive && !closed && matchId.isBlank()) Action(if (body.obj("ready").optBoolean(mine)) "Je staat klaar" else "Ik sta klaar aan het bord", !state.busy && !body.obj("ready").optBoolean(mine), modifier = Modifier.fillMaxWidth()) { entityCommand(actions, entity, json("type" to "lobby.ready", "id" to id)) }
        if (owner && !closed && matchId.isBlank()) {
            Choice("Eerste gooier", body.text("starterId", mine), members.map { it.text("id") to name(it) }, { entityCommand(actions, entity, json("type" to "lobby.starter", "id" to id, "starterId" to it)) }, !state.busy)
        }
        if (matchId.isBlank() && !closed) Action("Wedstrijd starten", !state.busy && selfActive && members.size == 2 && members.all { body.obj("ready").optBoolean(it.text("id")) }, modifier = Modifier.fillMaxWidth()) { entityCommand(actions, entity, json("type" to "lobby.start", "id" to id)) }
        if (matchId.isNotBlank()) Action("Naar de wedstrijd", modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.MATCH, matchId) }
    }
    if (selfActive && body.text("setup") in listOf("remote", "hybrid") && matchId.isBlank() && !closed) {
        val boards = state.platform.rows("clubBoards").filter { !it.optBoolean("occupied") && !it.optBoolean("blocked") && !it.optBoolean("closed") }
        if (boards.isNotEmpty()) PlayerCard("Mijn fysieke baan") { Choice("Koppel een baan (optioneel)", body.obj("remoteBoardIds").text(mine), listOf("" to "Thuis zonder baanscherm") + boards.map { it.text("id") to it.text("name") }, { if (it.isNotBlank()) entityCommand(actions, entity, json("type" to "lobby.board.bind", "id" to id, "boardId" to it)) }, !state.busy) }
    }
    PlayerCard("Jullie opstelling") { Text(mapOf("localone" to "Samen aan één bord", "localtwo" to "Twee borden op locatie", "remote" to "Beide thuis", "hybrid" to "Hybride")[body.text("setup")] ?: "Vrij spelen"); Text("${playerRuleLabel(body.obj("settings"))} · best of ${body.obj("settings").optInt("bestOfLegs", 3)}", color = PlayerMuted) }
    if (owner && !closed && matchId.isBlank()) Action("Lobby sluiten en baan vrijgeven", !state.busy, false) { entityCommand(actions, entity, json("type" to "lobby.cancel", "id" to id)) }
}
@Composable internal fun ShareButton(url: String) {
    val context = LocalContext.current
    Action("Deel korte link", primary = false) { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url) }, "Deel je DartFlow-wedstrijd")) }
}

@Composable private fun TrainingOverview(state: PlayerUiState, actions: PlayerActions) {
    Action("Nieuwe oefeningen & finishadvies") { actions.navigate(PlayerScreen.PRACTICE,null) }
    Heading("Elke training telt", "OEFENEN", "Oefen doelgericht en bekijk je opgeslagen sessies.")
    listOf(Triple("solo", "Solo 501", "Speel een volledige leg op je eigen tempo."), Triple("bot", "Tegen de bot", "Speel tegen de DartFlow-bot."), Triple("170", "Checkouttraining", "Gooi 170 uit met maximaal negen darts."), Triple("around", "Dubbels trainen", "Werk aan je vaste dubbels.")).forEach { (mode, title, description) -> PlayerCard(title) { Text(description, color = PlayerMuted); Action("Start oefening", !state.busy) { actions.platformAction(json("type" to "training.create", "mode" to mode, "startScore" to 501)) } } }
    state.platform.rows("trainings").forEach { e -> PlayerCard(e.text("name", "Training")) { Text(if (e.obj("state").optBoolean("completed")) "Voltooid" else "Nog bezig", color = PlayerMuted); Action("Open sessie", primary = false) { actions.navigate(PlayerScreen.TRAINING, e.text("id")) } } }
}

@Composable private fun TrainingScreen(state: PlayerUiState, actions: PlayerActions) {
    val e = entityFor(state, "trainings"); val s = e.obj("state"); val game = s.obj("game"); val id = e.text("id")
    val trainingMatch = playerTrainingMatch(e, state.profile)
    var console by remember(id) { mutableStateOf(true) }
    BackHandler { if (console) console = false else actions.navigate(PlayerScreen.TRAINING, null) }
    if (s.text("mode") == "around") {
        AroundTrainingScreen(state, e, actions)
        return
    }
    if (console && !s.optBoolean("interrupted") && !s.optBoolean("completed") && game.text("status") != "finished") {
        val remaining = game.optJSONArray("remaining").ints(); val players = listOf(state.profile?.displayName?.ifBlank { state.profile.name } ?: "Speler") + if (s.text("mode") == "bot") listOf("Dartbot") else emptyList()
        PlayerScoreConsole(title = e.text("name", "Solo ${game.optInt("startScore", 501)}"), players = players.mapIndexed { i, p -> ScorePlayer("$i", p, if (playerIsCricket(trainingMatch)) game.obj("cricket").optJSONArray("points")?.optInt(i) ?: 0 else remaining.getOrElse(i) { 501 }) }, active = game.optInt("turn"), canScore = e.optBoolean("canManage") && !s.optBoolean("nativeAwaitingReceipt") && (s.text("mode")!="bot"||game.optInt("turn")==0) && s.obj("offlineConflict").text("status")!="open", busy = state.busy, offline = !state.online, queueSupported = s.optBoolean("offlineSupported"), queuedVisits = state.pendingTrainingVisits,
            scoreLabel = if (playerIsCricket(trainingMatch)) "punten" else "restscore", checkout = null, message = state.error, scoreKey = "$id:${e.optInt("revision")}", onSubmit = { score, darts, double, attempts -> entityCommand(actions, e, json("type" to "training.score", "id" to id, "score" to score, "darts" to darts, "doubleConfirmed" to double, "doubleAttempts" to attempts)) }, onBack = { console = false }, onRetry = actions.retry, pending = state.hasPendingCommand,
            dartEntry = if (playerNeedsDartDetail(trainingMatch.raw.obj("settings"))) { { PlayerDartScoreEntry(trainingMatch, state, PlayerActions(matchAction = { _, fields -> entityCommand(actions, e, JSONObject(fields.toString()).put("type", "training.score").put("id", id)) })) } } else null,
            activity = e.obj("boardActivity"), onExtend = { extendActivity(e.obj("boardActivity"), actions) }, options = {
                if(s.optBoolean("offlineSupported"))PlayerTrainingConflict(e,state,actions)
                Action("Laatste beurt terug", !state.busy && s.optInt("undoCount", s.optJSONArray("undo")?.length() ?: 0) > 0, false) { entityCommand(actions, e, json("type" to "training.undo", "id" to id)) }
                if(e.obj("boardActivity").text("kind")=="free")PlayerLegacyResume(id,"training",s.optBoolean("interrupted"),e.obj("boardActivity").optJSONArray("boardIds")?.strings().orEmpty(),state,actions)
                Action("Training bewaren en beëindigen", !state.busy, false) { entityCommand(actions, e, json("type" to "training.finish", "id" to id)) }
            })
    } else Column(Modifier.fillMaxSize().background(PlayerInk).safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Heading(e.text("name", "Jouw training"), "TRAINING")
        if(state.pendingTrainingVisits>0)Notice("Voorlopige lokale stand · ${state.pendingTrainingVisits} beurt(en) wachten nog op serververwerking.")
        game.optJSONArray("remaining")?.let { Text(it.strings().joinToString(" – "), fontFamily = PlayerBarlow, fontSize = 64.sp, color = PlayerLime) }
        if(s.optBoolean("offlineSupported"))PlayerTrainingConflict(e,state,actions)
        if(s.optBoolean("interrupted"))PlayerLegacyResume(id,"training",true,e.obj("boardActivity").optJSONArray("boardIds")?.strings().orEmpty(),state,actions)
        if (!s.optBoolean("interrupted") && !s.optBoolean("completed") && game.text("status") != "finished") Action("Open score-invoer", modifier = Modifier.fillMaxWidth()) { console = true }
        if (game.text("status") == "finished" && !s.optBoolean("completed")) Action("Training bewaren", !state.busy) { entityCommand(actions, e, json("type" to "training.finish", "id" to id)) }
        if (playerIsCricket(trainingMatch)) PlayerCricketTable(trainingMatch) else ScoreCardView(game.rows("visits").filter { s.text("mode") == "bot" || it.optInt("playerIndex") == 0 }, game.optInt("startScore", 501), listOf(state.profile?.displayName?.ifBlank { state.profile.name } ?: "Speler") + if (s.text("mode") == "bot") listOf("Dartbot") else emptyList())
        Action("Terug naar trainingen", primary = false) { actions.navigate(PlayerScreen.TRAINING, null) }
    }
}

@Composable private fun MatchDetail(match: PlayerMatch, state: PlayerUiState, actions: PlayerActions, openConsole: () -> Unit, media: @Composable (String) -> Unit) {
    PlayerGuestOperatorPicker(match, state, actions)
    Heading(match.players.indices.joinToString(" – ") { match.sideName(it) }, "${statusLabel(match.status)} · WEDSTRIJD", "Set ${match.setNumber} · Leg ${match.legNumber}")
    PlayerCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) { match.players.forEachIndexed { index, p -> Column(Modifier.weight(1f)) { Text(match.sideName(index), fontWeight = FontWeight.Bold); if (match.sides.getOrNull(index).orEmpty().size > 1) Text(match.sides[index].joinToString(" · ") { it.displayName.ifBlank { it.name } }, color = PlayerMuted, fontSize = 12.sp); Text("${if (playerIsCricket(match)) match.raw.obj(if (match.raw.obj("settings").text("discipline") == "tactics") "tactics" else "cricket").optJSONArray("points")?.optInt(index) ?: 0 else match.remaining.getOrElse(index) { 0 }}", fontFamily = PlayerBarlow, fontSize = 56.sp, color = if (index == match.turn) PlayerLime else PlayerText); Text(if (index == match.turn) match.currentThrower?.let { "Werpt: ${it.displayName.ifBlank { it.name }}" } ?: "Aan de beurt" else "Wacht", color = PlayerMuted, fontSize = 12.sp) } } }
        Text("Legs ${match.raw.optJSONArray("legs")?.strings()?.joinToString(" – ") ?: ""} · Sets ${match.raw.optJSONArray("sets")?.strings()?.joinToString(" – ") ?: ""}", color = PlayerMuted)
        if (match.status == "live") Action("Open score-invoer", modifier = Modifier.fillMaxWidth(), onClick = openConsole)
        if (match.permissions.optBoolean("canAccept")) Action("Ik ben aanwezig", !state.busy) { actions.matchAction("accept", JSONObject()) }
        if (match.status == "ready" && match.permissions.optBoolean("canStart", match.participants.any { it.id == state.profile?.id } || match.permissions.optBoolean("canManage"))) Action("Start de wedstrijd", !state.busy && state.online && playerStartResolved(match)) { actions.matchAction("start", JSONObject()) }
        if (match.permissions.optBoolean("canConfirm")) Action("Uitslag bevestigen", !state.busy) { actions.matchAction("confirm", JSONObject()) }
    }
    if(match.raw.obj("boardActivity").text("kind")=="free" && match.status in listOf("live","interrupted"))PlayerLegacyResume(match.id,"match",match.status=="interrupted",match.raw.obj("boardActivity").optJSONArray("boardIds")?.strings().orEmpty(),state,actions)
    if(match.status=="confirmed"&&!playerIsCricket(match))PlayerChallengePublish("match",match.id,state.profile?.id.orEmpty(),state,actions)
    PlayerStartProcedure(match, state, actions)
    PlayerOfflineConflict(match, state, actions)
    PlayerMatchRanking(match, state, actions)
    if (match.status == "confirmed" || match.raw.has("primaryCorrection")) PlayerPrimaryCorrectionPanel(match, state, actions)
    BoardActivityBanner(match.raw.obj("boardActivity"), state.online, state.busy) { extendActivity(match.raw.obj("boardActivity"), actions) }
    val invites = state.resource.obj("invitation")
    invites.text("code").takeIf { it.isNotBlank() }?.let { code -> PlayerCard("Wedstrijdcode") { Text(code, fontFamily = PlayerBarlow, fontSize = 46.sp, color = PlayerLime); ShareButton("${BuildConfig.API_ORIGIN}/w/$code") } }
    if (playerIsCricket(match)) PlayerCricketTable(match) else ScoreCardView(match.raw.rows("currentLegVisits").ifEmpty { match.raw.rows("visits").filter { it.optInt("leg") == match.legNumber } }, match.raw.optInt("currentLegStartScore", match.raw.obj("settings").optInt("startScore", 501)), match.players.indices.map { match.sideName(it) }, match.raw.obj("settings").optJSONArray("sideStartScores").ints())
    PlayerCard("Wedstrijdcijfers") { match.players.forEachIndexed { i, p -> val s = match.raw.rows("stats").getOrNull(i) ?: JSONObject(); Text(match.sideName(i), fontWeight = FontWeight.Bold); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { if (playerIsCricket(match)) { Stat("MPR", playerCricketMpr(match.raw.rows("visits"), i)?.let(::number) ?: "—"); Stat("Punten", match.raw.obj(if (match.raw.obj("settings").text("discipline") == "tactics") "tactics" else "cricket").optJSONArray("points")?.optInt(i)?.toString() ?: "0") } else { Stat("AVG", if (s.optInt("darts") > 0) number(3.0 * s.optInt("total") / s.optInt("darts")) else "—"); Stat("Hoogste finish", s.text("highestFinish", "0")); Stat("180's", s.text("oneEighties", "0")) } } } }
    if (playerCanMedia(match, state.profile?.id)) PlayerMediaPanel(match.id, media)
    Action("Wedstrijdchat", primary = false, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.CHAT, "match:${match.id}") }
    PlayerCard("Wedstrijdopties") { MatchOptions(match, actions, state, includeProcedures = false) }
}
@Composable fun PlayerMediaPanel(matchId: String, media: @Composable (String) -> Unit) { PlayerCard("Camera en geluid") { media(matchId) } }
@Composable private fun MatchOptions(match: PlayerMatch, actions: PlayerActions, state: PlayerUiState, includeProcedures: Boolean = true) {
    if (includeProcedures) { PlayerGuestOperatorPicker(match, state, actions); PlayerStartProcedure(match, state, actions); PlayerOfflineConflict(match, state, actions) }
    var reason by remember(match.id) { mutableStateOf("") }
    val p = match.permissions
    if (p.optBoolean("canScore") && !playerNeedsDartDetail(match.raw.obj("settings"))) Action("Bust · nul punten registreren", !state.busy && state.online && !state.hasPendingCommand, false) { actions.matchAction("score", json("score" to 0, "darts" to 3, "bust" to true)) }
    if (p.optBoolean("canTakeOver")) Action("Schrijver overnemen", primary = false) { actions.matchAction("take-over", JSONObject()) }
    if (p.optBoolean("canUndo")) Action("Laatste beurt corrigeren", primary = false) { actions.matchAction("undo", JSONObject()) }
    if (p.optBoolean("canPause")) Action("Wedstrijd pauzeren", primary = false) { actions.matchAction("pause", JSONObject()) }
    if (p.optBoolean("canResume")) Action("Verder spelen", primary = false) { actions.matchAction("resume", JSONObject()) }
    if (p.optBoolean("canRequestCorrection")) { Field("Reden voor correctie", reason, { reason = it }, max = 500); Action("Correctie aanvragen", reason.isNotBlank(), false) { actions.matchAction("request-correction", json("reason" to reason)) } }
    val correction = match.raw.obj("correction")
    if (p.optBoolean("canAnswerCorrection")) { Text("Correctieverzoek: ${correction.text("reason")}", color = PlayerMuted); Action("Correctie goedkeuren", primary = false) { actions.matchAction("approve-correction", json("correctionId" to correction.text("id"))) }; Action("Correctie afwijzen", primary = false) { actions.matchAction("reject-correction", json("correctionId" to correction.text("id"))) } }
    if (p.optBoolean("canCancelCorrection")) Action("Correctieverzoek intrekken", primary = false) { actions.matchAction("cancel-correction", json("correctionId" to correction.text("id"))) }
    match.participants.filter { it.id != state.profile?.id }.forEach { player -> PlayerSafetyControls(state, actions, player.id, player.displayName.ifBlank { player.name }, blocked = state.platform.rows("blocked").any { it.text("id") == player.id }) }
}

/** Mirror scorecard: each side uses its own visit ordinal, never the other player's global sequence. */
@Composable internal fun ScoreCardView(visits: List<JSONObject>, start: Int, names: List<String>, sideStarts: List<Int> = emptyList()) {
    val solo = names.size <= 1
    val left = visits.filter { it.optInt("playerIndex") == 0 }; val right = visits.filter { it.optInt("playerIndex") == 1 }
    val rows = maxOf(left.size, right.size)
    val scroll = rememberScrollState()
    val latest = visits.lastOrNull()?.let { "${it.text("player")}:${it.optInt("remainingAfter")}:${visits.size}" }
    LaunchedEffect(latest) { if (visits.isNotEmpty()) { delay(50); scroll.animateScrollTo(scroll.maxValue) } }
    PlayerCard("Scorekaart · huidige leg") {
        Row { listOfNotNull("Worp", "Rest", if (!solo) "Rest" else null, if (!solo) "Worp" else null).forEach { Text(it, Modifier.weight(1f), color = PlayerMuted, fontSize = 12.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center) } }
        ScoreRow(listOfNotNull("–", "${sideStarts.getOrElse(0) { start }}", if (!solo) "${sideStarts.getOrElse(1) { start }}" else null, if (!solo) "–" else null), false)
        Column(Modifier.height(170.dp).verticalScroll(scroll).testTag("scorecard-visits")) {
            repeat(maxOf(5, rows)) { index ->
                val l = left.getOrNull(index); val r = right.getOrNull(index)
                ScoreRow(listOfNotNull(l?.let { if (it.optBoolean("bust")) "BUST" else it.text("score") } ?: "", l?.text("remainingAfter") ?: "", if (!solo) r?.text("remainingAfter") ?: "" else null, if (!solo) r?.let { if (it.optBoolean("bust")) "BUST" else it.text("score") } ?: "" else null), index == rows - 1)
            }
        }
    }
}
@Composable private fun ScoreRow(values: List<String>, latest: Boolean) {
    Row(Modifier.fillMaxWidth().height(34.dp).background(if (latest) PlayerLime.copy(alpha = .12f) else Color.Transparent), verticalAlignment = Alignment.CenterVertically) { values.forEach { Text(it, Modifier.weight(1f), fontFamily = PlayerBarlow, fontSize = 24.sp, color = if (latest) PlayerLime else PlayerText, textAlign = androidx.compose.ui.text.style.TextAlign.Center) } }
    HorizontalDivider(color = PlayerBorder.copy(alpha = .4f))
}
internal fun extendActivity(activity: JSONObject, actions: PlayerActions) { actions.command("/board-activity/continue", json("sessionId" to activity.text("sessionId"), "warningEpoch" to activity.text("warningEpoch"))) }
@Composable internal fun BoardActivityBanner(activity: JSONObject, online: Boolean, busy: Boolean, extend: () -> Unit) {
    if (activity.length() == 0 || activity.text("phase") !in listOf("active", "warning")) return
    val received = remember(activity.text("sessionId"), activity.optLong("serverNow")) { SystemClock.elapsedRealtime() }
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(activity.text("sessionId")) { while (true) { now = SystemClock.elapsedRealtime(); delay(250) } }
    val current = activity.optLong("serverNow") + now - received
    if (current < activity.optLong("warningAt", Long.MAX_VALUE)) return
    val left = ((activity.optLong("deadlineAt") - current + 999) / 1000).coerceAtLeast(0)
    val extensions = maxOf(0, 2 - activity.optInt("extensionsUsed"))
    Column(Modifier.fillMaxWidth().background(playerThemeColor("warning").copy(alpha = .12f), RoundedCornerShape(10.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(if (left > 0) "Spelen jullie nog door? ${left / 60}:${(left % 60).toString().padStart(2, '0')}" else "De baansessie wordt vrijgegeven.", color = PlayerLime, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        Text("De baan komt vrij als de aftelling afloopt. $extensions verlengingen over.", fontSize = 11.sp, color = PlayerMuted, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        if (left > 0 && activity.optBoolean("canExtend")) TextButton(onClick = extend, enabled = online && !busy && extensions > 0, modifier = Modifier.heightIn(min = 40.dp)) { Text("Doorspelen") }
    }
}

@Composable private fun EventsScreen(state: PlayerUiState, actions: PlayerActions) {
    Heading("Samen aan de oche", "TOERNOOIEN", "Jouw toernooien, competities en verenigingen.")
    Action("Toernooi organiseren", !state.busy, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.ORGANIZE, null) }
    Action("Competities & speeldagen", primary = false, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.SEASONS, null) }
    val events = state.platform.rows("tournaments") + state.platform.rows("leagues")
    val additional = state.overview.rows("events").filter { event -> events.none { it.text("id") == event.text("id") } }
    if (events.isNotEmpty() || additional.isNotEmpty()) {
        Text("Jouw evenementen", style = MaterialTheme.typography.titleMedium)
        events.forEach { event -> PlayerCard {
            Text(if (event.text("kind") == "league") "COMPETITIE" else "TOERNOOI", color = PlayerLime, fontSize = 10.sp, letterSpacing = 1.sp)
            Text(event.text("name"), style = MaterialTheme.typography.titleLarge)
            event.obj("state").text("description").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
            Action("Open evenement", primary = false) { actions.navigate(PlayerScreen.EVENT, event.text("id")) }
        } }
        additional.forEach { event -> PlayerCard(event.text("name")) {
            event.text("date").takeIf { it.isNotBlank() }?.let { Text(shortDate(it), color = PlayerMuted) }
            Action("Open evenement", primary = false) { actions.navigate(PlayerScreen.EVENT, event.text("id")) }
        } }
    } else Text("Nog geen geplande evenementen. Je inschrijvingen en uitnodigingen verschijnen hier.", color = PlayerMuted, style = MaterialTheme.typography.bodyMedium)
    val clubs = state.platform.rows("clubs")
    if (clubs.isNotEmpty()) Text("Jouw verenigingen", Modifier.padding(top = 6.dp), style = MaterialTheme.typography.titleMedium)
    clubs.forEach { club -> PlayerCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(club.text("name"), Modifier.size(40.dp))
            Column(Modifier.weight(1f)) { Text(club.text("name"), style = MaterialTheme.typography.titleMedium); Text("Vereniging", color = PlayerMuted, fontSize = 11.sp) }
        }
        club.obj("state").text("description").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
        Action("Open verenigingschat", primary = false, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.CHAT, "club:${club.text("id")}") }
    } }
}
@Composable private fun EventScreen(state: PlayerUiState, actions: PlayerActions) {
    val e = entityFor(state, "tournaments").takeIf { it.length() > 0 } ?: entityFor(state, "leagues")
    val coreEvent = state.overview.rows("events").find { it.text("id") == state.activeId }
    val id = e.text("id", state.activeId ?: "")
    Heading(e.text("name", coreEvent?.text("name") ?: "Evenement"), if (e.text("kind") == "league") "COMPETITIE" else "TOERNOOI")
    e.obj("state").text("description").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
    val member = e.rows("members").find { it.text("id") == state.profile?.id }
    val invitation = state.invitation.takeIf { it.text("id") == id }
    if (e.length() == 0 && coreEvent == null && invitation != null) {
        PlayerCard("Uitnodiging voor ${invitation.text("name", "toernooi")}") {
            Text("Je kunt met deze uitnodiging deelname aanvragen. Na acceptatie toont DartFlow de gegevens die je mag openen.", color = PlayerMuted)
            Action("Inschrijven met deze uitnodiging", !state.busy && state.online) { actions.platformAction(json("type" to "competition.register", "id" to id, "code" to invitation.text("code"))) }
            Action("Naar toernooien", primary = false) { actions.navigate(PlayerScreen.EVENTS, null) }
        }
        return
    }
    PlayerCard("Jouw deelname") {
        Text(member?.text("status")?.let(::statusLabel) ?: "Nog niet ingeschreven", color = PlayerLime)
        if (e.length() > 0) {
            if (member == null || !member.obj("attributes").optBoolean("registered")) Action("Inschrijven", !state.busy) { entityCommand(actions, e, json("type" to "competition.register", "id" to id, "code" to invitation?.text("code"))) }
            else { Action("Check in", !state.busy, false) { entityCommand(actions, e, json("type" to "competition.checkin", "id" to id, "checkedIn" to true)) }; if (member.text("status") != "withdrawn") Action("Uitschrijven", !state.busy, false) { entityCommand(actions, e, json("type" to "competition.withdraw", "id" to id)) } }
        } else if (coreEvent != null) {
            Action("Inschrijven", !state.busy) { actions.command("/events/$id/actions", json("type" to "register")) }
            Action("Check in", !state.busy, false) { actions.command("/events/$id/actions", json("type" to "check-in")) }
        }
    }
    if (e.length() > 0) Action("Rankinggevolgen en erkenning", primary = false) { actions.navigate(PlayerScreen.RANKING_EVENT, id) }
    if (e.optBoolean("canManage")) Action("Open wedstrijdleiding", !state.busy, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.DIRECTOR, id) }
    Action("Hulp bij toernooien", primary = false) { actions.navigate(PlayerScreen.HELP, "category=Toernooien") }
    PlayerTournamentStandings(e)
    e.obj("state").rows("fixtures").sortedBy { if (it.text("purpose") == "consolation") 1 else 0 }.forEach { f -> PlayerCard("Ronde ${f.optInt("round")} · ${playerTournamentPhaseLabel(f.text("phase"))}") { if (f.text("purpose") == "consolation") Text(e.obj("state").obj("consolation").text("title", "Troostbeker"), color = PlayerLime); f.optJSONObject("settings")?.let { Text("${playerRuleLabel(it)} · best of ${it.optInt("bestOfLegs", 3)} legs · ${it.optInt("bestOfSets", 1)} set(s)", color = PlayerMuted) }; Text(f.optJSONArray("players")?.strings()?.joinToString(" – ") { p -> e.rows("members").find { it.text("id") == p }?.text("name") ?: "Volgt" } ?: ""); Text(statusLabel(f.text("status")), color = PlayerMuted); if (f.text("matchId").isNotBlank()) Action("Open wedstrijd", primary = false) { actions.navigate(PlayerScreen.MATCH, f.text("matchId")) } else if (e.text("kind") == "league" && !e.obj("state").optBoolean("seasonManaged") && f.text("status") == "scheduled" && f.optJSONArray("players")?.strings()?.contains(state.profile?.id) == true) Action("Open mijn geplande competitiepartij", !state.busy && state.online && !e.obj("state").optBoolean("paused") && !e.obj("state").optBoolean("closed")) { entityCommand(actions, e, json("type" to "fixture.start", "id" to id, "fixtureId" to f.text("id"))) } } }
    state.overview.rows("matches").filter { it.text("eventId") == id }.forEach { m -> MatchRow(m, actions) }
    PlayerCard("Deelnemers") { e.rows("members").forEach { Text(name(it) + " · " + statusLabel(it.text("status"))) }; state.overview.rows("participants").filter { it.text("eventId") == id }.forEach { Text(name(it) + if (it.optBoolean("checkedIn")) " · Ingecheckt" else "") } }
    Action("Evenementchat", primary = false) { actions.navigate(PlayerScreen.CHAT, "${if (e.text("kind") == "league") "league" else "tournament"}:$id") }
}
@Composable private fun SeasonsScreen(state: PlayerUiState, actions: PlayerActions) {
    Heading("Jouw competitie", "COMPETITIES", "Planning, check-in, teams en officiële uitslagen.")
    if (state.resource.optBoolean("canCreateNational") || state.resource.rows("clubs").any { it.optBoolean("canManage") }) Action("Competitie maken", !state.busy) { actions.navigate(PlayerScreen.SEASON_CREATE, null) }
    Action("Landelijke spelersrating", primary = false) { actions.navigate(PlayerScreen.RANKINGS, null) }
    val seasons = state.resource.rows("seasons")
    seasons.forEach { s -> PlayerCard(s.text("name")) { Text(statusLabel(s.text("status")), color = PlayerLime); Text(s.text("format"), color = PlayerMuted); Action("Open competitie", primary = false) { actions.navigate(PlayerScreen.SEASON, s.text("id")) } } }
    if (seasons.isEmpty() && !state.loading) Text("Geen toegankelijke competities gevonden.", color = PlayerMuted)
}
@Composable private fun FriendsScreen(state: PlayerUiState, actions: PlayerActions) {
    Heading("Samen is beter", "VRIENDEN", "Vind spelers, beheer uitnodigingen en overleg in de chat.")
    PlayerFriendSearch(state, actions)
    val friends = state.platform.rows("friends")
    friends.sortedByDescending { it.text("status") == "incoming" }.forEach { friend -> PlayerCard {
        PlayerPublicIdentity(friend)
        Text(when(friend.text("status")) { "incoming" -> "Wil jouw vriend worden"; "outgoing" -> "Verzoek verzonden"; else -> if (friend.optBoolean("favorite")) "★ Favoriet" else "Vriend" }, color = PlayerMuted, fontSize = 12.sp)
        val id = friend.text("id")
        if (friend.text("status") == "incoming") Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { Action("Accepteren", !state.busy, modifier = Modifier.weight(1f)) { actions.platformAction(json("type" to "friend.accept", "userId" to id)) }; Action("Afwijzen", !state.busy, false, Modifier.weight(1f)) { actions.platformAction(json("type" to "friend.reject", "userId" to id)) } }
        if (friend.text("status") == "friend") {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { Action("Spelerskamers", primary = false, modifier = Modifier.weight(1f)) { actions.navigate(PlayerScreen.FRIENDS, "rooms") }; Action("Uitdagen", !state.busy, modifier = Modifier.weight(1f)) { actions.platformAction(json("type" to "lobby.create", "name" to "Vriendschappelijke partij", "opponentId" to id, "setup" to "remote", "startScore" to 501, "bestOfLegs" to 3)) } }
            TextButton(onClick = { actions.platformAction(json("type" to "friend.favorite", "userId" to id, "favorite" to !friend.optBoolean("favorite"))) }, enabled = !state.busy) { Text(if (friend.optBoolean("favorite")) "Favoriet verwijderen" else "Als favoriet bewaren") }
        }
        PlayerSafetyControls(state, actions, id, name(friend))
    } }
    if (friends.isEmpty() && !state.loading) Text("Nog geen vrienden of openstaande verzoeken. Zoek hierboven een speler.", color = PlayerMuted)
    state.platform.rows("rooms").forEach { room -> PlayerCard(room.text("name")) {
        Text(room.obj("state").text("description", "Overleg met de spelers in deze kamer."), color = PlayerMuted)
        if (room.rows("members").none { it.text("id") == state.profile?.id && it.text("status") == "active" }) Action("Kamer openen", !state.busy, false) { entityCommand(actions, room, json("type" to "room.join", "id" to room.text("id"))) }
        else Action("Open kamerchat", primary = false) { actions.navigate(PlayerScreen.CHAT, "room:${room.text("id")}") }
    } }
    state.platform.rows("blocked").forEach { p -> PlayerCard { Text("Geblokkeerd: ${name(p)}"); PlayerSafetyControls(state, actions, p.text("id"), name(p), blocked = true) } }
}

@Composable private fun FeedScreen(state: PlayerUiState, actions: PlayerActions) {
    val page = state.resource
    val feedParams = runCatching { PlayerLinks.query(java.net.URI("https://native.invalid/?${state.activeId.orEmpty()}")) }.getOrDefault(emptyMap())
    val parentId = feedParams["parentId"]
    Heading(if (parentId != null) "Reacties" else "Jouw dartcommunity", "FEED", "Berichten uit jouw verenigingen, evenementen en het platform.")
    CommunityConsent(state, actions)
    if (parentId != null) Action("Terug naar de feed", primary = false) { actions.navigate(PlayerScreen.FEED, null) }
    CommunityPostComposer(page, state, actions, parentId, feedParams["kind"]?.let { "$it:${feedParams["id"].orEmpty()}" })
    page.rows("posts").forEach { post -> CommunityPostCard(post, state, actions) }
    if (page.rows("posts").isEmpty() && !state.loading) Text("Nog geen berichten. Begin een gesprek in jouw community.", color = PlayerMuted)
    page.text("nextCursor").takeIf { it.isNotBlank() }?.let { cursor -> Action("Eerdere berichten", primary = false) { actions.navigate(PlayerScreen.FEED, state.activeId.orEmpty().substringBefore("&cursor=").let { if (it.isBlank()) "cursor=${PlayerLinks.encode(cursor)}" else "$it&cursor=${PlayerLinks.encode(cursor)}" }) } }
}

/** The home stream and full feed use one composer and the same permissions. */
@Composable internal fun CommunityPostComposer(page: JSONObject, state: PlayerUiState, actions: PlayerActions, parentId: String? = null, replyScopeKey: String? = null) {
    val scopes = page.rows("scopes")
    var draft by rememberSaveable(state.session?.userId, parentId) { mutableStateOf("") }
    var selected by rememberSaveable(state.session?.userId, parentId) { mutableStateOf("") }
    val scope = if (parentId != null) scopes.find { "${it.text("kind")}:${it.text("id")}" == replyScopeKey }
        else scopes.find { "${it.text("kind")}:${it.text("id")}" == selected } ?: scopes.firstOrNull()
    if (scope == null) return
    PlayerCard(if (parentId == null) "Deel iets met je spelers" else "Jouw reactie") {
        if (parentId == null) Choice("Plaatsen in", "${scope.text("kind")}:${scope.text("id")}", scopes.map { "${it.text("kind")}:${it.text("id")}" to it.text("name") }, { selected = it })
        else Text(scope.text("name"), color = PlayerMuted, fontSize = 12.sp)
        Field("Jouw bericht", draft, { draft = it }, !state.busy && scope.optBoolean("canWrite") && canUseCommunity(state.safety), max = 4000, multiline = true)
        Action(if (parentId == null) "Bericht plaatsen" else "Reactie plaatsen", draft.isNotBlank() && !state.busy && scope.optBoolean("canWrite") && canUseCommunity(state.safety), modifier = Modifier.fillMaxWidth()) {
            if (parentId != null) actions.platformAction(json("type" to "community.reply", "postId" to parentId, "body" to draft))
            else actions.platformAction(json("type" to "community.post", "scopeKind" to scope.text("kind"), "scopeId" to scope.text("id"), "body" to draft))
            draft = ""
        }
    }
}

/** Real server posts, identical reply routes, moderation and write actions everywhere. */
@Composable internal fun CommunityPostCard(post: JSONObject, state: PlayerUiState, actions: PlayerActions, tagPrefix: String = "feed") {
    val id = post.text("id")
    val authorId = post.text("authorId")
    val author = post.text("authorName", "Speler")
    var optionsOpen by remember(state.session?.userId, id) { mutableStateOf(false) }
    val canModerate = authorId.isNotBlank() && authorId != state.profile?.id
    PlayerCard(modifier = Modifier.testTag("$tagPrefix-post-$id")) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(author, Modifier.size(36.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(author, fontWeight = FontWeight.Bold)
                Text(listOf(post.text("scopeName"), shortDate(post.text("createdAt"))).filter { it.isNotBlank() }.joinToString(" · "), color = PlayerMuted, fontSize = 11.sp, lineHeight = 15.sp)
            }
        }
        Text(post.text("body"), style = MaterialTheme.typography.bodyMedium)
        PlayerFeedExtras(post, state, actions)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { actions.platformAction(json("type" to "community.like", "postId" to id, "liked" to !post.optBoolean("liked"))) }, enabled = !state.busy) {
                Text("${if (post.optBoolean("liked")) "Leuk gevonden" else "Leuk"} · ${post.optInt("likes")}", fontSize = 12.sp)
            }
            TextButton(onClick = { actions.navigate(PlayerScreen.FEED, "kind=${PlayerLinks.encode(post.text("scopeKind"))}&id=${PlayerLinks.encode(post.text("scopeId"))}&parentId=${PlayerLinks.encode(id)}") }, modifier = Modifier.testTag("$tagPrefix-replies-$id")) {
                Text("${post.optInt("replyCount")} reacties", fontSize = 12.sp)
            }
            Spacer(Modifier.weight(1f))
            if (canModerate || post.optBoolean("canDelete")) IconButton(onClick = { optionsOpen = !optionsOpen }, modifier = Modifier.semantics { contentDescription = if (canModerate) "Berichtopties: melden en blokkeren" else "Berichtopties" }) {
                PlayerIcon(PlayerNavIcon.MORE, modifier = Modifier.size(18.dp))
            }
        }
        if (optionsOpen) {
            HorizontalDivider(color = PlayerBorder)
            PlayerSafetyControls(state, actions, authorId, author, PlayerReportTarget(if (post.text("parentId").isNotBlank()) "reply" else "post", id, if (post.text("parentId").isNotBlank()) "Reactie" else "Bericht", post.text("scopeKind"), post.text("scopeId")), blocked = state.platform.rows("blocked").any { it.text("id") == authorId })
            if (post.optBoolean("canDelete")) TextButton(onClick = { actions.platformAction(json("type" to "community.delete", "postId" to id)) }, enabled = !state.busy) { Text("Bericht verwijderen", color = PlayerError) }
        }
    }
}

@Composable private fun ChatScreen(state: PlayerUiState, actions: PlayerActions) {
    val data = state.resource; val key = state.activeId ?: ""; val kind = key.substringBefore(':'); val id = key.substringAfter(':', "")
    var draft by rememberSaveable(key) { mutableStateOf("") }
    Heading(data.obj("scope").text("name", if (kind == "match") "Wedstrijdchat" else "Chat"), "SAMEN SPELEN")
    CommunityConsent(state, actions)
    val messages = data.rows("messages")
    val canWrite = if (kind == "room") state.platform.rows("rooms").find { it.text("id") == id }?.rows("members")?.any { it.text("id") == state.profile?.id && it.text("status") == "active" } == true else if (kind == "match") state.match?.id == id && state.match.participants.any { it.id == state.profile?.id } || state.overview.rows("matches").any { it.text("id") == id && PlayerMatch.parse(it).participants.any { p -> p.id == state.profile?.id } } else data.obj("scope").optBoolean("canWrite")
    messages.forEach { message -> PlayerCard {
        Row(Modifier.fillMaxWidth()) { Text(message.text("authorName"), Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(shortDate(message.text("createdAt")), fontSize = 10.sp, color = PlayerMuted) }
        Text(if (message.optBoolean("deleted")) "Bericht verwijderd." else message.text("body"))
        PlayerSafetyControls(state, actions, message.text("authorId"), message.text("authorName", "Speler"), PlayerReportTarget(if (kind == "room") "room-message" else "message", message.text("id"), "Chatbericht", kind, id))
    } }
    if (messages.isEmpty() && !state.loading) Text("Nog geen berichten. Overleg hier over jullie volgende partij.", color = PlayerMuted)
    PlayerCard("Jouw bericht") {
        Field("Bericht", draft, { draft = it }, !state.busy && canWrite && canUseCommunity(state.safety), max = 2000, multiline = true)
        Action("Versturen", draft.isNotBlank() && !state.busy && canWrite && canUseCommunity(state.safety), modifier = Modifier.fillMaxWidth()) {
            when (kind) {
                "match" -> actions.command("/platform/matches/$id/chat", json("body" to draft))
                "room" -> actions.platformAction(json("type" to "room.message", "id" to id, "body" to draft))
                else -> actions.platformAction(json("type" to "community.message", "scopeKind" to kind, "scopeId" to id, "body" to draft))
            }; draft = ""
        }
    }
}

@Composable private fun HistoryScreen(state: PlayerUiState, actions: PlayerActions) {
    Heading("Iedere leg bewaard", "WEDSTRIJDHISTORIE", "Afgeronde wedstrijden met jouw profiel.")
    val rows = state.resource.rows("matches")
    rows.forEach { MatchRow(it, actions) }
    if (rows.isEmpty() && !state.loading) Text("Je hebt nog geen gespeelde, afgeronde wedstrijden.", color = PlayerMuted)
    val pagination = state.resource.obj("pagination")
    Pagination(pagination.optInt("offset"), pagination.optInt("total")) { offset -> actions.navigate(PlayerScreen.HISTORY, updatedQuery(state.activeId, "offset", "$offset")) }
}
@Composable private fun MatchRow(row: JSONObject, actions: PlayerActions) {
    PlayerCard {
        Text(row.obj("opponent").text("name", row.rows("players").joinToString(" – ") { name(it) }.ifBlank { "Wedstrijd" }), style = MaterialTheme.typography.titleMedium)
        Text("${shortDate(row.text("completedAt"))} · ${playerRuleLabel(row)}", color = PlayerMuted, fontSize = 12.sp)
        Text("${row.text("result")} ${row.optJSONArray("legs")?.strings()?.joinToString(" – ") ?: ""}", color = PlayerLime, fontFamily = PlayerBarlow, fontSize = 30.sp)
        row.obj("competition").text("name").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
        Action("Open scorekaart", primary = false) { actions.navigate(PlayerScreen.MATCH, row.text("id", row.text("matchId"))) }
    }
}
@Composable private fun Pagination(offset: Int, total: Int, change: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = { change(maxOf(0, offset - 25)) }, enabled = offset > 0) { Text("Vorige") }
        Text(if (total > 0) "${offset + 1}–${minOf(offset + 25, total)} van $total" else "0 resultaten", color = PlayerMuted, fontSize = 11.sp)
        TextButton(onClick = { change(offset + 25) }, enabled = offset + 25 < total) { Text("Volgende") }
    }
}

@Composable private fun StatisticsScreen(state: PlayerUiState, actions: PlayerActions) {
    Action("Vrij spel, oefeningen & uitdagingen",primary=false){actions.navigate(PlayerScreen.PLAY_HISTORY,"statistics:")}
    var view by rememberSaveable { mutableStateOf("matches") }
    var score by rememberSaveable { mutableStateOf(runCatching { PlayerLinks.query(java.net.URI("https://native.invalid/?${state.activeId.orEmpty()}"))["startScore"] }.getOrNull() ?: "501") }
    val data = state.resource; val summary = data.obj("summary"); val measures = summary.obj("measures")
    Heading("Jouw spelersprofiel", "STATISTIEKEN", "Berekeningen op basis van geaccepteerde worpen en definitieve uitslagen.")
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("matches" to "Wedstrijden", "opponents" to "Tegenstanders", "tournaments" to "Toernooien", "practice" to "Oefenen", "team" to "Eigen teambijdrage", "cricket" to "Cricket", "tactics" to "Tactics").forEach { (id, label) -> FilterChip(selected = view == id, onClick = { view = id }, label = { Text(label) }) } }
    val ruleFilters = runCatching { PlayerLinks.query(java.net.URI("https://native.invalid/?${state.activeId.orEmpty()}")) }.getOrDefault(emptyMap())
    Choice("Wedstrijdbron",ruleFilters["source"]?:"",listOf("" to "Alle bronnen","free" to "Vrije wedstrijden","league" to "Competities","tournament" to "Toernooien"),{actions.navigate(PlayerScreen.STATISTICS,updatedQuery(state.activeId,"source",it))})
    Choice("Startscore", score, listOf("301" to "301", "501" to "501", "701" to "701"), { score = it; actions.navigate(PlayerScreen.STATISTICS, updatedQuery(state.activeId, "startScore", it)) })
    Choice("Uitregel", ruleFilters["outRule"] ?: "double-out", listOf("double-out" to "Dubbel uit", "straight-out" to "Straight uit", "master-out" to "Master uit"), { actions.navigate(PlayerScreen.STATISTICS, updatedQuery(state.activeId, "outRule", it)) })
    Choice("Openingsregel", ruleFilters["inRule"] ?: "single", listOf("single" to "Single in", "double" to "Dubbel in"), { actions.navigate(PlayerScreen.STATISTICS, updatedQuery(state.activeId, "inRule", it)) })
    PlayerToggle("Alleen partijen met handicap", ruleFilters["handicap"] == "true", !state.busy) { actions.navigate(PlayerScreen.STATISTICS, updatedQuery(state.activeId, "handicap", it.toString())) }
    when(view) {
        "matches" -> {
            PlayerCard("Wedstrijdcijfers") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Stat("Gespeeld", summary.text("played", "0")); Stat("Gewonnen", summary.text("won", "0")); Stat("Verloren", summary.text("lost", "0")) }
                Text("Gelijk ${summary.optInt("drawn")} · Legs ${summary.optInt("legsWon")}–${summary.optInt("legsLost")}", color = PlayerMuted)
                Text("Winstpercentage ${summary.optDouble("winPercentage", Double.NaN).takeIf { it.isFinite() }?.let { number(it) + "%" } ?: "Onbekend"}", color = PlayerMuted)
            }
            PlayerCard("Vorm · laatste vijf") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { summary.rows("form").forEach { result -> AssistChip(onClick = { actions.navigate(PlayerScreen.MATCH, result.text("id")) }, label = { Text(result.text("result")) }) } }
                Text("Meest recent eerst · W gewonnen · V verloren · G gelijk", color = PlayerMuted, fontSize = 11.sp)
            }
            val last = summary.obj("last50")
            PlayerCard("Laatste 50 · ${last.optDouble("average", Double.NaN).takeIf { it.isFinite() }?.let(::number) ?: "—"} AVG") {
                Text(last.text("label", "Nog geen volledig gemeten duels."), color = PlayerMuted)
                TrendChart(last.rows("trend"))
            }
            PlayerCard("Worpen en records") {
                val labels = listOf("average" to "3-dartgemiddelde", "hundredPlus" to "100+ (inclusief 140+ en 180)", "hundredFortyPlus" to "140+ (inclusief 180)", "oneEighties" to "180's", "highestFinish" to "Hoogste finish", "hundredPlusFinishes" to "100+ finishes", "bestLegDarts" to "Beste leg · pijlen", "firstNine" to "First 9", "hundredPlusPer100" to "100+ per 100 beurten", "checkoutPercentage" to "Checkoutpercentage")
                labels.forEach { (key, label) -> Row(Modifier.fillMaxWidth()) { Text(label, Modifier.weight(1f), color = PlayerMuted, fontSize = 13.sp); Text(if (!measures.has(key) || measures.isNull(key)) "Onbekend" else measures.text(key), color = PlayerLime, fontWeight = FontWeight.Bold) } }
                val d = measures.obj("distribution"); Text("Exclusieve verdeling · 100–139: ${d.optInt("hundredTo139")} · 140–179: ${d.optInt("hundredFortyTo179")} · 180: ${d.optInt("oneEighty")}", color = PlayerMuted, fontSize = 12.sp)
            }
            PlayerCard("Tien hoogste finishes") {
                val finishes = summary.rows("topFinishes")
                finishes.forEach { f -> Row(Modifier.fillMaxWidth().clickable { actions.navigate(PlayerScreen.MATCH, f.text("matchId")) }, verticalAlignment = Alignment.CenterVertically) { Text(f.text("score"), fontFamily = PlayerBarlow, color = PlayerLime, fontSize = 32.sp, modifier = Modifier.width(55.dp)); Column { Text(f.obj("opponent").text("name", "Speler")); Text(shortDate(f.text("completedAt")), color = PlayerMuted, fontSize = 11.sp) } } }
                if (finishes.isEmpty()) Text("Nog geen betrouwbare legwinnende finishes.", color = PlayerMuted)
            }
            Action("Volledige wedstrijdhistorie", primary = false, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.HISTORY, null) }
        }
        "cricket", "tactics" -> PlayerCard("${if(view=="tactics")"Tactics" else "Cricket"} · eigen statistieken") {
            val cricket = data.obj(if(view=="tactics")"tactics" else "cricket")
            Text("${cricket.optInt("matches")} wedstrijden · ${cricket.optInt("won")} gewonnen", color = PlayerLime)
            Text("${cricket.optInt("points")} punten · ${cricket.optInt("darts")} darts · ${cricket.optInt("creditedMarks")} gecrediteerde marks")
            Stat("MPR", cricket.optDouble("marksPerRound", Double.NaN).takeIf { it.isFinite() }?.let(::number) ?: "—")
            Text("Marks per ronde gebruikt alleen de eigen geregistreerde darts en gecrediteerde marks.", color = PlayerMuted)
        }
        "team" -> {
            Text("Alleen jouw werkelijk geregistreerde worpen in dubbels en teams. Deze bijdrage staat apart van individuele X01-cijfers.", color = PlayerMuted)
            data.rows("teamContributions").forEach { row -> PlayerCard(row.text("sideName", "Teampartij")) {
                Text("${shortDate(row.text("completedAt"))} · partners ${row.optJSONArray("partners")?.strings()?.joinToString(" · ").orEmpty()}", color = PlayerMuted)
                val own = row.obj("measures")
                Text("${own.optInt("visits")} beurten · ${own.optInt("darts")} darts · ${own.optInt("points")} punten")
                if (row.text("discipline") in listOf("cricket","tactics")) Stat("Eigen MPR", own.optDouble("marksPerRound", Double.NaN).takeIf { it.isFinite() }?.let(::number) ?: "—")
                else { Stat("Eigen AVG", own.optDouble("average", Double.NaN).takeIf { it.isFinite() }?.let(::number) ?: "—"); Text("${own.optInt("oneEighties")} ×180 · hoogste finish ${own.optInt("highestFinish")}") }
                Action("Open teampartij", primary = false) { actions.navigate(PlayerScreen.MATCH, row.text("matchId")) }
            } }
            if (data.rows("teamContributions").isEmpty()) Text("Nog geen teampartijen met eigen geregistreerde worpen.", color = PlayerMuted)
        }
        "opponents" -> {
            var search by rememberSaveable { mutableStateOf("") }
            Field("Zoek tegenstander", search, { search = it })
            val opponents = data.rows("opponents").filter { it.obj("opponent").text("name").contains(search, true) }
            opponents.forEach { opponent -> PlayerCard(opponent.obj("opponent").text("name")) {
                Text("${opponent.optInt("played")} ontmoetingen · W/G/V ${opponent.optInt("won")}/${opponent.optInt("drawn")}/${opponent.optInt("lost")}", color = PlayerLime)
                Text("Legs ${opponent.optInt("legsWon")}–${opponent.optInt("legsLost")} · laatst ${shortDate(opponent.text("lastPlayedAt"))}", color = PlayerMuted)
                opponent.rows("recent").forEach { result -> TextButton(onClick = { actions.navigate(PlayerScreen.MATCH, result.text("id")) }) { Text("${shortDate(result.text("completedAt"))} · ${result.text("result")} ${result.optJSONArray("legs")?.strings()?.joinToString("–")}") } }
                Action("Volledige onderlinge historie", primary = false) { actions.navigate(PlayerScreen.HISTORY, "opponent=${opponent.obj("opponent").text("id")}") }
            } }
            if (opponents.isEmpty()) Text("Nog geen gespeelde duels met gekoppelde tegenstanders.", color = PlayerMuted)
        }
        "tournaments" -> {
            data.rows("tournaments").forEach { t -> PlayerCard(t.text("name")) { val s = t.obj("summary"); Text("Klassering: ${t.text("classification", "Nog niet definitief")}", color = PlayerLime); Text("${s.optInt("played")} duels · W/V ${s.optInt("won")}/${s.optInt("lost")} · Legs ${s.optInt("legsWon")}–${s.optInt("legsLost")}", color = PlayerMuted); Text("AVG ${s.obj("measures").text("average", "Onbekend")} · Hoogste finish ${s.obj("measures").text("highestFinish", "0")}"); Action("Open evenement", primary = false) { actions.navigate(PlayerScreen.EVENT, t.text("id")) } } }
            if (data.rows("tournaments").isEmpty()) Text("Nog geen toernooien of competities met gespeelde uitslagen.", color = PlayerMuted)
        }
        "practice" -> {
            Text("Alleen voltooide, opgeslagen oefensessies. Deze cijfers tellen niet mee bij wedstrijden of onderlinge balans.", color = PlayerMuted)
            data.obj("practice").rows("records").forEach { r -> PlayerCard("${r.text("mode")} · ${r.text("startScore")}") { Text("${r.optInt("sessions")} sessies"); Text("Beste AVG ${r.text("bestAverage", "Onbekend")} · Beste leg ${r.text("bestLegDarts", "Onbekend")} pijlen · Hoogste finish ${r.text("highestFinish", "Onbekend")}", color = PlayerMuted) } }
            data.obj("practice").rows("sessions").forEach { s -> PlayerCard(s.text("name")) { Text(shortDate(s.text("completedAt")), color = PlayerMuted); Action("Open training", primary = false) { actions.navigate(PlayerScreen.TRAINING, s.text("id")) } } }
            if (data.obj("practice").rows("sessions").isEmpty()) Text("Nog geen voltooide oefeningen.", color = PlayerMuted)
        }
    }
}
@Composable private fun TrendChart(points: List<JSONObject>) {
    val values = points.mapIndexedNotNull { index, value -> if (value.isNull("average")) null else index to value.optDouble("average", Double.NaN).takeIf { it.isFinite() } }.mapNotNull { (index, value) -> value?.let { index to it } }
    if (values.isEmpty()) { Text("Nog geen trend beschikbaar.", color = PlayerMuted); return }
    val accent = PlayerLime
    Canvas(Modifier.fillMaxWidth().height(100.dp).semantics { contentDescription = "Trend van het 3-dartgemiddelde over ${points.size} wedstrijden" }) {
        val max = maxOf(100.0, values.maxOf { it.second })
        val path = Path(); values.forEachIndexed { i, (index, avg) -> val x = 8f + (if (points.size > 1) index.toFloat() / (points.size - 1) else .5f) * (size.width - 16); val y = size.height - 8 - (avg / max * (size.height - 16)).toFloat(); if (i == 0) path.moveTo(x, y) else path.lineTo(x, y); drawCircle(accent, 4f, androidx.compose.ui.geometry.Offset(x, y)) }; drawPath(path, accent, style = Stroke(3f))
    }
}

@Composable private fun ProfileScreen(state: PlayerUiState, actions: PlayerActions) {
    val profile = state.profile ?: return
    val data = state.resource.optJSONObject("profile") ?: state.platform.optJSONObject("profile") ?: JSONObject()
    var username by remember(profile.id, profile.username) { mutableStateOf(profile.username) }
    var display by remember(profile.id, profile.displayName) { mutableStateOf(profile.displayName) }
    var fullName by remember(profile.id, profile.fullName) { mutableStateOf(profile.fullName.orEmpty()) }
    var confirmUsername by remember { mutableStateOf(false) }
    var publicStats by remember(data.optBoolean("showPublicStatistics")) { mutableStateOf(data.optBoolean("showPublicStatistics")) }
    var discoverable by remember { mutableStateOf(state.platform.obj("preferences").optBoolean("discoverable", true)) }
    var allowRequests by remember { mutableStateOf(state.platform.obj("preferences").optBoolean("allowRequests", true)) }
    var current by remember { mutableStateOf("") }; var pin by remember { mutableStateOf("") }; var repeat by remember { mutableStateOf("") }
    var reset by remember { mutableStateOf(false) }; var showPin by remember { mutableStateOf(!profile.pinConfigured) }
    ClearSecretsOnBackground { current = ""; pin = ""; repeat = "" }
    Heading(profile.displayName.ifBlank { profile.name }, "JOUW PROFIEL", "Eén profiel voor training, wedstrijden, verenigingen en evenementen.")
    Action("Bekijk statistieken", primary = false, modifier = Modifier.fillMaxWidth()) { actions.navigate(PlayerScreen.STATISTICS, null) }
    fun saveIdentity() { actions.platformAction(playerIdentityUpdate(profile, fullName, display, username).put("showPublicStatistics", publicStats)); confirmUsername = false }
    PlayerCard("Jouw identiteit") {
        val validIdentity = PlayerIdentityFields(profile, !state.busy, fullName, { fullName = it }, display, { display = it }, username, { username = it }, actions)
        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(publicStats, { publicStats = it }); Text("Historische profielcijfers tonen op openbare Oche Live-baanschermen", fontSize = 13.sp) }
        Action("Profiel opslaan", !state.busy && state.online && validIdentity, modifier = Modifier.fillMaxWidth()) { if (profile.usernameLocked) saveIdentity() else confirmUsername = true }
        Action("Hulp bij namen en privacy", primary = false) { actions.navigate(PlayerScreen.HELP, "q=gebruikersnaam") }
    }
    if (confirmUsername) PlayerUsernameConfirmation(username, ::saveIdentity) { confirmUsername = false }
    PlayerCard("Spelerspincode") {
        Text(if (profile.pinConfigured) "Je spelerspincode is ingesteld." else "Nog instellen. Je kunt ondertussen via je eigen telefoon en bestaande toernooi-inschrijvingen blijven spelen.", color = PlayerMuted)
        if (!showPin) Action("Pincode wijzigen", primary = false) { showPin = true; reset = false }
        if (showPin) {
            Text("Gebruik deze pincode om op een QR-baan met jouw DartFlow-profiel mee te spelen.", color = PlayerMuted, fontSize = 13.sp)
            if (profile.pinConfigured && !reset) Field("Huidige spelerspincode", current, { current = it.filter { c -> c in '0'..'9' } }, !state.busy, true, KeyboardType.NumberPassword, max = 6)
            if (reset) {
                Notice("Verifieer je eigen login opnieuw via Google of een e-mailcode. Kom daarna terug om je nieuwe pincode op te slaan.")
                Action("Opnieuw verifiëren met Google", !state.busy, false, onClick = actions.google)
                TextButton(onClick = { actions.logout() }) { Text("Verifieer via een nieuwe e-mailcode") }
            }
            Field("Nieuwe spelerspincode", pin, { pin = it.filter { c -> c in '0'..'9' } }, !state.busy, true, KeyboardType.NumberPassword, if (pin.isNotEmpty() && !validPlayerPin(pin)) "Gebruik precies zes cijfers." else null, 6)
            Field("Herhaal spelerspincode", repeat, { repeat = it.filter { c -> c in '0'..'9' } }, !state.busy, true, KeyboardType.NumberPassword, if (repeat.isNotEmpty() && repeat != pin) "De pincodes zijn niet gelijk." else null, 6)
            Action("Pincode opslaan", !state.busy && validPlayerPin(pin) && pin == repeat && (!profile.pinConfigured || reset || validPlayerPin(current)), modifier = Modifier.fillMaxWidth()) {
                if (reset) actions.command("/profile/player-pin", json("mode" to "reset", "pin" to pin, "pinConfirmation" to repeat))
                else actions.changePin(current, pin, repeat)
                current = ""; pin = ""; repeat = ""
            }
        }
        if (profile.pinConfigured) TextButton(onClick = { reset = true; showPin = true; current = ""; pin = ""; repeat = "" }) { Text("Pincode vergeten?") }
    }
    PlayerCard("Privacy") {
        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(discoverable, { discoverable = it }); Text("Zichtbaar in de spelerszoeker", fontSize = 13.sp) }
        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(allowRequests, { allowRequests = it }); Text("Vriendschapsverzoeken ontvangen", fontSize = 13.sp) }
        Action("Privacykeuzes opslaan", !state.busy, false) { actions.platformAction(json("type" to "preferences.update", "discoverable" to discoverable, "allowRequests" to allowRequests)) }
        val context = LocalContext.current
        TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, "${BuildConfig.API_ORIGIN}/privacy".toUri())) }) { Text("Privacybeleid lezen") }
        SafetyLink("Communityregels en melden", "/communityregels")
        Text("Privacy- en veiligheidsvragen: info@dartflow.nl", color = PlayerMuted, fontSize = 12.sp)
    }
    PlayerThemePreference(state, actions)
    if (state.canManagePlatform) PlayerPremiumAdministration(state, actions)
    PlayerCard("Jouw account") { Text(state.session?.email ?: ""); Text("DartFlow ${BuildConfig.VERSION_NAME}", color = PlayerMuted, fontSize = 12.sp); Action("Uitloggen", !state.busy, false, Modifier.fillMaxWidth(), actions.logout) }
    AccountDeletionCard(state, actions)
}

@Composable private fun NotificationsScreen(state: PlayerUiState, actions: PlayerActions) {
    Heading("Jouw meldingen", "DARTFLOW", "Baanoproepen, verzoeken en acties die op je wachten.")
    PlayerPushControls(state, actions)
    PlayerGuestClaims(state, actions)
    val entries = state.resource.rows("notifications")
    entries.forEach { n -> PlayerCard(n.text("title", n.text("label", "Melding"))) { Text(n.text("body", n.text("detail")), color = PlayerMuted); if (n.text("href").isNotBlank()) Action("Openen", primary = false) { actions.openLink(n.text("href")) } } }
    state.platform.rows("friends").filter { it.text("status") == "incoming" }.forEach { f -> PlayerCard("Vriendschapsverzoek") { Text("${name(f)} wil jouw vriend worden."); Action("Bekijk verzoek", primary = false) { actions.navigate(PlayerScreen.FRIENDS, null) } } }
    state.resource.rows("actions").forEach { a -> PlayerCard(a.text("label")) { Text(a.text("detail"), color = PlayerMuted); Action("Openen", primary = false) { actions.openLink(a.text("href")) } } }
    state.resource.rows("fixtures").forEach { FixtureCard(it, actions, state.busy) }
    if (entries.isEmpty() && state.resource.obj("push").rows("items").isEmpty() && state.resource.rows("actions").isEmpty() && state.resource.rows("fixtures").isEmpty() && state.platform.rows("friends").none { it.text("status") == "incoming" }) Text("Je bent helemaal bij.", color = PlayerMuted)
}

@Composable private fun ScreensScreen(state: PlayerUiState, actions: PlayerActions) {
    val context = state.resource.optJSONObject("oche") ?: state.resource.obj("context")
    var code by rememberSaveable { mutableStateOf("") }; var label by rememberSaveable { mutableStateOf("") }
    var scope by rememberSaveable { mutableStateOf("home") }; var board by rememberSaveable { mutableStateOf("") }; var confirmed by remember { mutableStateOf(false) }; var replace by remember { mutableStateOf("") }
    LaunchedEffect(state.activeId) { state.activeId?.removePrefix("paircode:")?.takeIf { it.length == 8 }?.let { code = it; confirmed = false } }
    val locations = context.rows("locations").filter { it.optBoolean("canManageScreens", true) }
    val selected = locations.find { it.text("locationId") == scope }
    Heading("Oche Live-schermen", "SCHERMBEHEER", "Koppel je tv of tablet eenmalig. Het scherm leest alleen de toegewezen stand.")
    PlayerCard("Scherm koppelen") {
        Text("Open Oche Live op het scherm en vul de acht tekens van de getoonde koppelcode in.", color = PlayerMuted)
        Field("Koppelcode", code, { code = it.uppercase(Locale.ROOT).filter { c -> c.isLetterOrDigit() }.take(8); confirmed = false }, !state.busy, max = 8)
        Action("Scan koppel-QR", !state.busy, false, onClick = actions.scan)
        Field("Schermnaam", label, { label = it; confirmed = false }, !state.busy, max = 80)
        Choice("Waar gebruik je dit scherm?", scope, listOf("home" to "Mijn scherm thuis") + locations.filter { it.text("locationId").isNotBlank() }.map { it.text("locationId") to it.text("name") }, { scope = it; board = ""; confirmed = false }, !state.busy)
        if (scope != "home") Choice("Baan", board, listOf("" to "Later een baan toewijzen") + (selected?.rows("boards") ?: emptyList()).map { it.text("id") to it.text("name") }, { board = it; confirmed = false }, !state.busy)
        val capacity = if (scope == "home") context.obj("home") else selected ?: JSONObject()
        val full = capacity.optInt("active") + capacity.optInt("reserved") >= capacity.optInt("maximum", Int.MAX_VALUE)
        Text("${capacity.optInt("active")} actief · ${capacity.optInt("reserved")} gereserveerd · maximum ${capacity.text("maximum", "—")}", color = if (full) PlayerError else PlayerMuted, fontSize = 12.sp)
        val existing = context.rows("devices").filter { !it.optBoolean("revoked") && it.text("scope") == (if (scope == "home") "home" else "location") && (scope == "home" || it.text("locationId") == scope) }
        if (existing.isNotEmpty()) Choice("Bestaand scherm vervangen", replace, listOf("" to "Geen vervanging") + existing.map { it.text("id") to it.text("name") }, { replace = it; confirmed = false }, !state.busy)

        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(confirmed, { confirmed = it }); Text("Ik wil dit scherm aan mijn account of de gekozen locatie koppelen.", fontSize = 12.sp) }
        Action("Dit scherm koppelen", code.length == 8 && label.isNotBlank() && confirmed && !state.busy, modifier = Modifier.fillMaxWidth()) { actions.command("/oche/v1/claim", json("code" to code, "scope" to if (scope == "home") "home" else "location", "name" to label.trim(), "locationId" to if (scope == "home") null else scope, "boardId" to board.ifBlank { null }, "replaceDeviceId" to replace.ifBlank { null })); confirmed = false }
    }
    PlayerCard("Mijn scherm thuis") {
        Text("Kies welke eigen sessie je thuisscherm volgt. Een leeg scherm blijft klaarstaan.", color = PlayerMuted)
        Choice("Sessie op mijn thuisscherm", context.text("selectedHomeSessionId"), listOf("" to "Wachtscherm · geen sessie") + context.rows("homeSessions").map { it.text("id") to it.text("name") }, { actions.command("/oche/v1/home-session", json("sourceId" to it.ifBlank { null })) }, !state.busy)
    }
    val devices = state.resource.rows("devices").ifEmpty { context.rows("devices") }
    devices.forEach { device ->
        var revoke by remember(device.text("id")) { mutableStateOf(false) }
        var newName by remember(device.text("id"), device.text("name")) { mutableStateOf(device.text("name")) }
        PlayerCard(device.text("name")) {
            Text(if (device.optBoolean("revoked")) "Ontkoppeld" else if (device.optBoolean("online")) "Verbonden" else "Offline", color = PlayerLime)
            Text(if (device.text("scope") == "home") "Eigen geselecteerde sessie" else device.text("boardName", "Geen baan toegewezen"), color = PlayerMuted)
            if (!device.optBoolean("revoked")) {
                Field("Schermnaam", newName, { newName = it }, !state.busy, max = 80)
                PlayerDeviceThemeChoice(device, locations, state, actions)
                Action("Naam opslaan", !state.busy && newName.isNotBlank() && newName.trim() != device.text("name"), false) { actions.command("/oche/v1/devices/${device.text("id")}", json("action" to "rename", "name" to newName.trim())) }
                if (device.text("scope") == "location") Choice("Toegewezen baan", device.text("boardId"), listOf("" to "Geen baan") + (locations.find { it.text("locationId") == device.text("locationId") }?.rows("boards") ?: emptyList()).map { it.text("id") to it.text("name") }, { actions.command("/oche/v1/devices/${device.text("id")}", json("action" to "assign", "boardId" to it.ifBlank { null })) }, !state.busy)
            }
            if (!device.optBoolean("revoked")) Action("Ontkoppelen", !state.busy, false) { revoke = true }
        }
        if (revoke) AlertDialog(onDismissRequest = { revoke = false }, title = { Text("${device.text("name")} ontkoppelen?") }, text = { Text("Dit scherm verliest direct de toegang. Je kunt het daarna opnieuw met een code koppelen.") }, confirmButton = { TextButton(onClick = { actions.command("/oche/v1/devices/${device.text("id")}", json("action" to "revoke")); revoke = false }) { Text("Ontkoppelen") } }, dismissButton = { TextButton(onClick = { revoke = false }) { Text("Annuleren") } })
    }
    state.resource.rows("boards").filter { it.optBoolean("canManage") }.forEach { b -> PlayerCard(b.text("name")) {
        Text(b.text("locationName"), color = PlayerMuted)
        Text(if (b.optBoolean("occupied")) "Actieve wedstrijd" else "Baan vrij", color = PlayerLime)
        Choice("Rotatie", b.text("rotation", "90"), listOf("90" to "90° rechtsom · Chromecast", "0" to "0° · staand signaal", "270" to "270° linksom"), { actions.command("/boards/${b.text("id")}/screen-preferences", json("rotation" to it.toInt())) }, !state.busy)
        Action("Open spelersbaan", primary = false) { actions.navigate(PlayerScreen.BOARD, b.text("id")) }
    } }
}

@Composable private fun AroundTrainingScreen(state: PlayerUiState, entity: JSONObject, actions: PlayerActions) {
    val data = entity.obj("state"); val rounds = data.optJSONArray("rounds") ?: JSONArray(); val done = data.optBoolean("completed")
    Column(Modifier.fillMaxSize().background(PlayerInk).safeDrawingPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth()) { TextButton(onClick = { actions.navigate(PlayerScreen.TRAINING, null) }) { Text("‹ Trainingen") } }
        Heading(entity.text("name", "Dubbels trainen"), "DRIE DARTS PER DOEL")
        if (state.error != null) Notice(state.error, true, actions.retry)
        Spacer(Modifier.weight(1f))
        Text(if (done) "✓" else if (rounds.length() == 20) "BULL" else "D${rounds.length() + 1}", fontFamily = PlayerBarlow, fontSize = 100.sp, color = PlayerLime)
        Text(if (done) "Training afgerond" else "Hoeveel darts raakten de dubbel?", color = PlayerMuted)
        Text("${rounds.length()} / 21 doelen · ${rounds.ints().sum()} treffers", color = PlayerMuted)
        Spacer(Modifier.weight(1f))
        if (!done) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { (0..3).forEach { hits -> Action("$hits", !state.busy && state.online, modifier = Modifier.weight(1f).height(64.dp)) { entityCommand(actions, entity, json("type" to "training.score", "id" to entity.text("id"), "hits" to hits, "darts" to 3)) } } }
        Action("Laatste doel terug", !state.busy && rounds.length() > 0, false) { entityCommand(actions, entity, json("type" to "training.undo", "id" to entity.text("id"))) }
        Action(if (done) "Naar trainingen" else "Training bewaren en beëindigen", !state.busy, false, Modifier.fillMaxWidth()) { if (done) actions.navigate(PlayerScreen.TRAINING, null) else entityCommand(actions, entity, json("type" to "training.finish", "id" to entity.text("id"))) }
    }
}

internal fun updatedQuery(value: String?, key: String, replacement: String): String {
    val original = runCatching { PlayerLinks.query(java.net.URI("https://native.invalid/?${value.orEmpty()}")) }.getOrDefault(emptyMap()).toMutableMap()
    original[key] = replacement
    return original.entries.joinToString("&") { "${PlayerLinks.encode(it.key)}=${PlayerLinks.encode(it.value)}" }
}
