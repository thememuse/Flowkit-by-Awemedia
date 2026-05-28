import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np
import pytest
from PIL import Image

from agent.services.upscaler import LocalAIUpscaler, get_video_fps
from agent.services.post_process import upscale_video_offline

class MockInputOutput:
    def __init__(self, name):
        self.name = name

class MockSession:
    def __init__(self, *args, **kwargs):
        self.input_name = "input"
        self.output_name = "output"
    
    def get_inputs(self):
        return [MockInputOutput(self.input_name)]
        
    def get_outputs(self):
        return [MockInputOutput(self.output_name)]
        
    def run(self, output_names, input_feed):
        # input_feed has shape (1, 3, tile_size, tile_size)
        # We simply pass it through (scale=4 by returning matching size)
        # In actual Real-ESRGAN, the output size is 4x the input size
        # So we stretch the input tensor to 4x to match the 4x scaling
        tensor = input_feed[self.input_name]
        # input tensor shape: (1, 3, H, W)
        # Output shape should be: (1, 3, H*4, W*4)
        scaled_tensor = np.repeat(np.repeat(tensor, 4, axis=2), 4, axis=3)
        return [scaled_tensor]

@pytest.fixture
def mock_onnx_session():
    with patch("onnxruntime.InferenceSession", return_value=MockSession()) as mock_sess:
        yield mock_sess

@pytest.fixture
def dummy_image():
    # Create a simple 64x64 red image
    img = Image.new("RGB", (64, 64), color="red")
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp.close()
    img.save(tmp.name)
    yield tmp.name
    if os.path.exists(tmp.name):
        os.unlink(tmp.name)

class TestLocalAIUpscaler:
    def test_get_video_fps_fallback(self):
        # When ffprobe fails/raises, should return 25.0
        with patch("subprocess.run", side_effect=Exception("error")):
            fps = get_video_fps("fake_video.mp4")
            assert fps == 25.0

    def test_ensure_model_exists(self):
        # If model file exists, ensure_model should just return without downloading
        upscaler = LocalAIUpscaler()
        with patch.object(Path, "exists", return_value=True), \
             patch("agent.services.upscaler.hf_hub_download") as mock_download:
            upscaler._ensure_model()
            mock_download.assert_not_called()

    def test_ensure_model_downloads(self):
        # If model doesn't exist, ensure_model should download it
        upscaler = LocalAIUpscaler()
        with patch.object(Path, "exists", return_value=False), \
             patch("agent.services.upscaler.hf_hub_download", return_value="temp_file") as mock_download, \
             patch("shutil.copy") as mock_copy:
            upscaler._ensure_model()
            mock_download.assert_called_once()
            mock_copy.assert_called_once()

    def test_upscale_image_tiled(self, mock_onnx_session, dummy_image):
        upscaler = LocalAIUpscaler()
        # Mock ensure_model to avoid actual network check
        upscaler._ensure_model = MagicMock()
        
        out_tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        out_tmp.close()
        try:
            ok = upscaler.upscale_image_tiled(dummy_image, out_tmp.name, tile_size=32)
            assert ok is True
            # Output image should be 4x upscaled: 64x64 -> 256x256
            out_img = Image.open(out_tmp.name)
            assert out_img.size == (256, 256)
        finally:
            if os.path.exists(out_tmp.name):
                os.unlink(out_tmp.name)

    def test_upscale_video_pipeline(self, mock_onnx_session):
        upscaler = LocalAIUpscaler()
        upscaler.upscale_image_tiled = MagicMock(return_value=True)
        
        # We need to mock ffprobe and ffmpeg calls
        with patch("subprocess.run") as mock_sub, \
             patch("agent.services.upscaler.get_video_fps", return_value=30.0), \
             patch("pathlib.Path.glob") as mock_glob, \
             patch("pathlib.Path.exists", return_value=True):
            
            # Mock glob to return 2 dummy frame paths using comparable Path wrappers
            mock_glob.return_value = [Path("frame_0001.png"), Path("frame_0002.png")]
            
            ok = upscaler.upscale("input.mp4", "output.mp4")
            assert ok is True
            
            # Check that ffmpeg extract and ffmpeg merge were executed
            assert mock_sub.call_count == 2
            # Verify frame upscale was called for each frame
            upscaler.upscale_image_tiled.assert_called()

class TestPostProcessOffline:
    def test_upscale_video_offline_local_ai(self):
        # Test that upscale_video_offline routes to LocalAIUpscaler when method is "local_ai"
        with patch("agent.services.upscaler.LocalAIUpscaler") as mock_upscaler_class, \
             patch("pathlib.Path.exists", return_value=True):
            mock_instance = MagicMock()
            mock_instance.upscale.return_value = True
            mock_upscaler_class.return_value = mock_instance
            
            ok = upscale_video_offline("in.mp4", "out.mp4", method="local_ai")
            assert ok is True
            mock_instance.upscale.assert_called_once_with("in.mp4", "out.mp4", request_id="")

    def test_upscale_video_offline_fallback(self):
        # Test fallback to ffmpeg when local_ai raises exception
        with patch("agent.services.upscaler.LocalAIUpscaler", side_effect=RuntimeError("GPU OOM")), \
             patch("subprocess.run") as mock_sub, \
             patch("pathlib.Path.exists", return_value=True):
            
            # Mock subprocess to succeed for ffmpeg lanczos
            mock_sub.return_value = MagicMock(returncode=0)
            
            ok = upscale_video_offline("in.mp4", "out.mp4", method="local_ai")
            assert ok is True
            # Verify that it ran the ffmpeg command as fallback
            mock_sub.assert_called_once()
            args = mock_sub.call_args[0][0]
            assert any("lanczos" in str(arg) for arg in args)
