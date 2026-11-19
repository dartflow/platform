package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import java.util.UUID

@Composable internal fun PlayerPushControls(state: PlayerUiState, actions: PlayerActions) {
    val context = LocalContext.current
    val data = state.resource.obj("push")
    val enabled = !state.busy && state.online
    PlayerCard("Meldingen op dit toestel") {
        Text("Kies zelf of DartFlow ook een systeemmelding mag tonen wanneer de app gesloten is. Op het vergrendelscherm staan algemene teksten; actuele wedstrijdgegevens openen pas na controle van je account en rechten.", color = PlayerMuted)
        if (data.optJSONObject("sdk") == null || !data.optBoolean("transportConfigured")) Text("De verzendkoppeling is voor deze omgeving nog niet volledig ingericht. Je meldingen en acties blijven hier beschikbaar.", color = PlayerMuted)
        val localEnabled = PlayerPush.isEnabled(context, state.profile?.id)
        PlayerToggle("Systeemmeldingen toestaan op dit toestel", localEnabled, enabled && (localEnabled || data.optJSONObject("sdk") != null && data.optBoolean("transportConfigured")), actions.pushConsent)
        Text("Deze categorievoorkeuren gelden ook voor de bestaande e-mailmeldingen.", color = PlayerMuted)
        data.rows("preferences").forEach { preference -> PlayerToggle(preference.text("category"), preference.optBoolean("enabled", true), enabled) { checked -> actions.command("/push/actions", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "preference", "category" to preference.text("category"), "enabled" to checked))) } }
    }
    data.rows("items").forEach { item -> PlayerCard(item.text("category", "Melding")) {
        Text(item.text("body"), color = PlayerMuted)
        Text(shortDate(item.text("createdAt")) + if (item.optBoolean("opened")) " · geopend" else "", color = PlayerMuted)
        if (!item.optBoolean("available")) Text("Verlopen, ingetrokken of geen actuele toegang. Bekijk Vandaag voor je huidige acties.", color = PlayerMuted)
        Action("Controleer en open actuele melding", enabled && item.optBoolean("available"), false) { actions.openNotification(item.text("id")) }
    } }
}
