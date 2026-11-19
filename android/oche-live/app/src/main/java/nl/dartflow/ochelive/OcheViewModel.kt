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
    data class Screen(val snapshot: DisplaySnapshot, val serverAtReceipt: Long, val monotonicAtReceipt: Long, val cue: ScoreEvent? = null, val cached: Boolean = false) : DisplayUi
    data class Disconnected(val message: String) : DisplayUi
}
data class ConnectionState(val ui: DisplayUi = DisplayUi.Loading, val offline: Boolean = false, val message: String? = null)

class OcheViewModel(application: Application) : AndroidViewModel(application) {
    private val store = SecureStore(application)
    private val api = OcheApi()
    private var saved = store.read()
    private val state = MutableStateFlow(cachedDisplay(saved)?.let { snapshot -> ConnectionState(DisplayUi.Screen(snapshot, snapshot.serverNow, SystemClock.elapsedRealtime(), cached = true), offline = true, message = "Laatst ontvangen stand. De actuele baan en toegang worden gecontroleerd.") } ?: ConnectionState())
    val connection = state.asStateFlow()
    private var loop: Job? = null
    private var running = false
    private var platform = "android"
    private var forceSnapshot = true
    private val events = EventCursor()
    fun resume(isTv: Boolean) { platform = if (isTv) "android-tv" else "android"; forceSnapshot = true; running = true; startLoop() }
    fun pause() { running = false; loop?.cancel(); loop = null; events.disconnect() }
    private fun persist() { store.write(saved) }
    private fun nonce(key: String): String = saved.optString(key).takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString().also { saved.put(key, it); persist() }
    private fun startLoop() {
        if (!running || loop?.isActive == true) return
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
                        saved.remove("accessToken"); persist(); continue
                    }
                    if (failure.status in listOf(401, 403, 410)) {
                        saved = JSONObject(); persist(); events.disconnect()
                        state.value = ConnectionState(DisplayUi.Disconnected("Dit scherm is ontkoppeld of de koppeling is verlopen. Koppel het scherm opnieuw."))
                        break
                    }
                    events.disconnect(); failures++
                    state.value = state.value.copy(offline = true, message = if (failure.status == 429) "Even wachten voor een nieuwe poging." else "Geen verbinding. De laatst ontvangen stand blijft staan.")
                    delay(maxOf(failure.retryAfterMs, backoff(failures)))
                } catch (_: Exception) {
                    events.disconnect(); failures++
                    state.value = state.value.copy(offline = true, message = "Geen verbinding. De laatst ontvangen stand blijft staan.")
                    delay(backoff(failures))
                }
            }
        }
    }
    private suspend fun startPairing() {
        val body = JSONObject().put("platform", platform).put("requestId", nonce("startRequestId"))
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
        state.value = ConnectionState(DisplayUi.Pairing(pairing.getString("code"), url, Instant.parse(pairing.getString("expiresAt")).toEpochMilli(), serverNow, SystemClock.elapsedRealtime(), expired))
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
        val body = if (forceSnapshot || prior == null || state.value.offline) api.call("/snapshot", token = saved.getString("accessToken")) else api.call("/events?after=${java.net.URLEncoder.encode(prior.snapshot.eventId, "UTF-8")}", token = saved.getString("accessToken"))
        val source = body.optJSONObject("snapshot") ?: body
        val snapshot = DisplaySnapshot.parse(source)
        if (saved.optJSONObject("lastSnapshot")?.optString("eventId") != snapshot.eventId) {
            saved.put("lastSnapshot",source); persist()
        }
        forceSnapshot = false
        val cue = events.observe(snapshot.match?:snapshot.play?.x01Match, body.optBoolean("reset"))
        state.value = ConnectionState(DisplayUi.Screen(snapshot, snapshot.serverNow, SystemClock.elapsedRealtime(), cue))
    }
    fun newCode() {
        loop?.cancel(); loop = null
        if (!saved.has("refreshToken")) { saved.remove("pairing"); saved.remove("startRequestId"); saved.remove("redeemNonce"); persist() }
        state.value = ConnectionState(); startLoop()
    }
    companion object {
        fun backoff(failures: Int): Long = minOf(30_000L, 1_000L shl minOf(5, failures.coerceAtLeast(0)))
        fun expired(value: String, margin: Long, now: Long = System.currentTimeMillis()): Boolean = runCatching { Instant.parse(value).toEpochMilli() <= now + margin }.getOrDefault(true)
    }
}
