package nl.dartflow.app

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** Persist only the known, non-sensitive wizard fields, scoped to the signed-in account. */
internal object PlayerOrganizerDraft {
    private val defaults = mapOf<String, Any>("discipline" to "x01", "cricketMode" to "standard", "ownership" to "personal", "name" to "", "description" to "", "date" to "", "location" to "", "clubId" to "", "format" to "pools-knockout", "capacity" to "16", "boards" to "4", "poolCount" to "4", "startScore" to "501", "bestOfLegs" to "5", "eligibility" to "all", "requireWriter" to true, "approvalRequired" to false, "visibility" to "private", "inRule" to "single", "outRule" to "double", "handicap" to false, "leftStart" to "501", "rightStart" to "501", "swissRounds" to "3", "startProcedure" to "bull", "setOpener" to "continuous", "decidingLeg" to "continue", "bestOfSets" to "1", "bronze" to false, "consolation" to false, "consolationTitle" to "Troostbeker", "legTwoDifference" to false, "setTwoDifference" to false, "legMaximum" to "19", "setMaximum" to "9", "planMatchMinutes" to "20", "planFinalMinutes" to "20", "planRestMinutes" to "5", "planChangeMinutes" to "0", "planQualify" to "2", "planStartAt" to "", "planDeadline" to "", "planEnabled" to false, "planAcknowledged" to false, "step" to 0)
    fun sanitize(input: JSONObject): JSONObject = JSONObject().also { result ->
        defaults.forEach { (key, fallback) ->
            result.put(key, when (fallback) {
                is Boolean -> input.optBoolean(key, fallback)
                is Int -> input.optInt(key, fallback).coerceIn(0, 3)
                else -> input.optString(key, fallback.toString()).take(if (key == "description") 2000 else 200)
            })
        }
    }
    fun errors(input: JSONObject): Map<String, String> {
        val d = sanitize(input)
        val errors = linkedMapOf<String, String>()
        if (d.text("name").trim().length !in 1..80) errors["name"] = "Vul een naam van maximaal 80 tekens in."
        if (runCatching { LocalDate.parse(d.text("date")) }.getOrNull() == null) errors["date"] = "Gebruik een geldige datum: jjjj-mm-dd."
        if (d.text("ownership") !in listOf("personal", "club", "platform")) errors["ownership"] = "Kies een geldige eigenaar."
        if (d.text("ownership") == "club" && d.text("clubId").isBlank()) errors["clubId"] = "Kies een vereniging waarvoor je mag organiseren."
        listOf(Triple("capacity", 2..128, "deelnemers"), Triple("boards", 1..32, "banen"), Triple("poolCount", 1..8, "poules")).forEach { (key, range, label) ->
            if (d.text(key).toIntOrNull() !in range) errors[key] = "Kies ${range.first}–${range.last} $label."
        }
        if (d.text("format") !in listOf("pools-knockout", "knockout", "double-elimination-reset", "double-elimination-single", "swiss")) errors["format"] = "Kies een ondersteunde speelvorm."
        if (d.text("startScore") !in listOf("301", "501", "701")) errors["startScore"] = "Kies 301, 501 of 701."
        if (d.text("bestOfLegs").toIntOrNull()?.let { it in 1..19 && it % 2 == 1 } != true) errors["bestOfLegs"] = "Kies een oneven aantal legs van 1 tot 19."
        if (d.text("eligibility") !in listOf("all", "code", "club") || d.text("eligibility") == "club" && d.text("ownership") != "club") errors["eligibility"] = "Alleen een clubevent kan uitsluitend clubleden toelaten."
        if (d.text("visibility") !in listOf("public", "private", "club") || d.text("visibility") == "club" && d.text("ownership") != "club") errors["visibility"] = "Kies een geldige zichtbaarheid voor de eigenaar."
        if (d.text("discipline") !in listOf("x01", "cricket")) errors["discipline"] = "Kies X01 of Cricket."
        if (d.text("cricketMode") !in listOf("standard", "no-score")) errors["cricketMode"] = "Kies standaard Cricket of zonder punten."
        if (d.text("discipline") == "cricket" && (d.optBoolean("handicap") || d.text("inRule") != "single" || d.text("outRule") != "double")) errors["discipline"] = "Cricket gebruikt eigen sluitingsregels zonder X01-handicap."
        if (d.text("inRule") !in listOf("single", "double")) errors["inRule"] = "Kies single of dubbel in."
        if (d.text("outRule") !in listOf("straight", "double", "master")) errors["outRule"] = "Kies straight, dubbel of master uit."
        if (d.optBoolean("handicap")) listOf("leftStart", "rightStart").forEach { key -> if (d.text(key).toIntOrNull()?.let { it in (if (d.text("outRule") == "straight") 1 else 2)..1001 } != true) errors[key] = "Kies een handicap-startscore tot 1001." }
        if (d.text("format") == "swiss" && d.text("swissRounds").toIntOrNull()?.let { it in 1..128 } != true) errors["swissRounds"] = "Kies één tot 128 Zwitserse ronden."
        if (d.text("startProcedure") !in listOf("bull", "server-lot", "home-first") || d.text("setOpener") !in listOf("continuous", "alternate-sets") || d.text("decidingLeg") !in listOf("continue", "rebull") || d.text("bestOfSets") !in listOf("1", "3", "5")) errors["startProcedure"] = "Controleer de startprocedure en setregels."
        for (prefix in listOf("leg", "set")) if (d.optBoolean("${prefix}TwoDifference")) { val cap = d.text("${prefix}Maximum").toIntOrNull(); val base = d.text(if (prefix == "leg") "bestOfLegs" else "bestOfSets").toIntOrNull() ?: 1; if (cap == null || cap < base || cap !in 1..99 || cap % 2 != 1) errors["${prefix}Maximum"] = "Kies een oneven harde cap van minstens de best-of, tot 99." }
        if (d.text("format") == "knockout" && d.optBoolean("consolation") && d.text("consolationTitle").trim().length !in 1..80) errors["consolationTitle"] = "Geef de troostbeker een titel van maximaal 80 tekens."
        return errors
    }
    fun command(input: JSONObject): JSONObject {
        require(errors(input).isEmpty()) { "Controleer de gemarkeerde velden." }
        val d = sanitize(input)
        return json("type" to "tournament.create", "drawCheckedInOnly" to true, "ownership" to d.text("ownership"), "name" to d.text("name").trim(), "description" to d.text("description").trim(), "date" to d.text("date"), "location" to d.text("location").trim(), "format" to d.text("format"), "eligibility" to d.text("eligibility"), "visibility" to d.text("visibility"), "capacity" to d.text("capacity").toInt(), "boards" to d.text("boards").toInt(), "poolCount" to d.text("poolCount").toInt(), "startScore" to d.text("startScore").toInt(), "bestOfLegs" to d.text("bestOfLegs").toInt(), "requireWriter" to d.optBoolean("requireWriter"), "approvalRequired" to d.optBoolean("approvalRequired")).also {
            playerStartSettings(d).keys().forEach { key -> it.put(key, playerStartSettings(d).get(key)) }
            it.put("bronze", d.optBoolean("bronze") && d.text("format") in listOf("knockout", "pools-knockout"))
            it.put("consolation", d.optBoolean("consolation") && d.text("format") == "knockout").put("consolationTitle", d.text("consolationTitle").trim())
            if (d.optBoolean("planEnabled")) it.put("planning", playerPlanningSettings(d)).put("acceptPlanningWarnings", d.optBoolean("planAcknowledged"))
            it.put("discipline", d.text("discipline")).put("cricketMode", d.text("cricketMode")).put("inRule", d.text("inRule")).put("outRule", d.text("outRule"))
            if (d.optBoolean("handicap")) it.put("sideStartScores", JSONArray(listOf(d.text("leftStart").toInt(), d.text("rightStart").toInt())))
            if (d.text("format") == "swiss") it.put("swissRounds", d.text("swissRounds").toInt())
            if (d.text("ownership") == "club") it.put("clubId", d.text("clubId"))
        }
    }
    fun clubs(platform: JSONObject): List<JSONObject> = platform.rows("clubs").filter { club -> club.obj("clubAccess").optJSONArray("permissions")?.strings()?.contains("tournaments.manage") == true }
}

@Composable internal fun PlayerOrganizerScreen(state: PlayerUiState, actions: PlayerActions) {
    val draft = PlayerOrganizerDraft.sanitize(state.organizerDraft)
    val step = draft.optInt("step")
    var validating by rememberSaveable { mutableStateOf(false) }
    fun update(key: String, value: Any) = actions.saveOrganizerDraft(JSONObject(draft.toString()).put(key, value).also { if (key != "planAcknowledged" && key != "step") it.put("planAcknowledged", false) })
    val errors = if (validating) PlayerOrganizerDraft.errors(draft) else emptyMap()
    val clubs = PlayerOrganizerDraft.clubs(state.platform)
    val steps = listOf("Doel en eigenaar", "Deelnemers en speelvorm", "Spelregels en banen", "Controleren en publiceren")
    Heading("Toernooi organiseren", "STAP ${step + 1} VAN ${steps.size}", steps[step])
    Text("Concept op dit apparaat bewaard · Europe/Amsterdam", color = PlayerMuted)
    PlayerCloudDraftPanel(state, actions, "tournament", draft.text("ownership"), draft.text("clubId"), draft.text("name"), "$step", draft) { actions.saveOrganizerDraft(PlayerOrganizerDraft.sanitize(it)) }
    Action("Hulp bij organiseren", primary = false) { actions.navigate(PlayerScreen.HELP, "q=organiseren") }
    when (step) {
        0 -> PlayerCard("Jouw toernooi") {
            Choice("Eigenaar", draft.text("ownership"), listOf("personal" to "Ikzelf") + (if (clubs.isNotEmpty()) listOf("club" to "Mijn vereniging") else emptyList()) + (if (state.canManagePlatform) listOf("platform" to "DartFlow") else emptyList()), { value ->
                actions.saveOrganizerDraft(JSONObject(draft.toString()).put("ownership", value).put("clubId", "").put("eligibility", "all").put("visibility", "private"))
            }, !state.busy)
            if (draft.text("ownership") == "personal") Text("Eigen toernooi · geen officiële rankingpunten", color = PlayerLime)
            if (draft.text("ownership") == "club") Choice("Vereniging", draft.text("clubId"), listOf("" to "Kies vereniging") + clubs.map { it.text("id") to it.text("name") }, { update("clubId", it) }, !state.busy)
            errors["clubId"]?.let { Text(it, color = PlayerError) }
            Choice("Zichtbaarheid", draft.text("visibility"), listOf("private" to "Besloten · via uitnodiging", "public" to "Openbaar") + (if (draft.text("ownership") == "club") listOf("club" to "Alleen vereniging") else emptyList()), { update("visibility", it) }, !state.busy)
            Field("Naam", draft.text("name"), { update("name", it) }, !state.busy, error = errors["name"], max = 80)
            Field("Datum · jjjj-mm-dd", draft.text("date"), { update("date", it) }, !state.busy, error = errors["date"], max = 10)
            Field("Locatie of remote", draft.text("location"), { update("location", it) }, !state.busy, max = 200)
            Field("Beschrijving", draft.text("description"), { update("description", it) }, !state.busy, max = 2000, multiline = true)
        }
        1 -> PlayerCard("Inschrijving en indeling") {
            Field("Maximum deelnemers", draft.text("capacity"), { update("capacity", it) }, !state.busy, keyboard = KeyboardType.Number, error = errors["capacity"], max = 3)
            Choice("Wie mag inschrijven?", draft.text("eligibility"), listOf("all" to "Iedereen", "code" to "Met uitnodigingscode") + (if (draft.text("ownership") == "club") listOf("club" to "Alleen clubleden") else emptyList()), { update("eligibility", it) }, !state.busy)
            Choice("Speelvorm", draft.text("format"), listOf("pools-knockout" to "Poules en knock-out", "knockout" to "Enkele eliminatie", "double-elimination-reset" to "Dubbele eliminatie · resetfinale", "double-elimination-single" to "Dubbele eliminatie · enkele finale", "swiss" to "Zwitsers"), { update("format", it) }, !state.busy)
            if (draft.text("format") == "pools-knockout") Field("Aantal poules", draft.text("poolCount"), { update("poolCount", it) }, !state.busy, keyboard = KeyboardType.Number, error = errors["poolCount"], max = 1)
            if (draft.text("format").startsWith("double-elimination")) Text(if (draft.text("format") == "double-elimination-reset") "De finalist uit het verliezersschema moet de ongeslagen finalist tweemaal verslaan. Alleen dan wordt de resetfinale gespeeld." else "Eén grand final beslist het toernooi. Er volgt geen reset als de finalist uit het verliezersschema wint.", color = PlayerMuted)
            if (draft.text("format") == "swiss") Field("Aantal Zwitserse ronden", draft.text("swissRounds"), { update("swissRounds", it) }, !state.busy, keyboard = KeyboardType.Number, error = errors["swissRounds"], max = 3)
            if (draft.text("format") in listOf("pools-knockout", "knockout")) PlayerToggle("Wedstrijd om derde plaats", draft.optBoolean("bronze"), !state.busy) { update("bronze", it) }
            if (draft.text("format") == "knockout") { PlayerToggle("Aparte troostbeker na echte nederlaag in ronde één", draft.optBoolean("consolation"), !state.busy) { update("consolation", it) }; if (draft.optBoolean("consolation")) Field("Titel troostbeker", draft.text("consolationTitle"), { update("consolationTitle", it) }, !state.busy, max = 80, error = errors["consolationTitle"]) }
            PlayerToggle("Aanmeldingen eerst goedkeuren", draft.optBoolean("approvalRequired"), !state.busy) { update("approvalRequired", it) }
            Text("Deelnemers schrijven in via de gedeelde toernooilink. De loting volgt vanuit wedstrijdleiding.", color = PlayerMuted)
        }
        2 -> PlayerCard("Spelregels en planning") {
            Choice("Discipline", draft.text("discipline"), listOf("x01" to "X01", "cricket" to "Cricket"), { value -> actions.saveOrganizerDraft(JSONObject(draft.toString()).put("discipline", value).put("inRule", "single").put("outRule", "double").put("handicap", false)) }, !state.busy)
            if (draft.text("discipline") == "cricket") Choice("Cricketregels", draft.text("cricketMode"), listOf("standard" to "Met punten", "no-score" to "Zonder punten"), { update("cricketMode", it) }, !state.busy)
            Choice("Best of legs", draft.text("bestOfLegs"), (1..19 step 2).map { it.toString() }.map { it to "Best of $it" }, { update("bestOfLegs", it) }, !state.busy)
            if (draft.text("discipline") == "x01") {
            Choice("Startscore · dubbel uit", draft.text("startScore"), listOf("301" to "301", "501" to "501", "701" to "701"), { update("startScore", it) }, !state.busy)
            Choice("Openen", draft.text("inRule"), listOf("single" to "Single in", "double" to "Dubbel in"), { update("inRule", it) }, !state.busy)
            Choice("Uitgooien", draft.text("outRule"), listOf("straight" to "Straight uit", "double" to "Dubbel uit", "master" to "Master uit · dubbel of triple"), { update("outRule", it) }, !state.busy)
            PlayerToggle("Handicap per zijde", draft.optBoolean("handicap"), !state.busy) { update("handicap", it) }
            if (draft.optBoolean("handicap")) {
                Field("Startscore eerste zijde", draft.text("leftStart"), { update("leftStart", it) }, !state.busy, keyboard = KeyboardType.Number, error = errors["leftStart"], max = 4)
                Field("Startscore tweede zijde", draft.text("rightStart"), { update("rightStart", it) }, !state.busy, keyboard = KeyboardType.Number, error = errors["rightStart"], max = 4)
            }
            }
            PlayerStartSettingsFields(draft, !state.busy) { key, value -> update(key, value) }
            Field("Aantal banen", draft.text("boards"), { update("boards", it) }, !state.busy, keyboard = KeyboardType.Number, error = errors["boards"], max = 2)
            PlayerToggle("Aparte schrijver vereist", draft.optBoolean("requireWriter"), !state.busy) { update("requireWriter", it) }
            Text("De wedstrijdleiding controleert bij elke oproep aanwezigheid, rust en beschikbaarheid van baan en schrijver.", color = PlayerMuted)
            PlayerOrganizerPlanning(draft, state, actions) { key, value -> update(key, value) }
        }
        3 -> PlayerCard("Publicatie controleren") {
            Text(draft.text("name"), style = MaterialTheme.typography.titleLarge)
            Text("${draft.text("date")} · ${draft.text("location")}")
            Text("${draft.text("capacity")} deelnemers · ${draft.text("boards")} banen · ${playerTournamentFormatLabel(draft.text("format"))}")
            Text("Zichtbaarheid: ${when (draft.text("visibility")) { "public" -> "Openbaar"; "club" -> "Alleen vereniging"; else -> "Besloten" }}")
            if (draft.text("discipline") == "cricket") Text("Cricket · ${if (draft.text("cricketMode") == "no-score") "zonder punten" else "met punten"} · best of ${draft.text("bestOfLegs")} legs") else Text("${draft.text("startScore")} · ${if (draft.text("inRule") == "double") "Dubbel in" else "Single in"} · ${when (draft.text("outRule")) { "master" -> "Master uit"; "straight" -> "Straight uit"; else -> "Dubbel uit" }} · best of ${draft.text("bestOfLegs")} legs")
            if (draft.optBoolean("handicap")) Text("Handicap: ${draft.text("leftStart")} – ${draft.text("rightStart")}")
            if (draft.optBoolean("legTwoDifference") || draft.optBoolean("setTwoDifference")) Text(playerDifferenceLabel(playerDifferenceSettings(draft)).removePrefix(" · "), color = PlayerLime)
            if (draft.text("format") == "swiss") Text("${draft.text("swissRounds")} Zwitserse ronden")
            if (draft.text("format") == "knockout" && draft.optBoolean("consolation")) Text("Aparte ${draft.text("consolationTitle")} · alleen echte eerste-rondeverliezers, eigen eindplaats en geen extra circuitbonus.", color = PlayerLime)
            Text(if (draft.text("ownership") == "personal") "Persoonlijk evenement · geen officiële rankingpunten" else "${if (draft.text("ownership") == "club") clubs.find { it.text("id") == draft.text("clubId") }?.text("name") ?: "Vereniging" else "DartFlow"} · ranking volgt het gepubliceerde reglement", color = PlayerLime)
            errors.values.forEach { Text(it, color = PlayerError) }
            Action("Publiceer toernooi", !state.busy && state.online && PlayerOrganizerDraft.errors(draft).isEmpty(), modifier = Modifier.fillMaxWidth()) { actions.platformAction(PlayerOrganizerDraft.command(draft)) }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Action(if (step == 0) "Terug" else "Vorige stap", !state.busy, false, Modifier.weight(1f)) { if (step == 0) actions.back() else update("step", step - 1) }
        if (step < 3) Action("Volgende stap", !state.busy, modifier = Modifier.weight(1f)) {
            validating = true
            val relevant = when (step) { 0 -> setOf("name", "date", "ownership", "clubId", "visibility"); 1 -> setOf("capacity", "poolCount", "format", "eligibility", "swissRounds"); else -> setOf("boards", "startScore", "bestOfLegs", "inRule", "outRule", "leftStart", "rightStart") }
            if (PlayerOrganizerDraft.errors(draft).keys.none { it in relevant }) { validating = false; update("step", step + 1) }
        }
    }
}

@Composable internal fun PlayerToggle(label: String, checked: Boolean, enabled: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { Text(label, Modifier.weight(1f)); Switch(checked = checked, onCheckedChange = change, enabled = enabled) }
}

internal fun playerManagedEvent(state: PlayerUiState): JSONObject = state.resource.optJSONObject("entity")?.takeIf { it.text("id") == state.activeId }
    ?: (state.platform.rows("tournaments") + state.platform.rows("leagues")).find { it.text("id") == state.activeId } ?: JSONObject()

@Composable internal fun PlayerDirectorScreen(state: PlayerUiState, actions: PlayerActions) {
    val event = playerManagedEvent(state)
    val id = event.text("id")
    val body = event.obj("state")
    val context = LocalContext.current
    var tab by rememberSaveable { mutableStateOf("entries") }
    Heading(event.text("name", "Wedstrijdleiding"), "WEDSTRIJDLEIDING", "${when (body.text("ownership")) { "club" -> "Vereniging"; "platform" -> "DartFlow"; "personal" -> "Persoonlijk"; else -> if (event.text("clubId").isNotBlank()) "Vereniging" else "DartFlow" }} · revisie ${event.optInt("revision")}")
    if (!event.optBoolean("canManage")) { if (!state.loading) Notice("Je hebt geen actueel beheerrecht voor dit evenement.", true); return }
    fun send(type: String, extra: JSONObject = JSONObject()) = entityCommand(actions, event, JSONObject(extra.toString()).put("type", type).put("id", id))
    Action("Rankinggevolgen en erkenning", primary = false) { actions.navigate(PlayerScreen.RANKING_EVENT, id) }
    Action("Bekijk toernooipagina", primary = false) { actions.navigate(PlayerScreen.EVENT, id) }
    Action("Hulp bij wedstrijdleiding", primary = false) { actions.navigate(PlayerScreen.HELP, "q=loting") }
    val code = event.text("inviteCode")
    if (code.isNotBlank()) PlayerCard("Uitnodigen") {
        Text("Uitnodigingscode: $code", color = PlayerLime)
        Action("Deel uitnodiging", primary = false) { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "${event.text("name")} · ${BuildConfig.API_ORIGIN}/w/$code"), "Deel toernooi")) }
    }
    Choice("Beheer", tab, listOf("entries" to "Inschrijvingen en check-in", "fixtures" to "Loting en wachtrij", "boards" to "Banen", "standings" to "Stand en eindplaats", "settings" to "Instellingen"), { tab = it })
    val enabled = !state.busy && state.online
    val entries = event.rows("members").filter { it.obj("attributes").optBoolean("registered") }
    val fixtures = body.rows("fixtures")
    when (tab) {
        "entries" -> {
            PlayerOrganizerParticipants(event, state, actions)
            Text("${entries.count { it.obj("attributes").optBoolean("checkedIn") }} van ${entries.count { it.text("status") == "active" }} ingecheckt", color = PlayerLime)
            if (entries.isEmpty()) Text("Nog geen aanmeldingen. Deel de uitnodiging om spelers toe te voegen.", color = PlayerMuted)
            entries.forEach { entry -> PlayerCard(entry.text("name")) {
                Text(statusLabel(entry.text("status")) + if (entry.obj("attributes").optBoolean("checkedIn")) " · Ingecheckt" else "", color = PlayerMuted)
                when (entry.text("status")) {
                    "pending" -> Action("Aanmelding goedkeuren", enabled) { send("competition.approve", json("userId" to entry.text("id"))) }
                    "waitlisted" -> Action("Plek toekennen", enabled) { send("competition.promote", json("userId" to entry.text("id"))) }
                    "active" -> {
                        if (!entry.obj("attributes").optBoolean("checkedIn")) Action("Speler inchecken", enabled) { send("competition.checkin", json("userId" to entry.text("id"))) }
                        PlayerToggle("Beschikbaar voor oproep", entry.obj("attributes").optBoolean("available"), enabled) { send("competition.available", json("userId" to entry.text("id"), "available" to it)) }
                    }
                }
            } }
        }
        "fixtures" -> {
            if (event.text("kind") == "tournament") PlayerTournamentDraw(event, state, actions)
            else if (fixtures.isEmpty()) Action("Maak competitieschema", enabled) { send("competition.plan") }
            PlayerTournamentPoolControl(event, state, actions)
            if (fixtures.isNotEmpty()) {
                Action("Beschikbare partijen oproepen", enabled && !body.optBoolean("paused")) { send("competition.autoplan") }
                if (body.text("format") == "swiss") Action("Volgende Zwitserse ronde", enabled && fixtures.all { it.text("status") in listOf("confirmed", "bye", "void") }) { send("competition.next-round") }
                fixtures.filter { it.text("purpose") != "consolation" }.forEach { fixture -> PlayerFixtureCard(fixture, event, state, actions) }
                if (body.obj("consolation").optBoolean("enabled")) { PlayerTournamentConsolation(event); fixtures.filter { it.text("purpose") == "consolation" }.forEach { fixture -> PlayerFixtureCard(fixture, event, state, actions) } }
            }
        }
        "standings" -> { PlayerTournamentPoolControl(event, state, actions); PlayerTournamentStandings(event) }
        "boards" -> {
            val boards = state.resource.rows("boards").ifEmpty { state.overview.rows("boards").filter { it.text("eventId") == body.text("eventId") } }
            if (boards.isEmpty() && !state.loading) Text("Geen toegankelijke banen ontvangen. Vernieuw de wedstrijdleiding.", color = PlayerMuted)
            boards.forEach { board -> PlayerCard(board.text("name")) {
                val matchId = board.text("matchId")
                Text(if (matchId.isNotBlank()) "In gebruik" else if (board.optBoolean("blocked")) "Geblokkeerd" else "Vrij", color = PlayerLime)
                if (matchId.isNotBlank()) Action("Open actieve partij", primary = false) { actions.navigate(PlayerScreen.MATCH, matchId) }
                else Action(if (board.optBoolean("blocked")) "Baan vrijgeven" else "Baan blokkeren", enabled, false) { send("board.block", json("boardId" to board.text("id"), "blocked" to !board.optBoolean("blocked"))) }
            } }
        }
        "settings" -> {
            if (event.text("kind") == "tournament") PlayerTournamentRules(event, state, actions)
            PlayerOrganizerSharing(event, state, actions)
            PlayerCard("Regie-instellingen") {
            PlayerToggle("Nieuwe oproepen pauzeren", body.optBoolean("paused"), enabled) { send("competition.settings", json("paused" to it)) }
            PlayerToggle("Automatisch plannen", body.optBoolean("autoSchedule"), enabled) { send("competition.settings", json("autoSchedule" to it)) }
            PlayerToggle("Aparte schrijver vereist", body.optBoolean("requireWriter", true), enabled) { send("competition.settings", json("requireWriter" to it)) }
            if (fixtures.isEmpty()) PlayerToggle("Inschrijving geopend", body.optBoolean("registrationOpen", true), enabled) { send("competition.settings", json("registrationOpen" to it)) }
            Choice("Minimale rust", body.optInt("restSeconds", 90).toString(), listOf("0" to "Geen", "60" to "1 minuut", "90" to "90 seconden", "180" to "3 minuten", "300" to "5 minuten"), { send("competition.settings", json("restSeconds" to it.toInt())) }, enabled)
            Text("Oproepen, schrijfrechten en alle wijzigingen worden door de server gecontroleerd.", color = PlayerMuted)
            }
        }
    }
}

@Composable private fun PlayerFixtureCard(fixture: JSONObject, event: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val players = fixture.optJSONArray("players")?.strings().orEmpty().filter { it.isNotBlank() && it != "null" }
    val names = players.map { id -> event.rows("members").find { it.text("id") == id }?.text("name") ?: "Speler" }
    val enabled = !state.busy && state.online
    var boardId by rememberSaveable { mutableStateOf("") }
    var writerId by rememberSaveable { mutableStateOf("") }
    var nextBoardId by rememberSaveable { mutableStateOf("") }
    var showPreCall by rememberSaveable { mutableStateOf(true) }
    var winner by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var confirmWalkover by rememberSaveable { mutableStateOf(false) }
    val matchId = fixture.text("matchId")
    fun send(type: String, extra: JSONObject = JSONObject()) = entityCommand(actions, event, JSONObject(extra.toString()).put("type", type).put("id", event.text("id")).put("fixtureId", fixture.text("id")))
    PlayerCard("Ronde ${fixture.optInt("round")} · ${fixture.text("pool", playerTournamentPhaseLabel(fixture.text("phase")))}") {
        fixture.optJSONObject("settings")?.let { Text("Partijreglement: ${playerRuleLabel(it)} · best of ${it.optInt("bestOfLegs", 3)} legs · ${it.optInt("bestOfSets", 1)} set(s)", color = PlayerMuted) }
        Text(names.joinToString(" – ").ifBlank { "Wacht op vorige ronde" }, style = MaterialTheme.typography.titleMedium)
        fixture.text("pairingNotice").takeIf { it.isNotBlank() }?.let { Text(it, color = PlayerMuted) }
        if (fixture.text("purpose") == "bronze") Text("Bronswedstrijd · plaats drie en vier", color = PlayerLime)
        if (fixture.text("purpose") == "consolation") Text(event.obj("state").obj("consolation").text("title", "Troostbeker"), color = PlayerLime)
        if (fixture.text("purpose") == "pool-decider") Text("Echte poulebeslisser · ${playerRuleLabel(fixture.obj("settings"))} · best of ${fixture.obj("settings").optInt("bestOfLegs", 5)}", color = PlayerLime)
        if (fixture.optBoolean("requiresRelease") && !fixture.optBoolean("released")) Notice("Deze ronde wacht op expliciete vrijgave door de wedstrijdleiding.")
        Text(statusLabel(fixture.text("status")) + (fixture.optJSONArray("score")?.strings()?.joinToString("–")?.let { " · $it" } ?: ""), color = PlayerMuted)
        if (matchId.isNotBlank()) Action("Open partij en uitslag", primary = false) { actions.navigate(PlayerScreen.MATCH, matchId) }
        else if (players.size == 2 && fixture.text("status") !in listOf("confirmed", "bye", "void") && (!fixture.optBoolean("requiresRelease") || fixture.optBoolean("released"))) {
            if (event.text("kind") == "league" && !event.obj("state").optBoolean("seasonManaged")) Action("Open geplande competitiepartij", enabled && !event.obj("state").optBoolean("paused") && !event.obj("state").optBoolean("closed")) { send("fixture.start") }
            val boards = state.resource.rows("boards").ifEmpty { state.overview.rows("boards").filter { it.text("eventId") == event.obj("state").text("eventId") } }.filter { !it.optBoolean("blocked") && it.text("matchId").isBlank() }
            Choice("Baan", boardId, listOf("" to "Kies een beschikbare baan") + boards.map { it.text("id") to it.text("name") }, { boardId = it }, enabled)
            val writers = event.rows("members").filter { it.text("status") == "active" && it.obj("attributes").optBoolean("checkedIn") && it.text("id") !in players }
            Choice("Schrijver", writerId, listOf("" to "Automatisch kiezen") + writers.map { it.text("id") to it.text("name") }, { writerId = it }, enabled)
            Action("Oproepen op deze baan", enabled && boardId.isNotBlank()) { send("fixture.assign", json("boardId" to boardId).also { if (writerId.isNotBlank()) it.put("writerId", writerId) }) }
            val allBoards = state.resource.rows("boards").ifEmpty { state.overview.rows("boards").filter { it.text("eventId") == event.obj("state").text("eventId") } }.filter { !it.optBoolean("blocked") && !it.optBoolean("closed") }
            Text("Vooroproep voor de volgende partij", style = MaterialTheme.typography.titleMedium)
            Text("Spelers kunnen zich voorbereiden terwijl de huidige partij doorgaat. Wacht op de definitieve oproep voordat je begint.", color = PlayerMuted)
            Choice("Verwachte baan", nextBoardId, listOf("" to "Kies baan voor de volgende partij") + allBoards.map { it.text("id") to it.text("name") + if (it.text("matchId").isNotBlank()) " · bezig" else "" }, { nextBoardId = it }, enabled)
            PlayerToggle("Toon vooroproep op baanscherm", showPreCall, enabled) { showPreCall = it }
            Action("Vooroproep klaarzetten", enabled && nextBoardId.isNotBlank(), false) { send("fixture.precall", json("boardId" to nextBoardId, "showOnDisplay" to showPreCall).also { if (writerId.isNotBlank()) it.put("writerId", writerId) }) }
            val precalls = event.obj("state").obj("preCalls")
            precalls.keys().asSequence().toList().filter { precalls.obj(it).text("fixtureId") == fixture.text("id") }.forEach { nextId ->
                Text("Verwacht bij ${allBoards.find { it.text("id") == nextId }?.text("name") ?: "toegewezen baan"} · wacht op definitieve oproep", color = PlayerLime)
                Action("Annuleer vooroproep", enabled, false) { send("fixture.precall", json("boardId" to nextId, "enabled" to false)) }
            }
            Choice("Administratieve winnaar", winner, listOf("" to "Geen besluit") + players.zip(names), { winner = it }, enabled)
            if (winner.isNotBlank()) {
                Field("Reden voor walkover", reason, { reason = it }, enabled, max = 1000, multiline = true)
                Action("Controleer walkover", enabled && reason.isNotBlank(), false) { confirmWalkover = true }
            }
        }
    }
    if (confirmWalkover) AlertDialog(onDismissRequest = { confirmWalkover = false }, title = { Text("Walkover vastleggen?") }, text = { Text("${event.rows("members").find { it.text("id") == winner }?.text("name")} wint administratief. Reden: $reason. Er worden geen worpen of technische statistieken verzonnen.") }, confirmButton = { TextButton(onClick = { confirmWalkover = false; send("fixture.walkover", json("winnerId" to winner, "reason" to reason)) }, enabled = enabled) { Text("Leg besluit vast") } }, dismissButton = { TextButton(onClick = { confirmWalkover = false }) { Text("Annuleren") } })
}

internal fun playerTournamentFormatLabel(format: String): String = when (format) { "pools-knockout" -> "Poules en knock-out"; "knockout" -> "Enkele eliminatie"; "double-elimination-reset" -> "Dubbele eliminatie met resetfinale"; "double-elimination-single" -> "Dubbele eliminatie met enkele finale"; "swiss" -> "Zwitsers"; else -> "Toernooi" }
internal fun playerTournamentPhaseLabel(phase: String): String = when (phase) { "knockout" -> "Knock-out"; "pool" -> "Poule"; "winners" -> "Winnaarsschema"; "losers" -> "Verliezersschema"; "final" -> "Grand final"; "reset" -> "Resetfinale"; "swiss" -> "Zwitsers"; else -> "Programma" }

internal fun playerTournamentStandingSummary(row: JSONObject): String = if (row.isNull("points")) {
    if (row.optInt("position") > 0) "Eindplaats ${row.optInt("position")}${if (row.optBoolean("shared")) " · gedeeld" else ""}" else "Eindplaats nog niet definitief"
} else "${row.optInt("points")} punten · ${row.optInt("played")} gespeeld · legs ${row.optInt("legsFor")}–${row.optInt("legsAgainst")}" + if (row.has("buchholz")) " · Buchholz ${row.text("buchholz")} · ${row.optInt("byes")} vrijstellingen" else ""

@Composable internal fun PlayerTournamentStandings(event: JSONObject) {
    val body = event.obj("state")
    val standings = body.rows("standings")
    PlayerTournamentConsolation(event)
    if (standings.isEmpty()) return
    PlayerCard(if (body.optBoolean("completed")) "Eindstand" else "Stand") {
        standings.forEach { row ->
            Text(row.text("name", event.rows("members").find { it.text("id") == row.text("playerId", row.text("id")) }?.text("name") ?: "Speler"), style = MaterialTheme.typography.titleMedium)
            Text(playerTournamentStandingSummary(row), color = PlayerLime)
        }
    }
}
