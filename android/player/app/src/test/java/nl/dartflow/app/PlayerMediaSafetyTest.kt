package nl.dartflow.app

import android.app.Application
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.*
import org.junit.Test

/** Exercises the actual call teardown path without opening a camera, socket or native peer. */
class PlayerMediaSafetyTest {
    private fun withCall(test: (PlayerVideoCall) -> Unit) {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val call = PlayerVideoCall(Application(), PlayerApi("https://dartflow.nl"), "synthetic-match", scope)
        try { test(call) } finally { call.close(); scope.cancel() }
    }

    @Test fun permanentAccessLossReleasesExistingMediaInsteadOfKeepingItAlive() {
        for (status in listOf(401, 403, 404, 410)) withCall { call ->
            call.open = true
            assertTrue(call.handleSignalingFailure(PlayerApiFailure(status, "blocked", "Access denied")))
            assertFalse("Already established media must close for HTTP $status", call.open)
            assertTrue(call.notice.contains("Camera en microfoon zijn uit"))
            assertTrue(call.notice.contains("blijven scoren"))
        }
    }

    @Test fun temporaryNetworkOrServerFailureKeepsTheExistingCallAvailableForRecovery() {
        for (failure in listOf(IOException("Synthetic connection loss"), PlayerApiFailure(500, "server", "Temporary"), PlayerApiFailure(429, "limited", "Wait"))) withCall { call ->
            call.open = true
            assertFalse(call.handleSignalingFailure(failure))
            assertTrue(call.open)
        }
    }

    @Test fun anOldForbiddenPollCannotCloseAReplacementConnection() = withCall { call ->
        assertTrue(call.handleSignalingFailure(PlayerApiFailure(403, "blocked", "Access denied"), expectedGeneration = 0))
        call.open = true // Replacement generation, after the first teardown.
        assertTrue(call.handleSignalingFailure(PlayerApiFailure(403, "blocked", "Late old response"), expectedGeneration = 0))
        assertTrue("A stale poll must terminate itself without affecting the current call", call.open)
    }
}
