package nl.dartflow.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val PlayerLime = Color(0xFFB5F52B)
val PlayerInk = Color(0xFF101211)
val PlayerPanel = Color(0xFF18201D)
val PlayerMuted = Color(0xFFB3BDB7)
val PlayerText = Color(0xFFF2F5EF)
val PlayerBorder = Color(0xFF35443B)
val PlayerError = Color(0xFFFFADA4)
val PlayerBarlow = FontFamily(Font(R.font.barlow_condensed_800, FontWeight.ExtraBold))
val PlayerSans = FontFamily(Font(R.font.dm_sans_400), Font(R.font.dm_sans_700, FontWeight.Bold))

@Composable fun DartFlowPlayerTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(primary = PlayerLime, onPrimary = PlayerInk, background = PlayerInk,
            onBackground = PlayerText, surface = PlayerPanel, onSurface = PlayerText, surfaceVariant = PlayerPanel,
            onSurfaceVariant = PlayerMuted, outline = PlayerBorder, error = PlayerError),
        typography = Typography(
            displayLarge = TextStyle(fontFamily = PlayerBarlow, fontSize = 48.sp, lineHeight = 50.sp, fontWeight = FontWeight.ExtraBold),
            headlineLarge = TextStyle(fontFamily = PlayerBarlow, fontSize = 28.sp, lineHeight = 30.sp, fontWeight = FontWeight.ExtraBold),
            headlineMedium = TextStyle(fontFamily = PlayerBarlow, fontSize = 24.sp, lineHeight = 27.sp, fontWeight = FontWeight.ExtraBold),
            titleLarge = TextStyle(fontFamily = PlayerSans, fontSize = 18.sp, lineHeight = 23.sp, fontWeight = FontWeight.Bold),
            titleMedium = TextStyle(fontFamily = PlayerSans, fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Bold),
            bodyLarge = TextStyle(fontFamily = PlayerSans, fontSize = 14.sp, lineHeight = 20.sp),
            bodyMedium = TextStyle(fontFamily = PlayerSans, fontSize = 13.sp, lineHeight = 18.sp),
            labelLarge = TextStyle(fontFamily = PlayerSans, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold))) {
        // MaterialTheme alone does not provide LocalContentColor. Login, onboarding,
        // and the fullscreen console also need the dark surface's readable default.
        Surface(Modifier.fillMaxSize(), color = PlayerInk, contentColor = PlayerText, content = content)
    }
}

@Composable fun PlayerRings(modifier: Modifier = Modifier) = Canvas(modifier) {
    for (i in 1..7) drawCircle(PlayerLime.copy(alpha = .035f), size.minDimension * .18f * i,
        Offset(size.width * 1.05f, size.height * .2f), style = Stroke(1.5f))
}
