@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

internal fun playerWizardSelection(values: List<String>, id: String, checked: Boolean) = (if (checked) values + id else values - id).distinct()
internal fun playerWizardTeam(context: JSONObject, id: String): JSONObject? = context.rows("teams").find { it.text("id") == id }?.let { source ->
    json("id" to source.text("id"), "name" to source.text("name"), "captainId" to source.text("captainId"), "deputyId" to source.text("deputyId").ifBlank { null }, "playerIds" to JSONArray(source.optJSONArray("playerIds")?.strings().orEmpty()), "reserveIds" to JSONArray(source.optJSONArray("reserveIds")?.strings().orEmpty()))
}
internal fun playerWizardStepError(config: JSONObject, step: Int): String? = when (step) {
    1 -> if (config.text("title").isBlank() || config.text("season").isBlank() || config.text("organizerName").isBlank()) "Vul de naam, het seizoen en de organisator in." else null
    2 -> if ((if (config.text("variant") == "singles") config.optJSONArray("playerIds")?.length() ?: 0 else config.rows("teams").size) < 2) "Kies ten minste twee deelnemers of teams uit je eigen vereniging." else null
    4 -> if ((config.optJSONArray("boardIds")?.length() ?: 0) < 1) "Kies ten minste één expliciet gekoppelde eigen baan." else null
    5 -> runCatching {
        val p = config.obj("planning"); LocalDate.parse(p.text("startDate")); p.text("endDate").takeIf(String::isNotBlank)?.let(LocalDate::parse); LocalTime.parse(p.text("startTime")); LocalTime.parse(p.text("endTime")); ZoneId.of(p.text("timezone")); require((p.optJSONArray("weekdays")?.length() ?: 0) > 0); require(p.optInt("matchMinutes") > 0); null
    }.getOrElse { "Controleer de datum, tijden, tijdzone, speeldagen en wedstrijdduur." }
    else -> null
}
@Composable internal fun PlayerWizardBasis(config: JSONObject, context: JSONObject, enabled: Boolean, changed: (JSONObject) -> Unit) {
    fun set(key: String, value: Any?) = changed(JSONObject(config.toString()).put(key, value ?: JSONObject.NULL))
    PlayerCard("Basisgegevens") {
        Field("Competitienaam", config.text("title"), { set("title", it) }, enabled, max = 120)
        Field("Seizoen", config.text("season"), { set("season", it) }, enabled, max = 80)
        Field("Beschrijving", config.text("description"), { set("description", it) }, enabled, multiline = true, max = 4000)
        Field("Organisator", config.text("organizerName"), { set("organizerName", it) }, enabled, max = 120)
        val formats = context.rows("formats")
        Choice("Deelnamevorm", config.text("variant"), formats.map { it.text("variant") to when (it.text("variant")) { "doubles" -> "Koppels"; "teams" -> "Teams"; else -> "Singles" } }, { variant ->
            val next = JSONObject(config.toString()).put("variant", variant).put("playerIds", JSONArray()).put("teams", JSONArray())
            val systems = formats.find { it.text("variant") == variant }?.optJSONArray("systems")?.strings().orEmpty()
            if (next.text("system") !in systems) next.put("system", systems.firstOrNull() ?: "round-robin")
            changed(next)
        }, enabled)
        val systems = formats.find { it.text("variant") == config.text("variant") }?.optJSONArray("systems")?.strings().orEmpty()
        Choice("Competitiesysteem", config.text("system"), systems.map { it to if (it == "knockout") "Knock-out" else "Iedereen tegen iedereen" }, { system -> val next = JSONObject(config.toString()).put("system", system); if (system == "knockout") next.obj("planning").put("returnLegs", false); changed(next) }, enabled)
    }
}
@Composable internal fun PlayerWizardParticipants(config: JSONObject, context: JSONObject, enabled: Boolean, changed: (JSONObject) -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    Field("Zoek in eigen actieve clubleden", search, { search = it }, enabled, max = 80)
    if (config.text("variant") == "singles") {
        val selected = config.optJSONArray("playerIds")?.strings().orEmpty()
        Text("${selected.size} spelers geselecteerd", color = PlayerLime)
        context.rows("players").filter { playerPublicName(it).contains(search, true) || it.text("username").contains(search, true) }.forEach { player ->
            PlayerToggle(playerPublicName(player), player.text("id") in selected, enabled && player.optBoolean("eligible")) { checked -> changed(JSONObject(config.toString()).put("playerIds", JSONArray(playerWizardSelection(selected, player.text("id"), checked)))) }
            if (!player.optBoolean("eligible")) Text(player.text("reason", "Niet beschikbaar voor deelname"), color = PlayerMuted)
        }
    } else {
        Text("Kies bestaande actieve clubteams. De volledige basis en reserves worden vastgelegd; gewijzigde roosters moeten opnieuw worden gekozen.", color = PlayerMuted)
        val selected = config.rows("teams")
        context.rows("teams").filter { it.text("name").contains(search, true) }.forEach { team ->
            val id = team.text("id"); val chosen = selected.find { it.text("id") == id }
            PlayerCard(team.text("name")) {
                PlayerToggle("Team opnemen", chosen != null, enabled) { checked -> changed(JSONObject(config.toString()).put("teams", JSONArray(if (checked) selected + listOfNotNull(playerWizardTeam(context, id)) else selected.filter { it.text("id") != id }))) }
                val roster = team.optJSONArray("playerIds")?.strings().orEmpty(); val reserves = team.optJSONArray("reserveIds")?.strings().orEmpty()
                roster.forEach { playerId -> Text((context.rows("players").find { it.text("id") == playerId }?.let(::playerPublicName) ?: "Clublid") + if (playerId in reserves) " · reserve" else "") }
                if (chosen != null) {
                    val options = roster.map { playerId -> playerId to (context.rows("players").find { it.text("id") == playerId }?.let(::playerPublicName) ?: "Clublid") }
                    fun update(key: String, value: Any?) { changed(JSONObject(config.toString()).put("teams", JSONArray(selected.map { if (it.text("id") == id) JSONObject(it.toString()).put(key, value ?: JSONObject.NULL) else it }))) }
                    Choice("Captain", chosen.text("captainId"), options, { update("captainId", it) }, enabled)
                    Choice("Plaatsvervangend captain", chosen.text("deputyId"), listOf("" to "Geen") + options.filter { it.first != chosen.text("captainId") }, { update("deputyId", it.ifBlank { null }) }, enabled)
                    Action("Actueel teamrooster opnieuw overnemen", enabled, false) { changed(JSONObject(config.toString()).put("teams", JSONArray(selected.map { if (it.text("id") == id) playerWizardTeam(context, id) else it }))) }
                }
            }
        }
        if (context.rows("teams").isEmpty()) Text("Maak eerst een clubteam met eigen actieve leden op de Clubhouse-pagina Teams.", color = PlayerMuted)
    }
}
@Composable internal fun PlayerWizardRules(config: JSONObject, enabled: Boolean, changed: (JSONObject) -> Unit) {
    val rules = config.obj("rules")
    fun set(key: String, value: Any?) = changed(JSONObject(config.toString()).put("rules", JSONObject(rules.toString()).put(key, value ?: JSONObject.NULL)))
    PlayerCard("Scoreprofiel en startprocedure") {
        Choice("Startscore", rules.optInt("startScore", 501).toString(), listOf("301", "501", "701").map { it to it }, { score -> changed(JSONObject(config.toString()).put("rules", JSONObject(rules.toString()).put("startScore", score.toInt()).put("inRule", playerFreshStartInRule(score.toInt())))) }, enabled)
        Choice("Openen", rules.text("inRule", "single"), listOf("single" to "Single in", "double" to "Dubbel in"), { set("inRule", it) }, enabled)
        Choice("Uitgooien", rules.text("outRule", "double"), listOf("double" to "Dubbel uit", "straight" to "Straight uit", "master" to "Master uit"), { set("outRule", it) }, enabled)
        Choice("Legs", rules.text("legMode", "bestOf"), listOf("bestOf" to "Best of", "fixed" to "Vast aantal"), { set("legMode", it) }, enabled)
        Field("Aantal legs", rules.optInt("legs", 5).toString(), { set("legs", it.toIntOrNull() ?: 0) }, enabled, keyboard = androidx.compose.ui.text.input.KeyboardType.Number, max = 2)
        Choice("Best of sets", rules.optInt("bestOfSets", 1).toString(), listOf("1", "3", "5").map { it to it }, { set("bestOfSets", it.toInt()) }, enabled)
        PlayerStartSettingsFields(rules, enabled) { key, value -> set(key, value) }
        PlayerToggle("Handicap per zijde", rules.has("sideStartScores"), enabled) { on -> val next = JSONObject(rules.toString()); if (on) next.put("sideStartScores", JSONArray(listOf(rules.optInt("startScore", 501), rules.optInt("startScore", 501)))) else next.remove("sideStartScores"); changed(JSONObject(config.toString()).put("rules", next)) }
        if (rules.has("sideStartScores")) repeat(2) { index -> Field("Handicapstart zijde ${index + 1}", rules.optJSONArray("sideStartScores")?.optInt(index).toString(), { value -> val scores = JSONArray(rules.optJSONArray("sideStartScores")?.toString() ?: "[501,501]"); scores.put(index, value.toIntOrNull() ?: 0); set("sideStartScores", scores) }, enabled, keyboard = androidx.compose.ui.text.input.KeyboardType.Number, max = 4) }
        for ((key, label) in listOf("legWinByTwo" to "Legs", "setWinByTwo" to "Sets")) {
            PlayerToggle("$label winnen met twee verschil", rules.has(key), enabled && rules.text("legMode", "bestOf") == "bestOf") { on -> val next = JSONObject(rules.toString()); if (on) next.put(key, json("maximum" to 9)) else next.remove(key); changed(JSONObject(config.toString()).put("rules", next)) }
            if (rules.has(key)) Field("$label harde bovengrens", rules.obj(key).optInt("maximum", 9).toString(), { set(key, json("maximum" to (it.toIntOrNull() ?: 0))) }, enabled, keyboard = androidx.compose.ui.text.input.KeyboardType.Number, max = 2)
        }
        if (config.text("variant") == "teams") Choice("Onderdelen per ontmoeting", rules.optInt("slotCount", 4).toString(), listOf("4" to "4 singles", "7" to "4 singles, 2 koppels en 1 teampartij"), { set("slotCount", it.toInt()) }, enabled)
    }
    PlayerCard("Punten en rangschikking") {
        listOf("pointsWin" to "Punten winst", "pointsDraw" to "Punten gelijk", "pointsLoss" to "Punten verlies").forEach { (key, label) -> Field(label, rules.optInt(key).toString(), { set(key, it.toIntOrNull() ?: 0) }, enabled, keyboard = androidx.compose.ui.text.input.KeyboardType.Number, max = 3) }
        val criteria = rules.optJSONArray("tiebreaks")?.strings().orEmpty()
        val labels = mapOf("points" to "Punten", "leg-difference" to "Legsaldo", "legs-for" to "Legs voor", "head-to-head" to "Onderling resultaat")
        criteria.forEachIndexed { index, criterion -> Text("${index + 1}. ${labels[criterion] ?: criterion}"); if (index > 0) Action("${labels[criterion]} hoger", enabled, false) { val order = criteria.toMutableList(); order[index] = order[index - 1]; order[index - 1] = criterion; set("tiebreaks", JSONArray(order)) } }
        Text("De definitieve validatie en het gepubliceerde reglement komen uit dezelfde centrale regels als op web.", color = PlayerMuted)
    }
}
@Composable internal fun PlayerWizardBoards(config: JSONObject, context: JSONObject, state: PlayerUiState, actions: PlayerActions, enabled: Boolean, changed: (JSONObject) -> Unit) {
    val selected = config.optJSONArray("boardIds")?.strings().orEmpty(); val own = playerWizardOwnBoards(context)
    Text("Alleen expliciet aan deze vereniging gekoppelde locaties en banen zijn selecteerbaar. Planningstoegang geeft geen apparaatbeheer.", color = PlayerMuted)
    context.rows("locations").forEach { location -> PlayerCard(location.text("name")) { Text("${location.text("timezone")} · gekoppeld tijdvak ${shortDate(location.text("startsAt"))} – ${shortDate(location.text("endsAt"))}", color = PlayerMuted); location.rows("windows").forEach { Text("Dag ${it.optInt("weekday")} · ${it.text("startTime")}–${it.text("endTime")}", color = PlayerMuted) }; location.rows("boards").forEach { board -> PlayerToggle(board.text("name"), board.text("id") in selected, enabled) { checked -> changed(JSONObject(config.toString()).put("boardIds", JSONArray(playerWizardSelection(selected, board.text("id"), checked)))) } } } }
    if (own.isEmpty()) Notice("Geen gekoppelde eigen banen. Een actuele locatiebeheerder moet eerst beperkte planningstoegang verlenen.", true)
    val stale = selected.filter { id -> own.none { it.text("id") == id } }
    if (stale.isNotEmpty()) { Notice("${stale.size} eerder gekozen banen zijn niet meer gekoppeld. Ze worden niet opnieuw selecteerbaar gemaakt.", true); Action("Vervallen selecties verwijderen", enabled, false) { changed(JSONObject(config.toString()).put("boardIds", JSONArray(selected - stale.toSet()))) } }
    PlayerWizardPlanningGrant(context, state, actions)
}
@Composable private fun PlayerWizardPlanningGrant(context: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val locations = context.rows("managedLocations"); if (locations.isEmpty() && context.rows("grants").none { it.optBoolean("canManage") }) return
    var locationId by rememberSaveable { mutableStateOf("") }; var boards by rememberSaveable { mutableStateOf(emptyList<String>()) }; var day by rememberSaveable { mutableStateOf("2") }; var from by rememberSaveable { mutableStateOf("19:00") }; var until by rememberSaveable { mutableStateOf("23:00") }; var reason by rememberSaveable { mutableStateOf("") }
    PlayerCard("Planningstoegang als locatiebeheerder") {
        Text("Deze bediening verschijnt alleen voor werkelijk door jou beheerde locaties. Toestemming wordt op de server opnieuw gecontroleerd.", color = PlayerMuted)
        Choice("Eigen beheerde locatie", locationId, listOf("" to "Kies locatie") + locations.map { it.text("id") to it.text("name") }, { locationId = it; boards = emptyList() }, !state.busy)
        locations.find { it.text("id") == locationId }?.rows("boards")?.filter { it.optBoolean("active") }?.forEach { board -> PlayerToggle(board.text("name"), board.text("id") in boards, !state.busy) { boards = playerWizardSelection(boards, board.text("id"), it) } }
        Choice("Wekelijkse speeldag", day, listOf("0" to "Zondag", "1" to "Maandag", "2" to "Dinsdag", "3" to "Woensdag", "4" to "Donderdag", "5" to "Vrijdag", "6" to "Zaterdag"), { day = it })
        Field("Toegang vanaf (HH:mm)", from, { from = it }, max = 5); Field("Toegang tot (HH:mm)", until, { until = it }, max = 5); Field("Reden planningstoegang", reason, { reason = it }, max = 500)
        Action("Planningstoegang verlenen", state.online && !state.busy && locationId.isNotBlank() && boards.isNotEmpty() && reason.length >= 3) { val current = context.rows("grants").find { it.text("locationId") == locationId && it.text("status") == "active" }; actions.command("/competition-wizard", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "planning.grant", "clubId" to context.obj("club").text("id"), "locationId" to locationId, "expectedRevision" to (current?.optInt("revision") ?: 0), "boardIds" to JSONArray(boards), "windows" to JSONArray(listOf(json("weekday" to day.toInt(), "startTime" to from, "endTime" to until))), "reason" to reason))) }
        context.rows("grants").filter { it.optBoolean("canManage") && it.text("status") == "active" }.forEach { grant -> Text("Actieve koppeling · ${locations.find { it.text("id") == grant.text("locationId") }?.text("name") ?: "Locatie"}"); Action("Planningstoegang intrekken", state.online && !state.busy && reason.length >= 3, false) { actions.command("/competition-wizard", json("requestId" to UUID.randomUUID().toString(), "action" to json("type" to "planning.revoke", "id" to grant.text("id"), "expectedRevision" to grant.optInt("revision"), "reason" to reason))) } }
    }
}
@Composable internal fun PlayerWizardPlanning(config: JSONObject, preview: JSONObject, enabled: Boolean, changed: (JSONObject) -> Unit) {
    val plan = config.obj("planning"); fun set(key: String, value: Any?) = changed(JSONObject(config.toString()).put("planning", JSONObject(plan.toString()).put(key, value ?: JSONObject.NULL)))
    PlayerCard("Speelkalender") {
        Field("Begindatum (JJJJ-MM-DD)", plan.text("startDate"), { set("startDate", it) }, enabled, max = 10); Field("Uiterste einddatum (optioneel)", plan.text("endDate"), { set("endDate", it.ifBlank { null }) }, enabled, max = 10)
        val days = plan.optJSONArray("weekdays")?.ints().orEmpty(); listOf("Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag").forEachIndexed { index, label -> PlayerToggle(label, index in days, enabled) { checked -> set("weekdays", JSONArray(if (checked) (days + index).distinct() else days - index)) } }
        Field("Aanvang speelavond (HH:mm)", plan.text("startTime"), { set("startTime", it) }, enabled, max = 5); Field("Einde speelavond (HH:mm)", plan.text("endTime"), { set("endTime", it) }, enabled, max = 5); Field("Tijdzone", plan.text("timezone"), { set("timezone", it) }, enabled, max = 80)
        Field("Wedstrijdduur in minuten", plan.optInt("matchMinutes", 30).toString(), { set("matchMinutes", it.toIntOrNull() ?: 0) }, enabled, keyboard = androidx.compose.ui.text.input.KeyboardType.Number, max = 3); Field("Wisseltijd in minuten", plan.optInt("changeMinutes", 5).toString(), { set("changeMinutes", it.toIntOrNull() ?: 0) }, enabled, keyboard = androidx.compose.ui.text.input.KeyboardType.Number, max = 3)
        PlayerToggle("Retourwedstrijden", plan.optBoolean("returnLegs"), enabled && config.text("system") == "round-robin") { set("returnLegs", it) }
        Choice("Vrijgeven volgende ronde", plan.text("roundGating", "manual"), listOf("manual" to "Handmatig door leiding", "automatic" to "Automatisch na alle bevestigde uitslagen"), { set("roundGating", it) }, enabled)
        Field("Uitgesloten datums (één per regel)", plan.optJSONArray("excludedDates")?.strings()?.joinToString("\n").orEmpty(), { set("excludedDates", JSONArray(it.lines().filter(String::isNotBlank))) }, enabled, multiline = true, max = 1500)
        plan.rows("breaks").forEachIndexed { index, pause -> fun edit(key: String, value: String) { val rows = JSONArray(plan.optJSONArray("breaks")?.toString() ?: "[]"); rows.getJSONObject(index).put(key, value); set("breaks", rows) }; Field("Pauze ${index + 1} vanaf", pause.text("startTime"), { edit("startTime", it) }, enabled, max = 5); Field("Pauze ${index + 1} tot", pause.text("endTime"), { edit("endTime", it) }, enabled, max = 5); Action("Pauze ${index + 1} verwijderen", enabled, false) { set("breaks", JSONArray(plan.rows("breaks").filterIndexed { i, _ -> i != index })) } }
        Action("Pauze toevoegen", enabled, false) { set("breaks", JSONArray(plan.rows("breaks") + json("startTime" to "21:00", "endTime" to "21:15"))) }
        Text("Niet-bestaande lokale tijden en dubbele wintertijden worden expliciet gecontroleerd; een preview boekt nog geen baan.", color = PlayerMuted)
        preview.rows("issues").filter { it.text("code").contains("ambiguous") || it.text("code").contains("offset") }.forEach { issue -> Text(issue.text("message"), color = PlayerError) }
        var dateTime by rememberSaveable { mutableStateOf("") }; var offset by rememberSaveable { mutableStateOf("+02:00") }
        Field("Expliciete wintertijdkeuze (JJJJ-MM-DDTHH:mm)", dateTime, { dateTime = it }, enabled, max = 16)
        Choice("UTC-offset van dat tijdstip", offset, listOf("+02:00" to "+02:00 · zomertijd", "+01:00" to "+01:00 · wintertijd"), { offset = it }, enabled)
        Action("Tijdstipkeuze vastleggen", enabled && runCatching { java.time.LocalDateTime.parse(dateTime); true }.getOrDefault(false), false) { set("offsets", JSONObject(plan.obj("offsets").toString()).put(dateTime, offset)) }
        plan.obj("offsets").keys().forEach { key -> Text("$key ${plan.obj("offsets").text(key)}"); Action("Keuze $key verwijderen", enabled, false) { val offsets = JSONObject(plan.obj("offsets").toString()); offsets.remove(key); set("offsets", offsets) } }
    }
}
