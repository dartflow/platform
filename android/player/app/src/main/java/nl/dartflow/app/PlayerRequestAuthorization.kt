package nl.dartflow.app

/** A login instance, rather than only an account ID: signing back in invalidates older work. */
data class PlayerRequestIdentity(val accountId: String, val generation: Int)

class PlayerRequestAuthorization(val identity: PlayerRequestIdentity, val token: String) {
    override fun toString() = "PlayerRequestAuthorization(identity=$identity, token=[redacted])"
}

internal fun playerSessionChanged() = PlayerApiFailure(409, "session_changed", "Je account is gewijzigd. Open de actuele gegevens opnieuw.")

/** Every suspension point is followed by an identity check. A late response or 401 from
 * a previous login can neither trigger current-session recovery nor resend its command. */
internal suspend fun <T> withPlayerRequestAuthorization(
    currentIdentity: () -> PlayerRequestIdentity?,
    bearer: suspend (PlayerRequestIdentity) -> String?,
    unauthorized: (suspend (PlayerRequestAuthorization) -> Unit)?,
    request: suspend (String) -> T,
): T {
    val identity = currentIdentity() ?: throw PlayerApiFailure(401, "unauthorized", "Log in om verder te gaan.")
    fun guard() { if (currentIdentity() != identity) throw playerSessionChanged() }
    val token = bearer(identity) ?: throw PlayerApiFailure(401, "unauthorized", "Log in om verder te gaan.")
    guard()
    val authorization = PlayerRequestAuthorization(identity, token)
    try {
        val result = request(token)
        guard()
        return result
    } catch (failure: PlayerApiFailure) {
        if (failure.status != 401 || unauthorized == null) throw failure
        guard()
        unauthorized(authorization)
        guard()
        val retryToken = bearer(identity) ?: throw PlayerApiFailure(401, "unauthorized", "Log opnieuw in om verder te gaan.")
        guard()
        val result = request(retryToken)
        guard()
        return result
    }
}
