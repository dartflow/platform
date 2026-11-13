package nl.dartflow.ochelive

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DisplayModelTest {
    private fun match(revision: Long = 1, visits: List<Visit> = emptyList(), events: List<ScoreEvent> = emptyList(), leg: Int = 1, key: String = "s1") = Match("m1", revision, "live", listOf(Player("Danny",148,0,0,null,0,0), Player("Rick",188,0,0,null,0,0)), 0, 501, leg, 1, visits, events, key)
    @Test fun `clock uses absolute server deadline including exact boundary`() {
        assertEquals(61, secondsRemaining(180_000,119_000))
        assertEquals(60, secondsRemaining(180_000,120_000))
        assertEquals(1, secondsRemaining(180_000,179_999))
        assertEquals(0, secondsRemaining(180_000,180_000))
        assertEquals(0, secondsRemaining(180_000,180_001))
    }
    @Test fun `standby is one 5 10 15 timeline including resume`() {
        for ((elapsed, expected) in listOf(0L to 0, 4_999L to 0, 5_000L to 1, 14_999L to 1, 15_000L to 2, 29_999L to 2,30_000L to 0,65_000L to 1,-1L to 0)) assertEquals(expected, standbySlide(elapsed))
    }
    @Test fun `rows align each players own turn and retain bust remaining`() {
        val visits = listOf(Visit(0,85,416,false),Visit(1,45,456,false),Visit(0,100,316,false),Visit(1,180,456,true),Visit(0,0,316,false))
        val rows=match(visits=visits).rows()
        assertEquals(5,rows.size)
        assertEquals(85,rows[0][0]!!.score); assertEquals(45,rows[0][1]!!.score)
        assertTrue(rows[1][1]!!.bust); assertEquals(456,rows[1][1]!!.remaining)
        assertEquals(0,rows[2][0]!!.score); assertNull(rows[2][1])
    }
    @Test fun `more than five rows never drops source history and leg has own key`() {
        val original = match(visits=(0..7).map { Visit(0,20,501-(it+1)*20,false) })
        assertEquals(8,original.rows().size)
        assertNotEquals(original.legKey, original.copy(leg=2,visits=emptyList()).legKey)
        assertEquals(5,original.copy(leg=2,visits=emptyList()).rows().size)
    }
    @Test fun `solo has one independent column`() {
        val solo=match().copy(players=listOf(Player("Solo",301,0,0,null,0,0)))
        assertEquals(1,solo.rows().first().size)
    }
    @Test fun `initial 180 and reconnect baseline never replay animation`() {
        val cursor=EventCursor(); val maximum=ScoreEvent("e1",1,"score",180,false,false,"Danny")
        assertNull(cursor.observe(match(events=listOf(maximum))))
        assertNull(cursor.observe(match(events=listOf(maximum))))
        cursor.disconnect(); assertNull(cursor.observe(match(2,events=listOf(maximum,maximum.copy(id="e2",revision=2)))))
        assertNotNull(cursor.observe(match(3,events=listOf(maximum,maximum.copy(id="e3",revision=3)))))
        assertNull(cursor.observe(match(3,events=listOf(maximum,maximum.copy(id="e3",revision=3)))))
    }
    @Test fun `bust is no 180 and undo clears cue`() {
        val cursor=EventCursor(); cursor.observe(match())
        assertNull(cursor.observe(match(2,events=listOf(ScoreEvent("b",2,"score",180,true,false,"Danny")))))
        assertNull(cursor.observe(match(4,events=listOf(ScoreEvent("max",3,"score",180,false,false,"Danny"),ScoreEvent("undo",4,"undo",0,false,false,"Danny")))))
        assertNotNull(cursor.observe(match(5,events=listOf(ScoreEvent("finish",5,"score",148,false,true,"Rick")))))
    }
    @Test fun `snapshot reset refuses replay even if event increases`() {
        val cursor=EventCursor();cursor.observe(match())
        assertNull(cursor.observe(match(20,events=listOf(ScoreEvent("e20",20,"score",180,false,false,"Danny"))),true))
    }
    @Test fun `versioned JSON projects actual scores zero bust and trusted deadline`() {
        val json=JSONObject(javaClass.getResource("/live-snapshot.json")!!.readText())
        val snapshot=DisplaySnapshot.parse(json)
        assertEquals("live",snapshot.state); assertEquals(180000L,snapshot.activity!!.deadlineAt)
        assertEquals(listOf(148,188),snapshot.match!!.players.map { it.remaining })
        assertEquals(501,snapshot.match.startScore);assertEquals(2,snapshot.match.rows()[0].size)
        assertEquals(70.6,snapshot.match.players[0].average!!,.01)
        assertFalse(json.toString().contains("installationSecret"))
    }
    @Test(expected=IllegalArgumentException::class) fun `incompatible snapshot requires client upgrade`() { DisplaySnapshot.parse(JSONObject("{\"apiVersion\":2}")) }
    @Test fun `all eleven shared server fixtures parse into read only native view`() {
        for (name in listOf("standby","live","warning","undo","solo","reserved","closed","blocked","unassigned","waiting","result")) {
            val json=JSONObject(javaClass.getResource("/$name.json")!!.readText())
            val snapshot=DisplaySnapshot.parse(json)
            assertEquals(name, snapshot.state.takeUnless { name in listOf("undo","solo") } ?: name)
            if (name == "standby") assertTrue(snapshot.playUrl!!.startsWith(BuildConfig.API_ORIGIN+"/baan/"))
            if (name == "unassigned") assertNull(snapshot.playUrl)
        }
    }
    @Test fun `clocks and identities are stable readable`() { assertEquals("01:00",formatClock(60));assertEquals("00:01",formatClock(1));assertEquals("DA",initials("Danny"));assertEquals("DR",initials("Danny Rick")) }
}
