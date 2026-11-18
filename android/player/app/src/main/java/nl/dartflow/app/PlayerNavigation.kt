package nl.dartflow.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal enum class PlayerNavIcon { HOME, PLAY, EVENTS, FRIENDS, MORE, BELL, QR, FORWARD }

/** Keep a parent tab active while its detail route is open. */
internal fun playerNavigationSection(screen: PlayerScreen, activeId: String?): PlayerNavIcon = when (screen) {
    PlayerScreen.HOME, PlayerScreen.FEED -> PlayerNavIcon.HOME
    PlayerScreen.PLAY, PlayerScreen.BOARDS, PlayerScreen.BOARD, PlayerScreen.LOBBY, PlayerScreen.MATCH, PlayerScreen.TRAINING -> PlayerNavIcon.PLAY
    PlayerScreen.EVENTS, PlayerScreen.EVENT, PlayerScreen.SEASONS, PlayerScreen.SEASON -> PlayerNavIcon.EVENTS
    PlayerScreen.FRIENDS -> PlayerNavIcon.FRIENDS
    PlayerScreen.CHAT -> when (activeId?.substringBefore(':')) {
        "match" -> PlayerNavIcon.PLAY
        "club", "tournament", "league" -> PlayerNavIcon.EVENTS
        else -> PlayerNavIcon.FRIENDS
    }
    else -> PlayerNavIcon.MORE
}

/** One native stroke-based icon family; independent of device Unicode fonts. */
@Composable internal fun PlayerIcon(icon: PlayerNavIcon, color: Color = PlayerMuted, modifier: Modifier = Modifier.size(22.dp)) {
    Canvas(modifier) {
        scale(size.width / 24f, size.height / 24f, pivot = Offset.Zero) {
            val stroke = Stroke(width = 1.7f, cap = StrokeCap.Round)
            fun line(x1: Float, y1: Float, x2: Float, y2: Float) = drawLine(color, Offset(x1, y1), Offset(x2, y2), 1.7f, StrokeCap.Round)
            fun path(vararg points: Pair<Float, Float>, closed: Boolean = false) {
                val shape = Path().apply { points.forEachIndexed { index, point -> if (index == 0) moveTo(point.first, point.second) else lineTo(point.first, point.second) }; if (closed) close() }
                drawPath(shape, color, style = stroke)
            }
            when (icon) {
                PlayerNavIcon.HOME -> { path(3f to 10f, 12f to 3f, 21f to 10f); path(5f to 9f, 5f to 21f, 10f to 21f, 10f to 15f, 14f to 15f, 14f to 21f, 19f to 21f, 19f to 9f) }
                PlayerNavIcon.PLAY -> { listOf(9f, 5f).forEach { drawCircle(color, it, Offset(12f, 12f), style = stroke) }; drawCircle(color, 1.6f, Offset(12f, 12f)); line(16f, 8f, 22f, 2f) }
                PlayerNavIcon.EVENTS -> { drawRoundRect(color, Offset(3f, 5f), Size(18f, 16f), CornerRadius(2f), style = stroke); line(3f, 10f, 21f, 10f); line(8f, 3f, 8f, 7f); line(16f, 3f, 16f, 7f); listOf(8f to 14f, 13f to 14f, 8f to 18f, 13f to 18f).forEach { drawCircle(color, .8f, Offset(it.first, it.second)) } }
                PlayerNavIcon.FRIENDS -> { drawCircle(color, 3.2f, Offset(9f, 7f), style = stroke); drawCircle(color, 2.5f, Offset(17f, 9f), style = stroke); drawArc(color, 180f, 180f, false, Offset(2f, 13f), Size(14f, 13f), style = stroke); drawArc(color, 255f, 105f, false, Offset(13f, 15f), Size(9f, 10f), style = stroke) }
                PlayerNavIcon.MORE -> { line(4f, 6f, 20f, 6f); line(4f, 12f, 20f, 12f); line(4f, 18f, 20f, 18f) }
                PlayerNavIcon.BELL -> { path(5f to 17f, 7f to 14f, 7f to 9f); drawArc(color, 180f, 180f, false, Offset(7f, 4f), Size(10f, 10f), style = stroke); path(17f to 9f, 17f to 14f, 19f to 17f, 5f to 17f); drawArc(color, 0f, 180f, false, Offset(10f, 18f), Size(4f, 4f), style = stroke); line(12f, 2f, 12f, 4f) }
                PlayerNavIcon.QR -> { listOf(3f to 3f, 15f to 3f, 3f to 15f).forEach { drawRoundRect(color, Offset(it.first, it.second), Size(6f, 6f), CornerRadius(.5f), style = stroke) }; path(15f to 15f, 18f to 15f, 18f to 18f, 21f to 18f, 21f to 21f); line(15f, 19f, 15f, 21f); line(21f, 14f, 21f, 15f) }
                PlayerNavIcon.FORWARD -> path(9f to 5f, 16f to 12f, 9f to 19f)
            }
        }
    }
}

@Composable internal fun PlayerNavigationItem(label: String, icon: PlayerNavIcon, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val color = if (selected) PlayerLime else PlayerMuted
    Column(modifier.selectable(selected = selected, role = Role.Tab, onClick = onClick)
        .heightIn(min = 56.dp).padding(horizontal = 2.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Box(Modifier.width(38.dp).heightIn(min = 25.dp).background(if (selected) PlayerLime.copy(alpha = .1f) else Color.Transparent, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            PlayerIcon(icon, color)
        }
        Text(label, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center, color = color, fontFamily = PlayerSans, fontSize = 10.sp, lineHeight = 13.sp, maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
    }
}
