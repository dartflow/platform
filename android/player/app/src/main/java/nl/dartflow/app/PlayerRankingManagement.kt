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
import java.time.OffsetDateTime

internal fun playerRankingClubs(platform: JSONObject): List<JSONObject> = platform.rows("clubs").filter { it.obj("clubAccess").optJSONArray("permissions")?.strings()?.contains("settings.edit") == true }
internal fun playerRankingAction(actions: PlayerActions, type: String, data: JSONObject = JSONObject()) = actions.command("/rankings/actions", json("action" to JSONObject(data.toString()).put("type", type)))

@Composable internal fun PlayerRankingManageContent(state: PlayerUiState, actions: PlayerActions) {
    val selected = state.resource.obj("selectedList")
    val clubs = playerRankingClubs(state.platform)
    val enabled = !state.busy && state.online
    var club by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("circuit") }
    var discipline by rememberSaveable { mutableStateOf("x01") }
    var cricketMode by rememberSaveable { mutableStateOf("standard") }
    var closesAt by rememberSaveable(selected.text("id")) { mutableStateOf("") }
    var reason by rememberSaveable(selected.text("id")) { mutableStateOf("") }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    if (clubs.isNotEmpty()) PlayerCard("Clubrating of circuit maken") {
        Choice("Vereniging", club, listOf("" to "Kies bevoegde vereniging") + clubs.map { it.text("id") to it.text("name") }, { club = it }, enabled)
        Field("Naam klassement", name, { name = it }, enabled, max = 120)
        Choice("Soort", kind, listOf("rating" to "Spelersrating", "circuit" to "Circuit op eindplaats"), { kind = it }, enabled)
        Choice("Discipline van de reeks", discipline, listOf("x01" to "X01", "cricket" to "Cricket"), { discipline = it }, enabled)
        if (discipline == "cricket") Choice("Cricketregels van de reeks", cricketMode, listOf("standard" to "Met punten", "no-score" to "Zonder punten"), { cricketMode = it }, enabled)
        Text("Een nieuwe lijst krijgt een eigen gepubliceerd reglement. Persoonlijke toernooien kunnen hier geen officiële punten voor verdienen.", color = PlayerMuted)
        Action("Maak klassement", enabled && club.isNotBlank() && name.isNotBlank()) { playerRankingAction(actions, "list.create", json("clubId" to club, "kind" to kind, "name" to name.trim(), "policy" to json("discipline" to discipline, "cricketMode" to cricketMode))) }
    }
    if (selected.optBoolean("canManage")) {
        if (selected.text("scope") == "club") key(selected.text("id"), selected.optInt("policyVersion")) { PlayerRankingPolicyEditor(selected, enabled) { policy -> pending = json("type" to "list.policy", "listId" to selected.text("id"), "policy" to policy) } }
        PlayerCard("Sluiten voor nieuwe evenementen") {
            Text("Bestaande gepubliceerde rechten en eerdere resultaten blijven behouden. Nieuwe evenementen volgen de ingangsdatum.", color = PlayerMuted)
            Field("Ingang sluiting · jjjj-mm-ddTuu:mm+01:00", closesAt, { closesAt = it }, enabled, max = 40)
            Field("Reden", reason, { reason = it }, enabled, max = 1000)
            Action("Controleer sluiting", enabled && reason.isNotBlank() && runCatching { OffsetDateTime.parse(closesAt) }.isSuccess, false) { pending = json("type" to "list.close", "listId" to selected.text("id"), "closesAt" to closesAt, "reason" to reason) }
        }
    }
    if (selected.optBoolean("canManage")) state.resource.rows("managementSources").forEach { source -> PlayerCard("Bron ${source.optInt("sequence")} · ${source.optJSONArray("playersNames")?.strings()?.joinToString(" – ").orEmpty()}") {
        Text("${if (source.text("verdict") == "void") "Ongeldig verklaard" else "Geldig"} · revisie ${source.optInt("revision")}", color = PlayerMuted)
        source.text("reason").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
        Text("Eigen gespeelde bronnen vereisen een onafhankelijke beheerder.", color = PlayerMuted)
        PlayerRankingSourceDecision(JSONObject(source.toString()).put("sourceId", source.text("id")).put("sourceRevision", source.optInt("revision")).put("sourceKind", source.text("kind")), state, actions)
        if (source.text("kind") == "event" && source.text("entityId").isNotBlank()) Action("Open circuitevenement", primary = false) { actions.navigate(PlayerScreen.RANKING_EVENT, source.text("entityId")) }
        else if (source.text("matchId").isNotBlank()) Action("Open bronwedstrijd", primary = false) { actions.navigate(PlayerScreen.MATCH, source.text("matchId")) }
    } }
    val approvals = state.resource.rows("approvals").filter { it.optBoolean("canApprove") }
    approvals.forEach { declaration -> PlayerRankingDeclaration(declaration, state, actions) }
    if (clubs.isEmpty() && !selected.optBoolean("canManage") && approvals.isEmpty()) Text("Je hebt geen actueel beheerrecht voor deze ranking.", color = PlayerMuted)
    pending?.let { data -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(if (data.text("type") == "list.close") "Klassement sluiten?" else "Nieuw reglement publiceren?") }, text = { Text("${selected.text("name")}\n${data.text("reason", "De server controleert of het huidige beleid nog gewijzigd mag worden. Bestaande toezeggingen aan evenementen blijven vast.")}") }, confirmButton = { TextButton(onClick = { pending = null; playerRankingAction(actions, data.text("type"), data) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Terug") } }) }
}

@Composable private fun PlayerRankingPolicyEditor(selected: JSONObject, enabled: Boolean, save: (JSONObject) -> Unit) {
    val initial = selected.obj("policy")
    var draft by rememberSaveable { mutableStateOf(initial.toString()) }
    val policy = JSONObject(draft)
    fun change(key: String, value: Any) { draft = JSONObject(draft).put(key, value).toString() }
    val numeric = if (selected.text("kind") == "circuit") listOf("eventCount" to "Aantal circuitevenementen", "bestResults" to "Beste resultaten tellen", "minimumStarters" to "Minimum werkelijk gestarte spelers") else listOf("k" to "Ratingfactor", "placementMatches" to "Partijen voor plaatsing", "placementOpponents" to "Unieke tegenstanders voor plaatsing", "activeDays" to "Actief gedurende dagen")
    PlayerCard("Clubreglement wijzigen") {
        Choice("Discipline van het reglement", policy.text("discipline", "x01"), listOf("x01" to "X01", "cricket" to "Cricket"), { change("discipline", it) }, enabled)
        if (policy.text("discipline", "x01") == "cricket") Choice("Cricketregels", policy.text("cricketMode", "standard"), listOf("standard" to "Met punten", "no-score" to "Zonder punten"), { change("cricketMode", it) }, enabled)
        else Choice("Startscore reglement", policy.text("startScore", "501"), listOf("301", "501", "701").map { it to it }, { change("startScore", it.toInt()) }, enabled)
        var legs by rememberSaveable { mutableStateOf(policy.optJSONArray("bestOfLegs")?.ints()?.joinToString(", ") ?: "1, 3, 5, 7, 9") }
        Field("Toegestane best-of legs · gescheiden door komma", legs, { legs = it }, enabled, max = 100)
        Field("Seizoen", policy.text("season"), { change("season", it) }, enabled, max = 80)
        numeric.forEach { (key, label) -> Field(label, policy.text(key), { change(key, it) }, enabled, keyboard = KeyboardType.Number, max = 3) }
        PlayerToggle("Gasten toegestaan volgens reglement", policy.optBoolean("allowGuests"), enabled) { change("allowGuests", it) }
        Text("Zodra het reglement is toegezegd aan een evenement, vereist een beleidswijziging een nieuwe seizoenlijst.", color = PlayerMuted)
        val profiles = legs.split(",").map { it.trim().toIntOrNull() }
        Action("Controleer nieuw reglement", enabled && profiles.isNotEmpty() && profiles.all { it != null && it in 1..19 && it % 2 == 1 } && numeric.all { policy.text(it.first).toIntOrNull()?.let { value -> value > 0 } == true }) {
            val values = JSONObject(policy.toString()).put("bestOfLegs", JSONArray(profiles)); numeric.forEach { (key, _) -> values.put(key, policy.text(key).toInt()) }; save(values)
        }
    }
}

@Composable internal fun PlayerRankingDeclaration(declaration: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    var reason by rememberSaveable(declaration.text("id")) { mutableStateOf("") }
    var recertify by remember { mutableStateOf(false) }
    val enabled = !state.busy && state.online
    PlayerCard("${declaration.text("listName")} · ${declaration.text("eventName")}") {
        Text("${statusLabel(declaration.text("status"))} · reglement ${declaration.optInt("policyVersion")}", color = PlayerLime)
        Text(if (declaration.text("kind") == "circuit") "Circuit · beste ${declaration.obj("policy").optInt("bestResults")} van ${declaration.obj("policy").optInt("eventCount")} resultaten" else "Spelersrating · ${playerRuleLabel(declaration.obj("policy"))}", color = PlayerMuted)
        declaration.rows("rules").forEach { rule -> Text("${if (rule.optBoolean("enabled")) "Telt mee" else "Uitgesloten"} · ${rule.text("phase", "alle fasen")}${if (rule.has("round")) " · ronde ${rule.optInt("round")}" else ""}${if (rule.has("fixtureId")) " · aangewezen partij" else ""}", color = PlayerMuted) }
        declaration.text("reason").takeIf { it.isNotBlank() }?.let { Text(it) }
        if (declaration.optBoolean("canApprove") && declaration.text("status") == "pending") {
            Field("Reden van erkenningsbesluit", reason, { reason = it }, enabled, max = 1000)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("approve" to "Goedkeuren", "reject" to "Afwijzen").forEach { (decision, title) -> Action(title, enabled && reason.isNotBlank(), decision == "approve", Modifier.weight(1f)) { playerRankingAction(actions, "event.approve", json("declarationId" to declaration.text("id"), "decision" to decision, "reason" to reason)) } } }
        }
        if (declaration.optBoolean("canRecertify") && declaration.optBoolean("recertificationRequired")) {
            Field("Reden voor herbevestiging na correctie", reason, { reason = it }, enabled, max = 1000)
            Action("Herbevestig gecorrigeerde circuiteindstand", enabled && reason.trim().length >= 3, false) { recertify = true }
        }
        Action("Open evenement en gevolgen", primary = false) { actions.navigate(PlayerScreen.RANKING_EVENT, declaration.text("entityId")) }
    }
    if (recertify) AlertDialog(onDismissRequest = { recertify = false }, title = { Text("Gecorrigeerde circuiteindstand herbevestigen?") }, text = { Text("De server controleert onafhankelijk beheer en de definitief opnieuw ondertekende bronpartijen. Reden: $reason") }, confirmButton = { TextButton(onClick = { recertify = false; playerRankingAction(actions, "event.recertify", json("entityId" to declaration.text("entityId"), "listId" to declaration.text("listId"), "reason" to reason)) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { recertify = false }) { Text("Annuleren") } })
}

internal fun playerRankingPendingRosters(event: JSONObject, actorId: String?): List<JSONObject> = event.rows("rosterReconfirmations").filter { !it.optBoolean("accepted") && actorId != null && it.rows("players").any { player -> player.text("id") == actorId } }
internal fun playerRankingConsent(event: JSONObject, actorId: String?): JSONObject = json("entityId" to event.text("entityId")).also { data ->
    val rosters = playerRankingPendingRosters(event, actorId)
    if (rosters.isNotEmpty()) data.put("rosterVersions", JSONArray(rosters.map { json("matchId" to it.text("matchId"), "version" to it.optInt("version")) }))
}

@Composable internal fun PlayerEventRankingsScreen(state: PlayerUiState, actions: PlayerActions) {
    val event = state.resource
    val id = event.text("entityId", state.activeId.orEmpty())
    val enabled = !state.busy && state.online
    var selected by rememberSaveable { mutableStateOf("") }
    var phase by rememberSaveable { mutableStateOf("") }
    var round by rememberSaveable { mutableStateOf("") }
    var fixtureId by rememberSaveable { mutableStateOf("") }
    var include by rememberSaveable { mutableStateOf(true) }
    var ruleDraft by rememberSaveable { mutableStateOf("[]") }
    var confirmFinalize by rememberSaveable { mutableStateOf(false) }
    Heading(event.text("name", "Rankinggevolgen"), "REGLEMENT EN ERKENNING")
    if (event.text("ownership") == "personal") { Notice("Persoonlijk toernooi · geen officiële rating- of circuitpunten."); return }
    val declarations = event.rows("declarations")
    declarations.forEach { declaration -> PlayerRankingDeclaration(declaration, state, actions) }
    if (declarations.isEmpty() && !state.loading) Text("Er is geen officiële rankingbestemming vastgelegd voor dit evenement.", color = PlayerMuted)
    val platformEvent = (state.platform.rows("tournaments") + state.platform.rows("leagues")).find { it.text("id") == id }
    if (event.optBoolean("canAccept") && declarations.any { it.text("status") == "approved" && !it.optBoolean("accepted") }) PlayerCard("Jouw instemming vóór de start") {
        Text("Bevestig de hierboven gepubliceerde officiële gevolgen met je eigen spelersaccount. De server controleert je inschrijving en of het evenement nog niet gestart is.", color = PlayerMuted)
        playerRankingPendingRosters(event, state.profile?.id).forEach { roster ->
            Text("Nieuwe bezetting · ${roster.rows("players").joinToString(" – ") { it.text("name") }} · versie ${roster.optInt("version")}", color = PlayerLime)
            Text(roster.text("reason"), color = PlayerMuted)
        }
        Text("Een eerdere instemming geldt niet automatisch voor een gewijzigde tegenstander. Deze bevestiging geldt voor de hierboven getoonde bezetting en versie.", color = PlayerMuted)
        Action("Ik stem in met deze gepubliceerde gevolgen", enabled) { playerRankingAction(actions, "event.accept", playerRankingConsent(event, state.profile?.id).put("entityId", id)) }
    }
    if (event.optBoolean("canRequest")) PlayerCard("Rankingbestemming aanmelden") {
        val lists = event.rows("availableLists").filter { list -> declarations.none { it.text("listId") == list.text("id") && it.text("status") != "rejected" } }
        Choice("Bestemming", selected, listOf("" to "Kies ranking of circuit") + lists.map { it.text("id") to it.text("name") }, { selected = it }, enabled)
        Choice("Aangewezen fase", phase, listOf("" to "Alle fasen", "pool" to "Poules", "knockout" to "Knock-out", "league" to "Competitie", "winners" to "Winnaars", "losers" to "Verliezers", "final" to "Finale", "reset" to "Resetfinale", "swiss" to "Zwitsers"), { phase = it }, enabled)
        Field("Ronde · leeg voor alle ronden", round, { round = it }, enabled, keyboard = KeyboardType.Number, max = 3)
        val fixtures = event.rows("fixtures").ifEmpty { platformEvent?.obj("state")?.rows("fixtures").orEmpty() }
        if (fixtures.isNotEmpty()) Choice("Specifieke partij", fixtureId, listOf("" to "Alle partijen in deze selectie") + fixtures.map { it.text("id") to "Ronde ${it.optInt("round")} · ${playerTournamentPhaseLabel(it.text("phase"))}" }, { fixtureId = it }, enabled)
        PlayerToggle("Selectie telt mee", include, enabled) { include = it }
        fun currentRule() = json("enabled" to include).also { rule -> if (phase.isNotBlank()) rule.put("phase", phase); if (round.isNotBlank()) rule.put("round", round.toInt()); if (fixtureId.isNotBlank()) rule.put("fixtureId", fixtureId) }
        val validRule = round.isBlank() || round.toIntOrNull()?.let { it > 0 } == true
        Action("Voeg aanwijzingsregel toe", enabled && validRule, false) { ruleDraft = JSONArray(ruleDraft).put(currentRule()).toString() }
        JSONArray(ruleDraft).objects().forEachIndexed { index, rule -> Text("Regel ${index + 1}: ${if (rule.optBoolean("enabled")) "telt mee" else "uitgesloten"} · ${rule.text("phase", "alle fasen")}${if (rule.has("round")) " · ronde ${rule.optInt("round")}" else ""}${if (rule.has("fixtureId")) " · aangewezen partij" else ""}", color = PlayerMuted) }
        if (JSONArray(ruleDraft).length() > 0) Action("Wis aanwijzingsregels", enabled, false) { ruleDraft = "[]" }
        Text("De aanwijzing moet vóór de eerste pijl worden vastgelegd. Een landelijke bestemming vereist het eigen erkenningsbesluit.", color = PlayerMuted)
        Action("Dien erkenningsaanvraag in", enabled && selected.isNotBlank() && (round.isBlank() || round.toIntOrNull()?.let { it > 0 } == true)) {
            val rules = JSONArray(ruleDraft).takeIf { it.length() > 0 } ?: JSONArray(listOf(currentRule()))
            playerRankingAction(actions, "event.request", json("entityId" to id, "listId" to selected, "rules" to rules))
        }
    }
    if (event.optBoolean("canFinalize")) Action("Controleer en publiceer circuiteindstand", enabled) { confirmFinalize = true }
    if (confirmFinalize) AlertDialog(onDismissRequest = { confirmFinalize = false }, title = { Text("Circuiteindstand definitief verwerken?") }, text = { Text("De server controleert alle uitslagen, bezwaren, werkelijk gestarte spelers en goedgekeurde bestemmingen. Alleen geldige eindplaatsen worden verwerkt.") }, confirmButton = { TextButton(onClick = { confirmFinalize = false; playerRankingAction(actions, "event.finalize", json("entityId" to id)) }, enabled = enabled) { Text("Verwerk eindstand") } }, dismissButton = { TextButton(onClick = { confirmFinalize = false }) { Text("Terug") } })
    Action("Hulp over rankingbestemmingen", primary = false) { actions.navigate(PlayerScreen.HELP, "q=rankingbestemming") }
}

@Composable internal fun PlayerRankingSourceDecision(source: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    var reason by rememberSaveable(source.text("sourceId")) { mutableStateOf("") }
    var decision by rememberSaveable { mutableStateOf("void") }
    var confirm by rememberSaveable { mutableStateOf(false) }
    val enabled = !state.busy && state.online
    Field("Reden bronbesluit", reason, { reason = it }, enabled, max = 1000)
    if (source.text("sourceKind", source.text("kind")) == "event") Text("Een gecorrigeerd circuitevenement wordt opnieuw beoordeeld en herbevestigd via het erkenningsdossier.", color = PlayerMuted)
    Choice("Rankingbron beoordelen", decision, listOf("void" to "Deze bron ongeldig verklaren") + if (source.text("sourceKind", source.text("kind")) == "event") emptyList() else listOf("restore" to "Deze bron herstellen"), { decision = it }, enabled)
    Action("Controleer bronbesluit", enabled && reason.isNotBlank(), false) { confirm = true }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text(if (decision == "void") "Rankingbron ongeldig verklaren?" else "Rankingbron herstellen?") }, text = { Text("$reason\nDe server controleert revisie ${source.optInt("sourceRevision")} en bouwt de geraakte ranking opnieuw op. De onderliggende scorekaart blijft bewaard.") }, confirmButton = { TextButton(onClick = { confirm = false; playerRankingAction(actions, "source.decide", json("sourceId" to source.text("sourceId"), "expectedRevision" to source.optInt("sourceRevision"), "decision" to decision, "reason" to reason)) }, enabled = enabled) { Text("Leg besluit vast") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Terug") } })
}
