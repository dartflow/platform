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
import com.google.firebase.installations.FirebaseInstallations
import com.google.android.gms.tasks.Task
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal object PlayerAuthCoordinator { val refresh = Mutex() }
internal val playerPushCategories = listOf("Sociaal", "Wedstrijden", "Competitie", "Toernooien")
internal fun playerPushChannelId(category: String) = "dartflow-${playerPushCategories.indexOf(category)}"
internal fun playerPushCategoryEnabled(binding: JSONObject, category: String): Boolean = category in playerPushCategories && binding.rows("preferences").none { it.text("category") == category && !it.optBoolean("enabled", true) }
internal fun playerPushRegistration(installation: String, packageName: String, fid: String) = json("type" to "device.register", "installationId" to installation, "packageName" to packageName, "firebaseInstallationId" to fid, "sdkVersion" to "26.0.2")
internal fun playerPendingNotification(value: JSONObject, origin: String): String? = value.text("id").takeIf { value.text("origin") == origin && runCatching { UUID.fromString(it).toString() == it }.getOrDefault(false) }
internal suspend fun <T> Task<T>.playerAwait(): T = suspendCancellableCoroutine { continuation -> addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }; addOnFailureListener { if (continuation.isActive) continuation.resumeWithException(it) }; addOnCanceledListener { continuation.cancel() } }
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
    private val lifecycle = Mutex()
    private val epoch = AtomicLong()
    private val receiptLock = Any()
    private fun store(context: Context) = PlayerSessionStore(context.applicationContext, "push")
    fun settings(context: Context): JSONObject = store(context).read()
    fun permitted(context: Context) = (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) && (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()
    fun channels(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val labels = listOf("Sociaal en uitdagingen", "Wedstrijden en baanoproepen", "Competities en verenigingsupdates", "Toernooien")
        playerPushCategories.forEachIndexed { index, category -> manager.createNotificationChannel(NotificationChannel(playerPushChannelId(category), "DartFlow · ${labels[index]}", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Open DartFlow voor de actuele informatie en je categorievoorkeuren."; lockscreenVisibility = Notification.VISIBILITY_PRIVATE }) }
    }
    fun channelAllowed(context: Context, category: String): Boolean = (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).getNotificationChannel(playerPushChannelId(category))?.importance != NotificationManager.IMPORTANCE_NONE
    fun updatePreferences(context: Context, actor: String?, data: JSONObject) {
        store(context).update { value -> if (value.text("actorId") == actor && value.optBoolean("enabled")) value.put("preferences", data.optJSONArray("preferences") ?: JSONArray()) else value }
    }
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
        channels(context)
        val current = settings(context)
        if (isEnabled(context, current.text("actorId"))) runCatching { initialize(context, current.obj("sdk")).isAutoInitEnabled = true }
    }
    suspend fun enable(context: Context, api: PlayerApi, actor: String, sdk: JSONObject) = lifecycle.withLock {
        require(permitted(context)) { "Systeemmeldingen zijn niet toegestaan. Je meldingen blijven beschikbaar in DartFlow." }
        require(api.origin == BuildConfig.API_ORIGIN && PlayerSessionStore(context).read().text("userId") == actor) { "Je account is gewijzigd. Open de actuele instellingen opnieuw." }
        channels(context)
        val current = settings(context)
        val installation = current.text("installationId").ifBlank { UUID.randomUUID().toString() }
        val started = epoch.get()
        val messaging = initialize(context, sdk)
        messaging.isAutoInitEnabled = true
        try {
        messaging.register().playerAwait()
        val fid = FirebaseInstallations.getInstance().id.playerAwait()
        require(started == epoch.get() && PlayerSessionStore(context).read().text("userId") == actor) { "Je account is gewijzigd. Schakel meldingen opnieuw in voor je huidige account." }
        // Bind before accepting any incoming message; an old account/device binding cannot be reused.
        val result = api.call("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to playerPushRegistration(installation, context.packageName, fid)))
        require(started == epoch.get() && PlayerSessionStore(context).read().text("userId") == actor) { "Je account is gewijzigd. Schakel meldingen opnieuw in voor je huidige account." }
        store(context).write(json("enabled" to true, "actorId" to actor, "installationId" to installation, "deviceId" to result.text("deviceId"), "firebaseInstallationId" to fid, "sdk" to sdk, "origin" to api.origin, "registeredAt" to System.currentTimeMillis(), "seen" to JSONArray(), "acks" to JSONArray()))
        } catch (failure: Exception) {
            if (started == epoch.get()) clearLocal(context)
            throw failure
        }
    }
    suspend fun disable(context: Context, api: PlayerApi?) {
        val current = settings(context)
        clearLocal(context)
        if (api != null && current.text("installationId").isNotBlank()) runCatching { api.call("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "device.revoke", "installationId" to current.text("installationId")))) }
    }
    fun clearLocal(context: Context) = synchronized(receiptLock) {
        epoch.incrementAndGet()
        val old = settings(context)
        store(context).write(json("installationId" to old.text("installationId"), "enabled" to false))
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancelAll()
        if (FirebaseApp.getApps(context).isNotEmpty()) {
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
            background.launch { lifecycle.withLock { if (!settings(context).optBoolean("enabled")) runCatching { FirebaseMessaging.getInstance().unregister().playerAwait() } } }
        }
    }
    suspend fun sync(context: Context, api: PlayerApi, actor: String) = lifecycle.withLock { syncRegistration(context, api, actor) }
    private suspend fun syncRegistration(context: Context, api: PlayerApi, actor: String) {
        val current = settings(context)
        if (!current.optBoolean("enabled")) return
        if (current.text("actorId") != actor || !permitted(context)) { disable(context, api); return }
        initializeCached(context)
        var fid = current.text("firebaseInstallationId")
        if (fid.isBlank()) {
            initialize(context, current.obj("sdk")).register().playerAwait()
            fid = FirebaseInstallations.getInstance().id.playerAwait()
        }
        if (fid.isNotBlank() && isEnabled(context, actor)) {
            val result = api.call("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to playerPushRegistration(current.text("installationId"), context.packageName, fid)))
            store(context).update { value -> if (value.text("actorId") == actor && value.optBoolean("enabled")) value.put("deviceId", result.text("deviceId")).put("registeredAt", System.currentTimeMillis()).also { if (it.text("firebaseInstallationId").isBlank() || it.text("firebaseInstallationId") == current.text("firebaseInstallationId")) it.put("firebaseInstallationId", fid); it.remove("token") } else value }
        }
        for (ack in current.rows("acks")) api.call("/push/actions", json("requestId" to ack.text("requestId"), "action" to json("type" to "delivery.ack", "id" to ack.text("id"), "deviceId" to ack.text("deviceId"), "stage" to ack.text("stage"))))
        val sent = current.rows("acks").map { it.text("requestId") }.toSet()
        store(context).update { value -> value.put("acks", JSONArray(value.rows("acks").filter { it.text("requestId") !in sent })) }
    }
    fun registered(context: Context, fid: String) {
        val session = PlayerSessionStore(context).read()
        store(context).update { value -> if (playerPushBindingAllowed(value, session, session.text("userId"), BuildConfig.API_ORIGIN, permitted(context))) value.put("firebaseInstallationId", fid) else value }
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
    fun receive(context: Context, data: Map<String, String>) = synchronized(receiptLock) {
        val (id, device, category) = playerPushPayload(data) ?: return@synchronized
        val current = settings(context)
        if (!isEnabled(context, current.text("actorId")) || current.text("deviceId") != device || !playerPushCategoryEnabled(current, category) || current.optJSONArray("seen")?.strings()?.contains(id) == true) return@synchronized
        store(context).update { value -> value.put("seen", JSONArray((value.optJSONArray("seen")?.strings().orEmpty() + id).takeLast(200))).put("acks", JSONArray((value.rows("acks") + json("requestId" to UUID.randomUUID().toString(), "id" to id, "deviceId" to device, "stage" to "received")).takeLast(200))) }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = playerPushChannelId(category)
        channels(context)
        val intent = Intent(context, MainActivity::class.java).putExtra("dartflowPushId", id).putExtra("dartflowPushDevice", device).setAction("nl.dartflow.PUSH.$id").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, channel).setSmallIcon(R.drawable.ic_notification).setContentTitle("DartFlow").setContentText(playerPushBody(category)).setStyle(Notification.BigTextStyle().bigText(playerPushBody(category))).setContentIntent(pending).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build()
        if (channelAllowed(context, category)) try { manager.notify(id, 1, notification) } catch (_: SecurityException) { /* Receipt remains real; Android did not allow a visible notification. */ }
        background.launch { runCatching { backgroundApi(context)?.let { (api, actor) -> sync(context, api, actor) } } }
    }
}

class PlayerMessagingService : FirebaseMessagingService() {
    override fun onRegistered(installationId: String) { PlayerPush.registered(applicationContext, installationId) }
    override fun onMessageReceived(message: RemoteMessage) { PlayerPush.receive(applicationContext, message.data) }
}
