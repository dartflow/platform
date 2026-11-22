package nl.dartflow.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import android.os.SystemClock
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

data class ScorePlayer(val id: String, val name: String, val remaining: Int)

/** The server retains authority over whose turn it is and over command deduplication. */
@Composable fun PlayerScoreConsole(
    title: String, players: List<ScorePlayer>, active: Int, canScore: Boolean, busy: Boolean,
    offline: Boolean, checkout: String?, message: String?, scoreKey: String,
    onSubmit: (Int, Int, Boolean, Int?) -> Unit, onBack: () -> Unit, onRetry: () -> Unit,
    activity: JSONObject = JSONObject(), onExtend: () -> Unit = {}, pending: Boolean = false,
    options: @Composable () -> Unit = {}, media: (@Composable () -> Unit)? = null,
    queueSupported: Boolean = false, queuedVisits: Int = 0,
    dartEntry: (@Composable () -> Unit)? = null, currentThrowerName: String? = null, scoreLabel: String = "restscore",
    unknownDartsByDefault: Boolean = false, finishRule: String = "double",
    onSubmitVisit: ((Int, Int?, Boolean, Int?) -> Unit)? = null,
    optionsLabel: String = "Darts & correctie",
    onToggleDartEntry: (() -> Unit)? = null,
) {
    val matchIdentity = scoreKey.substringBefore(':')
    var score by rememberSaveable(matchIdentity) { mutableStateOf("") }
    var darts by rememberSaveable(matchIdentity) { mutableIntStateOf(3) }
    var dartsMeasured by rememberSaveable(matchIdentity) { mutableStateOf(!unknownDartsByDefault) }
    var attempts by rememberSaveable(matchIdentity) { mutableStateOf<Int?>(null) }
    var settings by remember { mutableStateOf(false) }; var finishDialog by remember { mutableStateOf(false) }; var video by remember { mutableStateOf(false) }
    var previousRevision by rememberSaveable(matchIdentity) { mutableStateOf(scoreKey) }
    LaunchedEffect(scoreKey) {
        // Accepted server revision is the acknowledgement; never clear on a failed request.
        if (scoreKey != previousRevision) { score = ""; attempts = null; dartsMeasured = !unknownDartsByDefault; finishDialog = false; previousRevision = scoreKey }
    }
    val remaining = players.getOrNull(active)?.remaining ?: 0
    val finish = score.toIntOrNull()?.let { it == remaining && remaining in when (finishRule) { "straight" -> 1..180; "master" -> 2..180; else -> 2..170 } } == true
    val invalid = score.toIntOrNull()?.let { it > 180 } == true
    val locked = !canScore || busy || (!queueSupported && (offline || pending))
    fun submit(value: Int, count: Int, finished: Boolean, doubleAttempts: Int?) {
        if (onSubmitVisit != null) onSubmitVisit(value, count.takeIf { dartsMeasured || finished }, finished, doubleAttempts)
        else onSubmit(value, count, finished, doubleAttempts)
    }
    val received = remember(activity.text("sessionId"), activity.optLong("serverNow")) { SystemClock.elapsedRealtime() }
    var monotonic by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(activity.text("sessionId")) { if (activity.length() > 0) while (true) { monotonic = SystemClock.elapsedRealtime(); delay(250) } }
    val serverNow = activity.optLong("serverNow") + monotonic - received
    val warning = activity.length() > 0 && activity.text("phase") in listOf("active", "warning") && serverNow >= activity.optLong("warningAt", Long.MAX_VALUE)
    val warningSeconds = ((activity.optLong("deadlineAt") - serverNow + 999) / 1000).coerceAtLeast(0)
    val extensions = maxOf(0, 2 - activity.optInt("extensionsUsed"))
    BoxWithConstraints(Modifier.fillMaxSize().background(PlayerInk).windowInsetsPadding(WindowInsets.safeDrawing).testTag("native-score-console")) {
        val compact = maxHeight < 660.dp
        Column(Modifier.fillMaxSize().padding(horizontal = if (compact) 12.dp else 18.dp, vertical = if (compact) 4.dp else 10.dp), verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 10.dp)) {
            Row(Modifier.fillMaxWidth().height(if (compact) 36.dp else 42.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onBack, contentPadding = PaddingValues(horizontal = 0.dp), modifier = Modifier.widthIn(min = 58.dp)) { Text("‹ Terug", fontSize = 13.sp) }
                if (warning) {
                    Text("Baan vrij over ${warningSeconds / 60}:${(warningSeconds % 60).toString().padStart(2, '0')}", Modifier.weight(1f), color = PlayerLime, fontSize = 11.sp, textAlign = TextAlign.Center)
                    TextButton(onClick = onExtend, enabled = !offline && !busy && extensions > 0 && warningSeconds > 0 && activity.optBoolean("canExtend"), contentPadding = PaddingValues(4.dp), modifier = Modifier.testTag("continue-board")) { Text("Doorspelen ($extensions)", fontSize = 11.sp) }
                } else {
                    Text(title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, color = PlayerMuted, fontSize = 11.sp, textAlign = TextAlign.Center)
                    Text(if (offline) "Offline" else "● Live", color = if (offline) PlayerError else PlayerLime, fontSize = 11.sp)
                }
            }
            // Grow with the actual text metrics, including the system font scale.
            // A fixed card height clipped the turn label below large rest scores.
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).heightIn(min = if (compact) 87.dp else 112.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                players.forEachIndexed { index, player ->
                    Column(Modifier.weight(1f).fillMaxHeight().testTag("score-player-card-$index").border(if (index == active) 2.dp else 1.dp, if (index == active) PlayerLime else PlayerBorder, RoundedCornerShape(12.dp)).background(if (index == active) PlayerLime.copy(alpha = .08f) else PlayerPanel, RoundedCornerShape(12.dp)).padding(horizontal = 10.dp, vertical = if (compact) 4.dp else 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Text(player.name, modifier = Modifier.fillMaxWidth().testTag("score-player-name-$index"), textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = if (compact) 12.sp else 14.sp, lineHeight = if (compact) 16.sp else 18.sp, fontWeight = FontWeight.Bold)
                        Text("${player.remaining}", fontFamily = PlayerBarlow, fontSize = if (compact) 43.sp else 56.sp, lineHeight = if (compact) 44.sp else 58.sp, maxLines = 1, textAlign = TextAlign.Center, color = if (index == active) PlayerLime else PlayerText, modifier = Modifier.fillMaxWidth().testTag("score-player-remaining-$index").semantics { contentDescription = "${player.name}, $scoreLabel ${player.remaining}${if (index == active) ", aan de beurt" else ""}" })
                        Text(if (index == active) if (players.size > 2) "BEURT" else currentThrowerName?.let { "WERPT: $it" } ?: "AAN DE BEURT" else "WACHT", modifier = Modifier.fillMaxWidth().testTag("score-player-status-$index"), textAlign = TextAlign.Center, color = if (index == active) PlayerLime else PlayerMuted, fontSize = 8.sp, lineHeight = 11.sp, letterSpacing = 1.sp, maxLines = 1, softWrap = false)
                    }
                }
            }
            if (dartEntry != null) {
                Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (queuedVisits > 0) Text("Wacht op verbinding · $queuedVisits beurt(en) · lokaal voorlopig", color = PlayerLime, fontSize = 12.sp)
                    else if (offline) Text(if (queueSupported) "Offline · invoer wordt versleuteld bewaard." else "Geen verbinding · herstel voor je verzendt.", color = PlayerError, fontSize = 12.sp)
                    message?.let { Text(it, color = PlayerError, fontSize = 12.sp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                    dartEntry()
                }
            } else {
            Row(Modifier.fillMaxWidth().height(if (compact) 50.dp else 66.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) { Text("WORP VAN", color = PlayerMuted, fontSize = 9.sp, letterSpacing = 1.sp); Text(currentThrowerName ?: players.getOrNull(active)?.name ?: "Speler", maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp) }
                Text(score.ifEmpty { "0" }, fontFamily = PlayerBarlow, fontSize = if (compact) 44.sp else 58.sp, color = if (invalid) PlayerError else PlayerLime, modifier = Modifier.testTag("entered-score").semantics { contentDescription = "Ingevoerde score ${score.ifEmpty { "0" }}" })
            }
            Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 8.dp)) {
                listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("C", "0", "⌫")).forEach { row ->
                    Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(if (compact) 5.dp else 8.dp)) {
                        row.forEach { key ->
                            FilledTonalButton(onClick = { score = when (key) { "C" -> ""; "⌫" -> score.dropLast(1); else -> (score + key).take(3) }; attempts = null }, enabled = !locked, modifier = Modifier.weight(1f).fillMaxHeight().testTag("score-key-$key").semantics { contentDescription = when(key) { "C" -> "Gehele score wissen"; "⌫" -> "Laatste cijfer wissen"; else -> "Cijfer $key" } }, shape = RoundedCornerShape(10.dp), contentPadding = PaddingValues(0.dp), colors = ButtonDefaults.filledTonalButtonColors(containerColor = PlayerPanel, contentColor = PlayerText)) {
                                Text(key, fontFamily = PlayerBarlow, fontSize = if (compact) 28.sp else 34.sp)
                            }
                        }
                    }
                }
            }
            val feedback = when { queuedVisits > 0 -> "Wacht op verbinding · $queuedVisits beurt(en) lokaal bewaard · voorlopig"; offline -> if (queueSupported) "Offline · nieuwe beurten worden versleuteld bewaard." else "Geen verbinding · herstel voor je verzendt."; message != null -> message; pending -> "Je vorige worp wacht op bevestiging. Controleer dezelfde actie."; invalid -> "Voer een worp van 0 tot en met 180 in."; !canScore -> "Wacht op de beurt van je tegenstander."; busy -> "Worp wordt bevestigd…"; checkout != null -> "Finish: $checkout"; warning -> if (warningSeconds == 0L) "Baansessie verlopen · actuele status ophalen…" else "Scoor of tik op Doorspelen. $extensions verlengingen over."; else -> "Voer jouw worptotaal in." }
            Text(feedback, Modifier.fillMaxWidth().heightIn(min = if (compact) 26.dp else 34.dp).semantics { liveRegion = LiveRegionMode.Polite }, fontSize = if (compact) 11.sp else 13.sp, color = if (offline || message != null || invalid) PlayerError else PlayerMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Button(onClick = { if (finish) finishDialog = true else score.toIntOrNull()?.let { submit(it, darts, false, attempts) } }, enabled = !locked && score.isNotEmpty() && !invalid, modifier = Modifier.fillMaxWidth().height(if (compact) 48.dp else 56.dp).testTag("confirm-score"), shape = RoundedCornerShape(12.dp)) { Text(if (busy) "Verzenden…" else if (finish) "Finish bevestigen" else "Bevestigen", fontWeight = FontWeight.Bold) }
            }
            Row(Modifier.fillMaxWidth().height(if (compact) 36.dp else 42.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                if (onToggleDartEntry != null) TextButton(onClick = onToggleDartEntry, contentPadding = PaddingValues(4.dp), modifier = Modifier.testTag("toggle-dart-entry")) { Text(if (dartEntry == null) "Pijl voor pijl" else "Worptotaal", fontSize = 11.sp) }
                else if (media != null) TextButton(onClick = { video = true }, contentPadding = PaddingValues(4.dp)) { Text("Video", fontSize = 11.sp) } else Text(if (dartEntry != null) "Pijl voor pijl" else if (dartsMeasured) "$darts darts" else "Pijlaantal onbekend", color = PlayerMuted, fontSize = 11.sp)
                if (message != null || pending) TextButton(onClick = onRetry, contentPadding = PaddingValues(4.dp)) { Text("Opnieuw", fontSize = 11.sp) }
                TextButton(onClick = { settings = true }, contentPadding = PaddingValues(4.dp)) { Text(optionsLabel, fontSize = 11.sp) }
            }
        }
    }
    if (finishDialog) AlertDialog(onDismissRequest = { finishDialog = false }, title = { Text("Finish in hoeveel darts?") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(when (finishRule) { "straight" -> "Bevestig hoeveel darts je werkelijk voor deze finish hebt gebruikt."; "master" -> "Bevestig dat de laatste dart een geldige dubbel, triple of bull was."; else -> "Bevestig dat de laatste dart een geldige uitgooidubbel of bull was." }, color = PlayerMuted)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { (1..3).forEach { count -> Action("$count ${if (count == 1) "dart" else "darts"}", !locked, modifier = Modifier.weight(1f)) { score.toIntOrNull()?.let { submit(it, count, true, attempts?.takeIf { a -> a in 1..count }) }; finishDialog = false } } }
        }
    }, confirmButton = {}, dismissButton = { TextButton(onClick = { finishDialog = false }) { Text("Nog geen finish") } })
    if (settings) AlertDialog(onDismissRequest = { settings = false }, title = { Text(optionsLabel) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (dartEntry == null) {
            Choice("Gegooide darts", if (dartsMeasured) "$darts" else "", (if (unknownDartsByDefault) listOf("" to "Niet bijgehouden") else emptyList()) + listOf("1" to "1", "2" to "2", "3" to "3"), { value -> dartsMeasured = value.isNotBlank(); darts = value.toIntOrNull() ?: 3; if ((attempts ?: 0) > darts) attempts = null }, !locked)
            Choice("Darts op uitgooidubbel", attempts?.toString() ?: "", listOf("" to "Niet bijgehouden") + (0..darts).map { "$it" to "$it" }, { attempts = it.toIntOrNull() }, !locked)
            Text("Onbekende dubbelpogingen blijven onbekend. De succesvolle dubbel telt mee bij een finish.", color = PlayerMuted, fontSize = 12.sp)
            }
            options()
        }
    }, confirmButton = { TextButton(onClick = { settings = false }) { Text("Gereed") } })
    if (video && media != null) AlertDialog(onDismissRequest = { video = false }, title = { Text("Camera en geluid") }, text = { Box(Modifier.fillMaxWidth().heightIn(min = 200.dp, max = 450.dp)) { media() } }, confirmButton = { TextButton(onClick = { video = false }) { Text("Terug naar scoren") } })
}
