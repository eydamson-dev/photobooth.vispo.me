import obspython as obs
import urllib.request
import urllib.error
import os
import uuid
import threading

# -----------------------------------------------------------------------------
# Global Configuration (populated by OBS script settings)
# -----------------------------------------------------------------------------
source_name = ""                           # Name of the OBS source to capture
upload_url = "https://photobooth.cjcrsg.com/api/upload"
save_folder = "C:/temp"                    # Temporary disk buffer before HTTP POST
hotkey_id = obs.OBS_INVALID_HOTKEY_ID


# -----------------------------------------------------------------------------
# OBS Script Entry Points
# -----------------------------------------------------------------------------
def script_description():
    return (
        "Photobooth Auto-Uploader\n\n"
        "Captures a frame from a target OBS source and uploads it to the Photobooth API.\n"
        "Set a source name, configure the endpoint, and bind the hotkey below."
    )


def script_properties():
    props = obs.obs_properties_create()
    p = obs.obs_properties_add_text(props, "source_name", "Source Name (camera)", obs.OBS_TEXT_DEFAULT)
    obs.obs_property_set_long_description(p, "Name of the OBS source/scene you want to capture.")

    p = obs.obs_properties_add_text(props, "upload_url", "Upload Endpoint", obs.OBS_TEXT_DEFAULT)
    obs.obs_property_set_long_description(p, "Full URL to the Photobooth upload endpoint.")

    p = obs.obs_properties_add_text(props, "save_folder", "Temp Save Folder", obs.OBS_TEXT_DEFAULT)
    obs.obs_property_set_long_description(p, "Local folder where the screenshot is written before upload.")

    return props


def script_update(settings):
    global source_name, upload_url, save_folder
    source_name = obs.obs_data_get_string(settings, "source_name") or ""
    upload_url = obs.obs_data_get_string(settings, "upload_url") or "https://photobooth.cjcrsg.com/api/upload"
    save_folder = obs.obs_data_get_string(settings, "save_folder") or "C:/temp"


def script_load(settings):
    global hotkey_id
    script_update(settings)

    hotkey_id = obs.obs_hotkey_register_frontend(
        "photobooth_snap",
        "Take Photobooth Snapshot",
        on_hotkey
    )

    # Restore saved hotkey bindings
    hotkey_save_array = obs.obs_data_get_array(settings, "photobooth_snap_hotkey")
    obs.obs_hotkey_load(hotkey_id, hotkey_save_array)
    obs.obs_data_array_release(hotkey_save_array)


def script_save(settings):
    global hotkey_id
    hotkey_save_array = obs.obs_hotkey_save(hotkey_id)
    obs.obs_data_set_array(settings, "photobooth_snap_hotkey", hotkey_save_array)
    obs.obs_data_array_release(hotkey_save_array)


# -----------------------------------------------------------------------------
# Hotkey Handler
# -----------------------------------------------------------------------------
def on_hotkey(pressed):
    if not pressed:
        return
    take_and_upload_snapshot()


# -----------------------------------------------------------------------------
# Capture & Upload Pipeline
# -----------------------------------------------------------------------------
def take_and_upload_snapshot():
    global source_name, save_folder

    if not source_name:
        obs.script_log(obs.LOG_WARNING, "Photobooth: No source name configured in script properties.")
        return

    source = obs.obs_get_source_by_name(source_name)
    if not source:
        obs.script_log(obs.LOG_WARNING, f"Photobooth: Source '{source_name}' not found.")
        return

    try:
        os.makedirs(save_folder, exist_ok=True)
        filename = f"photobooth-{uuid.uuid4().hex}.png"
        file_path = os.path.join(save_folder, filename).replace("\\", "/")

        success = obs.obs_frontend_take_source_screenshot(source, file_path)
        if not success:
            obs.script_log(obs.LOG_ERROR, f"Photobooth: Screenshot failed for source '{source_name}'.")
            return

        obs.script_log(obs.LOG_INFO, f"Photobooth: Captured {file_path}, scheduling upload...")

        # Give OBS ~400ms to flush the PNG to disk, then upload off the render thread.
        def delayed_upload():
            obs.timer_remove(delayed_upload)
            threading.Thread(target=_upload_worker, args=(file_path,), daemon=True).start()

        obs.timer_add(delayed_upload, 400)
    finally:
        obs.obs_source_release(source)


def _build_multipart_request(url, file_path, field_name="photo"):
    boundary = f"----obsPyUpload{uuid.uuid4().hex}"
    filename = os.path.basename(file_path)
    mime_type = "image/png"

    with open(file_path, "rb") as f:
        file_data = f.read()

    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"{field_name}\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode("utf-8")
    body += file_data
    body += f"\r\n--{boundary}--\r\n".encode("utf-8")

    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body)),
    }

    return urllib.request.Request(url, data=body, headers=headers, method="POST")


def _upload_worker(file_path):
    global upload_url
    try:
        req = _build_multipart_request(upload_url, file_path)
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            obs.script_log(obs.LOG_INFO, f"Photobooth: Upload response {resp.status}: {body}")
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            err_body = ""
        obs.script_log(obs.LOG_ERROR, f"Photobooth: Upload HTTP error {e.code}: {err_body}")
    except Exception as e:
        obs.script_log(obs.LOG_ERROR, f"Photobooth: Upload failed: {e}")
    finally:
        _safe_delete(file_path)


def _safe_delete(file_path):
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            obs.script_log(obs.LOG_INFO, f"Photobooth: Cleaned up temp file {file_path}")
    except Exception as e:
        obs.script_log(obs.LOG_WARNING, f"Photobooth: Could not delete temp file {file_path}: {e}")


# -----------------------------------------------------------------------------
# Optional: test upload helper (can be called from Tools > Scripts > Log for debug)
# -----------------------------------------------------------------------------
def test_upload(props, prop):
    take_and_upload_snapshot()
    return True
