package nl.dartflow.app

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONArray
import org.json.JSONObject

private fun drawMethodLabel(value: String) = when (value) { "seeded" -> "Geplaatste hoofden"; "manual" -> "Handmatige volgorde"; else -> "Willekeurige loting" }
private fun poolCriterionLabel(value: String) = when (value) { "points" -> "punten"; "legDifference" -> "legsaldo"; "legsFor" -> "gewonnen legs"; "headToHead" -> "onderlinge minitabel"; else -> value }

@Composable internal fun PlayerTournamentDraw(event: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val body = event.obj("state")
    val draw = body.obj("tournamentRules").obj("draw")
    val entries = event.rows("members").filter { it.text("status") == "active" && it.obj("attributes").optBoolean("registered") && it.obj("attributes").optBoolean("checkedIn") }
    val ids = entries.map { it.text("id") }
    var method by rememberSaveable(event.text("id")) { mutableStateOf(draw.text("method", "random")) }
    var order by rememberSaveable(event.text("id"), ids.joinToString()) { mutableStateOf(ids) }
    var seeds by rememberSaveable(event.text("id")) { mutableStateOf(draw.optJSONArray("seedPlayerIds")?.strings().orEmpty().filter { it in ids }) }
    var spread by rememberSaveable(event.text("id")) { mutableStateOf(draw.optBoolean("spreadClubs", body.text("format") in listOf("knockout", "pools-knockout"))) }
    var bronze by rememberSaveable(event.text("id")) { mutableStateOf(draw.optBoolean("bronze", body.optBoolean("bronze"))) }
    var consolation by rememberSaveable(event.text("id")) { mutableStateOf(draw.optBoolean("consolation", body.obj("consolation").optBoolean("enabled"))) }
    var consolationTitle by rememberSaveable(event.text("id")) { mutableStateOf(draw.text("consolationTitle", body.obj("consolation").text("title", "Troostbeker"))) }
    var acceptWarnings by rememberSaveable(event.text("id")) { mutableStateOf(false) }
    var criteria by rememberSaveable(event.text("id")) { mutableStateOf(draw.optJSONArray("poolCriteria")?.strings()?.joinToString(",") ?: "points,legDifference,legsFor,headToHead") }
    var reason by rememberSaveable(event.text("id")) { mutableStateOf("") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val redraw = body.rows("fixtures").isNotEmpty()
    val enabled = event.optBoolean("canManage") && state.online && !state.busy
    if (draw.length() > 0) PlayerCard("Gepubliceerde loting · versie ${draw.optInt("revision")}") {
        Text("${drawMethodLabel(draw.text("method"))} · peildatum ${shortDate(draw.text("closedAt"))}")
        Text("Lotingseed: ${draw.text("seed")}", color = PlayerMuted)
        Text("Invoerveld: ${draw.rows("input").joinToString(" · ") { it.text("name") }}", color = PlayerMuted)
        Text("Criteria: ${draw.optJSONArray("poolCriteria")?.strings()?.joinToString(" → ", transform = ::poolCriterionLabel).orEmpty()}", color = PlayerMuted)
        draw.optJSONArray("notices")?.strings()?.forEach { Notice(it) }
        draw.text("reason").takeIf { it.isNotBlank() }?.let { Text("Herlotingsreden: $it", color = PlayerMuted) }
        body.rows("drawHistory").forEach { previous -> val old = previous.obj("draw"); Text("Eerdere versie ${old.optInt("revision")} · ${drawMethodLabel(old.text("method"))} · ${shortDate(old.text("closedAt"))}", color = PlayerMuted) }
    }
    PlayerCard(if (redraw) "Herloting voorbereiden" else "Loting voorbereiden") {
        Text("Alleen het actuele ingecheckte veld gaat mee. De server bewaart de invoer, peildatum, methode en versie.", color = PlayerMuted)
        Choice("Lotingsmethode", method, listOf("random", "seeded", "manual").map { it to drawMethodLabel(it) }, { method = it; if (it == "manual") spread = false }, enabled)
        if (method == "seeded") {
            Text("Voeg geplaatste hoofden toe in de bedoelde volgorde. Verwijder en voeg opnieuw toe om de prioriteit te veranderen.", color = PlayerMuted)
            entries.forEach { entry -> PlayerToggle(entry.text("name") + seeds.indexOf(entry.text("id")).takeIf { it >= 0 }?.let { " · seed ${it + 1}" }.orEmpty(), entry.text("id") in seeds, enabled) { on -> seeds = if (on) seeds + entry.text("id") else seeds - entry.text("id") } }
        }
        if (method == "manual") order.forEachIndexed { index, id ->
            Text("${index + 1}. ${entries.find { it.text("id") == id }?.text("name") ?: "Speler"}")
            if (index > 0) Action("Verplaats omhoog · ${entries.find { it.text("id") == id }?.text("name")}", enabled, false) { order = order.toMutableList().apply { removeAt(index); add(index - 1, id) } }
        }
        if (method != "manual" && body.text("format") in listOf("knockout", "pools-knockout")) PlayerToggle("Verenigingen spreiden waar mogelijk", spread, enabled) { spread = it }
        if (body.text("format") in listOf("knockout", "pools-knockout")) PlayerToggle("Bronswedstrijd voor plaats drie en vier", bronze, enabled) { bronze = it }
        if (body.text("format") == "knockout") { PlayerToggle("Aparte troostbeker voor echte verliezers in ronde één", consolation, enabled) { consolation = it }; if (consolation) Field("Titel troostbeker", consolationTitle, { consolationTitle = it }, enabled, max = 80) }
        if (body.text("format") == "pools-knockout") Choice("Volgorde poulecriteria", criteria, listOf("points,legDifference,legsFor,headToHead" to "Punten → legsaldo → legs voor → onderling", "points,headToHead,legDifference,legsFor" to "Punten → onderlinge minitabel → legsaldo → legs voor"), { criteria = it }, enabled)
        if (redraw) Field("Reden voor herloting", reason, { reason = it }, enabled, max = 1000)
        body.obj("planningPreview").optJSONArray("warnings")?.strings()?.forEach { Notice(it) }
        if (body.has("planning")) PlayerToggle("Ik heb de planning beoordeeld en aanvaard een eventuele langere eindtijd door deze indeling", acceptWarnings, enabled) { acceptWarnings = it }
        Action(if (redraw) "Controleer herloting" else "Controleer en maak loting", enabled && ids.size >= 2 && (method != "seeded" || seeds.isNotEmpty()) && (!redraw || reason.trim().length >= 3) && (!consolation || consolationTitle.trim().length in 1..80), false) {
            pending = json("expectedRevision" to event.optInt("revision"), "action" to json("type" to if (redraw) "competition.redraw" else "competition.plan", "id" to event.text("id"), "drawMethod" to method, "seedPlayerIds" to JSONArray(seeds), "manualPlayerIds" to JSONArray(if (method == "manual") order else emptyList<String>()), "spreadClubs" to (spread && method != "manual" && body.text("format") in listOf("knockout", "pools-knockout")), "bronze" to (bronze && body.text("format") in listOf("knockout", "pools-knockout")), "consolation" to (consolation && body.text("format") == "knockout"), "consolationTitle" to consolationTitle.trim(), "poolCriteria" to JSONArray(criteria.split(",")), "acceptPlanningWarnings" to acceptWarnings).also { if (redraw) it.put("reason", reason.trim()) })
        }
    }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(if (redraw) "Herloting vastleggen?" else "Loting vastleggen?") }, text = { Text("${ids.size} ingecheckte spelers · ${drawMethodLabel(method)}. De server weigert herloten na de eerste worp of een vastgelegde erkenningsfreeze. Bij een geldige wijziging blijven oude loting en oproepen traceerbaar.") }, confirmButton = { TextButton(onClick = { pending = null; actions.command("/platform/actions", command) }, enabled = enabled) { Text("Maak loting") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Terug") } }) }
}

@Composable internal fun PlayerTournamentPoolControl(event: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val control = event.obj("state").optJSONObject("tournamentControl") ?: return
    val enabled = event.optBoolean("canManage") && state.online && !state.busy
    var reason by rememberSaveable(event.text("id")) { mutableStateOf("") }
    var acceptWarnings by rememberSaveable(event.text("id")) { mutableStateOf(false) }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    fun name(id: String) = event.rows("members").find { it.text("id") == id }?.text("name") ?: "Speler"
    fun propose(type: String, extra: JSONObject) { pending = json("expectedRevision" to event.optInt("revision"), "action" to JSONObject(extra.toString()).put("type", type).put("id", event.text("id")).put("reason", reason.trim()).put("acceptPlanningWarnings", acceptWarnings)) }
    PlayerCard("Poulecriteria en fasevrijgave") {
        Text(control.optJSONArray("poolCriteria")?.strings()?.joinToString(" → ", transform = ::poolCriterionLabel).orEmpty(), color = PlayerMuted)
        control.rows("poolTables").forEach { table ->
            Text("Poule ${table.text("pool")}")
            table.rows("rows").forEach { row -> Text("${row.optInt("position")}${if (row.optBoolean("shared")) " gedeeld" else ""}. ${name(row.text("id"))} · ${row.optInt("points")} p · legs ${row.optInt("legsFor")}–${row.optInt("legsAgainst")}${if (row.has("headToHead") && !row.isNull("headToHead")) " · minitabel ${row.optInt("headToHead")} p" else ""}") }
            table.rows("blockedGroups").forEach { group -> Text("Gelijke doorgangsgrens: ${group.optJSONArray("playerIds")?.strings()?.joinToString(" · ", transform = ::name).orEmpty()}", color = PlayerLime) }
            if (table.rows("blockedGroups").isNotEmpty()) Action("Maak echte beslisser · poule ${table.text("pool")}", enabled && reason.trim().length >= 3, false) { propose("competition.pool-decider", json("pool" to table.text("pool"))) }
        }
        control.rows("decisions").forEach { decision ->
            Text("Beslisser ${decision.text("pool")} · ${decision.optJSONArray("playerIds")?.strings()?.joinToString(" · ", transform = ::name).orEmpty()} · ${decision.text("phase")}", color = PlayerMuted)
            if (decision.optBoolean("stale")) Text("Bron herzien · oude beslissing vervallen", color = PlayerLime)
            else if (decision.text("phase") != "complete") Action("Verwerk bevestigde beslisser · poule ${decision.text("pool")}", enabled && reason.trim().length >= 3, false) { propose("competition.advance-decider", json("decisionId" to decision.text("id"))) }
        }
        if (enabled) {
            if (event.obj("state").has("planning")) PlayerToggle("Ik heb de planning beoordeeld en aanvaard een eventuele langere eindtijd door de beslissers", acceptWarnings, enabled) { acceptWarnings = it }
            Field("Reden beslisser of rondevrijgave", reason, { reason = it }, enabled, max = 1000)
            event.obj("state").rows("fixtures").filter { it.optBoolean("requiresRelease") && !it.optBoolean("released") }.map { it.optInt("round") }.distinct().sorted().forEach { round -> Action("Controleer vrijgave KO-ronde $round", reason.trim().length >= 3, false) { propose("competition.release-round", json("round" to round)) } }
        }
    }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text("Sportieve fase controleren en vastleggen?") }, text = { Text("Alleen werkelijk bevestigde bronnen bepalen doorgang. Een beslisser is een echte 501 best-of-five-partij; een geblokkeerde KO-ronde krijgt nog geen oproep.") }, confirmButton = { TextButton(onClick = { pending = null; actions.command("/platform/actions", command) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Terug") } }) }
}
