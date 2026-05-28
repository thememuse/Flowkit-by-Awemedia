import logging
import os
import shutil
import subprocess
import tempfile
import numpy as np
from pathlib import Path
from PIL import Image
from huggingface_hub import hf_hub_download
import onnxruntime as ort
from agent.config import BASE_DIR

logger = logging.getLogger(__name__)

def get_video_fps(video_path: str) -> float:
    """Extract exact frame rate from video metadata using ffprobe."""
    try:
        cmd = [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            video_path
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        val = res.stdout.strip()
        if "/" in val:
            num, den = map(float, val.split("/"))
            if den > 0:
                return num / den
        return float(val)
    except Exception as e:
        logger.warning("Failed to get FPS via ffprobe: %s. Defaulting to 25.0", e)
        return 25.0

class LocalAIUpscaler:
    def __init__(self):
        self.model_dir = BASE_DIR / "models"
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.model_path = self.model_dir / "real-esrgan-x4plus-128.onnx"
        self.session = None

    def _ensure_model(self):
        """Check if weights exist, otherwise download from Hugging Face hub."""
        if not self.model_path.exists():
            logger.info("Local AI Upscaler model not found. Downloading from Hugging Face (bukuroo/RealESRGAN-ONNX)...")
            try:
                downloaded = hf_hub_download(
                    repo_id="bukuroo/RealESRGAN-ONNX",
                    filename="real-esrgan-x4plus-128.onnx",
                    cache_dir=str(self.model_dir / ".cache")
                )
                shutil.copy(downloaded, str(self.model_path))
                logger.info("Successfully downloaded and cached model at %s", self.model_path)
            except Exception as e:
                logger.error("Failed to download model weights: %s", e)
                raise RuntimeError(f"Could not download Real-ESRGAN weights from HuggingFace: {e}")

    def _init_session(self):
        """Lazy load and initialize ONNX Runtime session with GPU acceleration."""
        if self.session is not None:
            return

        self._ensure_model()
        available_providers = ort.get_available_providers()
        logger.info("Available ONNX Runtime execution providers: %s", available_providers)
        
        # Priority: CoreML/Metal (Mac GPU), CUDA (Windows GPU), CPU fallback
        providers = []
        if "CoreMLExecutionProvider" in available_providers:
            providers.append("CoreMLExecutionProvider")
        if "CUDAExecutionProvider" in available_providers:
            providers.append("CUDAExecutionProvider")
        providers.append("CPUExecutionProvider")
        
        logger.info("Initializing ONNX InferenceSession using providers: %s", providers)
        self.session = ort.InferenceSession(str(self.model_path), providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name

    def upscale_image_tiled(self, img_path: str, out_path: str, tile_size: int = 128) -> bool:
        """Upscale a single image by 4x using tile-based processing to avoid OOM crashes."""
        try:
            self._init_session()
            img = Image.open(img_path).convert("RGB")
            W, H = img.size
            img_np = np.array(img)

            scale = 4
            out_H, out_W = H * scale, W * scale
            upscaled_np = np.zeros((out_H, out_W, 3), dtype=np.uint8)

            # Tiled Super-Resolution
            for y in range(0, H, tile_size):
                for x in range(0, W, tile_size):
                    # Actual region dimensions
                    h_actual = min(tile_size, H - y)
                    w_actual = min(tile_size, W - x)

                    # Crop patch
                    patch = img_np[y : y + h_actual, x : x + w_actual]

                    # Pad to tile_size x tile_size if edge patch
                    if h_actual < tile_size or w_actual < tile_size:
                        padded_patch = np.zeros((tile_size, tile_size, 3), dtype=np.uint8)
                        padded_patch[0:h_actual, 0:w_actual] = patch
                    else:
                        padded_patch = patch

                    # Normalize [0, 1] and transpose to (1, 3, H, W)
                    input_tensor = padded_patch.transpose(2, 0, 1)[None, ...].astype(np.float32) / 255.0

                    # Run model inference
                    output_tensor = self.session.run(
                        [self.output_name],
                        {self.input_name: input_tensor}
                    )[0]

                    # Convert back to (H, W, 3) in [0, 255]
                    output_tile = (output_tensor[0].transpose(1, 2, 0) * 255.0).clip(0, 255).astype(np.uint8)

                    # Crop padded region and copy into canvas
                    h_upscaled = h_actual * scale
                    w_upscaled = w_actual * scale
                    upscaled_np[y*scale : y*scale + h_upscaled, x*scale : x*scale + w_upscaled] = output_tile[0:h_upscaled, 0:w_upscaled]

            # Save upscaled image
            Image.fromarray(upscaled_np).save(out_path, quality=95)
            return True
        except Exception as e:
            logger.error("Error upscaling single image: %s", e)
            return False

    def upscale(self, input_video_path: str, output_video_path: str, request_id: str = "") -> bool:
        """Fully upscale an input video to 4K resolution using local Real-ESRGAN ONNX model."""
        if not Path(input_video_path).exists():
            logger.error("Local upscale: input video not found: %s", input_video_path)
            return False

        logger.info("Starting local AI video upscaling: %s", input_video_path)
        fps = get_video_fps(input_video_path)
        logger.info("Detected video framerate: %.2f FPS", fps)

        # Create temporary working directories
        tmp_dir = tempfile.mkdtemp(prefix="flowkit_upscale_")
        try:
            frames_dir = Path(tmp_dir) / "frames"
            upscaled_dir = Path(tmp_dir) / "upscaled"
            frames_dir.mkdir(parents=True, exist_ok=True)
            upscaled_dir.mkdir(parents=True, exist_ok=True)

            # Step 1: Extract frames from source video
            logger.info("Extracting frames via FFmpeg...")
            cmd_extract = [
                "ffmpeg", "-y", "-i", input_video_path,
                "-q:v", "2",
                str(frames_dir / "frame_%04d.png")
            ]
            subprocess.run(cmd_extract, capture_output=True, check=True)

            # Step 2: Iterate and upscale each frame
            frames = sorted(list(frames_dir.glob("frame_*.png")))
            total_frames = len(frames)
            logger.info("Total frames to process: %d", total_frames)

            for idx, frame_path in enumerate(frames):
                if request_id:
                    from agent.utils.cancel_registry import is_request_cancelled
                    if is_request_cancelled(request_id):
                        logger.warning("Local AI upscale request %s cancelled by user, aborting", request_id)
                        return False

                out_frame_path = upscaled_dir / frame_path.name
                # Upscale frame
                ok = self.upscale_image_tiled(str(frame_path), str(out_frame_path))
                if not ok:
                    logger.error("Failed to upscale frame %d/%d: %s", idx+1, total_frames, frame_path.name)
                    return False
                
                # Progress logging every 10%
                if total_frames > 10 and (idx + 1) % (total_frames // 10) == 0:
                    logger.info("Local AI Upscale Progress: %d%% completed (%d/%d frames)", int((idx + 1) / total_frames * 100), idx + 1, total_frames)

            # Step 3: Recompile upscaled frames back to video and copy audio
            logger.info("Recompiling upscaled 4K frames and copy audio...")
            cmd_recompile = [
                "ffmpeg", "-y",
                "-r", str(fps),
                "-i", str(upscaled_dir / "frame_%04d.png"),
                "-i", input_video_path,
                "-map", "0:v",
                "-map", "1:a?",  # Map audio if exists, optional
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                output_video_path
            ]
            subprocess.run(cmd_recompile, capture_output=True, check=True)
            
            logger.info("Local AI Upscaling successfully completed: %s", output_video_path)
            return True

        except Exception as e:
            logger.error("Error during local AI video upscaling: %s", e)
            return False
        finally:
            # Clean up working temp directory
            shutil.rmtree(tmp_dir, ignore_errors=True)
