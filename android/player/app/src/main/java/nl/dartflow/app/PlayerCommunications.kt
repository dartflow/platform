package nl.dartflow.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

internal val playerNotificationChannels = listOf("inbox" to "Inbox", "email" to "E-mail", "push" to "Push")
internal val playerNotificationModes = listOf("follow" to "Volgt gebruiker", "on" to "Geforceerd aan", "off" to "Geforceerd uit")
internal val playerReleaseProducts = listOf("dartflow" to "DartFlow", "oche-live" to "Oche Live")
internal val playerReleaseChannels = listOf("android" to "Android", "web" to "Website", "all" to "Alle kanalen")
internal fun playerNotificationDestination(result: JSONObject, origin: String): PlayerDestination = if (result.optBoolean("available")) PlayerLinks.destination(result.text("href"), origin) ?: PlayerDestination(PlayerScreen.NOTIFICATIONS) else PlayerDestination(PlayerScreen.NOTIFICATIONS)
/** A terminal opaque-link error must not prevent login/bootstrap from continuing.
 * Keep pending work on authentication/transport errors; never consume another login's link. */
internal suspend fun playerResolveNotificationOpen(request: suspend () -> JSONObject, isCurrent: () -> Boolean, clearPending: () -> Unit): JSONObject? {
    val result = try { request() } catch (failure: PlayerApiFailure) {
        if (failure.status !in listOf(403, 404, 410)) throw failure
        json("ok" to true, "available" to false, "message" to "Deze melding is niet meer beschikbaar voor dit account. Bekijk hieronder je actuele meldingen.")
    }
    if (!isCurrent()) return null
    clearPending()
    return result
}
internal val playerCommunicationPrivateScreens = setOf(PlayerScreen.SUPPORT, PlayerScreen.SUPPORT_TICKET, PlayerScreen.SUPPORT_ADMIN, PlayerScreen.SUPPORT_ADMIN_TICKET, PlayerScreen.NOTIFICATION_SETTINGS, PlayerScreen.NOTIFICATION_ADMIN, PlayerScreen.RELEASE_ADMIN, PlayerScreen.PLATFORM_MESSAGE)
internal fun playerNotificationDeliveryLabel(status: String): String = when (status) {
    "stored" -> "In inbox opgeslagen"; "opened" -> "Geopend"; "received" -> "Door de app ontvangen"
    "sent", "accepted" -> "Door verzenddienst geaccepteerd"; "queued", "planning" -> "In wachtrij"
    "leased" -> "Wordt verwerkt"; "retry" -> "Nieuwe bezorgpoging gepland"; "failed" -> "Mislukt"
    "suppressed" -> "Tegengehouden door kanaalkeuze"; "expired" -> "Verlopen"; "canceled", "ineligible" -> "Niet meer van toepassing"
    "paused" -> "Gepauzeerd"; else -> status
}
internal fun playerNotificationSettingLabel(setting: JSONObject): String = when (setting.text("mode")) {
    "on" -> "Geforceerd aan"; "off" -> "Geforceerd uit"; "mixed" -> "Verschilt per gebeurtenis"; else -> "Volgt jouw keuze"
}
internal fun playerCampaignDraft(kind: String, releaseId: String, title: String, body: String, all: Boolean, selected: Set<String>, href: String): JSONObject {
    require(kind in listOf("release", "platform"))
    require(title.isNotBlank() && title.length <= 80 && body.isNotBlank() && body.length <= 180 && (title + body).none { Character.isISOControl(it) }) { "Gebruik een titel tot 80 en een tekst tot 180 tekens, zonder regeleinden of besturingstekens." }
    require(all || selected.isNotEmpty()) { "Kies ten minste één ontvanger." }
    require(kind == "release" || href.isBlank() || href.startsWith("/app/") && !href.contains('\\') && href.none { it.code < 32 }) { "Gebruik een interne appbestemming." }
    return json("kind" to kind, "title" to title, "body" to body, "audience" to if (all) json("kind" to "all") else json("kind" to "selected", "userIds" to JSONArray(selected.sorted()))).also { if (kind == "release") { require(releaseId.isNotBlank()) { "Kies een gepubliceerde release." }; it.put("releaseId", releaseId) } else if (href.isNotBlank()) it.put("href", href) }
}
internal fun playerCanonicalJson(value: Any?): String = when (value) {
    is JSONObject -> value.keys().asSequence().sorted().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + playerCanonicalJson(value.opt(it)) }
    is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { playerCanonicalJson(value.opt(it)) }
    null, JSONObject.NULL -> "null"
    is String -> JSONObject.quote(value)
    else -> value.toString()
}
internal fun playerCampaignCanSend(preview: JSONObject, capturedDraft: JSONObject?, currentDraft: JSONObject?, confirmation: String, now: Long): Boolean = preview.text("id").isNotBlank() && capturedDraft != null && currentDraft != null && playerCanonicalJson(capturedDraft) == playerCanonicalJson(currentDraft) && confirmation == "VERSTUREN" && runCatching { Instant.parse(preview.text("expiresAt")).toEpochMilli() > now }.getOrDefault(false)

@Composable internal fun PlayerNotificationInbox(state: PlayerUiState, actions: PlayerActions) {
    Heading("Jouw meldingen", "INBOX", "${state.resource.optInt("unread")} ongelezen")
    Action("Meldingsinstellingen", primary = false) { actions.navigate(PlayerScreen.NOTIFICATION_SETTINGS, null) }
    PlayerGuestClaims(state, actions)
    val items = state.resource.rows("items")
    items.forEach { item -> PlayerCard(modifier = Modifier.testTag("notification-row-${item.text("id")}").clickable(enabled = !state.busy, role = Role.Button, onClickLabel = "Open melding") { actions.openNotification(item.text("id")) }) {
        Text(item.text("title", "Melding"), style = MaterialTheme.typography.titleMedium)
        Text("${if (item.optBoolean("opened")) "Gelezen" else "Ongelezen"} · ${item.text("category")} · ${shortDate(item.text("createdAt"))}", color = PlayerMuted)
        Text(item.text("body"))
        if (!item.optBoolean("available", true)) Text("Bestemming niet meer beschikbaar. Open voor de actuele uitleg.", color = PlayerMuted)
    } }
    if (items.isEmpty() && !state.loading) Text("Je bent helemaal bij.", color = PlayerMuted)
}

@Composable internal fun PlayerNotificationSettings(state: PlayerUiState, actions: PlayerActions) {
    Heading("Meldingen", "INSTELLINGEN", "Jouw accountkeuzes staan los van Android en dit toestel.")
    Action("Terug naar inbox", primary = false) { actions.navigate(PlayerScreen.NOTIFICATIONS, null) }
    state.resource.rows("categories").forEach { category -> PlayerCard(category.text("category")) {
        category.rows("channels").forEach { setting ->
            val applicable = setting.optBoolean("applicable")
            val personal = setting.optBoolean("personalEnabled", true)
            val mode = setting.text("mode", "follow")
            val change: (Boolean) -> Unit = { value -> actions.command("/notifications/actions", json("action" to json("type" to "preference.set", "category" to category.text("category"), "channel" to setting.text("channel"), "enabled" to value))) }
            val canChange = applicable && !state.busy && !state.hasPendingCommand && mode in listOf("follow", "mixed")
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(personal, enabled = canChange, role = Role.Switch, onValueChange = change), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text(playerNotificationChannels.find { it.first == setting.text("channel") }?.second ?: setting.text("channel")); Text(if (!applicable) "Niet van toepassing" else "${playerNotificationSettingLabel(setting)} · effectief ${if (setting.optBoolean("effectiveEnabled")) "aan" else "uit"}", color = PlayerMuted, style = MaterialTheme.typography.bodySmall) }
                Switch(checked = personal, enabled = canChange, onCheckedChange = null)
            }
            if (applicable && mode !in listOf("follow", "mixed")) Text("Jouw bewaarde keuze is ${if (personal) "aan" else "uit"}; deze blijft bewaard wanneer de beheerregel verandert.", color = PlayerMuted, style = MaterialTheme.typography.bodySmall)
            if (mode == "mixed") setting.rows("events").forEach { event -> Text("${event.text("eventId")}: ${playerNotificationSettingLabel(event)} · ${if (event.optBoolean("effectiveEnabled")) "aan" else "uit"}", style = MaterialTheme.typography.bodySmall, color = PlayerMuted) }
        }
    } }
    if (state.resource.rows("subscriptions").isNotEmpty()) PlayerCard("Productnieuws") {
        state.resource.rows("subscriptions").filter { it.text("channel") == "android" }.forEach { subscription ->
            PlayerToggle("${playerSupportLabel(subscription.text("product"), playerReleaseProducts)} · Android", subscription.optBoolean("enabled"), !state.busy && !state.hasPendingCommand) { value -> actions.command("/notifications/actions", json("action" to json("type" to "product.subscribe", "product" to subscription.text("product"), "channel" to "android", "enabled" to value))) }
        }
    }
    PlayerPushControls(state, actions)
}

@Composable internal fun PlayerReleaseList(state: PlayerUiState, actions: PlayerActions) {
    Heading("Wat is nieuw?", "DARTFLOW", "Gepubliceerde verbeteringen voor jouw app.")
    Action("Terug", primary = false, onClick = actions.back)
    Choice("Productnieuws", state.activeId ?: "dartflow", playerReleaseProducts, { actions.navigate(PlayerScreen.RELEASES, it) })
    if (state.canManagePlatform) Action("Releasebeheer", primary = false) { actions.navigate(PlayerScreen.RELEASE_ADMIN, null) }
    state.resource.rows("items").forEach { release -> PlayerCard(release.text("title")) {
        Text("${playerSupportLabel(release.text("product"), playerReleaseProducts)} ${release.text("version")} · ${playerSupportLabel(release.text("channel"), playerReleaseChannels)} · ${shortDate(release.text("publishedAt"))}", color = PlayerMuted)
        Action("Lees ${release.text("version")}", primary = false) { actions.navigate(PlayerScreen.RELEASE_DETAIL, release.text("id")) }
    } }
    if (!state.loading && state.resource.rows("items").isEmpty()) Text("Er zijn nog geen gepubliceerde releaseberichten voor deze app.", color = PlayerMuted)
}

@Composable internal fun PlayerReleaseDetail(state: PlayerUiState, actions: PlayerActions) {
    val release = state.resource.optJSONObject("release") ?: state.resource
    Heading(release.text("title", "Releasebericht"), "WAT IS NIEUW?")
    Action("Terug naar meldingen of releases", primary = false, onClick = actions.back)
    if (release.text("id").isBlank() || release.text("status") != "published") { if (!state.loading) Notice("Dit releasebericht is niet beschikbaar voor jouw app.", true); return }
    Text("${playerSupportLabel(release.text("product"), playerReleaseProducts)} ${release.text("version")} · ${shortDate(release.text("publishedAt"))}", color = PlayerMuted)
    PlayerCard { Text(release.text("body")) }
}

@Composable internal fun PlayerReleaseAdministration(state: PlayerUiState, actions: PlayerActions) {
    val data = state.resource
    Heading("Releasebeheer", "PLATFORMBEHEER")
    Action("Terug", primary = false, onClick = actions.back)
    if (!data.optBoolean("canManage")) { if (!state.loading) Notice("Geen actueel recht voor releasebeheer.", true); return }
    var id by rememberSaveable { mutableStateOf("") }; var revision by rememberSaveable { mutableIntStateOf(0) }
    var product by rememberSaveable { mutableStateOf("dartflow") }; var channel by rememberSaveable { mutableStateOf("android") }
    var version by rememberSaveable { mutableStateOf("") }; var title by rememberSaveable { mutableStateOf("") }; var body by rememberSaveable { mutableStateOf("") }; var preview by rememberSaveable { mutableStateOf(false) }
    var publish by remember { mutableStateOf<JSONObject?>(null) }
    val enabled = !state.busy && !state.hasPendingCommand
    fun load(release: JSONObject) { id = release.text("id"); revision = release.optInt("revision"); product = release.text("product"); channel = release.text("channel"); version = release.text("version"); title = release.text("title"); body = release.text("body"); preview = false }
    val receipt = state.communicationReceipt
    LaunchedEffect(receipt.toString()) { if (receipt.text("path") == "/product-releases/admin/actions" && receipt.obj("input").obj("action").text("type") == "release.save") receipt.obj("result").obj("release").takeIf { it.text("id").isNotBlank() }?.let { id = it.text("id"); revision = it.optInt("revision") }; if (receipt.text("path") == "/product-releases/admin/actions" && receipt.obj("input").obj("action").text("type") == "release.publish" && receipt.obj("result").text("id") == id) { id = ""; revision = 0; version = ""; title = ""; body = ""; preview = false } }
    PlayerCard("Releaseconcept") {
        Action("Nieuw releaseconcept", enabled, false) { id = ""; revision = 0; version = ""; title = ""; body = ""; preview = false }
        Choice("Product", product, playerReleaseProducts, { product = it }, enabled)
        Choice("Kanaal", channel, playerReleaseChannels, { channel = it }, enabled)
        Field("Versie", version, { version = it }, enabled, max = 80)
        Field("Titel", title, { title = it }, enabled, max = 160)
        Field("Verbeteringen en wijzigingen", body, { body = it }, enabled, max = 15000, multiline = true)
        PlayerToggle("Leesvoorbeeld", preview, true) { preview = it }
        if (preview) { Text("$title · $version", style = MaterialTheme.typography.titleLarge); Text(body) }
        Action("Bewaar releaseconcept", enabled && version.isNotBlank() && title.isNotBlank() && body.isNotBlank()) { actions.command("/product-releases/admin/actions", json("action" to json("type" to "release.save", "expectedRevision" to revision, "product" to product, "channel" to channel, "version" to version, "title" to title, "body" to body).also { if (id.isNotBlank()) it.put("id", id) })) }
        Text("Publiceren maakt het bericht leesbaar. Het verstuurt geen campagne of pushmelding.", color = PlayerMuted)
    }
    data.rows("drafts").forEach { release -> PlayerCard("${release.text("title")} · ${release.text("version")}") {
        Text("${release.text("product")} · ${release.text("channel")} · conceptrevisie ${release.optInt("revision")}", color = PlayerMuted)
        Action("Bewerk releaseconcept", enabled, false) { load(release) }
        Action("Publiceer releasebericht", enabled, false) { publish = release }
    } }
    PlayerCard("Gepubliceerde releases") { data.rows("published").forEach { release ->
        Text("${release.text("title")} · ${release.text("version")} · ${shortDate(release.text("publishedAt"))}")
        Action("Lees gepubliceerd bericht", primary = false) { actions.navigate(PlayerScreen.RELEASE_DETAIL, release.text("id")) }
        Action("Bereid aparte releasecampagne voor", enabled, false) { actions.navigate(PlayerScreen.NOTIFICATION_ADMIN, "release:${release.text("id")}") }
    } }
    publish?.let { release -> AlertDialog(onDismissRequest = { publish = null }, title = { Text("Releasebericht publiceren?") }, text = { Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) { Text("${release.text("title")} · ${release.text("version")}\n${release.text("product")} · ${release.text("channel")}"); Text(release.text("body")); Text("Er wordt nu geen melding verstuurd.") } }, confirmButton = { TextButton(onClick = { publish = null; actions.command("/product-releases/admin/actions", json("action" to json("type" to "release.publish", "id" to release.text("id"), "expectedRevision" to release.optInt("revision")))) }, enabled = enabled) { Text("Publiceren") } }, dismissButton = { TextButton(onClick = { publish = null }) { Text("Annuleren") } }) }
}

@Composable internal fun PlayerNotificationAdministration(state: PlayerUiState, actions: PlayerActions) {
    Heading("Meldingsbeheer", "PLATFORMBEHEER")
    Action("Terug", primary = false, onClick = actions.back)
    // Both API and current platform capability are checked: stale account data is never sufficient.
    if (!state.canManagePlatform || !state.resource.has("events")) { if (!state.loading) Notice("Geen actueel recht voor meldingsbeheer.", true); return }
    val data = state.resource; val enabled = !state.busy && !state.hasPendingCommand
    var section by rememberSaveable { mutableStateOf("campaign") }
    Choice("Beheeronderdeel", section, listOf("campaign" to "Bericht of releasecampagne", "rules" to "Gebeurtenisregels", "history" to "Verzendhistorie"), { section = it })
    if (section == "rules") data.rows("events").forEach { event -> PlayerCard(event.text("label")) {
        Text("${event.text("category")} · ${event.text("trigger")}", color = PlayerMuted)
        event.rows("rules").forEach { rule -> Choice(playerNotificationChannels.find { it.first == rule.text("channel") }?.second ?: rule.text("channel"), rule.text("mode"), playerNotificationModes, { mode -> actions.command("/notifications/admin/actions", json("action" to json("type" to "policy.set", "eventId" to event.text("id"), "channel" to rule.text("channel"), "mode" to mode, "expectedRevision" to rule.optInt("revision")))) }, enabled) }
    } }
    if (section == "history") {
        Action("Ververs verzendhistorie", enabled, false, onClick = actions.refresh)
        if (data.rows("tests").isNotEmpty()) PlayerCard("Proefmeldingen") {
            Text("Deze verzendingen gingen uitsluitend naar de gekozen proefontvanger en tellen niet als campagne.", color = PlayerMuted)
            data.rows("tests").forEach { test ->
                Text("${test.text("title")} · ${test.text("recipientLabel")}", style = MaterialTheme.typography.titleSmall)
                Text(shortDate(test.text("createdAt")), color = PlayerMuted)
                test.rows("statuses").forEach { Text("${playerSupportLabel(it.text("channel"), playerNotificationChannels)}: ${playerNotificationDeliveryLabel(it.text("status"))} · ${it.optInt("count")}", color = PlayerMuted) }
            }
            Text("Provideracceptatie en ontvangst door de app bewijzen niet dat Android de melding heeft weergegeven.", color = PlayerMuted)
        }
    }
    if (section == "history") data.rows("campaigns").forEach { campaign -> PlayerCard(campaign.text("title")) {
        Text("${campaign.text("product")} · ${campaign.text("channel")} · ${shortDate(campaign.text("createdAt"))}", color = PlayerMuted)
        Text("Verzender: ${data.rows("recipients").find { it.text("id") == campaign.text("actorId") }?.text("label") ?: "Platformmedewerker"}", color = PlayerMuted)
        Text(campaign.text("body")); Text("${campaign.optInt("recipientCount")} ontvangers · ${campaign.optInt("inboxCount")} inbox · ${campaign.optInt("pushCount")} push", color = PlayerMuted)
        campaign.rows("statuses").forEach { Text("${playerSupportLabel(it.text("channel"), playerNotificationChannels)}: ${playerNotificationDeliveryLabel(it.text("status"))} · ${it.optInt("count")}", color = PlayerMuted) }
        campaign.rows("errors").forEach { Text("${it.text("category")}: ${it.optInt("count")}", color = PlayerError) }
        Text("In wachtrij of provideracceptatie bewijst geen zichtbare ontvangst.", color = PlayerMuted)
        Action("Herprobeer mislukte verzendingen", enabled, false) { actions.command("/notifications/admin/actions", json("action" to json("type" to "campaign.retry", "campaignId" to campaign.text("id")))) }
    } }
    if (section == "campaign") PlayerCampaignEditor(state, actions)
}

@Composable private fun PlayerCampaignEditor(state: PlayerUiState, actions: PlayerActions) {
    val data = state.resource; val releases = data.obj("releases").rows("items").ifEmpty { data.rows("releases") }
    var kind by rememberSaveable { mutableStateOf(if (state.activeId?.startsWith("release:") == true) "release" else "platform") }
    var releaseId by rememberSaveable { mutableStateOf(state.activeId?.removePrefix("release:").takeIf { state.activeId?.startsWith("release:") == true }.orEmpty()) }
    var title by rememberSaveable { mutableStateOf("") }; var body by rememberSaveable { mutableStateOf("") }; var href by rememberSaveable { mutableStateOf("") }
    var all by rememberSaveable { mutableStateOf(false) }; var selectedText by rememberSaveable { mutableStateOf("") }; var testRecipient by rememberSaveable { mutableStateOf("") }; var confirmation by rememberSaveable { mutableStateOf("") }
    var previewText by rememberSaveable { mutableStateOf("") }; var capturedText by rememberSaveable { mutableStateOf("") }
    val selected = selectedText.split(',').filter { it.isNotBlank() }.toSet()
    val draftResult = runCatching { playerCampaignDraft(kind, releaseId, title, body, all, selected, href) }
    val draft = draftResult.getOrNull()
    val testDraft = testRecipient.takeIf { it.isNotBlank() }?.let { runCatching { playerCampaignDraft(kind, releaseId, title, body, false, setOf(it), href) }.getOrNull() }
    val preview = runCatching { JSONObject(previewText) }.getOrDefault(JSONObject())
    val captured = runCatching { JSONObject(capturedText) }.getOrNull()
    val enabled = !state.busy && !state.hasPendingCommand
    val receipt = state.communicationReceipt
    LaunchedEffect(receipt.toString()) { if (receipt.text("path") == "/notifications/admin/actions" && receipt.obj("input").obj("action").text("type") == "campaign.preview") { previewText = receipt.obj("result").obj("preview").toString(); capturedText = receipt.obj("input").obj("action").obj("draft").toString(); confirmation = "" } }
    LaunchedEffect(releaseId, releases.toString()) { if (kind == "release") releases.find { it.text("id") == releaseId }?.let { if (title.isBlank()) title = it.text("title").take(80); if (body.isBlank()) body = it.text("body").take(180) } }
    PlayerCard("Bericht samenstellen") {
        Choice("Soort bericht", kind, listOf("platform" to "Platformbericht", "release" to "Releasecampagne"), { kind = it; previewText = ""; confirmation = "" }, enabled)
        if (kind == "release") Choice("Gepubliceerde release", releaseId, listOf("" to "Kies een release") + releases.map { it.text("id") to "${it.text("product")} ${it.text("version")} · ${it.text("title")}" }, { releaseId = it; title = ""; body = ""; previewText = "" }, enabled)
        Field("Meldingstitel", title, { title = it }, enabled, max = 80)
        Field("Meldingstekst", body, { body = it }, enabled, max = 180, multiline = true)
        Text("Deze tekst kan op het vergrendelscherm verschijnen. Gebruik geen persoonsgegevens of privé-inhoud.", color = PlayerMuted)
        if (kind == "platform") { Field("Optionele interne bestemming", href, { href = it }, enabled, max = 400); Text("Zonder bestemming opent een platformbericht zijn eigen detailpagina.", color = PlayerMuted) }
        else Text("De campagne opent het gekozen gepubliceerde releasebericht.", color = PlayerMuted)
        PlayerToggle("Alle passende gebruikers", all, enabled) { all = it }
        if (!all) data.rows("recipients").forEach { person -> PlayerToggle(person.text("label"), person.text("id") in selected, enabled) { checked -> selectedText = (if (checked) selected + person.text("id") else selected - person.text("id")).sorted().joinToString(",") } }
        if (title.isNotBlank() && body.isNotBlank() && draft == null) Text("Campagnevoorbeeld: ${draftResult.exceptionOrNull()?.message ?: "Controleer je bericht en doelgroep."}", color = PlayerError)
        Choice("Expliciete proefontvanger", testRecipient, listOf("" to "Kies proefontvanger") + data.rows("recipients").map { it.text("id") to it.text("label") }, { testRecipient = it }, enabled)
        Action("Verstuur alleen proefmelding", enabled && testDraft != null, false) { actions.command("/notifications/admin/actions", json("action" to json("type" to "campaign.test", "draft" to testDraft, "testRecipientId" to testRecipient))) }
        Action("Bereken campagnevoorbeeld", enabled && draft != null, false) { actions.command("/notifications/admin/actions", json("action" to json("type" to "campaign.preview", "draft" to draft))) }
    }
    if (preview.text("id").isNotBlank()) PlayerCard("Controle vóór verzenden") {
        Text(preview.text("title"), style = MaterialTheme.typography.titleMedium); Text(preview.text("body"))
        Text("Product ${preview.text("product")} · kanaal ${preview.text("channel")}\n${preview.optInt("recipientCount")} ontvangers · ${preview.optInt("inboxCount")} inbox · ${preview.optInt("pushCount")} push · ${preview.optInt("unreachableCount")} onbereikbaar", color = PlayerMuted)
        Text("Bestemming: ${preview.text("href")}\nGeldig tot ${shortDate(preview.text("expiresAt"))}", color = PlayerMuted)
        if (draft == null || captured == null || playerCanonicalJson(draft) != playerCanonicalJson(captured)) Notice("Je tekst of doelgroep is gewijzigd. Bereken eerst een nieuw voorbeeld.", true)
        Field("Typ VERSTUREN ter bevestiging", confirmation, { confirmation = it }, enabled, max = 20)
        Action("Verstuur deze campagne", enabled && playerCampaignCanSend(preview, captured, draft, confirmation, System.currentTimeMillis() + state.themeClockOffset)) { actions.command("/notifications/admin/actions", json("action" to json("type" to "campaign.send", "previewId" to preview.text("id"), "confirmation" to confirmation))) }
    }
}

@Composable internal fun PlayerPlatformMessage(state: PlayerUiState, actions: PlayerActions) {
    val message = state.resource.optJSONObject("message") ?: state.resource
    Heading(message.text("title", "Platformbericht"), "DARTFLOW")
    Action("Terug naar meldingen", primary = false, onClick = actions.back)
    if (message.text("id").isBlank()) { if (!state.loading) Notice("Dit bericht is niet meer beschikbaar.", true); return }
    Text(shortDate(message.text("createdAt")), color = PlayerMuted)
    PlayerCard { Text(message.text("body")) }
    if (message.text("href").isNotBlank()) Action("Open bijbehorende bestemming", primary = false) { actions.openLink(message.text("href")) }
}
