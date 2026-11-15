package nl.dartflow.app

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.*
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

class MainActivity : ComponentActivity() {
    private val model: PlayerViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        intent?.data?.let { model.handleDeepLink(it.toString()) }
        val scan = {
            val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build()
            GmsBarcodeScanning.getClient(this, options).startScan()
                .addOnSuccessListener { code -> code.rawValue?.let(model::handleDeepLink) }
                .addOnFailureListener { model.reportError("De QR-scanner is niet beschikbaar. Vul de baanlink of wedstrijdcode hieronder in.") }
            Unit
        }
        setContent {
            DartFlowPlayerTheme {
                val state by model.ui.collectAsStateWithLifecycle()
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
                        navigate = model::navigate, refresh = model::refresh, requestOtp = model::requestOtp,
                        verifyOtp = model::verifyOtp, google = model::startGoogle, localLogin = model::localLogin,
                        logout = model::signOut, completeProfile = model::completeProfile, changePin = model::changePin,
                        command = model::command, platformAction = { model.platformAction(it) },
                        score = model::score, matchAction = model::matchAction,
                        retry = model::retryPendingCommand, openLink = model::handleDeepLink,
                        scan = scan, dismiss = model::dismissMessage)
                }
                val mediaScope = rememberCoroutineScope()
                val mediaId = state.match?.takeIf { state.screen == PlayerScreen.MATCH && it.status == "live" && it.raw.optString("scoringMode") == "per-player" }?.id
                val call = remember(mediaId) { mediaId?.let { PlayerVideoCall(applicationContext, model.api, it, mediaScope) } }
                val lifecycle = LocalLifecycleOwner.current.lifecycle
                DisposableEffect(call, lifecycle) {
                    val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) call?.disconnect() }
                    lifecycle.addObserver(observer)
                    onDispose { lifecycle.removeObserver(observer); call?.close() }
                }
                PlayerApp(state, actions, media = { matchId -> if (call != null && matchId == mediaId) PlayerMediaRoom(call) })
            }
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent)
        intent.data?.let { model.handleDeepLink(it.toString()) }
    }
    override fun onStart() { super.onStart(); model.resume() }
    override fun onStop() { model.pause(); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); super.onStop() }
}
