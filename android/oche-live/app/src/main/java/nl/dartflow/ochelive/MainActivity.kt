package nl.dartflow.ochelive

import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.key.*
import kotlinx.coroutines.launch
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import java.util.Locale

private data class OchePalette(val id: String, val primary: Color, val ink: Color, val panel: Color, val muted: Color, val outline: Color)
private val DartFlowPalette = OchePalette("dartflow", Color(0xFFB5F52B), Color(0xFF101211), Color(0xFF172019), Color(0xFFB5BDB4), Color(0xFF3B4A39))
private val OnzeTrotsPalette = OchePalette("onzetrots", Color(0xFFA8CEFF), Color(0xFF06182F), Color(0xFF0C2856), Color(0xFFC3D5EE), Color(0xFF335789))
private val LocalOchePalette = staticCompositionLocalOf { DartFlowPalette }
private val Lime: Color @Composable get() = LocalOchePalette.current.primary
private val Ink: Color @Composable get() = LocalOchePalette.current.ink
private val Panel: Color @Composable get() = LocalOchePalette.current.panel
private val Muted: Color @Composable get() = LocalOchePalette.current.muted
private val Outline: Color @Composable get() = LocalOchePalette.current.outline
private val Barlow = FontFamily(Font(R.font.barlow_condensed_800, FontWeight.ExtraBold))
private val DmSans = FontFamily(Font(R.font.dm_sans_400), Font(R.font.dm_sans_700, FontWeight.Bold))

class MainActivity : ComponentActivity() {
    private val model: OcheViewModel by viewModels()
    private val isTv get() = (getSystemService(Context.UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Oche Live always uses a dark background, including when the device uses a light theme.
        val systemBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = systemBarStyle, navigationBarStyle = systemBarStyle)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Lime, onPrimary = Ink, background = Ink, surface = Panel), typography = Typography(bodyLarge = androidx.compose.ui.text.TextStyle(fontFamily = DmSans))) {
                val connection by model.connection.collectAsStateWithLifecycle()
                var exit by remember { mutableStateOf(false) }
                val screen = connection.ui as? DisplayUi.Screen
                val active = !connection.offline && (screen?.snapshot?.state in listOf("live", "warning") || connection.ui is DisplayUi.Pairing && !(connection.ui as DisplayUi.Pairing).expired)
                DisposableEffect(active) {
                    if (active) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    onDispose { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
                }
                BackHandler { exit = true }
                OcheApp(connection, model::newCode, isTv)
                if (exit) AlertDialog(onDismissRequest = { exit = false }, title = { Text("Oche Live sluiten?") }, text = { Text("De koppeling blijft bewaard. Bij de volgende start opent dit scherm opnieuw.") }, confirmButton = { Button(onClick = { finish() }) { Text("Sluiten") } }, dismissButton = { TextButton(onClick = { exit = false }) { Text("Doorgaan") } })
            }
        }
    }
    override fun onStart() { super.onStart(); model.resume(isTv) }
    override fun onStop() { model.pause(); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); super.onStop() }
}

@Composable fun OcheApp(connection: ConnectionState, newCode: () -> Unit, isTv: Boolean = false) {
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) { while (true) { now = SystemClock.elapsedRealtime(); delay(250) } }
    val theme = (connection.ui as? DisplayUi.Screen)?.snapshot?.theme
    val palette = if (theme == "onzetrots") OnzeTrotsPalette else DartFlowPalette
    CompositionLocalProvider(LocalOchePalette provides palette) {
    MaterialTheme(colorScheme = darkColorScheme(primary = palette.primary, onPrimary = palette.ink, background = palette.ink, surface = palette.panel), typography = MaterialTheme.typography) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Ink).windowInsetsPadding(WindowInsets.safeDrawing)) {
        Rings(Modifier.fillMaxSize())
        val landscape = maxWidth > maxHeight
        val margin = if (isTv) 32.dp else if (maxWidth > 700.dp) 28.dp else 18.dp
        Column(Modifier.fillMaxSize().padding(margin), verticalArrangement = Arrangement.spacedBy(if (landscape) 16.dp else 18.dp)) {
            Header((connection.ui as? DisplayUi.Screen)?.snapshot?.boardName ?: "OCHE LIVE", isTv)
            (connection.ui as? DisplayUi.Screen)?.snapshot?.encounter?.let { EncounterSummary(it) }
            (connection.ui as? DisplayUi.Screen)?.snapshot?.pendingCall?.let { call ->
                Column(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp)).border(1.dp, Outline, RoundedCornerShape(8.dp)).padding(10.dp)) {
                    Text(call.label, color = Lime, fontSize = 12.sp)
                    Text(call.players.joinToString(" – "), color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    call.writerName?.let { Text("Schrijver: $it", color = Muted, fontSize = 11.sp) }
                }
            }
            if (connection.offline) Text("OFFLINE · ${connection.message ?: "Verbinding herstellen…"}", color = Lime, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite })
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (val ui = connection.ui) {
                    DisplayUi.Loading -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(color = Lime); Spacer(Modifier.height(20.dp)); Text("Scherm openen…", color = Color.White) }
                    is DisplayUi.Pairing -> PairingView(ui, now, newCode, landscape)
                    is DisplayUi.Disconnected -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { Headline("Koppel dit scherm"); Text(ui.message, color = Muted, textAlign = TextAlign.Center); Spacer(Modifier.height(24.dp)); Action("Nieuwe code", newCode) }
                    is DisplayUi.Screen -> ScreenView(ui, now, landscape, connection.offline)
                }
            }
            Text(if (theme == "onzetrots") "Powered by DartFlow" else "DARTFLOW · OCHE LIVE", color = Muted, fontSize = 12.sp, letterSpacing = 2.sp)
        }
    }
    }
    }
}

@Composable private fun EncounterSummary(encounter: Encounter) {
    Column(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp)).border(1.dp, Outline, RoundedCornerShape(8.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(encounter.name, color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text("${encounter.homeName}  ${encounter.score.getOrElse(0) { 0 }}–${encounter.score.getOrElse(1) { 0 }}  ${encounter.awayName}", color = Lime, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text("Werkelijke legs ${encounter.legs.getOrElse(0) { 0 }}–${encounter.legs.getOrElse(1) { 0 }} · onderdeel ${encounter.componentIndex + 1}: ${encounter.componentLabel}", color = Muted, fontSize = 12.sp, maxLines = 2)
    }
}
@Composable private fun Header(name: String, isTv: Boolean) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OcheBrand(false, Modifier.width(if (isTv) 190.dp else 145.dp).height(48.dp))
        Spacer(Modifier.weight(1f))
        Text(name.uppercase(Locale.ROOT), maxLines = 1, overflow = TextOverflow.Ellipsis, color = Lime, fontSize = 13.sp, modifier = Modifier.weight(1f, false).border(1.dp, Outline, RoundedCornerShape(10.dp)).padding(12.dp, 8.dp))
        Action("Info", { menu = true }, compact = true)
    }
    if (menu) {
        val context = LocalContext.current
        AlertDialog(onDismissRequest = { menu = false }, title = { Text("DartFlow Oche Live") }, text = { Text("Alleen-lezen baanscherm · ${BuildConfig.VERSION_NAME}\nBeheer de koppeling via DartFlow → Schermen. Bij ontkoppelen vervalt de toegang automatisch.\n\nHet scherm blijft wakker tijdens een wedstrijd en het koppelen. Stand-by respecteert de screensaver van het apparaat.\nPrivacy: ${BuildConfig.API_ORIGIN}/privacy") }, confirmButton = { Action("Gereed", { menu = false }) }, dismissButton = { TextButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, "${BuildConfig.API_ORIGIN}/privacy".toUri())) }; menu = false }) { Text("Privacy") } })
    }
}
@Composable private fun Action(label: String, onClick: () -> Unit, compact: Boolean = false) {
    var focused by remember { mutableStateOf(false) }
    Button(onClick = onClick, modifier = Modifier.onFocusChanged { focused = it.isFocused }.border(if (focused) 3.dp else 0.dp, if (focused) Color.White else Color.Transparent, RoundedCornerShape(14.dp)).heightIn(min = if (compact) 48.dp else 56.dp), contentPadding = PaddingValues(horizontal = if (compact) 16.dp else 28.dp, vertical = 10.dp)) { Text(label, fontFamily = DmSans, fontWeight = FontWeight.Bold) }
}
@Composable private fun Headline(text: String, size: Int = 42) = Text(text, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = size.sp, lineHeight = (size + 2).sp, color = Color.White, textAlign = TextAlign.Center)
@Composable private fun OcheBrand(icon: Boolean, modifier: Modifier) {
    val club = LocalOchePalette.current.id == "onzetrots"
    val asset = if (club) { if (icon) R.drawable.duindorp_crest else R.drawable.onzetrots_wordmark_white } else { if (icon) R.drawable.launcher_foreground else R.drawable.dartflow_logo }
    Image(painterResource(asset), if (club) { if (icon) "S.V. Duindorp" else "Onze Trots" } else "DartFlow", modifier, contentScale = ContentScale.Fit)
}
@Composable private fun Rings(modifier: Modifier) {
    val accent = Lime
    Canvas(modifier) {
    val center = androidx.compose.ui.geometry.Offset(size.width * .78f, size.height * .38f)
    for (index in 1..7) drawCircle(accent.copy(alpha = .045f), radius = size.minDimension * .14f * index, center = center, style = Stroke(2f))
    }
}
@Composable private fun PairingView(pair: DisplayUi.Pairing, monotonic: Long, newCode: () -> Unit, landscape: Boolean) {
    val serverTime = pair.serverAtReceipt + monotonic - pair.monotonicAtReceipt
    val remaining = secondsRemaining(pair.expiresAt, serverTime)
    val expired = pair.expired || remaining == 0
    val content: @Composable () -> Unit = {
        Headline("KOPPEL DIT SCHERM")
        Text("Open DartFlow → Schermen op je telefoon, scan de QR en bevestig de koppeling.", color = Muted, textAlign = TextAlign.Center, fontSize = 17.sp)
        Text(pair.code, fontFamily = Barlow, fontSize = if (landscape) 60.sp else 46.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 3.sp, color = Lime)
        Text(if (expired) "Deze code is verlopen" else "Geldig ${formatClock(remaining)}", color = Muted, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        Action("Nieuwe code", newCode)
        Text("Je koppelt alleen dit scherm. Er wordt geen spelersaccount op dit apparaat aangemeld.", color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center)
    }
    if (landscape) Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(40.dp)) {
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) { content() }
        if (!expired) Qr(pair.url, Modifier.weight(.7f).aspectRatio(1f).sizeIn(maxWidth = 430.dp, maxHeight = 430.dp))
    } else Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
        Headline("KOPPEL DIT SCHERM", 36)
        Text("Scan op je telefoon en bevestig in DartFlow.", color = Muted, textAlign = TextAlign.Center)
        if (!expired) Qr(pair.url, Modifier.weight(1f, false).aspectRatio(1f).sizeIn(maxWidth = 290.dp, maxHeight = 290.dp))
        Text(pair.code, fontFamily = Barlow, fontSize = 42.sp, letterSpacing = 2.sp, color = Lime)
        Text(if (expired) "Deze code is verlopen" else "Geldig ${formatClock(remaining)}", color = Muted)
        Action("Nieuwe code", newCode)
    }
}
@Composable private fun Qr(url: String, modifier: Modifier) {
    val image = remember(url) {
        val matrix = QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 768, 768, mapOf(EncodeHintType.MARGIN to 4, EncodeHintType.CHARACTER_SET to "UTF-8"))
        android.graphics.Bitmap.createBitmap(768, 768, android.graphics.Bitmap.Config.ARGB_8888).apply {
            val pixels = IntArray(768 * 768) { i -> if (matrix[i % 768, i / 768]) android.graphics.Color.BLACK else android.graphics.Color.WHITE }
            setPixels(pixels, 0, 768, 0, 0, 768, 768)
        }.asImageBitmap()
    }
    Image(image, "QR-code", modifier.clip(RoundedCornerShape(12.dp)).background(Color.White), contentScale = ContentScale.Fit, filterQuality = androidx.compose.ui.graphics.FilterQuality.None)
}

@Composable private fun ScreenView(screen: DisplayUi.Screen, now: Long, landscape: Boolean, offline: Boolean) {
    val snapshot = screen.snapshot
    val serverTime = screen.serverAtReceipt + if (screen.cached) 0 else now - screen.monotonicAtReceipt
    val activity = snapshot.activity
    val warning = !screen.cached && activity != null && serverTime >= activity.warningAt && snapshot.match?.canShowTurn == true && snapshot.state in listOf("live", "warning")
    Box(Modifier.fillMaxSize()) {
        if (snapshot.match != null) LiveView(snapshot.match, landscape, snapshot.match.finished) else Standby(snapshot, landscape, now)
        val cue = screen.cue
        var visibleCue by remember { mutableStateOf<ScoreEvent?>(null) }
        LaunchedEffect(cue?.id, offline) { visibleCue = if (offline) null else cue; if (visibleCue != null) { delay(1_800); visibleCue = null } }
        val reduced = Settings.Global.getFloat(LocalContext.current.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        if (visibleCue != null && !warning) Box(Modifier.fillMaxSize().background(Ink.copy(alpha = .94f)), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) { Headline(if (visibleCue!!.checkout) "HOGE FINISH" else "MAXIMUM", if (reduced) 44 else 56); Text("${visibleCue!!.score}", fontFamily = Barlow, fontSize = 100.sp, color = Lime); Text(visibleCue!!.player, color = Color.White) }
        }
        if (warning) {
            val remaining = secondsRemaining(activity!!.deadlineAt, serverTime)
            Box(Modifier.fillMaxSize().background(Ink.copy(alpha = .94f)), contentAlignment = Alignment.Center) {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Headline(if (remaining == 0) "BAAN WORDT VRIJGEGEVEN" else "SPELEN JULLIE NOG DOOR?", if (landscape) 48 else 36)
                    Text(formatClock(remaining), fontFamily = Barlow, fontSize = if (landscape) 88.sp else 72.sp, color = Lime)
                    Text(if (remaining == 0 && offline) "Wacht op de actuele serverstatus." else "De baan wordt vrijgegeven als de aftelling afloopt.", color = Muted, textAlign = TextAlign.Center)
                    Text("Tik op Doorspelen op je telefoon", color = Lime, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    Text("Verlengingen over ${maxOf(0, 2 - activity.extensionsUsed)}", color = Muted)
                }
            }
        }
    }
}
@Composable private fun Standby(snapshot: DisplaySnapshot, landscape: Boolean, now: Long) {
    var started by remember { mutableLongStateOf(now) }
    LaunchedEffect(snapshot.state, snapshot.boardName) { started = SystemClock.elapsedRealtime() }
    val free = snapshot.publicStandby
    val slide = if (free) standbySlide(now - started) else -1
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
        if (slide == 0) {
            OcheBrand(true, Modifier.size(if (landscape) 190.dp else 170.dp))
            OcheBrand(false, Modifier.fillMaxWidth(.8f).height(110.dp))
        } else if (free || snapshot.state == "reserved") {
            val title = if (snapshot.state == "reserved") "BAAN GERESERVEERD" else if (slide == 2) "ZO SPEEL JE." else "SCAN EN SPEEL."
            if (landscape) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                snapshot.playUrl?.let { Qr(it, Modifier.weight(.8f).aspectRatio(1f).sizeIn(maxWidth = 380.dp, maxHeight = 380.dp)) }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) { Headline(title, 56); StandbyText(slide, snapshot) }
            } else {
                Headline(title, 40)
                snapshot.playUrl?.let { Qr(it, Modifier.weight(1f, false).aspectRatio(1f).sizeIn(maxWidth = if (slide == 2) 240.dp else 330.dp, maxHeight = if (slide == 2) 240.dp else 330.dp)) }
                StandbyText(slide, snapshot)
            }
        } else {
            Headline(when (snapshot.state) { "closed" -> "BAAN GESLOTEN"; "blocked" -> "BAAN NIET BESCHIKBAAR"; "unassigned" -> "SCHERM GEKOPPELD"; else -> "KLAAR OM TE SPELEN" })
            Text(if (snapshot.state == "unassigned") "Kies in DartFlow → Schermen een baan voor dit scherm." else "${snapshot.displayName} · Wacht op de volgende partij.", color = Muted, fontSize = 18.sp, textAlign = TextAlign.Center)
        }
        if (free) Text("0${slide + 1} / 03", color = Muted, fontSize = 12.sp)
    }
}
@Composable private fun StandbyText(slide: Int, snapshot: DisplaySnapshot) {
    if (snapshot.state == "reserved") Text(snapshot.reservation ?: "Alleen de gereserveerde spelers kunnen aansluiten.", color = Muted, textAlign = TextAlign.Center)
    else if (slide == 2) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf("Scan de QR-code.", "Maak een (oefen)wedstrijd aan.", "Laat spelers de QR-code scannen of speel op afstand.", "Start de wedstrijd.").forEachIndexed { i, text -> Text("${i + 1}  $text", color = Color.White, fontSize = 16.sp, modifier = Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp)).padding(10.dp)) }
    } else Text("Begin een oefenpartij, speel samen op locatie of nodig iemand online uit.\nOpen deze baan met je telefoon.", color = Muted, fontSize = 18.sp, textAlign = TextAlign.Center)
}

@Composable private fun LiveView(match: Match, landscape: Boolean, result: Boolean) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val small = maxHeight < 560.dp
        val rowHeight = if (small) 21.dp else 34.dp
        if (landscape) Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                MatchHeading(match, result)
                Players(match, 90)
                LastVisit(match)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) { Scorecard(match, rowHeight, Modifier.weight(1f)); Text("SET ${match.set} · LEG ${match.leg}", color = Muted) }
        } else Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(if (small) 10.dp else 18.dp)) {
            MatchHeading(match, result)
            Players(match, if (small) 54 else 80, small)
            Scorecard(match, rowHeight, Modifier.weight(1f))
            LastVisit(match)
        }
    }
}
@Composable private fun MatchHeading(match: Match, result: Boolean) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("${match.startLabel}${if (result) " EINDSTAND" else ""}", fontFamily = Barlow, fontSize = 29.sp, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(match.rulesLabel, color = Muted, fontSize = 12.sp, maxLines = 2)
        }
        Text(match.statusLabel, color = Lime, fontSize = 14.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1f, false))
    }
}
@Composable private fun Players(match: Match, size: Int, compact: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        match.players.forEachIndexed { index, player ->
            val active = match.canShowTurn && index == match.turn
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 8.dp)) {
                Row(Modifier.fillMaxWidth().border(1.dp, Outline, RoundedCornerShape(10.dp)).padding(if (compact) 4.dp else 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(initials(player.name), color = if (active) Lime else Color.White, fontFamily = Barlow, fontSize = if (compact) 16.sp else 24.sp, modifier = Modifier.background(if (active) Lime.copy(alpha = .16f) else Outline, RoundedCornerShape(6.dp)).padding(if (compact) 2.dp else 7.dp))
                    Text(player.name, modifier = Modifier.semantics { contentDescription = (listOf(player.name) + player.partners).distinct().joinToString(" · ") }, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Column(Modifier.fillMaxWidth().background(if (active) Lime.copy(alpha = .12f) else Panel, RoundedCornerShape(8.dp)).border(1.dp, if (active) Lime else Outline, RoundedCornerShape(8.dp)).padding(vertical = if (compact) 2.dp else 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (match.cricket != null) "PUNTEN" else "RESTEREND", color = Muted, fontSize = if (compact) 9.sp else 10.sp, letterSpacing = 1.sp)
                    Text("${match.cricket?.points?.getOrNull(index) ?: player.remaining}", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = size.sp, lineHeight = (size + 4).sp, color = if (active) Lime else Color.White, maxLines = 1)
                    Text(if (active) match.currentThrowerName?.let { "WERPT: $it" } ?: "AAN DE BEURT" else if (!match.canShowTurn) match.statusLabel.uppercase(Locale.ROOT) else "WACHT", color = if (active) Lime else Muted, fontSize = if (compact) 9.sp else 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Row(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp)).padding(if (compact) 2.dp else 6.dp), horizontalArrangement = Arrangement.SpaceAround) {
                    if (match.cricket != null) Metric(match.cricket.mpr.getOrNull(index)?.let { String.format(Locale.forLanguageTag("nl"), "%.1f", it) } ?: "–", "MPR", compact) else {
                    Metric(player.average?.let { String.format(Locale.forLanguageTag("nl"), "%.1f", it) } ?: "–", "AVG", compact)
                    Metric(if (player.highestFinish > 0) "${player.highestFinish}" else "–", "H. FIN", compact)
                    Metric("${player.maxima}", "180's", compact)
                    }
                }
                if (!compact) Text("Legs ${player.legs} · Sets ${player.sets}", color = Muted, fontSize = 11.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
            }
        }
    }
}
@Composable private fun Metric(value: String, title: String, compact: Boolean = false) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(value, fontFamily = Barlow, fontSize = if (compact) 18.sp else 22.sp, color = Color.White); Text(title, fontSize = if (compact) 9.sp else 10.sp, color = Muted) } }
private fun cricketMark(value: Int) = when (value.coerceIn(0,3)) { 0 -> "–"; 1 -> "/"; 2 -> "X"; else -> "⊗" }
@Composable private fun Scorecard(match: Match, rowHeight: Dp, modifier: Modifier) {
    match.cricket?.let { cricket ->
        Column(modifier.fillMaxWidth().border(1.dp, Outline, RoundedCornerShape(10.dp)).padding(10.dp), verticalArrangement = Arrangement.SpaceEvenly) {
            Text("MARKS · / één · X twee · ⊗ gesloten", color = Muted, fontSize = 12.sp)
            listOf(20,19,18,17,16,15,25).forEachIndexed { index, target ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                    Text(cricketMark(cricket.marks.getOrNull(0)?.getOrNull(index) ?: 0), color = Lime, fontSize = 24.sp)
                    Text(if (target == 25) "BULL" else "$target", color = Color.White, fontSize = 20.sp)
                    if (match.players.size > 1) Text(cricketMark(cricket.marks.getOrNull(1)?.getOrNull(index) ?: 0), color = Lime, fontSize = 24.sp)
                }
            }
        }
        return
    }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var focused by remember { mutableStateOf(false) }
    val rows = match.rows()
    var priorCount by remember(match.legKey) { mutableIntStateOf(match.visits.size) }
    LaunchedEffect(match.legKey) { list.scrollToItem(maxOf(0, rows.size - 5)) }
    LaunchedEffect(match.revision) {
        val undo = match.events.lastOrNull()?.kind == "undo"
        if (!undo && match.visits.size > priorCount && rows.size > 5) list.animateScrollToItem(rows.size - 5)
        priorCount = match.visits.size
    }
    Column(modifier.fillMaxWidth().border(1.dp, Outline, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp))) {
        Row(Modifier.fillMaxWidth().background(Panel).padding(10.dp, 5.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("SCOREKAART", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            if (rows.size > 5 && list.canScrollForward) TextButton(onClick = { scope.launch { list.animateScrollToItem(rows.size - 5) } }, contentPadding = PaddingValues(0.dp), modifier = Modifier.height(28.dp)) { Text("Terug naar live", color = Lime, fontSize = 11.sp) }
            else Text("SET ${match.set} · LEG ${match.leg}", color = Muted, fontSize = 11.sp)
        }
        CardRow(if (match.players.size == 1) listOf("WORP", "REST") else listOf("WORP", "REST", "REST", "WORP"), rowHeight, true)
        CardRow(match.startRow, rowHeight)
        LazyColumn(state = list, modifier = Modifier.heightIn(max = rowHeight * 5).fillMaxWidth().onFocusChanged { focused = it.isFocused }.border(if (focused) 2.dp else 0.dp, if (focused) Color.White else Color.Transparent).onPreviewKeyEvent { event ->
                val direction = when (event.key) { Key.DirectionDown -> 1; Key.DirectionUp -> -1; else -> 0 }
                if (event.type == KeyEventType.KeyDown && direction != 0) {
                    val target = (list.firstVisibleItemIndex + direction).coerceIn(0, maxOf(0, rows.size - 5))
                    if (target != list.firstVisibleItemIndex || list.firstVisibleItemScrollOffset > 0) { scope.launch { list.animateScrollToItem(target) }; true } else false
                } else false
            }.focusable()) {
            itemsIndexed(rows) { index, cells ->
                val values = if (cells.size == 1) listOf(cells[0]?.let { if (it.bust) "BUST" else "${it.score}" } ?: "", cells[0]?.remaining?.toString() ?: "") else listOf(cells.getOrNull(0)?.let { if (it.bust) "BUST" else "${it.score}" } ?: "", cells.getOrNull(0)?.remaining?.toString() ?: "", cells.getOrNull(1)?.remaining?.toString() ?: "", cells.getOrNull(1)?.let { if (it.bust) "BUST" else "${it.score}" } ?: "")
                val latest = cells.mapIndexedNotNull { p, v -> if (v != null && index == match.visits.count { it.player == p } - 1) (if (p == 0) 1 else 2) else null }.toSet()
                CardRow(values, rowHeight, highlights = latest)
            }
        }
    }
}
@Composable private fun CardRow(values: List<String>, height: Dp, heading: Boolean = false, highlights: Set<Int> = emptySet()) {
    Row(Modifier.fillMaxWidth().height(height).background(if (heading) Lime.copy(alpha = .12f) else Panel)) {
        values.forEachIndexed { index, value ->
            Box(Modifier.weight(1f).fillMaxHeight().background(if (index in highlights) Lime.copy(alpha = .23f) else Color.Transparent).border(.5.dp, Outline), contentAlignment = Alignment.Center) { Text(value, color = if (index in highlights) Lime else Color.White, fontFamily = if (heading) DmSans else Barlow, fontWeight = if (heading) FontWeight.Bold else FontWeight.ExtraBold, fontSize = if (heading) 11.sp else if (height <= 22.dp) 20.sp else 23.sp, maxLines = 1, style = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum")) }
        }
    }
}
@Composable private fun LastVisit(match: Match) {
    val last = match.visits.lastOrNull()
    val label = when { match.finished -> match.statusLabel.uppercase(Locale.ROOT); !match.canShowTurn -> match.statusLabel.uppercase(Locale.ROOT); match.checkout != null -> "FINISHROUTE"; else -> "LAATSTE BEURT" }
    val value = when {
        match.finished -> match.winnerName?.let { "Winnaar: $it" } ?: "Bekijk de uitslag op je telefoon"
        !match.canShowTurn -> "Volg de instructies op je telefoon"
        match.checkout != null -> match.checkout
        else -> last?.let { "${match.players.getOrNull(it.player)?.name ?: ""} · ${if (it.bust) "Bust" else if (match.cricket != null) "${it.creditedMarks ?: 0} marks · ${it.score} punten" else "${it.score} punten"}" } ?: "Nog geen worp"
    }
    Row(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp)).border(1.dp, Outline, RoundedCornerShape(8.dp)).padding(10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Lime, fontSize = 11.sp, modifier = Modifier.weight(1f))
        Text(value, color = Color.White, fontFamily = Barlow, fontSize = 18.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1.5f), maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
fun formatClock(seconds: Int): String = "%02d:%02d".format(Locale.ROOT, seconds / 60, seconds % 60)
fun initials(name: String): String = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.let { if (it.size > 1) it.take(2).joinToString("") { word -> word.take(1) } else it.firstOrNull()?.take(2) ?: "" }.uppercase(Locale.ROOT)
