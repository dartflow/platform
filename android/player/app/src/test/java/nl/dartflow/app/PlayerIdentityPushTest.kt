package nl.dartflow.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlayerIdentityPushTest {
    @Test fun handlesShareOneCompatibilityAndCaseNormalization() {
        assertEquals("danny", PlayerValidation.normalizeUsername("@DaNnY"))
        assertEquals("danny", PlayerValidation.normalizeUsername("＠Ｄａｎｎｙ"))
        assertTrue(PlayerValidation.validUsername("@Danny"))
        assertFalse(PlayerValidation.validUsername("@@danny"))
        assertTrue(PlayerValidation.validUsername("d".repeat(80)))
        assertFalse(PlayerValidation.validUsername("d".repeat(81)))
    }
    @Test fun rawWhitespaceAndDefaultIgnorablesCannotBeNormalizedIntoAnAvailableHandle() {
        for (space in listOf(" ", "\t", "\n", "\r", "\u00A0", "\u2007", "\u202F", "\u3000")) for (value in listOf("danny${space}", "${space}danny", "dan${space}ny")) assertFalse(value, PlayerValidation.validUsername(value))
        for (hidden in listOf("\u200B", "\u200D", "\uFEFF", "\u034F", "\uFE0F", "\u2065", "\u115F", "\u3164", String(Character.toChars(0xE0100)))) assertFalse("Hidden codepoint must not identify another account", PlayerValidation.validUsername("dan${hidden}ny"))
    }
    @Test fun displayNamesCanContainSpacesAndDuplicatesRemainDistinctByIdAndHandle() {
        assertTrue(PlayerValidation.validName("Triple Danny"))
        val a = json("id" to "one", "displayName" to "Triple Danny", "username" to "danny")
        val b = json("id" to "two", "displayName" to "Triple Danny", "username" to "danny2")
        assertEquals(playerPublicName(a), playerPublicName(b))
        assertNotEquals(playerPublicHandle(a), playerPublicHandle(b))
        assertNotEquals(a.text("id"), b.text("id"))
    }
    @Test fun searchUsesOnlyPublicNamesAndHandles() {
        val player = json("id" to "fixed-id", "displayName" to "De Pijl", "username" to "danny", "fullName" to "Privé Achternaam", "email" to "private@example.test", "name" to "Ambiguous legacy text")
        assertTrue(playerSearchMatches(player, "DE PIJL"))
        assertTrue(playerSearchMatches(player, "@ＤＡＮＮＹ"))
        for (query in listOf("Privé", "private@example", "Ambiguous")) assertFalse(query, playerSearchMatches(player, query))
        assertEquals("De Pijl", playerPublicName(player))
        val projected = playerPublicSearchResult(player)
        assertFalse(projected.has("fullName")); assertFalse(projected.has("email")); assertEquals("De Pijl", projected.text("name"))
        assertEquals("Speler", playerPublicSearchResult(json("id" to "legacy", "name" to "Ambiguous private name", "fullName" to "Private")).text("name"))
        assertEquals("Speler", playerPublicName(json("fullName" to "Private", "email" to "private@example.test")))
    }
    @Test fun committedHandleIsNeverSentInMutableProfileUpdates() {
        val profile = PlayerProfile("fixed-id", "De Pijl", "danny", "De Pijl", displayNameConfirmed = true, fullName = "Private Name", usernameLocked = true)
        val action = playerIdentityUpdate(profile, "Gewijzigde Privénaam", "Triple Danny", "different-handle")
        assertEquals("profile.update", action.text("type"))
        assertEquals("Triple Danny", action.text("displayName"))
        assertEquals("Gewijzigde Privénaam", action.text("fullName"))
        assertFalse(action.has("name")); assertFalse(action.has("username")); assertFalse(action.has("id"))
        assertTrue(playerIdentityUpdate(profile, "", "De Pijl", "danny").isNull("fullName"))
        assertTrue(PlayerValidation.validFullName("N".repeat(160)))
        assertFalse(PlayerValidation.validFullName("N".repeat(161)))
    }
    @Test fun firstHandleUpdateIsCanonicalAndNeverUsesLegacyNameAlias() {
        val action = playerIdentityUpdate(PlayerProfile("one", "Speler"), "", "De Pijl", "@ＤＡＮＮＹ")
        assertEquals("danny", action.text("username")); assertFalse(action.has("name"))
        assertThrows(IllegalArgumentException::class.java) { playerIdentityUpdate(PlayerProfile("one", "Speler"), "", "De Pijl", "danny ") }
    }
    @Test fun avatarNeverLoadsInsecureOrCredentialBearingUrls() {
        assertEquals("https://images.example.test/avatar.png", playerAvatarUrl("https://images.example.test/avatar.png"))
        for (url in listOf("http://images.example.test/a.png", "https://user:secret@images.example.test/a.png", "file:///private.png", "https://images.example.test:444/a.png")) assertNull(playerAvatarUrl(url))
    }
    @Test fun modernRegistrationSeparatesFirebaseFidAndDartFlowInstallation() {
        val action = playerPushRegistration("11111111-1111-4111-8111-111111111111", "nl.dartflow.app.staging", "cFirebaseInstallationId")
        assertEquals("device.register", action.text("type")); assertEquals("26.0.2", action.text("sdkVersion"))
        assertEquals("cFirebaseInstallationId", action.text("firebaseInstallationId")); assertFalse(action.has("token")); assertFalse(action.has("accessToken")); assertFalse(action.has("actorId"))
        assertEquals("dartflow-1", playerPushChannelId("Wedstrijden"))
        assertFalse(playerPushCategoryEnabled(json("preferences" to JSONArray(listOf(json("category" to "Sociaal", "enabled" to false)))), "Sociaal"))
        assertFalse(playerPushCategoryEnabled(JSONObject(), "Arbitrary channel"))
    }
    @Test fun providerAcceptanceNeverClaimsDeviceDisplayOrReception() {
        val accepted = playerPushDiagnosticLabel(json("providerAccepted" to true))
        assertTrue(accepted.contains("ontvangst nog niet bevestigd")); assertFalse(accepted.contains("weergegeven"))
        assertTrue(playerPushDiagnosticLabel(json("providerAccepted" to true, "receivedAt" to "2026-11-19T12:00:00Z")).startsWith("Door de app"))
        assertTrue(playerPushDiagnosticLabel(json("openedAt" to "2026-11-19T12:00:00Z")).startsWith("Op dit toestel geopend"))
    }
    @Test fun pendingNotificationKeepsOnlyOpaqueDestinationForItsEnvironment() {
        val id = "11111111-1111-4111-8111-111111111111"
        assertEquals(id, playerPendingNotification(json("id" to id, "origin" to "https://dartflow.nl"), "https://dartflow.nl"))
        assertNull(playerPendingNotification(json("id" to id, "origin" to "https://staging.dartflow.nl"), "https://dartflow.nl"))
        assertNull(playerPendingNotification(json("id" to "https://evil.example", "origin" to "https://dartflow.nl"), "https://dartflow.nl"))
    }
    @Test fun officialLobbyRequiresTwoDistinctConfirmedPlannedIdentitiesAndHasARealExpiry() {
        val lobby = json("status" to "waiting", "expiresAt" to "2026-11-19T12:00:00Z", "players" to JSONArray(listOf(json("id" to "one", "confirmed" to true), json("id" to "two", "confirmed" to false))))
        assertTrue(playerCompetitionLobbyOpen(lobby, java.time.Instant.parse("2026-11-19T11:59:59Z").toEpochMilli()))
        assertFalse(playerCompetitionLobbyOpen(lobby, java.time.Instant.parse("2026-11-19T12:00:00Z").toEpochMilli()))
        assertFalse(playerCompetitionLobbyConfirmed(lobby)); assertEquals("two", playerCompetitionPinTarget(lobby, "one")?.text("id"))
        lobby.getJSONArray("players").getJSONObject(1).put("confirmed", true)
        assertTrue(playerCompetitionLobbyConfirmed(lobby))
        lobby.getJSONArray("players").getJSONObject(1).put("id", "one")
        assertFalse(playerCompetitionLobbyConfirmed(lobby))
    }
    @Test fun officialLobbyCommandsRetainScheduledSourcesAndNeverPersistPin() {
        val candidate = json("seasonId" to "season", "fixtureId" to "fixture", "slotId" to "slot", "opponent" to json("id" to "untrusted"), "settings" to json("startScore" to 301))
        val action = playerCompetitionOpenAction("board", candidate)
        assertEquals("fixture", action.text("fixtureId")); assertEquals("slot", action.text("slotId"))
        assertFalse(action.has("players")); assertFalse(action.has("settings")); assertFalse(action.has("opponent"))
        val pin = NativePlayerCommand.create("/competition-lobbies/player-pin", json("lobbyId" to "lobby", "username" to "opponent", "pin" to "012345"))
        assertTrue(pin.sensitive); assertThrows(IllegalStateException::class.java) { pin.forStorage("one", "https://dartflow.nl") }; assertFalse(pin.toString().contains("012345"))
    }
}
