package nl.dartflow.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.*
import org.json.JSONObject
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Uses the same participant-bound TURN/signalling contract as the browser. */
@Composable
fun PlayerMediaRoom(api: PlayerApi, matchId: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val call = remember(api, matchId) { PlayerVideoCall(context.applicationContext, api, matchId, scope) }
    DisposableEffect(call) { onDispose { call.close() } }
    PlayerMediaRoom(call)
}

/** The Activity owns this call above dialogs/consoles so hiding a preview keeps audio/video alive. */
@Composable
internal fun PlayerMediaRoom(call: PlayerVideoCall) {
    val context = LocalContext.current
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.CAMERA] == true && granted[Manifest.permission.RECORD_AUDIO] == true) call.connect()
        else call.notice = "Sta camera en microfoon toe om beeld te delen. Je kunt blijven scoren."
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Samen aan de oche", style = MaterialTheme.typography.titleMedium)
        Text(call.notice, style = MaterialTheme.typography.bodySmall)
        if (call.open) {
            Row(Modifier.fillMaxWidth().height(145.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                VideoSurface(call, true, Modifier.weight(1f).fillMaxHeight())
                VideoSurface(call, false, Modifier.weight(1f).fillMaxHeight())
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = call::switchCamera, enabled = !call.switching) { Text(if (call.switching) "Wisselen…" else "Camera wisselen") }
                OutlinedButton(onClick = call::toggleMicrophone) { Text(if (call.microphone) "Microfoon uit" else "Microfoon aan") }
            }
            OutlinedButton(onClick = call::disconnect) { Text("Beeldverbinding stoppen") }
        }
        Button(enabled = !call.connecting, onClick = {
            if (context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED && context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) call.connect()
            else permissions.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
        }) { Text(if (call.connecting) "Verbinden…" else if (call.open) "Opnieuw verbinden" else "Beeldverbinding starten") }
    }
}

@Composable
private fun VideoSurface(call: PlayerVideoCall, local: Boolean, modifier: Modifier) {
    AndroidView(modifier = modifier, factory = { context ->
        SurfaceViewRenderer(context).also { view ->
            view.init(call.eglContext(), null)
            view.setEnableHardwareScaler(true)
            view.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
            view.setMirror(local)
            call.attach(view, local)
        }
    }, onRelease = { view -> call.detach(view, local); view.release() })
}

private open class PlayerSdpObserver : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String) {}
    override fun onSetFailure(error: String) {}
}

internal class PlayerVideoCall(
    private val context: Context,
    private val api: PlayerApi,
    private val matchId: String,
    private val scope: CoroutineScope,
) {
    var notice by mutableStateOf("Start beeld en geluid wanneer jullie allebei klaar zijn.")
    var open by mutableStateOf(false)
    var connecting by mutableStateOf(false)
    var switching by mutableStateOf(false)
    var microphone by mutableStateOf(true)
    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var audioDevice: JavaAudioDeviceModule? = null
    private var peer: PeerConnection? = null
    private var capturer: CameraVideoCapturer? = null
    private var texture: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var audioSource: AudioSource? = null
    private var localTrack: VideoTrack? = null
    private var remoteTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null
    private var localView: SurfaceViewRenderer? = null
    private var remoteView: SurfaceViewRenderer? = null
    private var polling: Job? = null
    private var connectionJob: Job? = null
    private var peerId = ""
    private var actorId = ""
    private var callId = ""
    private var generation = 0
    private var cursor = 0L
    private val pendingIce = mutableListOf<IceCandidate>()
    private val outgoingIce = mutableListOf<IceCandidate>()
    private var descriptionPublished = false
    private var closed = false
    fun eglContext(): EglBase.Context = requireNotNull(egl).eglBaseContext

    fun attach(view: SurfaceViewRenderer, local: Boolean) {
        if (local) { localView = view; localTrack?.addSink(view) }
        else { remoteView = view; remoteTrack?.addSink(view) }
    }
    fun detach(view: SurfaceViewRenderer, local: Boolean) {
        if (local) { localTrack?.removeSink(view); if (localView === view) localView = null }
        else { remoteTrack?.removeSink(view); if (remoteView === view) remoteView = null }
    }
    fun connect() {
        if (connecting || closed) return
        connecting = true
        connectionJob = scope.launch {
            try {
                val config = api.call("/media/$matchId")
                releaseConnection()
                val currentGeneration = ++generation
                actorId = config.getString("actorId"); peerId = config.getString("peerId")
                val initiator = config.optBoolean("isInitiator")
                PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
                if (egl == null) egl = EglBase.create()
                audioDevice = JavaAudioDeviceModule.builder(context).createAudioDeviceModule()
                factory = PeerConnectionFactory.builder()
                    .setAudioDeviceModule(audioDevice)
                    .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglContext(), true, true))
                    .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglContext())).createPeerConnectionFactory()
                val servers = config.optJSONArray("iceServers")
                val ice = mutableListOf<PeerConnection.IceServer>()
                if (servers != null) for (i in 0 until servers.length()) {
                    val server = servers.getJSONObject(i)
                    val array = server.optJSONArray("urls")
                    val urls = if (array != null) (0 until array.length()).map(array::getString) else listOf(server.getString("urls"))
                    ice += PeerConnection.IceServer.builder(urls).setUsername(server.optString("username")).setPassword(server.optString("credential")).createIceServer()
                }
                val configuration = PeerConnection.RTCConfiguration(ice).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
                peer = factory!!.createPeerConnection(configuration, object : PeerConnection.Observer {
                    override fun onSignalingChange(state: PeerConnection.SignalingState) {}
                    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) { scope.launch {
                        if (generation != currentGeneration) return@launch
                        notice = when (state) { PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> "Beeld en geluid verbonden."
                            PeerConnection.IceConnectionState.FAILED, PeerConnection.IceConnectionState.DISCONNECTED -> "Beeldverbinding onderbroken. Verbind opnieuw; de wedstrijd blijft actief."
                            else -> "Wachten op de andere speler…" }
                    } }
                    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
                    override fun onIceCandidate(candidate: IceCandidate) { scope.launch {
                        if (generation != currentGeneration) return@launch
                        if (!descriptionPublished) outgoingIce.add(candidate)
                        else runCatching { sendIce(candidate) }.onFailure { notice = "Signaalverbinding onderbroken. Je score blijft beschikbaar." }
                    } }
                    override fun onIceCandidatesRemoved(candidates: Array<IceCandidate>) {}
                    override fun onAddStream(stream: MediaStream) {}
                    override fun onRemoveStream(stream: MediaStream) {}
                    override fun onDataChannel(channel: DataChannel) {}
                    override fun onRenegotiationNeeded() {}
                    override fun onAddTrack(receiver: RtpReceiver, streams: Array<MediaStream>) { attachRemote(receiver.track(), currentGeneration) }
                    override fun onTrack(transceiver: RtpTransceiver) { attachRemote(transceiver.receiver.track(), currentGeneration) }
                }) ?: error("Beeldverbinding kon niet worden aangemaakt.")
                val enumerator = Camera2Enumerator(context)
                val cameraName = enumerator.deviceNames.firstOrNull(enumerator::isFrontFacing) ?: enumerator.deviceNames.firstOrNull()
                    ?: error("Geen camera beschikbaar. Je kunt blijven scoren.")
                capturer = enumerator.createCapturer(cameraName, null) ?: error("Camera is niet beschikbaar.")
                videoSource = factory!!.createVideoSource(false)
                texture = SurfaceTextureHelper.create("DartFlowCamera", eglContext())
                capturer!!.initialize(texture, context, videoSource!!.capturerObserver)
                capturer!!.startCapture(640, 480, 24)
                localTrack = factory!!.createVideoTrack("dartflow-video", videoSource)
                audioSource = factory!!.createAudioSource(MediaConstraints())
                audioTrack = factory!!.createAudioTrack("dartflow-audio", audioSource)
                localView?.let { localTrack!!.addSink(it) }
                peer!!.addTrack(localTrack, listOf("dartflow")); peer!!.addTrack(audioTrack, listOf("dartflow"))
                microphone = true; cursor = 0; pendingIce.clear(); outgoingIce.clear(); descriptionPublished = false; callId = ""
                open = true
                notice = if (config.optBoolean("relayConfigured")) "Verbinding opzetten; laat de andere speler ook verbinden." else "Direct verbinden; er is geen relay geconfigureerd."
                acceptSignals(initiator)
                if (initiator) {
                    callId = UUID.randomUUID().toString()
                    val offer = createDescription(true)
                    setDescription(offer, true)
                    signal("offer", JSONObject().put("sdp", JSONObject().put("type", "offer").put("sdp", offer.description)))
                    publishPendingIce()
                }
                polling = scope.launch {
                    while (isActive && generation == currentGeneration) {
                        delay(1000)
                        try { acceptSignals(initiator) }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { notice = "Signaalverbinding onderbroken. Opnieuw synchroniseren…"; delay(1500) }
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { releaseConnection(); notice = "Beeldverbinding niet beschikbaar. Controleer camera- en microfoonrechten en probeer opnieuw. Je kunt blijven scoren." }
            finally { connecting = false }
        }
    }
    private fun attachRemote(track: MediaStreamTrack?, version: Int) { scope.launch {
        if (generation != version || track !is VideoTrack || remoteTrack === track) return@launch
        remoteView?.let { remoteTrack?.removeSink(it) }; remoteTrack = track; remoteView?.let(track::addSink)
    } }
    private suspend fun signal(type: String, payload: JSONObject) {
        api.call("/platform/matches/$matchId/signals", JSONObject().put("requestId", UUID.randomUUID().toString()).put("targetId", peerId).put("type", type).put("payload", payload.put("callId", callId)))
    }
    private suspend fun sendIce(candidate: IceCandidate) {
        signal("ice", JSONObject().put("candidate", JSONObject().put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex).put("candidate", candidate.sdp)))
    }
    private suspend fun publishPendingIce() {
        // Remote peers must receive offer/answer before the first candidate for this call ID.
        while (outgoingIce.isNotEmpty()) sendIce(outgoingIce.removeAt(0))
        descriptionPublished = true
    }
    private suspend fun acceptSignals(initiator: Boolean) {
        val connection = peer ?: return
        val response = api.call("/platform/matches/$matchId/signals?after=$cursor")
        val signals = response.optJSONArray("signals")
        cursor = response.optLong("cursor", cursor)
        if (signals == null) return
        for (i in 0 until signals.length()) {
            val item = signals.getJSONObject(i)
            if (item.optString("actorId") == actorId) continue
            val created = runCatching { java.time.Instant.parse(item.optString("createdAt")).toEpochMilli() }.getOrDefault(0)
            if (created < api.serverNow() - 300_000) continue
            val payload = item.optJSONObject("payload") ?: continue
            val type = item.optString("type")
            val incoming = payload.optString("callId")
            if (type == "offer" && !initiator && incoming.isNotBlank() && connection.signalingState() == PeerConnection.SignalingState.STABLE) {
                val sdp = payload.optJSONObject("sdp") ?: continue
                callId = incoming
                descriptionPublished = false
                setDescription(SessionDescription(SessionDescription.Type.OFFER, sdp.getString("sdp")), false)
                drainIce(connection)
                val answer = createDescription(false); setDescription(answer, true)
                signal("answer", JSONObject().put("sdp", JSONObject().put("type", "answer").put("sdp", answer.description)))
                publishPendingIce()
            } else if (incoming == callId && type == "answer" && connection.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
                val sdp = payload.optJSONObject("sdp") ?: continue
                setDescription(SessionDescription(SessionDescription.Type.ANSWER, sdp.getString("sdp")), false); drainIce(connection)
            } else if (incoming == callId && type == "ice") {
                val value = payload.optJSONObject("candidate") ?: continue
                val candidate = IceCandidate(value.optString("sdpMid"), value.optInt("sdpMLineIndex"), value.optString("candidate"))
                if (connection.remoteDescription != null) connection.addIceCandidate(candidate) else pendingIce += candidate
            } else if (incoming == callId && type in listOf("leave", "hangup")) notice = "De andere speler heeft de beeldverbinding verlaten."
        }
    }
    private fun drainIce(connection: PeerConnection) { pendingIce.forEach { connection.addIceCandidate(it) }; pendingIce.clear() }
    private suspend fun createDescription(offer: Boolean): SessionDescription = suspendCancellableCoroutine { continuation ->
        val observer = object : PlayerSdpObserver() {
            override fun onCreateSuccess(description: SessionDescription) { if (continuation.isActive) continuation.resume(description) }
            override fun onCreateFailure(error: String) { if (continuation.isActive) continuation.resumeWithException(IllegalStateException("SDP niet beschikbaar.")) }
        }
        val connection = peer
        if (connection == null) continuation.resumeWithException(IllegalStateException("Verbinding gesloten."))
        else if (offer) connection.createOffer(observer, MediaConstraints()) else connection.createAnswer(observer, MediaConstraints())
    }
    private suspend fun setDescription(description: SessionDescription, local: Boolean): Unit = suspendCancellableCoroutine { continuation ->
        val observer = object : PlayerSdpObserver() {
            override fun onSetSuccess() { if (continuation.isActive) continuation.resume(Unit) }
            override fun onSetFailure(error: String) { if (continuation.isActive) continuation.resumeWithException(IllegalStateException("SDP geweigerd.")) }
        }
        val connection = peer
        if (connection == null) continuation.resumeWithException(IllegalStateException("Verbinding gesloten."))
        else if (local) connection.setLocalDescription(observer, description) else connection.setRemoteDescription(observer, description)
    }
    fun switchCamera() {
        val camera = capturer ?: return
        if (switching) return
        switching = true
        camera.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(front: Boolean) { scope.launch { switching = false; localView?.setMirror(front); notice = "Camera gewisseld. Geluid en score blijven actief." } }
            override fun onCameraSwitchError(error: String) { scope.launch { switching = false; notice = "Camera wisselen mislukt. Je huidige verbinding blijft actief." } }
        })
    }
    fun toggleMicrophone() { microphone = !microphone; audioTrack?.setEnabled(microphone) }
    fun disconnect() {
        connectionJob?.cancel()
        val leavingPeer = peerId; val leavingCall = callId
        if (leavingPeer.isNotBlank() && leavingCall.isNotBlank()) scope.launch { runCatching {
            api.call("/platform/matches/$matchId/signals", JSONObject().put("requestId", UUID.randomUUID().toString()).put("targetId", leavingPeer).put("type", "leave").put("payload", JSONObject().put("callId", leavingCall)))
        } }
        releaseConnection(); notice = "Camera en microfoon zijn gestopt."
    }
    private fun releaseConnection() {
        generation++; polling?.cancel(); polling = null
        runCatching { capturer?.stopCapture() }; capturer?.dispose(); capturer = null
        peer?.close(); peer?.dispose(); peer = null
        localView?.let { localTrack?.removeSink(it) }; remoteView?.let { remoteTrack?.removeSink(it) }
        localTrack?.dispose(); localTrack = null; remoteTrack = null
        audioTrack?.dispose(); audioTrack = null; videoSource?.dispose(); videoSource = null
        audioSource?.dispose(); audioSource = null; texture?.dispose(); texture = null
        factory?.dispose(); factory = null; audioDevice?.release(); audioDevice = null
        pendingIce.clear(); outgoingIce.clear(); descriptionPublished = false; open = false; switching = false
    }
    fun close() { closed = true; connectionJob?.cancel(); releaseConnection(); egl?.release(); egl = null }
}
