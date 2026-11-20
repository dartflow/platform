package nl.dartflow.ochelive

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DisplayModelTest {
    @Test fun `competition lobby is optional public state with absolute expiry`() {
        val root = JSONObject("""{"apiVersion":1,"state":"standby","serverNow":1000,"display":{"snapshot":{"competitionLobby":{"competitionName":"Clubleague","round":3,"players":[{"name":"De Pijl","confirmed":true,"pin":"never projected"},{"name":"Noor","confirmed":false}],"writerName":"De Pijl","expiresAt":"2026-11-19T12:00:00Z"}}}}""")
        val parsed = DisplaySnapshot.parse(root)
        assertNull(parsed.match); assertEquals("Clubleague", parsed.competitionLobby!!.competitionName)
        assertEquals(listOf("De Pijl" to true, "Noor" to false), parsed.competitionLobby.players)
        assertEquals(java.time.Instant.parse("2026-11-19T12:00:00Z").toEpochMilli(), parsed.competitionLobby.expiresAt)
        assertFalse(parsed.competitionLobby.toString().contains("pin"))
        root.getJSONObject("display").getJSONObject("snapshot").getJSONObject("competitionLobby").put("expiresAt", "invalid")
        assertNull(DisplaySnapshot.parse(root).competitionLobby)
    }
    @Test fun `two clear cap is optional and reflects the published rule`() {
        val data = JSONObject("""{"apiVersion":1,"state":"live","serverNow":1000,"display":{"snapshot":{"match":{"id":"m1","status":"live","players":[{"name":"Danny"},{"name":"Rick"}],"settings":{"legWinByTwo":{"maximum":9},"setWinByTwo":{"maximum":5}}}}}}""")
        val parsed = DisplaySnapshot.parse(data).match!!
        assertEquals(9, parsed.legWinByTwo); assertEquals(5, parsed.setWinByTwo); assertTrue(parsed.winByTwoLabel.contains("Legs 2 verschil/cap 9")); assertTrue(parsed.winByTwoLabel.contains("Sets 2 verschil/cap 5"))
        assertEquals("", parsed.copy(legWinByTwo = null, setWinByTwo = null).winByTwoLabel)
    }
    @Test fun `bull projection waits for both signatures and never becomes a score visit`() {
        val data = JSONObject("""{"apiVersion":1,"state":"live","serverNow":1000,"display":{"snapshot":{"match":{"id":"m1","revision":3,"status":"live","players":[{"name":"Danny"},{"name":"Rick"}],"remaining":[501,501],"bull":{"reason":"deciding-leg","status":"throwing","round":2,"order":[1,0],"throws":[{"round":1,"side":0,"hit":"DB"},{"round":1,"side":1,"hit":"DB"}],"confirmed":[false,false]},"startDecision":{"procedure":"bull","starter":0,"ruleVersion":1}}}}}""")
        var parsed = DisplaySnapshot.parse(data).match!!
        assertFalse(parsed.canShowTurn); assertTrue(parsed.bullPending); assertTrue(parsed.bullLabel!!.contains("Rick")); assertEquals("Opnieuw bullen", parsed.statusLabel); assertTrue(parsed.visits.isEmpty())
        data.getJSONObject("display").getJSONObject("snapshot").getJSONObject("match").getJSONObject("bull").put("status", "complete").put("winner", 1).put("confirmed", org.json.JSONArray(listOf(true,true)))
        parsed = DisplaySnapshot.parse(data).match!!; assertTrue(parsed.canShowTurn); assertFalse(parsed.bullPending); assertEquals(0, parsed.startDecision!!.starter)
    }
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
    @Test fun `pause and interruption preserve the score without advertising a turn`() {
        val json=JSONObject(javaClass.getResource("/live-snapshot.json")!!.readText())
        val source=json.getJSONObject("display").getJSONObject("snapshot").getJSONObject("match")
        source.put("paused",true)
        val paused=DisplaySnapshot.parse(json).match!!
        assertEquals(listOf(148,188),paused.players.map { it.remaining })
        assertEquals("Gepauzeerd",paused.statusLabel)
        assertFalse(paused.canShowTurn)
        source.put("paused",false).put("status","interrupted")
        val interrupted=DisplaySnapshot.parse(json).match!!
        assertEquals("Onderbroken",interrupted.statusLabel)
        assertFalse(interrupted.canShowTurn)
        assertFalse(interrupted.finished)
    }
    @Test fun `result distinguishes provisional published and under review using the real winner`() {
        val json=JSONObject(javaClass.getResource("/live-snapshot.json")!!.readText())
        val source=json.getJSONObject("display").getJSONObject("snapshot").getJSONObject("match")
        val winnerId=source.getJSONArray("players").getJSONObject(1).getString("id")
        source.put("status","result").put("winnerId",winnerId).put("resultPublished",false)
        val result=DisplaySnapshot.parse(json).match!!
        assertTrue(result.finished)
        assertFalse(result.canShowTurn)
        assertEquals("Rick",result.winnerName)
        assertEquals("Voorlopige uitslag",result.statusLabel)
        source.put("status","confirmed").put("resultPublished",true)
        assertEquals("Uitslag bevestigd",DisplaySnapshot.parse(json).match!!.statusLabel)
        source.put("status","disputed")
        assertEquals("Uitslag in behandeling",DisplaySnapshot.parse(json).match!!.statusLabel)
        source.put("winnerId","unknown-player")
        assertNull(DisplaySnapshot.parse(json).match!!.winnerName)
    }
    @Test fun `legacy finished snapshot keeps the completed leg scorecard`() {
        val json=JSONObject(javaClass.getResource("/live-snapshot.json")!!.readText())
        val source=json.getJSONObject("display").getJSONObject("snapshot").getJSONObject("match")
        source.put("visits",source.getJSONArray("currentLegVisits"))
        source.remove("legNumber"); source.remove("currentLegVisits")
        source.put("status","result").put("legs",org.json.JSONArray("[1,0]"))
        val result=DisplaySnapshot.parse(json).match!!
        assertEquals(1,result.leg)
        assertFalse(result.visits.isEmpty())
    }
    @Test fun `scan carousel requires an allowed public board url`() {
        val json=JSONObject(javaClass.getResource("/standby.json")!!.readText())
        assertTrue(DisplaySnapshot.parse(json).publicStandby)
        json.getJSONObject("display").getJSONObject("board").put("publicScan",false)
        val privateBoard=DisplaySnapshot.parse(json)
        assertFalse(privateBoard.publicStandby)
        assertNull(privateBoard.playUrl)
    }
    @Test fun `offline restart restores public snapshot only with a retained grant`() {
        val json=JSONObject(javaClass.getResource("/live-snapshot.json")!!.readText())
        val saved=JSONObject().put("lastSnapshot",json)
        assertNull(cachedDisplay(saved))
        saved.put("refreshToken","test-refresh")
        val restored=cachedDisplay(saved)!!
        assertEquals("live",restored.state)
        assertEquals(listOf(148,188),restored.match!!.players.map { it.remaining })
        saved.getJSONObject("lastSnapshot").put("apiVersion",2)
        assertNull(cachedDisplay(saved))
        assertNull(cachedDisplay(JSONObject().put("refreshToken","test-refresh")))
    }
    @Test fun `configured in out and handicap starts keep the two scorecard sides stable`() {
        val json=JSONObject(javaClass.getResource("/live-snapshot.json")!!.readText())
        val source=json.getJSONObject("display").getJSONObject("snapshot").getJSONObject("match")
        source.getJSONObject("settings").put("inRule","double").put("outRule","master").put("sideStartScores",org.json.JSONArray("[301,701]"))
        val configured=DisplaySnapshot.parse(json).match!!
        assertEquals("double",configured.inRule);assertEquals("master",configured.outRule)
        assertEquals(listOf(301,701),configured.sideStartScores)
        assertEquals(listOf("–","301","701","–"),configured.startRow)
        assertEquals("301 / 701",configured.startLabel)
        assertEquals("Dubbel in · Master uit",configured.rulesLabel)
        assertEquals(configured.startRow,configured.copy(turn=1).startRow)
        assertEquals("Straight uit",configured.copy(inRule="single",outRule="straight").rulesLabel)
        val legacy=match();assertEquals("Dubbel uit",legacy.rulesLabel);assertEquals(listOf("–","501","501","–"),legacy.startRow)
        assertEquals(listOf("–","301"),configured.copy(players=configured.players.take(1)).startRow)
    }
    @Test fun `team snapshots retain side names partners and authoritative current thrower`() {
        val json=JSONObject(javaClass.getResource("/live-snapshot.json")!!.readText())
        val source=json.getJSONObject("display").getJSONObject("snapshot").getJSONObject("match")
        source.put("sideNames",org.json.JSONArray(listOf("Noord", "Zuid")))
        source.put("sideParticipants",org.json.JSONArray(listOf(org.json.JSONArray(listOf(JSONObject("{\"id\":\"p1\",\"name\":\"Danny\"}"),JSONObject("{\"id\":\"p3\",\"name\":\"Noor\"}"))),org.json.JSONArray(listOf(JSONObject("{\"id\":\"p2\",\"name\":\"Rick\"}"),JSONObject("{\"id\":\"p4\",\"name\":\"Sam\"}"))))))
        source.put("currentThrower",JSONObject("{\"id\":\"p3\",\"displayName\":\"Noor\"}"))
        val match=DisplaySnapshot.parse(json).match!!
        assertEquals(listOf("Noord","Zuid"),match.players.map { it.name })
        assertEquals(listOf("Danny","Noor"),match.players[0].partners)
        assertEquals("Noor",match.currentThrowerName)
        source.remove("currentThrower");source.remove("sideNames")
        val withoutThrower=DisplaySnapshot.parse(json).match!!
        assertNull(withoutThrower.currentThrowerName)
        assertEquals("Danny & Noor",withoutThrower.players[0].name)
    }
    @Test fun `cricket uses marks points and credited marks instead of x01 rest scores`() {
        val json=JSONObject(javaClass.getResource("/live-snapshot.json")!!.readText())
        val source=json.getJSONObject("display").getJSONObject("snapshot").getJSONObject("match")
        source.getJSONObject("settings").put("discipline","cricket").put("cricketMode","no-score")
        source.put("cricket",JSONObject("{\"marks\":[[9,2,1,0,0,0,3],[0,3,0,0,0,0,1]],\"points\":[40,0]}"))
        source.put("visits",org.json.JSONArray("[{\"playerIndex\":0,\"darts\":3,\"cricket\":{\"creditedMarks\":5}},{\"playerIndex\":1,\"darts\":3,\"cricket\":{\"creditedMarks\":9}}]"))
        val match=DisplaySnapshot.parse(json).match!!
        assertEquals("CRICKET",match.startLabel)
        assertEquals("Cricket · zonder punten",match.rulesLabel)
        assertEquals(listOf(40,0),match.cricket!!.points)
        assertEquals(3,match.cricket!!.marks[0][0])
        assertEquals(5.0,match.cricket!!.mpr[0]!!,0.001)
    }
    @Test fun `cricket points never trigger an x01 maximum or high checkout celebration`() {
        val cursor=EventCursor()
        val baseline=match().copy(cricket=Cricket(listOf(emptyList(),emptyList()),listOf(0,0),listOf(null,null),"standard"))
        cursor.observe(baseline)
        assertNull(cursor.observe(baseline.copy(revision=1,events=listOf(ScoreEvent("cricket-points",1,"score",180,false,false,"Danny")))))
        assertNull(cursor.observe(baseline.copy(revision=2,events=listOf(ScoreEvent("cricket-win",2,"score",120,false,true,"Danny")))))
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
    @Test fun `only recognized versioned display themes are applied including cached snapshots`() {
        val data = JSONObject("""{"apiVersion":1,"state":"standby","serverNow":1000,"display":{"snapshot":{"theme":{"id":"onzetrots","version":1}}}}""")
        assertEquals("onzetrots", DisplaySnapshot.parse(data).theme)
        assertEquals("onzetrots", cachedDisplay(JSONObject().put("refreshToken", "synthetic-retained-grant").put("lastSnapshot", data))!!.theme)
        val theme = data.getJSONObject("display").getJSONObject("snapshot").getJSONObject("theme")
        theme.put("id", "unknown"); assertEquals("dartflow", DisplaySnapshot.parse(data).theme)
        theme.put("id", "onzetrots").put("version", 2); assertEquals("dartflow", DisplaySnapshot.parse(data).theme)
        data.remove("display"); assertEquals("dartflow", DisplaySnapshot.parse(data).theme)
    }

    @Test fun `encounter projection preserves component points and actual legs separately`() {
        val data = JSONObject("""{"apiVersion":1,"state":"live","serverNow":1000,"display":{"snapshot":{"encounter":{"name":"Landelijke teams","homeName":"Team Zee","awayName":"Team Duin","score":[3,2],"legs":[13,11],"component":{"index":5,"label":"Dubbel 2"}}}}}""")
        val encounter = DisplaySnapshot.parse(data).encounter!!
        assertEquals(listOf(3,2), encounter.score); assertEquals(listOf(13,11), encounter.legs)
        assertEquals("Team Zee", encounter.homeName); assertEquals("Team Duin", encounter.awayName)
        assertEquals(5, encounter.componentIndex); assertEquals("Dubbel 2", encounter.componentLabel)
        data.getJSONObject("display").getJSONObject("snapshot").remove("encounter")
        assertNull(DisplaySnapshot.parse(data).encounter)
    }

    @Test fun `precall is an optional public expectation independent of the live match`() {
        val data = JSONObject("""{"apiVersion":1,"state":"live","serverNow":1000,"display":{"snapshot":{"pendingCall":{"label":"Vooroproep · wacht op definitieve toewijzing","players":["Noor","Danny"],"writerName":"Rick"}}}}""")
        val call = DisplaySnapshot.parse(data).pendingCall!!
        assertEquals(listOf("Noor","Danny"), call.players); assertEquals("Rick", call.writerName)
        assertTrue(call.label.contains("wacht op definitieve toewijzing"))
        assertNull(DisplaySnapshot.parse(data).match)
        data.getJSONObject("display").getJSONObject("snapshot").remove("pendingCall")
        assertNull(DisplaySnapshot.parse(data).pendingCall)
    }

}
