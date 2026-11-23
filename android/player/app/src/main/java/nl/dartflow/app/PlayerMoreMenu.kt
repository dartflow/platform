@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package nl.dartflow.app

import androidx.compose.animation.core.animate
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.math.roundToInt

/** The list owns its fling. The handle owns sheet dragging, so the sheet cannot
 * consume a released list gesture to settle its own almost-expanded anchor. */
@Composable internal fun PlayerMoreMenu(state: PlayerUiState, actions: PlayerActions, close: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var dragged by remember { mutableFloatStateOf(0f) }
    var settling by remember { mutableStateOf<Job?>(null) }
    val distance = with(LocalDensity.current) { 48.dp.toPx() }
    val velocityThreshold = with(LocalDensity.current) { 800.dp.toPx() }
    val dismiss = { scope.launch { sheet.hide(); close() }; Unit }
    val drag = rememberDraggableState { delta ->
        settling?.cancel()
        dragged = (dragged + delta).coerceIn(0f, distance * 6)
    }
    ModalBottomSheet(
        onDismissRequest = close, sheetState = sheet, sheetGesturesEnabled = false,
        modifier = Modifier.offset { IntOffset(0, dragged.roundToInt()) },
        containerColor = PlayerPanel,
        dragHandle = {
            Box(Modifier.fillMaxWidth().height(48.dp)
                .semantics { contentDescription = "Menu sluiten" }
                .clickable(role = Role.Button, onClick = dismiss)
                .draggable(drag, Orientation.Vertical, onDragStopped = { velocity ->
                    if (dragged >= distance || velocity > velocityThreshold) dismiss()
                    else settling = scope.launch { animate(dragged, 0f) { value, _ -> dragged = value } }
                }), contentAlignment = androidx.compose.ui.Alignment.Center) {
                BottomSheetDefaults.DragHandle()
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().testTag("more-menu-scroll")
            .verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Heading("Jouw DartFlow", "MEER")
                Spacer(Modifier.weight(1f))
                TextButton(onClick = dismiss, modifier = Modifier.heightIn(min = 48.dp).testTag("more-close")) { Text("Sluiten") }
            }
            Text(state.profile?.displayName.orEmpty(), style = MaterialTheme.typography.titleMedium)
            Action("Profiel & instellingen", primary = false, modifier = Modifier.fillMaxWidth()) { close(); actions.navigate(PlayerScreen.PROFILE, null) }
            state.clubhouseContext?.let { club ->
                Text("ACTIEVE VERENIGING", Modifier.padding(top = 10.dp, start = 12.dp), color = PlayerMuted, fontSize = 10.sp)
                state.clubhousePages.forEach { page -> playerClubPages[page]?.let { label -> TextButton(onClick = { close(); actions.navigate(PlayerScreen.CLUBHOUSE, playerClubId(club, page)) }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(label, Modifier.weight(1f), color = PlayerText, textAlign = TextAlign.Start); PlayerIcon(PlayerNavIcon.FORWARD) } } }
            }
            listOf(
                "Spelen & voortgang" to listOf(PlayerScreen.BOARDS to "Banen & favorieten", PlayerScreen.LOCATIONS to "Mijn locaties & reserveringen", PlayerScreen.PRACTICE to "Oefenen", PlayerScreen.CHALLENGES to "Uitdagingen", PlayerScreen.PLAY_HISTORY to "Vrije partijen & traininghistorie", PlayerScreen.TRAINING to "Bestaande trainingen", PlayerScreen.HISTORY to "Wedstrijdhistorie", PlayerScreen.STATISTICS to "Statistieken"),
                "Community & evenementen" to listOf(PlayerScreen.RANKINGS to "Rankings", PlayerScreen.FEED to "Mijn feed", PlayerScreen.CLUBS to "Verenigingen", PlayerScreen.FRIENDS to "Vrienden & spelerskamers", PlayerScreen.ORGANIZE to "Toernooi organiseren"),
                "Schermbeheer" to listOf(PlayerScreen.SCREENS to "Oche Live-schermen"),
                "Jouw account" to listOf(PlayerScreen.NOTIFICATIONS to "Meldingen", PlayerScreen.HELP to "Help & FAQ", PlayerScreen.SUPPORT to "Mijn supporttickets", PlayerScreen.RELEASES to "Wat is nieuw?"),
            ).plus(if (state.canManagePlatform) listOf("Platformbeheer" to listOf(PlayerScreen.SUPPORT_ADMIN to "Supportbeheer", PlayerScreen.RELEASE_ADMIN to "Releasebeheer", PlayerScreen.NOTIFICATION_ADMIN to "Meldingsbeheer")) else emptyList()).forEach { (group, entries) ->
                var open by rememberSaveable(group) { mutableStateOf(entries.any { it.first == state.screen }) }
                TextButton(onClick = { open = !open }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("more-group-$group")) {
                    Text(group, Modifier.weight(1f), color = PlayerText, textAlign = TextAlign.Start)
                    Text(if (open) "−" else "+", color = PlayerMuted)
                }
                if (open) entries.forEach { (route, label) -> TextButton(onClick = { close(); actions.navigate(route, null) }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(label, Modifier.weight(1f), color = if (state.screen == route) PlayerLime else PlayerText, textAlign = TextAlign.Start)
                    PlayerIcon(PlayerNavIcon.FORWARD, modifier = Modifier.size(16.dp))
                } }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}
