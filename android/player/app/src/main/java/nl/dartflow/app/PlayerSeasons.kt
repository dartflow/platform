package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

internal fun playerLineupValid(players: List<String>, eligible: Set<String>, count: Int = 4): Boolean = count in listOf(2, 4) && players.size == count && players.count { it.isNotBlank() } >= (if (count == 2) 2 else 3) && players.filter { it.isNotBlank() }.let { it.distinct().size == it.size && eligible.containsAll(it) }

internal fun playerSeasonTotals(fixture: JSONObject): Pair<List<Int>, List<Int>> {
    if (fixture.obj("administrative").has("score")) return fixture.obj("administrative").optJSONArray("score").ints() to listOf(0, 0)
    val parties = mutableListOf(0, 0)
    val legs = mutableListOf(0, 0)
    fixture.rows("slots").forEach { slot ->
        val administrative = slot.obj("administrative")
        if (administrative.has("winner")) {
            if (!administrative.isNull("winner")) administrative.optInt("winner", -1).takeIf { it in 0..1 }?.let { parties[it]++ }
        } else if (slot.text("status") in listOf("confirmed", "provisional")) {
            val score = slot.optJSONArray("score").ints()
            if (score.size == 2) { legs[0] += score[0]; legs[1] += score[1]; if (score[0] != score[1]) parties[if (score[0] > score[1]) 0 else 1]++ }
        }
    }
    return parties to legs
}

internal fun playerSeasonCommand(actions: PlayerActions, season: JSONObject, type: String, extra: JSONObject = JSONObject(), revision: Int = season.optInt("revision")) {
    actions.command("/seasons/actions", json("expectedRevision" to revision, "action" to JSONObject(extra.toString()).put("type", type).put("seasonId", season.text("id"))))
}

@Composable internal fun PlayerSeasonCreateScreen(state: PlayerUiState, actions: PlayerActions) {
    val clubs = state.resource.rows("clubs").filter { it.optBoolean("canManage") }
    var name by rememberSaveable { mutableStateOf("") }
    var scope by rememberSaveable { mutableStateOf("internal") }
    var clubId by rememberSaveable { mutableStateOf("") }
    var format by rememberSaveable { mutableStateOf("singles") }
    var date by rememberSaveable { mutableStateOf("") }
    var time by rememberSaveable { mutableStateOf("19:30") }
    var mode by rememberSaveable { mutableStateOf("fixed") }
    var playMode by rememberSaveable { mutableStateOf("local") }
    var cameraRequired by rememberSaveable { mutableStateOf(false) }
    var boardIds by rememberSaveable { mutableStateOf(listOf<String>()) }
    var legs by rememberSaveable { mutableStateOf("5") }
    var slotCount by rememberSaveable { mutableStateOf("4") }
    var legMode by rememberSaveable { mutableStateOf("bestOf") }
    var ladderDistance by rememberSaveable { mutableStateOf("3") }
    var ladderAnswerHours by rememberSaveable { mutableStateOf("48") }
    var ladderPlayDays by rememberSaveable { mutableStateOf("7") }
    var transferDeadline by rememberSaveable { mutableStateOf("") }
    var returnLegs by rememberSaveable { mutableStateOf(false) }
    var roundGating by rememberSaveable { mutableStateOf(true) }
    var visibility by rememberSaveable { mutableStateOf("members") }
    var divisions by rememberSaveable { mutableStateOf("Hoofdklasse") }
    var divisionMetadata by rememberSaveable { mutableStateOf("{}") }
    var startValues by rememberSaveable { mutableStateOf("{}") }
    var ruleValues by rememberSaveable { mutableStateOf("{}") }
    var slotRuleValues by rememberSaveable { mutableStateOf("{}") }
    val enabled = !state.busy && state.online
    LaunchedEffect(state.resource.optBoolean("canCreateNational"), clubs.isEmpty()) { if (clubs.isEmpty() && state.resource.optBoolean("canCreateNational")) { scope = "national"; format = "teams" } }
    Heading("Competitie maken", "NIEUW SEIZOEN", "Maak eerst een concept, voeg deelnemers toe en controleer het programma vóór publicatie.")
    if (clubs.isEmpty() && !state.resource.optBoolean("canCreateNational")) { if (!state.loading) Notice("Je hebt geen actueel recht om een club- of landelijk seizoen te maken.", true); return }
    PlayerCard("Organisatie en programma") {
        Choice("Eigenaar", scope, (if (clubs.isNotEmpty()) listOf("internal" to "Mijn vereniging") else emptyList()) + (if (state.resource.optBoolean("canCreateNational")) listOf("national" to "DartFlow landelijk") else emptyList()), { scope = it; if (it == "national") format = "teams" }, enabled)
        if (scope == "internal") Choice("Vereniging", clubId, listOf("" to "Kies vereniging") + clubs.map { it.text("id") to it.text("name") }, { clubId = it }, enabled)
        Field("Naam seizoen", name, { name = it }, enabled, max = 100)
        Choice("Format", format, playerSeasonFormats(scope), { format = it; if (it in listOf("cup", "champions", "ladder")) { legMode = "bestOf"; legs = "5" } }, enabled)
        Text(playerSeasonFormatDescription(format, slotCount.toIntOrNull() ?: 4), color = PlayerMuted)
        if (format == "teams") Choice("Partijen per ontmoeting", slotCount, listOf("4" to "Vier singles", "7" to "Vier singles, twee dubbels en één teamleg"), { slotCount = it }, enabled)
        Field("Divisies · één naam per regel", divisions, { divisions = it }, enabled, max = 1000, multiline = true)
        if (format == "singles") {
            Text("Niveau 1 is het hoogste. Groepen op hetzelfde niveau krijgen een gelijkmatige ratingverdeling.", color = PlayerMuted)
            divisions.lines().filter { it.isNotBlank() }.take(12).forEachIndexed { index, label ->
                val metadata = runCatching { JSONObject(divisionMetadata) }.getOrDefault(JSONObject())
                val row = metadata.obj("$index")
                fun set(key: String, value: Int) { metadata.put("$index", JSONObject(row.toString()).put(key, value)); divisionMetadata = metadata.toString() }
                Text(label, style = MaterialTheme.typography.titleMedium)
                Choice("Niveau van $label", "${row.optInt("level", index + 1)}", (1..12).map { "$it" to "Niveau $it" }, { set("level", it.toInt()) }, enabled)
                Choice("Groepsgrootte van $label", "${row.optInt("targetSize", 10)}", (8..12).map { "$it" to "$it deelnemers" }, { set("targetSize", it.toInt()) }, enabled)
                Choice("Promotieplaatsen van $label", "${row.optInt("promotionPlaces", 1)}", (0..3).map { "$it" to "$it" }, { set("promotionPlaces", it.toInt()) }, enabled)
                Choice("Degradatieplaatsen van $label", "${row.optInt("relegationPlaces", 1)}", (0..3).map { "$it" to "$it" }, { set("relegationPlaces", it.toInt()) }, enabled)
            }
        }
        Field("Startdatum · jjjj-mm-dd", date, { date = it }, enabled, max = 10)
        Field("Lokale speeltijd · uu:mm", time, { time = it }, enabled, max = 5)
        Text("Tijdzone: Europe/Amsterdam", color = PlayerMuted)
        Choice("Speellocatie", playMode, listOf("local" to "Samen op locatie", "remote" to "Officieel op afstand · twee banen", "hybrid" to "Per ontmoeting samen lokaal of op afstand afspreken"), { playMode = it }, enabled)
        if (playMode == "remote") Text("Iedere zijde koppelt een eigen geregistreerde fysieke baan en schrijver. Iedere schrijver voert alleen de eigen zijde in.", color = PlayerMuted)
        if (playMode == "hybrid") Text("Iedere ontmoeting krijgt eerst een expliciet speelwijzevoorstel en akkoord van de andere zijde, of een gemotiveerd besluit van de leiding. Zonder vastgelegde keuze kan de partij niet starten.", color = PlayerMuted)
        PlayerToggle("Camera verplicht volgens reglement", cameraRequired, enabled) { cameraRequired = it }
        val availableBoards = state.resource.rows("boards").filter { it.text("clubId").isNotBlank() }.ifEmpty { state.platform.rows("clubBoards") }.filter { !it.optBoolean("blocked") && !it.optBoolean("closed") }
        if (availableBoards.isNotEmpty()) {
            Text("Geregistreerde banen voor dit seizoen", style = MaterialTheme.typography.titleMedium)
            availableBoards.forEach { board -> PlayerToggle(board.text("name"), board.text("id") in boardIds, enabled) { checked -> boardIds = if (checked) boardIds + board.text("id") else boardIds - board.text("id") } }
        }
        if (scope == "national" && format == "singles" && boardIds.isEmpty()) Text("Landelijke individuele wedstrijden vereisen expliciet gekozen geregistreerde banen.", color = PlayerMuted)
        Choice("Planning", mode, listOf("fixed" to "Vaste speeldagen", "flex" to "Afspreken binnen rondevenster"), { mode = it }, enabled)
        if (format !in listOf("cup", "champions", "ladder")) Choice("Legreglement", legMode, listOf("bestOf" to "Best of", "fixed" to "Vaste legs"), { legMode = it; legs = if (it == "fixed") "6" else "5" }, enabled)
        Choice("Aantal legs", legs, (if (legMode == "fixed" && format !in listOf("cup", "champions", "ladder")) listOf("6", "8", "10") else listOf("1", "3", "5", "7", "9")).map { it to it }, { legs = it }, enabled)
        PlayerStartSettingsFields(JSONObject(startValues), enabled, fixedLegs = legMode == "fixed", allowDifference = scope == "internal") { key, value -> startValues = JSONObject(startValues).put(key, value).toString() }
        if (scope == "internal") {
            Text("Recreatief basisreglement", color = PlayerLime)
            PlayerSeasonRuleFields(JSONObject(ruleValues), enabled) { key, value -> ruleValues = JSONObject(ruleValues).put(key, value).toString() }
            val count = if (format == "teams") slotCount.toIntOrNull() ?: 4 else 1
            (0 until count).forEach { index ->
                val saved = JSONObject(slotRuleValues).obj("$index")
                fun set(key: String, value: Any) { slotRuleValues = JSONObject(slotRuleValues).put("$index", JSONObject(saved.toString()).put(key, value)).toString() }
                PlayerToggle("Afwijkend reglement onderdeel ${index + 1}", saved.optBoolean("enabled"), enabled) { set("enabled", it) }
                if (saved.optBoolean("enabled")) PlayerSeasonRuleFields(saved, enabled, slot = legMode != "fixed") { key, value -> set(key, value) }
            }
            Text("Onderdeelregels worden vóór publicatie vastgelegd. De effectieve regels staan bij iedere daadwerkelijke partij. Landelijke officiële profielen blijven beschermd.", color = PlayerMuted)
        }
        if (format == "ladder") {
            Field("Uitdagen maximaal plaatsen omhoog", ladderDistance, { ladderDistance = it }, enabled, max = 2, keyboard = KeyboardType.Number)
            Field("Antwoordtermijn in uren", ladderAnswerHours, { ladderAnswerHours = it }, enabled, max = 3, keyboard = KeyboardType.Number)
            Field("Speeltermijn in dagen", ladderPlayDays, { ladderPlayDays = it }, enabled, max = 2, keyboard = KeyboardType.Number)
        }
        if (format in listOf("teams", "doubles")) Field("Transferdeadline · optioneel tijdstip met tijdzone", transferDeadline, { transferDeadline = it }, enabled, max = 40)
        Choice("Zichtbaarheid", visibility, listOf("members" to "Alleen deelnemers en clubleden", "public" to "Openbaar", "invite" to "Op uitnodiging"), { visibility = it }, enabled)
        PlayerToggle("Heen en terug", returnLegs, enabled) { returnLegs = it }
        PlayerToggle("Ronden apart vrijgeven", roundGating, enabled) { roundGating = it }
        val valid = name.isNotBlank() && (scope == "national" || clubs.any { it.text("id") == clubId }) && runCatching { LocalDate.parse(date) }.isSuccess && Regex("([01][0-9]|2[0-3]):[0-5][0-9]").matches(time) && divisions.lines().filter { it.isNotBlank() }.size in 1..12 && playerSeasonFormats(scope).any { it.first == format } && slotCount in listOf("4", "7") && legs.toIntOrNull() in (if (legMode == "fixed" && format !in listOf("cup", "champions", "ladder")) listOf(6, 8, 10) else listOf(1, 3, 5, 7, 9)) && ladderDistance.toIntOrNull() in 1..10 && ladderAnswerHours.toIntOrNull() in 1..168 && ladderPlayDays.toIntOrNull() in 1..30 && (scope != "national" || format != "singles" || boardIds.isNotEmpty()) && (transferDeadline.isBlank() || runCatching { java.time.OffsetDateTime.parse(transferDeadline) }.isSuccess)
        val validRules = scope != "internal" || playerDifferenceValid(JSONObject(startValues), legs.toIntOrNull() ?: 5, JSONObject(startValues).text("bestOfSets", "1").toIntOrNull() ?: 1, legMode == "fixed") && playerSeasonRulesValid(JSONObject(ruleValues)) && JSONObject(slotRuleValues).keys().asSequence().filter { JSONObject(slotRuleValues).obj(it).optBoolean("enabled") }.all { playerSeasonRulesValid(JSONObject(slotRuleValues).obj(it), legs.toIntOrNull() ?: 5, JSONObject(startValues).text("bestOfSets", "1").toIntOrNull() ?: 1, legMode == "fixed") }
        Action("Maak seizoensconcept", enabled && valid && validRules, modifier = Modifier.fillMaxWidth()) {
            actions.command("/seasons/actions", json("action" to json("type" to "season.create", "name" to name.trim(), "scope" to scope, "clubId" to if (scope == "internal") clubId else JSONObject.NULL, "format" to format, "divisions" to playerSeasonDivisions(divisions, runCatching { JSONObject(divisionMetadata) }.getOrDefault(JSONObject())), "settings" to playerWithSettings(json("startDate" to date, "playTime" to time, "timezone" to "Europe/Amsterdam", "scheduleMode" to mode, "playMode" to playMode, "cameraRequired" to cameraRequired, "boardIds" to JSONArray(boardIds), "boardCount" to if (boardIds.isEmpty()) 3 else boardIds.size, "legs" to legs.toInt(), "slotCount" to slotCount.toInt(), "legMode" to if (format in listOf("cup", "champions", "ladder")) "bestOf" else legMode, "ladderDistance" to ladderDistance.toInt(), "ladderAnswerHours" to ladderAnswerHours.toInt(), "ladderPlayDays" to ladderPlayDays.toInt(), "transferDeadline" to transferDeadline.ifBlank { null }, "returnLegs" to returnLegs, "roundGating" to roundGating, "visibility" to visibility), playerWithSettings(playerStartSettings(JSONObject(startValues), fixedLegs = legMode == "fixed", allowDifference = scope == "internal"), if (scope == "internal") playerSeasonRuleSettings(JSONObject(ruleValues), fixedLegs = legMode == "fixed").put("slotRules", JSONObject().also { rules -> val count = if (format == "teams") slotCount.toInt() else 1; (0 until count).forEach { index -> val saved = JSONObject(slotRuleValues).obj("$index"); if (saved.optBoolean("enabled")) rules.put("$index", playerSeasonRuleSettings(saved, fixedLegs = legMode == "fixed")) } }) else JSONObject())))))
        }
    }
    val cloudValues = json("name" to name, "scope" to scope, "clubId" to clubId, "format" to format, "date" to date, "time" to time, "mode" to mode, "playMode" to playMode, "cameraRequired" to cameraRequired, "boardIds" to JSONArray(boardIds), "legs" to legs, "slotCount" to slotCount, "legMode" to legMode, "ladderDistance" to ladderDistance, "ladderAnswerHours" to ladderAnswerHours, "ladderPlayDays" to ladderPlayDays, "transferDeadline" to transferDeadline, "returnLegs" to returnLegs, "roundGating" to roundGating, "visibility" to visibility, "divisions" to divisions, "divisionMetadata" to JSONObject(divisionMetadata), "startSettings" to JSONObject(startValues), "ruleSettings" to JSONObject(ruleValues), "slotRuleSettings" to JSONObject(slotRuleValues))
    PlayerCloudDraftPanel(state, actions, "season", if (scope == "national") "platform" else "club", clubId, name, "details", cloudValues) { values ->
        ruleValues = values.obj("ruleSettings").toString(); slotRuleValues = values.obj("slotRuleSettings").toString(); startValues = values.obj("startSettings").toString(); name = values.text("name").take(100); scope = if (values.text("ownership") == "platform") "national" else "internal"; clubId = values.text("clubId"); format = values.text("format", "singles"); date = values.text("date"); time = values.text("time", "19:30"); mode = values.text("mode", "fixed"); playMode = values.text("playMode", "local"); cameraRequired = values.optBoolean("cameraRequired"); boardIds = values.optJSONArray("boardIds")?.strings().orEmpty(); legs = values.text("legs", "5"); slotCount = values.text("slotCount", "4"); legMode = values.text("legMode", "bestOf"); ladderDistance = values.text("ladderDistance", "3"); ladderAnswerHours = values.text("ladderAnswerHours", "48"); ladderPlayDays = values.text("ladderPlayDays", "7"); transferDeadline = values.text("transferDeadline"); returnLegs = values.optBoolean("returnLegs"); roundGating = values.optBoolean("roundGating", true); visibility = values.text("visibility", "members"); divisions = values.text("divisions", "Hoofdklasse"); divisionMetadata = values.obj("divisionMetadata").toString()
    }
    Action("Hulp bij competities", primary = false) { actions.navigate(PlayerScreen.HELP, "q=competitie") }
}

@Composable internal fun PlayerSeasonDetail(state: PlayerUiState, actions: PlayerActions) {
    val season = state.resource.optJSONObject("season") ?: state.resource
    var tab by rememberSaveable { mutableStateOf("program") }
    var mine by rememberSaveable { mutableStateOf(false) }
    val enabled = !state.busy && state.online
    val people = season.rows("participants") + season.rows("teams")
    Heading(season.text("name", "Competitie"), "${statusLabel(season.text("status"))} · ${if (season.text("scope") == "national") "LANDELIJK" else "VERENIGING"}")
    if (season.text("id").isBlank()) { if (!state.loading) Notice("Dit seizoen is niet beschikbaar voor je huidige account.", true); return }
    Text("Regelversie ${season.optInt("rulesVersion")} · ${season.obj("settings").text("timezone", "Europe/Amsterdam")}", color = PlayerMuted)
    if (season.obj("capabilities").optBoolean("canEnroll")) Action("Inschrijven", enabled) { playerSeasonCommand(actions, season, "season.enroll") }
    PlayerSeasonFormatControls(season, state, actions)
    Action("Officiële ranking- en circuitgevolgen", primary = false) { actions.navigate(PlayerScreen.RANKING_EVENT, season.text("id")) }
    Action("Hulp bij competitie en opstelling", primary = false) { actions.navigate(PlayerScreen.HELP, "q=opstelling") }
    PlayerWorkspaceTabs(tab, listOf("program" to "Programma en uitslagen", "standings" to "Stand", "entries" to "Deelnemers en teams", "rules" to "Reglement") + if (season.optBoolean("canManage")) listOf("manage" to "Beheer") else emptyList()) { tab = it }
    when (tab) {
        "standings" -> {
            season.rows("standings").forEach { row -> PlayerCard("${row.optInt("position")}${if (row.optBoolean("shared")) " =" else ""} · ${row.text("name")}") {
                Text(if (season.text("format") in listOf("cup", "champions")) "${if (row.optInt("position") > 0) "Eindplaats ${row.optInt("position")}" else "Plaats volgt"} · ${row.optInt("played")} gespeeld" else "${row.optInt("points")} punten · ${row.optInt("played")} gespeeld", color = PlayerLime)
                Text("Partijen ${row.optInt("partiesFor")}–${row.optInt("partiesAgainst")} · legs ${row.optInt("legsFor")}–${row.optInt("legsAgainst")}")
                if (row.optInt("deduction") != 0) Text("Puntenaftrek: ${row.optInt("deduction")}", color = PlayerMuted)
            } }
            if (season.rows("standings").isEmpty()) Text("Nog geen definitieve stand.", color = PlayerMuted)
        }
        "program" -> {
            PlayerToggle("Alleen mijn ontmoetingen", mine, true) { mine = it }
            val myTeams = season.optJSONArray("myTeamIds")?.strings().orEmpty()
            val fixtures = season.rows("fixtures").filter { !mine || it.text("homeId") == state.profile?.id || it.text("awayId") == state.profile?.id || it.text("homeId") in myTeams || it.text("awayId") in myTeams || it.rows("slots").any { slot -> slot.optJSONArray("players")?.strings()?.contains(state.profile?.id) == true } }
            if (fixtures.isEmpty()) Text("Geen ontmoetingen gevonden. Het programma verschijnt na indeling.", color = PlayerMuted)
            fixtures.forEach { fixture -> key(fixture.text("id")) { PlayerSeasonFixture(season, fixture, state, actions) } }
        }
        "entries" -> {
            if (season.optBoolean("canManage") && playerSeasonHasTeams(season)) PlayerSeasonTransfer(season, state, actions)
            people.forEach { entry -> PlayerCard(entry.text("name")) { Text(statusLabel(entry.text("status")), color = PlayerMuted) } }
            if (season.optBoolean("canManage") && !playerSeasonHasTeams(season) && season.text("format") != "champions" && (season.rows("fixtures").isEmpty() || season.text("format") == "drop-in")) PlayerSeasonEnroll(season, state, actions)
            if (season.obj("capabilities").optBoolean("canRegisterTeam") || season.optBoolean("canManage") && playerSeasonHasTeams(season) && season.rows("fixtures").isEmpty()) PlayerSeasonTeam(season, state, actions)
        }
        "rules" -> PlayerCard("Gepubliceerd reglement · versie ${season.optInt("rulesVersion")}") {
            val rules = season.obj("settings")
            Text(playerSeasonFormatDescription(season.text("format"), rules.optInt("slotCount", 4)), color = PlayerLime)
            Text("${playerRuleLabel(rules)} · ${if (rules.text("legMode") == "fixed") "Vaste" else "Best of"} ${rules.optInt("legs")} legs / ${rules.optInt("bestOfSets", 1)} sets")
            Text("Start: ${rules.text("startProcedure", "bestaande beurtvolgorde")} · setopener ${rules.text("setOpener", "continuous")} · beslissende leg ${rules.text("decidingLeg", "continue")}", color = PlayerMuted)
            Text("Winst/gelijk/verlies: ${rules.optInt("pointsWin")}/${rules.optInt("pointsDraw")}/${rules.optInt("pointsLoss")}")
            Text("Opstelling ${rules.optInt("lineupHours")} uur vooraf · bevestigen binnen ${rules.optInt("confirmHours")} uur · check-in ${rules.optInt("checkInMinutes")} minuten vooraf")
            Text("${if (rules.optBoolean("returnLegs")) "Heen en terug" else "Enkelvoudige competitie"} · ${rules.text("timezone")}")
            rules.text("notes").takeIf { it.isNotBlank() }?.let { Text(it) }
            Text("Publicatie: ${season.text("publishedAt", "Nog niet gepubliceerd")}", color = PlayerMuted)
        }
        "manage" -> PlayerSeasonManage(season, state, actions)
    }
}

@Composable private fun PlayerSeasonFixture(season: JSONObject, fixture: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val capabilities = fixture.obj("capabilities")
    val enabled = !state.busy && state.online
    val entries = season.rows("participants") + season.rows("teams")
    var open by rememberSaveable { mutableStateOf(false) }
    var reason by rememberSaveable { mutableStateOf("") }
    var time by rememberSaveable { mutableStateOf("") }
    var boardId by rememberSaveable { mutableStateOf(fixture.optJSONArray("boardIds")?.optString(0).orEmpty()) }
    var writerId by rememberSaveable { mutableStateOf(fixture.text("writerId")) }
    var decision by rememberSaveable { mutableStateOf("interrupt") }
    var extendedWindow by rememberSaveable { mutableStateOf("") }
    fun send(type: String, extra: JSONObject = JSONObject()) = playerSeasonCommand(actions, season, type, JSONObject(extra.toString()).put("fixtureId", fixture.text("id")))
    PlayerCard("Ronde ${fixture.optInt("round")} · ${entries.find { it.text("id") == fixture.text("homeId") }?.text("name") ?: "Thuis"} – ${entries.find { it.text("id") == fixture.text("awayId") }?.text("name") ?: "Uit"}") {
        if (fixture.obj("classification").text("kind") in listOf("promotion", "vacancy")) Text("Beslissingswedstrijd · ${playerRuleLabel(fixture.obj("settings"))} · best of ${fixture.obj("settings").optInt("bestOfLegs", 5)} legs", color = PlayerLime)
        Text("${statusLabel(fixture.text("status"))} · ${shortDate(fixture.text("startsAt", fixture.text("windowStart")))}", color = PlayerMuted)
        PlayerSeasonPlayMode(season, fixture, state, actions)
        fixture.optJSONObject("overdue")?.let { Notice("Speeltermijn verstreken: ${it.text("reason")} · sinds ${shortDate(it.text("since"))}") }
        val totals = playerSeasonTotals(fixture)
        Text("Partijen ${totals.first.joinToString("–")} · legs ${totals.second.joinToString("–")}", color = PlayerLime)
        Action(if (open) "Sluit ontmoeting" else "Open ontmoeting", primary = false) { open = !open }
        if (open) {
            if (capabilities.optBoolean("canCheckIn")) {
                val present = fixture.optJSONArray("checkIns")?.strings()?.contains(state.profile?.id) == true
                Action(if (present) "Check-in intrekken" else "Ik ben aanwezig", enabled, false) { send("season.check-in", json("present" to !present)) }
                PlayerToggle("Beschikbaar voor mijn partij", fixture.obj("availability").optBoolean(state.profile?.id.orEmpty(), true), enabled) { send("season.available", json("available" to it)) }
            }
            if (playerSeasonHasTeams(season)) listOf("home" to "Thuis", "away" to "Uit").forEach { (side, label) ->
                if (capabilities.optBoolean(if (side == "home") "canLineupHome" else "canLineupAway")) PlayerSeasonLineup(season, fixture, side, label, state, actions)
                else fixture.obj("lineups").optJSONObject(side)?.let { lineup ->
                    Text("$label: ${lineup.optJSONArray("players")?.strings()?.joinToString(" · ") { id -> season.rows("eligiblePlayers").find { it.text("id") == id }?.text("name") ?: "Ontbrekend slot" }}", color = PlayerMuted)
                }
            }
            val mode = playerSeasonFixtureMode(season, fixture)
            val remote = mode == "remote"
            if (remote) PlayerSeasonRemoteAssignments(season, fixture, state, actions)
            if (capabilities.optBoolean("canStart") && mode == "local") {
                Choice("Baan voor oproep", boardId, listOf("" to "Kies baan") + season.rows("boards").map { it.text("id") to it.text("name") }, { boardId = it }, enabled)
                Choice("Schrijver", writerId, listOf("" to "Volgens opstelling") + season.rows("eligiblePlayers").map { it.text("id") to it.text("name") }, { writerId = it }, enabled)
            }
            fixture.rows("slots").forEach { slot ->
                val names = playerSeasonSlotNames(slot, season.rows("eligiblePlayers"))
                val label = playerSeasonSlotLabel(slot, season.text("format"), season.obj("settings").optInt("slotCount", 4))
                Text("$label: $names · ${statusLabel(slot.text("status"))}")
                slot.optJSONObject("settings")?.let { Text("${playerRuleLabel(it)} · best of ${it.optInt("bestOfLegs", 5)} legs / ${it.optInt("bestOfSets", 1)} sets", color = PlayerMuted) }
                if (slot.text("matchId").isNotBlank()) Action("Open $label", primary = false) { actions.navigate(PlayerScreen.MATCH, slot.text("matchId")) }
                else if (capabilities.optBoolean("canStart") && mode != null && slot.text("status") !in listOf("administrative", "confirmed", "canceled")) Action("Roep $label op", enabled && if (remote) playerSeasonRemoteReady(fixture) else boardId.isNotBlank()) { send("season.start", json("slotIndex" to slot.optInt("index")).also { if (!remote) { it.put("boardId", boardId); if (writerId.isNotBlank()) it.put("writerId", writerId) } }) }
            }
            if (capabilities.optBoolean("canManage") && playerSeasonHasTeams(season)) PlayerSeasonReserve(season, fixture, state, actions)
            if (capabilities.optBoolean("canPropose")) {
                Field("Nieuw tijdstip · jjjj-mm-ddTuu:mm+01:00", time, { time = it }, enabled, max = 40)
                Action("Tijdvoorstel indienen", enabled && runCatching { java.time.OffsetDateTime.parse(time) }.isSuccess, false) { send("season.propose", json("startsAt" to time)) }
                fixture.optJSONObject("proposal")?.let { proposal -> Text("Voorstel: ${shortDate(proposal.text("startsAt"))}", color = PlayerLime); if (proposal.text("by") != state.profile?.id) Action("Tijdvoorstel accepteren", enabled) { send("season.accept-time") } }
            }
            if (capabilities.optBoolean("canConfirm") && !capabilities.optBoolean("canManage")) Action("Ontmoeting bevestigen", enabled) { send("season.confirm") }
            if (capabilities.optBoolean("canDispute") || capabilities.optBoolean("canManage")) {
                Field("Reden of toelichting", reason, { reason = it }, enabled, max = 1000, multiline = true)
                if (capabilities.optBoolean("canDispute")) Action("Bezwaar indienen", enabled && reason.trim().length >= 5, false) { send("season.dispute", json("reason" to reason)) }
                if (capabilities.optBoolean("canManage")) {
                    if (fixture.has("overdue")) {
                        Field("Nieuwe eindtermijn · tijdstip met tijdzone", extendedWindow, { extendedWindow = it }, enabled, max = 40)
                        val end = runCatching { java.time.OffsetDateTime.parse(extendedWindow) }.getOrNull()
                        Action("Verleng speeltermijn met toelichting", enabled && reason.trim().length >= 5 && end != null && end.toInstant().isAfter(java.time.Instant.now()), false) { send("season.extend-window", json("windowEnd" to extendedWindow, "reason" to reason.trim())) }
                    }
                    Choice("Besluit wedstrijdleiding", decision, listOf("interrupt" to "Onderbreken", "accept" to "Uitslag accepteren", "reopen" to "Heropenen", "cancel" to "Annuleren"), { decision = it }, enabled)
                    Action("Leg besluit vast", enabled && reason.trim().length >= 5, false) { send("season.decide", json("decision" to decision, "reason" to reason)) }
                }
            }
            fixture.obj("dispute").text("reason").takeIf { it.isNotBlank() }?.let { Notice("Bezwaar: $it") }
        }
    }
}

@Composable private fun PlayerSeasonLineup(season: JSONObject, fixture: JSONObject, side: String, label: String, state: PlayerUiState, actions: PlayerActions) {
    val team = season.rows("teams").find { it.text("id") == fixture.text(if (side == "home") "homeId" else "awayId") } ?: return
    val serverLineup = fixture.obj("lineups").obj(side)
    val roster = team.optJSONArray("playerIds")?.strings().orEmpty().toSet()
    val count = if (season.text("format") == "doubles") 2 else 4
    var players by rememberSaveable { mutableStateOf((0 until count).map { serverLineup.optJSONArray("players")?.optString(it)?.takeIf { id -> id != "null" }.orEmpty() }) }
    var revision by rememberSaveable { mutableIntStateOf(season.optInt("revision")) }
    val enabled = !state.busy && state.online
    Text("$label · ${team.text("name")}", style = MaterialTheme.typography.titleMedium)
    if (serverLineup.text("submittedAt").isNotBlank()) { Text("Opstelling ingediend · ${if (fixture.obj("lineups").has(if (side == "home") "away" else "home")) "tegenpartijstatus ontvangen" else "wacht op tegenstander"}", color = PlayerLime); return }
    repeat(count) { index -> Choice(if (count == 2) "Dubbelspeler ${index + 1}" else "Single ${index + 1}", players[index], listOf("" to "Ontbrekend slot") + season.rows("eligiblePlayers").filter { it.text("id") in roster }.map { it.text("id") to it.text("name") }, { value -> players = players.toMutableList().also { it[index] = value } }, enabled) }
    val completeRequired = season.text("format") == "doubles" || season.obj("settings").optInt("slotCount", 4) == 7
    val valid = playerLineupValid(players, roster, count) && (!completeRequired || players.all { it.isNotBlank() })
    if (revision != season.optInt("revision")) {
        Text("Het seizoen is ondertussen gewijzigd. Je invoer blijft staan. Ophalen van de actuele opstelling vervangt jouw selectie.", color = PlayerMuted)
        Action("Haal actuele opstelling op", enabled, false) { players = (0 until count).map { serverLineup.optJSONArray("players")?.optString(it)?.takeIf { id -> id != "null" }.orEmpty() }; revision = season.optInt("revision") }
    }
    listOf(false to "Bewaar opstellingsconcept", true to "Dien opstelling definitief in").forEach { (submit, title) -> Action(title, enabled && valid && revision == season.optInt("revision"), primary = submit) { playerSeasonCommand(actions, season, "season.lineup", json("fixtureId" to fixture.text("id"), "side" to side, "players" to JSONArray(players.map { it.ifBlank { null } }), "submit" to submit), revision) } }
    Text(if (completeRequired) "Kies alle verschillende speelgerechtigde spelers. De werpvolgorde staat vast bij start." else "Kies minimaal drie verschillende speelgerechtigde spelers. De server onthult beide opstellingen pas na beide inzendingen.", color = PlayerMuted)
}

@Composable private fun PlayerSeasonEnroll(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    var player by rememberSaveable { mutableStateOf("") }
    var division by rememberSaveable { mutableStateOf(season.rows("divisions").firstOrNull()?.text("id").orEmpty()) }
    PlayerCard("Deelnemer toevoegen") {
        Choice("Speler", player, listOf("" to "Kies speler") + season.rows("eligiblePlayers").filter { candidate -> season.rows("participants").none { it.text("id") == candidate.text("id") } }.map { it.text("id") to it.text("name") }, { player = it }, !state.busy)
        Choice("Divisie", division, season.rows("divisions").map { it.text("id") to it.text("name") }, { division = it }, !state.busy)
        Action("Schrijf speler in", !state.busy && state.online && player.isNotBlank() && division.isNotBlank()) { playerSeasonCommand(actions, season, "season.enroll", json("playerId" to player, "divisionId" to division)) }
    }
}

@Composable private fun PlayerSeasonTeam(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    var club by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var captain by rememberSaveable { mutableStateOf("") }
    var players by rememberSaveable { mutableStateOf(listOf<String>()) }
    val clubs = state.platform.rows("clubs").filter { it.obj("clubAccess").optJSONArray("permissions")?.strings()?.contains("competitions.manage") == true }
    val candidates = season.rows("eligiblePlayers").filter { it.optJSONArray("clubIds")?.strings()?.contains(club) == true }
    val range = if (season.text("format") == "doubles") 2..3 else 4..8
    PlayerCard(if (season.text("format") == "doubles") "Dubbel inschrijven · twee spelers en optionele reserve" else "Clubteam inschrijven") {
        Choice("Vereniging", club, listOf("" to "Kies vereniging") + clubs.map { it.text("id") to it.text("name") }, { club = it; players = emptyList(); captain = "" }, !state.busy)
        Field("Teamnaam", name, { name = it }, !state.busy, max = 100)
        candidates.forEach { candidate -> PlayerToggle(candidate.text("name"), candidate.text("id") in players, !state.busy) { checked -> players = if (checked) players + candidate.text("id") else players - candidate.text("id"); if (captain !in players) captain = "" } }
        Choice("Captain", captain, listOf("" to "Kies captain") + candidates.filter { it.text("id") in players }.map { it.text("id") to it.text("name") }, { captain = it }, !state.busy)
        Action("Schrijf clubteam in", !state.busy && state.online && name.isNotBlank() && players.size in range && captain in players) { playerSeasonCommand(actions, season, "season.team", json("clubId" to club, "name" to name, "captainId" to captain, "playerIds" to JSONArray(players))) }
    }
}

@Composable private fun PlayerSeasonManage(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    PlayerSeasonDelegation(season, state, actions)
    var reason by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf(season.text("status")) }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val enabled = !state.busy && state.online && season.text("status") != "archived"
    fun confirm(type: String, extra: JSONObject = JSONObject()) { pending = JSONObject(extra.toString()).put("type", type) }
    PlayerCard("Seizoen en ronden") {
        season.obj("capabilities").text("unsupportedReason").takeIf { it.isNotBlank() }?.let { Notice(it) }
        Field("Reden voor beheerwijziging", reason, { reason = it }, !state.busy, max = 1000)
        Choice("Seizoensstatus", status, listOf("draft" to "Concept", "registration" to "Inschrijving", "planned" to "Gepland", "active" to "Actief", "completed" to "Afgerond", "archived" to "Archief"), { status = it }, enabled)
        Action("Status wijzigen", enabled && reason.trim().length >= 5, false) { confirm("season.status", json("status" to status, "reason" to reason)) }
        if (season.text("publishedAt").isBlank()) {
            Action("Genereer conceptprogramma", enabled && season.obj("capabilities").optBoolean("canPlay"), false) { confirm("season.generate") }
            Action("Publiceer gecontroleerd programma", enabled && (season.rows("fixtures").isNotEmpty() || season.text("format") in listOf("ladder", "drop-in")) && season.rows("conflicts").isEmpty()) { confirm("season.publish") }
        }
        season.rows("rounds").forEach { round -> PlayerToggle("Ronde ${round.optInt("number")} vrijgegeven", round.optBoolean("released"), enabled && reason.trim().length >= 5) { confirm("season.release-round", json("round" to round.optInt("number"), "released" to it, "reason" to reason)) } }
        Action("Dupliceer als leeg seizoensconcept", !state.busy && state.online, false) { confirm("season.copy", json("name" to "${season.text("name")} · nieuw seizoen")) }
    }
    season.rows("conflicts").forEach { Notice("Planningsconflict: ${it.text("reason")}", true) }
    if (season.rows("decisions").isNotEmpty()) PlayerCard("Besluitenhistorie") { season.rows("decisions").takeLast(20).reversed().forEach { Text("${shortDate(it.text("at"))} · ${it.text("action")}\n${it.text("reason")}", color = PlayerMuted) } }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text("Beheerwijziging bevestigen") }, text = { Text("${when (command.text("type")) { "season.status" -> "Seizoensstatus wijzigen naar ${statusLabel(command.text("status"))}"; "season.generate" -> "Conceptprogramma opnieuw indelen"; "season.publish" -> "Reglement en programma publiceren"; "season.release-round" -> "Ronde ${command.optInt("round")} ${if (command.optBoolean("released")) "vrijgeven" else "blokkeren"}"; "season.copy" -> "Leeg seizoensconcept aanmaken"; else -> "Wijziging opslaan" }} · ${season.text("name")}\n${command.text("reason", "Controleer het huidige concept, deelnemers en programma vóór bevestiging.")}") }, confirmButton = { TextButton(onClick = { pending = null; playerSeasonCommand(actions, season, command.text("type"), command) }, enabled = !state.busy && state.online) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}
