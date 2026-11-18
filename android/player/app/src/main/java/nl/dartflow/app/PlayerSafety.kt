package nl.dartflow.app

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import org.json.JSONObject

/** Stable IDs only: report text never enters the saved command queue or analytics. */
data class PlayerReportTarget(val type: String, val id: String, val label: String, val scopeKind: String? = null, val scopeId: String? = null)

internal fun playerReportBody(target: PlayerReportTarget, category: String, reason: String): JSONObject =
    json("targetType" to target.type, "targetId" to target.id, "category" to category, "reason" to reason.trim())
        .also { body -> target.scopeKind?.let { body.put("scopeKind", it) }; target.scopeId?.let { body.put("scopeId", it) } }

internal fun canUseCommunity(safety: JSONObject): Boolean = safety.has("requiresAcceptance") && !safety.optBoolean("requiresAcceptance", true)

@Composable internal fun CommunityConsent(state: PlayerUiState, actions: PlayerActions) {
    if (canUseCommunity(state.safety)) return
    var accepted by remember(state.safety.text("rulesVersion")) { mutableStateOf(false) }
    var age by remember { mutableStateOf(false) }
    PlayerCard("Samen veilig darten") {
        Text("Voor je een bericht plaatst: respecteer anderen. Geen intimidatie, haat, seksuele uitbuiting, bedreiging, fraude of het delen van privégegevens zonder toestemming.", color = PlayerMuted)
        Row { Checkbox(age, { age = it }, enabled = !state.busy, modifier = Modifier.testTag("community-age")); Text("Ik ben 13 jaar of ouder.", Modifier.padding(top = 12.dp), fontSize = 13.sp) }
        Row { Checkbox(accepted, { accepted = it }, enabled = !state.busy, modifier = Modifier.testTag("community-accept")); Text("Ik accepteer de communityregels en gebruiksvoorwaarden.", Modifier.padding(top = 12.dp), fontSize = 13.sp) }
        SafetyLink("Communityregels lezen", "/communityregels")
        SafetyLink("Gebruiksvoorwaarden lezen", "/voorwaarden")
        Action("Accepteren en verder", age && accepted && !state.busy && state.safety.text("rulesVersion").isNotBlank(), modifier = Modifier.fillMaxWidth().testTag("accept-community")) {
            actions.command("/safety/consent", json("version" to state.safety.text("rulesVersion"), "accepted" to true, "ageConfirmed" to true))
        }
        Text("Melden en blokkeren kan altijd. Hulp: info@dartflow.nl. Bij direct gevaar bel je 112.", color = PlayerMuted, fontSize = 12.sp)
    }
}

@Composable internal fun SafetyLink(label: String, path: String) {
    val context = LocalContext.current
    TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, "${BuildConfig.API_ORIGIN}$path".toUri())) }) { Text(label) }
}

@Composable internal fun PlayerSafetyControls(state: PlayerUiState, actions: PlayerActions, userId: String, userName: String, content: PlayerReportTarget? = null, blocked: Boolean = false) {
    if (userId.isBlank() || userId == state.profile?.id) return
    var report by remember(userId, content?.id) { mutableStateOf<PlayerReportTarget?>(null) }
    var confirmBlock by remember(userId) { mutableStateOf(false) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        content?.let { target -> TextButton(onClick = { report = target }, enabled = !state.busy) { Text(if (target.type == "reply") "Reactie melden" else "Bericht melden", fontSize = 12.sp) } }
        TextButton(onClick = { report = PlayerReportTarget("user", userId, userName) }, enabled = !state.busy) { Text("Speler melden", fontSize = 12.sp) }
        TextButton(onClick = { confirmBlock = true }, enabled = !state.busy) { Text(if (blocked) "Blokkade opheffen" else "Speler blokkeren", fontSize = 12.sp) }
    }
    report?.let { target -> PlayerReportDialog(state, target, actions, { report = null }) }
    if (confirmBlock) AlertDialog(onDismissRequest = { confirmBlock = false }, title = { Text(if (blocked) "$userName deblokkeren?" else "$userName blokkeren?") },
        text = { Text(if (blocked) "Deze speler kan je weer benaderen volgens je privacykeuzes." else "Nieuwe rechtstreekse interacties worden tegengehouden. Berichten van deze speler worden voor jou verborgen. Een officiële wedstrijd of uitslag wordt hierdoor niet verwijderd. Je kunt de blokkade later bij Vrienden opheffen.") },
        confirmButton = { TextButton(onClick = { actions.command("/safety/block", json("userId" to userId, "blocked" to !blocked)); confirmBlock = false }) { Text(if (blocked) "Deblokkeren" else "Blokkeren") } },
        dismissButton = { TextButton(onClick = { confirmBlock = false }) { Text("Annuleren") } })
}

@Composable internal fun PlayerReportDialog(state: PlayerUiState, target: PlayerReportTarget, actions: PlayerActions, close: () -> Unit) {
    var category by remember(target.id) { mutableStateOf("harassment") }
    var reason by remember(target.id) { mutableStateOf("") }
    ClearSecretsOnBackground { reason = "" }
    val fallback = listOf("harassment" to "Pesten of intimidatie", "hate" to "Haat of discriminatie", "sexual" to "Seksuele inhoud", "child-safety" to "Veiligheid van minderjarigen", "threats" to "Bedreiging of geweld", "scam" to "Fraude of spam", "privacy" to "Schending van privacy", "other" to "Anders")
    val categories = state.safety.rows("reportCategories").map { it.text("id") to it.text("label") }.ifEmpty { fallback }
    AlertDialog(onDismissRequest = close, title = { Text("${target.label} melden") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Alleen bevoegde moderatoren behandelen je melding. Deel geen wachtwoorden, pincodes of onnodige persoonsgegevens.", color = PlayerMuted)
            Choice("Reden", category, categories, { category = it }, !state.busy)
            Field("Toelichting", reason, { reason = it }, !state.busy, error = if (reason.isNotBlank() && reason.trim().length < 5) "Omschrijf kort wat er gebeurt." else null, max = 1500, multiline = true)
            Text("Bij direct gevaar bel je 112. Voor hulp kun je ook mailen naar info@dartflow.nl.", fontSize = 12.sp, color = PlayerMuted)
        }
    }, confirmButton = { TextButton(onClick = { actions.command("/safety/report", playerReportBody(target, category, reason)); reason = ""; close() }, enabled = !state.busy && reason.trim().length >= 5) { Text("Melding versturen") } },
        dismissButton = { TextButton(onClick = { reason = ""; close() }) { Text("Annuleren") } })
}

@Composable internal fun AccountDeletionCard(state: PlayerUiState, actions: PlayerActions) {
    var confirmation by remember { mutableStateOf("") }
    var dialog by remember { mutableStateOf(false) }
    ClearSecretsOnBackground { confirmation = ""; dialog = false }
    val status = state.accountDeletion.text("status", "active")
    PlayerCard("Account en gegevens verwijderen") {
        Text("Vraag verwijdering aan van je DartFlow-account en de bijbehorende persoonsgegevens. Je toegang stopt zodra de server je verzoek accepteert. Je spelerspincode en actieve sessies worden ingetrokken.", color = PlayerMuted)
        Text("Persoonlijke profielen en bijdragen worden verwijderd of geanonimiseerd. Noodzakelijke officiële uitslagen en gegevens die wettelijk of voor beveiliging bewaard moeten blijven, worden volgens het privacybeleid afgehandeld. Dit is geen gewone uitlogactie.", color = PlayerMuted, fontSize = 13.sp)
        if (status != "active") Notice(when (status) { "pending" -> "Je verwijderverzoek is ontvangen."; "processing" -> "Je verwijderverzoek wordt verwerkt."; "completed" -> "De verwijdering is afgerond."; else -> "Status: $status" })
        SafetyLink("Bekijk verwijdering en bewaartermijnen", "/account-verwijderen")
        Text("Voor dit verzoek is een recente aanmelding nodig. Krijg je een verificatiemelding? Log dan opnieuw in via je eigen e-mailcode of Google en keer terug naar Profiel & instellingen.", color = PlayerMuted, fontSize = 12.sp)
        Action("Account verwijderen aanvragen", !state.busy && status == "active", false, Modifier.fillMaxWidth()) { dialog = true }
        Text("Ook zonder de app kun je een verzoek doen via de verwijderpagina of info@dartflow.nl.", color = PlayerMuted, fontSize = 12.sp)
    }
    if (dialog) AlertDialog(onDismissRequest = { dialog = false; confirmation = "" }, title = { Text("Je DartFlow-account verwijderen?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Je vraagt verwijdering van je eigen account aan. Na bevestiging word je uitgelogd en kun je niet verder spelen met dit account. Lees eerst de uitleg over gegevens die verwijderd, geanonimiseerd of noodzakelijk bewaard worden.")
            Field("Typ VERWIJDEREN om te bevestigen", confirmation, { confirmation = it }, !state.busy, max = 11)
        } },
        confirmButton = { TextButton(onClick = { actions.command("/account/deletion", json("confirmation" to "VERWIJDEREN")); confirmation = ""; dialog = false }, enabled = !state.busy && confirmation == "VERWIJDEREN") { Text("Verwijderverzoek bevestigen") } },
        dismissButton = { TextButton(onClick = { dialog = false; confirmation = "" }) { Text("Annuleren") } })
}
