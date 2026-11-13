package nl.dartflow.ochelive

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*

class SecureStoreTest {
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
