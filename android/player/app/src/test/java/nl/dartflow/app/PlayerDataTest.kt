package nl.dartflow.app

import java.net.URI
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlayerDataTest {
    @Test fun sixAsciiDigitsPreserveLeadingZero() {
        assertTrue(PlayerValidation.validPin("012345"))
        for (invalid in listOf("12345", "1234567", "１２３４５６", "12345a", " 12345", "\n12345")) assertFalse(invalid, PlayerValidation.validPin(invalid))
    }
    @Test fun otpAcceptsCurrentSixToTenDigitServerRange() {
        assertTrue(PlayerValidation.validOtp("12345678"))
        assertTrue(PlayerValidation.validOtp("012345"))
        assertFalse(PlayerValidation.validOtp("12345"))
        assertFalse(PlayerValidation.validOtp("12345678901"))
        assertFalse(PlayerValidation.validOtp("１２３４５６７８"))
    }
    @Test fun usernameNormalizationMatchesServerSingleAtRule() {
        assertEquals("Danny Goldenbelt", PlayerValidation.normalizeUsername(" @Danny   Goldenbelt "))
        assertTrue(PlayerValidation.validUsername("@Danny"))
        assertFalse(PlayerValidation.validUsername("@@Danny"))
        assertFalse(PlayerValidation.validName("Nieuwe speler"))
        assertFalse(PlayerValidation.validName(" \n\t "))
        assertFalse(PlayerValidation.validName("Onzichtbaar\u200B"))
        assertEquals("Café", PlayerValidation.normalizeName("Cafe\u0301"))
        assertEquals("Danny G", PlayerValidation.normalizeName("\uFEFFDanny\u00A0\u00A0G\uFEFF"))
        assertTrue(PlayerValidation.validName("𝑫"))
    }
    @Test fun pkceUsesSha256AndRandomState() {
        val first = PlayerPkce.create(1000)
        val second = PlayerPkce.create(1000)
        assertEquals(43, first.verifier.length)
        assertEquals(43, first.challenge.length)
        assertEquals(43, first.state.length)
        assertNotEquals(first.verifier, second.verifier)
        assertNotEquals(first.state, second.state)
        val known = PlayerPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "state", 0)
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", known.challenge)
        assertFalse(first.toString().contains(first.verifier))
    }
    @Test fun oauthAuthorizationUsesOnlyPublicCodeChallenge() {
        val pkce = PlayerPkce.create(1000)
        val url = PlayerLinks.googleUrl("https://project.supabase.co", "https://dartflow.nl/auth/callback?native_client=nl.dartflow.app", pkce)
        val query = PlayerLinks.query(URI(url))
        assertEquals("google", query["provider"])
        assertEquals(pkce.challenge, query["code_challenge"])
        assertEquals("s256", query["code_challenge_method"])
        assertEquals("nl.dartflow.app", PlayerLinks.query(URI(query.getValue("redirect_to")))["native_client"])
        assertEquals(pkce.state, PlayerLinks.query(URI(query.getValue("redirect_to")))["state"])
        assertFalse(url.contains(pkce.verifier))
    }
    @Test fun authCallbackRequiresMatchingSchemeStateAndTenMinuteWindow() {
        val pkce = PlayerPkce.create(1000)
        val good = "nl.dartflow.app://auth/callback?code=one-use-code&state=${pkce.state}"
        assertNotNull(PlayerLinks.callback(good, "nl.dartflow.app", pkce, 2000))
        assertNull(PlayerLinks.callback(good, "nl.dartflow.app.staging", pkce, 2000))
        assertNull(PlayerLinks.callback(good, "nl.dartflow.app", pkce, 601000))
        assertNull(PlayerLinks.callback(good, "nl.dartflow.app", pkce, 500))
        assertNull(PlayerLinks.callback(good.replace(pkce.state, "bad-state"), "nl.dartflow.app", pkce, 2000))
        assertNull(PlayerLinks.callback(good, "nl.dartflow.app", null, 2000))
    }
    @Test fun authCallbackRejectsDuplicateParametersAndOtherHosts() {
        val pkce = PlayerPkce.create(1000)
        val good = "nl.dartflow.app://auth/callback?code=one-use-code&state=${pkce.state}"
        assertNull(PlayerLinks.callback("$good&state=${pkce.state}", "nl.dartflow.app", pkce, 2000))
        assertNull(PlayerLinks.callback(good.replace("//auth", "//evil"), "nl.dartflow.app", pkce, 2000))
        assertNull(PlayerLinks.callback("$good#access_token=unsafe", "nl.dartflow.app", pkce, 2000))
        assertNull(PlayerLinks.callback(good.replace("//auth", "//user@auth"), "nl.dartflow.app", pkce, 2000))
    }
    @Test fun boardAndMatchLinksAreBoundToTheirEnvironment() {
        val match = PlayerLinks.destination("https://dartflow.nl/wedstrijd/match-1", "https://dartflow.nl")
        assertEquals(PlayerScreen.MATCH, match?.screen)
        assertEquals("match-1", match?.id)
        assertEquals("lane-1", PlayerLinks.destination("https://dartflow.nl/baan/lane-1", "https://dartflow.nl")?.id)
        assertEquals("lane-2", PlayerLinks.destination("https://dartflow.nl/app#baan-phone/lane-2", "https://dartflow.nl")?.id)
        assertNull(PlayerLinks.destination("https://staging.dartflow.nl/baan/lane-1", "https://dartflow.nl"))
        assertNull(PlayerLinks.destination("https://dartflow.nl.evil/baan/lane-1", "https://dartflow.nl"))
        assertNull(PlayerLinks.destination("https://user@dartflow.nl/baan/lane-1", "https://dartflow.nl"))
        assertNull(PlayerLinks.destination("http://dartflow.nl/baan/lane-1", "https://dartflow.nl"))
    }
    @Test fun shortInvitationIsNormalized() {
        assertEquals("K7M2", PlayerLinks.destination("https://dartflow.nl/w/k7m2", "https://dartflow.nl")?.invitationCode)
        assertEquals("K7M2", PlayerLinks.destination("k7m2", "https://dartflow.nl")?.invitationCode)
        val legacy = "aBCdef0123456789-_ABcdef"
        assertEquals(legacy, PlayerLinks.destination("$legacy", "https://dartflow.nl")?.invitationCode)
    }
    @Test fun relativeAndExistingAppRoutesStayNative() {
        assertEquals(PlayerScreen.MATCH, PlayerLinks.destination("/wedstrijd/match-1", "https://dartflow.nl")?.screen)
        assertEquals(PlayerScreen.TRAINING, PlayerLinks.destination("/app/training/session-1", "https://dartflow.nl")?.screen)
        assertEquals("lobby-1", PlayerLinks.destination("/app#lobby/lobby-1", "https://dartflow.nl")?.id)
        assertEquals(PlayerScreen.SEASON, PlayerLinks.destination("/app/seasons/season-1", "https://dartflow.nl")?.screen)
        assertEquals("paircode:ABCD1234", PlayerLinks.destination("https://dartflow.nl/koppel-scherm#code=ABCD1234", "https://dartflow.nl")?.id)
        assertNull(PlayerLinks.destination("//evil.example/baan/lane-1", "https://dartflow.nl"))
    }
    @Test fun statisticsFiltersAndPaginationAreAllowlisted() {
        assertEquals("?startScore=301&offset=25", PlayerViewModel.statisticsQuery("startScore=301&offset=25"))
        assertEquals("", PlayerViewModel.statisticsQuery("startScore=999&offset=-1&token=never-allowed"))
        assertEquals("?search=Danny+G", PlayerViewModel.statisticsQuery("search=Danny%20G"))
        assertEquals("?offset=25", PlayerViewModel.statisticsQuery("offset:25"))
        assertEquals("?startScore=301", PlayerViewModel.statisticsQuery("startScore:301"))
    }
    @Test fun capabilitiesCannotCrossHostEnvironmentOrAuthScheme() {
        val production = JSONObject().put("origin", "https://dartflow.nl").put("local", false).put("auth", JSONObject().put("redirectScheme", "nl.dartflow.app"))
        assertTrue(PlayerViewModel.capabilitiesMatch(production, "https://dartflow.nl", false, "nl.dartflow.app"))
        assertFalse(PlayerViewModel.capabilitiesMatch(production, "https://staging.dartflow.nl", false, "nl.dartflow.app.staging"))
        assertFalse(PlayerViewModel.capabilitiesMatch(production, "https://dartflow.nl", false, "nl.dartflow.app.staging"))
        val development = JSONObject().put("origin", "http://localhost:3000").put("local", true).put("auth", JSONObject().put("redirectScheme", "nl.dartflow.app.dev"))
        assertTrue(PlayerViewModel.capabilitiesMatch(development, "http://127.0.0.1:3000", true, "nl.dartflow.app.dev"))
        assertFalse(PlayerViewModel.capabilitiesMatch(development, "http://127.0.0.1:3000", false, "nl.dartflow.app.dev"))
        assertFalse(PlayerViewModel.capabilitiesMatch(development, "http://127.0.0.1:3001", true, "nl.dartflow.app.dev"))
    }
    @Test fun matchViewConsumesAcceptedServerProjectionAndPermissions() {
        val match = PlayerMatch.parse(JSONObject("""{"id":"match-1","status":"live","revision":9,"players":[{"id":"p1","name":"Danny"},{"id":"p2","name":"Rick"}],"remaining":[88,188],"turn":1,"legNumber":2,"setNumber":1,"permissions":{"canScore":false},"checkout":null}"""))
        assertEquals(listOf(88, 188), match.remaining)
        assertEquals(1, match.turn)
        assertEquals(9, match.revision)
        assertEquals("Rick", match.players[1].name)
        assertFalse(match.permissions.optBoolean("canScore"))
        assertNull(match.checkout)
    }
    @Test fun rawMatchStateFallbackIsSupportedWithoutInventingPermissions() {
        val match = PlayerMatch.parse(JSONObject("""{"match":{"id":"match-1","game":{"remaining":[301,241],"turn":0}}}"""))
        assertEquals(listOf(301, 241), match.remaining)
        assertFalse(match.permissions.optBoolean("canScore"))
    }
    @Test fun retryPreservesRequestIdentityAndExpectedRevision() {
        val input = JSONObject().put("matchId", "match-1").put("expectedRevision", 12).put("action", JSONObject().put("type", "score").put("score", 60))
        val command = NativePlayerCommand.create("/matches/match-1/actions", input)
        assertFalse(input.has("requestId"))
        val restored = NativePlayerCommand.restore(command.forStorage("p1", "https://dartflow.nl"), "p1", "https://dartflow.nl")!!
        assertEquals(command.requestId, restored.requestId)
        assertEquals(12, restored.body.getInt("expectedRevision"))
        assertEquals(command.body.toString(), restored.body.toString())
        assertNotEquals(command.requestId, NativePlayerCommand.create(command.path, input).requestId)
        assertFalse(command.toString().contains("score=60"))
    }
    @Test fun queueCannotCrossAccountOrEnvironment() {
        val command = NativePlayerCommand.create("/platform/actions", JSONObject().put("action", JSONObject().put("type", "lobby.ready")))
        val saved = command.forStorage("p1", "https://dartflow.nl")
        assertNull(NativePlayerCommand.restore(saved, "p2", "https://dartflow.nl"))
        assertNull(NativePlayerCommand.restore(saved, "p1", "https://staging.dartflow.nl"))
        assertNull(NativePlayerCommand.restore(saved, "", "https://dartflow.nl"))
    }
    @Test fun pinBearingOperationsNeverEnterDurableQueue() {
        for (path in listOf("/profile/complete", "/profile/player-pin", "/player-pin/lobby-add", "/seasons/player-pin")) {
            val command = NativePlayerCommand.create(path, JSONObject().put("pin", "012345"))
            assertTrue(command.sensitive)
            assertFalse(command.toString().contains("012345"))
            assertThrows(IllegalStateException::class.java) { command.forStorage("p1", "https://dartflow.nl") }
            val unsafe = JSONObject().put("userId", "p1").put("origin", "https://dartflow.nl").put("path", path).put("body", command.body)
            assertNull(NativePlayerCommand.restore(unsafe, "p1", "https://dartflow.nl"))
        }
        val nested = NativePlayerCommand.create("/platform/actions", JSONObject().put("action", JSONObject().put("pin", "012345")))
        assertTrue(nested.sensitive)
        assertThrows(IllegalStateException::class.java) { nested.forStorage("p1", "https://dartflow.nl") }
    }
}
