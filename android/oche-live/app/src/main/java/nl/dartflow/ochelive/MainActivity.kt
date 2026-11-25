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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
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

private data class OchePalette(val id: String, val primary: Color, val ink: Color, val panel: Color, val muted: Color, val outline: Color, val text: Color = Color.White, val onPrimary: Color = ink, val secondary: Color = primary, val focus: Color = primary, val warning: Color = Color(0xFFFFD47A), val error: Color = Color(0xFFFFADAD), val branding: ClubDisplayTheme? = null)
private val DartFlowPalette = OchePalette("dartflow", Color(0xFFB5F52B), Color(0xFF101211), Color(0xFF172019), Color(0xFFB5BDB4), Color(0xFF3B4A39))
private val OnzeTrotsPalette = OchePalette("onzetrots", Color(0xFFA8CEFF), Color(0xFF06182F), Color(0xFF0C2856), Color(0xFFC3D5EE), Color(0xFF335789))
private val LocalOchePalette = staticCompositionLocalOf { DartFlowPalette }
private val Lime: Color @Composable get() = LocalOchePalette.current.primary
private val Ink: Color @Composable get() = LocalOchePalette.current.ink
private val Panel: Color @Composable get() = LocalOchePalette.current.panel
private val Muted: Color @Composable get() = LocalOchePalette.current.muted
private val Outline: Color @Composable get() = LocalOchePalette.current.outline
private fun displayPalette(theme: String?, branding: ClubDisplayTheme?): OchePalette {
    if (theme == "club" && branding != null) {
        fun color(key: String) = Color(0xFF000000 or branding.tokens.getValue(key).removePrefix("#").toLong(16))
        return OchePalette("club", color("primary"), color("background"), color("surface"), color("muted"), color("border"), color("text"), color("onPrimary"), color("secondary"), color("focus"), color("warning"), color("error"), branding)
    }
    return if (theme == "onzetrots") OnzeTrotsPalette else DartFlowPalette
}
private val OcheText: Color @Composable get() = LocalOchePalette.current.text
private val Focus: Color @Composable get() = LocalOchePalette.current.focus
private val Warning: Color @Composable get() = LocalOchePalette.current.warning
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
                val active = !connection.offline && (screen?.snapshot?.let { snapshot -> snapshot.playing || snapshot.state in listOf("live", "warning") } == true || connection.ui is DisplayUi.Pairing && !(connection.ui as DisplayUi.Pairing).expired || connection.layoutProposal != null)
                DisposableEffect(active) {
                    if (active) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    onDispose { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
                }
                BackHandler { exit = true }
                OcheApp(connection, model::newCode, isTv, model::openLayoutSetup, model::saveLayout, model::deferLayoutSetup, model::closeLayoutSetup, model::closeLayoutProposal, model::renewLayoutProposal)
                if (exit) AlertDialog(onDismissRequest = { exit = false }, title = { Text("Oche Live sluiten?") }, text = { Text("De koppeling blijft bewaard. Bij de volgende start opent dit scherm opnieuw.") }, confirmButton = { Button(onClick = { finish() }) { Text("Sluiten") } }, dismissButton = { TextButton(onClick = { exit = false }) { Text("Doorgaan") } })
            }
        }
    }
    override fun onStart() { super.onStart(); model.resume(isTv, resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) }
    override fun onStop() { model.pause(); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); super.onStop() }
}

@Composable fun OcheApp(connection: ConnectionState, newCode: () -> Unit, isTv: Boolean = false, openLayout: (Boolean) -> Unit = {}, saveLayout: (DisplayLayout) -> Unit = {}, deferLayout: () -> Unit = {}, closeLayout: () -> Unit = {}, closeProposal: () -> Unit = {}, renewProposal: () -> Unit = {}) {
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) { while (true) { now = SystemClock.elapsedRealtime(); delay(250) } }
    val theme = (connection.ui as? DisplayUi.Screen)?.snapshot?.theme
    val branding = (connection.ui as? DisplayUi.Screen)?.activeClubTheme(now)
    val palette = displayPalette(theme, branding)
    CompositionLocalProvider(LocalOchePalette provides palette) {
    MaterialTheme(colorScheme = darkColorScheme(primary = palette.primary, onPrimary = palette.onPrimary, secondary = palette.secondary, background = palette.ink, onBackground = palette.text, surface = palette.panel, onSurface = palette.text, onSurfaceVariant = palette.muted, outline = palette.outline, error = palette.error), typography = MaterialTheme.typography) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Ink).windowInsetsPadding(WindowInsets.safeDrawing)) {
        Rings(Modifier.fillMaxSize())
        val snapshot = (connection.ui as? DisplayUi.Screen)?.snapshot
        val dual = snapshot?.layout?.scoreboards == 2 && snapshot.panels != null
        val viewportLandscape = maxWidth > maxHeight
        val landscape = snapshot?.layout?.let { it.orientation == "landscape" } ?: viewportLandscape
        val margin = if (isTv) 32.dp else if (maxWidth > 700.dp) 28.dp else 18.dp
        // A deliberate portrait composition on a landscape TV remains upright and
        // readable. Viewport changes never alter the confirmed layout or source.
        val compositionWidth = if (snapshot?.layout?.orientation == "portrait" && maxWidth > maxHeight) maxHeight * (9f / 16f) else maxWidth
        // Render only the active interaction surface so D-pad focus cannot move
        // into an Info or pairing button hidden behind the setup surface.
        if (connection.layoutSetup == null && connection.layoutProposal == null) {
        Column(Modifier.width(compositionWidth).fillMaxHeight().align(Alignment.Center).padding(margin), verticalArrangement = Arrangement.spacedBy(if (landscape) 12.dp else 14.dp)) {
            Header(if (dual) snapshot?.displayName ?: "OCHE LIVE" else snapshot?.boardName ?: "OCHE LIVE", isTv, { openLayout(false) }, snapshot?.let { it.configurationRevision != null })
            if (!dual) snapshot?.encounter?.let { EncounterSummary(it) }
            if (!dual) snapshot?.pendingCall?.let { call ->
                Column(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp)).border(1.dp, Outline, RoundedCornerShape(8.dp)).padding(10.dp)) {
                    Text(call.label, color = Lime, fontSize = 12.sp)
                    Text(call.players.joinToString(" – "), color = OcheText, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    call.writerName?.let { Text("Schrijver: $it", color = Muted, fontSize = 11.sp) }
                }
            }
            if (connection.offline) Text("OFFLINE · ${connection.message ?: "Verbinding herstellen…"}", color = Warning, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite })
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (val ui = connection.ui) {
                    DisplayUi.Loading -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(color = Lime); Spacer(Modifier.height(20.dp)); Text("Scherm openen…", color = OcheText) }
                    is DisplayUi.Pairing -> PairingView(ui, now, newCode, landscape)
                    is DisplayUi.Disconnected -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { Headline("Koppel dit scherm"); Text(ui.message, color = Muted, textAlign = TextAlign.Center); Spacer(Modifier.height(24.dp)); Action("Nieuwe code", newCode) }
                    is DisplayUi.Screen -> {
                        val primaryPanel = ui.snapshot.panels?.firstOrNull { it.position == "left" }
                        if (dual) SplitScreenView(ui, now, connection.offline)
                        else if (primaryPanel != null && primaryPanel.status != "ready") PanelStatus(primaryPanel)
                        else ScreenView(ui, now, landscape, connection.offline)
                    }
                }
            }
            Text(if (palette.id in listOf("onzetrots", "club")) "Powered by DartFlow" else "DARTFLOW · OCHE LIVE", color = Muted, fontSize = 12.sp, letterSpacing = 2.sp)
        }
        }
        connection.layoutSetup?.let { setup ->
            Surface(Modifier.fillMaxSize(), color = Ink) { LayoutWizard(setup, saveLayout, deferLayout, closeLayout) }
        }
        connection.layoutProposal?.let { proposal ->
            Surface(Modifier.fillMaxSize(), color = Ink) {
                Column(Modifier.fillMaxSize().padding(margin), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Bevestig de schermindeling op je telefoon. De huidige indeling blijft actief tot bevestiging.", color = Muted)
                    Box(Modifier.weight(1f)) { PairingView(proposal, now, renewProposal, viewportLandscape) }
                    Action("Terug naar scorebord", closeProposal)
                }
            }
            BackHandler(onBack = closeProposal)
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
@Composable private fun Header(name: String, isTv: Boolean, openLayout: () -> Unit, layoutSupported: Boolean?) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OcheBrand(false, Modifier.width(if (isTv) 190.dp else 145.dp).height(48.dp))
        Spacer(Modifier.weight(1f))
        Text(name.uppercase(Locale.ROOT), maxLines = 1, overflow = TextOverflow.Ellipsis, color = Lime, fontSize = 13.sp, modifier = Modifier.weight(1f, false).border(1.dp, Outline, RoundedCornerShape(10.dp)).padding(12.dp, 8.dp))
        Action("Info", { menu = true }, compact = true)
    }
    if (menu) {
        val context = LocalContext.current
        AlertDialog(onDismissRequest = { menu = false }, title = { Text("DartFlow Oche Live") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Alleen-lezen baanscherm · ${BuildConfig.VERSION_NAME}\nBeheer de koppeling en banen via DartFlow → Schermen.\nStand-by respecteert de screensaver van het apparaat.")
                if (layoutSupported == false) Text("Deze server ondersteunt splitscreen nog niet. De enkele baanweergave blijft beschikbaar.")
                Action("Schermindeling wijzigen", { menu = false; openLayout() })
            }
        }, confirmButton = { Action("Gereed", { menu = false }) }, dismissButton = { TextButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, "${BuildConfig.API_ORIGIN}/privacy".toUri())) }; menu = false }) { Text("Privacy") } })
    }
}
@Composable private fun Action(label: String, onClick: () -> Unit, compact: Boolean = false) {
    var focused by remember { mutableStateOf(false) }
    Button(onClick = onClick, modifier = Modifier.onFocusChanged { focused = it.isFocused }.border(if (focused) 3.dp else 0.dp, if (focused) Focus else Color.Transparent, RoundedCornerShape(14.dp)).heightIn(min = if (compact) 48.dp else 56.dp), contentPadding = PaddingValues(horizontal = if (compact) 16.dp else 28.dp, vertical = 10.dp)) { Text(label, fontFamily = DmSans, fontWeight = FontWeight.Bold) }
}
@Composable internal fun LayoutWizard(setup: LayoutSetup, save: (DisplayLayout) -> Unit, later: () -> Unit, close: () -> Unit) {
    var orientation by remember { mutableStateOf(setup.initial.orientation) }
    var scoreboards by remember { mutableIntStateOf(setup.initial.scoreboards) }
    var step by remember { mutableIntStateOf(1) }
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(step) { firstFocus.requestFocus() }
    BackHandler(enabled = step == 2 || setup.linked) { if (step == 2) step = 1 else if (setup.allowLater) later() else close() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically)) {
        Headline(if (step == 1) "Hoe staat dit scherm?" else "Hoeveel scoreborden wil je tonen?", 36)
        Text(if (step == 1) "Bevestig de schermindeling. De gedetecteerde stand is voorgesteld." else "Kies hoe je horizontale scherm wordt ingedeeld.", color = Muted, textAlign = TextAlign.Center)
        Row(Modifier.widthIn(max = 780.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            if (step == 1) {
                LayoutChoice("Verticaal (9:16)", DisplayLayout("portrait", 1), orientation == "portrait", Modifier.weight(1f).focusRequester(firstFocus), !setup.saving) { orientation = "portrait" }
                LayoutChoice("Horizontaal (16:9)", DisplayLayout("landscape", 1), orientation == "landscape", Modifier.weight(1f), !setup.saving) { orientation = "landscape" }
            } else {
                LayoutChoice("Eén scorebord", DisplayLayout("landscape", 1), scoreboards == 1, Modifier.weight(1f).focusRequester(firstFocus), !setup.saving) { scoreboards = 1 }
                if (setup.allowDual) LayoutChoice("Twee scoreborden", DisplayLayout("landscape", 2), scoreboards == 2, Modifier.weight(1f), !setup.saving) { scoreboards = 2 }
            }
        }
        if (step == 2) Text(if (setup.allowDual) "Twee scoreborden · Beschikbaar voor locaties" else "Mijn scherm thuis toont één scorebord.", color = Muted, fontSize = 14.sp)
        setup.error?.let { Text(it, color = Lime, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 760.dp).semantics { liveRegion = LiveRegionMode.Polite }) }
        if (setup.linked) Text("Bevestig wijzigingen met je bevoegde account op je telefoon. Tot die tijd blijft de huidige indeling actief.", color = Muted, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 760.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            if (step == 2) Action("Terug", { if (!setup.saving) step = 1 })
            if (setup.allowLater) Action("Later", { if (!setup.saving) later() })
            else if (setup.linked) Action("Annuleren", { if (!setup.saving) close() })
            Action(if (setup.saving) "Opslaan…" else if (step == 1 && orientation == "landscape") "Doorgaan" else "Opslaan en doorgaan", {
                if (!setup.saving) {
                    if (step == 1 && orientation == "landscape") step = 2
                    else save(DisplayLayout(orientation, if (orientation == "portrait" || !setup.allowDual) 1 else scoreboards))
                }
            })
        }
    }
}
@Composable private fun LayoutChoice(label: String, layout: DisplayLayout, selected: Boolean, modifier: Modifier, enabled: Boolean, choose: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    OutlinedButton(onClick = choose, enabled = enabled, modifier = modifier.onFocusChanged { focused = it.isFocused }.border(if (focused) 3.dp else if (selected) 2.dp else 1.dp, if (focused) Focus else if (selected) Lime else Outline, RoundedCornerShape(16.dp)), shape = RoundedCornerShape(16.dp), contentPadding = PaddingValues(16.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.height(112.dp).aspectRatio(if (layout.orientation == "portrait") 9f / 16f else 16f / 9f).border(2.dp, if (selected) Lime else Muted, RoundedCornerShape(6.dp)).padding(5.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (layout.scoreboards == 2) {
                    Box(Modifier.fillMaxHeight().aspectRatio(9f / 16f).background(Panel), contentAlignment = Alignment.Center) { Text("501", fontFamily = Barlow, color = OcheText, fontSize = 20.sp) }
                    Box(Modifier.weight(1f).fillMaxHeight().background(Outline.copy(alpha = .45f)), contentAlignment = Alignment.Center) { Text("← →", color = Lime, fontSize = 12.sp, textAlign = TextAlign.Center) }
                    Box(Modifier.fillMaxHeight().aspectRatio(9f / 16f).background(Panel), contentAlignment = Alignment.Center) { Text("501", fontFamily = Barlow, color = OcheText, fontSize = 20.sp) }
                } else Box(Modifier.fillMaxSize().background(Panel), contentAlignment = Alignment.Center) { Text("501", fontFamily = Barlow, color = OcheText, fontSize = 20.sp) }
            }
            Text(label, color = if (selected) Lime else OcheText, fontWeight = FontWeight.Bold, maxLines = 2, textAlign = TextAlign.Center)
            Text(if (selected) "Geselecteerd" else "Selecteren", fontSize = 11.sp, color = Muted)
        }
    }
}
@Composable private fun Headline(text: String, size: Int = 42) = Text(text, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = size.sp, lineHeight = (size + 2).sp, color = OcheText, textAlign = TextAlign.Center)
@Composable private fun OcheBrand(icon: Boolean, modifier: Modifier) {
    val branding = LocalOchePalette.current.branding
    if (branding != null) {
        val bitmap = remember(branding.logoData) { runCatching {
            val data = branding.logoData ?: return@runCatching null
            require(ocheSafeLogo(data)); val bytes = java.util.Base64.getDecoder().decode(data.substringAfter(','))
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }; android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            require(bounds.outWidth in 1..512 && bounds.outHeight in 1..512)
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull() }
        if (icon && bitmap != null) Image(bitmap, branding.name, modifier, contentScale = ContentScale.Fit)
        else if (icon) Image(painterResource(R.drawable.launcher_foreground), "DartFlow", modifier, contentScale = ContentScale.Fit)
        else Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
            Image(painterResource(R.drawable.dartflow_logo), "DartFlow", Modifier.weight(1f).fillMaxWidth(), contentScale = ContentScale.Fit)
            Text("${branding.name} via DartFlow", color = Muted, fontSize = 10.sp, lineHeight = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        return
    }
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

@Composable private fun SplitScreenView(screen: DisplayUi.Screen, now: Long, offline: Boolean) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val geometry = splitScreenGeometry(maxWidth.value, maxHeight.value)
        val left = screen.snapshot.panels?.firstOrNull { it.position == "left" } ?: DisplayPanel("left", null, "unassigned", null)
        val right = screen.snapshot.panels?.firstOrNull { it.position == "right" } ?: DisplayPanel("right", null, "unassigned", null)
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            PortraitPanel(left, screen, now, offline, Modifier.width(geometry.cardWidth.dp).height(geometry.cardHeight.dp))
            LaneRail(left, right, offline, Modifier.width(geometry.railWidth.dp).fillMaxHeight())
            PortraitPanel(right, screen, now, offline, Modifier.width(geometry.cardWidth.dp).height(geometry.cardHeight.dp))
        }
    }
}
@Composable private fun PortraitPanel(panel: DisplayPanel, screen: DisplayUi.Screen, now: Long, offline: Boolean, modifier: Modifier) {
    key(panel.position, panel.sourceId, panel.snapshot?.let { it.match?.sessionKey ?: it.play?.x01Match?.sessionKey ?: it.play?.id }) {
        Box(modifier.semantics { contentDescription = "Scorebord ${if (panel.position == "left") "links" else "rechts"} · 9:16" }.clip(RoundedCornerShape(12.dp)).background(Ink).border(1.dp, Outline, RoundedCornerShape(12.dp)).padding(8.dp)) {
            val snapshot = panel.snapshot
            val palette = displayPalette(snapshot?.theme, snapshot?.let { screen.copy(snapshot = it).activeClubTheme(now) })
            CompositionLocalProvider(LocalOchePalette provides palette) {
                if (panel.status == "ready" && snapshot != null) {
                    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        snapshot.encounter?.let { EncounterSummary(it) }
                        snapshot.pendingCall?.let { Text(it.players.joinToString(" – "), color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        Box(Modifier.weight(1f).fillMaxWidth()) {
                            ScreenView(screen.copy(snapshot = snapshot, cue = screen.panelCues[panel.position]), now, false, offline, compact = true)
                        }
                    }
                } else PanelStatus(panel)
            }
        }
    }
}
@Composable private fun LaneRail(left: DisplayPanel, right: DisplayPanel, offline: Boolean, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Panel.copy(alpha = .65f)).border(1.dp, Outline.copy(alpha = .7f), RoundedCornerShape(16.dp)).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OcheBrand(false, Modifier.fillMaxWidth(.72f).height(32.dp))
        Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LaneDirection(left, offline, Modifier.weight(1f).fillMaxHeight())
            Box(Modifier.width(1.dp).fillMaxHeight().background(Outline.copy(alpha = .65f)))
            LaneDirection(right, offline, Modifier.weight(1f).fillMaxHeight())
        }
        Text("TWEE BANEN · ÉÉN SCHERM", color = Muted, fontSize = 9.sp, letterSpacing = 1.sp, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
@Composable private fun LaneDirection(panel: DisplayPanel, offline: Boolean, modifier: Modifier) {
    val snapshot = panel.snapshot
    val name = snapshot?.boardName ?: if (panel.position == "left") "Baan links" else "Baan rechts"
    val scanAvailable = !offline && panel.status == "ready" && snapshot?.canScan == true
    val status = if (offline) "OFFLINE · Vorige stand" else snapshot?.match?.statusLabel ?: when (snapshot?.state) { "standby" -> "Vrij om te spelen"; "reserved" -> "Gereserveerd"; "closed" -> "Gesloten"; "blocked" -> "Geblokkeerd"; "waiting" -> "Wacht op start"; else -> when (panel.status) { "unavailable" -> "Niet beschikbaar"; "error" -> "Synchroniseren…"; else -> "Geen baan toegewezen" } }
    BoxWithConstraints(modifier) {
        val qrSize = minOf(168.dp, maxWidth, (maxHeight - 130.dp).coerceAtLeast(48.dp))
        Column(Modifier.fillMaxSize().padding(horizontal = 2.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically)) {
            Text(if (panel.position == "left") "← $name" else "$name →", color = Lime, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 25.sp, lineHeight = 28.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().semantics { contentDescription = "${if (panel.position == "left") "Baan links" else "Baan rechts"}: $name" })
            Text(status, color = Muted, fontSize = 11.sp, lineHeight = 14.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (scanAvailable) {
                snapshot?.playUrl?.let { Qr(it, Modifier.size(qrSize)) }
                Text(if (snapshot?.state == "waiting") "Scan en sluit aan" else "Scan en speel", color = OcheText, fontWeight = FontWeight.Bold, fontSize = 13.sp, textAlign = TextAlign.Center)
            } else snapshot?.match?.let { match ->
                Text(match.startLabel, color = OcheText, fontFamily = Barlow, fontSize = 32.sp, textAlign = TextAlign.Center)
                Text("SET ${match.set}\nLEG ${match.leg}", color = Muted, fontSize = 11.sp, lineHeight = 17.sp, textAlign = TextAlign.Center)
            }
        }
    }
}
@Composable private fun PanelStatus(panel: DisplayPanel) {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
        Headline(when (panel.status) { "unassigned" -> "Nog geen baan toegewezen"; "unavailable" -> "Baan niet beschikbaar"; else -> "Baan opnieuw synchroniseren…" }, 30)
        Text(if (panel.status == "error") "De verbinding van deze baan wordt opnieuw gecontroleerd." else "Vraag een bevoegde beheerder om in DartFlow → Schermen een baan te kiezen.", color = Muted, textAlign = TextAlign.Center)
    }
}
@Composable private fun ScreenView(screen: DisplayUi.Screen, now: Long, landscape: Boolean, offline: Boolean, compact: Boolean = false) {
    val snapshot = screen.snapshot
    val serverTime = screen.serverAtReceipt + if (screen.cached) 0 else now - screen.monotonicAtReceipt
    val activity = snapshot.activity ?: snapshot.play?.takeIf { it.x01Match != null && it.deadlineAt > 0 }?.let { Activity(it.warningAt, it.deadlineAt, it.extensionsUsed) }
    val warning = !offline && !screen.cached && activity != null && serverTime >= activity.warningAt && (snapshot.match ?: snapshot.play?.x01Match)?.canShowTurn == true && snapshot.state in listOf("live", "warning")
    Box(Modifier.fillMaxSize().clip(RoundedCornerShape(8.dp))) {
        val lobby = snapshot.competitionLobby?.takeIf { !offline && !screen.cached && serverTime < it.expiresAt }
        if (snapshot.play != null) PlayDisplayView(snapshot.play, landscape, serverTime, screen.cached || offline, compactLayout = compact)
        else if (snapshot.match?.cricket?.targets?.size == 12 && !snapshot.match.bullPending) PlayDisplayView(tacticsDisplay(snapshot.match), landscape, serverTime, screen.cached || offline, compactLayout = compact)
        else if (snapshot.match != null) LiveView(snapshot.match, landscape, snapshot.match.finished, compact)
        else if (compact && lobby != null) CompetitionLobbyView(lobby, null, false)
        else if (compact) CompactStandby(snapshot, now, offline)
        else Standby(if (offline) snapshot.copy(playUrl = null) else snapshot, landscape, now, lobby)
        val cue = screen.cue
        var visibleCue by remember { mutableStateOf<ScoreEvent?>(null) }
        LaunchedEffect(cue?.id, offline) { visibleCue = if (offline) null else cue; if (visibleCue != null) { delay(1_800); visibleCue = null } }
        val reduced = Settings.Global.getFloat(LocalContext.current.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        if (visibleCue != null && !warning) Box(Modifier.fillMaxSize().background(Ink.copy(alpha = .94f)), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) { Headline(if (visibleCue!!.checkout) "HOGE FINISH" else "MAXIMUM", if (reduced) 44 else 56); Text("${visibleCue!!.score}", fontFamily = Barlow, fontSize = 100.sp, color = Lime); Text(visibleCue!!.player, color = OcheText) }
        }
        if (warning) {
            val remaining = secondsRemaining(activity!!.deadlineAt, serverTime)
            Box(Modifier.fillMaxSize().background(Ink.copy(alpha = .94f)), contentAlignment = Alignment.Center) {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Headline(if (remaining == 0) "BAAN WORDT VRIJGEGEVEN" else "SPELEN JULLIE NOG DOOR?", if (compact) 28 else if (landscape) 48 else 36)
                    Text(formatClock(remaining), fontFamily = Barlow, fontSize = if (compact) 56.sp else if (landscape) 88.sp else 72.sp, color = Lime)
                    Text(if (remaining == 0 && offline) "Wacht op de actuele serverstatus." else "De baan wordt vrijgegeven als de aftelling afloopt.", color = Muted, textAlign = TextAlign.Center)
                    Text("Tik op Doorspelen op je telefoon", color = Lime, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    Text("Verlengingen over ${maxOf(0, 2 - activity.extensionsUsed)}", color = Muted)
                }
            }
        }
    }
}
@Composable private fun CompactStandby(snapshot: DisplaySnapshot, now: Long, offline: Boolean) {
    var started by remember(snapshot.boardName, snapshot.state) { mutableLongStateOf(now) }
    val free = snapshot.publicStandby && !offline
    val slide = if (free) standbySlide(now - started) else -1
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
        if (free) {
            if (slide == 0) OcheBrand(true, Modifier.size(100.dp))
            Headline(if (slide == 2) "Zo speel je" else "Klaar om te spelen", 30)
            Text(if (slide == 2) "Scan de QR naast de baannaam.\nMaak een partij aan en start op je telefoon." else "Begin een oefenpartij of speel samen.\nScan de QR van deze baan.", color = Muted, textAlign = TextAlign.Center, fontSize = 16.sp)
        } else {
            Headline(when (snapshot.state) { "closed" -> "Baan gesloten"; "blocked" -> "Baan niet beschikbaar"; "reserved" -> "Baan gereserveerd"; "unassigned" -> "Nog geen baan toegewezen"; "waiting" -> "Wacht op start"; else -> "Wacht op de volgende partij" }, 28)
            Text(if (offline) "Vorige stand · scanstatus wordt gecontroleerd." else if (snapshot.canScan && snapshot.state == "waiting") "Scan de QR in de middenstrook om aan te sluiten. Volg de start op je telefoon." else snapshot.reservation ?: "Volg de instructies op je telefoon.", color = Muted, textAlign = TextAlign.Center)
        }
    }
}
@Composable private fun Standby(snapshot: DisplaySnapshot, landscape: Boolean, now: Long, lobby: CompetitionLobby? = null) {
    var started by remember { mutableLongStateOf(now) }
    LaunchedEffect(snapshot.state, snapshot.boardName) { started = SystemClock.elapsedRealtime() }
    val free = snapshot.publicStandby
    val slide = if (free) standbySlide(now - started) else -1
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
        if (lobby != null) {
            CompetitionLobbyView(lobby, snapshot.playUrl.takeIf { snapshot.canScan }, landscape)
        } else if (slide == 0) {
            OcheBrand(true, Modifier.size(if (landscape) 190.dp else 170.dp))
            OcheBrand(false, Modifier.fillMaxWidth(.8f).height(110.dp))
        } else if (free || snapshot.canScan || snapshot.state == "reserved") {
            val title = if (snapshot.state == "reserved") "BAAN GERESERVEERD" else if (snapshot.state == "waiting") "SCAN EN SLUIT AAN" else if (slide == 2) "ZO SPEEL JE." else "SCAN EN SPEEL."
            if (landscape) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                if (snapshot.canScan) snapshot.playUrl?.let { Qr(it, Modifier.weight(.8f).aspectRatio(1f).sizeIn(maxWidth = 380.dp, maxHeight = 380.dp)) }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) { Headline(title, 56); StandbyText(slide, snapshot) }
            } else {
                Headline(title, 40)
                if (snapshot.canScan) snapshot.playUrl?.let { Qr(it, Modifier.weight(1f, false).aspectRatio(1f).sizeIn(maxWidth = if (slide == 2) 240.dp else 330.dp, maxHeight = if (slide == 2) 240.dp else 330.dp)) }
                StandbyText(slide, snapshot)
            }
        } else {
            Headline(when (snapshot.state) { "closed" -> "BAAN GESLOTEN"; "blocked" -> "BAAN NIET BESCHIKBAAR"; "unassigned" -> "SCHERM GEKOPPELD"; else -> "KLAAR OM TE SPELEN" })
            Text(if (snapshot.state == "unassigned") "Kies in DartFlow → Schermen een baan voor dit scherm." else "${snapshot.displayName} · Wacht op de volgende partij.", color = Muted, fontSize = 18.sp, textAlign = TextAlign.Center)
        }
        if (free && lobby == null) Text("0${slide + 1} / 03", color = Muted, fontSize = 12.sp)
    }
}
@Composable internal fun CompetitionLobbyView(lobby: CompetitionLobby, playUrl: String?, landscape: Boolean) {
    val text: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(if (landscape) 6.dp else 12.dp)) {
            Headline("COMPETITIELOBBY", if (landscape) 26 else 30)
            Text("${lobby.competitionName} · ronde ${lobby.round}", color = OcheText, fontSize = 16.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
            lobby.players.forEach { (name, confirmed) -> Text("$name · ${if (confirmed) "bevestigd" else "wacht op deelname"}", color = if (confirmed) Lime else OcheText, fontSize = if (landscape) 16.sp else 18.sp, maxLines = if (landscape) 1 else 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center) }
            Text("Schrijver: ${lobby.writerName}", color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Geplande tegenstander: scan dezelfde baan-QR met je eigen account, of bevestig met je eigen pincode op het gedeelde toestel.", color = Muted, fontSize = 13.sp, textAlign = TextAlign.Center)
        }
    }
    if (landscape) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) { Box(Modifier.weight(1f)) { text() }; playUrl?.let { Qr(it, Modifier.size(140.dp)) } }
    else Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) { text(); playUrl?.let { Qr(it, Modifier.size(150.dp)) } }
}
@Composable private fun StandbyText(slide: Int, snapshot: DisplaySnapshot) {
    if (snapshot.state == "reserved") Text(snapshot.reservation ?: "Alleen de gereserveerde spelers kunnen aansluiten.", color = Muted, textAlign = TextAlign.Center)
    else if (snapshot.state == "waiting") Text("Scan de QR om aan te sluiten. Volg de start op je telefoon.", color = Muted, textAlign = TextAlign.Center)
    else if (slide == 2) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf("Scan de QR-code.", "Maak een (oefen)wedstrijd aan.", "Laat spelers de QR-code scannen of speel op afstand.", "Start de wedstrijd.").forEachIndexed { i, text -> Text("${i + 1}  $text", color = OcheText, fontSize = 16.sp, modifier = Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp)).padding(10.dp)) }
    } else Text("Begin een oefenpartij, speel samen op locatie of nodig iemand online uit.\nOpen deze baan met je telefoon.", color = Muted, fontSize = 18.sp, textAlign = TextAlign.Center)
}

@Composable internal fun LiveView(match: Match, landscape: Boolean, result: Boolean, compact: Boolean = false) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val small = maxHeight < 560.dp || compact
        val shortCompact = maxHeight < 320.dp
        val rowHeight = if (small) 21.dp else 34.dp
        if (compact) Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${match.startLabel} · ${match.rulesLabel}", color = Muted, fontSize = 11.sp, lineHeight = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            CompactPlayers(match, if (shortCompact) 48 else 72)
            Scorecard(match, if (shortCompact) 17.dp else 24.dp, Modifier.weight(1f))
            LastVisit(match, true)
        } else if (landscape) Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (small) 10.dp else 16.dp)) {
                MatchHeading(match, result, small)
                Players(match, if (small) 54 else 90, small)
                LastVisit(match, small)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) { Scorecard(match, rowHeight, Modifier.weight(1f)); Text("SET ${match.set} · LEG ${match.leg}", color = Muted) }
        } else Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(if (small) 6.dp else 18.dp)) {
            MatchHeading(match, result, small)
            if (small) PortraitPlayers(match) else Players(match, 80)
            Scorecard(match, rowHeight, Modifier.weight(1f))
            LastVisit(match, small)
        }
    }
}
@Composable private fun CompactPlayers(match: Match, scoreSize: Int) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        match.players.forEachIndexed { index, player ->
            val active = match.canShowTurn && index == match.turn
            Column(Modifier.weight(1f).background(Panel, RoundedCornerShape(8.dp)).border(1.dp, if (active) Lime else Outline, RoundedCornerShape(8.dp)).padding(5.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(player.name, color = OcheText, fontWeight = FontWeight.Bold, fontSize = 15.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${match.cricket?.points?.getOrNull(index) ?: player.remaining}", color = if (active) Lime else OcheText, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = scoreSize.sp, lineHeight = scoreSize.sp, maxLines = 1, style = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum"))
                Text(if (active) match.currentThrowerName?.let { "Werpt: $it" } ?: "AAN DE BEURT" else if (!match.canShowTurn) match.statusLabel else "Wacht", color = if (active) Lime else Muted, fontSize = 9.sp, lineHeight = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Legs ${player.legs} · Sets ${player.sets}" + (player.average?.let { " · AVG ${String.format(Locale.ROOT, "%.1f", it)}" } ?: ""), color = Muted, fontSize = 9.sp, lineHeight = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
/** Keep the actual scores, all statistics and active thrower within a bounded portrait band.
 * The scorecard's fixed header and true starting scores need at least 68 dp below it. */
@Composable private fun PortraitPlayers(match: Match) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        match.players.forEachIndexed { index, player ->
            val active = match.canShowTurn && index == match.turn
            Column(Modifier.weight(1f).background(Panel, RoundedCornerShape(8.dp)).border(1.dp, if (active) Lime else Outline, RoundedCornerShape(8.dp)).padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(player.name, modifier = Modifier.semantics { contentDescription = (listOf(player.name) + player.partners).distinct().joinToString(" · ") }, color = OcheText, fontWeight = FontWeight.Bold, fontSize = 15.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${match.cricket?.points?.getOrNull(index) ?: player.remaining}", color = if (active) Lime else OcheText, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 32.sp, lineHeight = 34.sp, maxLines = 1, style = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum"))
                Text(if (active) match.currentThrowerName?.let { "WERPT: $it" } ?: "AAN DE BEURT" else if (!match.canShowTurn) match.statusLabel.uppercase(Locale.ROOT) else "WACHT", color = if (active) Lime else Muted, fontSize = 9.sp, lineHeight = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val average = player.average?.let { String.format(Locale.forLanguageTag("nl"), "%.1f", it) } ?: "–"
                Text(if (match.cricket != null) "MPR ${match.cricket.mpr.getOrNull(index)?.let { String.format(Locale.forLanguageTag("nl"), "%.1f", it) } ?: "–"}" else "AVG $average · FIN ${if (player.highestFinish > 0) player.highestFinish else "–"} · 180 ${player.maxima}", color = Muted, fontSize = 9.sp, lineHeight = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
@Composable private fun MatchHeading(match: Match, result: Boolean, compact: Boolean = false) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("${match.startLabel}${if (result) " EINDSTAND" else ""}", fontFamily = Barlow, fontSize = if (compact) 24.sp else 29.sp, lineHeight = if (compact) 26.sp else 31.sp, color = OcheText, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(match.rulesLabel + match.winByTwoLabel, color = Muted, fontSize = 12.sp, lineHeight = if (compact) 16.sp else 24.sp, maxLines = if (compact) 3 else 2)
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
                    Text(initials(player.name), color = if (active) Lime else OcheText, fontFamily = Barlow, fontSize = if (compact) 16.sp else 24.sp, lineHeight = if (compact) 20.sp else 24.sp, modifier = Modifier.background(if (active) Lime.copy(alpha = .16f) else Outline, RoundedCornerShape(6.dp)).padding(if (compact) 2.dp else 7.dp))
                    Text(player.name, modifier = Modifier.semantics { contentDescription = (listOf(player.name) + player.partners).distinct().joinToString(" · ") }, color = OcheText, fontSize = 17.sp, lineHeight = if (compact) 20.sp else 24.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Column(Modifier.fillMaxWidth().background(if (active) Lime.copy(alpha = .12f) else Panel, RoundedCornerShape(8.dp)).border(1.dp, if (active) Lime else Outline, RoundedCornerShape(8.dp)).padding(vertical = if (compact) 2.dp else 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (match.cricket != null) "PUNTEN" else "RESTEREND", color = Muted, fontSize = if (compact) 9.sp else 10.sp, lineHeight = if (compact) 12.sp else 24.sp, letterSpacing = 1.sp)
                    Text("${match.cricket?.points?.getOrNull(index) ?: player.remaining}", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = size.sp, lineHeight = (size + 4).sp, color = if (active) Lime else OcheText, maxLines = 1, style = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum"))
                    Text(if (active) match.currentThrowerName?.let { "WERPT: $it" } ?: "AAN DE BEURT" else if (!match.canShowTurn) match.statusLabel.uppercase(Locale.ROOT) else "WACHT", color = if (active) Lime else Muted, fontSize = if (compact) 9.sp else 10.sp, lineHeight = if (compact) 12.sp else 24.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Row(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp)).padding(if (compact) 2.dp else 6.dp), horizontalArrangement = Arrangement.SpaceAround) {
                    if (compact) {
                        val average = player.average?.let { String.format(Locale.forLanguageTag("nl"), "%.1f", it) } ?: "–"
                        val summary = if (match.cricket != null) "MPR ${match.cricket.mpr.getOrNull(index)?.let { String.format(Locale.forLanguageTag("nl"), "%.1f", it) } ?: "–"}" else "AVG $average · FIN ${if (player.highestFinish > 0) player.highestFinish else "–"} · 180 ${player.maxima}"
                        Text(summary, color = OcheText, fontSize = 9.sp, lineHeight = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    } else if (match.cricket != null) Metric(match.cricket.mpr.getOrNull(index)?.let { String.format(Locale.forLanguageTag("nl"), "%.1f", it) } ?: "–", "MPR", compact) else {
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
@Composable private fun Metric(value: String, title: String, compact: Boolean = false) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(value, fontFamily = Barlow, fontSize = if (compact) 18.sp else 22.sp, color = OcheText); Text(title, fontSize = if (compact) 9.sp else 10.sp, color = Muted) } }
private fun ocheMarks(value: Int, required: Int) = if (required == 3) cricketMark(value) else if (value >= required) "✓" else "$value/$required"
private fun cricketMark(value: Int) = when (value.coerceIn(0,3)) { 0 -> "–"; 1 -> "/"; 2 -> "X"; else -> "⊗" }
@Composable private fun Scorecard(match: Match, rowHeight: Dp, modifier: Modifier) {
    match.cricket?.let { cricket ->
        val compact = rowHeight <= 20.dp
        Column(modifier.fillMaxWidth().border(1.dp, Outline, RoundedCornerShape(10.dp)).padding(if (compact) 5.dp else 10.dp), verticalArrangement = Arrangement.SpaceEvenly) {
            Text(if (cricket.requiredMarks == 3) "MARKS · / één · X twee · ⊗ gesloten" else "MARKS · ${cricket.requiredMarks} treffers sluit een doel", color = Muted, fontSize = if (compact) 9.sp else 12.sp, lineHeight = if (compact) 12.sp else 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            cricket.targets.forEachIndexed { index, target ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                    Text(ocheMarks(cricket.marks.getOrNull(0)?.getOrNull(index) ?: 0, cricket.requiredMarks), color = Lime, fontSize = if (compact) 14.sp else 24.sp, lineHeight = if (compact) 16.sp else 28.sp)
                    Text(if (target == 25) "BULL" else "$target", color = OcheText, fontSize = if (compact) 12.sp else 20.sp, lineHeight = if (compact) 16.sp else 28.sp)
                    if (match.players.size > 1) Text(ocheMarks(cricket.marks.getOrNull(1)?.getOrNull(index) ?: 0, cricket.requiredMarks), color = Lime, fontSize = if (compact) 14.sp else 24.sp, lineHeight = if (compact) 16.sp else 28.sp)
                }
            }
        }
        return
    }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val reducedMotion = Settings.Global.getFloat(LocalContext.current.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    val rows = match.rows()
    var priorCount by remember(match.legKey) { mutableIntStateOf(match.visits.size) }
    LaunchedEffect(match.legKey) { list.scrollToItem(maxOf(0, rows.size - 5)) }
    LaunchedEffect(match.revision) {
        val undo = match.events.lastOrNull()?.kind == "undo"
        if (!undo && match.visits.size > priorCount && rows.size > 5) {
            if (reducedMotion) list.scrollToItem(rows.size - 5) else list.animateScrollToItem(rows.size - 5)
        }
        priorCount = match.visits.size
    }
    Column(modifier.fillMaxWidth().border(1.dp, Outline, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp))) {
        Row(Modifier.fillMaxWidth().background(Panel).padding(10.dp, 5.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("SCOREKAART", color = OcheText, fontSize = 12.sp, lineHeight = if (rowHeight <= 22.dp) 16.sp else 24.sp, fontWeight = FontWeight.Bold)
            if (rows.size > 5 && list.canScrollForward) TextButton(onClick = { scope.launch { if (reducedMotion) list.scrollToItem(rows.size - 5) else list.animateScrollToItem(rows.size - 5) } }, contentPadding = PaddingValues(0.dp), modifier = Modifier.height(28.dp)) { Text("Terug naar live", color = Lime, fontSize = 11.sp) }
            else Text("SET ${match.set} · LEG ${match.leg}", color = Muted, fontSize = 11.sp, lineHeight = if (rowHeight <= 22.dp) 16.sp else 24.sp)
        }
        CardRow(if (match.players.size == 1) listOf("WORP", "REST") else listOf("WORP", "REST", "REST", "WORP"), rowHeight, true)
        CardRow(match.startRow, rowHeight)
        LazyColumn(state = list, modifier = Modifier.heightIn(max = rowHeight * 5).fillMaxWidth().onPreviewKeyEvent { event ->
                val direction = when (event.key) { Key.DirectionDown -> 1; Key.DirectionUp -> -1; else -> 0 }
                if (event.type == KeyEventType.KeyDown && direction != 0) {
                    val target = (list.firstVisibleItemIndex + direction).coerceIn(0, maxOf(0, rows.size - 5))
                    if (target != list.firstVisibleItemIndex || list.firstVisibleItemScrollOffset > 0) { scope.launch { if (reducedMotion) list.scrollToItem(target) else list.animateScrollToItem(target) }; true } else false
                } else false
            }.focusable(false)) {
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
            Box(Modifier.weight(1f).fillMaxHeight().background(if (index in highlights) Lime.copy(alpha = .23f) else Color.Transparent).border(.5.dp, Outline), contentAlignment = Alignment.Center) { Text(value, color = if (index in highlights) Lime else OcheText, fontFamily = if (heading) DmSans else Barlow, fontWeight = if (heading) FontWeight.Bold else FontWeight.ExtraBold, fontSize = if (heading) 11.sp else if (height <= 22.dp) 20.sp else 23.sp, lineHeight = if (heading) 14.sp else if (height <= 22.dp) 20.sp else 26.sp, maxLines = 1, style = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum")) }
        }
    }
}
@Composable private fun LastVisit(match: Match, compact: Boolean = false) {
    val last = match.visits.lastOrNull()
    val label = when { match.bullPending -> "BULL · GEEN SCORE"; match.finished -> match.statusLabel.uppercase(Locale.ROOT); !match.canShowTurn -> match.statusLabel.uppercase(Locale.ROOT); match.checkout != null -> "FINISHROUTE"; else -> "LAATSTE BEURT" }
    val value = when {
        match.bullPending -> match.bullLabel ?: "Volg bullen op de telefoon"
        match.finished -> match.winnerName?.let { "Winnaar: $it" } ?: "Bekijk de uitslag op je telefoon"
        !match.canShowTurn -> match.startDecision?.starter?.let { "Beginner: ${match.players.getOrNull(it)?.name ?: "Speler"}" } ?: "Volg de instructies op je telefoon"
        match.checkout != null -> match.checkout
        else -> last?.let { "${match.players.getOrNull(it.player)?.name ?: ""} · ${if (it.bust) "Bust" else if (match.cricket != null) "${it.creditedMarks ?: 0} marks · ${it.score} punten" else "${it.score} punten"}" } ?: "Nog geen worp"
    }
    Row(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp)).border(1.dp, Outline, RoundedCornerShape(8.dp)).padding(if (compact) 6.dp else 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Lime, fontSize = if (compact) 9.sp else 11.sp, lineHeight = if (compact) 12.sp else 24.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text(value, color = OcheText, fontFamily = Barlow, fontSize = if (compact) 16.sp else 18.sp, lineHeight = if (compact) 18.sp else 24.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1.5f), maxLines = if (compact) 1 else 2, overflow = TextOverflow.Ellipsis)
    }
}
fun formatClock(seconds: Int): String = "%02d:%02d".format(Locale.ROOT, seconds / 60, seconds % 60)
fun initials(name: String): String = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.let { if (it.size > 1) it.take(2).joinToString("") { word -> word.take(1) } else it.firstOrNull()?.take(2) ?: "" }.uppercase(Locale.ROOT)
