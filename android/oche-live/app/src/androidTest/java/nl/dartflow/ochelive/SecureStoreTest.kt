package nl.dartflow.ochelive

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*

class SecureStoreTest {
    @Test fun confirmedLayoutSurvivesNewStoreInstanceAndCredentialRotation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = SecureStore(context)
        store.write(JSONObject().put("layoutChoice", DisplayLayout("landscape", 2).json()).put("layoutPromptShown", true))
        val restored = SecureStore(context).read()
        assertEquals(DisplayLayout("landscape", 2), DisplayLayout.parse(restored.optJSONObject("layoutChoice")))
        restored.put("refreshToken", "rotated-refresh").put("accessToken", "rotated-access")
        store.write(restored)
        assertEquals(DisplayLayout("landscape", 2), DisplayLayout.parse(SecureStore(context).read().optJSONObject("layoutChoice")))
        store.write(revokedInstallation(restored))
        val revoked = SecureStore(context).read()
        assertFalse(revoked.has("refreshToken")); assertFalse(revoked.has("accessToken"))
        assertEquals(DisplayLayout("landscape", 2), DisplayLayout.parse(revoked.optJSONObject("layoutChoice")))
    }
    @Test fun credentialsAreEncryptedAuthenticatedAndRecoverable() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val store=SecureStore(context)
        val secret="private-installation-test-secret-256-bit"
        store.write(JSONObject().put("installationSecret",secret).put("refreshNonce","durable-request"))
        val raw=context.getSharedPreferences("oche-private-v1",0).getString("state",null)!!
        assertFalse(raw.contains(secret)); assertFalse(raw.contains("durable-request"))
        assertEquals(secret,SecureStore(context).read().getString("installationSecret"))
        context.getSharedPreferences("oche-private-v1",0).edit().putString("state",raw.dropLast(6)+"AAAAAA").commit()
        assertEquals(0,SecureStore(context).read().length())
    }
}
