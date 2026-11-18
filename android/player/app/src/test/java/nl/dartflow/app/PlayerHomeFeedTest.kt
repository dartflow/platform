package nl.dartflow.app

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlayerHomeFeedTest {
    private val identity = PlayerRequestIdentity("account-a", 1)
    private fun feed(body: String = "Bericht uit mijn vereniging") = JSONObject()
        .put("posts", JSONArray(listOf(JSONObject().put("id", "post-a").put("body", body))))
        .put("scopes", JSONArray(listOf(JSONObject().put("kind", "club").put("id", "club-a").put("canWrite", true))))
        .put("nextCursor", "next-page")
    private fun experience() = JSONObject().put("resume", JSONArray(listOf(JSONObject().put("href", "/wedstrijd/match-a"))))

    @Test fun aStalledFeedDoesNotDelayResumeAndScanActionsOrRequireDashboardRequests() = runTest {
        val releaseFeed = CompletableDeferred<Unit>()
        val experienceReady = CompletableDeferred<Unit>()
        val requested = mutableListOf<String>()
        var current = PlayerUiState(homeFeedLoading = true)
        val load = async {
            fetchPlayerHome(
                request = { path ->
                    requested += path
                    if (path.startsWith("/community/")) { releaseFeed.await(); feed() } else experience()
                },
                onExperience = { current = current.copy(resource = it, loading = false); experienceReady.complete(Unit) },
                onFeed = { current = current.copy(homeFeed = it, homeFeedLoading = false) },
                onExperienceFailure = { throw AssertionError(it) }, onFeedFailure = { throw AssertionError(it) },
            )
        }
        experienceReady.await()
        assertFalse(load.isCompleted)
        assertEquals("/wedstrijd/match-a", current.resource.getJSONArray("resume").getJSONObject(0).getString("href"))
        assertFalse(current.loading)
        releaseFeed.complete(Unit)
        load.await()
        assertEquals(setOf("/player-experience", "/community/feed?kind=my"), requested.toSet())
        assertEquals(2, requested.size)
        assertEquals("next-page", current.homeFeed.getString("nextCursor"))
    }

    @Test fun feedCanAppearEvenWhileExperienceIsStillLoading() = runTest {
        val releaseExperience = CompletableDeferred<Unit>()
        val feedReady = CompletableDeferred<Unit>()
        var current = PlayerUiState(resource = experience())
        val load = async {
            fetchPlayerHome(
                request = { if (it == "/player-experience") { releaseExperience.await(); experience() } else feed() },
                onExperience = { current = current.copy(resource = it, loading = false) },
                onFeed = { current = current.copy(homeFeed = it); feedReady.complete(Unit) },
                onExperienceFailure = { throw AssertionError(it) }, onFeedFailure = { throw AssertionError(it) },
            )
        }
        feedReady.await()
        assertFalse(load.isCompleted)
        assertEquals(1, current.homeFeed.getJSONArray("posts").length())
        assertEquals(1, current.resource.getJSONArray("resume").length())
        releaseExperience.complete(Unit)
        load.await()
    }

    @Test fun aTemporaryFeedFailureKeepsPlayActionsAndCachedPostsWithoutGlobalOfflineOrError() = runTest {
        var current = PlayerUiState(resource = experience(), homeFeed = feed(), homeFeedLoading = true, online = true)
        fetchPlayerHome(
            request = { if (it == "/player-experience") experience() else throw IOException("synthetic outage") },
            onExperience = { current = current.copy(resource = it) }, onFeed = { fail("No successful feed was requested") },
            onExperienceFailure = { throw AssertionError(it) }, onFeedFailure = { current = current.withHomeFeedFailure(it) },
        )
        assertTrue(current.online)
        assertNull(current.error)
        assertFalse(current.homeFeedLoading)
        assertNotNull(current.homeFeedError)
        assertEquals(1, current.homeFeed.getJSONArray("posts").length())
        assertEquals(1, current.resource.getJSONArray("resume").length())
    }

    @Test fun lossOfFeedPermissionClearsPrivatePostsButPreservesPlayActions() {
        for (status in listOf(401, 403, 404)) {
            val current = PlayerUiState(resource = experience(), homeFeed = feed(), homeFeedLoading = true)
                .withHomeFeedFailure(PlayerApiFailure(status, "forbidden", "Deze community is niet beschikbaar."))
            assertEquals(0, current.homeFeed.length())
            assertEquals(1, current.resource.getJSONArray("resume").length())
            assertNull(current.error)
            assertEquals("Deze community is niet beschikbaar.", current.homeFeedError)
        }
    }

    @Test fun malformedFeedIsACommunityErrorAndCannotReplaceAValidPage() = runTest {
        var current = PlayerUiState(homeFeed = feed())
        fetchPlayerHome(
            request = { if (it == "/player-experience") experience() else JSONObject().put("posts", JSONArray()) },
            onExperience = {}, onFeed = { fail("Incomplete feed must not be accepted") },
            onExperienceFailure = { throw AssertionError(it) }, onFeedFailure = { current = current.withHomeFeedFailure(it) },
        )
        assertEquals("Bericht uit mijn vereniging", current.homeFeed.getJSONArray("posts").getJSONObject(0).getString("body"))
        assertNotNull(current.homeFeedError)
    }

    @Test fun anOlderHomeRefreshCannotReplaceTheNewerResponse() = runTest {
        val gate = PlayerHomeReads()
        val older = gate.begin(identity, 1)
        val newer = gate.begin(identity, 1)
        var current = PlayerUiState()
        val releaseOld = CompletableDeferred<Unit>()
        val stale = async {
            releaseOld.await()
            if (gate.accepts(older, identity, 1, PlayerScreen.HOME)) current = current.copy(homeFeed = feed("old"))
        }
        assertTrue(gate.accepts(newer, identity, 1, PlayerScreen.HOME))
        current = current.copy(homeFeed = feed("new"))
        releaseOld.complete(Unit)
        stale.await()
        assertEquals("new", current.homeFeed.getJSONArray("posts").getJSONObject(0).getString("body"))
    }

    @Test fun previousAccountReLoginEpochAndOffscreenReadsCannotPopulateHome() {
        val gate = PlayerHomeReads()
        val read = gate.begin(identity, 4)
        assertTrue(gate.accepts(read, identity, 4, PlayerScreen.HOME))
        assertFalse(gate.accepts(read, PlayerRequestIdentity("account-b", 1), 4, PlayerScreen.HOME))
        assertFalse(gate.accepts(read, identity.copy(generation = 2), 4, PlayerScreen.HOME))
        assertFalse(gate.accepts(read, null, 4, PlayerScreen.HOME))
        assertFalse(gate.accepts(read, identity, 5, PlayerScreen.HOME))
        assertFalse(gate.accepts(read, identity, 4, PlayerScreen.TRAINING))
        val signedOut = PlayerUiState(loading = false)
        assertEquals(0, signedOut.homeFeed.length())
        assertFalse(signedOut.homeFeedLoading)
        assertNull(signedOut.homeFeedError)
        val adopted = PlayerUiState(homeFeed = feed(), homeFeedLoading = true, homeFeedError = "old account").withoutHomeFeed()
        assertEquals(0, adopted.homeFeed.length())
        assertFalse(adopted.homeFeedLoading)
        assertNull(adopted.homeFeedError)
    }

    @Test fun cancellationDoesNotBecomeAVisibleFeedError() = runTest {
        val started = CompletableDeferred<Unit>()
        val suspended = CompletableDeferred<JSONObject>()
        var errors = 0
        val load = launch {
            fetchPlayerHome(
                request = { if (it == "/player-experience") experience() else { started.complete(Unit); suspended.await() } },
                onExperience = {}, onFeed = {}, onExperienceFailure = { errors++ }, onFeedFailure = { errors++ },
            )
        }
        started.await()
        load.cancelAndJoin()
        assertEquals(0, errors)
    }

    @Test fun homeThrottlingNeverDelaysTheNextLiveMatchOrTrainingPoll() {
        val polls = PlayerHomePolls()
        assertTrue(polls.due(PlayerScreen.HOME, 1000))
        polls.started(1000)
        assertFalse(polls.due(PlayerScreen.HOME, 2999))
        // On the next normal 2s tick after opening a match, the old home throttle is irrelevant.
        assertTrue(polls.due(PlayerScreen.MATCH, 3000))
        assertTrue(polls.due(PlayerScreen.TRAINING, 3000))
        assertFalse(polls.due(PlayerScreen.HOME, 15_999))
        assertTrue(polls.due(PlayerScreen.HOME, 16_000))
        polls.started(16_000)
        assertFalse(polls.due(PlayerScreen.HOME, 16_001))
        polls.reset() // Foreground resume obtains a current snapshot even inside the home interval.
        assertTrue(polls.due(PlayerScreen.HOME, 16_001))
    }

    @Test fun existingFeedCursorAndReplyRoutesRemainAvailable() {
        assertEquals("?cursor=next-page", PlayerViewModel.feedQuery("cursor:next-page"))
        val query = PlayerViewModel.feedQuery("kind=club&id=club-a&parentId=post-a&cursor=next-page")
        assertTrue(query.contains("parentId=post-a"))
        assertTrue(query.contains("cursor=next-page"))
    }
}
