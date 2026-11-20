package nl.dartflow.ochelive

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ClubDisplayThemeTest {
    private fun theme(until: Long = 61_000) = JSONObject().put("id", "club").put("version", 1).put("name", "Blauwe club").put("brandingRevision", 3).put("logoData", JSONObject.NULL).put("validUntil", Instant.ofEpochMilli(until).toString()).put("tokens", JSONObject().put("light", tokens()).put("dark", tokens()))
    private fun tokens() = JSONObject(mapOf("background" to "#06182F", "surface" to "#0C2856", "surfaceRaised" to "#173B69", "border" to "#89A9CD", "text" to "#FFFFFF", "muted" to "#C3D5EE", "primary" to "#A8CEFF", "onPrimary" to "#06182F", "secondary" to "#FFD800", "focus" to "#A8CEFF", "success" to "#91E5A6", "warning" to "#FFD47A", "error" to "#FFADAD"))
    @Test fun `club theme parser requires safe complete public tokens and capped expiry`() {
        val payload = theme(3_601_000).put("accountId", "private-account-must-not-project").put("accessToken", "private-token-must-not-project")
        val parsed = requireNotNull(ClubDisplayTheme.parse(payload, 1000))
        assertEquals("Blauwe club", parsed.name); assertEquals(3, parsed.brandingRevision); assertEquals(301_000, parsed.validUntil); assertEquals(13, parsed.tokens.size)
        assertFalse(parsed.toString().contains("private-account-must-not-project")); assertFalse(parsed.toString().contains("private-token-must-not-project"))
        val root = JSONObject().put("apiVersion", 1).put("state", "waiting-for-board").put("serverNow", 1000).put("theme", payload)
        val snapshot = DisplaySnapshot.parse(root); assertEquals("club", snapshot.theme); assertEquals("Blauwe club", snapshot.clubTheme?.name); assertNull(snapshot.match)
        payload.getJSONObject("tokens").getJSONObject("dark").put("primary", "url(unsafe)"); assertNull(ClubDisplayTheme.parse(payload, 1000)); assertEquals("dartflow", DisplaySnapshot.parse(root).theme)
        assertNull(ClubDisplayTheme.parse(theme().put("version", 2), 1000)); assertNull(ClubDisplayTheme.parse(theme().put("logoData", "data:image/svg+xml;base64,PHN2Zz4="), 1000))
        val unreadable = theme(); unreadable.getJSONObject("tokens").getJSONObject("dark").put("onPrimary", "#A8CEFF"); assertNull(ClubDisplayTheme.parse(unreadable, 1000))
        assertFalse(ocheSafeLogo("https://example.test/image.png")); assertFalse(ocheSafeLogo("data:image/webp;base64,bm90LWFuLWltYWdl"))
    }
    @Test fun `club theme expires at original server deadline without trusting restart cache`() {
        val brand = requireNotNull(ClubDisplayTheme.parse(theme(), 1000))
        val snapshot = DisplaySnapshot("standby", 1000, "event", 1, "Baan 1", "Scherm", "location", null, null, null, null, theme = "club", clubTheme = brand)
        val screen = DisplayUi.Screen(snapshot, 1000, 100)
        assertEquals(brand, screen.activeClubTheme(100)); assertEquals(brand, screen.activeClubTheme(60_099)); assertNull(screen.activeClubTheme(60_100)); assertNull(screen.activeClubTheme(300_000))
        assertNull(screen.copy(cached = true).activeClubTheme(100))
        assertEquals(brand.validUntil, screen.activeClubTheme(1000)?.validUntil)
        val revoked = snapshot.copy(theme = "dartflow", clubTheme = null); assertNull(screen.copy(snapshot = revoked).activeClubTheme(100))
        assertNull(ClubDisplayTheme.parse(theme(until = 1000), 1000))
    }
}
