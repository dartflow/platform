package nl.dartflow.app

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

internal data class PlayerHomeRead(val sequence: Long, val identity: PlayerRequestIdentity, val snapshot: Long)

/** Home keeps no disk cache and never reuses a response from a previous login or request. */
internal class PlayerHomeReads {
    private var sequence = 0L
    fun begin(identity: PlayerRequestIdentity, snapshot: Long) = PlayerHomeRead(++sequence, identity, snapshot)
    fun accepts(read: PlayerHomeRead, identity: PlayerRequestIdentity?, snapshot: Long, screen: PlayerScreen): Boolean =
        read.sequence == sequence && read.identity == identity && read.snapshot == snapshot && screen == PlayerScreen.HOME
}

/** Independent sources publish as soon as each is ready; unavailable community cannot hide play actions. */
internal suspend fun fetchPlayerHome(
    request: suspend (String) -> JSONObject,
    onExperience: (JSONObject) -> Unit,
    onFeed: (JSONObject) -> Unit,
    onExperienceFailure: (Exception) -> Unit,
    onFeedFailure: (Exception) -> Unit,
) = coroutineScope {
    launch {
        try { onExperience(request("/player-experience")) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { onExperienceFailure(failure) }
    }
    launch {
        try {
            val feed = request("/community/feed?kind=my")
            if (feed.optJSONArray("posts") == null || feed.optJSONArray("scopes") == null) throw IOException("Ongeldige communitygegevens.")
            onFeed(feed)
        }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { onFeedFailure(failure) }
    }
}

internal fun PlayerUiState.withHomeFeedFailure(failure: Exception): PlayerUiState {
    val permissionLost = failure is PlayerApiFailure && failure.status in listOf(401, 403, 404)
    return copy(
        homeFeed = if (permissionLost) JSONObject() else homeFeed,
        homeFeedLoading = false,
        homeFeedError = if (failure is PlayerApiFailure) failure.feedback else "De community is tijdelijk niet bereikbaar. Je kunt gewoon spelen.",
    )
}

internal fun PlayerUiState.withoutHomeFeed(): PlayerUiState =
    copy(homeFeed = JSONObject(), homeFeedLoading = false, homeFeedError = null)

/** Keep the regular live tick; throttle only home reads, so navigation never inherits a long sleep. */
internal class PlayerHomePolls {
    private var lastHomeReadAt: Long? = null
    fun reset() { lastHomeReadAt = null }
    fun started(now: Long) { lastHomeReadAt = now }
    fun due(screen: PlayerScreen, now: Long): Boolean {
        if (screen != PlayerScreen.HOME) return true
        val last = lastHomeReadAt ?: return true
        return now - last >= 15_000
    }
}
