package nl.dartflow.app

import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/** Synthetic native fixtures only. This does not prove hosted support access or FCM delivery. */
class PlayerCommunicationUiTest {
    @get:Rule val compose = createComposeRule()
    private val id = "00000000-0000-4000-8000-000000000601"
    private fun state(screen: PlayerScreen, resource: JSONObject, admin: Boolean = false) = PlayerUiState(loading = false, session = PlayerSession("support-fixture", "fixture@example.test", Long.MAX_VALUE, true), profile = PlayerProfile("support-fixture", "Noor", "noor", "Noor", true, true, true), screen = screen, resource = resource, canManagePlatform = admin)
    private fun ticket(admin: Boolean = false) = json("id" to id, "number" to "DF-42", "subject" to "Een vraag over mijn baan", "status" to "waiting_for_user", "category" to "boards", "waitingOn" to "user", "revision" to 7,
        "permissions" to json("canReply" to true, "canClose" to !admin, "canReopen" to false, "canManage" to admin, "canNote" to admin, "canAssign" to admin, "canSetPriority" to admin, "canEditDetails" to admin, "canChangeStatus" to admin),
        "timeline" to JSONArray(listOf(json("id" to "public", "type" to "message", "actorName" to "DartFlow Support", "createdAt" to "2026-11-20T12:00:00Z", "body" to "Kun je jouw vraag toelichten?"))),
        "management" to json("priority" to "normal", "staff" to JSONArray(listOf(json("id" to "staff", "name" to "Supportteam"))), "allowedStatuses" to JSONArray(playerSupportStatuses.map { it.first }), "timeline" to JSONArray(listOf(json("id" to "public", "type" to "message", "visibility" to "public", "actor" to json("name" to "Supportteam"), "body" to "Openbaar antwoord"), json("id" to "private", "type" to "internal_note", "visibility" to "internal", "body" to "Uitsluitend intern dossier")))))
    private fun content(font: Float = 1f, block: @Composable () -> Unit) { compose.setContent { CompositionLocalProvider(LocalDensity provides Density(1f, font)) { Box(Modifier.requiredSize(390.dp, 844.dp).testTag("communication-fixture")) { DartFlowPlayerTheme { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { block() } } } } } }
    private fun appContent(font: Float = 1f, block: @Composable () -> Unit) { compose.setContent { CompositionLocalProvider(LocalDensity provides Density(1f, font)) { Box(Modifier.requiredSize(390.dp, 844.dp).testTag("communication-fixture")) { DartFlowPlayerTheme { block() } } } } }
    private fun screenshot(name: String) {
        require(name in setOf("support-owner.png", "notification-settings.png", "release-campaign-preview.png"))
        val bitmap = compose.onNodeWithTag("communication-fixture").captureToImage().asAndroidBitmap()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p /data/local/tmp/dartflow-ui-fixtures")).use { it.readBytes() }
        val pipes = automation.executeShellCommandRw("dd of=/data/local/tmp/dartflow-ui-fixtures/$name")
        ParcelFileDescriptor.AutoCloseInputStream(pipes[0]).use { result -> ParcelFileDescriptor.AutoCloseOutputStream(pipes[1]).use { output -> assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) }; assertTrue(result.readBytes().isEmpty()) }
    }

    @Test fun ownTicketRendersPublicHistoryAndRepliesWithVisibleRevision() {
        var sent = JSONObject()
        appContent { PlayerApp(state(PlayerScreen.SUPPORT_TICKET, json("ticket" to ticket())), PlayerActions(command = { path, body -> assertEquals("/support/actions", path); sent = body })) }
        compose.onNodeWithText("DF-42").assertIsDisplayed(); compose.onNodeWithText("Uitsluitend intern dossier").assertDoesNotExist(); compose.onNodeWithText("Interne notitie").assertDoesNotExist()
        screenshot("support-owner.png")
        compose.onNodeWithText("Reactie").performScrollTo().performTextInput("Mijn aanvullende uitleg")
        compose.onNodeWithText("Verstuur reactie").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(7, sent.optInt("expectedRevision")); assertEquals("ticket.reply", sent.obj("action").text("type")); assertEquals("Mijn aanvullende uitleg", sent.obj("action").text("body")) }
    }
    @Test fun supportQueueFiltersUseServerQueryAndRealStaffPicker() {
        var destination: PlayerDestination? = null
        val data = json("canManageSupport" to true, "staff" to JSONArray(listOf(json("id" to id, "name" to "Supportteam"))), "counts" to json("open" to 8, "unhandled" to 3), "tickets" to JSONArray(), "total" to 0, "limit" to 25)
        content { PlayerSupportList(state(PlayerScreen.SUPPORT_ADMIN, data, true), PlayerActions(navigate = { screen, value -> destination = PlayerDestination(screen, value) }), true) }
        compose.onNodeWithText("8 open · 3 onbehandeld").assertExists()
        compose.onNodeWithText("Zoek op ticketnummer, onderwerp of tekst").performScrollTo().performTextInput("DF-42")
        compose.onNodeWithText("Pas ticketfilters toe").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(PlayerScreen.SUPPORT_ADMIN, destination?.screen); assertTrue(destination?.id.orEmpty().contains("q=DF-42")); assertTrue(destination?.id.orEmpty().contains("status=unhandled")) }
    }
    @Test fun supportAdminInternalNotesAndAssignmentRequireOwnCapabilities() {
        var sent = JSONObject()
        var current by mutableStateOf(state(PlayerScreen.SUPPORT_ADMIN_TICKET, json("ticket" to ticket(true)), true))
        content { PlayerSupportDetail(current, PlayerActions(command = { _, body -> sent = body }), true) }
        compose.onNodeWithText("Uitsluitend intern dossier").performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("Interne notitie").onLast().performScrollTo().performTextInput("Nieuwe interne opvolging")
        compose.onNodeWithText("Bewaar interne notitie").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("ticket.admin.note", sent.obj("action").text("type")); assertEquals(7, sent.optInt("expectedRevision")); current = current.copy(resource = json("ticket" to ticket(true).also { it.obj("permissions").put("canNote", false).put("canAssign", false) })) }
        compose.onNodeWithText("Bewaar interne notitie").assertDoesNotExist(); compose.onNodeWithText("Bewaar toewijzing").assertDoesNotExist()
    }
    @Test fun wholeInboxRowOpensDestinationAndRetainsReturnToInbox() {
        val item = json("id" to id, "category" to "Supporttickets", "title" to "Reactie op DF-42", "body" to "Bekijk de opvolging in DartFlow.", "createdAt" to "2026-11-20T12:00:00Z", "opened" to false, "available" to true)
        var current by mutableStateOf(state(PlayerScreen.NOTIFICATIONS, json("items" to JSONArray(listOf(item)), "unread" to 1)))
        var opened = ""
        content { if (current.screen == PlayerScreen.NOTIFICATIONS) PlayerNotificationInbox(current, PlayerActions(openNotification = { opened = it; current = current.copy(screen = PlayerScreen.SUPPORT_TICKET, resource = json("ticket" to ticket())) })) else PlayerSupportDetail(current, PlayerActions(back = { current = current.copy(screen = PlayerScreen.NOTIFICATIONS, resource = json("items" to JSONArray(listOf(item.put("opened", true))), "unread" to 0)) })) }
        compose.onNodeWithText("Meldingen op dit toestel").assertDoesNotExist()
        compose.onNodeWithText("Bekijk de opvolging in DartFlow.").performClick()
        compose.runOnIdle { assertEquals(id, opened) }; compose.onNodeWithText("DF-42").assertExists()
        compose.onNodeWithText("Terug naar tickets").performClick()
        compose.onNodeWithText("0 ongelezen").assertExists(); compose.onNode(hasText("Gelezen · Supporttickets", substring = true) and hasText("13:00", substring = true)).assertExists()
    }
    @Test fun notificationSettingsSeparateEffectiveAccountRulesFromDeviceConsent() {
        var sent = JSONObject()
        val data = json("categories" to JSONArray(listOf(json("category" to "Supporttickets", "channels" to JSONArray(listOf(json("channel" to "inbox", "applicable" to true, "personalEnabled" to true, "effectiveEnabled" to true, "mode" to "follow"), json("channel" to "email", "applicable" to true, "personalEnabled" to false, "effectiveEnabled" to true, "mode" to "on"), json("channel" to "push", "applicable" to false, "personalEnabled" to true, "mode" to "follow")))))), "push" to json("transportConfigured" to false))
        appContent(1.6f) { PlayerApp(state(PlayerScreen.NOTIFICATION_SETTINGS, data), PlayerActions(command = { _, body -> sent = body })) }
        compose.onNodeWithText("Geforceerd aan · effectief aan").assertExists(); compose.onNodeWithText("Niet van toepassing").assertExists()
        screenshot("notification-settings.png")
        compose.onAllNodes(isToggleable()).onFirst().performClick()
        compose.runOnIdle { assertEquals("preference.set", sent.obj("action").text("type")); assertEquals("inbox", sent.obj("action").text("channel")); assertFalse(sent.obj("action").optBoolean("enabled", true)) }
        compose.onNodeWithText("Stuur testmelding naar dit toestel").performScrollTo().assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithText("Open Android-meldingsinstellingen").performScrollTo().assertIsDisplayed().assertIsEnabled()
    }
    @Test fun releasePublishIsSeparateFromCampaignAndShowsProductChannel() {
        var sent = JSONObject()
        val release = json("id" to id, "product" to "oche-live", "channel" to "android", "version" to "1.5.0", "title" to "Duidelijkere borden", "body" to "Verbeterde schermweergave", "revision" to 3)
        content { PlayerReleaseAdministration(state(PlayerScreen.RELEASE_ADMIN, json("canManage" to true, "drafts" to JSONArray(listOf(release)), "published" to JSONArray()), true), PlayerActions(command = { _, body -> sent = body })) }
        compose.onNodeWithText("Bewerk releaseconcept").performScrollTo().performClick()
        compose.onNodeWithText("Oche Live").performScrollTo().assertIsEnabled()
        compose.onNodeWithText("Android").performScrollTo().assertIsEnabled()
        compose.onNodeWithText("Publiceer releasebericht").performScrollTo().performClick()
        compose.onNodeWithText("Er wordt nu geen melding verstuurd.").assertExists(); compose.onNodeWithText("Publiceren").performClick()
        compose.runOnIdle { assertEquals("release.publish", sent.obj("action").text("type")); assertEquals(3, sent.obj("action").optInt("expectedRevision")); assertFalse(sent.obj("action").has("audience")) }
    }
    @Test fun campaignNeedsRealPreviewAndExactConfirmationAndRejectsEditedText() {
        var current by mutableStateOf(state(PlayerScreen.NOTIFICATION_ADMIN, json("events" to JSONArray(), "recipients" to JSONArray(listOf(json("id" to id, "label" to "Proefspeler"))), "tests" to JSONArray(listOf(json("id" to id, "title" to "Proef naar gekozen ontvanger", "recipientLabel" to "Proefspeler", "createdAt" to "2026-11-20T12:00:00Z", "statuses" to JSONArray(listOf(json("channel" to "push", "status" to "received", "count" to 1))))))), true))
        val received = mutableListOf<JSONObject>()
        appContent { PlayerApp(current, PlayerActions(command = { path, command -> received += command; if (command.obj("action").text("type") == "campaign.preview") current = current.copy(communicationReceipt = json("path" to path, "input" to command, "result" to json("preview" to json("id" to id, "title" to "Nieuwe app", "body" to "Lees de verbeteringen", "product" to "dartflow", "channel" to "android", "href" to "/app/platform-messages/$id", "expiresAt" to Instant.now().plusSeconds(120).toString(), "recipientCount" to 1, "inboxCount" to 1, "pushCount" to 0, "unreachableCount" to 1)))) })) }
        compose.onNodeWithText("Meldingstitel").performScrollTo().performTextInput("Nieuwe app")
        compose.onNodeWithText("Meldingstekst").performScrollTo().performTextInput("Lees de verbeteringen")
        compose.onNodeWithText("Kies proefontvanger").performScrollTo().performClick()
        compose.onAllNodesWithText("Proefspeler").onLast().performClick()
        compose.onNodeWithText("Verstuur alleen proefmelding").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals("campaign.test", received.single().obj("action").text("type")); assertEquals(id, received.single().obj("action").text("testRecipientId")); assertEquals(listOf(id), received.single().obj("action").obj("draft").obj("audience").getJSONArray("userIds").strings()) }
        compose.onNodeWithText("Alle passende gebruikers").performScrollTo().performClick()
        compose.onNodeWithText("Bereken campagnevoorbeeld").performScrollTo().performClick()
        compose.onNodeWithText("Verstuur deze campagne").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("Typ VERSTUREN ter bevestiging").performScrollTo().performTextInput("VERSTUREN")
        compose.onNodeWithText("Verstuur deze campagne").performScrollTo().assertIsEnabled()
        screenshot("release-campaign-preview.png")
        compose.onNodeWithText("Meldingstekst").performScrollTo().performTextReplacement("Bewust gewijzigde tekst")
        compose.onNodeWithText("Verstuur deze campagne").performScrollTo().assertIsNotEnabled()
        compose.runOnIdle { assertEquals(2, received.size); assertEquals("campaign.preview", received.last().obj("action").text("type")) }
        compose.onNodeWithText("Bericht of releasecampagne").performScrollTo().performClick()
        compose.onNodeWithText("Verzendhistorie").performClick()
        compose.onNodeWithText("Proefmeldingen").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Push: Door de app ontvangen · 1").assertExists()
    }
    @Test fun helpKeepsSupportIntentForLoginAndNoResultsStillOfferSupport() {
        var link = ""
        content { PlayerHelpScreen(PlayerUiState(loading = false, screen = PlayerScreen.HELP, activeId = "q=unfindable", resource = json("version" to "fixture", "items" to JSONArray())), PlayerActions(openLink = { link = it })) }
        compose.onNodeWithText("Geen vragen gevonden. Probeer een ander zoekwoord of wis de filters.").assertExists()
        compose.onNodeWithText("Vraag niet gevonden? Stel een supportvraag").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("/app/support/new", link) }
    }
}
