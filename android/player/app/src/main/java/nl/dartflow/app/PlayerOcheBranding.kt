package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import org.json.JSONObject

/** Physical display choices come exclusively from that location's fresh manager
 * context. A personal app preference and another location never contribute. */
internal fun playerDeviceThemeOptions(device: JSONObject, locations: List<JSONObject>): List<Pair<String, String>> {
    val fixed = listOf("dartflow" to "DartFlow", "onzetrots" to "Onze Trots")
    if (device.text("scope") != "location") return fixed
    val location = locations.find { it.text("locationId") == device.text("locationId") && it.optBoolean("canManageScreens") } ?: return fixed
    return fixed + location.rows("brandingClubs").filter { it.text("id").isNotBlank() && it.text("name").isNotBlank() }.distinctBy { it.text("id") }.map { "club:${it.text("id")}" to "Clubstijl · ${it.text("name")}" }
}
@Composable internal fun PlayerDeviceThemeChoice(device: JSONObject, locations: List<JSONObject>, state: PlayerUiState, actions: PlayerActions) {
    val options = playerDeviceThemeOptions(device, locations)
    val requested = if (device.text("theme") == "club") "club:${device.text("brandingClubId")}" else device.text("theme", "dartflow")
    if (requested.startsWith("club:") && options.none { it.first == requested }) Text("De eerder gekozen clubstijl is momenteel niet beschikbaar. Het fysieke scherm valt terug op DartFlow.", color = PlayerMuted)
    Choice("Huisstijl van dit fysieke scherm", requested.takeIf { value -> options.any { it.first == value } } ?: "dartflow", options, { value ->
        val body = if (value.startsWith("club:")) json("action" to "theme", "theme" to "club", "clubId" to value.removePrefix("club:")) else json("action" to "theme", "theme" to value)
        actions.command("/oche/v1/devices/${device.text("id")}", body)
    }, state.online && !state.busy)
}
@Composable internal fun PlayerClubModeration(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    if (!playerClubPermission(view, "chat.moderate")) return
    val reports = view.rows("reports")
    PlayerCard("Besloten moderatiemeldingen") {
        Text("Alleen bevoegde moderators zien deze dossiers. Een melding over jou wordt hier niet als eigen beoordelingszaak aangeboden.", color = PlayerMuted)
        if (reports.isEmpty()) Text("Geen zichtbare moderatiemeldingen.", color = PlayerMuted)
        reports.forEach { PlayerClubModerationReport(it, view.obj("club").text("id"), state, actions) }
    }
}
@Composable private fun PlayerClubModerationReport(report: JSONObject, club: String, state: PlayerUiState, actions: PlayerActions) {
    var operation by androidx.compose.runtime.saveable.rememberSaveable(report.text("id")) { androidx.compose.runtime.mutableStateOf("no-action") }
    var reason by androidx.compose.runtime.saveable.rememberSaveable(report.text("id")) { androidx.compose.runtime.mutableStateOf("") }
    androidx.compose.material3.HorizontalDivider(color = PlayerBorder)
    Text("${report.text("category")} · ${statusLabel(report.text("status"))}", color = PlayerLime)
    Text("${report.text("reporterName")} · ${shortDate(report.text("createdAt"))}", color = PlayerMuted)
    Text(report.text("reason")); report.text("decision").takeIf(String::isNotBlank)?.let { Text(it, color = PlayerMuted) }
    if (report.text("status") in listOf("open", "pending", "reviewing")) {
        Choice("Besluit op deze melding", operation, listOf("no-action" to "Geen maatregel", "warn" to "Waarschuwing", "remove-content" to "Gemelde inhoud verwijderen"), { operation = it }, !state.busy)
        Field("Motivering moderatiebesluit", reason, { reason = it }, !state.busy, multiline = true, max = 1000)
        Action("Moderatiebesluit vastleggen", state.online && !state.busy && reason.trim().length >= 3) { playerClubhouseAction(actions, club, "report.resolve", json("reportId" to report.text("id"), "operation" to operation, "reason" to reason)) }
    }
}
