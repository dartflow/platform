package nl.dartflow.ochelive

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

sealed interface DisplayUi {
    data object Loading : DisplayUi
    data class Pairing(val code: String, val url: String, val expiresAt: Long, val serverAtReceipt: Long, val monotonicAtReceipt: Long, val expired: Boolean = false) : DisplayUi
    data class Screen(val snapshot: DisplaySnapshot, val serverAtReceipt: Long, val monotonicAtReceipt: Long, val cue: ScoreEvent? = null, val cached: Boolean = false, val panelCues: Map<String, ScoreEvent> = emptyMap()) : DisplayUi
    data class Disconnected(val message: String) : DisplayUi
}
data class LayoutSetup(val initial: DisplayLayout, val linked: Boolean, val allowLater: Boolean = false, val saving: Boolean = false, val error: String? = null, val allowDual: Boolean = true)
data class ConnectionState(val ui: DisplayUi = DisplayUi.Loading, val offline: Boolean = false, val message: String? = null, val layoutSetup: LayoutSetup? = null, val layoutProposal: DisplayUi.Pairing? = null, val layoutNotice: String? = null)

class OcheViewModel(application: Application) : AndroidViewModel(application) {
    private val store = SecureStore(application)
    private val api = OcheApi()
    private var saved = store.read()
    private val state = MutableStateFlow(cachedDisplay(saved)?.let { snapshot -> ConnectionState(DisplayUi.Screen(snapshot, snapshot.serverNow, SystemClock.elapsedRealtime(), cached = true), offline = true, message = "Laatst ontvangen stand. De actuele baan en toegang worden gecontroleerd.") } ?: ConnectionState())
    val connection = state.asStateFlow()
    private var loop: Job? = null
    private var running = false
    private var platform = "android"
    private var detectedLayout = DisplayLayout("landscape", 1)
    private var forceSnapshot = true
    private val events = EventCursor()
    private val panelEvents = PanelEventCursors()
    fun resume(isTv: Boolean, landscape: Boolean = true) {
        platform = if (isTv) "android-tv" else "android"; detectedLayout = DisplayLayout.detected(landscape)
        forceSnapshot = true; running = true
        if (!saved.has("refreshToken") && DisplayLayout.parse(saved.optJSONObject("layoutChoice")) == null) openLayoutSetup()
        startLoop()
    }
    fun pause() { running = false; loop?.cancel(); loop = null; disconnectEvents() }
    private fun disconnectEvents() { events.disconnect(); panelEvents.disconnect() }
    private fun persist() { store.write(saved) }
    private fun nonce(key: String): String = saved.optString(key).takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString().also { saved.put(key, it); persist() }
    private fun startLoop() {
        if (!running || loop?.isActive == true || state.value.layoutSetup?.linked == false) return
        loop = viewModelScope.launch {
            var failures = 0
            while (running) {
                try {
                    if (saved.has("refreshToken")) {
                        if (!saved.has("accessToken") || expired(saved.optString("accessExpiresAt"), 30_000, api.serverNow())) refresh()
                        fetchSnapshot()
                    } else if (!saved.has("installationId") || !saved.has("pairing")) startPairing()
                    else checkPairing()
                    failures = 0
                    delay(2_000)
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: ApiFailure) {
                    if (failure.status == 401 && saved.has("refreshToken") && saved.has("accessToken")) {
                        // An assignment/grant change may revoke either board. Remove old projections
                        // before refreshing; no late response can repopulate the previous baseline.
                        saved.remove("accessToken")
                        if (failure.code == "device_assignment_changed") {
                            saved.remove("lastSnapshot"); disconnectEvents(); forceSnapshot = true
                            state.value = state.value.copy(ui = DisplayUi.Loading)
                        }
                        persist()
                        continue
                    }
                    if (failure.status in listOf(401, 403, 410)) {
                        saved = revokedInstallation(saved); persist(); disconnectEvents()
                        state.value = ConnectionState(DisplayUi.Disconnected("Dit scherm is ontkoppeld of de koppeling is verlopen. Koppel het scherm opnieuw."))
                        break
                    }
                    disconnectEvents(); failures++
                    state.value = state.value.copy(offline = true, message = if (failure.status == 429) "Even wachten voor een nieuwe poging." else "Geen verbinding. De laatst ontvangen stand blijft staan.")
                    delay(maxOf(failure.retryAfterMs, backoff(failures)))
                } catch (_: Exception) {
                    disconnectEvents(); failures++
                    state.value = state.value.copy(offline = true, message = "Geen verbinding. De laatst ontvangen stand blijft staan.")
                    delay(backoff(failures))
                }
            }
        }
    }
    private suspend fun startPairing() {
        val body = JSONObject().put("platform", platform).put("requestId", nonce("startRequestId"))
        DisplayLayout.parse(saved.optJSONObject("layoutChoice"))?.let { body.put("layoutProposal", it.json()) }
        if (saved.has("installationId")) body.put("installationId", saved.getString("installationId")).put("installationSecret", saved.getString("installationSecret"))
        val result = api.call("/start", body)
        result.optString("installationSecret").takeIf { it.isNotBlank() }?.let { saved.put("installationSecret", it) }
        saved.put("installationId", result.getString("installationId")).put("pairing", result)
        saved.remove("startRequestId"); saved.remove("redeemNonce"); persist(); showPairing(result)
    }
    private fun showPairing(pairing: JSONObject, expired: Boolean = false, serverNow: Long = pairing.optLong("serverNow", System.currentTimeMillis())) {
        val url = pairing.getString("verificationUrl")
        // Fail closed if a server regression ever attempts to encode an installation secret.
        val allowed = "${BuildConfig.API_ORIGIN}/koppel-scherm"
        require(url.startsWith("$allowed#") || url == allowed)
        state.value = state.value.copy(ui = pairingUi(pairing, expired, serverNow), offline = false, message = null)
    }
    private fun pairingUi(pairing: JSONObject, expired: Boolean = false, serverNow: Long = pairing.optLong("serverNow", api.serverNow())): DisplayUi.Pairing {
        val url = pairing.getString("verificationUrl")
        val allowed = "${BuildConfig.API_ORIGIN}/koppel-scherm"
        require(url.startsWith("$allowed#") || url == allowed)
        return DisplayUi.Pairing(pairing.getString("code"), url, Instant.parse(pairing.getString("expiresAt")).toEpochMilli(), serverNow, SystemClock.elapsedRealtime(), expired)
    }
    private suspend fun checkPairing() {
        val result = api.call("/status", installation = saved)
        when (result.getString("state")) {
            "approved", "redeemed" -> {
                val session = api.call("/redeem", JSONObject().put("nonce", nonce("redeemNonce")), installation = saved)
                saveSession(session); saved.remove("redeemNonce"); saved.remove("pairing"); persist(); fetchSnapshot()
            }
            "expired", "revoked" -> {
                showPairing(saved.getJSONObject("pairing"), expired = true, serverNow = result.getLong("serverNow"))
                // User explicitly requests another code; do not rotate in a background loop.
                delay(5_000)
            }
            else -> showPairing(saved.getJSONObject("pairing"), serverNow = result.getLong("serverNow"))
        }
    }
    private fun saveSession(session: JSONObject) {
        require(session.optString("accessToken").isNotBlank() && session.optString("refreshToken").isNotBlank())
        for (key in listOf("deviceId", "accessToken", "refreshToken", "accessExpiresAt", "refreshExpiresAt")) saved.put(key, session.get(key))
        persist()
    }
    private suspend fun refresh() {
        val session = api.call("/refresh", JSONObject().put("nonce", nonce("refreshNonce")).put("refreshToken", saved.getString("refreshToken")))
        saved.remove("refreshNonce"); saveSession(session)
    }
    private suspend fun fetchSnapshot() {
        val prior = state.value.ui as? DisplayUi.Screen
        // A first/reconnected fetch is an absolute snapshot. Polling authorizes each response,
        // bounding revoke/assignment changes without cached Realtime joins.
        val reconnect = forceSnapshot || prior == null || state.value.offline
        val body = if (reconnect) api.call("/snapshot?panels=1", token = saved.getString("accessToken")) else api.call("/events?panels=1&after=${java.net.URLEncoder.encode(prior.snapshot.eventId, "UTF-8")}", token = saved.getString("accessToken"))
        val source = body.optJSONObject("snapshot") ?: body
        val snapshot = DisplaySnapshot.parse(source)
        val previousConfiguration = saved.optLong("configurationRevision", -1)
        val configurationChanged = snapshot.configurationRevision != null && snapshot.configurationRevision != previousConfiguration
        val cacheChanged = saved.optJSONObject("lastSnapshot")?.optString("eventId") != snapshot.eventId || configurationChanged
        val layoutChanged = snapshot.layout != null && (DisplayLayout.parse(saved.optJSONObject("layoutChoice")) != snapshot.layout || !saved.optBoolean("layoutPromptShown"))
        if (cacheChanged) saved.put("lastSnapshot", source)
        snapshot.layout?.let { saved.put("layoutChoice", it.json()).put("layoutPromptShown", true) }
        snapshot.configurationRevision?.let { saved.put("configurationRevision", it) }
        if (configurationChanged) { saved.remove("layoutProposalRequestId"); saved.remove("pendingLayoutProposal") }
        if (cacheChanged || layoutChanged) persist()
        forceSnapshot = false
        val reset = reconnect || body.optBoolean("reset") || configurationChanged
        val cue = events.observe(snapshot.match ?: snapshot.play?.x01Match, reset)
        // v1 reset describes the primary cursor. A primary match/source change must
        // not swallow a new right-board event; each pane detects its own source gap.
        val panelCues = panelEvents.observe(snapshot.panels, reconnect || configurationChanged)
        state.value = state.value.copy(ui = DisplayUi.Screen(snapshot, snapshot.serverNow, SystemClock.elapsedRealtime(), cue, panelCues = panelCues), offline = false, message = null, layoutProposal = state.value.layoutProposal.takeUnless { configurationChanged }, layoutNotice = if (configurationChanged && state.value.layoutProposal != null) "Schermindeling bevestigd." else state.value.layoutNotice)
        if (snapshot.layout == null && !saved.optBoolean("layoutPromptShown") && DisplayLayout.parse(saved.optJSONObject("layoutChoice")) == null && snapshot.safeForLayoutSetup && state.value.layoutSetup == null) openLayoutSetup(allowLater = true)
    }
    fun openLayoutSetup(allowLater: Boolean = false) {
        val snapshot = (state.value.ui as? DisplayUi.Screen)?.snapshot
        if (!saved.has("refreshToken")) { loop?.cancel(); loop = null }
        val initial = snapshot?.layout ?: DisplayLayout.parse(saved.optJSONObject("layoutChoice")) ?: detectedLayout
        val home = snapshot?.scope == "home"
        state.value = state.value.copy(layoutSetup = LayoutSetup(if (home) initial.copy(scoreboards = 1) else initial, saved.has("refreshToken"), allowLater, allowDual = !home), layoutNotice = null, layoutProposal = null)
    }
    fun deferLayoutSetup() {
        try {
            saved.put("layoutPromptShown", true); persist()
            state.value = state.value.copy(layoutSetup = null)
        } catch (_: Exception) { state.value = state.value.copy(layoutSetup = state.value.layoutSetup?.copy(error = "De keuze kon niet worden opgeslagen. Probeer opnieuw.")) }
    }
    fun closeLayoutSetup() {
        if (state.value.layoutSetup?.linked == true) state.value = state.value.copy(layoutSetup = null)
    }
    fun saveLayout(layout: DisplayLayout) {
        val setup = state.value.layoutSetup ?: return
        if (setup.saving) return
        // Write the selection before any request for a pairing code. A failed encrypted
        // write keeps the wizard open; a network retry retains the exact same choice.
        try {
            val updated = JSONObject(saved.toString()).put("layoutPromptShown", true)
            if (setup.linked) {
                if (DisplayLayout.parse(updated.optJSONObject("proposedLayout")) != layout) updated.remove("layoutProposalRequestId")
                updated.put("proposedLayout", layout.json())
            } else updated.put("layoutChoice", layout.json()).apply { remove("pairing"); remove("startRequestId"); remove("redeemNonce") }
            store.write(updated); saved = updated
        } catch (_: Exception) {
            state.value = state.value.copy(layoutSetup = setup.copy(initial = layout, error = "De keuze kon niet worden opgeslagen. Probeer opnieuw.")); return
        }
        if (!setup.linked) {
            state.value = state.value.copy(layoutSetup = null); startLoop(); return
        }
        state.value = state.value.copy(layoutSetup = setup.copy(initial = layout, saving = true, error = null))
        viewModelScope.launch {
            try {
                val result = api.call("/layout-proposal", JSONObject().put("layout", layout.json()).put("requestId", nonce("layoutProposalRequestId")), token = saved.getString("accessToken"))
                saved.put("pendingLayoutProposal", result); persist()
                state.value = state.value.copy(layoutSetup = null, layoutProposal = pairingUi(result))
            } catch (failure: ApiFailure) {
                val message = if (failure.status in listOf(404, 405, 501)) "Deze server ondersteunt schermindeling nog niet. De huidige enkele weergave blijft beschikbaar." else if (failure.status == 409) "Het scherm is elders gewijzigd. Open Schermindeling opnieuw." else "Het voorstel kon niet worden verstuurd. Probeer opnieuw; de huidige indeling blijft actief."
                state.value = state.value.copy(layoutSetup = state.value.layoutSetup?.copy(saving = false, error = message))
            } catch (_: Exception) { state.value = state.value.copy(layoutSetup = state.value.layoutSetup?.copy(saving = false, error = "Geen verbinding. Probeer opnieuw; je keuze blijft bewaard.")) }
        }
    }
    fun closeLayoutProposal() { state.value = state.value.copy(layoutProposal = null) }
    fun renewLayoutProposal() {
        val layout = DisplayLayout.parse(saved.optJSONObject("proposedLayout")) ?: return
        try {
            val updated = JSONObject(saved.toString()).apply { remove("layoutProposalRequestId") }
            store.write(updated); saved = updated
        } catch (_: Exception) {
            state.value = state.value.copy(layoutProposal = null, layoutSetup = LayoutSetup(layout, linked = true, error = "De keuze kon niet worden opgeslagen. Probeer opnieuw.")); return
        }
        state.value = state.value.copy(layoutProposal = null, layoutSetup = LayoutSetup(layout, linked = true))
        saveLayout(layout)
    }
    fun newCode() {
        loop?.cancel(); loop = null
        if (!saved.has("refreshToken")) {
            try {
                val updated = JSONObject(saved.toString()).apply { remove("pairing"); remove("startRequestId"); remove("redeemNonce") }
                store.write(updated); saved = updated
            } catch (_: Exception) { state.value = state.value.copy(offline = true, message = "Beveiligde opslag is niet beschikbaar. Probeer de code opnieuw aan te vragen."); return }
        }
        state.value = ConnectionState(); startLoop()
    }
    companion object {
        fun backoff(failures: Int): Long = minOf(30_000L, 1_000L shl minOf(5, failures.coerceAtLeast(0)))
        fun expired(value: String, margin: Long, now: Long = System.currentTimeMillis()): Boolean = runCatching { Instant.parse(value).toEpochMilli() <= now + margin }.getOrDefault(true)
    }
}
