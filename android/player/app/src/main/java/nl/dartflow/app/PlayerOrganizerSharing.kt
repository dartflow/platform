package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject
import java.time.LocalDate

/** A copy is an empty definition with explicitly chosen ownership, never copied sport results. */
internal fun playerCompetitionCopyCommand(sourceId: String, values: JSONObject): JSONObject {
    val ownership = values.text("ownership")
    require(ownership in listOf("personal", "club", "platform"))
    require(values.text("name").trim().length in 1..80)
    require(values.text("visibility") in listOf("private", "public", "club") && (values.text("visibility") != "club" || ownership == "club"))
    require(ownership != "club" || values.text("clubId").isNotBlank())
    require(values.text("date").isBlank() || runCatching { LocalDate.parse(values.text("date")) }.isSuccess)
    return json("type" to "competition.copy", "id" to sourceId, "name" to values.text("name").trim(), "ownership" to ownership, "visibility" to values.text("visibility")).also {
        if (ownership == "club") it.put("clubId", values.text("clubId"))
        if (values.text("date").isNotBlank()) it.put("date", values.text("date"))
    }
}

@Composable internal fun PlayerOrganizerSharing(event: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val enabled = !state.busy && state.online
    var name by rememberSaveable(event.text("id")) { mutableStateOf("${event.text("name").take(60)} · nieuw") }
    var date by rememberSaveable { mutableStateOf("") }
    var ownership by rememberSaveable { mutableStateOf("personal") }
    var clubId by rememberSaveable { mutableStateOf("") }
    var visibility by rememberSaveable { mutableStateOf("private") }
    var search by rememberSaveable { mutableStateOf("") }
    var userId by rememberSaveable { mutableStateOf("") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val clubs = if (event.text("kind") == "league") state.platform.rows("clubs").filter { it.obj("clubAccess").optJSONArray("permissions")?.strings()?.contains("competitions.manage") == true } else PlayerOrganizerDraft.clubs(state.platform)
    PlayerCard("Evenementdefinitie kopiëren") {
        Text("Maak een leeg nieuw evenement met dezelfde speeldefinitie. Deelnemers, uitslagen en officiële rankingrechten worden opnieuw vastgelegd.", color = PlayerMuted)
        Field("Naam nieuw evenement", name, { name = it }, enabled, max = 80)
        Field("Nieuwe datum · optioneel jjjj-mm-dd", date, { date = it }, enabled, max = 10)
        Choice("Nieuwe eigenaar", ownership, listOf("personal" to "Ikzelf") + (if (clubs.isNotEmpty()) listOf("club" to "Mijn vereniging") else emptyList()) + (if (state.canManagePlatform) listOf("platform" to "DartFlow") else emptyList()), { ownership = it; clubId = ""; visibility = "private" }, enabled)
        if (ownership == "club") Choice("Nieuwe vereniging", clubId, listOf("" to "Kies bevoegde vereniging") + clubs.map { it.text("id") to it.text("name") }, { clubId = it }, enabled)
        Choice("Zichtbaarheid nieuwe kopie", visibility, listOf("private" to "Besloten", "public" to "Openbaar") + if (ownership == "club") listOf("club" to "Alleen vereniging") else emptyList(), { visibility = it }, enabled)
        val values = json("name" to name, "date" to date, "ownership" to ownership, "clubId" to clubId, "visibility" to visibility)
        Action("Controleer lege kopie", enabled && runCatching { playerCompetitionCopyCommand(event.text("id"), values) }.isSuccess, false) { pending = playerCompetitionCopyCommand(event.text("id"), values) }
    }
    if (event.text("ownerId") == state.profile?.id) PlayerCard("Medeorganisatoren") {
        Text("Alleen de eigenaar verleent of trekt deze evenementtoegang in. Bij een clubevenement moet de medeorganisator ook actueel clubbeheerrecht hebben.", color = PlayerMuted)
        event.rows("members").filter { it.text("role") == "organizer" && it.text("id") != event.text("ownerId") }.forEach { Text(it.text("displayName", it.text("name")), color = PlayerLime) }
        Field("Zoek bekend spelersaccount", search, { search = it }, enabled, max = 100)
        val candidates = (state.platform.rows("players") + event.rows("members")).distinctBy { it.text("id") }.filter { it.text("id") != event.text("ownerId") && (search.isBlank() || "${it.text("name")} ${it.text("displayName")} ${it.text("username")}".contains(search, true)) }.take(100)
        Choice("Medeorganisator", userId, listOf("" to "Kies account") + candidates.map { it.text("id") to it.text("displayName", it.text("name")) }, { userId = it }, enabled)
        Action("Verleen evenementtoegang", enabled && candidates.any { it.text("id") == userId }) { pending = json("type" to "competition.coorganizer", "id" to event.text("id"), "userId" to userId, "enabled" to true) }
        Action("Trek evenementtoegang in", enabled && candidates.any { it.text("id") == userId }, false) { pending = json("type" to "competition.coorganizer", "id" to event.text("id"), "userId" to userId, "enabled" to false) }
    }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(if (command.text("type") == "competition.copy") "Leeg evenement aanmaken?" else if (command.optBoolean("enabled")) "Medeorganisator toevoegen?" else "Evenementtoegang intrekken?") }, text = { Text(if (command.text("type") == "competition.copy") "${command.text("name")} krijgt de gekozen eigenaar en zichtbaarheid. Eerdere sportresultaten en rankingrechten blijven bij het bronevenement." else "Deze wijziging geldt voor dit ene evenement. De server controleert de actuele account- en organisatierechten.") }, confirmButton = { TextButton(onClick = { pending = null; entityCommand(actions, event, command) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}
