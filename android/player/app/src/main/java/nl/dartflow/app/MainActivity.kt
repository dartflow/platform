package nl.dartflow.app

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.viewModels
import androidx.activity.result.contract.ActivityResultContracts
import android.Manifest
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.*
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

class MainActivity : ComponentActivity() {
    private val model: PlayerViewModel by viewModels()
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (allowed) model.setPushEnabled(true) else model.reportError("Systeemmeldingen zijn niet toegestaan. Je meldingen blijven beschikbaar in DartFlow. Je kunt de toestemming later wijzigen in de Android-instellingen.")
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app always uses its dark palette, including on light Android themes.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.rgb(16, 18, 17)))
        intent?.data?.let { model.handleDeepLink(it.toString()) }
        intent?.getStringExtra("dartflowPushId")?.let(model::handlePushTap)
        setContent {
            DartFlowPlayerTheme {
                val state by model.ui.collectAsStateWithLifecycle()
                var scanning by remember { mutableStateOf(false) }
                LaunchedEffect(state.googleUrl) {
                    state.googleUrl?.let { url ->
                        runCatching { CustomTabsIntent.Builder().build().launchUrl(this@MainActivity, url.toUri()) }
                            .onFailure { model.reportError("Google openen is niet gelukt. Probeer opnieuw of gebruik een e-mailcode.") }
                        model.consumeGoogleUrl()
                    }
                }
                val keepAwake = state.screen == PlayerScreen.MATCH || state.screen == PlayerScreen.TRAINING
                DisposableEffect(keepAwake) {
                    if (keepAwake) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    onDispose { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
                }
                val actions = remember {
                    PlayerActions(
                        request = { path, body -> model.api.call(path, body) },
                        selectGuestOperator = model::selectGuestOperator,
                        pushConsent = { enabled -> if (!enabled || PlayerPush.permitted(this@MainActivity)) model.setPushEnabled(enabled) else if (android.os.Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) },
                        openNotification = model::handlePushTap,
                        read = { model.api.call(it) },
                        navigate = model::navigate, back = model::back, saveOrganizerDraft = model::saveOrganizerDraft, refresh = model::refresh, requestOtp = model::requestOtp,
                        verifyOtp = model::verifyOtp, google = model::startGoogle, localLogin = model::localLogin,
                        reviewLogin = model::reviewLogin,
                        logout = model::signOut, completeProfile = model::completeProfile, changePin = model::changePin,
                        command = model::command, platformAction = { model.platformAction(it) },
                        score = model::score, matchAction = model::matchAction,
                        retry = model::retryPendingCommand, openLink = model::handleDeepLink,
                        scan = { scanning = true }, dismiss = model::dismissMessage)
                }
                val mediaScope = rememberCoroutineScope()
                val mediaId = state.match?.takeIf { state.screen == PlayerScreen.MATCH && it.status in listOf("called", "ready", "live", "result", "disputed") && playerCanMedia(it, state.profile?.id) }?.id
                val call = remember(mediaId) { mediaId?.let { PlayerVideoCall(applicationContext, model.api, it, mediaScope, state.match?.raw?.optBoolean("cameraRequired") == true) } }
                val lifecycle = LocalLifecycleOwner.current.lifecycle
                DisposableEffect(call, lifecycle) {
                    val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) call?.disconnect() }
                    lifecycle.addObserver(observer)
                    onDispose { lifecycle.removeObserver(observer); call?.close() }
                }
                if (scanning) PlayerQrScanner(onCode = { value -> scanning = false; model.handleDeepLink(value) }, onClose = { scanning = false })
                else PlayerApp(state, actions, media = { matchId -> if (call != null && matchId == mediaId) PlayerMediaRoom(call) })
            }
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent)
        intent.data?.let { model.handleDeepLink(it.toString()) }
        intent.getStringExtra("dartflowPushId")?.let(model::handlePushTap)
    }
    override fun onStart() { super.onStart(); model.resume() }
    override fun onStop() { model.pause(); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); super.onStop() }
}
