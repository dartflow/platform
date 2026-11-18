package nl.dartflow.app

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

/** Exercises the exact transport-auth wrapper used by PlayerApi.call, without Android. */
class PlayerAuthorizationRaceTest {
    @Test fun lateUnauthorizedFromAccountACannotClearRefreshOrRetryWithAccountB() = runTest {
        var identity: PlayerRequestIdentity? = PlayerRequestIdentity("account-a", 1)
        var token = "token-a"
        var handlerCalls = 0
        var clearCalls = 0
        var refreshCalls = 0
        val sent = mutableListOf<String>()
        val started = CompletableDeferred<Unit>()
        val respond = CompletableDeferred<Unit>()
        val result = async {
            runCatching {
                withPlayerRequestAuthorization(
                    currentIdentity = { identity },
                    bearer = { expected -> assertEquals(identity, expected); token },
                    unauthorized = {
                        handlerCalls++; clearCalls++; refreshCalls++
                        token = "this-handler-must-never-run"
                    },
                    request = { used ->
                        sent += used; started.complete(Unit); respond.await()
                        throw PlayerApiFailure(401, "unauthorized", "Log opnieuw in.")
                    },
                )
            }.exceptionOrNull()
        }
        started.await()
        identity = PlayerRequestIdentity("account-b", 2)
        token = "token-b"
        respond.complete(Unit)
        val failure = result.await() as PlayerApiFailure
        assertEquals("session_changed", failure.code)
        assertEquals(0, handlerCalls)
        assertEquals(0, clearCalls)
        assertEquals(0, refreshCalls)
        assertEquals(listOf("token-a"), sent)
        assertEquals("token-b", token)
        assertEquals(PlayerRequestIdentity("account-b", 2), identity)
    }

    @Test fun reLoginToSameAccountStillRejectsThePreviousLoginRequest() = runTest {
        var identity: PlayerRequestIdentity? = PlayerRequestIdentity("account-a", 1)
        var handlers = 0
        val failure = runCatching {
            withPlayerRequestAuthorization(
                currentIdentity = { identity }, bearer = { "token-a-old-login" },
                unauthorized = { handlers++ },
                request = { identity = PlayerRequestIdentity("account-a", 2); throw PlayerApiFailure(401, "unauthorized", "Log opnieuw in.") },
            )
        }.exceptionOrNull() as PlayerApiFailure
        assertEquals("session_changed", failure.code)
        assertEquals(0, handlers)
    }

    @Test fun sameLoginCanRefreshItsOwnTokenAndRetryTheSameOperation() = runTest {
        val identity = PlayerRequestIdentity("account-a", 1)
        var token = "token-a-expired"
        var handlers = 0
        val sent = mutableListOf<String>()
        val response = withPlayerRequestAuthorization(
            currentIdentity = { identity }, bearer = { expected -> assertEquals(identity, expected); token },
            unauthorized = { original ->
                assertEquals(identity, original.identity)
                assertEquals("token-a-expired", original.token)
                handlers++; token = "token-a-refreshed"
            },
            request = { used -> sent += used; if (sent.size == 1) throw PlayerApiFailure(401, "unauthorized", "Log opnieuw in.") else "accepted" },
        )
        assertEquals("accepted", response)
        assertEquals(1, handlers)
        assertEquals(listOf("token-a-expired", "token-a-refreshed"), sent)
    }

    @Test fun accountSwitchWhileRecoverySuspendsCannotSendRetry() = runTest {
        var identity: PlayerRequestIdentity? = PlayerRequestIdentity("account-a", 1)
        var token = "token-a"
        val enteredRecovery = CompletableDeferred<Unit>()
        val releaseRecovery = CompletableDeferred<Unit>()
        val sent = mutableListOf<String>()
        val result = async {
            runCatching {
                withPlayerRequestAuthorization(
                    currentIdentity = { identity }, bearer = { token },
                    unauthorized = { enteredRecovery.complete(Unit); releaseRecovery.await() },
                    request = { sent += it; throw PlayerApiFailure(401, "unauthorized", "Log opnieuw in.") },
                )
            }.exceptionOrNull()
        }
        enteredRecovery.await()
        identity = PlayerRequestIdentity("account-b", 2); token = "token-b"
        releaseRecovery.complete(Unit)
        assertEquals("session_changed", (result.await() as PlayerApiFailure).code)
        assertEquals(listOf("token-a"), sent)
    }

    @Test fun successfulLateResponseCannotReturnDataFromAnotherLogin() = runTest {
        var identity: PlayerRequestIdentity? = PlayerRequestIdentity("account-a", 1)
        val failure = runCatching {
            withPlayerRequestAuthorization(
                currentIdentity = { identity }, bearer = { "token-a" }, unauthorized = null,
                request = { identity = PlayerRequestIdentity("account-b", 2); "private-a-data" },
            )
        }.exceptionOrNull() as PlayerApiFailure
        assertEquals("session_changed", failure.code)
    }

    @Test fun tokenProviderAccountSwitchStopsBeforeTheFirstRequest() = runTest {
        var identity: PlayerRequestIdentity? = PlayerRequestIdentity("account-a", 1)
        var sent = 0
        val failure = runCatching {
            withPlayerRequestAuthorization(
                currentIdentity = { identity },
                bearer = { identity = PlayerRequestIdentity("account-b", 2); "token-b" },
                unauthorized = {}, request = { sent++; "accepted" },
            )
        }.exceptionOrNull() as PlayerApiFailure
        assertEquals("session_changed", failure.code)
        assertEquals(0, sent)
    }
}
