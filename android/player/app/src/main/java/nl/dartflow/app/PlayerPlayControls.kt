package nl.dartflow.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import org.json.JSONArray
import org.json.JSONObject

@Composable internal fun PlayerPlayDartEntry(session: PlayerPlaySession, enabled: Boolean, submit: (JSONObject) -> Unit) {
    var entered by rememberSaveable(session.id, session.revision) { mutableStateOf(listOf<String>()) }
    var intended by rememberSaveable(session.id, session.revision) { mutableStateOf(listOf<String>()) }
    var multiplier by rememberSaveable { mutableStateOf("S") }
    var target by rememberSaveable { mutableStateOf("") }
    val input = json("dartHits" to JSONArray(entered), "intendedTargets" to JSONArray(intended.map { it.ifBlank { null } }))
    val preview = remember(session.id, session.revision, entered) { if (entered.isEmpty()) null else runCatching { PlayerPlayEngine.project(session, input) } }
    val last = preview?.getOrNull()?.game?.rows("visits")?.lastOrNull()
    val stopped = last?.optBoolean("bust") == true || last?.optBoolean("finish") == true || preview?.getOrNull()?.game?.text("status") == "replay-required"
    val dartsLeft = if (session.rules.text("mode") == "finish") session.progress.optInt("dartsLeft", 3) else if (session.rules.text("mode") == "leg-challenge" && session.rules.text("comparison") == "darts") (session.progress.optInt("sourceDarts") - session.progress.optInt("ownDarts")).coerceIn(1,3) else 3
    fun add(hit: String) { if (entered.size < dartsLeft && !stopped) { entered = entered + hit; intended = intended + target } }
    PlayerCard("Registreer de geworpen pijlen") {
        Text("${session.currentName()} · ${entered.size} / $dartsLeft pijlen", color = PlayerLime)
        Text(entered.mapIndexed { i, hit -> "${i + 1}: ${if (hit == "MISS") "mis" else hit}${intended.getOrNull(i)?.takeIf(String::isNotBlank)?.let { " (doel $it)" }.orEmpty()}" }.joinToString(" · ").ifBlank { "Nog geen pijl ingevoerd" }, color = PlayerText)
        Choice("Beoogd doel voor de volgende pijl (optioneel)", target, listOf("" to "Onbekend / niet geregistreerd") + (1..20).map { "D$it" to "D$it" } + listOf("DB" to "Bullseye"), { target = it }, enabled && !stopped)
        Choice("Segment", multiplier, listOf("S" to "Single", "D" to "Dubbel", "T" to "Triple"), { multiplier = it }, enabled && !stopped)
        (1..20).chunked(5).forEach { row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) { row.forEach { n -> Action("$multiplier$n", enabled && entered.size < dartsLeft && !stopped, false, Modifier.weight(1f)) { add("$multiplier$n") } } } }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("MISS" to "Mis", "SB" to "25", "DB" to "Bull 50").forEach { (hit, label) -> Action(label, enabled && entered.size < dartsLeft && !stopped, false, Modifier.weight(1f)) { add(hit) } } }
        if (last?.optBoolean("bust") == true) Notice("BUST · de beurt eindigt; de reststand wordt hersteld.")
        if (last?.optBoolean("finish") == true) Notice("Geldige finish · bevestig de werkelijk gebruikte pijlen.")
        preview?.exceptionOrNull()?.message?.let { Notice(it, true) }
        if (session.rules.text("mode") == "finish" && session.rules.optBoolean("routeHelp")) {
            val left = if (entered.isEmpty()) session.progress.optInt("remaining") else last?.optInt("remainingAfter") ?: session.progress.optInt("remaining")
            val routes = playerPlayFinishRoutes(left, dartsLeft - entered.size, session.rules.text("outRule"))
            Text(if (stopped) "Deze poging is beëindigd." else if (routes.isEmpty()) "Geen uitroute met de resterende pijlen." else "Mogelijke routes: ${routes.joinToString(" · ") { it.joinToString(" → ") }}", color = PlayerLime)
        }
        Action("Verwerk ${entered.size} pijl(en)", enabled && entered.isNotEmpty() && preview?.isSuccess == true, modifier = Modifier.fillMaxWidth()) { submit(input); entered = emptyList(); intended = emptyList() }
        Action("Laatste pijl aanpassen", enabled && entered.isNotEmpty(), false) { entered = entered.dropLast(1); intended = intended.dropLast(1) }
        Text("Voer alleen werkelijk geworpen pijlen in. Een beurt stopt direct na bust, finish of de beslissende treffer. Onbekende dubbelpogingen blijven onbekend.", color = PlayerMuted)
    }
}

internal fun playerPlayFinishRoutes(remaining: Int, dartsLeft: Int, out: String, limit: Int = 3): List<List<String>> {
    if (remaining !in 1..180 || dartsLeft !in 1..3) return emptyList()
    val hits = (20 downTo 1).flatMap { listOf("T$it", "D$it", "S$it") } + listOf("DB", "SB")
    val found = mutableListOf<List<String>>()
    fun walk(left: Int, darts: Int, prefix: List<String>) {
        if (found.size >= limit) return
        for (hit in hits) {
            val rest = left - PlayerPlayEngine.dartValue(hit); val end = out == "straight" || hit == "DB" || hit.startsWith('D') || out == "master" && hit.startsWith('T')
            if (rest == 0 && end) { val route = prefix + hit; if (route !in found) found.add(route) }
            else if (rest > 0 && (out == "straight" || rest > 1) && darts > 1 && rest <= 60 * (darts - 1)) walk(rest, darts - 1, prefix + hit)
            if (found.size >= limit) return
        }
    }
    for (n in 1..dartsLeft) { walk(remaining, n, emptyList()); if (found.size >= limit) break }
    return found.take(limit)
}

@Composable internal fun PlayerPlayConflict(session: PlayerPlaySession, pending: Int, busy: Boolean, actions: PlayerActions) {
    val conflict = session.raw.obj("conflict"); var reason by rememberSaveable(conflict.text("id")) { mutableStateOf("") }
    PlayerCard("Controle nodig · invoer gepauzeerd") {
        Text("Serverrevisie ${conflict.optInt("canonicalRevision")} · schrijverversie ${session.raw.obj("writer").optInt("epoch")} · $pending bewaarde lokale beurt(en)", color = PlayerMuted)
        val canonical = conflict.obj("canonical"); val last = canonical.obj("lastVisit")
        Text("Server: ${last.text("throwerId").takeIf(String::isNotBlank)?.let(session::participantName).orEmpty()} · beurt ${last.optInt("number")} · ${last.optInt("score")} punten", color = PlayerLime)
        conflict.rows("commands").forEach { command -> Text("Lokaal: ${session.participantName(command.text("participantId"))} · ${command.obj("input").optJSONArray("dartHits")?.strings()?.joinToString(" ").orEmpty()} · basis ${command.optInt("expectedRevision")} · schrijver ${command.optInt("writerEpoch")}", color = PlayerText) }
        Text("De partij blijft gepauzeerd tot een bevoegde beoordelaar bewust kiest. De server controleert of lokale invoer nog geldig kan worden toegepast.", color = PlayerMuted)
        if (session.permissions.optBoolean("canResolve")) {
            Field("Reden voor de beslissing", reason, { reason = it }, !busy, max = 1000, multiline = true)
            listOf("keep-server" to "Behoud serverstand; verwerp lokale invoer", "use-offline" to "Beoordeel en gebruik lokale invoer").forEach { (decision, label) -> Action(label, !busy && reason.trim().length >= 3, false) { actions.playAction(json("type" to "session.resolve-conflict", "conflictId" to conflict.text("id"), "decision" to decision, "reason" to reason)) } }
        }
    }
}

@Composable internal fun PlayerPlayManagement(session: PlayerPlaySession, pending: Int, state: PlayerUiState, actions: PlayerActions) {
    var expanded by rememberSaveable(session.id) { mutableStateOf(false) }; var reason by rememberSaveable(session.id) { mutableStateOf("") }; var board by rememberSaveable(session.id) { mutableStateOf("") }; var target by rememberSaveable(session.id) { mutableStateOf("") }; var username by rememberSaveable(session.id) { mutableStateOf("") }; var pin by remember { mutableStateOf("") }; var confirm by remember { mutableStateOf<JSONObject?>(null) }
    Action("Schrijver, baan & onderbreken", primary = false) { expanded = !expanded }
    if (!expanded) return
    PlayerCard("Partijbeheer") {
        Text("Schrijver: ${session.participantName(session.raw.obj("writer").text("participantId"))} · laatst geaccepteerde beurt ${session.raw.obj("writer").optInt("lastAcceptedVisit")} · $pending wachtend", color = PlayerMuted)
        Field("Reden", reason, { reason = it }, !state.play.syncing, max = 1000)
        Choice("Deelnemer", target, listOf("" to "Kies deelnemer") + session.participants.map { it.text("id") to it.text("name") }, { target = it }, !state.play.syncing)
        if (session.permissions.optBoolean("canTransfer")) Action("Draag schrijfrecht bewust over", target.isNotBlank() && reason.trim().length >= 3 && !state.play.syncing, false) { confirm = json("type" to "session.transfer", "participantId" to target, "reason" to reason) }
        if (session.permissions.optBoolean("canMove")) {
            PlayerPlayBoardChoice("Nieuwe baan",board,state,actions,{board=it})
            Action("Verplaats dezelfde partij", board.isNotBlank() && pending == 0 && !state.play.syncing, false) {
                confirm = json("type" to "session.move", "boardId" to board, "reason" to reason)
            }
        }
        if (session.permissions.optBoolean("canManage") && !session.complete) {
            Action("Onderbreek en geef baan vrij", pending == 0 && !state.play.syncing, false) { confirm = json("type" to "session.interrupt", "reason" to reason) }
            Field("Accountnaam van deze deelnemer", username, { username = it }, !state.play.syncing, max = 81)
            Field("Eigen pincode van deze deelnemer", pin, { pin = it }, !state.play.syncing, secret = true, max = 6, keyboard = KeyboardType.NumberPassword)
            Action("Koppel deelnemer met eigen pincode", target.isNotBlank() && validPlayerUsername(username) && validPlayerPin(pin) && !state.play.syncing, false) { actions.playAction(json("type" to "session.pin", "participantId" to target, "username" to PlayerValidation.normalizeUsername(username), "pin" to pin)); pin = "" }
            Text("De pincode wisselt de aangemelde accountsessie van dit toestel niet.", color = PlayerMuted)
        }
    }
    confirm?.let { command -> androidx.compose.material3.AlertDialog(onDismissRequest = { confirm = null }, title = { Text("Bevestig partijwijziging") }, text = { Text("Dezelfde partij blijft behouden. $pending invoer(en) wachten nog. Laatste geaccepteerde beurt: ${session.raw.obj("writer").optInt("lastAcceptedVisit")}. ${if (command.text("type") == "session.transfer") "De nieuwe schrijver krijgt de volgende toegestane invoer; oude schrijfrechten vervallen." else "De server controleert actuele baanrechten en bezetting."}") }, confirmButton = { androidx.compose.material3.TextButton(onClick = { actions.playAction(command); confirm = null }) { Text("Bevestigen") } }, dismissButton = { androidx.compose.material3.TextButton(onClick = { confirm = null }) { Text("Annuleren") } }) }
}

@Composable internal fun PlayerQrCode(value: String, description: String) {
    val matrix = remember(value) { runCatching { QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 256, 256) }.getOrNull() }
    if (matrix == null) { Text("De QR is te groot. Kopieer de persoonlijke link.", color = PlayerMuted); return }
    Canvas(Modifier.fillMaxWidth().height(256.dp)) {
        val unit = minOf(size.width, size.height) / matrix.width; val x = (size.width - unit * matrix.width) / 2
        drawRect(Color.White, Offset(x, 0f), Size(unit * matrix.width, unit * matrix.height))
        for (row in 0 until matrix.height) for (column in 0 until matrix.width) if (matrix[column, row]) drawRect(Color.Black, Offset(x + column * unit, row * unit), Size(unit + .1f, unit + .1f))
    }
    Text(description, color = PlayerMuted)
}

/** The server provides names and accessible candidates; selection never asks users for internal identifiers. */
@Composable internal fun PlayerPlayBoardChoice(label:String,selected:String,state:PlayerUiState,actions:PlayerActions,onChange:(String)->Unit,current:List<Pair<String,String>> = emptyList()){
    var boards by remember(state.profile?.id){mutableStateOf<List<JSONObject>>(emptyList())}
    var loading by remember(state.profile?.id){mutableStateOf(true)}
    var error by remember(state.profile?.id){mutableStateOf<String?>(null)}
    var refresh by remember{mutableIntStateOf(0)}
    LaunchedEffect(state.profile?.id,refresh){
        loading=true;error=null
        try{boards=actions.read("/play/boards").rows("boards")}
        catch(failure:Exception){if(failure is kotlinx.coroutines.CancellationException)throw failure;error="De beschikbare banen konden niet worden opgehaald."}
        finally{loading=false}
    }
    val candidates=boards.filter{it.optBoolean("available")||it.text("id") in current.map{entry->entry.first}}.map{it.text("id") to it.text("name","Baan")}
    val options=(candidates+current.filter{entry->candidates.none{it.first==entry.first}}).distinctBy{it.first}
    Choice(label,selected,listOf("" to if(loading)"Banen laden…" else "Kies een baan")+options,onChange,!loading&&!state.busy&&!state.play.syncing)
    if(!loading&&options.isEmpty()&&error==null)Text("Er is nu geen beschikbare, toegankelijke baan. De baancontrole gebeurt opnieuw bij bevestiging.",color=PlayerMuted)
    error?.let{Text(it,color=PlayerMuted)}
    Action("Ververs banen",!loading&&!state.busy,false){refresh++}
}
