package nl.dartflow.app

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal object PlayerAuthCoordinator { val refresh = Mutex() }
internal val playerPushCategories = listOf("Sociaal", "Wedstrijden", "Competitie", "Toernooien")
internal fun playerPushPayload(data: Map<String, String>): Triple<String, String, String>? {
    if (data.keys != setOf("id", "deviceId", "category") || data["category"] !in playerPushCategories) return null
    val id = data["id"].orEmpty(); val device = data["deviceId"].orEmpty()
    if (runCatching { UUID.fromString(id).toString() == id && UUID.fromString(device).toString() == device }.getOrDefault(false)) return Triple(id, device, data["category"]!!)
    return null
}
internal fun playerPushBody(category: String) = when (category) {
    "Competitie" -> "Er is een update over je competitie. Open DartFlow voor de actuele informatie."
    "Toernooien" -> "Er is een update over je toernooi. Open DartFlow voor de actuele informatie."
    "Wedstrijden" -> "Er is een wedstrijdmelding. Open DartFlow voor de actuele informatie."
    else -> "Er staat een nieuwe melding voor je klaar. Open DartFlow voor de actuele informatie."
}
internal fun playerPushBindingAllowed(binding: JSONObject, session: JSONObject, actor: String?, origin: String, permitted: Boolean): Boolean = binding.optBoolean("enabled") && !actor.isNullOrBlank() && binding.text("actorId") == actor && session.text("userId") == actor && session.text("accessToken").isNotBlank() && binding.text("origin") == origin && permitted

class PlayerApplication : Application() { override fun onCreate() { super.onCreate(); PlayerPush.initializeCached(this) } }

/** Separate encrypted storage: Firebase never receives the DartFlow login token or player PIN. */
internal object PlayerPush {
    private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private fun store(context: Context) = PlayerSessionStore(context.applicationContext, "push")
    fun settings(context: Context): JSONObject = store(context).read()
    fun permitted(context: Context) = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    fun isEnabled(context: Context, actor: String?): Boolean {
        val current = settings(context)
        val session = PlayerSessionStore(context).read()
        return playerPushBindingAllowed(current, session, actor, BuildConfig.API_ORIGIN, permitted(context))
    }
    private fun initialize(context: Context, sdk: JSONObject): FirebaseMessaging {
        require(sdk.text("packageName") == context.packageName && sdk.text("projectId") == "dartflow" && Regex("1:[0-9]+:android:[a-fA-F0-9]+").matches(sdk.text("applicationId")))
        val existing = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
        if (existing == null) FirebaseApp.initializeApp(context, FirebaseOptions.Builder().setApplicationId(sdk.getString("applicationId")).setApiKey(sdk.getString("apiKey")).setProjectId("dartflow").setGcmSenderId(sdk.getString("senderId")).build())
        return FirebaseMessaging.getInstance()
    }
    fun initializeCached(context: Context) {
        val current = settings(context)
        if (isEnabled(context, current.text("actorId"))) runCatching { initialize(context, current.obj("sdk")).isAutoInitEnabled = true }
    }
    suspend fun enable(context: Context, api: PlayerApi, actor: String, sdk: JSONObject) {
        require(permitted(context)) { "Systeemmeldingen zijn niet toegestaan. Je meldingen blijven beschikbaar in DartFlow." }
        val current = settings(context)
        val installation = current.text("installationId").ifBlank { UUID.randomUUID().toString() }
        val messaging = initialize(context, sdk)
        messaging.isAutoInitEnabled = true
        try {
        val token = suspendCancellableCoroutine<String> { continuation -> messaging.token.addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }.addOnFailureListener { if (continuation.isActive) continuation.resumeWithException(it) } }
        // Bind before accepting any incoming message; an old account/device binding cannot be reused.
        val result = api.call("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "device.register", "installationId" to installation, "packageName" to context.packageName, "token" to token)))
        store(context).write(json("enabled" to true, "actorId" to actor, "installationId" to installation, "deviceId" to result.text("deviceId"), "token" to token, "sdk" to sdk, "origin" to api.origin, "seen" to JSONArray(), "acks" to JSONArray()))
        } catch (failure: Exception) {
            clearLocal(context)
            throw failure
        }
    }
    suspend fun disable(context: Context, api: PlayerApi?) {
        val current = settings(context)
        clearLocal(context)
        if (api != null && current.text("installationId").isNotBlank()) runCatching { api.call("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "device.revoke", "installationId" to current.text("installationId")))) }
    }
    fun clearLocal(context: Context) {
        val old = settings(context)
        store(context).write(json("installationId" to old.text("installationId"), "enabled" to false))
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancelAll()
        if (FirebaseApp.getApps(context).isNotEmpty()) { FirebaseMessaging.getInstance().isAutoInitEnabled = false; FirebaseMessaging.getInstance().deleteToken() }
    }
    suspend fun sync(context: Context, api: PlayerApi, actor: String) {
        val current = settings(context)
        if (!current.optBoolean("enabled")) return
        if (current.text("actorId") != actor || !permitted(context)) { disable(context, api); return }
        initializeCached(context)
        val token = current.text("token")
        if (token.isNotBlank()) {
            val result = api.call("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "device.register", "installationId" to current.text("installationId"), "packageName" to context.packageName, "token" to token)))
            store(context).update { value -> if (value.text("actorId") == actor && value.optBoolean("enabled")) value.put("deviceId", result.text("deviceId")) else value }
        }
        for (ack in current.rows("acks")) api.call("/push/actions", json("requestId" to ack.text("requestId"), "action" to json("type" to "delivery.ack", "id" to ack.text("id"), "deviceId" to ack.text("deviceId"), "stage" to ack.text("stage"))))
        val sent = current.rows("acks").map { it.text("requestId") }.toSet()
        store(context).update { value -> value.put("acks", JSONArray(value.rows("acks").filter { it.text("requestId") !in sent })) }
    }
    fun rotated(context: Context, token: String) {
        store(context).update { value -> if (value.optBoolean("enabled")) value.put("token", token) else value }
        background.launch { runCatching { backgroundApi(context)?.let { (api, actor) -> sync(context, api, actor) } } }
    }
    private suspend fun backgroundApi(context: Context): Pair<PlayerApi, String>? {
        val push = settings(context); if (!push.optBoolean("enabled") || push.text("origin") != BuildConfig.API_ORIGIN) return null
        val sessionStore = PlayerSessionStore(context); val actor = push.text("actorId"); val api = PlayerApi()
        api.identityProvider = { sessionStore.read().takeIf { it.text("userId") == actor }?.let { PlayerRequestIdentity(actor, 0) } }
        api.bearerProvider = {
            PlayerAuthCoordinator.refresh.withLock {
                var session = sessionStore.read()
                if (session.text("userId") != actor || !isEnabled(context, actor)) throw playerSessionChanged()
                if (session.optLong("expiresAt") <= api.serverNow() + 60000) {
                    val capabilities = api.call("/capabilities", anonymous = true)
                    require(PlayerViewModel.capabilitiesMatch(capabilities, api.origin, BuildConfig.LOCAL_FIXTURES, BuildConfig.AUTH_SCHEME))
                    val fresh = api.authCall(capabilities.obj("auth"), "/token?grant_type=refresh_token", json("refresh_token" to session.text("refreshToken")))
                    sessionStore.update { latest -> if (latest.text("userId") == actor && latest.text("refreshToken") == session.text("refreshToken")) latest.put("accessToken", fresh.getString("access_token")).put("refreshToken", fresh.getString("refresh_token")).put("expiresAt", fresh.optLong("expires_at", System.currentTimeMillis() / 1000 + fresh.optLong("expires_in", 3600)) * 1000) else latest }
                    session = sessionStore.read()
                }
                session.text("accessToken").takeIf { session.text("userId") == actor && it.isNotBlank() }
            }
        }
        return api to actor
    }
    fun receive(context: Context, data: Map<String, String>) {
        val (id, device, category) = playerPushPayload(data) ?: return
        val current = settings(context)
        if (!isEnabled(context, current.text("actorId")) || current.text("deviceId") != device || current.optJSONArray("seen")?.strings()?.contains(id) == true) return
        store(context).update { value -> value.put("seen", JSONArray((value.optJSONArray("seen")?.strings().orEmpty() + id).takeLast(200))).put("acks", JSONArray((value.rows("acks") + json("requestId" to UUID.randomUUID().toString(), "id" to id, "deviceId" to device, "stage" to "received")).takeLast(200))) }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = "dartflow-${playerPushCategories.indexOf(category)}"
        manager.createNotificationChannel(NotificationChannel(channel, "DartFlow · $category", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Algemene meldingen; actuele gegevens staan beveiligd in DartFlow."; lockscreenVisibility = Notification.VISIBILITY_PRIVATE })
        val intent = Intent(context, MainActivity::class.java).putExtra("dartflowPushId", id).putExtra("dartflowPushDevice", device).setAction("nl.dartflow.PUSH.$id").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, channel).setSmallIcon(R.drawable.ic_notification).setContentTitle("DartFlow").setContentText(playerPushBody(category)).setStyle(Notification.BigTextStyle().bigText(playerPushBody(category))).setContentIntent(pending).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build()
        try { manager.notify(id, 1, notification) } catch (_: SecurityException) { return }
        background.launch { runCatching { backgroundApi(context)?.let { (api, actor) -> sync(context, api, actor) } } }
    }
}

class PlayerMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { PlayerPush.rotated(applicationContext, token) }
    override fun onMessageReceived(message: RemoteMessage) { PlayerPush.receive(applicationContext, message.data) }
}
