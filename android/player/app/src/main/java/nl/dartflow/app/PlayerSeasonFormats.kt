package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import org.json.JSONArray
import org.json.JSONObject

internal fun playerSeasonHasTeams(season: JSONObject) = season.text("format") in listOf("teams", "doubles")
internal fun playerSeasonDivisions(names: String, metadata: JSONObject): JSONArray = JSONArray(names.lines().filter { it.isNotBlank() }.mapIndexed { index, name ->
    val saved = metadata.obj("$index")
    json("name" to name.trim().take(80), "level" to saved.optInt("level", index + 1).coerceIn(1, 12), "targetSize" to saved.optInt("targetSize", 10).coerceIn(8, 12), "promotionPlaces" to saved.optInt("promotionPlaces", 1).coerceIn(0, 3), "relegationPlaces" to saved.optInt("relegationPlaces", 1).coerceIn(0, 3))
})
internal fun playerSeasonFormats(scope: String): List<Pair<String, String>> = if (scope == "national") listOf("singles" to "Landelijke individuele divisies", "teams" to "Landelijke teams", "champions" to "Clubkampioenen") else listOf("singles" to "Individuele competitie", "teams" to "Teams", "doubles" to "Dubbels", "cup" to "Clubcup", "ladder" to "Uitdagingsladder", "drop-in" to "Vrije inloop")
internal fun playerSeasonFormatDescription(format: String, slots: Int = 4): String = when (format) {
    "teams" -> if (slots == 7) "Vier singles, twee dubbels en één teamleg. De vier spelers vormen ook de dubbels en het team. Iedere partij levert één partijpunt op; echte legs blijven apart." else "Vier singles met maximaal één administratief ontbrekend slot. Partijpunten en echte legs blijven apart."
    "doubles" -> "Twee spelers per zijde, met een optionele reserve in de selectie. De server houdt de werpvolgorde en startspeler per leg bij."
    "cup" -> "Knock-out voor clubleden. Alleen definitieve uitslagen plaatsen de winnaar door; een vrijloting levert geen gespeelde legs op."
    "champions" -> "Eén clubkampioen per vereniging uit een afgerond clubseizoen. De genomineerde accepteert en checkt in; de leiding sluit de check-in vóór de loting."
    "ladder" -> "Daag iemand boven je uit binnen de gepubliceerde afstand. De server bewaakt antwoordtermijn, speeltermijn en definitieve positie."
    "drop-in" -> "Check in en meld je beschikbaar. De leiding koppelt beschikbare aanwezigen per ronde en houdt eerdere tegenstanders en rust bij."
    else -> "Individuele competitie met een gepubliceerd programma en definitieve uitslagen."
}
internal fun playerSeasonSlotLabel(slot: JSONObject, format: String = "", slotCount: Int = 4): String {
    val index = slot.optInt("index")
    val kind = slot.text("kind").ifBlank { if (format == "doubles" || format == "teams" && slotCount == 7 && index in 4..5) "double" else if (format == "teams" && slotCount == 7 && index == 6) "team" else "single" }
    return when (kind) { "double" -> "Dubbel ${if (index >= 4) index - 3 else 1}"; "team" -> "Teamleg"; else -> "Single ${index + 1}" }
}
internal fun playerSeasonSlotNames(slot: JSONObject, people: List<JSONObject>): String {
    fun name(id: String) = people.find { it.text("id") == id }?.text("name") ?: if (id.isBlank() || id == "null") "Nog niet onthuld" else "Speler"
    val sides = slot.optJSONArray("sidePlayerIds")
    return if (sides != null) (0..1).joinToString(" – ") { side -> sides.optJSONArray(side)?.strings().orEmpty().joinToString(" & ", transform = ::name).ifBlank { "Nog niet onthuld" } }
    else slot.optJSONArray("players")?.strings().orEmpty().joinToString(" – ", transform = ::name)
}

@Composable internal fun PlayerSeasonFormatControls(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val format = season.text("format")
    val mine = season.rows("participants").find { it.text("id") == state.profile?.id && it.text("status") == "active" }
    val enabled = !state.busy && state.online && season.text("status") !in listOf("completed", "archived")
    if (format in listOf("drop-in", "champions") && mine != null) PlayerCard("Aanwezig en beschikbaar") {
        Text(if (season.text("checkInClosedAt").isNotBlank()) "Check-in gesloten · ${shortDate(season.text("checkInClosedAt"))}" else "Je aanwezigheid bepaalt of je kunt worden ingedeeld.", color = PlayerMuted)
        val canChange = enabled && season.text("checkInClosedAt").isBlank()
        PlayerToggle("Ik ben aanwezig", mine.optBoolean("checkedIn"), canChange) { playerSeasonCommand(actions, season, "season.participant", json("playerId" to mine.text("id"), "checkedIn" to it)) }
        if (format == "drop-in") PlayerToggle("Beschikbaar voor de volgende ronde", mine.optBoolean("available", true), enabled) { playerSeasonCommand(actions, season, "season.participant", json("playerId" to mine.text("id"), "available" to it)) }
    }
    when (format) {
        "ladder" -> PlayerSeasonLadder(season, state, actions)
        "champions" -> PlayerSeasonNominations(season, state, actions)
    }
    if (format == "singles") PlayerSeasonDivisionControls(season, state, actions)
    if (format == "drop-in" && season.optBoolean("canManage")) {
        var confirm by remember { mutableStateOf(false) }
        Action("Koppel volgende inloopronde", enabled) { confirm = true }
        Text("De server controleert aanwezigheid, beschikbaarheid, open partijen en eerdere tegenstanders.", color = PlayerMuted)
        if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Volgende inloopronde koppelen?") }, text = { Text("Koppel de momenteel ingecheckte en beschikbare spelers volgens het gepubliceerde reglement.") }, confirmButton = { TextButton(onClick = { confirm = false; playerSeasonCommand(actions, season, "season.pair-round") }, enabled = enabled) { Text("Koppel ronde") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Annuleren") } })
    }
}

@Composable internal fun PlayerSeasonDivisionControls(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val enabled = !state.busy && state.online
    val predraw = season.rows("fixtures").isEmpty() && season.text("publishedAt").isBlank()
    val self = season.rows("participants").find { it.text("id") == state.profile?.id }
    var player by rememberSaveable { mutableStateOf("") }
    var source by rememberSaveable { mutableStateOf("") }
    var level by rememberSaveable { mutableStateOf("1") }
    var pending by remember { mutableStateOf<String?>(null) }
    if (self != null && predraw) PlayerCard("Instroomkeuze") {
        Choice("Plaatsing als nieuwe speler", self.text("placementChoice", "entry"), listOf("entry" to "Instromen op het laagste niveau", "qualification" to "Via een gespeelde kwalificatie"), { playerSeasonCommand(actions, season, "season.participant", json("playerId" to self.text("id"), "placementChoice" to it)) }, enabled)
        self.optJSONObject("qualification")?.let { Text("Kwalificatie vastgelegd · niveau ${it.optInt("level")} · plaats ${it.optInt("position")} · bronrevisie ${it.optInt("sourceRevision")}", color = PlayerLime) }
    }
    val seed = season.obj("seedSnapshot")
    if (seed.length() > 0) PlayerCard("Gepubliceerde plaatsing") {
        Text("Gesloten ${shortDate(seed.text("closedAt"))} · rankinggeneratie ${seed.text("generation", "Geen generatie")}", color = PlayerMuted)
        seed.rows("rows").forEach { row ->
            val name = season.rows("participants").find { it.text("id") == row.text("playerId") }?.text("name", "Speler") ?: "Speler"
            val division = season.rows("divisions").find { it.text("id") == row.text("divisionId") }?.text("name", "Nog in te delen") ?: "Nog in te delen"
            Text("$name · $division · ${if (row.optBoolean("established")) "rating ${row.optInt("rating")}" else "${row.text("choice")} · nog geen gevestigde rating"}")
        }
    }
    PlayerSeasonVacancies(season, state, actions)
    val plan = season.obj("promotionPlan")
    if (plan.length() > 0) PlayerCard("Promotie- en degradatieplan") {
        Text(if (plan.optBoolean("complete")) "Definitieve overgangen beschikbaar" else "Beslissingswedstrijden moeten nog worden gespeeld", color = PlayerLime)
        plan.rows("transitions").forEach { Text("Niveau ${it.optInt("fromLevel")} → ${it.optInt("toLevel")} · ${it.optInt("count")} plaatsen") }
        plan.rows("ties").filter { it.text("phase") != "complete" }.forEach { Text("Gelijke stand · ${it.optJSONArray("playerIds")?.strings()?.size ?: 0} spelers · ${it.text("phase")}. Open de beslissingswedstrijden in het programma.", color = PlayerMuted) }
    }
    if (!season.optBoolean("canManage")) return
    PlayerCard("Divisie-indeling en overgang") {
        season.rows("divisions").forEach { Text("${it.text("name")} · niveau ${it.optInt("level", 1)} · doel ${it.optInt("targetSize", 10)} deelnemers · promotie ${it.optInt("promotionPlaces", 1)} / degradatie ${it.optInt("relegationPlaces", 1)}", color = PlayerMuted) }
        if (predraw) {
            Action("Deel divisies in op actuele spelersrating", enabled) { pending = "season.seed-divisions" }
            Text("De server bewaart de ratinggeneratie, gevestigde plaatsing en instroomkeuzes. Het programma wordt daarna gecontroleerd gegenereerd.", color = PlayerMuted)
            val sources = season.rows("availableQualificationSources")
            if (sources.isNotEmpty()) {
                Choice("Nieuwe speler", player, listOf("" to "Kies deelnemer") + season.rows("participants").map { it.text("id") to it.text("name") }, { player = it }, enabled)
                Choice("Gespeelde kwalificatie", source, listOf("" to "Kies afgeronde kwalificatie") + sources.map { it.text("id") to it.text("name") }, { source = it }, enabled)
                Choice("Doelniveau kwalificatie", level, season.rows("divisions").map { it.optInt("level", 1) }.distinct().sorted().map { "$it" to "Niveau $it" }, { level = it }, enabled)
                Action("Controleer en leg kwalificatie vast", enabled && player.isNotBlank() && sources.any { it.text("id") == source }, false) { playerSeasonCommand(actions, season, "season.qualification", json("playerId" to player, "sourceSeasonId" to source, "level" to level.toInt())) }
            }
        }
        Action("Bereken promotie- en degradatieplan", enabled && season.rows("fixtures").isNotEmpty(), false) { pending = "season.promotion-plan" }
        if (plan.optBoolean("complete")) Action("Maak volgend seizoen met definitieve overgangen", enabled) { pending = "season.copy" }
    }
    pending?.let { type -> AlertDialog(onDismissRequest = { pending = null }, title = { Text("Indeling of overgang bevestigen?") }, text = { Text(when (type) { "season.seed-divisions" -> "Leg de actuele landelijke ratinggeneratie vast en verdeel deelnemers volgens rating, groepsgrootte en instroomkeuze."; "season.promotion-plan" -> "Controleer de definitieve stand. Gelijke standen op een overgangsgrens krijgen echte best-of-vijf beslissingswedstrijden."; else -> "Kopieer de deelnemers met de definitieve overgangen naar een nieuw seizoensconcept. De bestaande uitslagen en standen blijven bij dit seizoen." }) }, confirmButton = { TextButton(onClick = { pending = null; playerSeasonCommand(actions, season, type, if (type == "season.copy") json("applyPromotions" to true, "copyEntries" to true, "name" to "${season.text("name")} · volgend seizoen") else JSONObject()) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}

@Composable private fun PlayerSeasonLadder(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val ladder = season.obj("ladder")
    val people = season.rows("participants")
    val enabled = !state.busy && state.online && season.text("status") == "active"
    val order = ladder.optJSONArray("order")?.strings().orEmpty()
    val ownIndex = order.indexOf(state.profile?.id)
    var target by rememberSaveable { mutableStateOf("") }
    val rules = season.obj("settings")
    val distance = rules.optInt("ladderDistance", 3)
    fun name(id: String) = people.find { it.text("id") == id }?.text("name") ?: "Speler"
    PlayerCard("Uitdagingsladder") {
        Text("Maximaal $distance plaatsen omhoog · antwoord binnen ${rules.optInt("ladderAnswerHours", 48)} uur · spelen binnen ${rules.optInt("ladderPlayDays", 7)} dagen", color = PlayerMuted)
        order.forEachIndexed { index, id -> Text("${index + 1}. ${name(id)}", color = if (id == state.profile?.id) PlayerLime else PlayerText) }
        if (ownIndex > 0) {
            val options = order.subList(maxOf(0, ownIndex - distance), ownIndex)
            Choice("Daag een speler uit", target, listOf("" to "Kies tegenstander") + options.map { it to name(it) }, { target = it }, enabled)
            Action("Verstuur uitdaging", enabled && target in options) { playerSeasonCommand(actions, season, "season.challenge", json("targetId" to target)) }
        }
        ladder.rows("challenges").asReversed().forEach { challenge ->
            Text("${name(challenge.text("challengerId"))} → ${name(challenge.text("defenderId"))} · ${statusLabel(challenge.text("status"))}")
            Text("Antwoorden vóór ${shortDate(challenge.text("answerBy"))}${challenge.text("playBy").takeIf { it.isNotBlank() }?.let { " · spelen vóór ${shortDate(it)}" }.orEmpty()}", color = PlayerMuted)
            if (challenge.text("status") == "pending" && challenge.text("defenderId") == state.profile?.id) Column {
                Action("Accepteer uitdaging", enabled) { playerSeasonCommand(actions, season, "season.challenge-answer", json("challengeId" to challenge.text("id"), "accept" to true)) }
                Action("Weiger", enabled, false) { playerSeasonCommand(actions, season, "season.challenge-answer", json("challengeId" to challenge.text("id"), "accept" to false)) }
            }
            challenge.text("reason").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
        }
    }
}

@Composable private fun PlayerSeasonNominations(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val enabled = !state.busy && state.online && season.text("status") !in listOf("completed", "archived")
    var source by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var pending by remember { mutableStateOf<String?>(null) }
    var withdraw by remember { mutableStateOf<String?>(null) }
    fun name(id: String) = season.rows("eligiblePlayers").find { it.text("id") == id }?.text("name") ?: season.rows("participants").find { it.text("id") == id }?.text("name") ?: "Genomineerde speler"
    PlayerCard("Clubkampioenen en reserves") {
        Text(playerSeasonFormatDescription("champions"), color = PlayerMuted)
        val sources = season.rows("availableNominationSources")
        if (sources.isNotEmpty() && season.text("checkInClosedAt").isBlank()) {
            Choice("Afgerond clubseizoen", source, listOf("" to "Kies bronseizoen") + sources.map { it.text("id") to it.text("name") }, { source = it }, enabled)
            sources.find { it.text("id") == source }?.let { Text("Kampioen: ${name(it.text("championId"))} · reserve: ${name(it.text("reserveId"))} · bronrevisie ${it.optInt("revision")}", color = PlayerMuted) }
            Action("Nomineer officiële clubkampioen", enabled && sources.any { it.text("id") == source }) { playerSeasonCommand(actions, season, "season.nominate", json("sourceSeasonId" to source)) }
        }
        season.rows("nominations").forEach { nomination ->
            Text("${name(nomination.text("entrantId"))} · ${statusLabel(nomination.text("status"))}", color = PlayerLime)
            Text("Bronseizoen ${nomination.text("sourceSeasonId")} · revisie ${nomination.optInt("sourceRevision")}", color = PlayerMuted)
            if (nomination.text("entrantId") == state.profile?.id && nomination.text("status") in listOf("nominated", "replaced")) Action("Accepteer mijn nominatie", enabled) { playerSeasonCommand(actions, season, "season.nomination-accept", json("clubId" to nomination.text("clubId"))) }
            if (season.optBoolean("canManage") || sources.any { it.text("clubId") == nomination.text("clubId") }) {
                Field("Reden voor reservewissel", reason, { reason = it }, enabled, max = 1000)
                Action("Vervang door officiële reserve", enabled && reason.trim().length >= 5 && nomination.text("entrantId") != nomination.text("reserveId"), false) { pending = nomination.text("clubId") }
                Action("Trek clubnominatie terug", enabled && reason.trim().length >= 5 && season.text("checkInClosedAt").isBlank() && nomination.text("status") != "withdrawn", false) { withdraw = nomination.text("clubId") }
            }
            nomination.text("withdrawalReason").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
        }
        if (season.optBoolean("canManage") && season.text("checkInClosedAt").isBlank()) Action("Sluit check-in en bevries deelnemers", enabled) { pending = "close" }
        if (season.text("checkInClosedAt").isNotBlank()) Text("Deelnemers bevroren op ${shortDate(season.text("checkInClosedAt"))}", color = PlayerLime)
    }
    pending?.let { clubId -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(if (clubId == "close") "Check-in sluiten?" else "Clubkampioen vervangen?") }, text = { Text(if (clubId == "close") "Alleen geaccepteerde en ingecheckte deelnemers worden toegelaten tot de loting." else "De gepubliceerde reserve neemt deze plek over en moet zelf accepteren. Reden: $reason") }, confirmButton = { TextButton(onClick = { pending = null; if (clubId == "close") playerSeasonCommand(actions, season, "season.close-check-in") else playerSeasonCommand(actions, season, "season.nomination-replace", json("clubId" to clubId, "reason" to reason)) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
    withdraw?.let { clubId -> AlertDialog(onDismissRequest = { withdraw = null }, title = { Text("Clubnominatie terugtrekken?") }, text = { Text("Deze vereniging wordt vóór de loting teruggetrokken. Reden: $reason") }, confirmButton = { TextButton(onClick = { withdraw = null; playerSeasonCommand(actions, season, "season.nomination-withdraw", json("clubId" to clubId, "reason" to reason)) }, enabled = enabled) { Text("Trek nominatie terug") } }, dismissButton = { TextButton(onClick = { withdraw = null }) { Text("Annuleren") } }) }
}

@Composable internal fun PlayerSeasonTransfer(season: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    var from by rememberSaveable { mutableStateOf("") }
    var to by rememberSaveable { mutableStateOf("") }
    var player by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    val teams = season.rows("teams").filter { it.text("status") == "active" }
    val source = teams.find { it.text("id") == from }
    val roster = source?.optJSONArray("playerIds")?.strings().orEmpty()
    val enabled = !state.busy && state.online && season.text("status") !in listOf("completed", "archived")
    PlayerCard("Spelertransfer") {
        Text(season.obj("settings").text("transferDeadline").takeIf { it.isNotBlank() }?.let { "Gepubliceerde deadline: ${shortDate(it)}" } ?: "Na indeling zijn transfers alleen mogelijk met een gepubliceerde transferdeadline.", color = PlayerMuted)
        Choice("Van team", from, listOf("" to "Kies huidig team") + teams.map { it.text("id") to it.text("name") }, { from = it; player = "" }, enabled)
        Choice("Speler", player, listOf("" to "Kies speler") + season.rows("eligiblePlayers").filter { it.text("id") in roster }.map { it.text("id") to it.text("name") }, { player = it }, enabled)
        Choice("Naar team", to, listOf("" to "Kies nieuw team") + teams.filter { it.text("id") != from }.map { it.text("id") to it.text("name") }, { to = it }, enabled)
        Field("Reden transfer", reason, { reason = it }, enabled, max = 1000)
        Action("Controleer transfer", enabled && player in roster && to.isNotBlank() && to != from && reason.trim().length >= 5, false) { confirm = true }
        Text("De server controleert lidmaatschap, captains, selectiegrootte, deadline en open opstellingen.", color = PlayerMuted)
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Transfer vastleggen?") }, text = { Text("Verplaats de gekozen speler van ${source?.text("name")} naar ${teams.find { it.text("id") == to }?.text("name")}. Reden: $reason") }, confirmButton = { TextButton(onClick = { confirm = false; playerSeasonCommand(actions, season, "season.transfer", json("playerId" to player, "fromTeamId" to from, "toTeamId" to to, "reason" to reason)) }, enabled = enabled) { Text("Leg transfer vast") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Annuleren") } })
}

@Composable internal fun PlayerSeasonReserve(season: JSONObject, fixture: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    var side by rememberSaveable { mutableStateOf("home") }
    var playerIndex by rememberSaveable { mutableStateOf("0") }
    var playerId by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    val team = season.rows("teams").find { it.text("id") == fixture.text(if (side == "home") "homeId" else "awayId") }
    val roster = team?.optJSONArray("playerIds")?.strings().orEmpty()
    val count = if (season.text("format") == "doubles") 2 else 4
    val enabled = !state.busy && state.online
    Text("Reservewissel", style = MaterialTheme.typography.titleMedium)
    Text("Een wissel werkt door in alle afhankelijke partijen. De server weigert de wissel zodra een betrokken partij gestart is.", color = PlayerMuted)
    Choice("Zijde", side, listOf("home" to "Thuis", "away" to "Uit"), { side = it; playerId = "" }, enabled)
    Choice("Positie in basisopstelling", playerIndex, (0 until count).map { "$it" to "Speler ${it + 1}" }, { playerIndex = it }, enabled)
    Choice("Reserve", playerId, listOf("" to "Kies reserve") + season.rows("eligiblePlayers").filter { it.text("id") in roster }.map { it.text("id") to it.text("name") }, { playerId = it }, enabled)
    Field("Reden reservewissel", reason, { reason = it }, enabled, max = 1000)
    Action("Leg reservewissel vast", enabled && playerId in roster && reason.trim().length >= 5, false) { playerSeasonCommand(actions, season, "season.reserve", json("fixtureId" to fixture.text("id"), "side" to side, "slotIndex" to if (count == 2) 0 else playerIndex.toInt(), "playerIndex" to playerIndex.toInt(), "playerId" to playerId, "reason" to reason)) }
}
