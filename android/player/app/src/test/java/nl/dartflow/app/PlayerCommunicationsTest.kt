package nl.dartflow.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import kotlinx.coroutines.runBlocking

class PlayerCommunicationsTest {
    private val origin = "https://dartflow.nl"
    private val id = "11111111-1111-4111-8111-111111111111"
    private val device = "22222222-2222-4222-8222-222222222222"
    private val base = mapOf("id" to id, "deviceId" to device, "category" to "Supporttickets")
    private fun ticket(permission: String) = json("id" to id, "revision" to 19, "permissions" to json(permission to true))

    @Test fun supportAndNotificationDeepLinksKeepExactNativeDestinations() {
        val cases = mapOf("/app" to PlayerDestination(PlayerScreen.HOME), "/app/friends" to PlayerDestination(PlayerScreen.FRIENDS), "/app/community/$id" to PlayerDestination(PlayerScreen.FRIENDS, id), "/app/hall/$id" to PlayerDestination(PlayerScreen.EVENT, id), "/app/notifications/$id" to PlayerDestination(PlayerScreen.NOTIFICATIONS, id), "/app/support" to PlayerDestination(PlayerScreen.SUPPORT), "/app/support/new" to PlayerDestination(PlayerScreen.SUPPORT, "new=1"), "/app/support/$id" to PlayerDestination(PlayerScreen.SUPPORT_TICKET, id), "/app/admin/support/$id" to PlayerDestination(PlayerScreen.SUPPORT_ADMIN_TICKET, id), "/app/notifications" to PlayerDestination(PlayerScreen.NOTIFICATIONS), "/app/settings/notifications" to PlayerDestination(PlayerScreen.NOTIFICATION_SETTINGS), "/app/whats-new/$id" to PlayerDestination(PlayerScreen.RELEASE_DETAIL, id), "/app/platform-messages/$id" to PlayerDestination(PlayerScreen.PLATFORM_MESSAGE, id))
        cases.forEach { (href, expected) -> assertEquals(href, expected, PlayerLinks.destination(href, origin)) }
        assertNull(PlayerLinks.destination("https://evil.example/app/support/$id", origin))
        assertNull(PlayerLinks.destination("https://user@dartflow.nl/app/support/$id", origin))
        val help = json("items" to JSONArray(listOf(json("id" to "general", "question" to "Support", "audience" to "all"), json("id" to "admin", "question" to "Support", "audience" to "platform"))))
        assertEquals(listOf("general"), playerHelpItems(help, "support", "", "player").map { it.text("id") })
        assertEquals(2, playerHelpItems(help, "support", "", "platform").size)
    }
    @Test fun serverTicketFiltersAreBoundedAndPrivateFiltersDoNotEnterOwnRequests() {
        val input = "q=DF-12&status=open&category=boards&priority=urgent&assignee=me&offset=25&limit=25&ownerId=someone"
        val own = playerSupportQuery(input, false); val admin = playerSupportQuery(input, true)
        assertTrue(own.contains("q=DF-12")); assertFalse(own.contains("priority")); assertFalse(own.contains("assignee")); assertFalse(own.contains("ownerId"))
        assertTrue(admin.contains("priority=urgent")); assertTrue(admin.contains("assignee=me"))
        assertEquals("", playerSupportQuery("limit=101&offset=-1&status=hidden&category=secrets&q=%0A", true))
    }
    @Test fun everySupportMutationUsesVisibleRevisionAndSpecificCapability() {
        listOf("ticket.reply" to "canReply", "ticket.close" to "canClose", "ticket.reopen" to "canReopen", "ticket.admin.reply" to "canReply", "ticket.admin.note" to "canNote", "ticket.admin.status" to "canChangeStatus").forEach { (type, cap) ->
            val command = playerSupportAction(ticket(cap), type, "body" to "Een echte reactie")
            assertEquals(19, command.optInt("expectedRevision")); assertEquals(id, command.obj("action").text("ticketId")); assertEquals(type, command.obj("action").text("type"))
            assertThrows(IllegalArgumentException::class.java) { playerSupportAction(ticket("canManage"), type) }
        }
    }
    @Test fun ticketAssignmentPriorityAndDetailsCannotBorrowEachOthersPermission() {
        assertEquals("staff", playerSupportAction(ticket("canAssign"), "ticket.admin.update", "assigneeId" to "staff").obj("action").text("assigneeId"))
        assertEquals("urgent", playerSupportAction(ticket("canSetPriority"), "ticket.admin.update", "priority" to "urgent").obj("action").text("priority"))
        assertThrows(IllegalArgumentException::class.java) { playerSupportAction(ticket("canAssign"), "ticket.admin.update", "priority" to "urgent") }
        assertThrows(IllegalArgumentException::class.java) { playerSupportAction(ticket("canSetPriority"), "ticket.admin.update", "subject" to "Other") }
        assertThrows(IllegalArgumentException::class.java) { playerSupportAction(ticket("canAssign"), "ticket.admin.update", "assigneeId" to "staff", "priority" to "urgent") }
    }
    @Test fun ownTimelineNeverRendersInternalNotesEvenFromMalformedAdminData() {
        val public = json("id" to "public", "type" to "message", "body" to "Openbare reactie")
        val secret = json("id" to "private", "type" to "internal_note", "visibility" to "internal", "body" to "Privé supportnotitie")
        val data = ticket("canManage").put("timeline", JSONArray(listOf(public, secret))).put("management", json("timeline" to JSONArray(listOf(public, secret))))
        assertEquals(listOf("public"), playerSupportTimeline(data, false).map { it.text("id") })
        assertEquals(2, playerSupportTimeline(data, true).size)
        data.obj("permissions").put("canManage", false); assertEquals(1, playerSupportTimeline(data, true).size)
        assertEquals("Ticketgegevens gewijzigd", playerSupportEventLabel("details"))
        data.obj("management").put("allowedStatuses", JSONArray(listOf("waiting_for_user", "resolved", "closed")))
        assertEquals("waiting_for_user", playerSupportNextStatus(data, "in_progress")); assertEquals("resolved", playerSupportNextStatus(data, "resolved"))
        data.obj("management").put("allowedStatuses", JSONArray()); assertEquals("", playerSupportNextStatus(data, "in_progress"))
        val changes = playerSupportChanges(json("changes" to json("assigneeId" to id, "previousAssigneeId" to null, "priority" to "urgent", "unrelatedPrivateKey" to "Never render")), json("staff" to JSONArray(listOf(json("id" to id, "name" to "Supportteam")))))
        assertEquals(listOf("Eerder toegewezen aan: Niet toegewezen", "Toegewezen aan: Supportteam", "Prioriteit: Dringend"), changes)
        assertFalse(changes.joinToString().contains(id)); assertFalse(changes.joinToString().contains("Never render"))
    }
    @Test fun supportPushContainsOnlyNumberAndWhitelistedNeutralEvent() {
        playerSupportPushEvents.forEach { (event, label) ->
            val payload = base + mapOf("eventType" to event, "ticketNumber" to "DF-987")
            assertEquals("$label · DF-987", playerPushPresentation(payload)?.second)
            assertNull(playerPushPayload(payload + ("subject" to "Private subject")))
            assertNull(playerPushPayload(payload + ("body" to "Private message")))
        }
        for (number in listOf("DF-0", "DF-01", "DF-secret", "DF-1234567890123456", "DF-1\n")) assertNull(playerPushPayload(base + mapOf("eventType" to "support-answered", "ticketNumber" to number)))
        assertNull(playerPushPayload(base + mapOf("eventType" to "support-received", "ticketNumber" to "DF-1")))
    }
    @Test fun explicitCampaignPushTextIsBoundedAndCannotLeakIntoOtherChannels() {
        val campaign = base + mapOf("category" to "Productreleases", "campaignTitle" to "Nieuwe app", "campaignBody" to "Bekijk wat er is verbeterd.")
        assertEquals("Nieuwe app", playerPushPresentation(campaign)?.first)
        for (bad in listOf(campaign + ("campaignTitle" to "x".repeat(81)), campaign + ("campaignBody" to "x".repeat(181)), campaign + ("campaignBody" to "verborgen\nregel"), campaign + ("actorName" to "Private"), campaign + ("category" to "Sociaal"))) assertNull(playerPushPayload(bad))
        assertEquals("dartflow-0", playerPushChannelId("Sociaal")); assertEquals("dartflow-3", playerPushChannelId("Toernooien")); assertEquals("dartflow-5", playerPushChannelId("Supporttickets")); assertEquals(12, playerPushCategories.distinct().size)
    }
    @Test fun serverForcedPushStillRequiresCurrentAccountDeviceConsentAndDedupe() {
        val binding = json("enabled" to true, "actorId" to "actor", "origin" to origin, "deviceId" to device, "preferences" to JSONArray(listOf(json("category" to "Supporttickets", "enabled" to false))))
        val session = json("userId" to "actor", "accessToken" to "synthetic-local-token")
        assertTrue(playerPushShouldReceive(binding, session, "actor", origin, true, device, id))
        assertFalse(playerPushShouldReceive(binding, session, "actor", origin, false, device, id))
        assertFalse(playerPushShouldReceive(binding, json("userId" to "other", "accessToken" to "synthetic-local-token"), "actor", origin, true, device, id))
        assertFalse(playerPushShouldReceive(binding, session, "actor", "https://staging.dartflow.nl", true, device, id))
        binding.put("seen", JSONArray(listOf(id))); assertFalse(playerPushShouldReceive(binding, session, "actor", origin, true, device, id))
    }
    @Test fun campaignPreviewRequiresSameSemanticDraftExactConfirmationAndFreshExpiry() {
        val a = playerCampaignDraft("platform", "", "Titel", "Tekst", false, setOf("a", "b"), "")
        val b = JSONObject(a.toString()).also { it.remove("title"); it.put("title", "Titel") }
        val now = Instant.parse("2026-11-20T10:00:00Z").toEpochMilli()
        val preview = json("id" to id, "expiresAt" to "2026-11-20T10:01:00Z")
        assertTrue(playerCampaignCanSend(preview, a, b, "VERSTUREN", now))
        assertFalse(playerCampaignCanSend(preview, a, b, "versturen", now))
        assertFalse(playerCampaignCanSend(preview, a, b, "VERSTUREN", now + 60_000))
        b.put("body", "Gewijzigde tekst"); assertFalse(playerCampaignCanSend(preview, a, b, "VERSTUREN", now))
        assertFalse(playerCampaignCanSend(preview, null, a, "VERSTUREN", now))
    }
    @Test fun campaignDraftNeedsRealSelectedRecipientsAndInternalDestination() {
        assertThrows(IllegalArgumentException::class.java) { playerCampaignDraft("platform", "", "Titel", "Tekst", false, emptySet(), "") }
        for (href in listOf("https://evil.example", "//evil.example", "/app/\\evil", "/app/path\n")) assertThrows(IllegalArgumentException::class.java) { playerCampaignDraft("platform", "", "Titel", "Tekst", true, emptySet(), href) }
        assertEquals(listOf("a", "b"), playerCampaignDraft("platform", "", "Titel", "Tekst", false, setOf("b", "a"), "/app/support").obj("audience").getJSONArray("userIds").strings())
        assertThrows(IllegalArgumentException::class.java) { playerCampaignDraft("release", "", "Titel", "Tekst", true, emptySet(), "") }
        assertFalse(playerCampaignDraft("platform", "", "Titel", "Tekst", true, emptySet(), "").has("href"))
        assertThrows(IllegalArgumentException::class.java) { playerCampaignDraft("platform", "", "Titel", "Twee\nregels", true, emptySet(), "") }
        val testOnly = playerCampaignDraft("platform", "", "Titel", "Tekst", false, setOf(id), "")
        assertEquals(listOf(id), testOnly.obj("audience").getJSONArray("userIds").strings())
        assertEquals("Door verzenddienst geaccepteerd", playerNotificationDeliveryLabel("sent")); assertEquals("Door de app ontvangen", playerNotificationDeliveryLabel("received")); assertEquals("Geopend", playerNotificationDeliveryLabel("opened"))
    }
    @Test fun unavailableOrUnsupportedNotificationReturnsToInboxWithoutGuessing() = runBlocking {
        assertEquals(PlayerDestination(PlayerScreen.SUPPORT_TICKET, id), playerNotificationDestination(json("available" to true, "href" to "/app/support/$id"), origin))
        for (result in listOf(json("available" to false, "href" to "/app/support/$id"), json("available" to true, "href" to "https://evil.example/app/support/$id"), json("available" to true, "href" to "/unknown"))) assertEquals(PlayerDestination(PlayerScreen.NOTIFICATIONS), playerNotificationDestination(result, origin))
        for (status in listOf(403, 404, 410)) {
            var pending: String? = id
            val bootstrap = mutableListOf<String>()
            val result = playerResolveNotificationOpen(
                request = { throw PlayerApiFailure(status, "not_found", "Private provider response") },
                isCurrent = { true }, clearPending = { pending = null; bootstrap += "clearPending" },
            )!!
            // This production resolver runs inside loadIdentity before loadCommon on cold login.
            bootstrap += "loadCommon"
            assertEquals(listOf("clearPending", "loadCommon"), bootstrap)
            assertNull(pending); assertFalse(result.optBoolean("available"))
            assertFalse(result.text("message").contains("Private provider"))
            assertEquals(PlayerDestination(PlayerScreen.NOTIFICATIONS), playerNotificationDestination(result, origin))
        }
        for (failure in listOf(PlayerApiFailure(401, "unauthorized", "Login nodig"), PlayerApiFailure(503, "unavailable", "Server niet beschikbaar"), java.io.IOException("Verbinding verbroken"))) {
            var pending: String? = id
            var commonLoaded = false
            try {
                playerResolveNotificationOpen(request = { throw failure }, isCurrent = { true }, clearPending = { pending = null })
                commonLoaded = true
                fail("Authentication/transport errors must remain retryable")
            } catch (actual: Exception) { assertSame(failure, actual) }
            assertEquals(id, pending); assertFalse(commonLoaded)
        }
        var clearedPreviousLogin = false
        assertNull(playerResolveNotificationOpen(request = { json("available" to true, "href" to "/app/support/$id") }, isCurrent = { false }, clearPending = { clearedPreviousLogin = true }))
        assertFalse(clearedPreviousLogin)
    }
    @Test fun lostAckSupportRetryPreservesRequestBodyAndIsAccountOriginBound() {
        val input = json("requestId" to id, "expectedRevision" to 19, "action" to json("type" to "ticket.reply", "ticketId" to device, "body" to "Mijn bewaarde reactie"))
        val command = NativePlayerCommand.create("/support/actions", input)
        val stored = command.forStorage("actor", origin)
        val restored = NativePlayerCommand.restore(stored, "actor", origin)
        assertNotNull(restored); assertEquals(playerCanonicalJson(command.body), playerCanonicalJson(restored!!.body))
        assertNull(NativePlayerCommand.restore(stored, "different", origin)); assertNull(NativePlayerCommand.restore(stored, "actor", "https://staging.dartflow.nl"))
    }
}
