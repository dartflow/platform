package nl.dartflow.app

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.time.Instant

/** Featured cards alone use photography. The bundled image never makes a network request. */
@Composable internal fun PlayerPhotoCard(venue: Boolean = false, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))) {
        Image(painterResource(if (venue) R.drawable.marketing_venue else R.drawable.marketing_hero), null,
            Modifier.matchParentSize(), contentScale = ContentScale.Crop, alignment = Alignment.CenterEnd)
        Box(Modifier.matchParentSize().background(Brush.horizontalGradient(listOf(Color(0xF2101411), Color(0x99101411)))))
        CompositionLocalProvider(LocalContentColor provides Color(0xFFF2F5EF)) {
            Column(Modifier.fillMaxWidth().heightIn(min = 146.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
        }
    }
}

@Composable internal fun PlayerSection(title: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@Composable internal fun PlayerWorkspaceTabs(selected: String, entries: List<Pair<String, String>>, select: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).selectableGroup(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        entries.forEach { (id, label) ->
            Column(Modifier.width(IntrinsicSize.Max).selectable(selected == id, role = Role.Tab) { select(id) }) {
                Box(Modifier.heightIn(min = 48.dp).padding(horizontal = 2.dp), contentAlignment = Alignment.Center) {
                    Text(label, color = if (selected == id) PlayerText else PlayerMuted, style = MaterialTheme.typography.labelLarge)
                }
                Box(Modifier.fillMaxWidth().height(2.dp).background(if (selected == id) PlayerLime else Color.Transparent))
            }
        }
    }
}

/** One compact disclosure retains the fields' SaveableState while it is closed. */
@Composable internal fun PlayerConfiguration(title: String = "Configuratie", initiallyOpen: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    var open by rememberSaveable { mutableStateOf(initiallyOpen) }
    val fields = rememberSaveableStateHolder()
    PlayerCard {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("configuration-toggle-$title")
            .clickable(role = Role.Button, onClickLabel = if (open) "Configuratie sluiten" else "Configuratie openen") { open = !open },
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text(title, style = MaterialTheme.typography.titleMedium); Text(if (open) "Sluit uitgebreide instellingen" else "Spelregels, spelers en bediening", color = PlayerMuted, style = MaterialTheme.typography.bodySmall) }
            Text(if (open) "−" else "+", color = PlayerLime, style = MaterialTheme.typography.titleLarge)
        }
        if (open) fields.SaveableStateProvider("fields") { Column(verticalArrangement = Arrangement.spacedBy(8.dp), content = content) }
    }
}

/** Selection changes presentation only; every mutation still uses the ordinary coordinator. */
internal fun playerSolo501Action(profile: PlayerProfile): JSONObject = json("type" to "session.create", "deviceMode" to "shared",
    "players" to org.json.JSONArray(listOf(json("name" to profile.displayName.ifBlank { profile.name }, "accountId" to profile.id))),
    "rules" to playerPlayDefaultRules("x01", 501), "starter" to 0)
internal fun playerLocal501Action(): JSONObject = playerWithSettings(json("type" to "lobby.create", "name" to "Lokaal 501", "setup" to "localone", "startScore" to 501, "bestOfLegs" to 3), json("inRule" to "single", "outRule" to "double"))
internal fun playerBot501Action(): JSONObject = playerWithSettings(json("type" to "training.create", "mode" to "bot", "startScore" to 501, "bestOfLegs" to 3, "botAverage" to 45), json("inRule" to "single", "outRule" to "double", "bestOfLegs" to 3))

internal fun playerHomeFeatured(experience: JSONObject, matches: List<JSONObject>, freeSessions: List<JSONObject> = emptyList()): JSONObject? {
    val core = experience.rows("resume").sortedBy { item ->
        val status = item.text("status").ifBlank { matches.find { it.text("id") == item.text("id") }?.text("status").orEmpty() }
        when { status == "live" || item.text("actionLabel") == "Hervat je partij" -> 0; status == "result" || item.text("actionLabel") == "Bevestig de uitslag" -> 1; else -> 2 }
    }
    val live = core.firstOrNull { item -> item.text("status", matches.find { it.text("id") == item.text("id") }?.text("status").orEmpty()) == "live" || item.text("actionLabel") == "Hervat je partij" }
    if (live != null) return live
    val free = freeSessions.map(::PlayerPlaySession).firstOrNull { it.supported && !it.complete && it.raw.text("status") == "active" && it.game.text("status") == "live" }
    if (free != null) {
        val mode = free.rules.text("mode")
        val scores = free.sides.indices.map { side -> when (mode) {
            "cricket", "tactics" -> free.progress.optJSONArray("points")?.optInt(side) ?: 0
            "around" -> free.progress.optJSONArray("targets").ints().getOrNull(free.progress.optJSONArray("targetIndex")?.optInt(side) ?: 0) ?: 0
            "bingo" -> free.progress.optJSONArray("filled")?.optJSONArray(side)?.let { row -> (0 until row.length()).count { row.optBoolean(it) } } ?: 0
            "x01" -> free.progress.optJSONArray("remaining")?.optInt(side) ?: free.rules.optInt("startScore")
            else -> free.progress.optInt("remaining", free.rules.optInt("target"))
        } }
        return json("id" to free.id, "status" to "live", "source" to "free", "players" to org.json.JSONArray(free.sides.indices.map(free::sideName)), "remaining" to org.json.JSONArray(scores), "actionLabel" to "Hervat je partij", "href" to "/spelen/${free.id}")
    }
    return core.firstOrNull()
}
internal fun playerUpcomingActivities(rows: List<JSONObject>, now: Instant = Instant.now()): List<JSONObject> = rows
    .filter { it.text("status") !in listOf("canceled", "cancelled") && runCatching { Instant.parse(it.text("startsAt")).isAfter(now) }.getOrDefault(false) }
    .sortedBy { Instant.parse(it.text("startsAt")) }.take(3)
internal fun playerEventPriority(item: JSONObject): Int {
    val body = item.obj("state")
    val fixtures = body.rows("fixtures")
    if (body.optBoolean("closed") || body.optBoolean("completed")) return 3
    if (fixtures.any { it.text("status") == "live" }) return 0
    if (fixtures.any { it.text("status") in listOf("scheduled", "proposed") }) return 1
    return when (item.text("status", body.text("status"))) {
        "live", "active", "running" -> 0; "registration", "scheduled", "planned", "published" -> 1; "completed", "closed", "archived", "canceled" -> 3; else -> 2
    }
}
