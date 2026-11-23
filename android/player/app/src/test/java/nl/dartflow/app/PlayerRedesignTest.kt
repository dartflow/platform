package nl.dartflow.app

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class PlayerRedesignTest {
    @Test fun presetsUseExistingCommandsAndExactApprovedRules() {
        val profile = PlayerProfile("actor", "Noor", "noor", "Noor", true, true, true)
        val solo = playerSolo501Action(profile)
        assertEquals("session.create", solo.text("type")); assertEquals(1, solo.rows("players").size)
        assertEquals("actor", solo.rows("players").single().text("accountId")); assertEquals(501, solo.obj("rules").optInt("startScore"))
        assertEquals("single", solo.obj("rules").text("inRule")); assertEquals("double", solo.obj("rules").text("outRule")); assertEquals(1, solo.obj("rules").optInt("bestOfLegs"))
        val local = playerLocal501Action()
        assertEquals("lobby.create", local.text("type")); assertEquals("localone", local.text("setup")); assertEquals(3, local.optInt("bestOfLegs")); assertFalse(local.has("boardId"))
        val bot = playerBot501Action()
        assertEquals("training.create", bot.text("type")); assertEquals("bot", bot.text("mode")); assertEquals(45, bot.optInt("botAverage")); assertEquals(3, bot.optInt("bestOfLegs"))
        for (command in listOf(local, bot)) { assertEquals(501, command.optInt("startScore")); assertEquals("single", command.text("inRule")); assertEquals("double", command.text("outRule")) }
    }
    @Test fun homePromotesLiveBeforeConfirmationAndKeepsTheOriginalReadOnlyProjection() {
        val confirm = json("id" to "confirm", "actionLabel" to "Bevestig de uitslag")
        val live = json("id" to "live", "actionLabel" to "Hervat je partij")
        val experience = json("resume" to JSONArray(listOf(confirm, live)))
        assertSame(live, playerHomeFeatured(experience, emptyList()))
        assertEquals(listOf("confirm", "live"), experience.rows("resume").map { it.text("id") })
        assertSame(confirm, playerHomeFeatured(json("resume" to JSONArray(listOf(confirm))), emptyList()))
        assertNull(playerHomeFeatured(json("resume" to JSONArray()), emptyList()))
    }
    @Test fun clubAgendaIsUpcomingUncanceledChronologicalAndLimitedToThree() {
        val now = Instant.parse("2026-11-23T12:00:00Z")
        val rows = listOf(
            json("id" to "last", "startsAt" to "2026-12-01T12:00:00Z"),
            json("id" to "cancel", "startsAt" to "2026-11-24T12:00:00Z", "status" to "canceled"),
            json("id" to "past", "startsAt" to "2026-11-22T12:00:00Z"),
            json("id" to "third", "startsAt" to "2026-11-26T12:00:00Z"),
            json("id" to "invalid", "startsAt" to "invalid"),
            json("id" to "second", "startsAt" to "2026-11-25T12:00:00Z"),
            json("id" to "first", "startsAt" to "2026-11-24T12:00:00Z"))
        assertEquals(listOf("first", "second", "third"), playerUpcomingActivities(rows, now).map { it.text("id") })
        assertEquals(7, rows.size)
    }
    @Test fun activeAndUpcomingEventsPrecedeArchivedWithoutChangingAccessData() {
        val items = listOf(json("id" to "archive", "status" to "completed"), json("id" to "upcoming", "state" to json("status" to "registration")), json("id" to "live", "status" to "live"))
        assertEquals(listOf("live", "upcoming", "archive"), items.sortedBy(::playerEventPriority).map { it.text("id") })
        assertEquals(3, playerEventPriority(json("state" to json("closed" to true))))
        assertEquals(0, playerEventPriority(json("state" to json("fixtures" to JSONArray(listOf(json("status" to "live")))))))
        assertEquals(1, playerEventPriority(json("state" to json("fixtures" to JSONArray(listOf(json("status" to "scheduled")))))))
    }
    @Test fun freshAuthorizedFreeSessionPrecedesConfirmationButNeverOfficialLive() {
        val session = json("id" to "free", "status" to "active", "participants" to JSONArray(listOf(json("id" to "p1", "name" to "Noor"))), "rules" to playerPlayDefaultRules("x01", 501),
            "game" to json("status" to "live", "sides" to JSONArray(listOf(json("id" to "side", "playerIds" to JSONArray(listOf("p1"))))), "progress" to json("remaining" to JSONArray(listOf(441)))))
        val confirm = json("id" to "confirmation", "actionLabel" to "Bevestig de uitslag")
        val experience = json("resume" to JSONArray(listOf(confirm)))
        val selected = requireNotNull(playerHomeFeatured(experience, emptyList(), listOf(session)))
        assertEquals("/spelen/free", selected.text("href")); assertEquals("Noor", selected.optJSONArray("players")?.optString(0)); assertEquals(441, selected.optJSONArray("remaining")?.optInt(0))
        val live = json("id" to "official", "status" to "live", "actionLabel" to "Hervat je partij")
        assertSame(live, playerHomeFeatured(json("resume" to JSONArray(listOf(confirm, live))), emptyList(), listOf(session)))
        session.put("status", "completed")
        assertSame(confirm, playerHomeFeatured(experience, emptyList(), listOf(session)))
    }
}
