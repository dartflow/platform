package nl.dartflow.app

import android.app.Application
import android.os.SystemClock
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
    private val notificationOpenStore = PlayerSessionStore(application, "notification-open")
    private val helpCache = PlayerHelpCache(application)
    private val manualCache = PlayerManualCache(application)
    val api = PlayerApi()
    private val state = MutableStateFlow(PlayerUiState())
    val ui = state.asStateFlow()
    private var saved = store.read()
    private val matchQueue = PlayerMatchQueue(application, api, { saved.text("userId").takeIf { hasSession() } }) { match, count, message ->
        if (state.value.screen == PlayerScreen.MATCH && state.value.activeId == match.id) state.update { it.copy(match = match, resource = match.raw, pendingMatchVisits = count, error = message ?: it.error, loading = false) }
    }
    private val trainingQueue=PlayerTrainingQueue(application,api,{saved.text("userId").takeIf{hasSession()}}){entity,count,message->
        if(state.value.screen==PlayerScreen.TRAINING&&state.value.activeId==entity.text("id"))state.update{current->
            val platform=JSONObject(current.platform.toString());platform.put("trainings",org.json.JSONArray(current.platform.rows("trainings").filter{it.text("id")!=entity.text("id")}+entity))
            current.copy(resource=json("entity" to entity),platform=platform,pendingTrainingVisits=count,error=message?:current.error,loading=false)
        }
    }
    private val play = PlayerPlayCoordinator(application, api, { saved.text("userId").takeIf { hasSession() } }, update = { value -> state.update { it.copy(play = value, loading = false) } })
    private val refreshLock = PlayerAuthCoordinator.refresh
    private val commandLock = Mutex()
    private val snapshots = PlayerSnapshotGate()
    private val homeReads = PlayerHomeReads()
    private val homePolls = PlayerHomePolls()
    private var loop: Job? = null
    private var foreground = false
    private var ready = false
    private var auth: JSONObject = JSONObject()
    @Volatile private var identityGeneration = 0
    private var pending: NativePlayerCommand? = null
    private var pendingDestination: PlayerDestination? = null
    private var pendingPushId: String? = null
    private var identityPoll = 0
    private val navigation = ArrayDeque<PlayerDestination>()
    init {
        if (hasSession()) {
            val destination = saved.obj("navigation").obj("active"); val cachedProfile = saved.optJSONObject("cachedProfile")?.let(PlayerProfile::parse)
            state.update { it.copy(session = sessionMetadata(), profile = cachedProfile) }
            if (destination.text("screen") == "MATCH") { val id = destination.text("id"); state.update { it.copy(screen = PlayerScreen.MATCH, activeId = id) }; matchQueue.restore(id) }
        }
        play.lastId()?.let { id -> runCatching { play.restore(id); state.update { it.copy(screen = PlayerScreen.PLAY_SESSION, activeId = id, loading = false) } } }
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
        homePolls.reset()
        loop = viewModelScope.launch {
            while (foreground) {
                val ticket = snapshots.capture()
                try {
                    if (state.value.screen in listOf(PlayerScreen.HELP,PlayerScreen.MANUAL)) { loadCurrent() } else if (state.value.screen in playerPublicPlayScreens) {
                        if (!ready) runCatching { initialize() }
                        play.load(state.value.screen, state.value.activeId)
                    } else if (!ready) initialize() else if (hasSession() && !state.value.busy && homePolls.due(state.value.screen, SystemClock.elapsedRealtime())) {
                        if (state.value.profile == null || state.value.screen in listOf(PlayerScreen.HOME, PlayerScreen.NOTIFICATIONS, PlayerScreen.PROFILE) && identityPoll++ % 3 == 0) {
                            loadIdentity(); loadCommon()
                        }
                        loadCurrent()
                    }
                    delay(state.value.capabilities.optLong("pollAfterMs", 2000).coerceIn(1500, 15_000))
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) {
                    // A read started before an accepted command must not replace its
                    // connection/error feedback either, even when that older read fails.
                    if (!snapshots.accepts(ticket)) continue
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
            navigation.clear()
            saved.obj("navigation").rows("history").takeLast(30).forEach { value -> storedDestination(value)?.let { navigation.addLast(it) } }
            loadCommon()
            restoreDestination()
            loadCurrent()
        }
        ready = true
        state.update { it.copy(online = true, loading = false) }
    }
    private fun hasSession(): Boolean = saved.optString("accessToken").isNotBlank()
    private fun requestIdentity(): PlayerRequestIdentity? = if (hasSession()) PlayerRequestIdentity(saved.optString("userId"), identityGeneration) else null
    private fun persist() = store.write(saved)
    private suspend fun accessToken(expectedIdentity: PlayerRequestIdentity? = null): String? = refreshLock.withLock {
        if (expectedIdentity != null && requestIdentity() != expectedIdentity) throw playerSessionChanged()
        val latest = store.read()
        if (latest.text("userId").isNotBlank() && latest.text("userId") == saved.text("userId") && latest.text("accessToken") != saved.text("accessToken") && latest.optLong("expiresAt") > saved.optLong("expiresAt")) listOf("accessToken", "refreshToken", "expiresAt").forEach { key -> if (latest.has(key)) saved.put(key, latest.get(key)) }
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
        if (incomingId.isBlank() && saved.text("userId").isNotBlank()) PlayerPush.clearLocal(getApplication())
        if (saved.optString("userId").isNotBlank() && incomingId.isNotBlank() && incomingId != saved.optString("userId")) {
            PlayerPush.clearLocal(getApplication())
            identityGeneration++; pending = null; navigation.clear(); saved.remove("pendingCommand"); saved.remove("organizerDraft"); saved.remove("invitation"); saved.remove("navigation")
            state.update { it.copy(profile = null, platform = JSONObject(), overview = JSONObject(), resource = JSONObject(), match = null, board = null, screen = PlayerScreen.HOME, activeId = null, hasPendingCommand = false, loading = true, organizerDraft = JSONObject(), organizerCloudDraft = JSONObject(), faqAdminReceipt = JSONObject(), invitation = JSONObject(), canManagePlatform = false, homeFeed = JSONObject(), homeFeedLoading = false, homeFeedError = null) }
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
        val ticket = snapshots.capture()
        val result = api.call("/session")
        if (generation != identityGeneration || !hasSession() || !snapshots.accepts(ticket)) return
        val profile = result.optJSONObject("user")?.let(PlayerProfile::parse)
        profile?.let { saved.put("userId", it.id).put("cachedProfile", result.optJSONObject("user")); persist() }
        state.update { it.copy(profile = profile, session = sessionMetadata(), canManagePlatform = result.optBoolean("canManagePlatform"), organizerDraft = saved.optJSONObject("organizerDraft") ?: JSONObject(), invitation = saved.optJSONObject("invitation") ?: JSONObject()) }
        profile?.let { runCatching { PlayerPush.sync(getApplication(), api, it.id) } }
        (pendingPushId ?: playerPendingNotification(notificationOpenStore.read(), api.origin))?.let { id -> pendingPushId = null; openPush(id) }
    }
    private suspend fun loadCommon() {
        val generation = identityGeneration
        val ticket = snapshots.capture()
        val overview = api.call("/overview")
        if (generation != identityGeneration || !hasSession() || !snapshots.accepts(ticket)) return
        val platform = api.call("/platform?trainingProjection=compact")
        if (generation != identityGeneration || !hasSession() || !snapshots.accepts(ticket)) return
        val safety = api.call("/safety")
        if (generation != identityGeneration || !hasSession() || !snapshots.accepts(ticket)) return
        state.update { it.copy(overview = overview, platform = platform, safety = safety, profile = platform.optJSONObject("profile")?.let(PlayerProfile::parse) ?: it.profile) }
    }
    private suspend fun loadCurrent() {
        if (state.value.screen in playerPublicPlayScreens) { play.load(state.value.screen, state.value.activeId); return }
        if (!hasSession() && state.value.screen !in listOf(PlayerScreen.HELP,PlayerScreen.MANUAL)) return
        val screen = state.value.screen
        if (screen == PlayerScreen.HOME) {
            loadHome()
            return
        }
        val id = state.value.activeId
        val generation = identityGeneration
        val ticket = snapshots.capture()
        val resource = when (screen) {
            PlayerScreen.BOARDS -> api.call("/player-experience")
            PlayerScreen.NOTIFICATIONS -> api.call("/player-experience").also { it.put("push", api.call("/push").also { push -> if (generation == identityGeneration) PlayerPush.updatePreferences(getApplication(), state.value.profile?.id, push) }) }
            PlayerScreen.SCREENS -> {
                val experience = api.call("/player-experience")
                val context = api.call("/oche/v1/context")
                val devices = api.call("/oche/v1/devices")
                JSONObject(experience.toString()).put("context", context).put("oche", context).put("devices", devices.optJSONArray("devices"))
            }
            PlayerScreen.PROFILE -> {
                val profile = api.call("/profile")
                val deletion = api.call("/account/deletion")
                if (generation == identityGeneration && hasSession()) state.update { it.copy(accountDeletion = deletion) }
                profile
            }
            PlayerScreen.STATISTICS, PlayerScreen.HISTORY -> api.call("/player-statistics" + statisticsQuery(id))
            PlayerScreen.BOARD -> id?.let { api.call("/boards/${PlayerLinks.encode(it)}").also { board -> board.put("competition", api.call("/boards/${PlayerLinks.encode(it)}/competition")) } } ?: JSONObject()
            PlayerScreen.MATCH -> id?.let {
                if (matchQueue.pending(it) > 0) runCatching { matchQueue.sync(it) }
                val match = api.call("/matches/${PlayerLinks.encode(it)}")
                val raw = match.optJSONObject("match") ?: match
                if (raw.text("status") == "confirmed" || raw.has("primaryCorrection")) match.put("corrections", api.call("/matches/${PlayerLinks.encode(it)}/corrections"))
                val invitation = runCatching { api.call("/matches/${PlayerLinks.encode(it)}/invitation") }.getOrNull()
                if (invitation != null) match.put("invitation", invitation.opt("invitation"))
                match
            } ?: JSONObject()
            PlayerScreen.TRAINING -> id?.let { if(trainingQueue.pending(it)>0)runCatching{trainingQueue.sync(it)};api.call("/trainings/${PlayerLinks.encode(it)}") } ?: run {
                val platform = api.call("/platform?trainingProjection=compact")
                if (generation == identityGeneration && snapshots.accepts(ticket)) state.update { it.copy(platform = platform) }
                platform
            }
            PlayerScreen.FEED -> api.call("/community/feed" + feedQuery(id))
            PlayerScreen.CHAT -> {
                val parts = id.orEmpty().split(':', limit = 2)
                if (parts.size == 2 && parts[0] == "room") api.call("/platform/rooms/${PlayerLinks.encode(parts[1])}/messages")
                else if (parts.size == 2) api.call("/community/chat/${PlayerLinks.encode(parts[0])}/${PlayerLinks.encode(parts[1])}") else JSONObject()
            }
            PlayerScreen.LOCATIONS -> api.call("/locations")
            PlayerScreen.FAQ_ADMIN -> api.call("/faq/admin")
            PlayerScreen.ORGANIZE -> api.call("/organizer-drafts?kind=tournament")
            PlayerScreen.RANKING_EVENT -> id?.let { api.call("/rankings/events/${PlayerLinks.encode(it)}") } ?: JSONObject()
            PlayerScreen.RANKINGS -> api.call("/rankings" + playerRankingsQuery(id))
            PlayerScreen.MANUAL -> try { api.call("/manual",anonymous=true).also { manualCache.write(it) } } catch(failure:Exception) {
                if(failure !is java.io.IOException && (failure !is PlayerApiFailure || failure.status < 500))throw failure
                manualCache.read().put("offline",true)
            }
            PlayerScreen.HELP -> {
                try {
                    api.call("/faq", anonymous = true).also { helpCache.write(it) }
                } catch (failure: Exception) {
                    val cached = helpCache.read() ?: throw failure
                    if (failure !is java.io.IOException && (failure !is PlayerApiFailure || failure.status < 500)) throw failure
                    JSONObject(cached.toString()).put("offline", true)
                }
            }
            PlayerScreen.SEASONS -> api.call("/seasons")
            PlayerScreen.SEASON_CREATE -> api.call("/seasons").also { it.put("drafts", api.call("/organizer-drafts?kind=season").optJSONArray("drafts")) }
            PlayerScreen.SEASON -> id?.let { api.call("/seasons/${PlayerLinks.encode(it)}").also { resource -> if (resource.obj("season").obj("settings").text("playMode") == "remote") resource.put("locationContext", api.call("/locations")) } } ?: JSONObject()
            else -> {
                val platform = api.call("/platform?trainingProjection=compact")
                if (generation == identityGeneration && snapshots.accepts(ticket)) state.update { it.copy(platform = platform) }
                if (screen in listOf(PlayerScreen.LOBBY, PlayerScreen.TRAINING, PlayerScreen.EVENT, PlayerScreen.DIRECTOR, PlayerScreen.CLUB)) {
                    val entity = listOf("lobbies", "trainings", "leagues", "tournaments", "clubs", "rooms").asSequence().flatMap { platform.optJSONArray(it).objects().asSequence() }.firstOrNull { it.optString("id") == id } ?: JSONObject()
                    JSONObject().put("entity", entity).also {
                        if (screen == PlayerScreen.DIRECTOR && entity.optBoolean("canManage") && entity.obj("state").text("eventId").isNotBlank()) {
                            val boards = api.call("/events/${PlayerLinks.encode(entity.obj("state").text("eventId"))}/boards")
                            it.put("boards", boards.optJSONArray("boards"))
                        }
                    }
                } else platform
            }
        }
        if (generation != identityGeneration || !snapshots.accepts(ticket) || screen != state.value.screen || id != state.value.activeId) return
        if(screen==PlayerScreen.TRAINING&&resource.obj("entity").obj("state").optBoolean("offlineSupported")) {trainingQueue.accept(resource.obj("entity"));state.update{it.copy(online=true)};return}
        if (screen == PlayerScreen.MATCH && resource.length() > 0 && PlayerMatch.parse(resource).raw.optBoolean("offlineSupported")) {
            matchQueue.accept(resource); state.update { it.copy(online = true) }; return
        }
        state.update { current ->
            if (screen == PlayerScreen.TRAINING && id != null) {
                val entity = resource.optJSONObject("entity")
                if (entity?.optString("id") != id || entity.optString("kind") != "training") throw java.io.IOException("Ongeldige trainingsgegevens.")
                applyPlayerTrainingSnapshot(current, entity).copy(online = true)
            } else if (screen == PlayerScreen.MATCH && resource.length() > 0) {
                applyPlayerMatchSnapshot(current, resource).copy(online = true)
            } else current.copy(resource = resource, loading = false, online = true,
            match = if (screen == PlayerScreen.MATCH && resource.length() > 0) PlayerMatch.parse(resource) else if (screen == PlayerScreen.MATCH) null else current.match,
            board = if (screen == PlayerScreen.BOARD) resource else current.board,
            profile = if (screen == PlayerScreen.PROFILE) resource.optJSONObject("user")?.let(PlayerProfile::parse) ?: current.profile else current.profile,
        ) }
    }
    private suspend fun loadHome() {
        val identity = requestIdentity() ?: return
        homePolls.started(SystemClock.elapsedRealtime())
        val read = homeReads.begin(identity, snapshots.capture())
        fun current() = homeReads.accepts(read, requestIdentity(), snapshots.capture(), state.value.screen)
        state.update { it.copy(homeFeedLoading = true, homeFeedError = null) }
        var experienceFailure: Exception? = null
        try {
            fetchPlayerHome(
                request = { path -> api.call(path) },
                onExperience = { experience -> if (current()) state.update { it.copy(resource = experience, loading = false, online = true) } },
                onFeed = { feed -> if (current()) state.update { it.copy(homeFeed = feed, homeFeedLoading = false, homeFeedError = null) } },
                onExperienceFailure = { failure -> experienceFailure = failure },
                onFeedFailure = { failure -> if (current()) state.update { it.withHomeFeedFailure(failure) } },
            )
            experienceFailure?.let { if (current()) throw it }
        } finally {
            if (current()) state.update { it.copy(homeFeedLoading = false) }
        }
    }
    fun navigate(screen: PlayerScreen, id: String? = null) {
        if (screen == PlayerScreen.HOME && state.value.screen in listOf(PlayerScreen.PLAY_SESSION,PlayerScreen.PLAY_START) && !hasSession()) {
            saved.put("destination",json("screen" to if(state.value.screen==PlayerScreen.PLAY_START) "BOARD" else "PLAY_SESSION","id" to state.value.activeId));persist()
        }
        val current = state.value
        if (screen != current.screen || id != current.activeId) {
            navigation.addLast(PlayerDestination(current.screen, current.activeId))
            while (navigation.size > 30) navigation.removeFirst()
        }
        showDestination(screen, id)
    }
    fun back() {
        val destination = if (navigation.isEmpty()) PlayerDestination(PlayerScreen.HOME) else navigation.removeLast()
        showDestination(destination.screen, destination.id)
    }
    fun saveOrganizerDraft(draft: JSONObject) {
        if (!hasSession()) return
        val safe = PlayerOrganizerDraft.sanitize(draft)
        saved.put("organizerDraft", safe); persist()
        state.update { it.copy(organizerDraft = safe) }
    }
    private fun storedDestination(value: JSONObject): PlayerDestination? = runCatching {
        val screen = PlayerScreen.valueOf(value.getString("screen"))
        val id = value.optString("id").takeIf { it != "null" && it.length in 1..2048 }
        PlayerDestination(screen, id)
    }.getOrNull()
    private fun persistNavigation() {
        if (!hasSession()) return
        val current = state.value
        saved.put("navigation", json("active" to json("screen" to current.screen.name, "id" to current.activeId), "history" to org.json.JSONArray(navigation.map { json("screen" to it.screen.name, "id" to it.id) })))
    }
    private fun showDestination(screen: PlayerScreen, id: String?) {
        state.update { it.copy(screen = screen, activeId = id, resource = JSONObject(), match = if (screen == PlayerScreen.MATCH) null else it.match, guestOperatorId = if (screen == PlayerScreen.MATCH && id == it.activeId) it.guestOperatorId else "", loading = hasSession() || screen == PlayerScreen.HELP, error = null, notice = null) }
        if (screen == PlayerScreen.MATCH && id != null) matchQueue.restore(id)
        if (screen == PlayerScreen.TRAINING && id != null) trainingQueue.restore(id)
        if (hasSession()) { persistNavigation(); persist() }
        if (hasSession() || screen in listOf(PlayerScreen.HELP,PlayerScreen.MANUAL) || screen in playerPublicPlayScreens) launchTask(showBusy = false) { loadCurrent() }
    }
    fun refresh() = launchTask(showBusy = false) {
        if (!ready) initialize()
        else if (state.value.screen in playerPublicPlayScreens || !hasSession() && state.value.screen in listOf(PlayerScreen.HELP,PlayerScreen.MANUAL)) loadCurrent()
        else if (hasSession()) {
            if (state.value.screen != PlayerScreen.HOME) { loadIdentity(); loadCommon() }
            loadCurrent()
        }
    }
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
    /** Password login is restricted server-side to the separately provisioned review account. */
    fun reviewLogin(email: String, password: String) = launchTask {
        require(email.trim().length in 3..254 && password.length in 1..256) { "Vul de verstrekte beoordelingsgegevens in." }
        if (!ready) initialize()
        val generation = identityGeneration
        val result = api.call("/auth/review", JSONObject().put("email", email.trim()).put("password", password), anonymous = true)
        check(generation == identityGeneration) { "Je account is gewijzigd. Probeer opnieuw." }
        val expiresAt = when (val value = result.opt("expiresAt")) {
            is Number -> value.toLong()
            is String -> runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(0)
            else -> 0
        }
        saveAuthSession(JSONObject().put("access_token", result.optString("accessToken"))
            .put("refresh_token", result.optString("refreshToken"))
            .put("expires_at", if (expiresAt > 10_000_000_000L) expiresAt / 1000 else expiresAt))
        signedIn()
    }
    fun startGoogle() = launchTask {
        if (!ready) initialize()
        val pkce = PlayerPkce.create(api.serverNow())
        require(auth.optString("redirectScheme") == BuildConfig.AUTH_SCHEME) { "De inlogomgeving komt niet overeen met deze app." }
        saved.put("pkce", JSONObject().put("verifier", pkce.verifier).put("state", pkce.state).put("createdAt", pkce.createdAt)); persist()
        val url = PlayerLinks.googleUrl(auth.getString("url"), auth.getString("callbackUrl"), pkce)
        state.update { it.copy(googleUrl = url) }
    }
    fun playAction(action: JSONObject) { viewModelScope.launch {
        val id = play.action(action)
        if (id != null && action.text("type") in listOf("session.create", "challenge.start", "local.retry-operation")) navigate(PlayerScreen.PLAY_SESSION, id)
    } }
    fun handleDeepLink(value: String) {
        PlayerChallengeLink.parse(value, api.origin)?.let { link -> play.acceptChallenge(link);navigate(PlayerScreen.CHALLENGES,link.id);return }
        PlayerPlayLink.parse(value, api.origin)?.let { link ->
            runCatching { play.acceptLink(link); navigate(PlayerScreen.PLAY_SESSION, link.sessionId) }.onFailure { reportError("Deze persoonlijke link kon niet worden geopend.") }
            return
        }

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
        if (destination.screen == PlayerScreen.BOARD && !hasSession()) { navigate(PlayerScreen.PLAY_START, destination.id); return }
        if (destination.screen in playerPublicPlayScreens) { navigate(destination.screen, destination.id); return }
        if (destination.screen in listOf(PlayerScreen.HELP,PlayerScreen.MANUAL) && !hasSession()) { navigate(destination.screen, destination.id); return }
        pendingDestination = destination
        // Persist only the safe route identity so login/process recreation returns to the requested board.
        saved.put("destination", JSONObject().put("screen", destination.screen.name).put("id", destination.id).put("code", destination.invitationCode)); persist()
        if (hasSession()) launchTask { restoreDestination(); loadCurrent() }
        else {showDestination(PlayerScreen.HOME,null);state.update { it.copy(notice = "Log in om deze baan of wedstrijd te openen.") }}
    }
    private suspend fun restoreDestination() {
        val destination = pendingDestination ?: saved.optJSONObject("destination")?.let { item ->
            runCatching { PlayerDestination(PlayerScreen.valueOf(item.getString("screen")), item.optString("id").takeIf { it.isNotBlank() && it != "null" }, item.optString("code").takeIf { it.isNotBlank() && it != "null" }) }.getOrNull()
        } ?: saved.optJSONObject("navigation")?.optJSONObject("active")?.let(::storedDestination) ?: return
        if (destination.invitationCode != null) {
            val result = execute(NativePlayerCommand.create("/platform/actions", JSONObject().put("action", JSONObject().put("type", "invitation.resolve").put("code", destination.invitationCode))))
            val screen = if (result.optString("kind") == "lobby") PlayerScreen.LOBBY else PlayerScreen.EVENT
            val invitation = JSONObject(result.toString()).put("code", destination.invitationCode)
            saved.put("invitation", invitation)
            state.update { it.copy(screen = screen, activeId = result.optString("id"), resource = JSONObject(), invitation = invitation) }
        } else state.update { it.copy(screen = destination.screen, activeId = destination.id, resource = JSONObject()) }
        pendingDestination = null; saved.remove("destination"); persistNavigation(); persist()
    }
    private suspend fun signedIn() {
        identityGeneration++
        // Review/local login replies need not identify the account until /session.
        // Clear private home data before that first suspended identity request as well.
        state.update { it.withoutHomeFeed() }
        loadIdentity(); loadCommon(); restoreDestination(); loadCurrent()
        state.update { it.copy(online = true, loading = false, notice = "Je bent ingelogd.") }
    }
    fun localLogin(id: String) = launchTask {
        require(BuildConfig.LOCAL_FIXTURES && state.value.capabilities.optBoolean("local") && state.value.localUsers.any { it.id == id }) { "Lokale testlogin is hier niet beschikbaar." }
        val result = api.call("/auth/local", JSONObject().put("userId", id), anonymous = true)
        val expires = when (val value = result.opt("expiresAt")) { is Number -> value.toLong(); is String -> runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(0); else -> 0 }
        require(result.optString("accessToken").isNotBlank() && expires > api.serverNow())
        PlayerPush.clearLocal(getApplication())
        saved = JSONObject().put("accessToken", result.getString("accessToken")).put("expiresAt", expires).put("local", true).put("userId", id)
        persist(); signedIn()
    }
    fun signOut() = launchTask {
        val token = saved.optString("accessToken")
        val local = saved.optBoolean("local")
        PlayerPush.disable(getApplication(), api)
        notificationOpenStore.clear(); pendingPushId = null
        clearSession()
        if (!local && token.isNotBlank()) runCatching { api.authCall(auth, "/logout?scope=local", token = token) }
    }
    private fun clearSession() {
        PlayerPush.clearLocal(getApplication())
        play.resetView()
        identityGeneration++; pending = null; pendingDestination = null; navigation.clear(); saved = JSONObject(); store.clear()
        state.update { PlayerUiState(loading = false, capabilities = it.capabilities, localUsers = it.localUsers) }
    }
    fun setPushEnabled(enabled: Boolean) = launchTask {
        val actor = state.value.profile?.id ?: throw IllegalArgumentException("Log eerst in om meldingen in te stellen.")
        if (enabled) {
            val data = api.call("/push")
            val sdk = data.optJSONObject("sdk") ?: throw IllegalArgumentException("Systeemmeldingen zijn voor deze appomgeving nog niet ingericht. Je meldingen blijven in DartFlow beschikbaar.")
            PlayerPush.enable(getApplication(), api, actor, sdk)
        } else PlayerPush.disable(getApplication(), api)
        loadCurrent()
    }
    fun handlePushTap(id: String) {
        if (runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false).not()) return
        notificationOpenStore.write(json("id" to id, "origin" to api.origin))
        if (!ready || !hasSession()) { pendingPushId = id; state.update { it.copy(notice = "Log in om deze melding en je actuele toegang te controleren.") }; return }
        launchTask { openPush(id) }
    }
    private suspend fun openPush(id: String) {
        val identity = requestIdentity() ?: return
        val result = api.call("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "notification.open", "id" to id)))
        if (requestIdentity() != identity) return
        notificationOpenStore.clear()
        if (result.optBoolean("available")) {
            val settings = PlayerPush.settings(getApplication())
            if (settings.text("deviceId").isNotBlank()) runCatching { api.call("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "delivery.ack", "id" to id, "deviceId" to settings.text("deviceId"), "stage" to "opened"))) }
            handleDeepLink(result.text("href"))
        } else state.update { it.copy(notice = result.text("message", "Deze melding is verlopen of ingetrokken. Open Vandaag voor de actuele informatie.")) }
    }
    fun completeProfile(fullName: String, username: String, displayName: String, pin: String, confirm: String) {
        if (!PlayerValidation.validFullName(fullName) || !PlayerValidation.validUsername(username) || !PlayerValidation.validName(displayName)) { state.update { it.copy(error = "Controleer je privénaam, openbare displaynaam en vaste gebruikersnaam.") }; return }
        if (!state.value.profile.let { it?.pinConfigured == true } || pin.isNotBlank() || confirm.isNotBlank()) {
            if (!PlayerValidation.validPin(pin) || pin != confirm) { state.update { it.copy(error = "Gebruik zes cijfers en herhaal dezelfde spelerspincode.") }; return }
        }
        val body = JSONObject().put("username", PlayerValidation.normalizeUsername(username)).put("displayName", PlayerValidation.normalizeName(displayName)).put("fullName", fullName.takeIf { it.isNotBlank() }?.let(PlayerValidation::normalizeName) ?: JSONObject.NULL)
        if (pin.isNotBlank()) body.put("pin", pin).put("pinConfirmation", confirm)
        command("/profile/complete", body)
    }
    fun changePin(current: String, pin: String, confirm: String) {
        if (!PlayerValidation.validPin(pin) || pin != confirm || (state.value.profile?.pinConfigured == true && !PlayerValidation.validPin(current))) {
            state.update { it.copy(error = "Gebruik zes cijfers en controleer de huidige en herhaalde spelerspincode.") }; return
        }
        command("/profile/player-pin", JSONObject().put("mode", if (state.value.profile?.pinConfigured == true) "change" else "initial").put("currentPin", current).put("pin", pin).put("pinConfirmation", confirm))
    }
    private fun queueTraining(path:String,body:JSONObject):Boolean {
        val action=body.obj("action");if(path!="/platform/actions"||action.text("type") !in listOf("training.score","training.undo"))return false
        if(pending!=null){reportError("Wacht op verbinding en controleer eerst de vorige bewaarde actie.");return true}
        val id=action.text("id");val entity=(listOf(state.value.resource.obj("entity"))+state.value.platform.rows("trainings")).find{it.text("id")==id}?:return false
        if(!entity.obj("state").optBoolean("offlineSupported")||entity.obj("state").text("mode") !in listOf("solo","bot")||!entity.optBoolean("canManage"))return false
        if(action.text("type")=="training.undo"){
            if(trainingQueue.pending(id)>0){
                if(!trainingQueue.removeLast(id))reportError("Wacht op de lopende synchronisatie voordat je de laatste invoer terugneemt.")
                return true
            }
            if(entity.obj("state").text("mode")!="solo"||entity.obj("state").obj("game").rows("history").isEmpty())return false
        }
        val generation=identityGeneration
        viewModelScope.launch{if(generation!=identityGeneration)return@launch;try{snapshots.advance();trainingQueue.enqueue(entity,action);if(state.value.online)trainingQueue.sync(id)}catch(failure:Exception){handleFailure(failure)}}
        return true
    }
    fun command(path: String, body: JSONObject) {
        if(queueTraining(path,body))return
        launchTask {
        commandLock.withLock {
            check(pending == null) { "Controleer eerst de uitkomst van je vorige actie via Opnieuw proberen." }
            val command = NativePlayerCommand.create(path, body)
            val generation = identityGeneration
            snapshots.advance()
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
    }
    fun platformAction(action: JSONObject, expectedRevision: Int? = null) {
        val body = JSONObject().put("action", action)
        expectedRevision?.let { body.put("expectedRevision", it) }
        command("/platform/actions", body)
    }
    fun matchAction(type: String, extra: JSONObject = JSONObject()) {
        val match = state.value.match ?: return
        if(pending!=null&&type in listOf("score","undo")){reportError("Wacht op verbinding en controleer eerst de vorige bewaarde actie.");return}
        if (type == "undo" && state.value.pendingMatchVisits > 0) {
            if (!matchQueue.removeLast(match.id)) reportError("Een bewaarde beurt wordt nog gesynchroniseerd. Wacht op de bevestiging voordat je die terugneemt.")
            return
        }
        if (state.value.guestOperatorId.isBlank() && match.raw.optBoolean("offlineSupported") && (type == "score" || type == "undo" && playerCanProjectUndo(match,saved.text("userId")))) {
            val queuedIdentity=identityGeneration
            viewModelScope.launch {
                if(queuedIdentity!=identityGeneration)return@launch
                try { snapshots.advance(); matchQueue.enqueue(match, JSONObject(extra.toString()).put("type", type)); if (state.value.online) matchQueue.sync(match.id) }
                catch (failure: Exception) { handleFailure(failure) }
            }; return
        }
        val guest = state.value.guestOperatorId.takeIf { id -> match.raw.rows("guestOperators").any { it.text("id") == id } && type in listOf("accept", "confirm", "score", "undo", "start", "draw-start", "bull-throw", "bull-confirm") }
        command("/matches/${match.id}/actions", JSONObject().put("matchId", match.id).put("expectedRevision", match.revision).put("action", JSONObject(extra.toString()).put("type", type)).also { if (guest != null) it.put("guestId", guest) })
    }
    fun selectGuestOperator(id: String) {
        if (state.value.busy || state.value.hasPendingCommand) return
        if (id.isBlank() || state.value.match?.raw?.rows("guestOperators")?.any { it.text("id") == id } == true) state.update { it.copy(guestOperatorId = id) }
    }
    fun score(score: Int, darts: Int = 3, doubleConfirmed: Boolean = false, doubleAttempts: Int? = null) {
        if (score !in 0..180 || darts !in 1..3) { state.update { it.copy(error = "Gebruik een worp van 0–180 en één tot drie darts.") }; return }
        val fields = JSONObject().put("score", score).put("darts", darts).put("doubleConfirmed", doubleConfirmed)
        doubleAttempts?.let { fields.put("doubleAttempts", it) }
        matchAction("score", fields)
    }
    fun retryPendingCommand() = launchTask {
        state.value.activeId?.takeIf{state.value.screen==PlayerScreen.TRAINING&&state.value.pendingTrainingVisits>0}?.let{trainingQueue.sync(it);return@launchTask}
        state.value.match?.takeIf { state.value.pendingMatchVisits > 0 }?.let { matchQueue.sync(it.id); return@launchTask }
        commandLock.withLock {
            val command = pending ?: return@withLock
            val generation = identityGeneration
            snapshots.advance()
            try {
                val result = execute(command.forOfflineRetry())
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
        snapshots.advance()
        if(path=="/play/legacy-actions"){if(input.text("action")=="resolve-offline")trainingQueue.resolved(input.text("sourceId"));loadCurrent();state.update{it.copy(notice="Dezelfde partij is opnieuw aan de gecontroleerde baan gekoppeld.")};return}
        if (path == "/competition-lobbies/actions" || path == "/competition-lobbies/player-pin") {
            val url = result.text("url").ifBlank { if (result.obj("lobby").text("status") == "started") result.obj("lobby").text("matchUrl") else "" }
            if (url.isNotBlank()) handleDeepLink(url) else loadCurrent()
            state.update { it.copy(notice = if (path.endsWith("player-pin")) "De geplande tegenstander is bevestigd voor deze wedstrijd." else "Competitielobby bijgewerkt.") }
            return
        }
        if (path == "/faq/admin/actions") {
            state.update { it.copy(faqAdminReceipt = result, notice = if (result.has("version")) "Gedeelde hulp gepubliceerd." else "Hulpconcept opgeslagen.") }; loadCurrent(); return
        }
        if (path == "/organizer-drafts/actions") {
            state.update { it.copy(organizerCloudDraft = result.optJSONObject("draft") ?: JSONObject(), notice = "Accountconcept opgeslagen.") }; loadCurrent(); return
        }
        if (path.startsWith("/matches/") && input.obj("action").text("type") == "resolve-offline-conflict") {
            matchQueue.resolved(input.text("matchId")); matchQueue.accept(result.optJSONObject("match") ?: result); return
        }
        val accepted = acceptedPlayerScoreSnapshot(state.value, path, input, result)
        if (accepted != null) {
            state.value = accepted
            return
        }
        if (path == "/account/deletion") {
            check(result.optBoolean("ok") && result.optString("status") in listOf("pending", "processing", "completed")) { "Het verwijderverzoek kon niet worden bevestigd. Probeer opnieuw." }
            // Acceptance invalidates access server-side. Erase tokens, queued actions, profile,
            // current match and return destination locally before any further authenticated call.
            notificationOpenStore.clear(); pendingPushId = null; play.eraseAccount(saved.text("userId")); matchQueue.clear(); trainingQueue.clear(); clearSession()
            state.update { it.copy(notice = "Je verzoek om je account en gegevens te verwijderen is ontvangen. Je bent uitgelogd. Hulp of vragen: info@dartflow.nl.") }
            return
        }
        val changedCommunity = input.optJSONObject("action")?.optString("type").orEmpty()
        if (path.startsWith("/safety/") || changedCommunity.startsWith("community.") || changedCommunity in listOf("friend.block", "friend.unblock")) {
            state.update { it.withoutHomeFeed() }
        }
        if (path.startsWith("/profile")) loadIdentity()
        if (generation != identityGeneration || !hasSession()) return
        loadCommon()
        if (generation != identityGeneration || !hasSession()) return
        val action = input.optJSONObject("action")?.optString("type").orEmpty()
        if (action == "competition.register") { saved.remove("invitation"); persist(); state.update { it.copy(invitation = JSONObject()) } }
        if (action == "invitation.resolve") {
            val invitation = JSONObject(result.toString()).put("code", input.optJSONObject("action")?.optString("code").orEmpty())
            saved.put("invitation", invitation); persist(); state.update { it.copy(invitation = invitation) }
        }
        val matchId = result.optString("matchId").takeIf { it.isNotBlank() }
        val id = result.optString("id").takeIf { it.isNotBlank() }
        when {
            id != null && action == "competition.copy" -> state.update { it.copy(screen = PlayerScreen.DIRECTOR, activeId = id) }
            path == "/rankings/actions" && id != null && action == "list.create" -> state.update { it.copy(screen = PlayerScreen.RANKINGS, activeId = "listId=${PlayerLinks.encode(id)}") }
            id != null && action in listOf("season.create", "season.copy") -> state.update { it.copy(screen = PlayerScreen.SEASON, activeId = id) }
            matchId != null && action == "season.start" -> state.update { it.copy(screen = PlayerScreen.MATCH, activeId = matchId) }
            id != null && action in listOf("tournament.create", "league.create") -> {
                saved.remove("organizerDraft"); persist()
                state.update { it.copy(screen = PlayerScreen.DIRECTOR, activeId = id, organizerDraft = JSONObject()) }
            }
            matchId != null && action in listOf("lobby.start", "board.start", "fixture.start", "reservation.fixture.start") -> state.update { it.copy(screen = PlayerScreen.MATCH, activeId = matchId) }
            id != null && (action == "training.create" || action == "board.start" && result.optString("kind") == "training") -> state.update { it.copy(screen = PlayerScreen.TRAINING, activeId = id) }
            id != null && action in listOf("lobby.create", "board.start", "lobby.join") -> state.update { it.copy(screen = PlayerScreen.LOBBY, activeId = id) }
            id != null && action == "invitation.resolve" -> state.update { it.copy(screen = if (result.optString("kind") == "lobby") PlayerScreen.LOBBY else PlayerScreen.EVENT, activeId = id) }
        }
        persistNavigation(); persist()
        try { loadCurrent() }
        catch (failure: PlayerApiFailure) {
            if (path == "/safety/block" && failure.status in listOf(403, 404)) {
                state.update { it.copy(screen = PlayerScreen.FRIENDS, activeId = null, resource = JSONObject(), loading = false) }
            } else throw failure
        }
        if (generation != identityGeneration || !hasSession()) return
        val notice = when (path) {
            "/push/actions" -> when (result.text("status")) { "queued" -> "Testmelding staat in de verzendwachtrij. Ververs de verzendstatus om echte ontvangst te controleren."; "configUnavailable" -> "De Firebase-verzendconfiguratie ontbreekt. Er is geen testmelding verzonden; je meldingen blijven in DartFlow beschikbaar."; "suppressed" -> "Je meldingsvoorkeuren houden deze testmelding tegen."; else -> result.text("message", "Meldingsvoorkeuren opgeslagen.") }
            "/safety/report" -> "Je melding is ontvangen. DartFlow beoordeelt deze. Bij direct gevaar bel je 112."
            "/safety/block" -> if (input.optBoolean("blocked")) "Speler geblokkeerd. Nieuwe rechtstreekse interacties worden tegengehouden." else "Blokkade opgeheven."
            "/safety/consent" -> "Communityregels opgeslagen. Je kunt nu een bericht plaatsen."
            else -> "Opgeslagen."
        }
        state.update { it.copy(notice = notice, error = null, online = true) }
    }
    private fun launchTask(showBusy: Boolean = true, task: suspend () -> Unit) {
        viewModelScope.launch {
            if (showBusy && state.value.busy) return@launch
            val generation = identityGeneration
            val ticket = snapshots.capture()
            if (showBusy) state.update { it.copy(busy = true, error = null, notice = null) }
            try { task() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                if (snapshots.acceptsTaskFeedback(ticket, showBusy, generation, identityGeneration)) handleFailure(failure)
            }
            finally {
                if (snapshots.acceptsTaskFeedback(ticket, showBusy, generation, identityGeneration)) state.update { it.finishedTask(ownsBusy = showBusy) }
            }
        }
    }
    private fun handleFailure(failure: Exception, polling: Boolean = false) {
        // Discard work from a previous login without changing the new login's feedback/state.
        if (failure is PlayerApiFailure && failure.code == "session_changed") return
        if (failure is PlayerApiFailure && failure.code == "account_deleted") { play.eraseAccount(saved.text("userId")); matchQueue.clear(); trainingQueue.clear(); clearSession() }
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
            val allowed = setOf("startScore", "offset", "opponent", "search", "opponentOffset", "practiceOffset", "outRule", "inRule", "handicap", "source")
            val normalized = if (!value.contains('=') && value.substringBefore(':') in allowed) value.substringBefore(':') + "=" + PlayerLinks.encode(value.substringAfter(':')) else value.removePrefix("?")
            val query = runCatching { PlayerLinks.query(URI("https://native.invalid/?$normalized")) }.getOrDefault(emptyMap())
            val safe = query.filter { (key, input) -> key in allowed && input.length <= 100 && when (key) {
                "startScore" -> input in listOf("301", "501", "701")
                "outRule" -> input in listOf("double-out", "straight-out", "master-out")
                "inRule" -> input in listOf("single", "double")
                "handicap" -> input in listOf("true", "false")
                "source" -> input in listOf("free","league","tournament")
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
    val sensitive: Boolean get() = path.startsWith("/profile") || path.startsWith("/account") || path == "/safety/report" || path.contains("player-pin") || containsSecret(body)
    override fun toString() = "NativePlayerCommand(path=$path, requestId=$requestId, body=[redacted])"
    fun forOfflineRetry(): NativePlayerCommand = if (Regex("/matches/[0-9a-fA-F-]{36}/actions").matches(path) && body.obj("action").text("type") in listOf("score", "undo")) create(path, JSONObject(body.toString()).put("offline", true)) else this
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
