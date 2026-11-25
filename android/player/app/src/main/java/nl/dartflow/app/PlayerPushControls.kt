package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.util.UUID

@Composable internal fun PlayerPushControls(state: PlayerUiState, actions: PlayerActions) {
    val context = LocalContext.current
    val data = state.resource.obj("push")
    val enabled = !state.busy && state.online
    var explain by remember { mutableStateOf(false) }
    var resumed by remember { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) resumed++ }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val permitted = remember(resumed, state.resource) { PlayerPush.permitted(context) }
    val binding = PlayerPush.settings(context)
    val localEnabled = PlayerPush.isEnabled(context, state.profile?.id)
    val device = data.rows("devices").find { it.text("id") == binding.text("deviceId") && it.text("installationId") == binding.text("installationId") && it.optBoolean("enabled") }
    PlayerCard("Meldingen op dit toestel") {
        Text("Kies zelf of DartFlow ook een systeemmelding mag tonen wanneer de app gesloten is. Op het vergrendelscherm staan algemene teksten; actuele wedstrijdgegevens openen pas na controle van je account en rechten.", color = PlayerMuted)
        if (data.optJSONObject("sdk") == null || !data.optBoolean("transportConfigured")) Text("De verzendkoppeling is voor deze omgeving nog niet volledig ingericht. Je meldingen en acties blijven hier beschikbaar.", color = PlayerMuted)
        Text(if (permitted) "Android-toestemming: toegestaan" else "Android-toestemming: niet toegestaan", color = PlayerMuted)
        Action("Open Android-meldingsinstellingen", primary = false, onClick = actions.pushSettings)
        PlayerToggle("Systeemmeldingen toestaan op dit toestel", localEnabled, !state.busy && (localEnabled || state.online && data.optJSONObject("sdk") != null && data.optBoolean("transportConfigured"))) { value -> if (value) explain = true else actions.pushConsent(false) }
        Text("Je accountvoorkeuren voor inbox, e-mail en push staan hierboven. Android kan een kanaal daarnaast blokkeren.", color = PlayerMuted)
        playerPushCategories.filter { !PlayerPush.channelAllowed(context, it) }.forEach { Text("$it is uitgeschakeld in Android.", color = PlayerMuted) }
        device?.let { Text("Laatste geslaagde toestelregistratie: ${shortDate(it.text("lastSeenAt"))}", color = PlayerMuted) }
        Action("Stuur testmelding naar dit toestel", enabled && localEnabled && device != null, false) { actions.command("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "device.test", "installationId" to binding.text("installationId"), "deviceId" to binding.text("deviceId")))) }
        if (device == null) Text("Activeer meldingen en registreer dit toestel voordat je een testmelding verstuurt.", color = PlayerMuted)
        Text("Een geaccepteerd verzendverzoek is nog geen bevestigde ontvangst. Android bepaalt met jouw systeem- en kanaalinstellingen of een melding zichtbaar wordt.", color = PlayerMuted)
        Action("Ververs verzendstatus", enabled, false, onClick = actions.refresh)
    }
    val diagnostics = data.rows("diagnostics").filter { it.text("deviceId") == binding.text("deviceId") }
    if (diagnostics.isNotEmpty()) PlayerCard("Recente verzendingen op dit toestel") {
        Text("FCM-acceptatie, ontvangst door de app en openen zijn afzonderlijke stappen. Ontvangst bevestigt niet dat Android een melding zichtbaar heeft getoond.", color = PlayerMuted)
        diagnostics.take(5).forEach { delivery -> Text(playerPushDiagnosticLabel(delivery), color = PlayerMuted) }
    }
    if (explain) AlertDialog(onDismissRequest = { explain = false }, title = { Text("Wedstrijd- en sociale meldingen") }, text = { Text("DartFlow kan je waarschuwen voor baanoproepen, uitdagingen, vrienden en verenigingsupdates, ook als de app gesloten is. Je kiest de categorieën zelf. Zonder toestemming blijft de app bruikbaar en staan je meldingen hier.") }, confirmButton = { TextButton(onClick = { explain = false; actions.pushConsent(true) }) { Text("Toestaan") } }, dismissButton = { TextButton(onClick = { explain = false }) { Text("Nu niet") } })
}

internal fun playerPushDiagnosticLabel(delivery: org.json.JSONObject): String = when {
    delivery.text("openedAt").isNotBlank() -> "Op dit toestel geopend · ${shortDate(delivery.text("openedAt"))}"
    delivery.text("receivedAt").isNotBlank() -> "Door de app op dit toestel ontvangen · ${shortDate(delivery.text("receivedAt"))}"
    delivery.optBoolean("providerAccepted") -> "Verzendverzoek door FCM geaccepteerd; ontvangst nog niet bevestigd."
    delivery.text("errorCategory").isNotBlank() -> "Verzending nog niet geslaagd · ${delivery.text("errorCategory")}"
    else -> "Verzendstatus: ${delivery.text("status", "in wachtrij")}"
}
