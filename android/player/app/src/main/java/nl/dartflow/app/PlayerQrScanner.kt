package nl.dartflow.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.SurfaceTexture
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Size
import android.view.Surface
import android.view.TextureView
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.util.concurrent.atomic.AtomicBoolean

@Composable internal fun PlayerQrScanner(onCode: (String) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    var allowed by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var error by remember { mutableStateOf<String?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> allowed = granted; if (!granted) error = "Camera niet toegestaan. Je kunt een baanlink of wedstrijdcode handmatig invoeren." }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var active by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> when (event) { Lifecycle.Event.ON_RESUME -> active = true; Lifecycle.Event.ON_PAUSE -> active = false; else -> Unit } }
        lifecycle.addObserver(observer); onDispose { lifecycle.removeObserver(observer) }
    }
    BackHandler(onBack = onClose)
    Column(Modifier.fillMaxSize().background(PlayerInk).safeDrawingPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Heading("Scan de baan-QR", "ALLEEN OP DIT APPARAAT", "Houd de QR-code rustig in beeld. Camerabeelden verlaten je telefoon niet en worden niet opgeslagen.")
        if (!allowed) ScannerPermissionPanel(error, { request.launch(Manifest.permission.CAMERA) }, onClose)
        else {
            error?.let { Notice(it, true) }
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                if (active && error == null) key(revision) { CameraQrPreview(onCode, { error = it }, Modifier.fillMaxSize()) }
                else Text(if (error == null) "Scanner gepauzeerd" else "Scanner niet beschikbaar", color = PlayerMuted)
            }
            if (error != null) Action("Camera opnieuw proberen", modifier = Modifier.fillMaxWidth()) { error = null; revision++ }
            Action("Annuleren · link of code invoeren", primary = false, modifier = Modifier.fillMaxWidth(), onClick = onClose)
        }
    }
}

@Composable internal fun ScannerPermissionPanel(error: String?, request: () -> Unit, cancel: () -> Unit) {
    Text(error ?: "Geef cameratoegang om een QR-code te scannen. Je kunt ook zonder cameratoegang een baanlink of wedstrijdcode invoeren.", color = PlayerMuted)
    Action("Cameratoegang vragen", modifier = Modifier.fillMaxWidth(), onClick = request)
    Action("Link of code invoeren", primary = false, modifier = Modifier.fillMaxWidth(), onClick = cancel)
}

@Composable private fun CameraQrPreview(code: (String) -> Unit, error: (String) -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val currentCode by rememberUpdatedState(code); val currentError by rememberUpdatedState(error)
    val camera = remember { LocalQrCamera(context, { currentCode(it) }, { currentError(it) }) }
    DisposableEffect(camera) { onDispose { camera.close() } }
    AndroidView(factory = { TextureView(it).also(camera::attach) }, modifier = modifier)
}

/** Camera2 avoids scanner services, provider telemetry, downloads and new media-storage permissions. */
private class LocalQrCamera(private val context: Context, private val onCode: (String) -> Unit, private val onError: (String) -> Unit) : AutoCloseable {
    private val worker = HandlerThread("dartflow-local-qr").apply { start() }
    private val handler = Handler(worker.looper)
    private val main = Handler(context.mainLooper)
    private val closed = AtomicBoolean(false)
    private val delivered = AtomicBoolean(false)
    private var texture: TextureView? = null
    private var device: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var reader: ImageReader? = null
    private var surface: Surface? = null
    private var lastFrame = 0L

    fun attach(view: TextureView) {
        texture = view
        view.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(value: SurfaceTexture, width: Int, height: Int) { open(value, width, height) }
            override fun onSurfaceTextureSizeChanged(value: SurfaceTexture, width: Int, height: Int) { transform(width, height) }
            override fun onSurfaceTextureDestroyed(value: SurfaceTexture): Boolean { close(); return true }
            override fun onSurfaceTextureUpdated(value: SurfaceTexture) = Unit
        }
        if (view.isAvailable) view.surfaceTexture?.let { open(it, view.width, view.height) }
    }

    private var size = Size(1280, 720)
    private fun fail() { if (!closed.get()) main.post { if (!closed.get()) onError("De camera kan niet worden geopend. Sluit andere camera-apps of voer de baanlink handmatig in.") } }

    @SuppressLint("MissingPermission")
    private fun open(value: SurfaceTexture, width: Int, height: Int) {
        if (closed.get()) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) { fail(); return }
        runCatching {
            val manager = context.getSystemService(CameraManager::class.java)
            val id = manager.cameraIdList.firstOrNull { manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK } ?: manager.cameraIdList.firstOrNull() ?: error("No camera")
            val characteristics = manager.getCameraCharacteristics(id)
            val focusModes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: intArrayOf()
            val focusMode = listOf(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO, CaptureRequest.CONTROL_AF_MODE_OFF).firstOrNull { it in focusModes }
            val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: error("No stream")
            val previewSizes = map.getOutputSizes(SurfaceTexture::class.java).toSet()
            size = map.getOutputSizes(ImageFormat.YUV_420_888).filter { it in previewSizes && it.width <= 1920 && it.height <= 1080 }.minByOrNull { kotlin.math.abs(it.width * it.height - 1280 * 720) } ?: error("No local scan format")
            value.setDefaultBufferSize(size.width, size.height)
            surface = Surface(value)
            transform(width, height)
            reader = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 2).also { images ->
                images.setOnImageAvailableListener({ source ->
                    runCatching { source.acquireLatestImage()?.use { image ->
                        if (closed.get() || delivered.get() || android.os.SystemClock.elapsedRealtime() - lastFrame < 180) return@use
                        lastFrame = android.os.SystemClock.elapsedRealtime()
                        val plane = image.planes[0]
                        val bytes = ByteArray(plane.buffer.remaining()).also { plane.buffer.get(it) }
                        val luminance = PlayerQrDecoder.packedLuminance(bytes, image.width, image.height, plane.rowStride, plane.pixelStride) ?: return@use
                        val result = PlayerQrDecoder.decode(luminance, image.width, image.height)
                        if (result != null && delivered.compareAndSet(false, true)) main.post { if (!closed.get()) onCode(result) }
                    } }
                }, handler)
            }
            manager.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    if (closed.get()) { camera.close(); return }; device = camera
                    runCatching {
                        val preview = surface ?: error("Missing preview")
                        val analysis = reader?.surface ?: error("Missing reader")
                        @Suppress("DEPRECATION")
                        camera.createCaptureSession(listOf(preview, analysis), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(capture: CameraCaptureSession) {
                                if (closed.get()) { capture.close(); return }; session = capture
                                runCatching { capture.setRepeatingRequest(camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(preview); addTarget(analysis); focusMode?.let { set(CaptureRequest.CONTROL_AF_MODE, it) } }.build(), null, handler) }.onFailure { fail() }
                            }
                            override fun onConfigureFailed(capture: CameraCaptureSession) { capture.close(); fail() }
                        }, handler)
                    }.onFailure { fail() }
                }
                override fun onDisconnected(camera: CameraDevice) { camera.close(); fail() }
                override fun onError(camera: CameraDevice, code: Int) { camera.close(); fail() }
            }, handler)
        }.onFailure { fail() }
    }

    private fun transform(width: Int, height: Int) {
        val view = texture ?: return
        if (width == 0 || height == 0) return
        val rotation = view.display?.rotation ?: Surface.ROTATION_0
        val matrix = Matrix()
        if (rotation == Surface.ROTATION_90 || rotation == Surface.ROTATION_270) {
            val rect = RectF(0f, 0f, width.toFloat(), height.toFloat())
            val buffer = RectF(0f, 0f, size.height.toFloat(), size.width.toFloat())
            buffer.offset(rect.centerX() - buffer.centerX(), rect.centerY() - buffer.centerY())
            matrix.setRectToRect(rect, buffer, Matrix.ScaleToFit.FILL)
            val scale = maxOf(height.toFloat() / size.height, width.toFloat() / size.width)
            matrix.postScale(scale, scale, rect.centerX(), rect.centerY())
            matrix.postRotate(90f * (rotation - 2), rect.centerX(), rect.centerY())
        } else if (rotation == Surface.ROTATION_180) matrix.postRotate(180f, width / 2f, height / 2f)
        view.setTransform(matrix)
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        runCatching { session?.stopRepeating() }; session?.close(); session = null
        device?.close(); device = null
        reader?.close(); reader = null
        surface?.release(); surface = null
        worker.quitSafely()
    }
}
