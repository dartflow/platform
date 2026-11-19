package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.coroutines.launch
import org.json.JSONObject

internal fun playerPlanningQuery(values: JSONObject): String {
    val fields = linkedMapOf("players" to values.text("capacity", "16"), "pools" to values.text("poolCount", "4"), "qualifyPerPool" to values.text("planQualify", "2"), "boards" to values.text("boards", "4"), "matchMinutes" to values.text("planMatchMinutes", "20"), "finalMinutes" to values.text("planFinalMinutes", "20"), "restMinutes" to values.text("planRestMinutes", "5"), "changeMinutes" to values.text("planChangeMinutes", "0"), "format" to when (values.text("format")) { "pools-knockout" -> "pools-ko"; "double-elimination-reset", "double-elimination-single" -> "double-elimination"; "swiss" -> "swiss"; else -> "knockout" }, "rounds" to values.text("swissRounds", "3"), "thirdPlace" to values.optBoolean("bronze").toString())
    fields["consolation"] = (values.optBoolean("consolation") && values.text("format") == "knockout").toString()
    listOf("planStartAt" to "startAt", "planDeadline" to "deadline").forEach { (source, target) -> if (values.text(source).isNotBlank()) fields[target] = values.text(source) }
    return "/organizer-planning?" + fields.entries.joinToString("&") { "${it.key}=${PlayerLinks.encode(it.value)}" }
}
internal fun playerPlanningSettings(values: JSONObject): JSONObject = JSONObject().also { result -> PlayerLinks.query(java.net.URI("https://native.invalid" + playerPlanningQuery(values))).forEach { (key, value) -> result.put(key, if (key in listOf("thirdPlace", "consolation")) value == "true" else value) } }

@Composable internal fun PlayerOrganizerPlanning(values: JSONObject, state: PlayerUiState, actions: PlayerActions, change: (String, Any) -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var plan by remember { mutableStateOf<JSONObject?>(null) }
    var plannedQuery by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val query = playerPlanningQuery(values)
    Action(if (expanded) "Sluit programma-inschatting" else "Bereken duur en benodigde banen", !state.busy, false) { expanded = !expanded }
    if (!expanded) return
    PlayerToggle("Bewaar deze planning bij de publicatie", values.optBoolean("planEnabled"), !busy && !state.busy) { change("planEnabled", it) }
    Text("De inschatting houdt rekening met afhankelijkheden, rust en baanwissels. Een echte loting, baanreservering en actuele aanwezigheid volgen bij wedstrijdleiding.", color = PlayerMuted)
    listOf("planQualify" to "Kwalificanten per poule", "planMatchMinutes" to "Verwachte minuten per wedstrijd", "planFinalMinutes" to "Verwachte minuten finale", "planRestMinutes" to "Spelersrust in minuten", "planChangeMinutes" to "Baanwissel in minuten").forEach { (key, label) -> Field(label, values.text(key), { change(key, it) }, !busy && !state.busy, max = 3, keyboard = KeyboardType.Number) }
    Field("Begintijd · optioneel tijdstip met tijdzone", values.text("planStartAt"), { change("planStartAt", it) }, !busy && !state.busy, max = 40)
    Field("Uiterlijke eindtijd · optioneel tijdstip met tijdzone", values.text("planDeadline"), { change("planDeadline", it) }, !busy && !state.busy, max = 40)
    Action(if (busy) "Planning berekenen…" else "Bereken programma-inschatting", !busy && !state.busy && state.online) {
        scope.launch { busy = true; error = null; try { plan = actions.read(query); plannedQuery = query } catch (failure: PlayerApiFailure) { error = failure.feedback } catch (_: Exception) { error = "De planning is tijdelijk niet beschikbaar." } finally { busy = false } }
    }
    error?.let { Notice(it, true) }
    plan?.let { result ->
        if (plannedQuery != query) Text("Invoer gewijzigd · bereken opnieuw voor een actuele inschatting.", color = PlayerLime)
        Text("${result.optInt("matchCount")} partijen · ${result.optInt("totalMatchMinutes")} wedstrijdminuten · mechanische ondergrens ${result.optInt("lowerBoundMinutes")} minuten")
        Text("Geplande duur met rust en afhankelijkheden: ${result.optInt("plannedMinutes")} minuten", color = PlayerLime)
        if (result.text("endAt").isNotBlank()) Text("Verwachte eindtijd: ${shortDate(result.text("endAt"))}")
        result.optJSONArray("warnings")?.strings()?.forEach { Notice(it) }
        if (plannedQuery == query && result.text("endAt").isNotBlank() && values.text("planDeadline").isNotBlank()) {
            val late = runCatching { java.time.Instant.parse(result.text("endAt")).isAfter(java.time.OffsetDateTime.parse(values.text("planDeadline")).toInstant()) }.getOrDefault(false)
            if (late) PlayerToggle("Ik heb de overschrijding van de eindtijd beoordeeld en aanvaard deze planning", values.optBoolean("planAcknowledged"), !state.busy) { change("planAcknowledged", it) }
        }
        result.rows("fixtures").forEach { fixture -> Text("${fixture.text("id")} · baan ${fixture.optInt("board")} · minuut ${fixture.optInt("startMinute")}–${fixture.optInt("endMinute")}", color = PlayerMuted) }
    }
}
