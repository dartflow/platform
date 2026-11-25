package nl.dartflow.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

internal val LocalPlayerTokens = androidx.compose.runtime.staticCompositionLocalOf { playerDefaultDark }
val PlayerLime: Color @Composable get() = playerThemeColor("primary")
val PlayerInk: Color @Composable get() = playerThemeColor("background")
val PlayerPanel: Color @Composable get() = playerThemeColor("surface")
val PlayerMuted: Color @Composable get() = playerThemeColor("muted")
val PlayerText: Color @Composable get() = playerThemeColor("text")
val PlayerBorder: Color @Composable get() = playerThemeColor("border")
val PlayerError: Color @Composable get() = playerThemeColor("error")
@Composable internal fun playerThemeColor(key: String): Color = Color(0xFF000000 or LocalPlayerTokens.current.getValue(key).removePrefix("#").toLong(16))
internal fun playerDefaultColor(key: String) = Color(0xFF000000 or playerDefaultDark.getValue(key).removePrefix("#").toLong(16))
val PlayerBarlow = FontFamily(Font(R.font.barlow_condensed_800, FontWeight.ExtraBold))
val PlayerSans = FontFamily(Font(R.font.dm_sans_400), Font(R.font.dm_sans_700, FontWeight.Bold))

@Composable fun DartFlowPlayerTheme(view: org.json.JSONObject? = null, serverTimeOffset: Long = 0, content: @Composable () -> Unit) {
    var now by androidx.compose.runtime.remember(view, serverTimeOffset) { androidx.compose.runtime.mutableLongStateOf(System.currentTimeMillis() + serverTimeOffset) }
    androidx.compose.runtime.LaunchedEffect(view, serverTimeOffset) {
        while (true) { now = System.currentTimeMillis() + serverTimeOffset; kotlinx.coroutines.delay(1000) }
    }
    val fresh = view?.let { playerBoundedTheme(it, now, null) }
    val dark = when (view?.obj("preference")?.text("colorMode")) { "light" -> false; "system" -> androidx.compose.foundation.isSystemInDarkTheme(); else -> true }
    val clubTokens = fresh?.takeIf { it.obj("effective").text("clubId").isNotBlank() }?.obj("effective")?.obj("tokens")?.optJSONObject(if (dark) "dark" else "light")
    val tokens = playerThemeTokens(clubTokens, dark)
    fun color(key: String) = Color(0xFF000000 or tokens.getValue(key).removePrefix("#").toLong(16))
    androidx.compose.runtime.CompositionLocalProvider(LocalPlayerTokens provides tokens) {
    val scheme = if (dark) darkColorScheme() else lightColorScheme()
    MaterialTheme(
        colorScheme = scheme.copy(primary = color("primary"), onPrimary = color("onPrimary"), secondary = color("secondary"), background = color("background"), onBackground = color("text"), surface = color("surface"), onSurface = color("text"), surfaceVariant = color("surfaceRaised"), onSurfaceVariant = color("muted"), outline = color("border"), error = color("error")),
        typography = Typography(
            displayLarge = TextStyle(fontFamily = PlayerBarlow, fontSize = 48.sp, lineHeight = 50.sp, fontWeight = FontWeight.ExtraBold),
            headlineLarge = TextStyle(fontFamily = PlayerBarlow, fontSize = 26.sp, lineHeight = 28.sp, fontWeight = FontWeight.ExtraBold),
            headlineMedium = TextStyle(fontFamily = PlayerBarlow, fontSize = 22.sp, lineHeight = 25.sp, fontWeight = FontWeight.ExtraBold),
            headlineSmall = TextStyle(fontFamily = PlayerBarlow, fontSize = 20.sp, lineHeight = 23.sp, fontWeight = FontWeight.ExtraBold),
            titleLarge = TextStyle(fontFamily = PlayerSans, fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Bold),
            titleMedium = TextStyle(fontFamily = PlayerSans, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold),
            titleSmall = TextStyle(fontFamily = PlayerSans, fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.Bold),
            bodyLarge = TextStyle(fontFamily = PlayerSans, fontSize = 13.sp, lineHeight = 19.sp),
            bodyMedium = TextStyle(fontFamily = PlayerSans, fontSize = 12.sp, lineHeight = 18.sp),
            bodySmall = TextStyle(fontFamily = PlayerSans, fontSize = 11.sp, lineHeight = 16.sp),
            labelLarge = TextStyle(fontFamily = PlayerSans, fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.Bold),
            labelMedium = TextStyle(fontFamily = PlayerSans, fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.Bold),
            labelSmall = TextStyle(fontFamily = PlayerSans, fontSize = 10.sp, lineHeight = 14.sp))) {
        // MaterialTheme alone does not provide LocalContentColor. Login, onboarding,
        // and the fullscreen console also need the dark surface's readable default.
        Surface(Modifier.fillMaxSize(), color = PlayerInk, contentColor = PlayerText, content = content)
    }
    }
}

@Composable fun PlayerRings(modifier: Modifier = Modifier) {
    val accent = PlayerLime
    Canvas(modifier) {
    for (i in 1..7) drawCircle(accent.copy(alpha = .035f), size.minDimension * .18f * i,
        Offset(size.width * 1.05f, size.height * .2f), style = Stroke(1.5f))
}
}
