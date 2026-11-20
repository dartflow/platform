package nl.dartflow.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class PlayerClubhouseTest {
    private val now = Instant.parse("2026-11-20T12:00:00Z").toEpochMilli()
    private fun theme(club: String? = "club-a", until: Long = now + 60_000) = json("preference" to json("mode" to "auto", "colorMode" to "system", "revision" to 1), "effective" to json("clubId" to club, "validUntil" to Instant.ofEpochMilli(until).toString(), "tokens" to json("light" to JSONObject(playerDefaultLight), "dark" to JSONObject(playerDefaultDark))))
    @Test fun safeThemeColorsRejectCssAndRetainEverySemanticToken() {
        for (invalid in listOf("red", "#fff", "#123456;", "url(x)", "#12345G", " #123456")) assertFalse(invalid, playerHex(invalid))
        assertTrue(playerHex("#12aBcD")); assertEquals(13, playerThemeKeys.size)
        val broken = JSONObject(playerDefaultDark).put("primary", "url(secret)")
        assertEquals(playerDefaultDark, playerThemeTokens(broken, true))
    }
    @Test fun previewLightAndDarkTokensHaveReadableTextAndButtonInk() {
        assertNull(playerWordmarkTint(playerDefaultDark))
        for (dark in listOf(true, false)) for (accent in listOf("#FFFFFF", "#000000", "#0055FF", "#FFFF00")) {
            val tokens = playerPreviewThemeTokens(accent, "#F000F0", dark)
            assertTrue(playerThemeKeys.all { playerHex(tokens.text(it)) })
            assertTrue(playerContrast(tokens.text("primary"), tokens.text("onPrimary")) >= 4.5)
            assertTrue(playerContrast(tokens.text("text"), tokens.text("surface")) >= 4.5)
            assertTrue(playerContrast(tokens.text("primary"), tokens.text("surface")) >= 4.5)
            val palette = playerThemeKeys.associateWith { tokens.text(it) }
            val wordmark = playerWordmarkTint(palette)
            if (dark) assertNull(wordmark) else { assertNotNull(wordmark); assertTrue(playerContrast(requireNotNull(wordmark), tokens.text("background")) >= 4.5) }
        }
    }
    @Test fun themeExpiryIsFixedCappedAndNeverExtendedByARead() {
        assertNull(playerBoundedTheme(theme(until = now), now, "club-a"))
        val capped = requireNotNull(playerBoundedTheme(theme(until = now + 86_400_000), now, "club-a"))
        assertEquals(now + 300_000, Instant.parse(capped.obj("effective").text("validUntil")).toEpochMilli())
        assertEquals(capped.toString(), playerBoundedTheme(capped, now + 1000, "club-a")?.toString())
    }
    @Test fun explicitClubContextNeverUsesAnotherClubsTheme() {
        assertNull(playerBoundedTheme(theme("club-a"), now, "club-b"))
        assertNotNull(playerBoundedTheme(theme(null), now, "club-b"))
        assertEquals("club-b", playerThemeContext(PlayerScreen.CLUB_CHAT, playerClubId("club-b", item = "channel")))
        assertNull(playerThemeContext(PlayerScreen.PROFILE, "club-b"))
    }
    @Test fun clubhouseRoutesPreservePageAndItemAndRejectInvalidPages() {
        val id = playerClubId("club-a", "calendar", "activity-1")
        assertEquals(PlayerClubRoute("club-a", "calendar", "activity-1"), playerClubRoute(id))
        assertNull(playerClubRoute("../club")); assertNull(playerClubRoute("club-a?page=secret")); assertNull(playerClubRoute("club-a?page=feed&page=manage"))
        for ((slug, page) in mapOf("agenda" to "calendar", "leden" to "members", "teams" to "teams", "competities" to "competitions", "partijen" to "matches", "locaties" to "locations", "taken" to "tasks", "contributie" to "dues", "beheer" to "manage")) {
            val destination = requireNotNull(PlayerLinks.destination("/app/clubs/club-a/$slug?post=post-a", "https://dartflow.nl"))
            assertEquals(PlayerScreen.CLUBHOUSE, destination.screen); assertEquals(PlayerClubRoute("club-a", page, "post-a"), playerClubRoute(destination.id))
        }
        assertEquals(PlayerScreen.CLUBHOUSE, PlayerLinks.destination("/app/clubs/club-a?page=calendar", "https://dartflow.nl")?.screen)
    }
    @Test fun wizardRestorationIsBoundToBothAccountAndClub() {
        val value = json("actorId" to "actor-a", "clubId" to "club-a", "config" to playerWizardDefaults())
        assertNotNull(playerWizardRestore(value, "actor-a", "club-a"))
        assertNull(playerWizardRestore(value, "actor-b", "club-a")); assertNull(playerWizardRestore(value, "actor-a", "club-b")); assertNull(playerWizardRestore(value, "", "club-a"))
    }
    @Test fun wizardOnlyOffersProjectedLinkedBoardsAndDeduplicatesThem() {
        val context = json("locations" to JSONArray(listOf(json("id" to "own", "name" to "Eigen locatie", "boards" to JSONArray(listOf(json("id" to "board1", "name" to "Baan 1"), json("id" to "board1", "name" to "Baan 1")))))), "managedLocations" to JSONArray(listOf(json("boards" to JSONArray(listOf(json("id" to "unlinked")))))))
        val boards = playerWizardOwnBoards(context)
        assertEquals(listOf("board1"), boards.map { it.text("id") }); assertEquals("own", boards.single().text("locationId"))
        assertTrue(playerWizardOwnBoards(json("boards" to JSONArray(listOf(json("id" to "global"))))).isEmpty())
        val physical = json("scope" to "location", "locationId" to "own")
        val locations = listOf(json("locationId" to "own", "canManageScreens" to true, "brandingClubs" to JSONArray(listOf(json("id" to "club-a", "name" to "Blauwe club")))), json("locationId" to "other", "canManageScreens" to true, "brandingClubs" to JSONArray(listOf(json("id" to "club-b", "name" to "Andere club")))))
        assertEquals(listOf("dartflow", "onzetrots", "club:club-a"), playerDeviceThemeOptions(physical, locations).map { it.first })
        assertEquals(listOf("dartflow", "onzetrots"), playerDeviceThemeOptions(JSONObject(physical.toString()).put("scope", "home"), locations).map { it.first })
        assertEquals(2, playerDeviceThemeOptions(physical, listOf(JSONObject(locations.first().toString()).put("canManageScreens", false))).size)
    }
    @Test fun wizardTeamsUseExistingIdentityAndImmutableRosterSnapshot() {
        val team = json("id" to "team-a", "name" to "Darters", "captainId" to "p1", "deputyId" to "p2", "playerIds" to JSONArray(listOf("p1", "p2", "reserve")), "reserveIds" to JSONArray(listOf("reserve")))
        val context = json("teams" to JSONArray(listOf(team))); val selected = requireNotNull(playerWizardTeam(context, "team-a"))
        team.put("name", "Changed")
        assertEquals("Darters", selected.text("name")); assertEquals(listOf("p1", "p2", "reserve"), selected.optJSONArray("playerIds")?.strings()); assertEquals(listOf("reserve"), selected.optJSONArray("reserveIds")?.strings())
        assertNull(playerWizardTeam(context, "invented-team"))
    }
    @Test fun wizardSelectionAndCommandKeepRevisionAndScopeExplicit() {
        assertEquals(listOf("a", "b"), playerWizardSelection(listOf("a"), "b", true)); assertEquals(listOf("a"), playerWizardSelection(listOf("a"), "a", true)); assertEquals(emptyList<String>(), playerWizardSelection(listOf("a"), "a", false))
        val command = playerWizardSaveAction("club-a", "draft", 4, 6, playerWizardDefaults())
        for (path in listOf("/theme", "/theme/admin", "/community/feed", "/feed", "/feed/post/post-a", "/clubhouse/club-a", "/clubhouse/actions", "/clubhouse/club-a/channels/channel-a")) {
            assertEquals(path, 8_000_000, playerResponseBudget("https://dartflow.nl/api/player/v1$path?query=ignored"))
            assertEquals(path, 8_000_000, playerResponseBudget("/api$path"))
        }
        for (path in listOf("/matches/id", "/profile", "/theme/actions", "/theme-other", "/community/feedish", "/feed/result/id", "/unknown?next=/theme", "/clubhouse//private", "/%74heme", "/api/player/v1x/theme")) assertEquals(path, 2_000_000, playerResponseBudget(path))
        assertArrayEquals(byteArrayOf(1, 2), playerReadBounded(java.io.ByteArrayInputStream(byteArrayOf(1, 2)), 2))
        assertTrue(runCatching { playerReadBounded(java.io.ByteArrayInputStream(byteArrayOf(1, 2, 3)), 2) }.isFailure)
        assertEquals(4, command.optInt("expectedRevision")); assertEquals("club-a", command.text("clubId")); assertEquals(6, command.optInt("step")); assertFalse(command.has("publishedSeasonId"))
    }
    @Test fun localTimesRejectDstGapsAndRequireAnExplicitOverlapChoice() {
        assertNull(playerClubLocalInstant("2026-03-29T02:30", "Europe/Amsterdam", null))
        assertNull(playerClubLocalInstant("2026-10-25T02:30", "Europe/Amsterdam", null))
        assertEquals("2026-10-25T00:30:00Z", playerClubLocalInstant("2026-10-25T02:30", "Europe/Amsterdam", "+02:00"))
        assertEquals("2026-10-25T01:30:00Z", playerClubLocalInstant("2026-10-25T02:30", "Europe/Amsterdam", "+01:00"))
        assertNull(playerClubLocalInstant("2026-11-31T19:00", "Europe/Amsterdam", null))
    }
    @Test fun wizardCannotAdvanceRequiredStepsWithoutOwnSelections() {
        val config = playerWizardDefaults(); assertNotNull(playerWizardStepError(config, 1)); assertNotNull(playerWizardStepError(config, 2)); assertNotNull(playerWizardStepError(config, 4))
        config.put("title", "League").put("season", "2026").put("organizerName", "Club").put("playerIds", JSONArray(listOf("a", "b"))).put("boardIds", JSONArray(listOf("board")))
        for (step in listOf(1, 2, 3, 4, 5)) assertNull("Step $step", playerWizardStepError(config, step))
        config.obj("planning").put("weekdays", JSONArray()); assertNotNull(playerWizardStepError(config, 5))
    }
    @Test fun channelMergePreservesHistoryAndReplacesOnlyCanonicalMessageIdentity() {
        val older = json("id" to "a", "sequence" to 1, "body" to "oud"); val later = json("id" to "b", "sequence" to 2, "body" to "nieuw")
        val deleted = json("id" to "a", "sequence" to 1, "deleted" to true)
        val merged = playerMergeMessages(listOf(older, later), listOf(deleted))
        assertEquals(listOf("a", "b"), merged.map { it.text("id") }); assertTrue(merged.first().optBoolean("deleted")); assertEquals("nieuw", merged.last().text("body"))
    }
}
