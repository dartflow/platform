package nl.dartflow.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.net.URI
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

/** Native screen state. The server remains the only scoring/authorization authority. */
class PlayerViewModel(application: Application) : AndroidViewModel(application) {
    private val store = PlayerSessionStore(application)
    val api = PlayerApi()
    private val state = MutableStateFlow(PlayerUiState())
    val ui = state.asStateFlow()
    private var saved = store.read()
    private val refreshLock = Mutex()
    private val commandLock = Mutex()
    private var loop: Job? = null
    private var foreground = false
    private var ready = false
    private var auth: JSONObject = JSONObject()
    @Volatile private var identityGeneration = 0
    private var pending: NativePlayerCommand? = null
    private var pendingDestination: PlayerDestination? = null
    private var identityPoll = 0
    init {
        api.identityProvider = { requestIdentity() }
        api.bearerProvider = { identity -> accessToken(identity) }
        api.unauthorized = unauthorized@ { original ->
            if (requestIdentity() != original.identity) throw playerSessionChanged()
            // Another request may already have refreshed this same login. Reuse it rather
            // than rotating the token family a second time for an older access token.
            if (saved.optString("accessToken") != original.token) return@unauthorized
            if (saved.optBoolean("local") || saved.optString("refreshToken").isBlank()) {
                clearSession(); throw PlayerApiFailure(401, "session_expired", "Je sessie is verlopen. Log opnieuw in.")
            }
            saved.put("expiresAt", 0); accessToken(original.identity)
        }
    }

    fun resume() {
        foreground = true
        if (loop?.isActive == true) return
        loop = viewModelScope.launch {
            while (foreground) {
                try {
                    if (!ready) initialize() else if (hasSession() && !state.value.busy) {
                        if (state.value.profile == null || state.value.screen in listOf(PlayerScreen.HOME, PlayerScreen.NOTIFICATIONS, PlayerScreen.PROFILE) && identityPoll++ % 3 == 0) {
                            loadIdentity(); loadCommon()
                        }
                        loadCurrent()
                    }
                    state.update { it.copy(online = true, loading = false) }
                    delay(state.value.capabilities.optLong("pollAfterMs", 2000).coerceIn(1500, 15_000))
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) {
                    handleFailure(failure, polling = ready)
                    delay(if (failure is PlayerApiFailure) maxOf(3000L, failure.retryAfterMs) else 3000)
                }
            }
        }
    }
    fun pause() { foreground = false; loop?.cancel(); loop = null }
    private suspend fun initialize() {
        val capabilities = api.call("/capabilities", anonymous = true)
        require(capabilities.optInt("apiVersion") == 1) { "Deze app heeft een update nodig." }
        require(capabilitiesMatch(capabilities, api.origin, BuildConfig.LOCAL_FIXTURES, BuildConfig.AUTH_SCHEME)) { "De serveromgeving komt niet overeen met deze app." }
        auth = capabilities.optJSONObject("auth") ?: JSONObject()
        val localUsers = if (BuildConfig.LOCAL_FIXTURES && capabilities.optBoolean("local")) capabilities.optJSONArray("localUsers").objects().map(PlayerProfile::parse) else emptyList()
        state.update { it.copy(capabilities = capabilities, localUsers = localUsers) }
        if (hasSession()) {
            loadIdentity()
            restorePendingCommand()
            loadCommon()
            restoreDestination()
            loadCurrent()
        }
        ready = true
        state.update { it.copy(loading = false) }
    }
    private fun hasSession(): Boolean = saved.optString("accessToken").isNotBlank()
    private fun requestIdentity(): PlayerRequestIdentity? = if (hasSession()) PlayerRequestIdentity(saved.optString("userId"), identityGeneration) else null
    private fun persist() = store.write(saved)
    private suspend fun accessToken(expectedIdentity: PlayerRequestIdentity? = null): String? = refreshLock.withLock {
        if (expectedIdentity != null && requestIdentity() != expectedIdentity) throw playerSessionChanged()
        if (!hasSession()) return@withLock null
        val generation = identityGeneration
        if (saved.optLong("expiresAt") <= api.serverNow() + 60_000) {
            if (saved.optBoolean("local") || saved.optString("refreshToken").isBlank()) {
                clearSession(); throw PlayerApiFailure(401, "session_expired", "Je sessie is verlopen. Log opnieuw in.")
            }
            try {
                val result = api.authCall(auth, "/token?grant_type=refresh_token", JSONObject().put("refresh_token", saved.getString("refreshToken")))
                if (generation != identityGeneration) throw PlayerApiFailure(409, "session_changed", "Je account is gewijzigd. Open de actuele gegevens opnieuw.")
                saveAuthSession(result)
            } catch (failure: PlayerApiFailure) {
                if (failure.status in listOf(400, 401, 403) && generation == identityGeneration) {
                    clearSession()
                    throw PlayerApiFailure(401, "session_expired", "Je sessie is verlopen. Log opnieuw in.")
                }
                throw failure
            }
        }
        saved.optString("accessToken").takeIf(String::isNotBlank)
    }
    private fun saveAuthSession(result: JSONObject) {
        val token = result.optString("access_token")
        val refresh = result.optString("refresh_token")
        require(token.isNotBlank() && refresh.isNotBlank()) { "Inloggen leverde geen geldige sessie op." }
        val incomingUser = result.optJSONObject("user")
        val incomingId = incomingUser?.optString("id").orEmpty()
        if (saved.optString("userId").isNotBlank() && incomingId.isNotBlank() && incomingId != saved.optString("userId")) {
            identityGeneration++; pending = null; saved.remove("pendingCommand")
            state.update { it.copy(profile = null, platform = JSONObject(), overview = JSONObject(), resource = JSONObject(), match = null, board = null, screen = PlayerScreen.HOME, activeId = null, hasPendingCommand = false, loading = true) }
        }
        saved.put("accessToken", token).put("refreshToken", refresh).put("local", false)
            .put("expiresAt", if (result.optLong("expires_at") > 0) result.getLong("expires_at") * 1000 else api.serverNow() + result.optLong("expires_in", 3600) * 1000)
        incomingUser?.let { saved.put("userId", it.optString("id")).put("email", it.optString("email")) }
        persist()
        state.update { it.copy(session = sessionMetadata(), pendingEmail = null) }
    }
    private fun sessionMetadata() = PlayerSession(saved.optString("userId"), saved.optString("email"), saved.optLong("expiresAt"), saved.optBoolean("local"))
    private suspend fun loadIdentity() {
        val generation = identityGeneration
        val result = api.call("/session")
        if (generation != identityGeneration || !hasSession()) return
        val profile = result.optJSONObject("user")?.let(PlayerProfile::parse)
        profile?.let { saved.put("userId", it.id); persist() }
        state.update { it.copy(profile = profile, session = sessionMetadata()) }
    }
    private suspend fun loadCommon() {
        val generation = identityGeneration
        val overview = api.call("/overview")
        if (generation != identityGeneration || !hasSession()) return
        val platform = api.call("/platform")
        if (generation != identityGeneration || !hasSession()) return
        state.update { it.copy(overview = overview, platform = platform, profile = platform.optJSONObject("profile")?.let(PlayerProfile::parse) ?: it.profile) }
    }
    private suspend fun loadCurrent() {
        if (!hasSession()) return
        val screen = state.value.screen
        val id = state.value.activeId
        val generation = identityGeneration
        val resource = when (screen) {
            PlayerScreen.HOME, PlayerScreen.BOARDS, PlayerScreen.NOTIFICATIONS -> api.call("/player-experience")
            PlayerScreen.SCREENS -> {
                val experience = api.call("/player-experience")
                val context = api.call("/oche/v1/context")
                val devices = api.call("/oche/v1/devices")
                JSONObject(experience.toString()).put("context", context).put("oche", context).put("devices", devices.optJSONArray("devices"))
            }
            PlayerScreen.PROFILE -> api.call("/profile")
            PlayerScreen.STATISTICS, PlayerScreen.HISTORY -> api.call("/player-statistics" + statisticsQuery(id))
            PlayerScreen.BOARD -> id?.let { api.call("/boards/${PlayerLinks.encode(it)}") } ?: JSONObject()
            PlayerScreen.MATCH -> id?.let {
                val match = api.call("/matches/${PlayerLinks.encode(it)}")
                val invitation = runCatching { api.call("/matches/${PlayerLinks.encode(it)}/invitation") }.getOrNull()
                if (invitation != null) match.put("invitation", invitation.opt("invitation"))
                match
            } ?: JSONObject()
            PlayerScreen.FEED -> api.call("/community/feed" + feedQuery(id))
            PlayerScreen.CHAT -> {
                val parts = id.orEmpty().split(':', limit = 2)
                if (parts.size == 2 && parts[0] == "room") api.call("/platform/rooms/${PlayerLinks.encode(parts[1])}/messages")
                else if (parts.size == 2) api.call("/community/chat/${PlayerLinks.encode(parts[0])}/${PlayerLinks.encode(parts[1])}") else JSONObject()
            }
            PlayerScreen.SEASONS -> api.call("/seasons")
            PlayerScreen.SEASON -> id?.let { api.call("/seasons/${PlayerLinks.encode(it)}") } ?: JSONObject()
            else -> {
                val platform = api.call("/platform")
                if (generation == identityGeneration) state.update { it.copy(platform = platform) }
                if (screen in listOf(PlayerScreen.LOBBY, PlayerScreen.TRAINING, PlayerScreen.EVENT)) {
                    JSONObject().put("entity", listOf("lobbies", "trainings", "leagues", "tournaments", "clubs", "rooms").asSequence()
                        .flatMap { platform.optJSONArray(it).objects().asSequence() }.firstOrNull { it.optString("id") == id } ?: JSONObject())
                } else platform
            }
        }
        if (generation != identityGeneration || screen != state.value.screen || id != state.value.activeId) return
        state.update { current -> current.copy(resource = resource, loading = false, online = true,
            match = if (screen == PlayerScreen.MATCH && resource.length() > 0) PlayerMatch.parse(resource) else if (screen == PlayerScreen.MATCH) null else current.match,
            board = if (screen == PlayerScreen.BOARD) resource else current.board,
            profile = if (screen == PlayerScreen.PROFILE) resource.optJSONObject("user")?.let(PlayerProfile::parse) ?: current.profile else current.profile,
        ) }
    }
    fun navigate(screen: PlayerScreen, id: String? = null) {
        state.update { it.copy(screen = screen, activeId = id, resource = JSONObject(), match = if (screen == PlayerScreen.MATCH) null else it.match, loading = hasSession(), error = null, notice = null) }
        if (hasSession()) launchTask(showBusy = false) { loadCurrent() }
    }
    fun refresh() = launchTask(showBusy = false) { if (!ready) initialize() else if (hasSession()) { loadIdentity(); loadCommon(); loadCurrent() } }
    fun dismissMessage() { state.update { it.copy(error = null, notice = null) } }
    fun reportError(message: String) { state.update { it.copy(error = message.take(300)) } }
    fun consumeGoogleUrl() { state.update { it.copy(googleUrl = null) } }
    fun requestOtp(email: String) = launchTask {
        val clean = email.trim()
        require(clean.length in 3..254 && clean.matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))) { "Vul een geldig e-mailadres in." }
        if (!ready) initialize()
        api.authCall(auth, "/otp", JSONObject().put("email", clean).put("create_user", true))
        state.update { it.copy(pendingEmail = clean, notice = "Je inlogcode is verstuurd. Controleer je e-mail.") }
    }
    fun verifyOtp(code: String) = launchTask {
        val generation = identityGeneration
        val email = state.value.pendingEmail ?: throw IllegalArgumentException("Vraag eerst een inlogcode aan.")
        require(PlayerValidation.validOtp(code, auth.optInt("otpLengthMin", 6), auth.optInt("otpLengthMax", 10))) { "Vul de volledige code uit je e-mail in." }
        val result = api.authCall(auth, "/verify", JSONObject().put("email", email).put("token", code).put("type", "email"))
        check(generation == identityGeneration) { "Je account is gewijzigd. Vraag een nieuwe inlogcode aan." }
        saveAuthSession(result); signedIn()
    }
    fun startGoogle() = launchTask {
        if (!ready) initialize()
        val pkce = PlayerPkce.create(api.serverNow())
        require(auth.optString("redirectScheme") == BuildConfig.AUTH_SCHEME) { "De inlogomgeving komt niet overeen met deze app." }
        saved.put("pkce", JSONObject().put("verifier", pkce.verifier).put("state", pkce.state).put("createdAt", pkce.createdAt)); persist()
        val url = PlayerLinks.googleUrl(auth.getString("url"), auth.getString("callbackUrl"), pkce)
        state.update { it.copy(googleUrl = url) }
    }
    fun handleDeepLink(value: String) {
        if (runCatching { URI(value).scheme == BuildConfig.AUTH_SCHEME }.getOrDefault(false)) {
            launchTask {
                if (!ready) initialize()
                val pkce = saved.optJSONObject("pkce")?.let { PlayerPkce(it.optString("verifier"), it.optString("state"), it.optLong("createdAt")) }
                val callback = PlayerLinks.callback(value, BuildConfig.AUTH_SCHEME, pkce, api.serverNow())
                    ?: throw IllegalArgumentException("Deze inlogpoging is ongeldig of verlopen. Start het inloggen opnieuw.")
                // A callback can be exchanged once; PKCE makes a stolen custom-scheme code unusable.
                saved.remove("pkce"); persist()
                val generation = identityGeneration
                val result = api.authCall(auth, "/token?grant_type=pkce", JSONObject().put("auth_code", callback.code).put("code_verifier", pkce!!.verifier))
                check(generation == identityGeneration) { "Je account is gewijzigd. Start het inloggen opnieuw." }
                saveAuthSession(result); signedIn()
            }
            return
        }
        val destination = PlayerLinks.destination(value, api.origin)
        if (destination == null) { state.update { it.copy(error = "Deze link hoort niet bij deze DartFlow-omgeving.") }; return }
        pendingDestination = destination
        // Persist only the safe route identity so login/process recreation returns to the requested board.
        saved.put("destination", JSONObject().put("screen", destination.screen.name).put("id", destination.id).put("code", destination.invitationCode)); persist()
        if (hasSession()) launchTask { restoreDestination(); loadCurrent() }
        else state.update { it.copy(notice = "Log in om deze baan of wedstrijd te openen.") }
    }
    private suspend fun restoreDestination() {
        val destination = pendingDestination ?: saved.optJSONObject("destination")?.let { item ->
            runCatching { PlayerDestination(PlayerScreen.valueOf(item.getString("screen")), item.optString("id").takeIf { it.isNotBlank() && it != "null" }, item.optString("code").takeIf { it.isNotBlank() && it != "null" }) }.getOrNull()
        } ?: return
        if (destination.invitationCode != null) {
            val result = execute(NativePlayerCommand.create("/platform/actions", JSONObject().put("action", JSONObject().put("type", "invitation.resolve").put("code", destination.invitationCode))))
            val screen = if (result.optString("kind") == "lobby") PlayerScreen.LOBBY else PlayerScreen.EVENT
            state.update { it.copy(screen = screen, activeId = result.optString("id"), resource = JSONObject()) }
        } else state.update { it.copy(screen = destination.screen, activeId = destination.id, resource = JSONObject()) }
        pendingDestination = null; saved.remove("destination"); persist()
    }
    private suspend fun signedIn() {
        identityGeneration++
        loadIdentity(); loadCommon(); restoreDestination(); loadCurrent()
        state.update { it.copy(online = true, loading = false, notice = "Je bent ingelogd.") }
    }
    fun localLogin(id: String) = launchTask {
        require(BuildConfig.LOCAL_FIXTURES && state.value.capabilities.optBoolean("local") && state.value.localUsers.any { it.id == id }) { "Lokale testlogin is hier niet beschikbaar." }
        val result = api.call("/auth/local", JSONObject().put("userId", id), anonymous = true)
        val expires = when (val value = result.opt("expiresAt")) { is Number -> value.toLong(); is String -> runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(0); else -> 0 }
        require(result.optString("accessToken").isNotBlank() && expires > api.serverNow())
        saved = JSONObject().put("accessToken", result.getString("accessToken")).put("expiresAt", expires).put("local", true).put("userId", id)
        persist(); signedIn()
    }
    fun signOut() = launchTask {
        val token = saved.optString("accessToken")
        val local = saved.optBoolean("local")
        clearSession()
        if (!local && token.isNotBlank()) runCatching { api.authCall(auth, "/logout?scope=local", token = token) }
    }
    private fun clearSession() {
        identityGeneration++; pending = null; pendingDestination = null; saved = JSONObject(); store.clear()
        state.update { PlayerUiState(loading = false, capabilities = it.capabilities, localUsers = it.localUsers) }
    }
    fun completeProfile(username: String, displayName: String, pin: String, confirm: String) {
        if (!PlayerValidation.validUsername(username) || !PlayerValidation.validName(displayName)) { state.update { it.copy(error = "Vul een geldige gebruikersnaam en weergavenaam in.") }; return }
        if (!state.value.profile.let { it?.pinConfigured == true } || pin.isNotBlank() || confirm.isNotBlank()) {
            if (!PlayerValidation.validPin(pin) || pin != confirm) { state.update { it.copy(error = "Gebruik zes cijfers en herhaal dezelfde spelerspincode.") }; return }
        }
        val body = JSONObject().put("username", PlayerValidation.normalizeUsername(username)).put("displayName", PlayerValidation.normalizeName(displayName))
        if (pin.isNotBlank()) body.put("pin", pin).put("pinConfirmation", confirm)
        command("/profile/complete", body)
    }
    fun changePin(current: String, pin: String, confirm: String) {
        if (!PlayerValidation.validPin(pin) || pin != confirm || (state.value.profile?.pinConfigured == true && !PlayerValidation.validPin(current))) {
            state.update { it.copy(error = "Gebruik zes cijfers en controleer de huidige en herhaalde spelerspincode.") }; return
        }
        command("/profile/player-pin", JSONObject().put("mode", if (state.value.profile?.pinConfigured == true) "change" else "initial").put("currentPin", current).put("pin", pin).put("pinConfirmation", confirm))
    }
    fun command(path: String, body: JSONObject) = launchTask {
        commandLock.withLock {
            check(pending == null) { "Controleer eerst de uitkomst van je vorige actie via Opnieuw proberen." }
            val command = NativePlayerCommand.create(path, body)
            val generation = identityGeneration
            // PIN-bearing commands are retried once in memory with the same identity, never retained.
            val sensitive = command.sensitive
            if (!sensitive) savePendingCommand(command)
            try {
                val result = execute(command)
                clearPendingCommand()
                afterCommand(path, body, result, generation)
            } catch (failure: Exception) {
                if (failure is PlayerApiFailure && failure.status in 400..499) clearPendingCommand()
                throw failure
            }
        }
    }
    fun platformAction(action: JSONObject, expectedRevision: Int? = null) {
        val body = JSONObject().put("action", action)
        expectedRevision?.let { body.put("expectedRevision", it) }
        command("/platform/actions", body)
    }
    fun matchAction(type: String, extra: JSONObject = JSONObject()) {
        val match = state.value.match ?: return
        command("/matches/${match.id}/actions", JSONObject().put("matchId", match.id).put("expectedRevision", match.revision).put("action", JSONObject(extra.toString()).put("type", type)))
    }
    fun score(score: Int, darts: Int = 3, doubleConfirmed: Boolean = false, doubleAttempts: Int? = null) {
        if (score !in 0..180 || darts !in 1..3) { state.update { it.copy(error = "Gebruik een worp van 0–180 en één tot drie darts.") }; return }
        val fields = JSONObject().put("score", score).put("darts", darts).put("doubleConfirmed", doubleConfirmed)
        doubleAttempts?.let { fields.put("doubleAttempts", it) }
        matchAction("score", fields)
    }
    fun retryPendingCommand() = launchTask {
        commandLock.withLock {
            val command = pending ?: return@withLock
            val generation = identityGeneration
            try {
                val result = execute(command)
                clearPendingCommand()
                afterCommand(command.path, command.body, result, generation)
            } catch (failure: PlayerApiFailure) {
                if (failure.status in 400..499) clearPendingCommand()
                throw failure
            }
        }
    }
    private fun savePendingCommand(command: NativePlayerCommand) {
        check(!command.sensitive)
        saved.put("pendingCommand", command.forStorage(saved.optString("userId"), api.origin))
        persist(); pending = command
        state.update { it.copy(hasPendingCommand = true) }
    }
    private fun clearPendingCommand() {
        pending = null; saved.remove("pendingCommand"); persist()
        state.update { it.copy(hasPendingCommand = false) }
    }
    private fun restorePendingCommand() {
        val restored = saved.optJSONObject("pendingCommand")?.let { NativePlayerCommand.restore(it, saved.optString("userId"), api.origin) }
        pending = restored
        if (restored == null) { saved.remove("pendingCommand"); persist() }
        state.update { it.copy(hasPendingCommand = restored != null, notice = if (restored != null) "Een eerdere actie heeft nog geen bevestigde uitkomst. Controleer deze met Opnieuw proberen." else it.notice) }
    }
    private suspend fun execute(command: NativePlayerCommand): JSONObject {
        val generation = identityGeneration
        var firstFailure: Exception? = null
        repeat(2) { attempt ->
            check(generation == identityGeneration && hasSession()) { "Log opnieuw in voordat je deze actie uitvoert." }
            try {
                val result = api.call(command.path, command.body)
                check(generation == identityGeneration && hasSession()) { "Je account is gewijzigd. Open de actuele gegevens opnieuw." }
                return result
            }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: PlayerApiFailure) {
                if (generation != identityGeneration) throw playerSessionChanged()
                if (failure.status == 401 && saved.optString("refreshToken").isNotBlank() && attempt == 0) {
                    saved.put("expiresAt", 0); accessToken(requestIdentity())
                } else if (failure.status in 500..599 && attempt == 0) { firstFailure = failure; delay(600) }
                else throw failure
            } catch (failure: java.io.IOException) { if (attempt == 1) throw failure else { firstFailure = failure; delay(600) } }
        }
        throw firstFailure ?: IllegalStateException("Deze actie kon niet worden bevestigd.")
    }
    private suspend fun afterCommand(path: String, input: JSONObject, result: JSONObject, generation: Int) {
        if (generation != identityGeneration || !hasSession()) return
        if (path.startsWith("/profile")) loadIdentity()
        if (generation != identityGeneration || !hasSession()) return
        loadCommon()
        if (generation != identityGeneration || !hasSession()) return
        val action = input.optJSONObject("action")?.optString("type").orEmpty()
        val matchId = result.optString("matchId").takeIf { it.isNotBlank() }
        val id = result.optString("id").takeIf { it.isNotBlank() }
        when {
            matchId != null && action in listOf("lobby.start", "board.start", "fixture.start", "reservation.fixture.start") -> state.update { it.copy(screen = PlayerScreen.MATCH, activeId = matchId) }
            id != null && (action == "training.create" || action == "board.start" && result.optString("kind") == "training") -> state.update { it.copy(screen = PlayerScreen.TRAINING, activeId = id) }
            id != null && action in listOf("lobby.create", "board.start", "lobby.join") -> state.update { it.copy(screen = PlayerScreen.LOBBY, activeId = id) }
            id != null && action == "invitation.resolve" -> state.update { it.copy(screen = if (result.optString("kind") == "lobby") PlayerScreen.LOBBY else PlayerScreen.EVENT, activeId = id) }
        }
        loadCurrent()
        if (generation != identityGeneration || !hasSession()) return
        state.update { it.copy(notice = "Opgeslagen.", error = null, online = true) }
    }
    private fun launchTask(showBusy: Boolean = true, task: suspend () -> Unit) {
        viewModelScope.launch {
            if (showBusy && state.value.busy) return@launch
            if (showBusy) state.update { it.copy(busy = true, error = null, notice = null) }
            try { task() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { handleFailure(failure) }
            finally { state.update { it.copy(busy = false, loading = false) } }
        }
    }
    private fun handleFailure(failure: Exception, polling: Boolean = false) {
        // Discard work from a previous login without changing the new login's feedback/state.
        if (failure is PlayerApiFailure && failure.code == "session_changed") return
        val message = when (failure) {
            is PlayerApiFailure -> failure.feedback
            is IllegalArgumentException, is IllegalStateException -> failure.message?.takeIf { it.length in 1..200 } ?: "Controleer je invoer en probeer opnieuw."
            else -> "Geen verbinding. De laatst ontvangen gegevens blijven staan. Probeer opnieuw."
        }
        state.update { it.copy(loading = false, online = failure !is java.io.IOException && (failure !is PlayerApiFailure || failure.status < 500), error = if (polling && it.session != null) it.error else message) }
        if (failure is PlayerApiFailure && failure.status == 409 && hasSession()) viewModelScope.launch { runCatching { loadCurrent() } }
    }
    companion object {
        fun capabilitiesMatch(value: JSONObject, origin: String, localFixtures: Boolean, scheme: String): Boolean = runCatching {
            val configured = URI(origin)
            val advertised = URI(value.getString("origin"))
            val local = value.optBoolean("local")
            val sameOrigin = configured.scheme == advertised.scheme && configured.host == advertised.host && configured.port == advertised.port
            val loopbackPair = localFixtures && local && configured.scheme == "http" && advertised.scheme == "http" && configured.host in listOf("127.0.0.1", "localhost") && advertised.host in listOf("127.0.0.1", "localhost") && configured.port == advertised.port
            (!local || localFixtures) && (sameOrigin || loopbackPair) && value.optJSONObject("auth")?.optString("redirectScheme") == scheme
        }.getOrDefault(false)
        /** UI can select a statistics filter/page by navigating with a query as activeId. */
        fun statisticsQuery(value: String?): String {
            if (value.isNullOrBlank()) return ""
            val allowed = setOf("startScore", "offset", "opponent", "search", "opponentOffset", "practiceOffset")
            val normalized = if (!value.contains('=') && value.substringBefore(':') in allowed) value.substringBefore(':') + "=" + PlayerLinks.encode(value.substringAfter(':')) else value.removePrefix("?")
            val query = runCatching { PlayerLinks.query(URI("https://native.invalid/?$normalized")) }.getOrDefault(emptyMap())
            val safe = query.filter { (key, input) -> key in allowed && input.length <= 100 && when (key) {
                "startScore" -> input in listOf("301", "501", "701")
                "offset", "opponentOffset", "practiceOffset" -> input.toIntOrNull()?.let { it in 0..100_000 } == true
                "opponent" -> Regex("[A-Za-z0-9-]{1,64}").matches(input)
                else -> !input.any { it.code < 32 }
            } }
            return safe.entries.joinToString("&", prefix = if (safe.isEmpty()) "" else "?") { "${it.key}=${PlayerLinks.encode(it.value)}" }
        }
        fun feedQuery(value: String?): String {
            if (value.isNullOrBlank()) return ""
            val query = if (value.startsWith("cursor:")) mapOf("cursor" to value.removePrefix("cursor:")) else runCatching { PlayerLinks.query(URI("https://native.invalid/?${value.removePrefix("?")}")) }.getOrDefault(emptyMap())
            val safe = query.filter { (key, input) -> key in setOf("kind", "id", "cursor", "parentId") && input.length <= 1024 && !input.any { it.code < 32 } }
            return safe.entries.joinToString("&", prefix = if (safe.isEmpty()) "" else "?") { "${it.key}=${PlayerLinks.encode(it.value)}" }
        }
    }
}

/** Stable operation identity survives all automatic/manual retries in the current app process.
 * Never queue a new score while the previous outcome is uncertain. No optimistic score mutation. */
class NativePlayerCommand private constructor(val path: String, val body: JSONObject) {
    val requestId: String get() = body.getString("requestId")
    val sensitive: Boolean get() = path.startsWith("/profile") || path.contains("player-pin") || containsSecret(body)
    override fun toString() = "NativePlayerCommand(path=$path, requestId=$requestId, body=[redacted])"
    fun forStorage(userId: String, origin: String): JSONObject {
        check(!sensitive)
        return JSONObject().put("userId", userId).put("origin", origin).put("path", path).put("body", body)
    }
    companion object {
        private fun containsSecret(value: Any?): Boolean = when (value) {
            is JSONObject -> value.keys().asSequence().any { key -> key.lowercase() in setOf("pin", "pinconfirmation", "currentpin", "password", "accesstoken", "refreshtoken", "code_verifier", "authorization") || containsSecret(value.opt(key)) }
            is org.json.JSONArray -> (0 until value.length()).any { containsSecret(value.opt(it)) }
            else -> false
        }
        fun create(path: String, body: JSONObject): NativePlayerCommand {
            val copy = JSONObject(body.toString())
            if (copy.optString("requestId").isBlank()) copy.put("requestId", UUID.randomUUID().toString())
            return NativePlayerCommand(path, copy)
        }
        fun restore(value: JSONObject, userId: String, origin: String): NativePlayerCommand? = runCatching {
            require(value.optString("userId") == userId && userId.isNotBlank() && value.optString("origin") == origin)
            val path = value.getString("path")
            require(path.startsWith('/') && !path.contains("..") && !path.contains("://"))
            val body = value.getJSONObject("body")
            require(body.optString("requestId").isNotBlank())
            create(path, body).also { require(!it.sensitive) }
        }.getOrNull()
    }
}
